// src/tools/pipeline-start.ts - 启动管道并执行到第一个 checkpoint

import { join } from 'path';
import { ToolContext, Template, PipelineState } from '../types.js';
import { StateManager } from '../runtime/state-manager.js';
import { WorkspaceConfigManager } from './workspace-config.js';
import { MemoryManager } from './memory.js';
import { PromptBuilder } from '../runtime/prompt-builder.js';

// workspace_root 由调用方传入，不再从 process.env 读取
const DEFAULT_WORKSPACE_ROOT = join('.openclaw', 'workspaces', 'multi-agent-pipeline');

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
  skipFirstStage = false
): Promise<CheckpointResult> {
  try {
    const stateManager = new StateManager(workspaceRoot, userId, projectId);
    const configManager = new WorkspaceConfigManager(workspaceRoot);
    const memoryManager = new MemoryManager(workspaceRoot, userId, '');
    const promptBuilder = new PromptBuilder(workspaceRoot, userId, projectId);

    // 加载模板
    let template: Template;
    let state: PipelineState;

    // 如果是第一次调用，初始化 state
    const stateExists = await stateExists_check(stateManager);
    if (!stateExists) {
      template = await configManager.readTemplate(templateName);
      state = await stateManager.initialize(template);
    } else {
      state = await stateManager.load();
      template = await configManager.readTemplate(state.template_name);
    }

    let startStage = skipFirstStage ? state.current_stage + 1 : state.current_stage;

    // 循环执行阶段直到 checkpoint
    while (startStage < template.stages.length && state.status === 'running') {
      const stage = template.stages[startStage];

      // TODO: 这里应该调用真实的 Agent 执行
      // 目前模拟 Agent 执行并更新 slot
      const demoOutput = `[Agent ${stage.agent} 执行结果] 模拟产出 for ${stage.allow_write[0] || 'output'}`;
      
      if (stage.allow_write.length > 0) {
        const slotName = stage.allow_write[0];
        state.slot_values[slotName] = demoOutput;
      }

      state.current_stage = startStage;
      await stateManager.save(state);

      // 如果是 checkpoint，立即暂停
      if (stage.checkpoint) {
        const slotName = stage.allow_write[0];
        const slotValue = state.slot_values[slotName];

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
          message: `✅ 已完成：${stage.id} 阶段\n\n内容已写入 ${slotName}，请检查：\n---\n${JSON.stringify(slotValue, null, 2)}\n---\n\n输入"agree"继续，或直接说修改意见。`,
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
  workspaceRoot: string
): Promise<CheckpointResult> {
  return executeUntilCheckpoint(workspaceRoot || DEFAULT_WORKSPACE_ROOT, userId, projectId, templateName, false);
}
