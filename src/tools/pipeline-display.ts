// src/tools/pipeline-display.ts - 直接输出格式化内容，orchestrator 原样转发

import { PipelineState, Template } from '../types.js';
import { StateManager } from '../runtime/state-manager.js';
import { WorkspaceConfigManager } from './workspace-config.js';
import { WORKSPACE_ROOT } from '../config.js';

interface SlotEntry {
  name: string;
  value: string | object;
  agent: string;
  written_at: string;
  version: number;
}

interface RemarkEntry {
  agent: string;
  content: string;
  timestamp: string;
  version: number;
}

/**
 * pipeline_display - 直接输出最新 slot/remark 内容的 markdown
 *
 * 两种模式：
 * 1. 最近是 slot → 展示 slot + 作者 agent
 * 2. 最近是 remark → 展示 remark + 被评论的 slot + 两个 agent
 */
export async function pipelineDisplay(
  userId: string,
  projectId: string,
  workspaceRoot: string
): Promise<string> {
  try {
    const root = workspaceRoot || WORKSPACE_ROOT;
    const stateManager = new StateManager(root, userId, projectId);
    const configManager = new WorkspaceConfigManager(root);

    let state: PipelineState;
    try {
      state = await stateManager.load();
    } catch {
      return '❌ 项目状态不存在，请先调用 pipeline_start';
    }

    let template: Template;
    try {
      template = await configManager.readTemplate(state.template_name);
    } catch {
      return '❌ 模板不存在';
    }

    const currentStage = template.stages[state.current_stage];
    if (!currentStage) {
      return '✅ 所有阶段已完成';
    }

    // 收集所有 slot 的最新写入
    const allSlots = getAllLatestSlots(state);

    // 获取最新 remark
    const latestRemark = state.remarks.length > 0
      ? state.remarks[state.remarks.length - 1]
      : null;

    // 判断哪个更新
    const latestSlot = allSlots.length > 0 ? allSlots[0] : null;
    const remarkTime = latestRemark ? new Date(latestRemark.timestamp).getTime() : 0;
    const slotTime = latestSlot ? new Date(latestSlot.written_at).getTime() : 0;

    // 模式 1: 最近是 remark
    if (latestRemark && remarkTime > slotTime) {
      return formatRemarkMode(latestRemark, state, allSlots);
    }

    // 模式 2: 最近是 slot
    if (latestSlot) {
      return formatSlotMode(latestSlot, state);
    }

    // 模式 3: 无产出
    return `⏳ **${currentStage.id}**（${currentStage.agent}）尚未产出内容\n${currentStage.description ? `任务: ${currentStage.description}` : ''}`;
  } catch (err) {
    return `❌ 获取失败: ${String(err)}`;
  }
}

/**
 * 获取所有 slot 的最新写入，按时间倒序
 */
function getAllLatestSlots(state: PipelineState): SlotEntry[] {
  const slots: SlotEntry[] = [];

  for (const [name, history] of Object.entries(state.slot_history)) {
    if (!history || history.length === 0) continue;
    const last = history[history.length - 1];
    slots.push({
      name,
      value: last.content,
      agent: last.agent,
      written_at: last.written_at,
      version: last.version,
    });
  }

  // 按时间倒序
  slots.sort((a, b) => new Date(b.written_at).getTime() - new Date(a.written_at).getTime());
  return slots;
}

/**
 * 格式化 remark 模式：展示 remark + 被评论的 slot
 *
 * 输出格式：
 * 💬 **来自 AgentA 的评论**
 *
 * > 评论内容
 *
 * ---
 * 相关内容（来自 AgentB）:
 * ### slot_name
 * slot 内容
 */
function formatRemarkMode(remark: RemarkEntry, state: PipelineState, allSlots: SlotEntry[]): string {
  const lines: string[] = [];

  // 展示 remark
  lines.push(`💬 **来自 ${remark.agent} 的评论**`);
  lines.push('');
  lines.push(`> ${remark.content}`);
  lines.push('');

  // 找被评论的 slot：remark 之前最近写入的 slot（通常是别的 agent 写的）
  const remarkTime = new Date(remark.timestamp).getTime();
  const relatedSlots = allSlots.filter(s =>
    new Date(s.written_at).getTime() < remarkTime && s.agent !== remark.agent
  );

  if (relatedSlots.length > 0) {
    lines.push('---');
    const targetSlot = relatedSlots[0]; // 最近的
    lines.push(`**相关内容**（来自 ${targetSlot.agent}）:`);
    lines.push('');
    lines.push(`### ${targetSlot.name}`);
    lines.push(formatSlotContent(targetSlot.value));
  }

  return lines.join('\n');
}

/**
 * 格式化 slot 模式：展示 slot + 作者
 *
 * 输出格式：
 * 📝 **slot_name**（来自 AgentA，v0）
 *
 * slot 内容
 */
function formatSlotMode(slot: SlotEntry, state: PipelineState): string {
  const lines: string[] = [];

  lines.push(`📝 **${slot.name}**（来自 ${slot.agent}，v${slot.version}）`);
  lines.push('');
  lines.push(formatSlotContent(slot.value));

  return lines.join('\n');
}

/**
 * 格式化 slot 内容
 */
function formatSlotContent(value: string | object): string {
  if (typeof value === 'string') {
    return value;
  }
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
}
