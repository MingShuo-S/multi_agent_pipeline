// src/tools/pipeline-continue.ts - 接力模式核心：对话路由 + 阶段推进 + 错误恢复
// 风格信号检测已独立到 style-signal-detector.ts

import { PipelineState, Template, callSubagent } from '../types.js';
import { StateManager } from '../runtime/state-manager.js';
import { WorkspaceConfigManager, initWorkspace } from './workspace-config.js';
import { MemoryManager } from './memory.js';
import { PromptBuilder } from '../runtime/prompt-builder.js';
import { StyleSystem } from './style-system.js';
import { detectStyleSignals, extractAndRecordSignals } from './style-signal-detector.js';
import { WORKSPACE_ROOT } from '../config.js';

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

const ADVANCE_KEYWORDS = [
  '下一阶段', '下一步', '推进', 'advance', 'next stage',
  '完成', '好了', '可以了', '没问题', '继续下一步',
  '过', 'pass', 'next', 'go ahead', 'continue',
];

export function isAdvanceSignal(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return ADVANCE_KEYWORDS.some(kw => {
    const kwLower = kw.toLowerCase();
    return trimmed === kwLower
      || trimmed.startsWith(kwLower + ' ')
      || trimmed.endsWith(' ' + kwLower)
      || trimmed.includes(kwLower + kwLower);
  });
}

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

  const promptBuilder = new PromptBuilder(workspaceRoot, userId, projectId);
  const memoryManager = new MemoryManager(workspaceRoot, userId, stage.agent);
  const profile = await memoryManager.getProfile();

  const prompt = await promptBuilder.buildPipelinePrompt(
    stage.agent, template, state, profile, message
  );

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
        await stateManager.updateSlot(slotName, agentResponse, stage.agent);
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

    const promptBuilder = new PromptBuilder(workspaceRoot, userId, projectId);
    const prompt = await promptBuilder.buildPipelinePrompt(
      stage.agent, template, s, {} as any, '请根据已有信息完成你的工作'
    );
    const sessionKey = `${stage.agent}:${userId}:${projectId}`;
    const agentResponse = await callSubagent(api, sessionKey, prompt);
    const slotName = stage.allow_write[0];
    if (slotName) {
      await stateManager.updateSlot(slotName, agentResponse, stage.agent);
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

    if (isAdvanceSignal(message)) {
      await stateManager.completeCurrentStage();
      state = await stateManager.load();

      const oldStage = state.current_stage;
      state = await stateManager.advanceStage();

      state = await autoAdvanceNonCheckpoint(stateManager, template, state, userId, projectId, root, api);

      if (state.current_stage >= template.stages.length) {
        state.status = 'completed';
        await stateManager.save(state);
        return {
          status: 'completed', action_taken: 'completed',
          current_stage: state.current_stage, current_stage_name: '完成', current_agent: '',
          total_stages: template.stages.length,
          message: '所有阶段已完成！感谢使用部虾创。',
          status_panel: buildStatusPanel(state, template, state.current_stage),
        };
      }

      const newStage = template.stages[state.current_stage];
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

