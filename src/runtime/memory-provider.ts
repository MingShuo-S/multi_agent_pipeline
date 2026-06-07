// src/runtime/memory-provider.ts - MemoryProvider 接口定义 (P2-9)
// 为后续换 SQLite/Honcho 后端做准备

import type { AgentProfile, KBEntry, StyleProfile } from '../types.js';

/**
 * MemoryProvider 接口
 *
 * 抽象 Agent 记忆的读写操作，当前实现用文件系统，
 * 后续可替换为 SQLite/Honcho 等后端。
 */
export interface MemoryProvider {
  // ---- Agent Profile ----
  getProfile(agent: string, userId: string): Promise<AgentProfile | null>;
  setProfile(agent: string, userId: string, profile: AgentProfile): Promise<void>;

  // ---- Knowledge Base ----
  readKB(userId: string, category?: string): Promise<KBEntry[]>;
  writeKB(userId: string, entry: KBEntry): Promise<void>;

  // ---- Style Profile ----
  getStyleProfile(userId: string): Promise<StyleProfile | null>;
  setStyleProfile(userId: string, profile: StyleProfile): Promise<void>;

  // ---- Insights ----
  readInsights(userId: string): Promise<string | null>;
  appendInsight(userId: string, content: string, agent: string): Promise<void>;
}

/**
 * 文件系统实现（当前默认）
 */
export class FileSystemMemoryProvider implements MemoryProvider {
  constructor(private workspaceRoot: string) {}

  async getProfile(agent: string, userId: string): Promise<AgentProfile | null> {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const profilePath = path.default.join(
      this.workspaceRoot, 'projects', userId, 'agents', `${agent}-profile.json`
    );
    try {
      const content = await fs.readFile(profilePath, 'utf-8');
      return JSON.parse(content) as AgentProfile;
    } catch {
      return null;
    }
  }

  async setProfile(agent: string, userId: string, profile: AgentProfile): Promise<void> {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const profilePath = path.default.join(
      this.workspaceRoot, 'projects', userId, 'agents', `${agent}-profile.json`
    );
    await fs.mkdir(path.default.dirname(profilePath), { recursive: true });
    await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), 'utf-8');
  }

  async readKB(userId: string, category?: string): Promise<KBEntry[]> {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const kbPath = path.default.join(this.workspaceRoot, '_shared', userId, 'kb.json');
    try {
      const content = await fs.readFile(kbPath, 'utf-8');
      const entries: KBEntry[] = JSON.parse(content);
      return category ? entries.filter(e => e.category === category) : entries;
    } catch {
      return [];
    }
  }

  async writeKB(userId: string, entry: KBEntry): Promise<void> {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const kbPath = path.default.join(this.workspaceRoot, '_shared', userId, 'kb.json');
    let entries: KBEntry[] = [];
    try {
      const content = await fs.readFile(kbPath, 'utf-8');
      entries = JSON.parse(content);
    } catch {}
    entries.push(entry);
    await fs.mkdir(path.default.dirname(kbPath), { recursive: true });
    await fs.writeFile(kbPath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  async getStyleProfile(userId: string): Promise<StyleProfile | null> {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const profilePath = path.default.join(this.workspaceRoot, '_shared', userId, 'style-dna.json');
    try {
      const content = await fs.readFile(profilePath, 'utf-8');
      return JSON.parse(content) as StyleProfile;
    } catch {
      return null;
    }
  }

  async setStyleProfile(userId: string, profile: StyleProfile): Promise<void> {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const profilePath = path.default.join(this.workspaceRoot, '_shared', userId, 'style-dna.json');
    await fs.mkdir(path.default.dirname(profilePath), { recursive: true });
    await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), 'utf-8');
  }

  async readInsights(userId: string): Promise<string | null> {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const insightsPath = path.default.join(this.workspaceRoot, '_shared', userId, 'insights.md');
    try {
      return await fs.readFile(insightsPath, 'utf-8');
    } catch {
      return null;
    }
  }

  async appendInsight(userId: string, content: string, agent: string): Promise<void> {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const insightsPath = path.default.join(this.workspaceRoot, '_shared', userId, 'insights.md');
    const timestamp = new Date().toISOString();
    const entry = `\n[${timestamp}] (${agent}) ${content}\n`;
    await fs.mkdir(path.default.dirname(insightsPath), { recursive: true });
    try {
      await fs.appendFile(insightsPath, entry, 'utf-8');
    } catch {
      await fs.writeFile(insightsPath, `# Insights for ${userId}\n${entry}`, 'utf-8');
    }
  }
}
