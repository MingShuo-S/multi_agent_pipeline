import { vi, describe, it, expect } from 'vitest';
import { WR, UID, PID, simpleTemplate2Stage, makeBaseState } from './fixtures/templates.js';

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
        readdir: async (dir: string) => { const prefix = norm(dir) + '/'; return [...files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length).split('/')[0]); },
        access: async (p: string) => { if (!files.has(norm(p))) throw enoent(p); },
        copyFile: async (src: string, dst: string) => { const sk = norm(src); if (files.has(sk)) files.set(norm(dst), files.get(sk)!); },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

import { pipelineContinue } from '../src/tools/pipeline-continue.js';
import { SEED_TEMPLATES_DIR } from '../src/config.js';

describe('debug', () => {
  it('show error for advance stage 0', async () => {
    resetFs();
    const sdir = SEED_TEMPLATES_DIR.replace(/\\/g, '/');
    setFile(`${WR}/templates/simple-2stage.json`, JSON.stringify(simpleTemplate2Stage));
    setFile(`${sdir}/templates/simple-2stage.json`, JSON.stringify(simpleTemplate2Stage));
    setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(makeBaseState()));
    const result = await pipelineContinue(UID, PID, '下一阶段', WR);
    expect(result.status).toBe('stage_advanced');
    expect(result.action_taken).toBe('advanced');
  });
});
