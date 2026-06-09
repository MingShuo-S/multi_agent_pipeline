// src/tools/pipeline-start.ts - 启动管道（relay 模式：初始化 + 首次对话）

import { promises as fs } from 'fs';
import path from 'path';
import { ToolContext, Template, PipelineState, PipelineStage, callSubagent, PipelineMode } from '../types.js';
import { StateManager } from '../runtime/state-manager.js';
import { WorkspaceConfigManager, initWorkspace } from './workspace-config.js';
import { MemoryManager } from './memory.js';
import { PromptBuilder } from '../runtime/prompt-builder.js';
import { WORKSPACE_ROOT } from '../config.js';
import { freezeSnapshot } from './session-memory.js';

export interface PipelineStartResult {
  status: 'initialized' | 'checkpoint_reached' | 'completed' | 'error';
  mode: PipelineMode;
  current_stage: number;
  current_stage_name: string;
  current_agent: string;
  stage_description?: string;
  total_stages: number;
  stages: Array<{ name: string; agent: string; checkpoint: boolean; completed: boolean }>;
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
}

function buildStatusPanel(state: PipelineState, template: Template, currentStage: number): PipelineStartResult['status_panel'] {
  return {
    template: template.name,
    author: state.author,
    completed_stages: state.stage_history.filter(s => s.completed_at).length,
    stages: template.stages.map((s, i) => ({
      id: s.id,
      agent: s.agent,
      status: i < currentStage ? 'completed' : i === currentStage ? 'current' : 'pending',
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

/**
 * 执行 relay 模式：路由消息给当前阶段 Agent 并返回响应
 */
async function executeRelayDialogue(
  stateManager: StateManager,
  state: PipelineState,
  template: Template,
  userId: string,
  projectId: string,
  workspaceRoot: string,
  message: string,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<{ response: string; slotName: string }> {
  const currentStage = template.stages[state.current_stage];
  if (!currentStage) {
    throw new Error(`阶段 ${state.current_stage} 不存在`);
  }

  const promptBuilder = new PromptBuilder(workspaceRoot, userId, projectId);
  const memoryManager = new MemoryManager(workspaceRoot, userId, currentStage.agent);
  const profile = await memoryManager.getProfile();

  const prompt = await promptBuilder.buildPipelinePrompt(
    currentStage.agent, template, state, profile, message
  );

  const sessionKey = `${currentStage.agent}:${userId}:${projectId}`;
  const agentResponse = await callSubagent(api, sessionKey, prompt);

  const slotName = currentStage.allow_write[0];
  if (slotName) {
    await stateManager.updateSlot(slotName, agentResponse, currentStage.agent);
  }

  return { response: agentResponse, slotName };
}

/**
 * 执行 relay 模式自动推进（跳过不需要 checkpoints 的阶段）
 */
async function autoAdvanceNonCheckpointStages(
  stateManager: StateManager,
  template: Template,
  state: PipelineState,
  userId: string,
  projectId: string,
  workspaceRoot: string,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<PipelineState> {
  let nextStage = state.current_stage;
  while (nextStage < template.stages.length) {
    const stage = template.stages[nextStage];
    // 如果是 checkpoint 阶段，停止
    if (stage.checkpoint) break;
    // 如果不是 checkpoint，自动执行
    const promptBuilder = new PromptBuilder(workspaceRoot, userId, projectId);
    const prompt = await promptBuilder.buildPipelinePrompt(
      stage.agent, template, state, {} as any, "请根据已有信息完成你的工作"
    );
    const sessionKey = `${stage.agent}:${userId}:${projectId}`;
    const agentResponse = await callSubagent(api, sessionKey, prompt);
    const slotName = stage.allow_write[0];
    if (slotName) {
      await stateManager.updateSlot(slotName, agentResponse, stage.agent);
    }
    // 完成当前阶段
    const currentEntry = state.stage_history.find(h => h.stage === nextStage && !h.completed_at);
    if (currentEntry) currentEntry.completed_at = new Date().toISOString();
    nextStage++;
  }
  state.current_stage = nextStage;
  // 如果推进到了新阶段，记录开始
  if (nextStage < template.stages.length) {
    state.stage_history.push({
      stage: nextStage,
      stage_id: template.stages[nextStage].id,
      agent: template.stages[nextStage].agent,
      started_at: new Date().toISOString(),
      versions: 0,
    });
  }
  await stateManager.save(state);
  return state;
}

/**
 * pipeline_start - relay 模式：初始化项目并开始与第一个专家对话
 */
export async function pipelineStart(
  templateName: string,
  userId: string,
  projectId: string,
  initialMessage: string,
  workspaceRoot: string,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<PipelineStartResult> {
  try {
    if (!templateName) {
      return { status: 'error', mode: 'relay', current_stage: -1, current_stage_name: '错误', current_agent: '', total_stages: 0, stages: [], message: '缺少 template_name', error: 'template_name is required' };
    }
    if (!userId) {
      return { status: 'error', mode: 'relay', current_stage: -1, current_stage_name: '错误', current_agent: '', total_stages: 0, stages: [], message: '缺少 user_id', error: 'user_id is required' };
    }
    if (!projectId) {
      return { status: 'error', mode: 'relay', current_stage: -1, current_stage_name: '错误', current_agent: '', total_stages: 0, stages: [], message: '缺少 project_id', error: 'project_id is required' };
    }

    const root = workspaceRoot || WORKSPACE_ROOT;
    const stateManager = new StateManager(root, userId, projectId);
    const configManager = new WorkspaceConfigManager(root);

    // 强制创建项目目录 — 确保后续 withLock 不会因目录不存在而失败
    const projectDir = path.join(root, 'projects', userId, projectId);
    await fs.mkdir(projectDir, { recursive: true });

    let template: Template;
    try {
      template = await configManager.readTemplate(templateName);
    } catch {
      await initWorkspace(root);
      template = await configManager.readTemplate(templateName);
    }

    const mode = template.mode || 'relay';

    // 检查是否已有运行中的项目
    let state: PipelineState;
    try {
      state = await stateManager.load();
      if (state.status === 'running') {
        const currentStage = state.current_stage < template.stages.length
          ? template.stages[state.current_stage]
          : null;
        return {
          status: 'initialized',
          mode: state.mode,
          current_stage: state.current_stage,
          current_stage_name: currentStage?.id || '完成',
          current_agent: currentStage?.agent || '',
          stage_description: currentStage?.description,
          total_stages: template.stages.length,
          stages: template.stages.map((s, i) => ({
            name: s.id,
            agent: s.agent,
            checkpoint: s.checkpoint,
            completed: i < state.current_stage,
          })),
          message: `项目已存在，当前在第 ${state.current_stage + 1}/${template.stages.length} 阶段，专家 [${currentStage?.agent}] 正在待命。请继续对话。`,
          status_panel: buildStatusPanel(state, template, state.current_stage),
        };
      }
    } catch {
      // 状态文件不存在，初始化
    }

    // 初始化
    state = await stateManager.initialize(template, mode);

    // Hermes 模式：session 启动时冻结 KB 快照 → 保护 prefix cache
    await freezeSnapshot(root, userId, projectId);

    // 自动推进不需要 checkpoints 的阶段
    state = await autoAdvanceNonCheckpointStages(stateManager, template, state, userId, projectId, root, api);

    // 获取当前阶段
    if (state.current_stage >= template.stages.length) {
      state.status = 'completed';
      await stateManager.save(state);
      return {
        status: 'completed',
        mode,
        current_stage: state.current_stage,
        current_stage_name: '完成',
        current_agent: '',
        total_stages: template.stages.length,
        stages: template.stages.map(s => ({ name: s.id, agent: s.agent, checkpoint: s.checkpoint, completed: true })),
        message: '所有阶段已完成！',
        status_panel: buildStatusPanel(state, template, state.current_stage),
      };
    }

    const currentStage = template.stages[state.current_stage];
    const stagesSummary = template.stages.map((s, i) => ({
      name: s.id,
      agent: s.agent,
      checkpoint: s.checkpoint,
      completed: i < state.current_stage,
    }));

    // 如果有初始消息，路由给第一个 Agent
    if (initialMessage) {
      const { response, slotName } = await executeRelayDialogue(
        stateManager, state, template, userId, projectId, root, initialMessage, api
      );

      return {
        status: 'checkpoint_reached',
        mode,
        current_stage: state.current_stage,
        current_stage_name: currentStage.id,
        current_agent: currentStage.agent,
        stage_description: currentStage.description,
        total_stages: template.stages.length,
        stages: stagesSummary,
        slot_output: {
          slot_name: slotName,
          value: response,
          owner: currentStage.agent,
          version: (state.slot_history[slotName]?.length || 1) - 1,
        },
        message: `${response}\n\n---\n💬 继续与 [${currentStage.agent}] 对话，或输入 "下一阶段" 推进。`,
        status_panel: buildStatusPanel(state, template, state.current_stage),
      };
    }

    return {
      status: 'initialized',
      mode,
      current_stage: state.current_stage,
      current_stage_name: currentStage.id,
      current_agent: currentStage.agent,
      stage_description: currentStage.description,
      total_stages: template.stages.length,
      stages: stagesSummary,
      message: `项目已启动（${mode === 'relay' ? '接力' : '管道'}模式）！第 ${state.current_stage + 1}/${template.stages.length} 阶段：由 [${currentStage.agent}] 为您服务。请告诉我你的需求。`,
      status_panel: buildStatusPanel(state, template, state.current_stage),
    };
  } catch (err) {
    return {
      status: 'error',
      mode: 'relay',
      current_stage: -1,
      current_stage_name: '错误',
      current_agent: '',
      total_stages: 0,
      stages: [],
      message: `执行出错: ${String(err)}`,
      error: String(err),
    };
  }
}

