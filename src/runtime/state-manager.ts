// src/runtime/state-manager.ts - state.json 读写 + 版本历史追踪

import { promises as fs } from 'fs';
import path from 'path';
import { PipelineState, Template, SlotHistoryEntry, StageHistoryEntry, PipelineMode } from '../types.js';

export class StateManager {
  private statePath: string;

  constructor(workspaceRoot: string, userId: string, projectId: string) {
    this.statePath = path.join(
      workspaceRoot,
      'projects',
      userId,
      projectId,
      'state.json'
    );
  }

  async initialize(template: Template, mode: PipelineMode = 'relay'): Promise<PipelineState> {
    const state: PipelineState = {
      template_name: template.name,
      current_stage: 0,
      slot_values: {},
      slot_history: {},
      remarks: [],
      stage_history: [],
      status: 'running',
      mode,
    };

    for (const [slotName, slotDef] of Object.entries(template.slots)) {
      state.slot_values[slotName] = slotDef.default;
      state.slot_history[slotName] = [];
    }

    // 记录第一阶段开始
    if (template.stages.length > 0) {
      state.stage_history.push({
        stage: 0,
        stage_id: template.stages[0].id,
        agent: template.stages[0].agent,
        started_at: new Date().toISOString(),
        versions: 0,
      });
    }

    await this.save(state);
    return state;
  }

  async load(): Promise<PipelineState> {
    try {
      const content = await fs.readFile(this.statePath, 'utf-8');
      return JSON.parse(content) as PipelineState;
    } catch (err) {
      throw new Error(`Failed to load state from ${this.statePath}: ${err}`);
    }
  }

  async save(state: PipelineState): Promise<void> {
    try {
      const dir = path.dirname(this.statePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      throw new Error(`Failed to save state: ${err}`);
    }
  }

  /**
   * 写入 Slot 并追加版本历史（append-only）
   * slot_history[slotName] 数组独立追加，互不干扰
   */
  async updateSlot(slotName: string, content: string | object, agent: string): Promise<void> {
    const state = await this.load();

    if (!state.slot_history[slotName]) {
      state.slot_history[slotName] = [];
    }

    const version = state.slot_history[slotName].length;
    const entry: SlotHistoryEntry = {
      content,
      written_at: new Date().toISOString(),
      version,
      agent,
    };

    state.slot_history[slotName].push(entry);
    state.slot_values[slotName] = content;
    await this.save(state);
  }

  /**
   * 获取 Slot 的完整版本历史
   */
  async getSlotHistory(slotName: string): Promise<SlotHistoryEntry[]> {
    const state = await this.load();
    return state.slot_history[slotName] || [];
  }

  /**
   * 添加 Remark（带版本号，独立追加）
   */
  async addRemark(agentName: string, content: string): Promise<void> {
    const state = await this.load();
    const version = state.remarks.length;
    state.remarks.push({
      agent: agentName,
      content,
      timestamp: new Date().toISOString(),
      version,
    });
    await this.save(state);
  }

  /**
   * 推进到下一阶段
   */
  async advanceStage(): Promise<PipelineState> {
    const state = await this.load();
    return await this.advanceStageFrom(state);
  }

  private async advanceStageFrom(state: PipelineState): Promise<PipelineState> {
    // 标记当前阶段完成
    const current = state.stage_history.find(h => h.stage === state.current_stage && !h.completed_at);
    if (current) {
      current.completed_at = new Date().toISOString();
    }

    state.current_stage += 1;
    
    // 记录新阶段开始
    const template = await this.loadTemplateFromState(state);
    if (state.current_stage < template.stages.length) {
      const nextStage = template.stages[state.current_stage];
      state.stage_history.push({
        stage: state.current_stage,
        stage_id: nextStage.id,
        agent: nextStage.agent,
        started_at: new Date().toISOString(),
        versions: 0,
      });
    }

    await this.save(state);
    return state;
  }

  /**
   * 完成当前阶段（不推进），用于 relay 模式用户确认
   */
  async completeCurrentStage(): Promise<void> {
    const state = await this.load();
    const current = state.stage_history.find(h => h.stage === state.current_stage && !h.completed_at);
    if (current) {
      current.completed_at = new Date().toISOString();
    }
    await this.save(state);
  }

  async setStatus(status: 'running' | 'paused' | 'completed' | 'failed'): Promise<void> {
    const state = await this.load();
    state.status = status;
    await this.save(state);
  }

  async setAuthor(author: string): Promise<void> {
    const state = await this.load();
    state.author = author;
    await this.save(state);
  }

  private async loadTemplateFromState(state: PipelineState): Promise<Template> {
    const { WorkspaceConfigManager } = await import('../tools/workspace-config.js');
    const { SEED_TEMPLATES_DIR } = await import('../config.js');
    const configManager = new WorkspaceConfigManager(SEED_TEMPLATES_DIR);
    return await configManager.readTemplate(state.template_name);
  }

  /**
   * 扫描工作区，找到唯一 status='running' 的活跃 state
   */
  static async findActiveState(workspaceRoot: string): Promise<{ userId: string; projectId: string; state: PipelineState } | null> {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const projectsDir = path.default.join(workspaceRoot, 'projects');
    try {
      const userDirs = await fs.readdir(projectsDir);
      for (const userId of userDirs) {
        const userPath = path.default.join(projectsDir, userId);
        let projectDirs: string[];
        try {
          projectDirs = await fs.readdir(userPath);
        } catch {
          continue;
        }
        for (const projectId of projectDirs) {
          const statePath = path.default.join(userPath, projectId, 'state.json');
          try {
            const content = await fs.readFile(statePath, 'utf-8');
            const state: PipelineState = JSON.parse(content);
            if (state.status === 'running') {
              return { userId, projectId, state };
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
    }
    return null;
  }
}
