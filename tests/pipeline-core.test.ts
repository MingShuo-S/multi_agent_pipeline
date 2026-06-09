import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WR, UID, PID, simpleTemplate2Stage, makeBaseState, makeSlotEntry, mockToolContext, mockToolContextWriter } from './fixtures/templates.js';

const { mockFs, resetFs, setFile } = vi.hoisted(() => {
  const files = new Map<string, string>();
  const enoent = (p: string) => { const e = new Error(`ENOENT: ${p}`) as any; e.code = 'ENOENT'; throw e; };
  const norm = (p: string) => p.replace(/\\/g, '/');
  return {
    mockFs: {
      mkdirSync: () => {},
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

describe('stale state — updateSlot 后 save 不覆盖 slot 数据', () => {
  beforeEach(() => { resetFs(); });

  it('updateSlot 后直接 save 旧 state 会覆盖 slot（验证 bug 存在）', async () => {
    const sm = new StateManager(WR, UID, PID);
    const initState = await sm.initialize(simpleTemplate2Stage);

    await sm.updateSlot('topic', 'research output', 'researcher');

    // 直接用旧内存 state save —— 这会覆盖 updateSlot 写入的 slot
    const staleState = { ...initState, current_stage: 2 };
    await sm.save(staleState);

    const reloaded = await sm.load();
    // slot 被覆盖为空（bug 的体现）
    expect(reloaded.slot_values.topic).toBe('');
    expect(reloaded.current_stage).toBe(2);
  });

  it('updateSlot 后 reload+save 保留 slot 数据（修复方案）', async () => {
    const sm = new StateManager(WR, UID, PID);
    await sm.initialize(simpleTemplate2Stage);

    await sm.updateSlot('topic', 'research output', 'researcher');

    // 修复方案：先 reload 再从磁盘 state 上修改
    const saved = await sm.load();
    saved.current_stage = 2;
    await sm.save(saved);

    const reloaded = await sm.load();
    expect(reloaded.slot_values.topic).toBe('research output');
    expect(reloaded.slot_history.topic).toHaveLength(1);
    expect(reloaded.current_stage).toBe(2);
  });

  it('多次 updateSlot append 后 reload 保留数组格式', async () => {
    const sm = new StateManager(WR, UID, PID);
    await sm.initialize(simpleTemplate2Stage);

    await sm.updateSlot('topic', '第一版', 'researcher');
    await sm.updateSlot('topic', '第二版', 'researcher', 'append');

    const state = await sm.load();
    expect(state.slot_values.topic).toEqual(['第一版', '第二版']);
    expect(state.slot_history.topic).toHaveLength(2);
  });

  it('autoAdvance 风格 reload 后 merge stage_history 并保留 slot', async () => {
    const sm = new StateManager(WR, UID, PID);
    const initState = await sm.initialize(simpleTemplate2Stage);

    await sm.updateSlot('topic', 'research data', 'researcher');
    await sm.updateSlot('draft', 'draft content', 'writer');

    // 模拟 autoAdvance 修复：reload → 改 current_stage → merge stage_history → save
    const fromDisk = await sm.load();
    fromDisk.current_stage = 2;
    // 模拟 stage_history 中 completed_at 的合并
    const stage0 = fromDisk.stage_history.find(h => h.stage === 0);
    if (stage0) stage0.completed_at = new Date().toISOString();
    // 补充下一阶段条目
    fromDisk.stage_history.push({
      stage: 1,
      stage_id: 'write',
      agent: 'writer',
      started_at: new Date().toISOString(),
      versions: 1,
    });
    await sm.save(fromDisk);

    const final = await sm.load();
    expect(final.current_stage).toBe(2);
    expect(final.slot_values.topic).toBe('research data');
    expect(final.slot_values.draft).toBe('draft content');
    expect(final.stage_history).toHaveLength(2);
    expect(final.stage_history.filter(h => h.completed_at)).toHaveLength(1);
  });
});
