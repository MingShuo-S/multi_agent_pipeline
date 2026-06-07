// src/tools/memory.ts - 用户长期记忆管理

import { promises as fs } from 'fs';
import path from 'path';
import { ToolContext, AgentProfile } from '../types.js';
import { StyleSystem } from './style-system.js';

export class MemoryManager {
  private profilePath: string;

  constructor(workspaceRoot: string, userId: string, agentName: string) {
    this.profilePath = path.join(
      workspaceRoot,
      'projects',
      userId,
      'agents',
      `${agentName}-profile.json`
    );
  }

  async getProfile(): Promise<AgentProfile> {
    try {
      const content = await fs.readFile(this.profilePath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      return {
        agent: '',
        user_id: '',
        preferences: {},
        last_updated: new Date().toISOString(),
      };
    }
  }

  async recordFeedback(
    agentName: string,
    userId: string,
    preferenceUpdates: Partial<AgentProfile['preferences']>
  ): Promise<void> {
    try {
      let profile = await this.getProfile();

      if (!profile.agent) {
        profile.agent = agentName;
        profile.user_id = userId;
      }

      profile.preferences = {
        ...profile.preferences,
        ...preferenceUpdates,
      };

      profile.last_updated = new Date().toISOString();

      const dir = path.dirname(this.profilePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(this.profilePath, JSON.stringify(profile, null, 2), 'utf-8');

      const styleSystem = new StyleSystem(
        path.dirname(path.dirname(path.dirname(this.profilePath))),
        userId,
      );
      await styleSystem.ensureDirs();
    } catch (err) {
      console.error(`Failed to record feedback: ${err}`);
    }
  }
}

/**
 * style_get_profile - 获取用户对 Agent 的风格偏好
 */
export async function styleGetProfile(
  context: ToolContext
): Promise<AgentProfile['preferences']> {
  const manager = new MemoryManager(context.workspace_root, context.user_id, context.agent_name);
  const profile = await manager.getProfile();
  return profile.preferences || {};
}

/**
 * style_record_feedback - 更新用户风格偏好记录
 */
export async function styleRecordFeedback(
  context: ToolContext,
  preferenceUpdates: Partial<AgentProfile['preferences']>
): Promise<void> {
  const manager = new MemoryManager(context.workspace_root, context.user_id, context.agent_name);
  await manager.recordFeedback(context.agent_name, context.user_id, preferenceUpdates);
}

