// src/runtime/state-manager.ts - 管理 state.json 的读写

import { promises as fs } from 'fs';
import path from 'path';
import { PipelineState, Template } from '../types.js';

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

  async initialize(template: Template): Promise<PipelineState> {
    const state: PipelineState = {
      template_name: template.name,
      current_stage: 0,
      slot_values: {},
      remarks: [],
      status: 'running',
    };

    // 初始化所有 slot 为默认值
    for (const [slotName, slotDef] of Object.entries(template.slots)) {
      state.slot_values[slotName] = slotDef.default;
    }

    await this.save(state);
    return state;
  }

  async load(): Promise<PipelineState> {
    try {
      const content = await fs.readFile(this.statePath, 'utf-8');
      return JSON.parse(content);
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

  async updateSlot(slotName: string, content: string | object): Promise<void> {
    const state = await this.load();
    state.slot_values[slotName] = content;
    await this.save(state);
  }

  async addRemark(agentName: string, content: string): Promise<void> {
    const state = await this.load();
    state.remarks.push({
      agent: agentName,
      content,
      timestamp: new Date().toISOString(),
    });
    await this.save(state);
  }

  async advanceStage(): Promise<void> {
    const state = await this.load();
    state.current_stage += 1;
    await this.save(state);
  }

  async setStatus(status: 'running' | 'paused' | 'completed' | 'failed'): Promise<void> {
    const state = await this.load();
    state.status = status;
    await this.save(state);
  }
}
