// src/runtime/injection-layer.ts — 硬注入层构建器
// 架构复制自 0.AI工作区：
//   HOT → corePrinciples（始终注入 content-writer prompt 头部）
//   WARM → forbiddenPatterns + vocabulary（注入 content-writer 尾部）
//   COLD → KB + persona（不注入，通过工具按需读取）
//   rules/ → 对应 AGENTS.md + 05-全局规则体系（所有 agent 读取）

import type { AgentRole, PipelineState, Template } from '../types.js';
import { StyleSystem } from '../tools/style-system.js';

export class InjectionLayer {
  private rulesDir: string;

  constructor(
    private workspaceRoot: string,
    private userId: string,
  ) {
    this.rulesDir = workspaceRoot;
  }

  async buildForRole(
    role: AgentRole,
    state: PipelineState,
    template: Template,
    projectId?: string,
  ): Promise<{ headBlock: string; tailBlock: string }> {
    const styleSystem = new StyleSystem(this.workspaceRoot, this.userId);

    const headBlock = await this.buildHeadBlock(role, styleSystem);
    const tailBlock = this.buildTailBlock(role, state, template, projectId);

    return { headBlock, tailBlock };
  }

  private async buildHeadBlock(role: AgentRole, styleSystem: StyleSystem): Promise<string> {
    const parts: string[] = [];

    // HOT: 核心原则 — 始终注入 prompt 头部，不可覆盖
    parts.push(
      `【强制系统指令】\n` +
      `这是不可覆盖的硬规则。你的 Agent SOUL 定义必须遵守以下规则。\n`
    );

    // 只有 content-writer 拿到风格 DNA
    if (role === 'content-writer') {
      const profile = await styleSystem.readProfile();
      if (profile?.dna) {
        const dna = profile.dna;

        if (dna.corePrinciples?.length > 0) {
          parts.push(
            `【风格硬规则（HOT）】\n` +
            `以下核心原则必须严格遵守:\n` +
            dna.corePrinciples.map((p: string) => `  - ${p}`).join('\n') + '\n'
          );
        }

        if ((dna.forbiddenPatterns?.length > 0) || (dna.vocabulary?.forbidden?.length > 0) || (dna.vocabulary?.highFreq?.length > 0)) {
          const warmLines: string[] = ['【风格约束（WARM）】'];
          if (dna.forbiddenPatterns?.length > 0) {
            warmLines.push('禁止模式（绝对不要出现）:');
            for (const p of dna.forbiddenPatterns) warmLines.push(`  - ${p}`);
          }
          if (dna.vocabulary?.forbidden?.length > 0) {
            warmLines.push('禁用词汇:');
            for (const v of dna.vocabulary.forbidden) warmLines.push(`  - ${v}`);
          }
          if (dna.vocabulary?.highFreq?.length > 0) {
            warmLines.push('用户高频用词（输出应自然匹配）:');
            for (const v of dna.vocabulary.highFreq) warmLines.push(`  - ${v}`);
          }
          if (dna.growthDirection) {
            warmLines.push(`成长方向: ${dna.growthDirection} — 输出体现目标状态。`);
          }
          parts.push(warmLines.join('\n') + '\n');
        }
      }
    }

    // 工作区全局规则（所有 agent 通用）
    parts.push(
      `【工作区全局规则】\n` +
      `- 工作区根目录: ${this.workspaceRoot}\n` +
      `- 共享知识库: ${this.workspaceRoot}/_shared/${this.userId}/\n` +
      `- 规则文档: ${this.workspaceRoot}/rules/（温度分层、检索补全、条件反射、防幻觉）\n` +
      `- 所有产出必须通过 pipeline_write_slot 写入，不得直接返回在对话中\n` +
      `- 完成任务后调用 style_record_feedback 记录新发现的用户偏好\n`
    );

    return parts.join('\n');
  }

  private buildTailBlock(role: AgentRole, state: PipelineState, template: Template, projectId?: string): string {
    const parts: string[] = [];

    parts.push(
      `【阶段约束】\n` +
      `当前: stage ${state.current_stage + 1}/${template.stages.length}\n` +
      `项目: ${projectId || 'unknown'}\n` +
      `如果用户纠正了你的输出 → 用 style_record_feedback 记录\n` +
      `如果用户确认了某些内容 → 用 kb_write 写入知识库\n`
    );

    return parts.join('\n');
  }
}
