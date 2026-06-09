import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Template } from '../src/types.js';
import { SEED_TEMPLATES_DIR } from '../src/config.js';

const _norm = (p: string) => p.replace(/\\/g, '/');

const mkdirCalls: string[] = [];

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
      promises: {
        readFile: async (p: string) => {
          const k = norm(p);
          if (files.has(k)) return files.get(k)!;
          throw enoent(p);
        },
        writeFile: async (p: string, c: string) => { files.set(norm(p), c); },
        mkdir: async (p: string) => { mkdirCalls.push(norm(p)); },
        readdir: async (dir: string) => {
          const prefix = norm(dir) + '/';
          const entries = [...files.keys()]
            .filter(k => k.startsWith(prefix))
            .map(k => k.slice(prefix.length).split('/')[0]);
          return [...new Set(entries)];
        },
        access: async (p: string) => {
          if (!files.has(norm(p))) throw enoent(p);
        },
        unlink: async (p: string) => {
          const k = norm(p);
          files.delete(k);
        },
        copyFile: async (src: string, dst: string) => {
          const sk = norm(src);
          if (files.has(sk)) files.set(norm(dst), files.get(sk)!);
        },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => { files.clear(); mkdirCalls.length = 0; },
  };
});

vi.mock('fs', () => mockFs);

const WR = 'C:/workspace';
const UID = 'user-1';
const PID = 'new-project-001';

const templateDir = _norm(SEED_TEMPLATES_DIR);

const testTemplate: Template = {
  name: 'test', description: 'test',
  stages: [{ id: 's1', agent: 'a1', checkpoint: true, allow_read: ['*'], allow_write: ['out'] }],
  slots: { out: { type: 'text', default: '' } },
};

import { StateManager } from '../src/runtime/state-manager.js';

describe('withLock mkdir fix - 全新项目不报 ENOENT', () => {
  let sm: StateManager;

  beforeEach(() => {
    resetFs();
    vi.clearAllMocks();
    setFile(`${templateDir}/templates/test.json`, JSON.stringify(testTemplate));
    setFile(`${WR}/templates/test.json`, JSON.stringify(testTemplate));
    sm = new StateManager(WR, UID, PID);
  });

  it('initialize 在不存在的目录下成功', async () => {
    const state = await sm.initialize(testTemplate);
    expect(state.status).toBe('running');
    expect(state.current_stage).toBe(0);
  });

  it('mkdir 被调用创建项目目录', async () => {
    mkdirCalls.length = 0;
    await sm.initialize(testTemplate);
    expect(mkdirCalls.some(p => p.includes(`projects/${UID}/${PID}`))).toBe(true);
  });

  it('initialize 后 load 一致', async () => {
    await sm.initialize(testTemplate);
    const loaded = await sm.load();
    expect(loaded.template_name).toBe('test');
    expect(loaded.status).toBe('running');
  });

  it('updateSlot 在全新目录下也能工作', async () => {
    await sm.initialize(testTemplate);
    await sm.updateSlot('out', 'hello world', 'a1');
    const state = await sm.load();
    expect(state.slot_values.out).toBe('hello world');
    expect(state.slot_history.out).toHaveLength(1);
  });

  it('advanceStage 在全新目录下也能工作', async () => {
    await sm.initialize(testTemplate);
    const state = await sm.advanceStage();
    expect(state.current_stage).toBe(1);
  });
});
