import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WR, UID, PID, simpleTemplate2Stage, makeStateStage1Running } from './fixtures/templates.js';

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
        copyFile: async (src: string, dst: string) => {
          const sk = norm(src);
          if (files.has(sk)) files.set(norm(dst), files.get(sk)!);
        },
        unlink: async (p: string) => { const k = norm(p); if (!files.has(k)) throw enoent(p); files.delete(k); },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

import { pipelineStart } from '../src/tools/pipeline-start.js';
import { SEED_TEMPLATES_DIR } from '../src/config.js';

const tplDir = `${WR}/templates`;
const sdir = SEED_TEMPLATES_DIR.replace(/\\/g, '/');

function putTpl(name: string, tpl: object) {
  const json = JSON.stringify(tpl);
  setFile(`${tplDir}/${name}.json`, json);
  setFile(`${sdir}/templates/${name}.json`, json);
}

const singleCheckpoint = {
  name: 'single-checkpoint', description: 'single',
  stages: [{ id: 'only', agent: 'solo', checkpoint: true, allow_read: ['*'], allow_write: ['output'] }],
  slots: { output: { type: 'text', default: '' } },
};

describe('pipelineStart', () => {
  beforeEach(() => { resetFs(); vi.clearAllMocks(); });

  describe('参数校验', () => {
    it('缺少 template_name 返回 error', async () => {
      const result = await pipelineStart('', UID, PID, '', WR);
      expect(result.status).toBe('error');
      expect(result.error).toContain('template_name');
    });

    it('缺少 user_id 返回 error', async () => {
      const result = await pipelineStart('tpl', '', PID, '', WR);
      expect(result.status).toBe('error');
      expect(result.error).toContain('user_id');
    });

    it('缺少 project_id 返回 error', async () => {
      const result = await pipelineStart('tpl', UID, '', '', WR);
      expect(result.status).toBe('error');
      expect(result.error).toContain('project_id');
    });
  });

  describe('正常流程', () => {
    it('模板不存在时 init 后读取，首个为 checkpoint 时直接返回 initialized', async () => {
      putTpl('single-checkpoint', singleCheckpoint);
      const result = await pipelineStart('single-checkpoint', UID, PID, '', WR);
      // First stage is checkpoint → autoAdvance doesn't run → no subagent needed
      expect(result.status).toBe('initialized');
      expect(result.current_agent).toBe('solo');
      expect(result.total_stages).toBe(1);
    });

    it('已存在的运行项目返回存在提示', async () => {
      putTpl('simple-2stage', simpleTemplate2Stage);
      const state = makeStateStage1Running();
      setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify({ ...state, status: 'running' }));
      const result = await pipelineStart('simple-2stage', UID, PID, '', WR);
      expect(result.status).toBe('initialized');
      expect(result.message).toContain('已存在');
    });
  });
});
