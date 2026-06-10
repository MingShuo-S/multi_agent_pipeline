import { Type } from '@sinclair/typebox';
import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';

import { pipelineRead, pipelineWriteSlot, pipelineAddRemark } from './tools/pipeline.js';
import { styleGetProfile, styleRecordFeedback } from './tools/memory.js';
import { WorkspaceConfigManager, initWorkspace, workspaceConfig } from './tools/workspace-config.js';
import { agentGuideGenerator } from './tools/agent-guide-generator.js';
import { routeMessage } from './tools/route-message.js';
import { pipelineStart } from './tools/pipeline-start.js';
import { pipelineContinue } from './tools/pipeline-continue.js';
import { pipelineStatus } from './tools/pipeline-status.js';
import { pipelineDisplay } from './tools/pipeline-display.js';
import { styleReadProfile, styleWriteProfile, kbWrite, kbRead, styleExtractSignal, voiceprintInit, styleGetContext, voiceprintAnalyze, voiceprintCalibrate, voiceprintConfirm, voiceprintProceed, voiceprintReset } from './tools/style-system.js';
import { sessionSearch, sessionSearchAll, freezeSnapshot, readSnapshot, writeSessionNote, readSessionNote, autoCompress } from './tools/session-memory.js';
import { knowledgeRead } from './tools/knowledge-reader.js';
import { StateManager } from './runtime/state-manager.js';
import { WORKSPACE_ROOT } from './config.js';
import type { ToolContext, CorrectionSignal } from './types.js';

function pickWs(): string {
  return WORKSPACE_ROOT;
}

async function resolveStateContext(): Promise<{ userId: string; projectId: string; templateName: string }> {
  const active = await StateManager.findActiveState(pickWs());
  if (!active) {
    throw new Error('没有找到活跃的管道项目，请先调用 pipeline_start');
  }
  return { userId: active.userId, projectId: active.projectId, templateName: active.state.template_name };
}

function toolCtx(ctx: any): ToolContext {
  return {
    agent_name: ctx?.agent_name || 'unknown',
    user_id: ctx?.user_id || ctx?.session?.userId || 'default-user',
    project_id: ctx?.project_id || ctx?.session?.projectId || 'default-project',
    workspace_root: pickWs(),
    api: ctx?.api,
  };
}

export default defineToolPlugin({
  id: 'multi-agent-pipeline',
  name: '部虾创 - 多 Agent 接力流水线引擎',
  description: '部虾创：多 Agent 协作接力引擎。每个专家与用户直接对话，人在回路决定推进节奏。Slot 权限隔离 + 版本历史全程可追溯。内置风格学习系统。',

  tools: (tool) => [
    tool({
      name: 'pipeline_read',
      label: 'pipeline_read',
      description: '读取管道中当前阶段允许的 Slot 内容。当前 Agent 只能读取授权给自己的 slot。',
      parameters: Type.Object({
        slot_name: Type.String({ description: '要读取的 Slot 名称' }),
      }),
      async execute(params, _config, ctx) {
        try {
          const wsRoot = pickWs();
          const { userId, projectId, templateName } = await resolveStateContext();
          const template = await new WorkspaceConfigManager(wsRoot).readTemplate(templateName);
          const resolvedCtx = { ...toolCtx(ctx), user_id: userId, project_id: projectId };
          const result = await pipelineRead(resolvedCtx, (params as any).slot_name, template);
          return typeof result === 'string' ? result : result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'pipeline_write_slot',
      label: 'pipeline_write_slot',
      description: '写入 Slot 内容并追加版本历史。当前 Agent 只能写入授权给自己的 slot。',
      parameters: Type.Object({
        slot_name: Type.String({ description: '要写入的 Slot 名称' }),
        content: Type.String({ description: '要写入的内容' }),
      }),
      async execute(params, _config, ctx) {
        try {
          const wsRoot = pickWs();
          const { userId, projectId, templateName } = await resolveStateContext();
          const template = await new WorkspaceConfigManager(wsRoot).readTemplate(templateName);
          const resolvedCtx = { ...toolCtx(ctx), user_id: userId, project_id: projectId };
          await pipelineWriteSlot(resolvedCtx, (params as any).slot_name, (params as any).content, template);
          return '成功写入';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'pipeline_add_remark',
      label: 'pipeline_add_remark',
      description: '为管道添加批注（会追加版本记录）',
      parameters: Type.Object({
        content: Type.String({ description: '批注内容' }),
      }),
      async execute(params, _config, ctx) {
        try {
          const wsRoot = pickWs();
          const { userId, projectId } = await resolveStateContext();
          const resolvedCtx = { ...toolCtx(ctx), user_id: userId, project_id: projectId };
          await pipelineAddRemark(resolvedCtx, (params as any).content);
          return '批注已添加';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'pipeline_status',
      label: 'pipeline_status',
      description: '查看管道项目完整状态面板：当前阶段、各阶段进度、Slot 版本历史、所有批注。用于 UI 渲染和状态监控。',
      parameters: Type.Object({
        user_id: Type.String({ description: '用户 ID' }),
        project_id: Type.String({ description: '项目 ID' }),
      }),
      async execute(params, _config, _ctx) {
        try {
          const p = params as any;
          const result = await pipelineStatus(p.user_id, p.project_id, pickWs());
          return result;
        } catch (err) {
          return { status: 'error', error: String(err) };
        }
      },
    }),

    tool({
      name: 'pipeline_display',
      label: 'pipeline_display',
      description: '[orchestrator 专用] 直接输出最新 slot/remark 的格式化 markdown。orchestrator 应原样转发给用户，不要总结或重述。',
      parameters: Type.Object({
        user_id: Type.String({ description: '用户 ID' }),
        project_id: Type.String({ description: '项目 ID' }),
      }),
      async execute(params, _config, _ctx) {
        try {
          const p = params as any;
          return await pipelineDisplay(p.user_id, p.project_id, pickWs());
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'style_get_profile',
      label: 'style_get_profile',
      description: '获取当前 Agent 对当前用户的长期记忆偏好',
      parameters: Type.Object({}),
      async execute(_params, _config, ctx) {
        try {
          const result = await styleGetProfile(toolCtx(ctx));
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
      }),
      async execute(params, _config, ctx) {
        try {
          await styleRecordFeedback(toolCtx(ctx), (params as any).preference_updates);
          return '记忆已更新';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'style_read_profile',
      label: 'style_read_profile',
      description: '读取用户的完整风格配置文件（_profiles/{userId}/profile.json）',
      parameters: Type.Object({}),
      async execute(_params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const result = await styleReadProfile(c.workspace_root, c.user_id);
          return result || { message: '尚无风格 DNA，请先通过 Voiceprint 流程创建' };
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'style_write_profile',
      label: 'style_write_profile',
      description: '写入用户的完整风格配置文件',
      parameters: Type.Object({
        profile: Type.Any({ description: 'Profile 对象' }),
      }),
      async execute(params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          await styleWriteProfile(c.workspace_root, c.user_id, (params as any).profile);
          return '风格 DNA 已更新';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'style_extract_signal',
      label: 'style_extract_signal',
      description: '[内部] 记录一个风格纠正信号到知识库。由 pipeline_continue 自动调用，一般不需要手动使用。',
      parameters: Type.Object({
        type: Type.Union([
          Type.Literal('preference'),
          Type.Literal('correction'),
          Type.Literal('forbidden'),
          Type.Literal('praise'),
        ], { description: '信号类型' }),
        quote: Type.String({ description: '信号内容' }),
      }),
      async execute(params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const p = params as any;
          const signal: CorrectionSignal = {
            type: p.type,
            quote: p.quote,
            agent: c.agent_name,
            userId: c.user_id,
          };
          await styleExtractSignal(c.workspace_root, c.user_id, signal);
          return '信号已记录';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'memory_write',
      label: 'memory_write',
      description: '写入一条用户记忆条目（_profiles/{userId}/memory.json）',
      parameters: Type.Object({
        category: Type.Union([
          Type.Literal('persona'),
          Type.Literal('insight'),
          Type.Literal('fact'),
          Type.Literal('feedback'),
        ], { description: '条目分类' }),
        content: Type.String({ description: '条目内容' }),
        confidence: Type.Union([
          Type.Literal('high'),
          Type.Literal('medium'),
          Type.Literal('low'),
        ], { description: '置信度' }),
      }),
      async execute(params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const p = params as any;
          await kbWrite(c.workspace_root, c.user_id, {
            userId: c.user_id,
            category: p.category,
            content: p.content,
            source: c.agent_name,
            timestamp: new Date().toISOString(),
            confidence: p.confidence,
          });
          return '知识库条目已写入';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'memory_read',
      label: 'memory_read',
      description: '读取用户知识库条目（memory.json）',
      parameters: Type.Object({
        category: Type.Optional(Type.Union([
          Type.Literal('persona'),
          Type.Literal('insight'),
          Type.Literal('fact'),
          Type.Literal('feedback'),
        ], { description: '按分类筛选（可选）' })),
      }),
      async execute(params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const p = params as any;
          const entries = await kbRead(c.workspace_root, c.user_id, p.category);
          return entries.length > 0 ? entries : { message: '知识库暂无条目' };
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    // ——— 向后兼容：kb_read / kb_write 别名 ———

    tool({
      name: 'kb_write',
      label: 'kb_write',
      description: '[已弃用] 请用 memory_write 替代。写入一条用户记忆条目。',
      parameters: Type.Object({
        category: Type.Union([
          Type.Literal('persona'),
          Type.Literal('insight'),
          Type.Literal('fact'),
          Type.Literal('feedback'),
        ], { description: '条目分类' }),
        content: Type.String({ description: '条目内容' }),
        confidence: Type.Union([
          Type.Literal('high'),
          Type.Literal('medium'),
          Type.Literal('low'),
        ], { description: '置信度' }),
      }),
      async execute(params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const p = params as any;
          await kbWrite(c.workspace_root, c.user_id, {
            userId: c.user_id,
            category: p.category,
            content: p.content,
            source: c.agent_name,
            timestamp: new Date().toISOString(),
            confidence: p.confidence,
          });
          return '知识库条目已写入';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'kb_read',
      label: 'kb_read',
      description: '[已弃用] 请用 memory_read 替代。读取用户知识库条目。',
      parameters: Type.Object({
        category: Type.Optional(Type.Union([
          Type.Literal('persona'),
          Type.Literal('insight'),
          Type.Literal('fact'),
          Type.Literal('feedback'),
        ], { description: '按分类筛选（可选）' })),
      }),
      async execute(params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const p = params as any;
          const entries = await kbRead(c.workspace_root, c.user_id, p.category);
          return entries.length > 0 ? entries : { message: '知识库暂无条目' };
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'knowledge_read',
      label: 'knowledge_read',
      description: '读取内置知识文档。不传 docName 返回可用文档列表；传 docName 返回文档完整内容。知识文档位于 knowledge/ 目录，系统预置，只读。',
      parameters: Type.Object({
        docName: Type.Optional(Type.String({ description: '文档名称（如 rules.md）。不传则返回可用文档列表。' })),
      }),
      async execute(params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const p = params as any;
          const result = await knowledgeRead(c.workspace_root, p.docName);
          if (p.docName) {
            return result || { message: `文档 "${p.docName}" 不存在` };
          }
          const docs = result as { name: string; path: string; content: string }[];
          if (docs.length === 0) return { message: '知识目录为空或不存在' };
          return docs.map(d => `- ${d.name}`).join('\n');
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'route_message',
      label: 'route_message',
      description: '将消息路由给指定的子 Agent 进行直接对话，子 Agent 会看到完整会话历史。适合多轮讨论/修改。',
      parameters: Type.Object({
        target_agent: Type.String({ description: '目标 Agent 名称' }),
        message: Type.String({ description: '要发送的消息' }),
      }),
      async execute(params, _config, ctx) {
        try {
          const wsRoot = pickWs();
          const result = await routeMessage(toolCtx(ctx), (params as any).target_agent, (params as any).message, ctx.api);
          return typeof result === 'string' ? result : result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'workspace_config',
      label: 'workspace_config',
      description: '读取或修改管道模板和用户记忆文件。调用 init_workspace 可重新初始化工作区。',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('list_templates'),
          Type.Literal('read_template'),
          Type.Literal('write_template'),
          Type.Literal('init_workspace'),
          Type.Literal('read_memory'),
          Type.Literal('write_memory'),
          Type.Literal('read_shared_profile'),
          Type.Literal('write_shared_profile'),
        ], { description: '操作类型' }),
        template_name: Type.Optional(Type.String({ description: '模板名称' })),
        agent_name: Type.Optional(Type.String({ description: 'Agent 名称' })),
        content: Type.Optional(Type.String({ description: '内容' })),
      }),
      async execute(params, _config, ctx) {
        try {
          const wsRoot = pickWs();
          const p = params as any;
          const uid = (ctx as any)?.user_id || (ctx as any)?.session?.userId || 'default-user';

          if (p.action === 'init_workspace') {
            return await initWorkspace(wsRoot);
          }

          return await workspaceConfig(wsRoot, p.action, { ...p, user_id: uid });
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
      }),
      async execute(params, _config, ctx) {
        try {
          const p = params as any;
          await agentGuideGenerator(pickWs(), p.agent_name, p.instructions, p.append ?? false);
          return '指南已更新';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'pipeline_start',
      label: 'pipeline_start',
      description: '[必须使用] 只要用户提出创作需求（写文章、做调研、生成内容），必须先调此工具启动管道。启动后所有后续消息用 pipeline_continue。如果管道已在运行，必须使用 pipeline_continue，不要重复调用此工具。',
      parameters: Type.Object({
        template_name: Type.String({ description: '管道模板名称（如 xiaohongshu-creation）' }),
        user_id: Type.String({ description: '用户 ID' }),
        project_id: Type.String({ description: '项目 ID' }),
        initial_message: Type.Optional(Type.String({ description: '用户初始需求消息（可选，提供后自动开始与第一位专家对话）' })),
      }),
      async execute(params, _config, ctx) {
        try {
          const p = params as any;
          const result = await pipelineStart(
            p.template_name, p.user_id, p.project_id,
            p.initial_message || '', pickWs(), ctx.api
          );
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'voiceprint_init',
      label: 'voiceprint_init',
      description: '[Voiceprint 入口] 初始化/恢复 voiceprint 状态机。返回当前步骤 + 提示语。',
      parameters: Type.Object({}),
      async execute(_params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const result = await voiceprintInit(c.workspace_root, c.user_id);
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'voiceprint_proceed',
      label: 'voiceprint_proceed',
      description: '[Voiceprint 步骤 1-6] 存储用户写作样本并推进步骤。返回下一步提示语。',
      parameters: Type.Object({
        sample: Type.Optional(Type.Object({
          text: Type.String({ description: '样本文本' }),
          label: Type.String({ description: '样本标签（如"自我介绍""概念解释""推荐"）' }),
        }, { description: '用户刚写的一段文字' })),
        path: Type.Optional(Type.Union([Type.Literal('A'), Type.Literal('B')], { description: '路径 A=引导写，B=贴文章' })),
        done: Type.Optional(Type.Boolean({ description: '样本够了，跳到校准步骤' })),
      }),
      async execute(params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const p = params as any;
          const result = await voiceprintProceed(c.workspace_root, c.user_id, p);
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'voiceprint_calibrate',
      label: 'voiceprint_calibrate',
      description: '[Voiceprint 步骤 7-8] 校准偏好：句长/emoji/语气/禁用语。需在步骤 7-8 调用。',
      parameters: Type.Object({
        sentenceLength: Type.Optional(Type.Union([Type.Literal('short'), Type.Literal('medium'), Type.Literal('long')], { description: '句长偏好' })),
        useEmoji: Type.Optional(Type.Boolean({ description: '是否使用 emoji' })),
        useExclamation: Type.Optional(Type.Boolean({ description: '是否使用感叹号' })),
        tone: Type.Optional(Type.Union([Type.Literal('casual'), Type.Literal('formal'), Type.Literal('balanced')], { description: '语气偏好' })),
        selectedForbiddenPhrases: Type.Optional(Type.Array(Type.String(), { description: '用户选择的禁用短语' })),
      }),
      async execute(params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const p = params as any;
          const result = await voiceprintCalibrate(c.workspace_root, c.user_id, p);
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'voiceprint_analyze',
      label: 'voiceprint_analyze',
      description: '[Voiceprint 步骤 9] 写入子 agent 的分析结论到 profile.json。需在步骤 9 调用。',
      parameters: Type.Object({
        samples: Type.Array(Type.Object({
          text: Type.String({ description: '样本文本' }),
          label: Type.String({ description: '样本标签' }),
        }), { description: '写作样本数组' }),
        analysis: Type.Object({
          corePrinciples: Type.Array(Type.String(), { description: '核心写作原则' }),
          forbiddenPatterns: Type.Array(Type.String(), { description: '禁用写作手法' }),
          highFreqWords: Type.Array(Type.String(), { description: '高频用词' }),
          techTerms: Type.Optional(Type.Array(Type.String(), { description: '领域术语' })),
          syntaxPatterns: Type.Record(Type.String(), Type.Any(), { description: '句法偏好键值对' }),
          growthDirection: Type.Optional(Type.String({ description: '成长方向' })),
        }, { description: '子 agent 的分析结论' }),
      }),
      async execute(params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const p = params as any;
          const result = await voiceprintAnalyze(c.workspace_root, c.user_id, p);
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'voiceprint_confirm',
      label: 'voiceprint_confirm',
      description: '[Voiceprint 步骤 10] 确认并锁定风格 DNA。corrections 非空则只记录不锁定。',
      parameters: Type.Object({
        corrections: Type.Optional(Type.Array(Type.String(), { description: '用户提出的修正（可选，传入则不锁定）' })),
      }),
      async execute(params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const p = params as any;
          const result = await voiceprintConfirm(c.workspace_root, c.user_id, p);
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'voiceprint_reset',
      label: 'voiceprint_reset',
      description: '重置 voiceprint 状态，允许用户重新做风格快照。',
      parameters: Type.Object({}),
      async execute(_params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const result = await voiceprintReset(c.workspace_root, c.user_id);
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'style_get_context',
      label: 'style_get_context',
      description: '[content-writer 专用] 拉取完整风格上下文：style DNA + persona + insights + 知识点',
      parameters: Type.Object({}),
      async execute(_params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const result = await styleGetContext(c.workspace_root, c.user_id);
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'pipeline_continue',
      label: 'pipeline_continue',
      description: '[管道运行中唯一入口] 处理管道运行中所有用户消息。用户说"下一阶段"、"完成"、"继续"等推进关键词时自动推进到下一专家阶段；否则将消息路由给当前阶段专家继续对话。自动拦截用户纠正信号写入风格知识库。管道启动后必须始终使用此工具，不要调用 pipeline_start。',
      parameters: Type.Object({
        user_id: Type.String({ description: '用户 ID' }),
        project_id: Type.String({ description: '项目 ID' }),
        message: Type.String({ description: '用户消息（对话内容或"下一阶段"推进指令）' }),
      }),
      async execute(params, _config, ctx) {
        try {
          const p = params as any;
          const result = await pipelineContinue(p.user_id, p.project_id, p.message, pickWs(), ctx.api);
          return result;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    // ——— Hermes 记忆模式工具 ———

    tool({
      name: 'session_search',
      label: 'session_search',
      description: '跨 Slot 历史检索：搜索当前项目所有 slot 的历史版本。支持关键词、slot名、Agent、时间范围过滤。用于 Agent 回顾之前阶段的工作内容。',
      parameters: Type.Object({
        keyword: Type.Optional(Type.String({ description: '搜索关键词' })),
        slot_name: Type.Optional(Type.String({ description: '按 slot 名称过滤' })),
        agent: Type.Optional(Type.String({ description: '按 Agent 名称过滤' })),
        from_time: Type.Optional(Type.String({ description: '起始时间 (ISO)' })),
        to_time: Type.Optional(Type.String({ description: '结束时间 (ISO)' })),
        limit: Type.Optional(Type.Number({ description: '最大返回条数', default: 20 })),
        all_projects: Type.Optional(Type.Boolean({ description: '跨所有项目搜索', default: false })),
      }),
      async execute(params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const p = params as any;
          const query = {
            keyword: p.keyword,
            slotName: p.slot_name,
            agent: p.agent,
            fromTime: p.from_time,
            toTime: p.to_time,
            limit: p.limit ?? 20,
          };
          const results = p.all_projects
            ? await sessionSearchAll(c.workspace_root, c.user_id, query)
            : await sessionSearch(c.workspace_root, c.user_id, c.project_id, query);
          return results.length > 0
            ? results.map(r => `[${r.writtenAt.slice(0, 10)}] ${r.slotName} (v${r.version}, ${r.agent}): ${typeof r.content === 'string' ? r.content.substring(0, 300) : JSON.stringify(r.content).substring(0, 300)}`).join('\n\n')
            : '未找到匹配的历史记录';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'snapshot_create',
      label: 'snapshot_create',
      description: '冻结当前 KB 状态为快照（写入 _profiles/{userId}/memory/session-snapshot.md）。Agent 可在关键里程碑后手动调用，或 pipeline_start 在 session 启动时自动调用。快照在 session 内不更新，保护 LLM prefix cache。',
      parameters: Type.Object({}),
      async execute(_params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const snapshot = await freezeSnapshot(c.workspace_root, c.user_id, c.project_id);
          return `快照已冻结于 ${snapshot.sessionStart}\n风格 DNA: ${snapshot.styleDna.substring(0, 100)}...\n洞察: ${snapshot.insights.substring(0, 100)}...\n知识条目: ${snapshot.topKB.split('\n').length} 条`;
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'snapshot_read',
      label: 'snapshot_read',
      description: '读取当前 KB 快照文件内容。返回 session 启动时冻结的 KB 上下文。如果快照不存在，返回提示信息。',
      parameters: Type.Object({}),
      async execute(_params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const content = await readSnapshot(c.workspace_root, c.user_id);
          return content || '暂无快照。请先调用 snapshot_create 创建。';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'session_note_write',
      label: 'session_note_write',
      description: '写入 Session Note（Agent 自述笔记）。类似 Hermes MEMORY.md：Agent 可在关键操作后调用 "写一写自己的观察"。限制 2200 字符，超出自动截断。内容风格：第一人称，Agent 视角。',
      parameters: Type.Object({
        content: Type.String({ description: '笔记内容（第一人称，Agent 视角，限 2200 字符）' }),
      }),
      async execute(params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const p = params as any;
          await writeSessionNote(c.workspace_root, c.user_id, p.content);
          return 'Session Note 已写入';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'session_note_read',
      label: 'session_note_read',
      description: '读取当前 Session Note。返回 Agent 之前写的自述笔记，包括上轮 session 的 Agent 视角总结。用于跨 session 上下文传递。',
      parameters: Type.Object({}),
      async execute(_params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const content = await readSessionNote(c.workspace_root, c.user_id);
          return content || '暂无 Session Note。';
        } catch (err) {
          return `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    tool({
      name: 'memory_compress',
      label: 'memory_compress',
      description: '手动触发用户 KB 压缩。压缩策略：insights.md 超过 8K 字符时保留最近 50 行 + 已压缩标记的行；kb.json 超过 200 条目时保留所有 high 置信度 + 最近 20 条 medium/low。不直接删除数据——老数据合并为摘要。',
      parameters: Type.Object({}),
      async execute(_params, _config, ctx) {
        try {
          const c = toolCtx(ctx);
          const result = await autoCompress(c.workspace_root, c.user_id);
          return result.compressed.length > 0
            ? `已压缩: ${result.compressed.join(', ')}。释放 ${result.freed} 条目/字符。`
            : '无需压缩。';
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
export { StyleSystem } from './tools/style-system.js';
export { InjectionLayer } from './runtime/injection-layer.js';
export type { ToolContext, Template, PipelineState, PipelineStage, Profile, KBEntry, CorrectionSignal, InjectionBlock, AgentRole } from './types.js';

// 导出供测试验证 toolCtx 和 resolveStateContext 行为
export { toolCtx, resolveStateContext };
