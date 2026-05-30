// src/tools/pipeline-continue.ts - 接力模式核心：对话路由 + 阶段推进

import { PipelineState, Template, callSubagent } from '../types.js';
import { StateManager } from '../runtime/state-manager.js';
import { WorkspaceConfigManager } from './workspace-config.js';
import { MemoryManager } from './memory.js';
import { PromptBuilder } from '../runtime/prompt-builder.js';
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

function isAdvanceSignal(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return ADVANCE_KEYWORDS.some(kw => {
    const kwLower = kw.toLowerCase();
    return trimmed === kwLower || trimmed.startsWith(kwLower + ' ') || trimmed.endsWith(' ' + kwLower);
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

async function executeDialogue(
  stateManager: StateManager,
  state: PipelineState,
  template: Template,
  userId: string,
  projectId: string,
  workspaceRoot: string,
  message: string,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<{ response: string; slotName: string }> {
  const stage = template.stages[state.current_stage];
  if (!stage) throw new Error(`当前阶段 ${state.current_stage} 不存在`);

  const promptBuilder = new PromptBuilder(workspaceRoot, userId, projectId);
  const memoryManager = new MemoryManager(workspaceRoot, userId, stage.agent);
  const profile = await memoryManager.getProfile();

  const prompt = await promptBuilder.buildPipelinePrompt(
    stage.agent, template, state, profile, message
  );

  const sessionKey = `${stage.agent}:${userId}:${projectId}`;
  const agentResponse = await callSubagent(api, sessionKey, prompt);

  const slotName = stage.allow_write[0];
  if (slotName) {
    await stateManager.updateSlot(slotName, agentResponse, stage.agent);
  }

  return { response: agentResponse, slotName };
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
    // 自动执行非 checkpoint 阶段
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
 * 检测用户消息是否为"推进"信号：
 *   - 是 → 推进到下一阶段
 *   - 否 → 路由给当前专家对话
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

    const template = await configManager.readTemplate(state.template_name);

    // 判断是否推进信号
    if (isAdvanceSignal(message)) {
      // 完成当前阶段
      await stateManager.completeCurrentStage();

      // 重新加载状态
      state = await stateManager.load();

      // 推进到下一阶段
      const oldStage = state.current_stage;
      state = await stateManager.advanceStage();

      // 自动推进不需要 checkpoints 的阶段
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

    // 不是推进信号 → 路由给当前专家对话
    if (state.current_stage >= template.stages.length) {
      return {
        status: 'completed', action_taken: 'completed',
        current_stage: state.current_stage, current_stage_name: '完成', current_agent: '',
        total_stages: template.stages.length,
        message: '项目已完成。启动新项目请调用 pipeline_start。',
      };
    }

    const { response, slotName } = await executeDialogue(
      stateManager, state, template, userId, projectId, root, message, api
    );

    const currentStage = template.stages[state.current_stage];
    return {
      status: 'dialogue_continued', action_taken: 'dialogue',
      current_stage: state.current_stage,
      current_stage_name: currentStage.id,
      current_agent: currentStage.agent,
      stage_description: currentStage.description,
      total_stages: template.stages.length,
      slot_output: {
        slot_name: slotName,
        value: response,
        owner: currentStage.agent,
        version: (state.slot_history[slotName]?.length || 1) - 1,
      },
      message: `${response}\n\n---\n💬 继续与 [${currentStage.agent}] 对话，或输入 "下一阶段" 推进。`,
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

export const pipelineContinueTool = {
  id: 'pipeline_continue',
  name: 'pipeline_continue',
  description: '接力模式：将用户消息路由给当前阶段专家对话，或检测"下一阶段"信号推进管道。',
  parameters: {
    type: 'object',
    properties: {
      user_id: {
        type: 'string',
        description: '用户 ID',
      },
      project_id: {
        type: 'string',
        description: '项目 ID',
      },
      message: {
        type: 'string',
        description: '用户的消息内容。如果内容为"下一阶段"/"advance"等推进关键词，则推进到下一个阶段。',
      },
    },
    required: ['user_id', 'project_id', 'message'],
  },
};
