// src/index.ts - OpenClaw 插件入口
/**
 * 多 Agent 流水线引擎插件
 * 
 * 核心特性:
 * - Slot 所有权：数据由阶段 Agent 独占写入
 * - Remark 追溯：记录每个 Agent 的意见、建议、警告
 * - 双层记忆：短期（会话上下文）+ 长期（profile.json）
 * - 人在回路：Checkpoint 支持用户干预和调整
 */

import { Type } from '@sinclair/typebox';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { homedir } from 'os';
import { join } from 'path';

// 导入工具实现
import { pipelineRead, pipelineWriteSlot, pipelineAddRemark } from './tools/pipeline.js';
import { styleGetProfile, styleRecordFeedback } from './tools/memory.js';
import { workspaceConfig, WorkspaceConfigManager } from './tools/workspace-config.js';
import { agentGuideGenerator } from './tools/agent-guide-generator.js';
import { routeMessage } from './tools/route-message.js';
import { pipelineStart } from './tools/pipeline-start.js';
import { pipelineContinue } from './tools/pipeline-continue.js';

/**
 * 获取工作区根目录
 */
function getWorkspaceRoot(): string {
  const home = process.env.OPENCLAW_HOME || join(homedir(), '.openclaw');
  return join(home, 'workspaces', 'multi-agent-pipeline');
}

/**
 * 获取运行时上下文
 */
function getContext() {
  return {
    agent_name: process.env.OPENCLAW_AGENT_NAME || 'unknown',
    user_id: process.env.OPENCLAW_USER_ID || 'default-user',
    project_id: process.env.OPENCLAW_PROJECT_ID || 'default-project',
    workspace_root: getWorkspaceRoot(),
  };
}

/**
 * 插件入口定义
 */
export default definePluginEntry({
  id: 'multi-agent-pipeline',
  name: '通用多 Agent 流水线引擎',
  description: 'Slot 所有权 + Remark 追溯 + 用户级进化记忆，支持多 Agent 协作流水线',
  
  configSchema: Type.Object({
    workspaceRoot: Type.Optional(Type.String({
      description: 'Pipeline workspace root directory (defaults to ~/.openclaw/workspaces/multi-agent-pipeline)'
    })),
  }),

  register(api) {
    // 注册 pipeline_read 工具
    api.registerTool({
      name: 'pipeline_read',
      description: '读取管道中当前阶段允许的 Slot 内容。当前 Agent 只能读取授权给自己的 slot。',
      parameters: Type.Object({
        slot_name: Type.String({ description: '要读取的 Slot 名称' }),
      }),
      async execute(_id, params) {
        try {
          const context = getContext();
          const configManager = new WorkspaceConfigManager(context.workspace_root);
          const stateManagerModule = await import('./runtime/state-manager.js');
          const stateManager = new stateManagerModule.StateManager(
            context.workspace_root,
            context.user_id,
            context.project_id
          );
          const pipelineState = await stateManager.load();
          const template = await configManager.readTemplate(pipelineState.template_name);
          const result = await pipelineRead(context, params.slot_name, template);
          
          return {
            content: [{
              type: 'text' as const,
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }]
          };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `错误: ${err instanceof Error ? err.message : String(err)}`
            }],
            isError: true
          };
        }
      },
    });

    // 注册 pipeline_write_slot 工具
    api.registerTool({
      name: 'pipeline_write_slot',
      description: '写入 Slot 内容。当前 Agent 只能写入授权给自己的 slot。',
      parameters: Type.Object({
        slot_name: Type.String({ description: '要写入的 Slot 名称' }),
        content: Type.String({ description: '要写入的内容' }),
      }),
      async execute(_id, params) {
        try {
          const context = getContext();
          const configManager = new WorkspaceConfigManager(context.workspace_root);
          const stateManagerModule = await import('./runtime/state-manager.js');
          const stateManager = new stateManagerModule.StateManager(
            context.workspace_root,
            context.user_id,
            context.project_id
          );
          const pipelineState = await stateManager.load();
          const template = await configManager.readTemplate(pipelineState.template_name);
          await pipelineWriteSlot(context, params.slot_name, params.content, template);
          
          return {
            content: [{
              type: 'text' as const,
              text: '✅ 写入成功'
            }]
          };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `错误: ${err instanceof Error ? err.message : String(err)}`
            }],
            isError: true
          };
        }
      },
    });

    // 注册 pipeline_add_remark 工具
    api.registerTool({
      name: 'pipeline_add_remark',
      description: '为管道添加批注或建议',
      parameters: Type.Object({
        content: Type.String({ description: '批注内容' }),
      }),
      async execute(_id, params) {
        try {
          const context = getContext();
          await pipelineAddRemark(context, params.content);
          
          return {
            content: [{
              type: 'text' as const,
              text: '✅ 批注已添加'
            }]
          };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `错误: ${err instanceof Error ? err.message : String(err)}`
            }],
            isError: true
          };
        }
      },
    });

    // 注册 style_get_profile 工具
    api.registerTool({
      name: 'style_get_profile',
      description: '获取当前 Agent 对当前用户的长期记忆偏好',
      parameters: Type.Object({}),
      async execute() {
        try {
          const context = getContext();
          const result = await styleGetProfile(context);
          
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `错误: ${err instanceof Error ? err.message : String(err)}`
            }],
            isError: true
          };
        }
      },
    });

    // 注册 style_record_feedback 工具
    api.registerTool({
      name: 'style_record_feedback',
      description: '更新当前 Agent 对当前用户的长期记忆偏好',
      parameters: Type.Object({
        preference_updates: Type.Record(Type.String(), Type.Unknown(), {
          description: '偏好更新内容，可包含 style, avoid, feedback_log 等'
        }),
      }),
      async execute(_id, params) {
        try {
          const context = getContext();
          await styleRecordFeedback(context, params.preference_updates);
          
          return {
            content: [{
              type: 'text' as const,
              text: '✅ 记忆已更新'
            }]
          };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `错误: ${err instanceof Error ? err.message : String(err)}`
            }],
            isError: true
          };
        }
      },
    });

    // 注册 route_message 工具
    api.registerTool({
      name: 'route_message',
      description: '将消息路由给指定的专业 Agent，实现直接对话（仅限 orchestrator 使用）',
      parameters: Type.Object({
        target_agent: Type.String({ description: '目标 Agent 名称' }),
        message: Type.String({ description: '要发送的消息' }),
      }),
      async execute(_id, params) {
        try {
          const context = getContext();
          const result = await routeMessage(context, params.target_agent, params.message);
          
          return {
            content: [{
              type: 'text' as const,
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }]
          };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `错误: ${err instanceof Error ? err.message : String(err)}`
            }],
            isError: true
          };
        }
      },
    });

    // 注册 workspace_config 工具
    api.registerTool({
      name: 'workspace_config',
      description: '读取或修改管道模板和用户记忆文件',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('list_templates'),
          Type.Literal('read_template'),
          Type.Literal('write_template'),
          Type.Literal('read_memory'),
          Type.Literal('write_memory'),
        ], { description: '操作类型' }),
        template_name: Type.Optional(Type.String({ description: '模板名称' })),
        agent_name: Type.Optional(Type.String({ description: 'Agent 名称' })),
        content: Type.Optional(Type.String({ description: '内容' })),
      }),
      async execute(_id, params) {
        try {
          const context = getContext();
          const payload = params.action === 'read_memory' || params.action === 'write_memory'
            ? { ...params, user_id: context.user_id }
            : params;
          const result = await workspaceConfig(getWorkspaceRoot(), params.action, payload);
          
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `错误: ${err instanceof Error ? err.message : String(err)}`
            }],
            isError: true
          };
        }
      },
    });

    // 注册 agent_guide_generator 工具
    api.registerTool({
      name: 'agent_guide_generator',
      description: '为指定 Agent 生成或更新管道协作指南',
      parameters: Type.Object({
        agent_name: Type.String({ description: 'Agent 名称' }),
        instructions: Type.String({ description: '指令内容' }),
        append: Type.Optional(Type.Boolean({
          description: '是否追加模式（默认 false，覆盖模式）',
          default: false
        })),
      }),
      async execute(_id, params) {
        try {
          await agentGuideGenerator(
            getWorkspaceRoot(),
            params.agent_name,
            params.instructions,
            params.append ?? false
          );
          
          return {
            content: [{
              type: 'text' as const,
              text: '✅ 指南已更新'
            }]
          };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `错误: ${err instanceof Error ? err.message : String(err)}`
            }],
            isError: true
          };
        }
      },
    });

    // 注册 pipeline_start 工具
    api.registerTool({
      name: 'pipeline_start',
      description: '启动一个多 Agent 管道项目，执行到第一个 checkpoint 阶段后暂停',
      parameters: Type.Object({
        template_name: Type.String({ description: '管道模板名称（如 xiaohongshu-creation）' }),
        user_id: Type.String({ description: '用户 ID（如 alice）' }),
        project_id: Type.String({ description: '项目 ID（如 camping-post）' }),
      }),
      async execute(_id, params) {
        try {
          const result = await pipelineStart(
            params.template_name,
            params.user_id,
            params.project_id,
            getWorkspaceRoot()
          );
          
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `错误: ${err instanceof Error ? err.message : String(err)}`
            }],
            isError: true
          };
        }
      },
    });

    // 注册 pipeline_continue 工具
    api.registerTool({
      name: 'pipeline_continue',
      description: '继续管道执行：agree 推进到下一阶段，或输入修改意见',
      parameters: Type.Object({
        user_id: Type.String({ description: '用户 ID' }),
        project_id: Type.String({ description: '项目 ID' }),
        feedback: Type.String({ description: '用户反馈（输入"agree"继续，或提供修改意见）' }),
      }),
      async execute(_id, params) {
        try {
          const result = await pipelineContinue(
            params.user_id,
            params.project_id,
            params.feedback,
            getWorkspaceRoot()
          );
          
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: `错误: ${err instanceof Error ? err.message : String(err)}`
            }],
            isError: true
          };
        }
      },
    });
  },
});

// 导出公共 API（供外部使用）
export { PipelineRunner } from './runtime/pipeline-runner.js';
export { StateManager } from './runtime/state-manager.js';
export { PromptBuilder } from './runtime/prompt-builder.js';
export { SkillRunner } from './runtime/skill-runner.js';
export { ToolAuth } from './tools/tool-auth.js';
export { MemoryManager } from './tools/memory.js';
export { WorkspaceConfigManager } from './tools/workspace-config.js';
export { AgentGuideGenerator } from './tools/agent-guide-generator.js';
export type { ToolContext, Template, PipelineState, PipelineStage } from './types.js';
