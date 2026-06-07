// src/runtime/prompt-builder.ts - 为 Agent 组装完整 Prompt

import path from 'path';
import { promises as fs } from 'fs';
import { Template, PipelineState, AgentProfile } from '../types.js';
import type { AgentRole } from '../types.js';
import { ToolAuth } from '../tools/tool-auth.js';
import { AgentGuideGenerator } from '../tools/agent-guide-generator.js';
import { InjectionLayer } from './injection-layer.js';

export class PromptBuilder {
  constructor(
    private workspaceRoot: string,
    private userId: string,
    private projectId: string
  ) {}

  /**
   * 为管道调用构建 Prompt
   */
  async buildPipelinePrompt(
    agentName: string,
    template: Template,
    state: PipelineState,
    profile: AgentProfile | null,
    userMessage?: string
  ): Promise<string> {
    const stage = template.stages[state.current_stage];

    const guideGen = new AgentGuideGenerator(this.workspaceRoot);
    const guide = await guideGen.readGuide(agentName);

    const readableSlots = ToolAuth.getReadableSlots(template, state.current_stage);
    const writableSlots = ToolAuth.getWritableSlots(template, state.current_stage);

    const slotContent = this.buildSlotContent(state, readableSlots);

    const injectionLayer = new InjectionLayer(this.workspaceRoot, this.userId);
    const { headBlock, tailBlock } = await injectionLayer.buildForRole(
      agentName as AgentRole,
      state,
      template,
      this.projectId,
    );

    const promptParts: string[] = [];

    // 1. 硬注入头（content-writer 含风格 DNA，其他人不含）
    promptParts.push(headBlock);

    // 2. SOUL + 角色定位
    promptParts.push(
      `【角色定位】\n` +
      `你是 ${agentName}。\n` +
      `当前你正在参与一个多 Agent 管道项目。\n` +
      `项目模板：${template.name}，阶段：${stage.id}\n` +
      `用户 ID：${this.userId}，项目 ID：${this.projectId}\n`
    );

    // 3. 协作规则
    promptParts.push(
      `【协作规则】\n` +
      `- 你**必须**使用以下管道工具来获取上下文和产出结果：\n` +
      `  - pipeline_read(slot_name)  读取其他 Agent 提供的信息\n` +
      `  - pipeline_write_slot(slot_name, content)  提交你的产出\n` +
      `  - pipeline_add_remark(content)  对其他 Agent 或流程提出评论\n` +
      `- 除管道工具外，你还可以使用你原本具备的所有工具来完成任务。\n` +
      `- 你只能读取当前阶段允许的 slot：${readableSlots.join(', ')}\n` +
      `- 你只能写入当前阶段允许的 slot：${writableSlots.join(', ')}\n` +
      `- 不要尝试访问未授权的 slot，否则工具会拒绝。\n`
    );

    // 4. 长期记忆（旧 system: per-agent profile）
    if (profile?.preferences && Object.keys(profile.preferences).length > 0) {
      promptParts.push(
        `【长期记忆】\n` +
        `以下是你对该用户的已知偏好（来自 profile.json）：\n` +
        `${JSON.stringify(profile.preferences, null, 2)}\n`
      );
    }

    // 5. 当前管道上下文
    promptParts.push(
      `【当前管道上下文】\n` +
      `以下 slot 的内容是你有权查看的：\n` +
      slotContent + '\n'
    );

    // 6. 协作指南（可选）
    if (guide) {
      promptParts.push(
        `【协作指南】\n` +
        guide + '\n'
      );
    }

    // 7. 用户任务
    if (userMessage) {
      promptParts.push(
        `【用户消息】\n` +
        userMessage + '\n'
      );
    } else {
      promptParts.push(
        `【任务】\n` +
        `请根据上下文和你的职责，完成本阶段工作，并将结果写入指定 slot。\n`
      );
    }

    // 8. 硬注入尾（阶段约束 + 通用规则）
    promptParts.push(tailBlock);

    return promptParts.join('\n');
  }

  private buildSlotContent(state: PipelineState, readableSlots: string[]): string {
    const lines: string[] = [];
    for (const slotName of readableSlots) {
      const value = state.slot_values[slotName];
      if (value !== undefined && value !== '') {
        const value = state.slot_values[slotName];
        const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        lines.push(`- **${slotName}**:\n${this.indent(content, 2)}`);
      }
    }
    return lines.length > 0 ? lines.join('\n') : '（暂无 Slot 内容）';
  }

  private indent(text: string, spaces: number): string {
    const indent = ' '.repeat(spaces);
    return text.split('\n').map(line => indent + line).join('\n');
  }
}
