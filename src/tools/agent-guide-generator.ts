// src/tools/agent-guide-generator.ts - Agent 协作指南生成

import { promises as fs } from 'fs';
import path from 'path';

export class AgentGuideGenerator {
  constructor(private workspaceRoot: string) {}

  async generateGuide(agentName: string, instructions: string, append: boolean = false): Promise<void> {
    const guidePath = path.join(this.workspaceRoot, 'agent-guides', `${agentName}-guide.md`);

    try {
      const dir = path.dirname(guidePath);
      await fs.mkdir(dir, { recursive: true });

      let content = instructions;

      if (append) {
        try {
          const existing = await fs.readFile(guidePath, 'utf-8');
          content = existing + '\n\n---\n\n' + instructions;
        } catch {
          // 文件不存在，直接写入
        }
      }

      await fs.writeFile(guidePath, content, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to generate agent guide: ${err}`);
    }
  }

  async readGuide(agentName: string): Promise<string | null> {
    const guidePath = path.join(this.workspaceRoot, 'agent-guides', `${agentName}-guide.md`);
    try {
      return await fs.readFile(guidePath, 'utf-8');
    } catch {
      return null;
    }
  }
}

/**
 * agent_guide_generator - 生成或更新 Agent 协作指南
 */
export async function agentGuideGenerator(
  workspaceRoot: string,
  agentName: string,
  instructions: string,
  append: boolean = false
): Promise<void> {
  const generator = new AgentGuideGenerator(workspaceRoot);
  await generator.generateGuide(agentName, instructions, append);
}


