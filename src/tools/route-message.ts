// src/tools/route-message.ts - 对话路由工具

import path from 'path';
import { promises as fs } from 'fs';
import { ToolContext, Template, callSubagent } from '../types.js';
import { PromptBuilder } from '../runtime/prompt-builder.js';
import { MemoryManager } from './memory.js';
import { WorkspaceConfigManager } from './workspace-config.js';

export class RouteMessageHandler {
  constructor(private workspaceRoot: string) {}

  async routeMessage(
    context: ToolContext,
    targetAgent: string,
    message: string,
    api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
  ): Promise<string> {
    // 1. 验证调用者是否为 orchestrator
    if (context.agent_name !== 'orchestrator') {
      throw new Error(
        `route_message can only be called by orchestrator agents. Caller: ${context.agent_name}`
      );
    }

    // 2. 获取当前活跃项目的 state（如果有）
    const stateManager = new (await import('../runtime/state-manager.js')).StateManager(
      context.workspace_root,
      context.user_id,
      context.project_id
    );

    let state, template;
    try {
      state = await stateManager.load();
      const configManager = new WorkspaceConfigManager(context.workspace_root);
      template = await configManager.readTemplate(state.template_name);
    } catch (err: any) {
      if (err?.code === 'ENOENT' || err?.message?.includes('ENOENT')) {
        state = null; template = null;
      } else {
        throw err;
      }
    }

    // 3. 获取 Agent 的长期记忆
    const memoryManager = new MemoryManager(context.workspace_root, context.user_id, targetAgent);
    const profile = await memoryManager.getProfile();

    // 4. 构建 Prompt
    const promptBuilder = new PromptBuilder(
      context.workspace_root,
      context.user_id,
      context.project_id
    );

    const systemPrompt = template && state
      ? await promptBuilder.buildPipelinePrompt(targetAgent, template, state, profile, message)
      : this.buildDialoguePrompt(targetAgent, message, profile);

    // 5. 调用 Agent（使用复合 sessionKey 隔离项目/用户会话）
    const sessionKey = `${targetAgent}:${context.user_id}:${context.project_id}`;
    try {
      const agentResponse = await callSubagent(api, sessionKey, systemPrompt);
      if (agentResponse) {
        return agentResponse;
      }
    } catch {
      // 无 subagent API 时降级
    }

    return `[模拟] ${targetAgent} 收到消息并处理中...\n当前暂不支持实际 Agent 调用（api.runtime.subagent 不可用）`;
  }

  private buildDialoguePrompt(agentName: string, message: string, profile: any): string {
    const parts: string[] = [];

    parts.push(
      `【系统指令】\n` +
      `你是 ${agentName}。\n` +
      `你正在与用户进行一对一的对话。\n`
    );

    if (profile && profile.preferences) {
      parts.push(
        `【用户偏好】\n` +
        `${JSON.stringify(profile.preferences, null, 2)}\n`
      );
    }

    parts.push(
      `【用户消息】\n` +
      message + '\n' +
      `请根据用户的消息进行回应。`
    );

    return parts.join('\n');
  }
}

/**
 * route_message - 路由用户消息给指定 Agent
 */
export async function routeMessage(
  context: ToolContext,
  targetAgent: string,
  message: string,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<string> {
  const handler = new RouteMessageHandler(context.workspace_root);
  return await handler.routeMessage(context, targetAgent, message, api);
}

/**
 * 为工具导出标准的 OpenClaw 工具定义
 */

