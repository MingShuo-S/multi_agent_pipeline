import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Template } from '../src/types.js';
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
          if (!files.has(k)) throw enoent(p);
          files.delete(k);
        },
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

const testTemplate: Template = {
  name: 'test-template',
  description: 'test',
  stages: [
    { id: 's1', agent: 'agent-a', checkpoint: true, allow_read: ['*'], allow_write: ['slot1'] },
    { id: 's2', agent: 'agent-b', checkpoint: false, allow_read: ['slot1'], allow_write: ['slot2'] },
  ],
  slots: {
    slot1: { type: 'text', default: '' },
    slot2: { type: 'text', default: '' },
  },
};

import { StateManager } from '../src/runtime/state-manager.js';

// loadTemplateFromState uses SEED_TEMPLATES_DIR + /templates/ as base
const templateDir = _norm(SEED_TEMPLATES_DIR);

describe('StateManager', () => {
  let sm: StateManager;

  beforeEach(() => {
    resetFs();
    vi.clearAllMocks();
    // WorkspaceConfigManager(WR).readTemplate('test-template') reads from:
    //   path.join(WR, 'templates', 'test-template.json') => C:/workspace/templates/test-template.json
    // loadTemplateFromState (used by advanceStage) constructs a new WorkspaceConfigManager(this.workspaceRoot)
    // where this.workspaceRoot = WR = 'C:/workspace'
    setFile(`${WR}/templates/test-template.json`, JSON.stringify(testTemplate));
    // SEED_TEMPLATES_DIR path for workspace_config's initTemplate search
    setFile(`${templateDir}/templates/test-template.json`, JSON.stringify(testTemplate));
    sm = new StateManager(WR, UID, PID);
  });

  describe('initialize', () => {
    it('创建初始 state.json', async () => {
      const state = await sm.initialize(testTemplate);
      expect(state.status).toBe('running');
      expect(state.current_stage).toBe(0);
      expect(state.template_name).toBe('test-template');
      expect(state.stage_history).toHaveLength(1);
      expect(state.stage_history[0].stage).toBe(0);
      expect(state.stage_history[0].agent).toBe('agent-a');
    });

    it('初始化时 slots 填入默认值', async () => {
      const state = await sm.initialize(testTemplate);
      expect(state.slot_values).toHaveProperty('slot1');
      expect(state.slot_values).toHaveProperty('slot2');
      expect(state.slot_history).toHaveProperty('slot1');
      expect(state.slot_history).toHaveProperty('slot2');
    });

    it('初始化后 load 返回一致', async () => {
      await sm.initialize(testTemplate);
      const loaded = await sm.load();
      expect(loaded.template_name).toBe('test-template');
    });
  });

  describe('updateSlot', () => {
    it('写入 slot 并追加历史', async () => {
      await sm.initialize(testTemplate);
      await sm.updateSlot('slot1', 'hello', 'agent-a');
      const state = await sm.load();
      expect(state.slot_values.slot1).toBe('hello');
      expect(state.slot_history.slot1).toHaveLength(1);
      expect(state.slot_history.slot1[0].agent).toBe('agent-a');
      expect(state.slot_history.slot1[0].version).toBe(0);
    });

    it('多次写入堆叠版本', async () => {
      await sm.initialize(testTemplate);
      await sm.updateSlot('slot1', 'v1', 'agent-a');
      await sm.updateSlot('slot1', 'v2', 'agent-b');
      const history = await sm.getSlotHistory('slot1');
      expect(history).toHaveLength(2);
      expect(history[0].version).toBe(0);
      expect(history[1].version).toBe(1);
    });
  });

  describe('addRemark', () => {
    it('追加 remark 并带版本号', async () => {
      await sm.initialize(testTemplate);
      await sm.addRemark('agent-a', 'first remark');
      await sm.addRemark('agent-b', 'second remark');
      const state = await sm.load();
      expect(state.remarks).toHaveLength(2);
      expect(state.remarks[0].version).toBe(0);
      expect(state.remarks[1].version).toBe(1);
      expect(state.remarks[0].content).toBe('first remark');
    });
  });

  describe('advanceStage', () => {
    it('推进到下一阶段', async () => {
      await sm.initialize(testTemplate);
      const state = await sm.advanceStage();
      expect(state.current_stage).toBe(1);
      expect(state.stage_history).toHaveLength(2);
      expect(state.stage_history[0].completed_at).toBeDefined();
      expect(state.stage_history[1].agent).toBe('agent-b');
    });

    it('最后一阶段推进后不新增 stage', async () => {
      await sm.initialize(testTemplate);
      await sm.advanceStage(); // now at stage 1
      await sm.advanceStage(); // now at stage 2 (>= stages.length)
      const state = await sm.load();
      expect(state.stage_history).toHaveLength(2);
      expect(state.current_stage).toBe(2);
    });
  });

  describe('status management', () => {
    it('setStatus 更新状态', async () => {
      await sm.initialize(testTemplate);
      await sm.setStatus('paused');
      const state = await sm.load();
      expect(state.status).toBe('paused');
    });

    it('markStageFailed 设置失败并完成当前阶段', async () => {
      await sm.initialize(testTemplate);
      await sm.markStageFailed('agent-a', 'something broke');
      const state = await sm.load();
      expect(state.status).toBe('failed');
      expect(state.stage_history[0].completed_at).toBeDefined();
    });
  });

  describe('completeCurrentStage', () => {
    it('完成当前阶段但不推进', async () => {
      await sm.initialize(testTemplate);
      await sm.completeCurrentStage();
      const state = await sm.load();
      expect(state.stage_history[0].completed_at).toBeDefined();
      expect(state.current_stage).toBe(0);
    });
  });

  describe('setAuthor', () => {
    it('设置 author', async () => {
      await sm.initialize(testTemplate);
      await sm.setAuthor('someone');
      const state = await sm.load();
      expect(state.author).toBe('someone');
    });
  });

  describe('findActiveState', () => {
    it('找到 status=running 的活跃 state', async () => {
      setFile(`${WR}/projects/user2/proj2/state.json`, JSON.stringify({
        template_name: 't2', current_stage: 0, slot_values: {}, slot_history: {},
        remarks: [], stage_history: [], status: 'running', mode: 'relay' as const,
      }));
      setFile(`${WR}/projects/user3/proj3/state.json`, JSON.stringify({
        template_name: 't3', current_stage: 0, slot_values: {}, slot_history: {},
        remarks: [], stage_history: [], status: 'completed' as const, mode: 'relay' as const,
      }));
      const active = await StateManager.findActiveState(WR);
      expect(active).toBeDefined();
      expect(active!.userId).toBe('user2');
      expect(active!.state.status).toBe('running');
    });

    it('无活跃 state 返回 null', async () => {
      const active = await StateManager.findActiveState(WR);
      expect(active).toBeNull();
    });
  });
});
