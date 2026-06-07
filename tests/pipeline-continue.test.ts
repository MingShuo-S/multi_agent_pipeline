import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WR, UID, PID, simpleTemplate2Stage, makeBaseState, makeStateStage1Running, makeSlotEntry, makeStageEntry } from './fixtures/templates.js';

const { mockFs, resetFs, setFile } = vi.hoisted(() => {
  const files = new Map<string, string>();
  const enoent = (p: string) => { const e = new Error(`ENOENT: ${p}`) as any; e.code = 'ENOENT'; throw e; };
  const norm = (p: string) => p.replace(/\\/g, '/');
  return {
    mockFs: {
      promises: {
        readFile: async (p: string) => { const k = norm(p); if (files.has(k)) return files.get(k)!; throw enoent(p); },
        writeFile: async (p: string, c: string, opt?: any) => { files.set(norm(p), c); },
        mkdir: async () => {},
        readdir: async (dir: string) => {
          const prefix = norm(dir) + '/';
          return [...files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length).split('/')[0]);
        },
        access: async (p: string) => { if (!files.has(norm(p))) throw enoent(p); },
        copyFile: async (src: string, dst: string) => {
          const sk = norm(src);
          if (files.has(sk)) files.set(norm(dst), files.get(sk)!);
        },
        unlink: async (p: string) => { const k = norm(p); if (files.has(k)) files.delete(k); },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

import { pipelineContinue } from '../src/tools/pipeline-continue.js';
import { SEED_TEMPLATES_DIR } from '../src/config.js';

const sdir = SEED_TEMPLATES_DIR.replace(/\\/g, '/');

function putTpl() {
  const json = JSON.stringify(simpleTemplate2Stage);
  setFile(`${WR}/templates/simple-2stage.json`, json);
  setFile(`${sdir}/templates/simple-2stage.json`, json);
}

describe('pipelineContinue', () => {
  beforeEach(() => { resetFs(); vi.clearAllMocks(); });

  it('无活跃项目返回 error', async () => {
    const result = await pipelineContinue(UID, 'ghost', '你好', WR);
    expect(result.status).toBe('error');
    expect(result.error).toContain('state not found');
  });

  describe('advance 推进', () => {
    it('从 stage 1 推进到完成（最后阶段推进）', async () => {
      putTpl();
      const state = makeStateStage1Running();
      setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(state));
      const result = await pipelineContinue(UID, PID, '下一阶段', WR);
      expect(result.status).toBe('completed');
      expect(result.message).toContain('已完成');
    });

    it('已完成项目不重复推进', async () => {
      putTpl();
      const state = makeBaseState({
        current_stage: 99,
        status: 'completed',
        slot_values: { topic: 'x', draft: 'y' },
        stage_history: [
          makeStageEntry(0, 'research', 'researcher', true),
          makeStageEntry(1, 'write', 'writer', true),
        ],
      });
      setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(state));
      const result = await pipelineContinue(UID, PID, '你好', WR);
      expect(result.status).toBe('completed');
      expect(result.message).toContain('已完成');
    });

    it('从 stage 0 推进到 stage 1', async () => {
      putTpl();
      const state = makeBaseState();
      setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(state));
      const result = await pipelineContinue(UID, PID, '下一阶段', WR);
      expect(result.status).toBe('stage_advanced');
      expect(result.action_taken).toBe('advanced');
    });
  });

  describe('isAdvanceSignal', () => {
    it('精确匹配推进关键词', async () => {
      const { isAdvanceSignal } = await import('../src/runtime/pipeline-utils.js');
      expect(isAdvanceSignal('下一阶段')).toBe(true);
      expect(isAdvanceSignal('next stage')).toBe(true);
      expect(isAdvanceSignal('完成')).toBe(true);
      expect(isAdvanceSignal('过')).toBe(true);
    });

    it('关键词带前缀/后缀', async () => {
      const { isAdvanceSignal } = await import('../src/runtime/pipeline-utils.js');
      expect(isAdvanceSignal('下一阶段 帮帮我')).toBe(true);
      expect(isAdvanceSignal('好了 下一阶段')).toBe(true);
    });

    it('非推进消息返回 false', async () => {
      const { isAdvanceSignal } = await import('../src/runtime/pipeline-utils.js');
      expect(isAdvanceSignal('请写一篇文章')).toBe(false);
      expect(isAdvanceSignal('你好')).toBe(false);
      expect(isAdvanceSignal('')).toBe(false);
    });

    it('大小写不敏感', async () => {
      const { isAdvanceSignal } = await import('../src/runtime/pipeline-utils.js');
      expect(isAdvanceSignal('Next Stage')).toBe(true);
      expect(isAdvanceSignal('ADVANCE')).toBe(true);
    });

    it('非精确匹配时不误判', async () => {
      const { isAdvanceSignal } = await import('../src/runtime/pipeline-utils.js');
      expect(isAdvanceSignal('完成度很高')).toBe(false);
      expect(isAdvanceSignal('下一步计划')).toBe(false);
    });
  });
});
