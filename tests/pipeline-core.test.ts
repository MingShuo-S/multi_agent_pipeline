import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WR, UID, PID, simpleTemplate2Stage, makeBaseState, makeSlotEntry, mockToolContext, mockToolContextWriter } from './fixtures/templates.js';

const { mockFs, resetFs, setFile } = vi.hoisted(() => {
  const files = new Map<string, string>();
  const enoent = (p: string) => { const e = new Error(`ENOENT: ${p}`) as any; e.code = 'ENOENT'; throw e; };
  const norm = (p: string) => p.replace(/\\/g, '/');
  return {
    mockFs: {
      promises: {
        readFile: async (p: string) => { const k = norm(p); if (files.has(k)) return files.get(k)!; throw enoent(p); },
        writeFile: async (p: string, c: string) => { files.set(norm(p), c); },
        mkdir: async () => {},
        readdir: async (dir: string) => {
          const prefix = norm(dir) + '/';
          const entries = [...files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length).split('/')[0]);
          return [...new Set(entries)];
        },
        access: async (p: string) => { if (!files.has(norm(p))) throw enoent(p); },
        unlink: async (p: string) => { const k = norm(p); if (!files.has(k)) throw enoent(p); files.delete(k); },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

import { pipelineRead, pipelineWriteSlot, pipelineAddRemark } from '../src/tools/pipeline.js';
import { StateManager } from '../src/runtime/state-manager.js';

function primeState(stateJson: string) {
  setFile(`${WR}/projects/${UID}/${PID}/state.json`, stateJson);
}

describe('pipelineRead', () => {
  beforeEach(() => { resetFs(); vi.clearAllMocks(); });

  it('读取已由其他 agent 写入的 slot', async () => {
    const state = makeBaseState({
      current_stage: 1,
      slot_values: { topic: 'research output', draft: '' },
      slot_history: { topic: [makeSlotEntry('research output', 'researcher', 0)], draft: [] },
      stage_history: [
        { stage: 0, stage_id: 'research', agent: 'researcher', started_at: '2025-01-01T00:00:00.000Z', completed_at: '2025-01-01T00:01:00.000Z', versions: 1 },
        { stage: 1, stage_id: 'write', agent: 'writer', started_at: '2025-01-01T00:01:00.000Z', versions: 0 },
      ],
    });
    primeState(JSON.stringify(state));
    const val = await pipelineRead(mockToolContextWriter, 'topic', simpleTemplate2Stage);
    expect(val).toBe('research output');
  });

  it('空 slot 返回提示信息', async () => {
    primeState(JSON.stringify(makeBaseState()));
    const val = await pipelineRead(mockToolContext, 'topic', simpleTemplate2Stage);
    expect(val).toContain('当前为空');
  });

  it('不存在的 slot 返回提示信息', async () => {
    primeState(JSON.stringify(makeBaseState()));
    const val = await pipelineRead(mockToolContext, 'nonexistent', simpleTemplate2Stage);
    expect(val).toContain('尚无内容');
  });

  it('拒绝无读权限的 agent（stage 1 writer 不能读 draft）', async () => {
    const state = makeBaseState({
      current_stage: 1,
      slot_values: { topic: 'data', draft: 'secret' },
      slot_history: { topic: [makeSlotEntry('data', 'researcher', 0)], draft: [makeSlotEntry('secret', 'nobody', 0)] },
      stage_history: [
        { stage: 0, stage_id: 'research', agent: 'researcher', started_at: '2025-01-01T00:00:00.000Z', completed_at: '2025-01-01T00:01:00.000Z', versions: 1 },
        { stage: 1, stage_id: 'write', agent: 'writer', started_at: '2025-01-01T00:01:00.000Z', versions: 0 },
      ],
    });
    primeState(JSON.stringify(state));
    await expect(pipelineRead(mockToolContextWriter, 'draft', simpleTemplate2Stage))
      .rejects.toThrow('not allowed');
  });
});

describe('pipelineWriteSlot', () => {
  beforeEach(() => { resetFs(); vi.clearAllMocks(); });

  it('写入合法 slot 成功', async () => {
    primeState(JSON.stringify(makeBaseState()));
    await pipelineWriteSlot(mockToolContext, 'topic', 'my research', simpleTemplate2Stage);
    const sm = new StateManager(WR, UID, PID);
    const state = await sm.load();
    expect(state.slot_values.topic).toBe('my research');
  });

  it('拒绝无写权限的 agent', async () => {
    primeState(JSON.stringify(makeBaseState()));
    await expect(pipelineWriteSlot(mockToolContext, 'draft', 'content', simpleTemplate2Stage))
      .rejects.toThrow('not allowed');
  });

  it('写入不存在的 slot 抛错', async () => {
    primeState(JSON.stringify(makeBaseState()));
    await expect(pipelineWriteSlot(mockToolContext, 'ghost', 'x', simpleTemplate2Stage))
      .rejects.toThrow('not allowed');
  });

  it('写入 object 类型', async () => {
    primeState(JSON.stringify(makeBaseState()));
    await pipelineWriteSlot(mockToolContext, 'topic', { key: 'val' }, simpleTemplate2Stage);
    const sm = new StateManager(WR, UID, PID);
    const state = await sm.load();
    expect(state.slot_values.topic).toEqual({ key: 'val' });
  });
});

describe('pipelineAddRemark', () => {
  beforeEach(() => { resetFs(); vi.clearAllMocks(); });

  it('追加 remark 到 state', async () => {
    primeState(JSON.stringify(makeBaseState()));
    await pipelineAddRemark(mockToolContext, '需要更多数据');
    const sm = new StateManager(WR, UID, PID);
    const state = await sm.load();
    expect(state.remarks).toHaveLength(1);
    expect(state.remarks[0].content).toBe('需要更多数据');
    expect(state.remarks[0].agent).toBe('orchestrator');
    expect(state.remarks[0].version).toBe(0);
  });

  it('多次追加 remark 版本递增', async () => {
    primeState(JSON.stringify(makeBaseState()));
    await pipelineAddRemark(mockToolContext, 'remark 1');
    await pipelineAddRemark(mockToolContext, 'remark 2');
    const sm = new StateManager(WR, UID, PID);
    const state = await sm.load();
    expect(state.remarks).toHaveLength(2);
    expect(state.remarks[1].version).toBe(1);
  });
});
