import { Type } from '@sinclair/typebox';
import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
import { homedir } from 'os';
import { join } from 'path';

import { pipelineRead, pipelineWriteSlot, pipelineAddRemark } from './tools/pipeline.js';
import { styleGetProfile, styleRecordFeedback } from './tools/memory.js';
import { workspaceConfig, WorkspaceConfigManager } from './tools/workspace-config.js';
import { agentGuideGenerator } from './tools/agent-guide-generator.js';
import { routeMessage } from './tools/route-message.js';
import { pipelineStart } from './tools/pipeline-start.js';
import { pipelineContinue } from './tools/pipeline-continue.js';

const WS = join(homedir(), '.openclaw', 'workspaces', 'multi-agent-pipeline');

const wsParam = Type.Optional(Type.String({ description: '工作区根目录' }));

export default defineToolPlugin({
  id: 'multi-agent-pipeline',
  name: '通用多 Agent 流水线引擎',
  description: 'Slot 所有权 + Remark 追溯 + 用户级进化记忆，支持多 Agent 协作流水线',

  tools: (tool) => [
    tool({
      name: 'pipeline_read',
      label: 'pipeline_read',
      description: '读取管道中当前阶段允许的 Slot 内容。当前 Agent 只能读取授权给自己的 slot。',
      parameters: Type.Object({
        slot_name: Type.String({ description: '要读取的 Slot 名称' }),
        workspace_root: wsParam,
      }),
      async execute(params, _config, _context) {
        try {
          const wsRoot = (params as any).workspace_root || WS;
          const configManager = new WorkspaceConfigManager(wsRoot);
          const { StateManager } = await import('./runtime/state-manager.js');
          const stateManager = new StateManager(wsRoot, 'default-user', 'default-project');
          const pipelineState = await stateManager.load();
          const template = await configManager.readTemplate(pipelineState.template_name);
          const result = await pipelineRead(
            { agent_name: 'unknown', user_id: 'default-user', project_id: 'default-project', workspace_root: wsRoot },
            (params as any).slot_name,
            template
          );
          return typeof result === 'string' ? result : result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'pipeline_write_slot',
      label: 'pipeline_write_slot',
      description: '写入 Slot 内容。当前 Agent 只能写入授权给自己的 slot。',
      parameters: Type.Object({
        slot_name: Type.String({ description: '要写入的 Slot 名称' }),
        content: Type.String({ description: '要写入的内容' }),
        workspace_root: wsParam,
      }),
      async execute(params, _config, _context) {
        try {
          const wsRoot = (params as any).workspace_root || WS;
          const configManager = new WorkspaceConfigManager(wsRoot);
          const { StateManager } = await import('./runtime/state-manager.js');
          const stateManager = new StateManager(wsRoot, 'default-user', 'default-project');
          const pipelineState = await stateManager.load();
          const template = await configManager.readTemplate(pipelineState.template_name);
          await pipelineWriteSlot(
            { agent_name: 'unknown', user_id: 'default-user', project_id: 'default-project', workspace_root: wsRoot },
            (params as any).slot_name,
            (params as any).content,
            template
          );
          return '✅ 写入成功';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'pipeline_add_remark',
      label: 'pipeline_add_remark',
      description: '为管道添加批注或建议',
      parameters: Type.Object({
        content: Type.String({ description: '批注内容' }),
        workspace_root: wsParam,
      }),
      async execute(params, _config, _context) {
        try {
          const wsRoot = (params as any).workspace_root || WS;
          await pipelineAddRemark(
            { agent_name: 'unknown', user_id: 'default-user', project_id: 'default-project', workspace_root: wsRoot },
            (params as any).content
          );
          return '✅ 批注已添加';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'style_get_profile',
      label: 'style_get_profile',
      description: '获取当前 Agent 对当前用户的长期记忆偏好',
      parameters: Type.Object({
        workspace_root: wsParam,
      }),
      async execute(params, _config, _context) {
        try {
          const wsRoot = (params as any).workspace_root || WS;
          const result = await styleGetProfile(
            { agent_name: 'unknown', user_id: 'default-user', project_id: 'default-project', workspace_root: wsRoot }
          );
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'style_record_feedback',
      label: 'style_record_feedback',
      description: '更新当前 Agent 对当前用户的长期记忆偏好',
      parameters: Type.Object({
        preference_updates: Type.Record(Type.String(), Type.Unknown(), {
          description: '偏好更新内容，可包含 style, avoid, feedback_log 等'
        }),
        workspace_root: wsParam,
      }),
      async execute(params, _config, _context) {
        try {
          const wsRoot = (params as any).workspace_root || WS;
          await styleRecordFeedback(
            { agent_name: 'unknown', user_id: 'default-user', project_id: 'default-project', workspace_root: wsRoot },
            (params as any).preference_updates
          );
          return '✅ 记忆已更新';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'route_message',
      label: 'route_message',
      description: '将消息路由给指定的专业 Agent，实现直接对话（仅限 orchestrator 使用）',
      parameters: Type.Object({
        target_agent: Type.String({ description: '目标 Agent 名称' }),
        message: Type.String({ description: '要发送的消息' }),
        workspace_root: wsParam,
      }),
      async execute(params, _config, _context) {
        try {
          const wsRoot = (params as any).workspace_root || WS;
          const result = await routeMessage(
            { agent_name: 'unknown', user_id: 'default-user', project_id: 'default-project', workspace_root: wsRoot, api: _context.api },
            (params as any).target_agent,
            (params as any).message,
            _context.api
          );
          return typeof result === 'string' ? result : result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'workspace_config',
      label: 'workspace_config',
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
        workspace_root: wsParam,
      }),
      async execute(params, _config, _context) {
        try {
          const p = params as any;
          const wsRoot = p.workspace_root || WS;
          const payload = p.action === 'read_memory' || p.action === 'write_memory'
            ? { ...p, user_id: 'default-user' }
            : p;
          const result = await workspaceConfig(wsRoot, p.action, payload);
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'agent_guide_generator',
      label: 'agent_guide_generator',
      description: '为指定 Agent 生成或更新管道协作指南',
      parameters: Type.Object({
        agent_name: Type.String({ description: 'Agent 名称' }),
        instructions: Type.String({ description: '指令内容' }),
        append: Type.Optional(Type.Boolean({
          description: '是否追加模式（默认 false，覆盖模式）',
          default: false
        })),
        workspace_root: wsParam,
      }),
      async execute(params, _config, _context) {
        try {
          const p = params as any;
          await agentGuideGenerator(
            p.workspace_root || WS,
            p.agent_name,
            p.instructions,
            p.append ?? false
          );
          return '✅ 指南已更新';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'pipeline_start',
      label: 'pipeline_start',
      description: '启动一个多 Agent 管道项目，执行到第一个 checkpoint 阶段后暂停',
      parameters: Type.Object({
        template_name: Type.String({ description: '管道模板名称（如 xiaohongshu-creation）' }),
        user_id: Type.String({ description: '用户 ID（如 alice）' }),
        project_id: Type.String({ description: '项目 ID（如 camping-post）' }),
        workspace_root: wsParam,
      }),
      async execute(params, _config, _context) {
        try {
          const p = params as any;
          const result = await pipelineStart(
            p.template_name,
            p.user_id,
            p.project_id,
            p.workspace_root || WS,
            _context.api
          );
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'pipeline_continue',
      label: 'pipeline_continue',
      description: '继续管道执行：agree 推进到下一阶段，或输入修改意见',
      parameters: Type.Object({
        user_id: Type.String({ description: '用户 ID' }),
        project_id: Type.String({ description: '项目 ID' }),
        feedback: Type.String({ description: '用户反馈（输入"agree"继续，或提供修改意见）' }),
        workspace_root: wsParam,
      }),
      async execute(params, _config, _context) {
        try {
          const p = params as any;
          const result = await pipelineContinue(
            p.user_id,
            p.project_id,
            p.feedback,
            p.workspace_root || WS,
            _context.api
          );
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),
  ],
});

export { PipelineRunner } from './runtime/pipeline-runner.js';
export { StateManager } from './runtime/state-manager.js';
export { PromptBuilder } from './runtime/prompt-builder.js';
export { SkillRunner } from './runtime/skill-runner.js';
export { ToolAuth } from './tools/tool-auth.js';
export { MemoryManager } from './tools/memory.js';
export { WorkspaceConfigManager } from './tools/workspace-config.js';
export { AgentGuideGenerator } from './tools/agent-guide-generator.js';
export type { ToolContext, Template, PipelineState, PipelineStage } from './types.js';
