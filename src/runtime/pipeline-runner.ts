// src/runtime/pipeline-runner.ts - 接力模式运行时

import readline from 'readline';
import type { Template, PipelineState, InterruptPoint } from '../types.js';
import { StateManager } from './state-manager.js';
import { WorkspaceConfigManager } from '../tools/workspace-config.js';
import { callSubagent, type SubagentAPI } from '../types.js';
import { isAdvanceSignal } from './pipeline-utils.js';

export class PipelineRunner {
  private stateManager: StateManager;
  private rl: readline.Interface;

  constructor(
    private workspaceRoot: string,
    private userId: string,
    private projectId: string,
    private templateName: string,
    private api?: { runtime: { subagent: SubagentAPI } }
  ) {
    this.stateManager = new StateManager(workspaceRoot, userId, projectId);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async run(): Promise<void> {
    try {
      const configManager = new WorkspaceConfigManager(this.workspaceRoot);
      const template = await configManager.readTemplate(this.templateName);
      const mode = template.mode || 'relay';

      console.log(`\n========================================`);
      console.log(`  部虾创 - 接力模式`);
      console.log(`  模板: ${template.name}`);
      console.log(`  阶段: ${template.stages.length}`);
      console.log(`========================================\n`);

      // 初始化 state
      let state = await this.stateManager.initialize(template, mode);

      // 自动推进不需要 checkpoints 的阶段
      state = await this.autoAdvanceNonCheckpoint(template, state);
      await this.stateManager.save(state);

      // 主循环
      await this.relayLoop(template, state);
    } catch (err) {
      console.error(`\n[错误] ${String(err)}`);
      await this.stateManager.setStatus('failed');
    } finally {
      this.rl.close();
    }
  }

  private async relayLoop(template: Template, initialState: PipelineState): Promise<void> {
    let state = initialState;

    while (state.current_stage < template.stages.length && state.status === 'running') {
      const stage = template.stages[state.current_stage];

      console.log(`\n---------- 阶段 ${state.current_stage + 1}/${template.stages.length}: ${stage.id} ----------`);
      console.log(`专家: ${stage.agent}`);
      if (stage.description) console.log(`任务: ${stage.description}`);
      console.log('');

      // 对话循环：用户与当前专家来回对话
      const shouldAdvance = await this.dialogueWithAgent(template, state, stage);

      if (shouldAdvance) {
        // P0-3: 检查 interrupt
        const interrupt = this.findInterruptForStage(template, stage.id);
        if (interrupt) {
          console.log(`\n⏸️  ${interrupt.message}`);
          const confirmed = await this.waitForInterruptConfirm(interrupt);
          if (!confirmed) {
            console.log('已取消推进，继续对话。');
            continue;
          }
        }

        // 完成当前阶段
        await this.stateManager.completeCurrentStage();
        state = await this.stateManager.load();

        // 推进
        await this.stateManager.advanceStage();
        state = await this.stateManager.load();

        // 自动推进非 checkpoint 阶段
        state = await this.autoAdvanceNonCheckpoint(template, state);
        await this.stateManager.save(state);

        if (state.current_stage >= template.stages.length) {
          state.status = 'completed';
          await this.stateManager.save(state);
          console.log('\n========================================');
          console.log('  所有阶段完成！');
          console.log('========================================\n');

          // 展示最终产出
          for (const [slotName, value] of Object.entries(state.slot_values)) {
            const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
            if (content) {
              console.log(`[${slotName}]\n${content}\n`);
            }
          }
        }
      }
    }
  }

  /**
   * 与当前专家对话循环
   * 返回 true = 用户要推进到下一阶段
   */
  private async dialogueWithAgent(
    template: Template,
    state: PipelineState,
    stage: any
  ): Promise<boolean> {
    while (true) {
      const input = await this.prompt(
        `[你] > `
      );

      if (!input.trim()) continue;

      if (isAdvanceSignal(input)) {
        return true;
      }

      // 路由给当前专家
      try {
        const sessionKey = `${stage.agent}:${this.userId}:${this.projectId}`;
        const response = await callSubagent(this.api, sessionKey, input);
        console.log(`\n[${stage.agent}] > ${response}\n`);
      } catch (err) {
        // 无 sub-agent API 时模拟响应
        const simResponse = this.simulateAgentResponse(stage.agent, input, state, template);
        console.log(`\n[${stage.agent}] > ${simResponse}\n`);
      }
    }
  }

  /**
   * 本地模拟 agent 响应（无 OpenClaw API 时）
   */
  private simulateAgentResponse(agentName: string, userMessage: string, state: PipelineState, template: Template): string {
    const stage = template.stages[state.current_stage];
    const slotName = stage.allow_write[0];

    if (agentName === 'topic-researcher') {
      return `[选题研究员] 收到你的消息："${userMessage.substring(0, 100)}..."\n\n` +
        `选题方向已确认 + 调研数据已就绪！\n\n` +
        `方向：南京红庙烟火气（美食+人文）\n` +
        `路线验证：红庙→朝天宫→莫愁湖公园，全程4-5公里\n` +
        `门票：朝天宫25元（学生半价），莫愁湖免费\n\n` +
        `数据已写入 topic_brief + research_notes slot。`;
    }

    if (agentName === 'content-writer') {
      return `[内容创作者] 基于调研数据，生成了小红书初稿：\n\n` +
        `标题：《南京烟火气骑行｜红庙→莫愁湖，25元玩一天》\n` +
        `正文已写入 draft_content slot。`;
    }

    return `[${agentName}] 已处理你的消息，结果写入 ${slotName} slot。`;
  }

  private async autoAdvanceNonCheckpoint(template: Template, state: PipelineState): Promise<PipelineState> {
    let s = { ...state };
    let nextStage = s.current_stage;
    while (nextStage < template.stages.length) {
      const stage = template.stages[nextStage];
      if (stage.checkpoint) break;

      // 非 checkpoint 阶段自动执行
      console.log(`[自动] 跳过非 checkpoint 阶段: ${stage.id} (${stage.agent})`);

      const simResponse = this.simulateAgentResponse(stage.agent, '自动执行', s, template);
      console.log(`[自动] ${stage.agent} > ${simResponse}\n`);

      const slotName = stage.allow_write[0];
      if (slotName) {
        await this.stateManager.updateSlot(slotName, simResponse, stage.agent);
      }

      // 标记完成
      const entry = s.stage_history.find(h => h.stage === nextStage && !h.completed_at);
      if (entry) entry.completed_at = new Date().toISOString();

      nextStage++;
    }
    s.current_stage = nextStage;

    if (nextStage < template.stages.length) {
      const exists = s.stage_history.find(h => h.stage === nextStage);
      if (!exists) {
        s.stage_history.push({
          stage: nextStage,
          stage_id: template.stages[nextStage].id,
          agent: template.stages[nextStage].agent,
          started_at: new Date().toISOString(),
          versions: 0,
        });
      }
    }

    await this.stateManager.save(s);
    return s;
  }

  private prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer);
      });
    });
  }

  /**
   * P0-3: 查找 stage 对应的 interrupt point
   */
  private findInterruptForStage(template: Template, stageId: string): InterruptPoint | null {
    if (!template.interrupts) return null;
    return template.interrupts.find(ip => ip.stage === stageId) ?? null;
  }

  /**
   * P0-3: 等待用户确认 interrupt
   * 返回 true = 确认通过，false = 用户要修改
   */
  private async waitForInterruptConfirm(interrupt: InterruptPoint): Promise<boolean> {
    while (true) {
      const input = await this.prompt(`> `);
      const trimmed = input.trim().toLowerCase();

      const isConfirm = interrupt.confirmKeywords.some(kw =>
        trimmed === kw.toLowerCase() ||
        trimmed.startsWith(kw.toLowerCase() + ' ') ||
        trimmed.endsWith(' ' + kw.toLowerCase())
      );
      if (isConfirm) return true;

      const isRevise = interrupt.reviseKeywords.some(kw =>
        trimmed.includes(kw.toLowerCase())
      );
      if (isRevise) {
        console.log('收到修改意见。请继续对话，完成后再次输入推进信号。');
        return false;
      }

      console.log('请输入确认关键词（如"继续"）或修改意见。');
    }
  }
}
