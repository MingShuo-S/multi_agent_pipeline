import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineState, PipelineMode, SlotHistoryEntry } from '../src/types.js';

// Mock fs for JsonCheckpointer
const { mockFs, resetFs, setFile, getFile } = vi.hoisted(() => {
  const files = new Map<string, string>();
  const norm = (p: string) => p.replace(/\\/g, '/');
  return {
    mockFs: {
      promises: {
        readFile: async (p: string) => { const k = norm(p); if (files.has(k)) return files.get(k)!; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
        writeFile: async (p: string, c: string) => { files.set(norm(p), typeof c === 'string' ? c : String(c)); },
        mkdir: async () => {},
        appendFile: async (p: string, c: string) => { const k = norm(p); files.set(k, (files.get(k) || '') + c); },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    getFile: (path: string) => files.get(norm(path)),
    resetFs: () => files.clear(),
  };
});

vi.mock('fs', () => mockFs);

const WR = 'C:/workspace';
const UID = 'user-1';
const PID = 'project-1';

function makeState(overrides?: Partial<PipelineState>): PipelineState {
  return {
    template_name: 'test',
    current_stage: 0,
    slot_values: { topic: '', draft: '' },
    slot_history: { topic: [], draft: [] },
    remarks: [],
    stage_history: [],
    status: 'running',
    mode: 'relay' as PipelineMode,
    pending_interrupt: null,
    ...overrides,
  };
}

import { JsonCheckpointer } from '../src/runtime/checkpointers.js';

describe('JsonCheckpointer', () => {
  const statePath = `${WR}/projects/${UID}/${PID}/state.json`;
  let cp: JsonCheckpointer;

  beforeEach(() => {
    resetFs();
    cp = new JsonCheckpointer(statePath);
  });

  it('save + load 一致', async () => {
    const state = makeState();
    await cp.save(state);
    const loaded = await cp.load();
    expect(loaded?.template_name).toBe('test');
    expect(loaded?.status).toBe('running');
  });

  it('load 不存在时返回 null', async () => {
    const loaded = await cp.load();
    expect(loaded).toBeNull();
  });

  it('getSlotHistory 返回历史', async () => {
    const state = makeState({
      slot_history: {
        topic: [
          { content: 'v0', written_at: '2025-01-01T00:00:00Z', version: 0, agent: 'a1' },
          { content: 'v1', written_at: '2025-01-01T00:01:00Z', version: 1, agent: 'a2' },
        ],
        draft: [],
      },
    });
    await cp.save(state);
    const history = await cp.getSlotHistory('topic');
    expect(history).toHaveLength(2);
    expect(history[0].version).toBe(0);
    expect(history[1].version).toBe(1);
  });

  it('appendSlotVersion 追加版本', async () => {
    await cp.save(makeState());
    await cp.appendSlotVersion('topic', {
      content: 'new content',
      written_at: '2025-01-01T00:00:00Z',
      version: 0,
      agent: 'researcher',
    });
    const history = await cp.getSlotHistory('topic');
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('new content');
    expect(history[0].agent).toBe('researcher');
  });

  it('getSlotAtVersion 按版本查历史', async () => {
    const state = makeState({
      slot_history: {
        topic: [
          { content: 'v0', written_at: '2025-01-01T00:00:00Z', version: 0, agent: 'a1' },
          { content: 'v1', written_at: '2025-01-01T00:01:00Z', version: 1, agent: 'a2' },
        ],
        draft: [],
      },
    });
    await cp.save(state);
    const v0 = await cp.getSlotAtVersion('topic', 0);
    expect(v0?.content).toBe('v0');
    const v1 = await cp.getSlotAtVersion('topic', 1);
    expect(v1?.content).toBe('v1');
    const v99 = await cp.getSlotAtVersion('topic', 99);
    expect(v99).toBeNull();
  });
});
