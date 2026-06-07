// src/tools/pipeline-display.ts - 直接输出格式化内容，orchestrator 原样转发

import { PipelineState, Template } from '../types.js';
import { StateManager } from '../runtime/state-manager.js';
import { WorkspaceConfigManager } from './workspace-config.js';
import { WORKSPACE_ROOT } from '../config.js';

/**
 * pipeline_display - 直接输出最新 slot/remark 内容的 markdown
 *
 * 设计目标：
 * 1. orchestrator 不需要花 token 总结，直接转发此工具的输出
 * 2. 如果最新的是 slot → 展示 slot 内容 + 元信息
 * 3. 如果最新的是 remark → 展示 remark + 被评论的 slot 内容
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

    // 找到当前 stage 最近写入的 slot
    const writableSlots = currentStage.allow_write;
    let latestSlot: { name: string; value: string | object; agent: string; written_at: string; version: number } | null = null;

    for (const slotName of writableSlots) {
      const history = state.slot_history[slotName] || [];
      if (history.length === 0) continue;
      const last = history[history.length - 1];
      if (!latestSlot || new Date(last.written_at) > new Date(latestSlot.written_at)) {
        latestSlot = {
          name: slotName,
          value: last.content,
          agent: last.agent,
          written_at: last.written_at,
          version: last.version,
        };
      }
    }

    // 检查是否有最近的 remark
    const latestRemark = state.remarks.length > 0 ? state.remarks[state.remarks.length - 1] : null;
    const remarkTime = latestRemark ? new Date(latestRemark.timestamp).getTime() : 0;
    const slotTime = latestSlot ? new Date(latestSlot.written_at).getTime() : 0;

    // 构建输出
    const lines: string[] = [];

    // 情况 1: 最近的是 remark（比 slot 更新）
    if (latestRemark && remarkTime > slotTime) {
      lines.push(`💬 **来自 ${latestRemark.agent} 的评论**`);
      lines.push('');
      lines.push(`> ${latestRemark.content}`);
      lines.push('');

      // 尝试找到 remark 评论的相关 slot
      // 逻辑：remark 的 agent 是当前 stage，找它最近写入的 slot
      const remarkAgentSlots = findAgentSlots(state, latestRemark.agent, writableSlots);
      if (remarkAgentSlots.length > 0) {
        lines.push(`**被评论的内容**（${latestRemark.agent} 的产出）:`);
        lines.push('');
        for (const slot of remarkAgentSlots) {
          const content = formatSlotContent(slot.value);
          lines.push(`### ${slot.name}`);
          lines.push(content);
          lines.push('');
        }
      }
    }
    // 情况 2: 最近的是 slot
    else if (latestSlot) {
      const content = formatSlotContent(latestSlot.value);
      lines.push(`📝 **${latestSlot.name}**（来自 ${latestSlot.agent}，v${latestSlot.version}）`);
      lines.push('');
      lines.push(content);
      lines.push('');

      // 如果有相关的 remark，也展示
      const relatedRemarks = state.remarks.filter(r => r.agent === latestSlot!.agent);
      if (relatedRemarks.length > 0) {
        lines.push('---');
        lines.push(`💬 **${latestSlot.agent} 的评论**:`);
        for (const r of relatedRemarks.slice(-3)) {
          lines.push(`> ${r.content}`);
        }
      }
    }
    // 情况 3: 还没有任何产出
    else {
      lines.push(`⏳ **${currentStage.id}**（${currentStage.agent}）尚未产出内容`);
      if (currentStage.description) {
        lines.push(`任务: ${currentStage.description}`);
      }
    }

    return lines.join('\n');
  } catch (err) {
    return `❌ 获取失败: ${String(err)}`;
  }
}

/**
 * 找到某个 agent 最近写入的 slot
 */
function findAgentSlots(
  state: PipelineState,
  agent: string,
  slotNames: string[]
): Array<{ name: string; value: string | object }> {
  const result: Array<{ name: string; value: string | object }> = [];

  for (const slotName of slotNames) {
    const history = state.slot_history[slotName] || [];
    // 找该 agent 最后一次写入
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].agent === agent) {
        result.push({ name: slotName, value: history[i].content });
        break;
      }
    }
  }

  return result;
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
