// src/index.ts - OpenClaw 插件入口

import { ToolContext, Template } from './types.js';
import { pipelineRead, pipelineWriteSlot, pipelineAddRemark, pipelineTools } from './tools/pipeline.js';
import { styleGetProfile, styleRecordFeedback, memoryTools } from './tools/memory.js';
import { workspaceConfig, workspaceConfigTool } from './tools/workspace-config.js';
import { agentGuideGenerator, agentGuideTool } from './tools/agent-guide-generator.js';
import { routeMessage, routeMessageTool } from './tools/route-message.js';
import { WorkspaceConfigManager } from './tools/workspace-config.js';

// 获取工作区根目录（从环境或默认位置）
function getWorkspaceRoot(): string {
  return process.env.PIPELINE_WORKSPACE_ROOT || 
    `${process.env.HOME || process.env.USERPROFILE}/.openclaw/workspaces/multi-agent-pipeline`;
}

// 获取工具上下文（从 OpenClaw 运行时传入）
function getContext(): ToolContext {
  return {
    agent_name: process.env.AGENT_NAME || 'unknown',
    user_id: process.env.USER_ID || 'default-user',
    project_id: process.env.PROJECT_ID || 'default-project',
    workspace_root: getWorkspaceRoot(),
  };
}

// OpenClaw 工具导出
export const tools = {
  // 管道工具
  pipeline_read: {
    ...pipelineTools.pipeline_read,
    handler: async (params: Record<string, any>) => {
      try {
        const context = getContext();
        const configManager = new WorkspaceConfigManager(context.workspace_root);
        const state = (await import('./runtime/state-manager.js')).StateManager;
        const stateManager = new state(context.workspace_root, context.user_id, context.project_id);
        const pipelineState = await stateManager.load();
        const template = await configManager.readTemplate(pipelineState.template_name);

        const result = await pipelineRead(context, params.slot_name, template);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },

  pipeline_write_slot: {
    ...pipelineTools.pipeline_write_slot,
    handler: async (params: Record<string, any>) => {
      try {
        const context = getContext();
        const configManager = new WorkspaceConfigManager(context.workspace_root);
        const state = (await import('./runtime/state-manager.js')).StateManager;
        const stateManager = new state(context.workspace_root, context.user_id, context.project_id);
        const pipelineState = await stateManager.load();
        const template = await configManager.readTemplate(pipelineState.template_name);

        await pipelineWriteSlot(context, params.slot_name, params.content, template);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },

  pipeline_add_remark: {
    ...pipelineTools.pipeline_add_remark,
    handler: async (params: Record<string, any>) => {
      try {
        const context = getContext();
        await pipelineAddRemark(context, params.content);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },

  // 记忆工具
  style_get_profile: {
    ...memoryTools.style_get_profile,
    handler: async () => {
      try {
        const context = getContext();
        const result = await styleGetProfile(context);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },

  style_record_feedback: {
    ...memoryTools.style_record_feedback,
    handler: async (params: Record<string, any>) => {
      try {
        const context = getContext();
        await styleRecordFeedback(context, params.preference_updates);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },

  // 工作区配置工具
  workspace_config: {
    ...workspaceConfigTool.workspace_config,
    handler: async (params: Record<string, any>) => {
      try {
        const context = getContext();
        const result = await workspaceConfig(
          context.workspace_root,
          params.action,
          params
        );
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },

  // Agent 指南生成工具
  agent_guide_generator: {
    ...agentGuideTool.agent_guide_generator,
    handler: async (params: Record<string, any>) => {
      try {
        const context = getContext();
        await agentGuideGenerator(
          context.workspace_root,
          params.agent_name,
          params.instructions,
          params.append || false
        );
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },

  // 路由工具
  route_message: {
    ...routeMessageTool.route_message,
    handler: async (params: Record<string, any>) => {
      try {
        const context = getContext();
        const result = await routeMessage(
          context,
          params.target_agent,
          params.message
        );
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },
};

// 导出所有公共 API
export { PipelineRunner } from './runtime/pipeline-runner.js';
export { StateManager } from './runtime/state-manager.js';
export { PromptBuilder } from './runtime/prompt-builder.js';
export { SkillRunner } from './runtime/skill-runner.js';
export { ToolAuth } from './tools/tool-auth.js';
export { MemoryManager } from './tools/memory.js';
export { WorkspaceConfigManager } from './tools/workspace-config.js';
export { AgentGuideGenerator } from './tools/agent-guide-generator.js';
export type { ToolContext, Template, PipelineState, PipelineStage } from './types.js';
