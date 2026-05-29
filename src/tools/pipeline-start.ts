// src/tools/pipeline-start.ts - 启动管道并执行到第一个 checkpoint

import { ToolContext, Template, PipelineState, callSubagent } from '../types.js';
import { StateManager } from '../runtime/state-manager.js';
import { WorkspaceConfigManager } from './workspace-config.js';
import { initWorkspace } from './workspace-config.js';
import { MemoryManager } from './memory.js';
import { PromptBuilder } from '../runtime/prompt-builder.js';
import { WORKSPACE_ROOT } from '../config.js';

export interface CheckpointResult {
  status: 'checkpoint_reached' | 'completed' | 'error';
  current_stage: number;
  current_stage_name: string;
  checkpoint: boolean;
  slot_output?: {
    slot_name: string;
    value: string | object;
    owner?: string;
    written_at?: string;
  };
  previous_remarks?: any[];
  message: string;
  error?: string;
}

/**
 * 执行管道直到遇到 checkpoint 或完成
 */
export async function executeUntilCheckpoint(
  workspaceRoot: string,
  userId: string,
  projectId: string,
  templateName: string,
  skipFirstStage = false,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<CheckpointResult> {
  try {
    const stateManager = new StateManager(workspaceRoot, userId, projectId);
    const configManager = new WorkspaceConfigManager(workspaceRoot);
    const promptBuilder = new PromptBuilder(workspaceRoot, userId, projectId);

    // 加载模板
    let template: Template;
    let state: PipelineState;

    // 如果是第一次调用，初始化 state
    const stateExists = await stateExists_check(stateManager);
    if (!stateExists) {
      template = await loadTemplateWithAutoInit(configManager, workspaceRoot, templateName);
      state = await stateManager.initialize(template);
    } else {
      state = await stateManager.load();
      template = await loadTemplateWithAutoInit(configManager, workspaceRoot, state.template_name);
    }

    let startStage = skipFirstStage ? state.current_stage + 1 : state.current_stage;

    // 循环执行阶段直到 checkpoint
    while (startStage < template.stages.length && state.status === 'running') {
      const stage = template.stages[startStage];

      // 构建 Agent Prompt
      const stageMemory = new MemoryManager(workspaceRoot, userId, stage.agent);
      const profile = await stageMemory.getProfile();
      const prompt = await promptBuilder.buildPipelinePrompt(stage.agent, template, state, profile);

      // 调用真实 Agent（复合 sessionKey 隔离项目会话）
      let agentOutput = '';
      try {
        const sessionKey = `${stage.agent}:${userId}:${projectId}`;
        const result = await callSubagent(api, sessionKey, prompt);
        agentOutput = result || `[Agent ${stage.agent} 执行结果] 模拟产出 for ${stage.allow_write[0] || 'output'}`;
      } catch (err) {
        agentOutput = `[Agent ${stage.agent} 执行出错] ${String(err)}`;
      }
      
      if (stage.allow_write.length > 0) {
        const slotName = stage.allow_write[0];
        state.slot_values[slotName] = agentOutput;
      }

      state.current_stage = startStage;
      await stateManager.save(state);

      // 如果是 checkpoint，立即暂停
      if (stage.checkpoint) {
        const slotName = stage.allow_write[0];
        const slotValue = state.slot_values[slotName];

        const contentText = typeof slotValue === 'string' ? slotValue : JSON.stringify(slotValue, null, 2);
        return {
          status: 'checkpoint_reached',
          current_stage: startStage,
          current_stage_name: stage.id,
          checkpoint: true,
          slot_output: {
            slot_name: slotName,
            value: slotValue,
            owner: stage.agent,
            written_at: new Date().toISOString(),
          },
          message: `${contentText}\n\n---\n输入"agree"继续，或直接说修改意见。`,
        };
      }

      // 否则推进到下一阶段
      startStage++;
    }

    // 所有阶段完成
    state.status = 'completed';
    await stateManager.save(state);

    return {
      status: 'completed',
      current_stage: state.current_stage,
      current_stage_name: '完成',
      checkpoint: false,
      message: '✨ 管道已完成所有阶段！',
    };
  } catch (err) {
    return {
      status: 'error',
      current_stage: -1,
      current_stage_name: '错误',
      checkpoint: false,
      message: `❌ 执行出错: ${String(err)}`,
      error: String(err),
    };
  }
}

/**
 * 加载模板，如果不存在则自动初始化工作区并重试
 */
async function loadTemplateWithAutoInit(
  configManager: WorkspaceConfigManager,
  workspaceRoot: string,
  templateName: string
): Promise<Template> {
  try {
    return await configManager.readTemplate(templateName);
  } catch {
    await initWorkspace(workspaceRoot);
    return await configManager.readTemplate(templateName);
  }
}

/**
 * 检查 state.json 是否已存在
 */
async function stateExists_check(stateManager: StateManager): Promise<boolean> {
  try {
    await stateManager.load();
    return true;
  } catch {
    return false;
  }
}

/**
 * pipeline_start 工具定义
 */
export const pipelineStartTool = {
  id: 'pipeline_start',
  name: 'pipeline_start',
  description: '启动管道项目，初始化状态文件，并执行所有非 checkpoint 阶段直到遇到第一个 checkpoint 或完成。返回当前产出给用户确认。',
  parameters: {
    type: 'object',
    properties: {
      template_name: {
        type: 'string',
        description: '模板名称（如 xiaohongshu-creation）',
      },
      user_id: {
        type: 'string',
        description: '用户 ID（如 alice）',
      },
      project_id: {
        type: 'string',
        description: '项目 ID（如 camping-post）',
      },
    },
    required: ['template_name', 'user_id', 'project_id'],
  },
};

/**
 * pipeline_start 实现
 */
export async function pipelineStart(
  templateName: string,
  userId: string,
  projectId: string,
  workspaceRoot: string,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<CheckpointResult> {
  if (!templateName) {
    return {
      status: 'error',
      current_stage: -1,
      current_stage_name: '错误',
      checkpoint: false,
      message: '缺少必要参数 template_name，请指定模板名称（如 xiaohongshu-creation）。可用 workspace_config list_templates 查看所有模板。',
      error: 'template_name is required but was not provided',
    };
  }
  if (!userId) {
    return {
      status: 'error',
      current_stage: -1,
      current_stage_name: '错误',
      checkpoint: false,
      message: '缺少必要参数 user_id',
      error: 'user_id is required',
    };
  }
  if (!projectId) {
    return {
      status: 'error',
      current_stage: -1,
      current_stage_name: '错误',
      checkpoint: false,
      message: '缺少必要参数 project_id',
      error: 'project_id is required',
    };
  }
  return executeUntilCheckpoint(workspaceRoot || WORKSPACE_ROOT, userId, projectId, templateName, false, api);
}
