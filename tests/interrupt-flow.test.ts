import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Template, PipelineState, PipelineMode } from '../src/types.js';
import { SEED_TEMPLATES_DIR } from '../src/config.js';

const _norm = (p: string) => p.replace(/\\/g, '/');

const { mockFs, resetFs, setFile } = vi.hoisted(() => {
  const files = new Map<string, string>();
  const enoent = (p: string) => {
    const e = new Error(`ENOENT: ${p}`) as any;
    e.code = 'ENOENT';
    throw e;
  };
  const norm = (p: string) => p.replace(/\\/g, '/');
  return {
    mockFs: {
      mkdirSync: () => {},
      promises: {
        readFile: async (p: string) => {
          const k = norm(p);
          if (files.has(k)) return files.get(k)!;
          throw enoent(p);
        },
        writeFile: async (p: string, c: string) => { files.set(norm(p), c); },
        mkdir: async () => {},
        readdir: async (dir: string) => {
          const prefix = norm(dir) + '/';
          return [...new Set(
            [...files.keys()]
              .filter(k => k.startsWith(prefix))
              .map(k => k.slice(prefix.length).split('/')[0])
          )];
        },
        access: async (p: string) => { if (!files.has(norm(p))) throw enoent(p); },
        unlink: async (p: string) => { files.delete(norm(p)); },
        copyFile: async (src: string, dst: string) => {
          const sk = norm(src);
          if (files.has(sk)) files.set(norm(dst), files.get(sk)!);
        },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});

vi.mock('fs', () => mockFs);

const WR = 'C:/workspace';
const UID = 'user-1';
const PID = 'project-1';

const interruptTemplate: Template = {
  name: 'interrupt-test',
  description: '测试 interrupt 暂停点',
  stages: [
    { id: 'research', agent: 'researcher', checkpoint: true, allow_read: ['*'], allow_write: ['research'] },
    { id: 'write', agent: 'writer', checkpoint: true, allow_read: ['research'], allow_write: ['draft'] },
    { id: 'review', agent: 'reviewer', checkpoint: true, allow_read: ['draft'], allow_write: ['output'] },
  ],
  slots: {
    research: { type: 'text', default: '' },
    draft: { type: 'text', default: '' },
    output: { type: 'text', default: '' },
  },
  interrupts: [
    {
      stage: 'write',
      slot: 'draft',
      message: '草稿已完成。输入「继续」提交审核，或告诉我修改意见。',
      confirmKeywords: ['继续', '可以', '好的', 'ok'],
      reviseKeywords: ['改', '不要', '不行', '重写'],
    },
  ],
};

function makeState(overrides?: Partial<PipelineState>): PipelineState {
  return {
    template_name: 'interrupt-test',
    current_stage: 0,
    slot_values: { research: '', draft: '', output: '' },
    slot_history: { research: [], draft: [], output: [] },
    remarks: [],
    stage_history: [
      { stage: 0, stage_id: 'research', agent: 'researcher', started_at: '2025-01-01T00:00:00.000Z', versions: 0 },
    ],
    status: 'running',
    mode: 'relay' as PipelineMode,
    pending_interrupt: null,
    ...overrides,
  };
}

import { StateManager } from '../src/runtime/state-manager.js';

const templateDir = _norm(SEED_TEMPLATES_DIR);

describe('Interrupt 暂停点 (P0-3)', () => {
  let sm: StateManager;

  beforeEach(() => {
    resetFs();
    vi.clearAllMocks();
    setFile(`${templateDir}/templates/interrupt-test.json`, JSON.stringify(interruptTemplate));
    sm = new StateManager(WR, UID, PID);
  });

  it('初始化时 pending_interrupt 为 null', async () => {
    const state = await sm.initialize(interruptTemplate);
    expect(state.pending_interrupt).toBeNull();
  });

  it('setPendingInterrupt 设置 interrupt 并暂停', async () => {
    await sm.initialize(interruptTemplate);
    const interrupt = interruptTemplate.interrupts![0];
    await sm.setPendingInterrupt(interrupt);

    const state = await sm.load();
    expect(state.pending_interrupt).toBeDefined();
    expect(state.pending_interrupt!.stage).toBe('write');
    expect(state.pending_interrupt!.slot).toBe('draft');
    expect(state.status).toBe('paused');
  });

  it('setPendingInterrupt(null) 清除 interrupt 并恢复', async () => {
    await sm.initialize(interruptTemplate);
    const interrupt = interruptTemplate.interrupts![0];
    await sm.setPendingInterrupt(interrupt);
    await sm.setPendingInterrupt(null);

    const state = await sm.load();
    expect(state.pending_interrupt).toBeNull();
    expect(state.status).toBe('running');
  });

  it('InterruptPoint 类型包含必要字段', () => {
    const interrupt = interruptTemplate.interrupts![0];
    expect(interrupt).toHaveProperty('stage');
    expect(interrupt).toHaveProperty('slot');
    expect(interrupt).toHaveProperty('message');
    expect(interrupt).toHaveProperty('confirmKeywords');
    expect(interrupt).toHaveProperty('reviseKeywords');
    expect(Array.isArray(interrupt.confirmKeywords)).toBe(true);
    expect(Array.isArray(interrupt.reviseKeywords)).toBe(true);
  });

  it('confirmKeywords 包含预期关键词', () => {
    const interrupt = interruptTemplate.interrupts![0];
    expect(interrupt.confirmKeywords).toContain('继续');
    expect(interrupt.confirmKeywords).toContain('ok');
  });

  it('reviseKeywords 包含预期关键词', () => {
    const interrupt = interruptTemplate.interrupts![0];
    expect(interrupt.reviseKeywords).toContain('改');
    expect(interrupt.reviseKeywords).toContain('重写');
  });

  it('interrupt 在正确 stage 触发', () => {
    const interrupt = interruptTemplate.interrupts![0];
    expect(interrupt.stage).toBe('write');
  });

  it('没有定义 interrupts 的模板可以正常工作', async () => {
    const noInterruptTemplate: Template = {
      name: 'no-interrupt',
      description: '无 interrupt',
      stages: [
        { id: 's1', agent: 'a1', checkpoint: true, allow_read: ['*'], allow_write: ['out'] },
      ],
      slots: { out: { type: 'text', default: '' } },
    };
    setFile(`${templateDir}/templates/no-interrupt.json`, JSON.stringify(noInterruptTemplate));
    sm = new StateManager(WR, UID, 'proj-no-interrupt');
    const state = await sm.initialize(noInterruptTemplate);
    expect(state.pending_interrupt).toBeNull();
  });
});
