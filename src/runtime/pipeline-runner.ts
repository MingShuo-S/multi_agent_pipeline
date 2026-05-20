// src/runtime/pipeline-runner.ts - 管道运行时主循环

import readline from 'readline';
import { StateManager } from './state-manager.js';
import { PromptBuilder } from './prompt-builder.js';
import { WorkspaceConfigManager } from '../tools/workspace-config.js';
import { MemoryManager } from '../tools/memory.js';
import { AgentGuideGenerator } from '../tools/agent-guide-generator.js';

export class PipelineRunner {
  private stateManager: StateManager;
  private rl: readline.Interface;

  constructor(
    private workspaceRoot: string,
    private userId: string,
    private projectId: string,
    private templateName: string
  ) {
    this.stateManager = new StateManager(workspaceRoot, userId, projectId);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async run(): Promise<void> {
    try {
      // 1. 加载模板
      const configManager = new WorkspaceConfigManager(this.workspaceRoot);
      const template = await configManager.readTemplate(this.templateName);

      // 2. 初始化 state
      await this.stateManager.initialize(template);
      let state = await this.stateManager.load();

      console.log(`\n✓ 管道已启动: ${template.name}`);
      console.log(`✓ 共 ${template.stages.length} 个阶段\n`);

      // 3. 主循环
      while (state.current_stage < template.stages.length && state.status === 'running') {
        const stage = template.stages[state.current_stage];
        console.log(`\n========== 阶段 ${state.current_stage + 1}/${template.stages.length}: ${stage.id} ==========`);
        console.log(`Agent: ${stage.agent}`);

        // 获取 Agent 的长期记忆
        const memoryManager = new MemoryManager(this.workspaceRoot, this.userId, stage.agent);
        const profile = await memoryManager.getProfile();

        // 构建 Prompt
        const promptBuilder = new PromptBuilder(
          this.workspaceRoot,
          this.userId,
          this.projectId
        );
        const prompt = await promptBuilder.buildPipelinePrompt(
          stage.agent,
          template,
          state,
          profile
        );

        console.log(`\n【Agent Prompt】\n${prompt}\n`);

        // TODO: 调用 skill-runner 执行 Agent
        // const output = await skillRunner.run(stage.agent, prompt, template, state);

        // 模拟 Agent 执行并更新 Slot
        console.log(`\n[模拟 Agent 执行中...]\n`);
        
        // 重新加载 state（Agent 可能已修改）
        state = await this.stateManager.load();

        // 处理 checkpoint
        if (stage.checkpoint) {
          console.log(`\n✓ 检查点触发！当前阶段产出：`);
          for (const slotName of stage.allow_write) {
            const value = state.slot_values[slotName];
            console.log(`\n【${slotName}】\n${value}`);
          }

          // 等待用户确认
          await this.waitForCheckpointApproval(stage.agent, state, template, profile, promptBuilder);
          state = await this.stateManager.load();
        }

        // 推进到下一阶段
        await this.stateManager.advanceStage();
        state = await this.stateManager.load();
      }

      // 4. 管道完成
      await this.stateManager.setStatus('completed');
      console.log(`\n✓ 管道完成！最终输出：`);
      
      for (const [slotName, value] of Object.entries(state.slot_values)) {
        console.log(`\n【${slotName}】\n${value}`);
      }
    } catch (err) {
      console.error(`✗ 管道错误: ${err}`);
      await this.stateManager.setStatus('failed');
    } finally {
      this.rl.close();
    }
  }

  private waitForCheckpointApproval(
    agentName: string,
    state: any,
    template: any,
    profile: any,
    promptBuilder: PromptBuilder
  ): Promise<void> {
    return new Promise((resolve) => {
      this.prompt('输入 "agree" 继续，或 "msg <消息>" 继续对话: ', async (input) => {
        if (input.trim() === 'agree') {
          resolve();
        } else if (input.trim().startsWith('msg ')) {
          const message = input.trim().slice(4);
          console.log(`\n[对话模式: 与 ${agentName} 沟通]\n消息: ${message}\n`);
          // TODO: 调用 route_message 或类似逻辑
          console.log(`[模拟 Agent 响应...]\n`);
          await this.waitForCheckpointApproval(agentName, state, template, profile, promptBuilder);
          resolve();
        } else {
          console.log('请输入有效命令');
          await this.waitForCheckpointApproval(agentName, state, template, profile, promptBuilder);
          resolve();
        }
      });
    });
  }

  private prompt(question: string, callback: (answer: string) => void): void {
    this.rl.question(question, callback);
  }
}
