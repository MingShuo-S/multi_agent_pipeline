import { Type } from '@sinclair/typebox';
import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';

import { pipelineRead, pipelineWriteSlot, pipelineAddRemark } from './tools/pipeline.js';
import { styleGetProfile, styleRecordFeedback } from './tools/memory.js';
import { workspaceConfig, WorkspaceConfigManager } from './tools/workspace-config.js';
import { agentGuideGenerator } from './tools/agent-guide-generator.js';
import { routeMessage } from './tools/route-message.js';
import { pipelineStart } from './tools/pipeline-start.js';
import { pipelineContinue } from './tools/pipeline-continue.js';
import { StateManager } from './runtime/state-manager.js';
import { WORKSPACE_ROOT } from './config.js';
import type { ToolContext } from './types.js';

const wsParam = Type.Optional(Type.String({ description: '工作区根目录' }));

function pickWs(p: any): string {
  return (p as any)?.workspace_root || WORKSPACE_ROOT;
}

async function resolveStateContext(wsRoot: string): Promise<{ userId: string; projectId: string; templateName: string }> {
  const active = await StateManager.findActiveState(wsRoot);
  if (!active) {
    throw new Error('没有找到活跃的管道项目，请先调用 pipeline_start');
  }
  return { userId: active.userId, projectId: active.projectId, templateName: active.state.template_name };
}

function toolCtx(ctx: any, wsRoot: string): ToolContext {
  return {
    agent_name: ctx?.agent_name || 'unknown',
    user_id: ctx?.user_id || (ctx as any)?.session?.userId || 'default-user',
    project_id: ctx?.project_id || (ctx as any)?.session?.projectId || 'default-project',
    workspace_root: wsRoot,
    api: ctx?.api,
  };
}

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
      async execute(params, _config, ctx) {
        try {
          const wsRoot = pickWs(params);
          const { userId, projectId, templateName } = await resolveStateContext(wsRoot);
          const template = await new WorkspaceConfigManager(wsRoot).readTemplate(templateName);
          const result = await pipelineRead(toolCtx(ctx, wsRoot), (params as any).slot_name, template);
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
      async execute(params, _config, ctx) {
        try {
          const wsRoot = pickWs(params);
          const { userId, projectId, templateName } = await resolveStateContext(wsRoot);
          const template = await new WorkspaceConfigManager(wsRoot).readTemplate(templateName);
          await pipelineWriteSlot(toolCtx(ctx, wsRoot), (params as any).slot_name, (params as any).content, template);
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
      async execute(params, _config, ctx) {
        try {
          const wsRoot = pickWs(params);
          const { userId, projectId } = await resolveStateContext(wsRoot);
          await pipelineAddRemark(toolCtx(ctx, wsRoot), (params as any).content);
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
      async execute(params, _config, ctx) {
        try {
          const wsRoot = pickWs(params);
          const result = await styleGetProfile(toolCtx(ctx, wsRoot));
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
      async execute(params, _config, ctx) {
        try {
          const wsRoot = pickWs(params);
          await styleRecordFeedback(toolCtx(ctx, wsRoot), (params as any).preference_updates);
          return '✅ 记忆已更新';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'route_message',
      label: 'route_message',
      description: '将消息路由给指定的子 Agent 进行直接对话，子 Agent 会看到完整会话历史（仅限 orchestrator 使用）。适合多轮讨论/修改。',
      parameters: Type.Object({
        target_agent: Type.String({ description: '目标 Agent 名称' }),
        message: Type.String({ description: '要发送的消息' }),
        workspace_root: wsParam,
      }),
      async execute(params, _config, ctx) {
        try {
          const wsRoot = pickWs(params);
          const result = await routeMessage(toolCtx(ctx, wsRoot), (params as any).target_agent, (params as any).message, ctx.api);
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
          Type.Literal('init_workspace'),
          Type.Literal('read_memory'),
          Type.Literal('write_memory'),
        ], { description: '操作类型' }),
        template_name: Type.Optional(Type.String({ description: '模板名称' })),
        agent_name: Type.Optional(Type.String({ description: 'Agent 名称' })),
        content: Type.Optional(Type.String({ description: '内容' })),
        workspace_root: wsParam,
      }),
      async execute(params, _config, _ctx) {
        try {
          const p = params as any;
          const wsRoot = pickWs(p);
          const uid = (_ctx as any).user_id || 'default-user';
          const payload = p.action === 'read_memory' || p.action === 'write_memory' ? { ...p, user_id: uid } : p;
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
      async execute(params, _config, _ctx) {
        try {
          const p = params as any;
          await agentGuideGenerator(pickWs(p), p.agent_name, p.instructions, p.append ?? false);
          return '✅ 指南已更新';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'pipeline_start',
      label: 'pipeline_start',
      description: '启动管道，执行到第一个 checkpoint 后暂停并返回子 Agent 产出（在 slot_output.value 中），将此内容直接展示给用户。',
      parameters: Type.Object({
        template_name: Type.String({ description: '管道模板名称（如 xiaohongshu-creation）' }),
        user_id: Type.String({ description: '用户 ID（如 alice）' }),
        project_id: Type.String({ description: '项目 ID（如 camping-post）' }),
        workspace_root: wsParam,
      }),
      async execute(params, _config, ctx) {
        try {
          const p = params as any;
          const result = await pipelineStart(p.template_name, p.user_id, p.project_id, pickWs(p), ctx.api);
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'pipeline_continue',
      label: 'pipeline_continue',
      description: '继续管道执行：feedback="agree" 推进到下一阶段（新阶段产出在 slot_output.value 中）；其他 feedback 会路由给当前阶段子 Agent 修改（修改后产出也在 slot_output.value 中）。将 slot_output.value 的内容展示给用户。',
      parameters: Type.Object({
        user_id: Type.String({ description: '用户 ID' }),
        project_id: Type.String({ description: '项目 ID' }),
        feedback: Type.String({ description: '用户反馈（输入"agree"继续，或提供修改意见）' }),
        workspace_root: wsParam,
      }),
      async execute(params, _config, ctx) {
        try {
          const p = params as any;
          const result = await pipelineContinue(p.user_id, p.project_id, p.feedback, pickWs(p), ctx.api);
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
