// src/runtime/state-manager.ts - state.json 读写 + 版本历史追踪

import { promises as fs, mkdirSync as fsMkdirSync } from 'fs';
import path from 'path';
import { PipelineState, Template, SlotHistoryEntry, StageHistoryEntry, PipelineMode, SlotDef, Reducer } from '../types.js';
import { applyReducer } from './reducers.js';

const LOCK_RETRY_MS = 100;
const LOCK_TIMEOUT_MS = 5000;

export class StateManager {
  private statePath: string;
  private lockDir: string;
  private workspaceRoot: string;
  private userId: string;

  constructor(workspaceRoot: string, userId: string, projectId: string) {
    this.workspaceRoot = workspaceRoot;
    this.userId = userId;
    this.statePath = path.join(
      workspaceRoot,
      'projects',
      userId,
      projectId,
      'state.json'
    );
    this.lockDir = path.join(workspaceRoot, 'projects', userId, projectId);
  }

  /**
   * 对 state.json 的修改操作加锁，防止并发写丢失更新
   * callback 在锁内执行 load → mutate → save
   */
  private async withLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const lockFile = path.join(this.lockDir, '.state.lock');
    fsMkdirSync(this.lockDir, { recursive: true });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    let lastError: Error | null = null;

    while (Date.now() < deadline) {
      try {
        await fs.writeFile(lockFile, `${process.pid || 0}\n${label}`, { flag: 'wx' });
        break;
      } catch (err: any) {
        if (err.code !== 'EEXIST') throw err;
        try {
          const stale = await fs.readFile(lockFile, 'utf-8');
          const pid = parseInt(stale.split('\n')[0], 10);
          if (!isNaN(pid) && pid > 0) {
            try { process.kill(pid, 0); } catch {
              await fs.unlink(lockFile).catch(() => {});
              continue;
            }
          }
        } catch {}
        await new Promise(r => setTimeout(r, LOCK_RETRY_MS));
        lastError = err;
      }
    }

    if (Date.now() >= deadline && lastError) {
      throw new Error(`[state lock] 获取锁超时 (${LOCK_TIMEOUT_MS}ms) — ${label}: ${lastError.message}`);
    }

    try {
      return await fn();
    } finally {
      await fs.unlink(lockFile).catch(() => {});
    }
  }

  /**
   * 在锁内执行 load → mutate → save 循环
   */
  private async modifyState<T>(label: string, fn: (state: PipelineState) => T | Promise<T>): Promise<T> {
    return this.withLock(label, async () => {
      const state = await this.loadInternal();
      const result = await fn(state);
      await this.saveInternal(state);
      return result;
    });
  }

  private async loadInternal(): Promise<PipelineState> {
    try {
      const content = await fs.readFile(this.statePath, 'utf-8');
      return JSON.parse(content) as PipelineState;
    } catch (err: any) {
      const loadErr = new Error(`Failed to load state from ${this.statePath}: ${err}`);
      (loadErr as any).code = err?.code;
      throw loadErr;
    }
  }

  private async saveInternal(state: PipelineState): Promise<void> {
    try {
      const dir = path.dirname(this.statePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      throw new Error(`Failed to save state: ${err}`);
    }
  }

  async initialize(template: Template, mode: PipelineMode = 'relay'): Promise<PipelineState> {
    return this.withLock('initialize', async () => {
      const state: PipelineState = {
        template_name: template.name,
        current_stage: 0,
        slot_values: {},
        slot_history: {},
        remarks: [],
        stage_history: [],
        status: 'running',
        mode,
        pending_interrupt: null,
      };

      // P0-1: 支持 schema 分层初始化
      if (template.schema) {
        this.initSchemaSlots(state, template.schema.input);
        this.initSchemaSlots(state, template.schema.working);
        this.initSchemaSlots(state, template.schema.output);
      }

      // 兼容旧 slots 格式
      for (const [slotName, slotDef] of Object.entries(template.slots)) {
        if (!(slotName in state.slot_values)) {
          state.slot_values[slotName] = slotDef.default;
        }
        if (!state.slot_history[slotName]) {
          state.slot_history[slotName] = [];
        }
      }

      if (template.stages.length > 0) {
        state.stage_history.push({
          stage: 0,
          stage_id: template.stages[0].id,
          agent: template.stages[0].agent,
          started_at: new Date().toISOString(),
          versions: 0,
        });
      }

      await this.saveInternal(state);
      return state;
    });
  }

  private initSchemaSlots(state: PipelineState, slots: Record<string, SlotDef>): void {
    for (const [slotName, slotDef] of Object.entries(slots)) {
      const defaultVal = slotDef.default ?? '';
      state.slot_values[slotName] = defaultVal;
      state.slot_history[slotName] = [];
    }
  }

  async load(): Promise<PipelineState> {
    return this.loadInternal();
  }

  async save(state: PipelineState): Promise<void> {
    return this.withLock('save', async () => {
      await this.saveInternal(state);
    });
  }

  /**
   * 写入 Slot 并追加版本历史（append-only）
   * P0-2: 支持 reducer 合并策略
   */
  async updateSlot(slotName: string, content: string | object, agent: string, reducer: Reducer = 'replace'): Promise<void> {
    return this.modifyState(`updateSlot:${slotName}`, async (state) => {
      if (!state.slot_history[slotName]) {
        state.slot_history[slotName] = [];
      }
      const version = state.slot_history[slotName].length;

      // P0-2: 按 reducer 策略合并
      const current = state.slot_values[slotName];
      const merged = applyReducer(current, content, reducer);

      state.slot_history[slotName].push({
        content,
        written_at: new Date().toISOString(),
        version,
        agent,
      });
      state.slot_values[slotName] = merged as string | object;
    });
  }

  /**
   * 获取 Slot 的完整版本历史（只读，不加锁）
   */
  async getSlotHistory(slotName: string): Promise<SlotHistoryEntry[]> {
    const state = await this.loadInternal();
    return state.slot_history[slotName] || [];
  }

  /**
   * 添加 Remark（带版本号，独立追加）
   */
  async addRemark(agentName: string, content: string): Promise<void> {
    return this.modifyState('addRemark', async (state) => {
      const version = state.remarks.length;
      state.remarks.push({
        agent: agentName,
        content,
        timestamp: new Date().toISOString(),
        version,
      });
    });
  }

  /**
   * 推进到下一阶段
   */
  async advanceStage(): Promise<PipelineState> {
    return this.modifyState('advanceStage', async (state) => {
      const current = state.stage_history.find(h => h.stage === state.current_stage && !h.completed_at);
      if (current) {
        current.completed_at = new Date().toISOString();
      }

      state.current_stage += 1;

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

      return state;
    });
  }

  /**
   * 完成当前阶段（不推进）
   */
  async completeCurrentStage(): Promise<void> {
    return this.modifyState('completeCurrentStage', async (state) => {
      const current = state.stage_history.find(h => h.stage === state.current_stage && !h.completed_at);
      if (current) {
        current.completed_at = new Date().toISOString();
      }
    });
  }

  async setStatus(status: 'running' | 'paused' | 'completed' | 'failed'): Promise<void> {
    return this.modifyState('setStatus', async (state) => {
      state.status = status;
    });
  }

  async markStageFailed(agent: string, reason: string): Promise<void> {
    await this.modifyState('markStageFailed', async (state) => {
      state.status = 'failed';
      const current = state.stage_history.find(h => h.stage === state.current_stage && !h.completed_at);
      if (current) {
        current.completed_at = new Date().toISOString();
      }
    });
    const { StyleSystem } = await import('../tools/style-system.js');
    const system = new StyleSystem(this.workspaceRoot, this.userId);
    await system.appendInsight(`[错误恢复] agent [${agent}] stage 失败: ${reason}`, agent as any);
  }

  async setAuthor(author: string): Promise<void> {
    return this.modifyState('setAuthor', async (state) => {
      state.author = author;
    });
  }

  /**
   * P0-3: 设置/清除 pending interrupt
   */
  async setPendingInterrupt(interrupt: import('../types.js').InterruptPoint | null): Promise<void> {
    return this.modifyState('setPendingInterrupt', async (state) => {
      state.pending_interrupt = interrupt;
      if (interrupt) {
        state.status = 'paused';
      } else {
        state.status = 'running';
      }
    });
  }

  private async loadTemplateFromState(state: PipelineState): Promise<Template> {
    const { WorkspaceConfigManager } = await import('../tools/workspace-config.js');
    const configManager = new WorkspaceConfigManager(this.workspaceRoot);
    return await configManager.readTemplate(state.template_name);
  }

  /**
   * 扫描工作区，找到唯一的活跃 state。
   * 优先找 status='running'，回退找最近修改的 status='completed'。
   * 用于 pipeline_read/write_slot/add_remark 在管道完成后仍能定位项目。
   */
  static async findActiveState(workspaceRoot: string): Promise<{ userId: string; projectId: string; state: PipelineState } | null> {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const projectsDir = path.default.join(workspaceRoot, 'projects');
    let runningFound: { userId: string; projectId: string; state: PipelineState } | null = null;
    let completedFallback: { userId: string; projectId: string; state: PipelineState; mtime: number } | null = null;
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
              runningFound = { userId, projectId, state };
            } else if (state.status === 'completed') {
              const stat = await fs.stat(statePath).catch(() => null);
              const mtime = stat?.mtimeMs ?? 0;
              if (!completedFallback || mtime > completedFallback.mtime) {
                completedFallback = { userId, projectId, state, mtime };
              }
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
    }
    return runningFound || (completedFallback ? { userId: completedFallback.userId, projectId: completedFallback.projectId, state: completedFallback.state } : null);
  }
}
