// src/runtime/checkpointers.ts - Checkpoint 存储接口 + JSON/SQLite 实现

import { promises as fs } from 'fs';
import path from 'path';
import type { PipelineState, SlotHistoryEntry } from '../types.js';

/**
 * Checkpoint 存储接口
 */
export interface Checkpointer {
  /** 保存完整 state */
  save(state: PipelineState): Promise<void>;
  /** 加载 state */
  load(): Promise<PipelineState | null>;
  /** 获取 slot 的版本历史 */
  getSlotHistory(slotName: string): Promise<SlotHistoryEntry[]>;
  /** 追加 slot 版本 */
  appendSlotVersion(slotName: string, entry: SlotHistoryEntry): Promise<void>;
  /** 获取指定版本的 slot 内容（time travel） */
  getSlotAtVersion(slotName: string, version: number): Promise<SlotHistoryEntry | null>;
}

/**
 * JSON 文件后端（当前实现）
 */
export class JsonCheckpointer implements Checkpointer {
  private statePath: string;

  constructor(statePath: string) {
    this.statePath = statePath;
  }

  async save(state: PipelineState): Promise<void> {
    const dir = path.dirname(this.statePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  async load(): Promise<PipelineState | null> {
    try {
      const content = await fs.readFile(this.statePath, 'utf-8');
      return JSON.parse(content) as PipelineState;
    } catch {
      return null;
    }
  }

  async getSlotHistory(slotName: string): Promise<SlotHistoryEntry[]> {
    const state = await this.load();
    return state?.slot_history[slotName] ?? [];
  }

  async appendSlotVersion(slotName: string, entry: SlotHistoryEntry): Promise<void> {
    const state = await this.load();
    if (!state) throw new Error('State not found');
    if (!state.slot_history[slotName]) {
      state.slot_history[slotName] = [];
    }
    state.slot_history[slotName].push(entry);
    state.slot_values[slotName] = entry.content;
    await this.save(state);
  }

  async getSlotAtVersion(slotName: string, version: number): Promise<SlotHistoryEntry | null> {
    const history = await this.getSlotHistory(slotName);
    return history[version] ?? null;
  }
}

/**
 * SQLite 后端
 */
export class SqliteCheckpointer implements Checkpointer {
  private dbPath: string;
  private db: any = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private async getDb(): Promise<any> {
    if (!this.db) {
      const Database = (await import('better-sqlite3')).default;
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.initTables();
    }
    return this.db;
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS slot_history (
        slot_name TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        written_at TEXT NOT NULL,
        agent TEXT NOT NULL,
        PRIMARY KEY (slot_name, version)
      );
    `);
  }

  async save(state: PipelineState): Promise<void> {
    const db = await this.getDb();
    db.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)')
      .run('pipeline_state', JSON.stringify(state));
  }

  async load(): Promise<PipelineState | null> {
    const db = await this.getDb();
    const row = db.prepare('SELECT value FROM state WHERE key = ?').get('pipeline_state') as any;
    return row ? JSON.parse(row.value) : null;
  }

  async getSlotHistory(slotName: string): Promise<SlotHistoryEntry[]> {
    const db = await this.getDb();
    const rows = db.prepare(
      'SELECT version, content, written_at, agent FROM slot_history WHERE slot_name = ? ORDER BY version'
    ).all(slotName) as any[];
    return rows.map(r => ({
      version: r.version,
      content: JSON.parse(r.content),
      written_at: r.written_at,
      agent: r.agent,
    }));
  }

  async appendSlotVersion(slotName: string, entry: SlotHistoryEntry): Promise<void> {
    const db = await this.getDb();
    db.prepare(
      'INSERT OR REPLACE INTO slot_history (slot_name, version, content, written_at, agent) VALUES (?, ?, ?, ?, ?)'
    ).run(slotName, entry.version, JSON.stringify(entry.content), entry.written_at, entry.agent);

    // 同步更新 state 中的 slot_values
    const state = await this.load();
    if (state) {
      state.slot_values[slotName] = entry.content;
      if (!state.slot_history[slotName]) {
        state.slot_history[slotName] = [];
      }
      state.slot_history[slotName].push(entry);
      await this.save(state);
    }
  }

  async getSlotAtVersion(slotName: string, version: number): Promise<SlotHistoryEntry | null> {
    const db = await this.getDb();
    const row = db.prepare(
      'SELECT version, content, written_at, agent FROM slot_history WHERE slot_name = ? AND version = ?'
    ).get(slotName, version) as any;
    return row ? {
      version: row.version,
      content: JSON.parse(row.content),
      written_at: row.written_at,
      agent: row.agent,
    } : null;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
