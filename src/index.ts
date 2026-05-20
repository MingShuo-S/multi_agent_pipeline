// src/index.ts - OpenClaw 插件入口
import { homedir } from 'os';
import { join } from 'path';
import { pipelineRead, pipelineWriteSlot, pipelineAddRemark } from './tools/pipeline.js';
import { styleGetProfile, styleRecordFeedback } from './tools/memory.js';
import { workspaceConfig } from './tools/workspace-config.js';
import { agentGuideGenerator } from './tools/agent-guide-generator.js';
import { routeMessage } from './tools/route-message.js';
import { pipelineStart } from './tools/pipeline-start.js';
import { pipelineContinue } from './tools/pipeline-continue.js';
import { WorkspaceConfigManager } from './tools/workspace-config.js';

// 全局工作区路径
function getWorkspaceRoot(): string {
  const home = process.env.OPENCLAW_HOME || join(homedir(), '.openclaw');
  return join(home, 'workspaces', 'multi-agent-pipeline');
}

function getContext() {
  return {
    agent_name: process.env.AGENT_NAME || 'unknown',
    user_id: process.env.USER_ID || 'default-user',
    project_id: process.env.PROJECT_ID || 'default-project',
    workspace_root: getWorkspaceRoot(),
  };
}

// 工具定义和处理器集合
const tools = {
  pipeline_read: {
    id: 'pipeline_read',
    name: 'pipeline_read',
    description: '读取管道 Slot 内容。当前 Agent 只能读取授权给自己的 slot。',
    parameters: {
      type: 'object',
      properties: {
        slot_name: { type: 'string', description: '要读取的 Slot 名称' },
      },
      required: ['slot_name'],
    },
    handler: async (params: any) => {
      try {
        const context = getContext();
        const configManager = new WorkspaceConfigManager(context.workspace_root);
        const StateManager = (await import('./runtime/state-manager.js')).StateManager;
        const stateManager = new StateManager(context.workspace_root, context.user_id, context.project_id);
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
    id: 'pipeline_write_slot',
    name: 'pipeline_write_slot',
    description: '写入管道 Slot 内容。当前 Agent 只能写入授权给自己的 slot。',
    parameters: {
      type: 'object',
      properties: {
        slot_name: { type: 'string', description: '要写入的 Slot 名称' },
        content: { type: 'string', description: '要写入的内容' },
      },
      required: ['slot_name', 'content'],
    },
    handler: async (params: any) => {
      try {
        const context = getContext();
        const configManager = new WorkspaceConfigManager(context.workspace_root);
        const StateManager = (await import('./runtime/state-manager.js')).StateManager;
        const stateManager = new StateManager(context.workspace_root, context.user_id, context.project_id);
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
    id: 'pipeline_add_remark',
    name: 'pipeline_add_remark',
    description: '为管道添加批注或建议',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '批注内容' },
      },
      required: ['content'],
    },
    handler: async (params: any) => {
      try {
        const context = getContext();
        await pipelineAddRemark(context, params.content);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },

  style_get_profile: {
    id: 'style_get_profile',
    name: 'style_get_profile',
    description: '获取当前 Agent 对当前用户的长期记忆偏好',
    parameters: { type: 'object', properties: {} },
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
    id: 'style_record_feedback',
    name: 'style_record_feedback',
    description: '更新当前 Agent 对当前用户的长期记忆偏好',
    parameters: {
      type: 'object',
      properties: {
        preference_updates: { type: 'object', description: '偏好更新' },
      },
      required: ['preference_updates'],
    },
    handler: async (params: any) => {
      try {
        const context = getContext();
        await styleRecordFeedback(context, params.preference_updates);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },

  route_message: {
    id: 'route_message',
    name: 'route_message',
    description: '将消息路由给指定的专业 Agent，实现直接对话',
    parameters: {
      type: 'object',
      properties: {
        target_agent: { type: 'string', description: '目标 Agent 名称' },
        message: { type: 'string', description: '要发送的消息' },
      },
      required: ['target_agent', 'message'],
    },
    handler: async (params: any) => {
      try {
        const context = getContext();
        const result = await routeMessage(context, params.target_agent, params.message);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },

  workspace_config: {
    id: 'workspace_config',
    name: 'workspace_config',
    description: '读取或修改管道模板和用户记忆文件',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list_templates', 'read_template', 'write_template', 'read_memory', 'write_memory'] },
        template_name: { type: 'string' },
        agent_name: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['action'],
    },
    handler: async (params: any) => {
      try {
        const result = await workspaceConfig(getWorkspaceRoot(), params.action, params);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },

  agent_guide_generator: {
    id: 'agent_guide_generator',
    name: 'agent_guide_generator',
    description: '为指定 Agent 生成或更新管道协作指南',
    parameters: {
      type: 'object',
      properties: {
        agent_name: { type: 'string' },
        instructions: { type: 'string' },
        append: { type: 'boolean', default: false },
      },
      required: ['agent_name', 'instructions'],
    },
    handler: async (params: any) => {
      try {
        await agentGuideGenerator(getWorkspaceRoot(), params.agent_name, params.instructions, params.append || false);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },

  pipeline_start: {
    id: 'pipeline_start',
    name: 'pipeline_start',
    description: '启动一个多 Agent 管道项目，执行到第一个 checkpoint 阶段后暂停',
    parameters: {
      type: 'object',
      properties: {
        template_name: { type: 'string', description: '管道模板名称' },
        user_id: { type: 'string', description: '用户 ID' },
        project_id: { type: 'string', description: '项目 ID' },
      },
      required: ['template_name', 'user_id', 'project_id'],
    },
    handler: async (params: any) => {
      try {
        const result = await pipelineStart(params.template_name, params.user_id, params.project_id, getWorkspaceRoot());
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },

  pipeline_continue: {
    id: 'pipeline_continue',
    name: 'pipeline_continue',
    description: '继续管道执行：agree 推进到下一阶段，或输入修改意见',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: '用户 ID' },
        project_id: { type: 'string', description: '项目 ID' },
        feedback: { type: 'string', description: '用户反馈' },
      },
      required: ['user_id', 'project_id', 'feedback'],
    },
    handler: async (params: any) => {
      try {
        const result = await pipelineContinue(params.user_id, params.project_id, params.feedback, getWorkspaceRoot());
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  },
};

// 导出 tools 供 OpenClaw 使用
export { tools };

// 导出公共 API
export { PipelineRunner } from './runtime/pipeline-runner.js';
export { StateManager } from './runtime/state-manager.js';
export { PromptBuilder } from './runtime/prompt-builder.js';
export { SkillRunner } from './runtime/skill-runner.js';
export { ToolAuth } from './tools/tool-auth.js';
export { MemoryManager } from './tools/memory.js';
export { WorkspaceConfigManager } from './tools/workspace-config.js';
export { AgentGuideGenerator } from './tools/agent-guide-generator.js';
export type { ToolContext, Template, PipelineState, PipelineStage } from './types.js';
