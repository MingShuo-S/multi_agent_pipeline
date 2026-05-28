import { Template, PipelineState, SubagentAPI, callSubagent } from '../types.js';

export interface SkillRunnerConfig {
  agentName: string;
  skillName?: string;
  userId: string;
  projectId: string;
  template: Template;
  state: PipelineState;
  prompt: string;
  api?: { runtime: { subagent: SubagentAPI } };
  additionalTools?: Array<{ id: string; name: string }>;
}

export interface SkillRunnerResult {
  success: boolean;
  output: string;
  stateUpdated: PipelineState;
}

export class SkillRunner {
  static async run(config: SkillRunnerConfig): Promise<SkillRunnerResult> {
    try {
      const sessionKey = `${config.agentName}:${config.userId}:${config.projectId}`;
      const output = await callSubagent(config.api, sessionKey, config.prompt);
      if (output) {
        return { success: true, output, stateUpdated: config.state };
      }
    } catch (err) {
      return {
        success: false,
        output: `[Agent ${config.agentName} 执行出错] ${String(err)}`,
        stateUpdated: config.state,
      };
    }

    return {
      success: true,
      output: `[模拟执行] Agent ${config.agentName} 已运行`,
      stateUpdated: config.state,
    };
  }

  static async getAgentTools(agentName: string): Promise<Array<{ id: string; name: string }>> {
    return [];
  }

  static buildToolList(
    agentTools: Array<{ id: string; name: string }>,
    additionalTools: Array<{ id: string; name: string }> = []
  ): Array<{ id: string; name: string }> {
    const toolMap = new Map<string, { id: string; name: string }>();
    for (const tool of agentTools) {
      toolMap.set(tool.id, tool);
    }
    for (const tool of additionalTools) {
      toolMap.set(tool.id, tool);
    }
    return Array.from(toolMap.values());
  }
}
