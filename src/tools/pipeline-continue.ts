// src/tools/pipeline-continue.ts - 接力模式核心：对话路由 + 阶段推进 + 错误恢复
// 风格信号检测已独立到 style-signal-detector.ts

import { PipelineState, Template, callSubagent, InterruptPoint, Reducer } from '../types.js';
import { StateManager } from '../runtime/state-manager.js';
import { WorkspaceConfigManager, initWorkspace } from './workspace-config.js';
import { MemoryManager } from './memory.js';
import { StyleSystem } from './style-system.js';
import { detectStyleSignals, extractAndRecordSignals } from './style-signal-detector.js';
import { WORKSPACE_ROOT } from '../config.js';
import { isAdvanceSignal } from '../runtime/pipeline-utils.js';
import { freezeSnapshot, writeSessionNote, writeHandoffNote, autoCompress, shouldCompress } from './session-memory.js';

export interface ContinueResult {
  status: 'dialogue_continued' | 'stage_advanced' | 'completed' | 'error';
  action_taken: 'dialogue' | 'advanced' | 'completed';
  current_stage: number;
  current_stage_name: string;
  current_agent: string;
  stage_description?: string;
  total_stages: number;
  slot_output?: {
    slot_name: string;
    value: string | object;
    owner?: string;
    version: number;
  };
  message: string;
  error?: string;
  status_panel?: {
    template: string;
    author?: string;
    completed_stages: number;
    stages: Array<{
      id: string;
      agent: string;
      status: 'current' | 'completed' | 'pending';
      checkpoint: boolean;
    }>;
    slots: Record<string, { value: string | object; versions: number }>;
  };
  remark_history?: Array<{ agent: string; content: string; version: number }>;
}

// isAdvanceSignal 已移到 runtime/pipeline-utils.ts

function buildStatusPanel(state: PipelineState, template: Template, currentStage: number) {
  return {
    template: template.name,
    author: state.author,
    completed_stages: state.stage_history.filter(s => s.completed_at).length,
    stages: template.stages.map((s, i) => ({
      id: s.id,
      agent: s.agent,
      status: (i < currentStage ? 'completed' : i === currentStage ? 'current' : 'pending') as 'current' | 'completed' | 'pending',
      checkpoint: s.checkpoint,
    })),
    slots: Object.fromEntries(
      Object.entries(state.slot_values).map(([k, v]) => [
        k,
        { value: v, versions: (state.slot_history[k] || []).length },
      ])
    ),
  };
}

const MAX_RETRIES = 2;
const AGENT_TIMEOUT_MS = 180000;

/**
 * P0-2: 从 schema 中获取 slot 的 reducer 策略
 */
function getSlotReducer(template: Template, slotName: string): Reducer {
  if (!template.schema) return 'replace';
  const allSlots = {
    ...template.schema.input,
    ...template.schema.working,
    ...template.schema.output,
  };
  return allSlots[slotName]?.reducer ?? 'replace';
}

/**
 * P0-3: 检查是否有匹配的 interrupt point
 */
function findInterruptForStage(template: Template, completedStageId: string): InterruptPoint | null {
  if (!template.interrupts) return null;
  return template.interrupts.find(ip => ip.stage === completedStageId) ?? null;
}

/**
 * P0-3: 处理 pending interrupt
 * 返回 null 表示不匹配（当作普通对话），返回结果表示已处理
 */
async function handlePendingInterrupt(
  stateManager: StateManager,
  state: PipelineState,
  template: Template,
  message: string,
  workspaceRoot: string,
  userId: string,
): Promise<{ handled: boolean; result?: ContinueResult }> {
  const interrupt = state.pending_interrupt;
  if (!interrupt) return { handled: false };

  const trimmed = message.trim().toLowerCase();

  // 检查确认关键词
  const isConfirm = interrupt.confirmKeywords.some(kw =>
    trimmed === kw.toLowerCase() ||
    trimmed.startsWith(kw.toLowerCase() + ' ') ||
    trimmed.endsWith(' ' + kw.toLowerCase())
  );

  if (isConfirm) {
    // 确认通过，清除 interrupt，推进
    await stateManager.setPendingInterrupt(null);
    return {
      handled: true,
      result: {
        status: 'stage_advanced',
        action_taken: 'advanced',
        current_stage: state.current_stage,
        current_stage_name: template.stages[state.current_stage]?.id ?? '完成',
        current_agent: template.stages[state.current_stage]?.agent ?? '',
        total_stages: template.stages.length,
        message: `已确认。${interrupt.message}`,
        status_panel: buildStatusPanel(state, template, state.current_stage),
      },
    };
  }

  // 检查修改关键词
  const isRevise = interrupt.reviseKeywords.some(kw =>
    trimmed.includes(kw.toLowerCase())
  );

  if (isRevise) {
    // 用 remark 记录纠正
    await stateManager.addRemark('user', `[纠正] ${message}`);
    return {
      handled: true,
      result: {
        status: 'dialogue_continued',
        action_taken: 'dialogue',
        current_stage: state.current_stage,
        current_stage_name: template.stages[state.current_stage]?.id ?? '',
        current_agent: template.stages[state.current_stage]?.agent ?? '',
        total_stages: template.stages.length,
        message: `收到修改意见，已记录。请继续提供修改方向，或输入确认关键词继续推进。`,
        status_panel: buildStatusPanel(state, template, state.current_stage),
      },
    };
  }

  // 不匹配任何关键词，当作普通对话继续
  return { handled: false };
}

async function executeDialogue(
  stateManager: StateManager,
  state: PipelineState,
  template: Template,
  userId: string,
  projectId: string,
  workspaceRoot: string,
  message: string,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<{ response: string; slotName: string; retries: number }> {
  const stage = template.stages[state.current_stage];
  if (!stage) throw new Error(`当前阶段 ${state.current_stage} 不存在`);

  // 拦截：检测用户消息中的风格信号
  const signals = detectStyleSignals(message);
  if (signals.length > 0) {
    await extractAndRecordSignals(workspaceRoot, userId, signals, stage.agent);
  }

  const memoryManager = new MemoryManager(workspaceRoot, userId, stage.agent);
  const profile = await memoryManager.getProfile();

  // 构建简化 prompt（不含 pipeline 工具指令，子 agent 在隔离 sandbox 下工具不可用）
  const promptParts: string[] = [];

  // 角色定义
  promptParts.push(
    `你正在参与一个多阶段创作流程。\n` +
    `你的角色是：${stage.agent}\n` +
    `当前阶段：${stage.id} - ${stage.description || ''}\n` +
    `项目：${userId}/${projectId}（模板：${template.name}）\n`
  );

  // 已有上下文（可读 slot 内容）
  const readableSlots = stage.allow_read;
  if (readableSlots.includes('*') || readableSlots.length > 0) {
    const slotLines: string[] = [];
    for (const slotName of readableSlots) {
      if (slotName === '*') {
        for (const [k, v] of Object.entries(state.slot_values)) {
          if (v !== undefined && v !== '') {
            const content = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
            slotLines.push(`${k}:\n${content}`);
          }
        }
        break;
      }
      const value = state.slot_values[slotName];
      if (value !== undefined && value !== '') {
        const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        slotLines.push(`${slotName}:\n${content}`);
      }
    }
    if (slotLines.length > 0) {
      promptParts.push(`【已有上下文】\n${slotLines.join('\n')}\n`);
    }
  }

  // 用户偏好（可选）
  if (profile?.preferences && Object.keys(profile.preferences).length > 0) {
    promptParts.push(
      `【用户偏好】\n${JSON.stringify(profile.preferences, null, 2)}\n`
    );
  }

  // 用户消息
  if (message) {
    promptParts.push(
      `【用户消息】\n${message}\n\n请根据以上信息完成你的工作。直接输出内容，不要使用工具调用。`
    );
  }

  const prompt = promptParts.join('\n');

  const sessionKey = `${stage.agent}:${userId}:${projectId}`;
  const slotName = stage.allow_write[0];

  // 错误恢复：重试逻辑
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const agentResponse = await callSubagent(api, sessionKey, prompt, AGENT_TIMEOUT_MS);

      // 错误恢复：空 slot 检测
      const trimmed = agentResponse.trim();
      if (!trimmed || trimmed.length < 10) {
        lastError = `agent 产出过短 (${trimmed.length} 字符)`;
        if (attempt < MAX_RETRIES) {
          const sys = new StyleSystem(workspaceRoot, userId);
          await sys.appendInsight(`[内部] 第 ${attempt} 次产出过短，重试`, stage.agent);
          continue;
        }
        throw new Error(`agent 产出过短，已重试 ${MAX_RETRIES} 次`);
      }

      if (slotName) {
        const reducer = getSlotReducer(template, slotName);
        await stateManager.updateSlot(slotName, agentResponse, stage.agent, reducer);
      }

      return { response: agentResponse, slotName, retries: attempt - 1 };

    } catch (err: any) {
      lastError = `${err.message || String(err) || '未知错误'}`;
      if (attempt < MAX_RETRIES) {
        const sys = new StyleSystem(workspaceRoot, userId);
        await sys.appendInsight(`[内部] 第 ${attempt} 次调用失败: ${lastError}，重试`, stage.agent);
        continue;
      }
      // 标记当前 stage 为 failed
      await stateManager.markStageFailed(stage.agent, lastError);
      throw new Error(`agent [${stage.agent}] 调用失败，已重试 ${MAX_RETRIES} 次: ${lastError}`);
    }
  }

  throw new Error('executeDialogue 意外退出');
}

/**
 * 检测连续否定模式
 */
async function detectConsecutiveNegation(
  workspaceRoot: string,
  userId: string,
  currentAgent: string,
): Promise<number> {
  const styleSystem = new StyleSystem(workspaceRoot, userId);
  const insights = await styleSystem.readInsights();
  if (!insights) return 0;

  // 统计最近 10 条洞察中的纠正/禁止信号
  const lines = insights.split('\n').filter(l => l.includes('纠正') || l.includes('禁止'));
  const recent = lines.slice(-10);
  const negationCount = recent.filter(l => l.includes('(correction)') || l.includes('(forbidden)')).length;
  return negationCount;
}

async function autoAdvanceNonCheckpoint(
  stateManager: StateManager,
  template: Template,
  state: PipelineState,
  userId: string,
  projectId: string,
  workspaceRoot: string,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<PipelineState> {
  let s = { ...state };
  let nextStage = s.current_stage;
  while (nextStage < template.stages.length) {
    const stage = template.stages[nextStage];
    if (stage.checkpoint) break;

    const promptParts: string[] = [
      `你正在参与一个多阶段创作流程。\n` +
      `你的角色是：${stage.agent}\n` +
      `当前阶段：${stage.id} - ${stage.description || ''}\n` +
      `项目：${userId}（模板：${template.name}）\n`
    ];
    const slotLines: string[] = [];
    for (const slotName of stage.allow_read) {
      const value = s.slot_values[slotName];
      if (value !== undefined && value !== '') {
        const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        slotLines.push(`${slotName}:\n${content}`);
      }
    }
    if (slotLines.length > 0) {
      promptParts.push(`【已有上下文】\n${slotLines.join('\n')}\n`);
    }
    promptParts.push(`请根据已有信息完成你的工作。直接输出内容，不要使用工具调用。`);
    const prompt = promptParts.join('\n');
    const sessionKey = `${stage.agent}:${userId}:${projectId}`;
    const agentResponse = await callSubagent(api, sessionKey, prompt);
    const slotName = stage.allow_write[0];
    if (slotName) {
      const reducer = getSlotReducer(template, slotName);
      await stateManager.updateSlot(slotName, agentResponse, stage.agent, reducer);
    }
    const currentEntry = s.stage_history.find(h => h.stage === nextStage && !h.completed_at);
    if (currentEntry) currentEntry.completed_at = new Date().toISOString();
    nextStage++;
  }
  s.current_stage = nextStage;
  if (nextStage < template.stages.length) {
    const exists = s.stage_history.find(h => h.stage === nextStage);
    if (!exists) {
      s.stage_history.push({
        stage: nextStage,
        stage_id: template.stages[nextStage].id,
        agent: template.stages[nextStage].agent,
        started_at: new Date().toISOString(),
        versions: 0,
      });
    }
  }
  await stateManager.save(s);
  return s;
}

/**
 * pipeline_continue - 接力模式主入口
 */
export async function pipelineContinue(
  userId: string,
  projectId: string,
  message: string,
  workspaceRoot: string,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<ContinueResult> {
  try {
    const root = workspaceRoot || WORKSPACE_ROOT;
    const stateManager = new StateManager(root, userId, projectId);
    const configManager = new WorkspaceConfigManager(root);

    let state: PipelineState;
    try {
      state = await stateManager.load();
    } catch {
      return {
        status: 'error', action_taken: 'completed',
        current_stage: -1, current_stage_name: '错误', current_agent: '',
        total_stages: 0,
        message: '找不到项目状态，请先调用 pipeline_start',
        error: 'state not found',
      };
    }

    let template: Template;
    try {
      template = await configManager.readTemplate(state.template_name);
    } catch {
      await initWorkspace(root);
      template = await configManager.readTemplate(state.template_name);
    }

    // P0-3: 先检查是否有 pending interrupt
    if (state.pending_interrupt) {
      const { handled, result } = await handlePendingInterrupt(stateManager, state, template, message, root, userId);
      if (handled && result) {
        state = await stateManager.load();
        // 如果 interrupt 确认通过，需要真正推进
        if (result.status === 'stage_advanced') {
          await stateManager.completeCurrentStage();
          state = await stateManager.load();
          state = await stateManager.advanceStage();
          state = await autoAdvanceNonCheckpoint(stateManager, template, state, userId, projectId, root, api);

          if (state.current_stage >= template.stages.length) {
            state.status = 'completed';
            await stateManager.save(state);
            // Hermes: session 完成时写自述笔记 + 检查压缩
            const prevAgent = template.stages[state.current_stage - 1]?.agent || 'unknown';
            await writeSessionNote(root, userId, `[pipeline] 接力完成。全部 ${template.stages.length} 阶段已完成，最后一位专家: ${prevAgent}。记得调用 snapshot_create 冻结快照保护缓存。`).catch(() => {});
            if (await shouldCompress(root, userId).catch(() => false)) {
              await autoCompress(root, userId).catch(() => {});
            }
            return {
              status: 'completed', action_taken: 'completed',
              current_stage: state.current_stage, current_stage_name: '完成', current_agent: '',
              total_stages: template.stages.length,
              message: '所有阶段已完成！感谢使用部虾创。',
              status_panel: buildStatusPanel(state, template, state.current_stage),
            };
          }

          const newStage = template.stages[state.current_stage];
          // Hermes: handoff note — 记录 Agent 接力摘要
          const completedAgent = template.stages[state.current_stage - 1]?.agent || 'unknown';
          await writeHandoffNote(root, userId, completedAgent, newStage.agent,
            `阶段 "${template.stages[state.current_stage - 1]?.id || completedAgent}" 完成，推进到 "${newStage.id}"。`
          ).catch(() => {});
          return {
            status: 'stage_advanced', action_taken: 'advanced',
            current_stage: state.current_stage,
            current_stage_name: newStage.id,
            current_agent: newStage.agent,
            stage_description: newStage.description,
            total_stages: template.stages.length,
            message: `已推进到第 ${state.current_stage + 1}/${template.stages.length} 阶段：由 [${newStage.agent}] 为您服务。${newStage.description ? '\n任务：' + newStage.description : ''}\n\n请开始对话。`,
            status_panel: buildStatusPanel(state, template, state.current_stage),
          };
        }
        return result;
      }
      // 不匹配关键词，当作普通对话继续
    }

    if (isAdvanceSignal(message)) {
      // P0-3: 记录当前 stage id，用于检查 interrupt
      const completedStageId = template.stages[state.current_stage]?.id;

      await stateManager.completeCurrentStage();
      state = await stateManager.load();

      const oldStage = state.current_stage;
      state = await stateManager.advanceStage();

      // P0-3: 检查完成的 stage 是否有 interrupt
      const interrupt = completedStageId ? findInterruptForStage(template, completedStageId) : null;
      if (interrupt) {
        await stateManager.setPendingInterrupt(interrupt);
        state = await stateManager.load();
        return {
          status: 'dialogue_continued', action_taken: 'dialogue',
          current_stage: state.current_stage,
          current_stage_name: template.stages[state.current_stage]?.id ?? '',
          current_agent: template.stages[state.current_stage]?.agent ?? '',
          total_stages: template.stages.length,
          message: interrupt.message,
          status_panel: buildStatusPanel(state, template, state.current_stage),
        };
      }

      state = await autoAdvanceNonCheckpoint(stateManager, template, state, userId, projectId, root, api);

      if (state.current_stage >= template.stages.length) {
        state.status = 'completed';
        await stateManager.save(state);
        // Hermes: session 完成时写自述笔记 + 检查压缩
        await writeSessionNote(root, userId, `[pipeline] 接力完成。全部 ${template.stages.length} 阶段已完成。`).catch(() => {});
        if (await shouldCompress(root, userId).catch(() => false)) {
          await autoCompress(root, userId).catch(() => {});
        }
        return {
          status: 'completed', action_taken: 'completed',
          current_stage: state.current_stage, current_stage_name: '完成', current_agent: '',
          total_stages: template.stages.length,
          message: '所有阶段已完成！感谢使用部虾创。',
          status_panel: buildStatusPanel(state, template, state.current_stage),
        };
      }

      const newStage = template.stages[state.current_stage];
      // Hermes: handoff note
      const completedAgent = template.stages[state.current_stage - 1]?.agent || 'unknown';
      await writeHandoffNote(root, userId, completedAgent, newStage.agent,
        `阶段 "${template.stages[state.current_stage - 1]?.id || completedAgent}" 完成，推进到 "${newStage.id}"。`
      ).catch(() => {});
      return {
        status: 'stage_advanced', action_taken: 'advanced',
        current_stage: state.current_stage,
        current_stage_name: newStage.id,
        current_agent: newStage.agent,
        stage_description: newStage.description,
        total_stages: template.stages.length,
        message: `已推进到第 ${state.current_stage + 1}/${template.stages.length} 阶段：由 [${newStage.agent}] 为您服务。${newStage.description ? '\n任务：' + newStage.description : ''}\n\n请开始对话。`,
        status_panel: buildStatusPanel(state, template, state.current_stage),
      };
    }

    if (state.current_stage >= template.stages.length) {
      return {
        status: 'completed', action_taken: 'completed',
        current_stage: state.current_stage, current_stage_name: '完成', current_agent: '',
        total_stages: template.stages.length,
        message: '项目已完成。启动新项目请调用 pipeline_start。',
      };
    }

    const { response, slotName, retries } = await executeDialogue(
      stateManager, state, template, userId, projectId, root, message, api
    );

    // 错误恢复：连续否定检测
    const currentStageInfo = template.stages[state.current_stage];
    const negationCount = await detectConsecutiveNegation(root, userId, currentStageInfo.agent);
    let warning = '';
    if (negationCount >= 3 && retries > 0) {
      warning = '\n\n⚠️ 检测到连续否定，建议暂停并检查风格配置。用 style_read_profile 查看当前风格 DNA。';
      const negStyleSystem = new StyleSystem(root, userId);
      await negStyleSystem.appendInsight(`[错误恢复] 连续否定: ${negationCount} 次，建议检查风格配置`, currentStageInfo.agent);
    }

    return {
      status: 'dialogue_continued', action_taken: 'dialogue',
      current_stage: state.current_stage,
      current_stage_name: currentStageInfo.id,
      current_agent: currentStageInfo.agent,
      stage_description: currentStageInfo.description,
      total_stages: template.stages.length,
      slot_output: {
        slot_name: slotName,
        value: response,
        owner: currentStageInfo.agent,
        version: (state.slot_history[slotName]?.length || 1) - 1,
      },
      message: `${response}\n\n---\n💬 继续与 [${currentStageInfo.agent}] 对话，或输入 "下一阶段" 推进。${warning}`,
      status_panel: buildStatusPanel(state, template, state.current_stage),
      remark_history: state.remarks.map(r => ({
        agent: r.agent, content: r.content, version: r.version,
      })),
    };
  } catch (err) {
    return {
      status: 'error', action_taken: 'completed',
      current_stage: -1, current_stage_name: '错误', current_agent: '',
      total_stages: 0,
      message: `执行出错: ${String(err)}`,
      error: String(err),
    };
  }
}

