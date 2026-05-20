// src/tools/pipeline-continue.ts - 处理用户反馈并继续推进管道

import { homedir } from 'os';
import { join } from 'path';
import { ToolContext, PipelineState, Template } from '../types.js';
import { StateManager } from '../runtime/state-manager.js';
import { WorkspaceConfigManager } from './workspace-config.js';
import { routeMessage } from './route-message.js';
import { executeUntilCheckpoint } from './pipeline-start.js';

// 正确的全局工作区路径
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || join(homedir(), '.openclaw');
const WORKSPACE_ROOT = join(OPENCLAW_HOME, 'workspaces', 'multi-agent-pipeline');

export interface ContinueResult {
  status: 'revised' | 'checkpoint_reached' | 'completed' | 'error';
  action_taken: 'revised_current_stage' | 'proceeded_to_next_stage' | 'completed';
  current_stage: number;
  current_stage_name: string;
  slot_output?: {
    slot_name: string;
    value: string | object;
    owner?: string;
    written_at?: string;
  };
  message: string;
  error?: string;
}

/**
 * pipeline_continue 工具定义
 */
export const pipelineContinueTool = {
  id: 'pipeline_continue',
  name: 'pipeline_continue',
  description: '处理用户反馈并继续推进管道。如果反馈不是"agree"，则路由给当前 Agent 进行修改；如果是"agree"，则推进到下一阶段直到下一个 checkpoint 或完成。',
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
      feedback: {
        type: 'string',
        description: '用户反馈（如"agree"或"改活泼点"）',
      },
    },
    required: ['user_id', 'project_id', 'feedback'],
  },
};

/**
 * pipeline_continue 实现
 */
export async function pipelineContinue(
  userId: string,
  projectId: string,
  feedback: string,
  workspaceRoot: string
): Promise<ContinueResult> {
  try {
    const finalWorkspaceRoot = workspaceRoot || WORKSPACE_ROOT;
    const stateManager = new StateManager(finalWorkspaceRoot, userId, projectId);
    const configManager = new WorkspaceConfigManager(finalWorkspaceRoot);

    // 加载当前状态
    let state: PipelineState;
    try {
      state = await stateManager.load();
    } catch (err) {
      return {
        status: 'error',
        action_taken: 'completed',
        current_stage: -1,
        current_stage_name: '错误',
        message: `❌ 找不到项目状态，请先调用 pipeline_start`,
        error: String(err),
      };
    }

    const template = await configManager.readTemplate(state.template_name);
    const currentStage = template.stages[state.current_stage];

    if (!currentStage) {
      return {
        status: 'error',
        action_taken: 'completed',
        current_stage: state.current_stage,
        current_stage_name: '错误',
        message: `❌ 当前阶段不存在`,
      };
    }

    // 判断反馈类型
    if (feedback.toLowerCase().trim() === 'agree') {
      // 推进到下一阶段
      state.current_stage++;
      await stateManager.save(state);

      // 继续执行直到下一个 checkpoint
      const result = await executeUntilCheckpoint(
        finalWorkspaceRoot,
        userId,
        projectId,
        state.template_name,
        true // 跳过第一个阶段（已推进过了）
      );

      if (result.status === 'checkpoint_reached') {
        return {
          status: 'checkpoint_reached',
          action_taken: 'proceeded_to_next_stage',
          current_stage: result.current_stage,
          current_stage_name: result.current_stage_name,
          slot_output: result.slot_output,
          message: result.message,
        };
      } else if (result.status === 'completed') {
        return {
          status: 'completed',
          action_taken: 'completed',
          current_stage: result.current_stage,
          current_stage_name: result.current_stage_name,
          message: result.message,
        };
      } else {
        return {
          status: 'error',
          action_taken: 'completed',
          current_stage: result.current_stage,
          current_stage_name: result.current_stage_name,
          message: result.message,
          error: result.error,
        };
      }
    } else {
      // 反馈不是 agree，路由给当前 Agent 修改
      const slotName = currentStage.allow_write[0];
      const currentOutput = state.slot_values[slotName];

      // 调用 route_message 让 Agent 修改
      try {
        // 这里调用 route_message 逻辑
        // 实际实现需要调用子 Agent 会话
        // 为了简化，这里模拟 Agent 修改
        const revisedOutput = `${currentOutput}\n\n[已按用户反馈修改: ${feedback}]`;
        state.slot_values[slotName] = revisedOutput;
        await stateManager.save(state);

        return {
          status: 'revised',
          action_taken: 'revised_current_stage',
          current_stage: state.current_stage,
          current_stage_name: currentStage.id,
          slot_output: {
            slot_name: slotName,
            value: revisedOutput,
            owner: currentStage.agent,
            written_at: new Date().toISOString(),
          },
          message: `✅ 已重新提交。请确认修改是否满意，或继续反馈。\n\n---\n${JSON.stringify(revisedOutput, null, 2)}\n---`,
        };
      } catch (err) {
        return {
          status: 'error',
          action_taken: 'completed',
          current_stage: state.current_stage,
          current_stage_name: currentStage.id,
          message: `❌ 修改失败: ${String(err)}`,
          error: String(err),
        };
      }
    }
  } catch (err) {
    return {
      status: 'error',
      action_taken: 'completed',
      current_stage: -1,
      current_stage_name: '错误',
      message: `❌ 执行出错: ${String(err)}`,
      error: String(err),
    };
  }
}
