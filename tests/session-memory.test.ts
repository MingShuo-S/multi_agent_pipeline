import { describe, it, expect, vi, beforeEach } from 'vitest';

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
          return [...files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length).split('/')[0]);
        },
        stat: async (p: string) => { const k = norm(p); if (files.has(k)) return { size: files.get(k)!.length }; throw enoent(p); },
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

import type { KBEntry } from '../src/types.js';
import { autoCompress, shouldCompress } from '../src/tools/session-memory.js';
import { StyleSystem } from '../src/tools/style-system.js';

const WR = 'C:/workspace';
const UID = 'user-1';
function sharedDir() { return `${WR}/_profiles/${UID}`; }

function makeKB(content: string, overrides?: Partial<KBEntry>): KBEntry {
  return { userId: UID, category: 'insight', content, source: 'agent', timestamp: '', confidence: 'high', ...overrides };
}

describe('autoCompress', () => {
  beforeEach(() => { resetFs(); vi.clearAllMocks(); });

  it('KB 条目少于阈值时不压缩', async () => {
    const entries = Array.from({ length: 50 }, (_, i) => makeKB(`entry ${i}`));
    setFile(`${sharedDir()}/memory.json`, JSON.stringify(entries));
    const result = await autoCompress(WR, UID);
    expect(result.compressed).toEqual([]);
  });

  it('KB 条目超限时压缩 memory.json', async () => {
    const entries = Array.from({ length: 250 }, (_, i) =>
      makeKB(`entry ${i}`, { confidence: i < 200 ? 'high' : 'low' })
    );
    setFile(`${sharedDir()}/memory.json`, JSON.stringify(entries));
    const result = await autoCompress(WR, UID);
    expect(result.compressed).toContain('memory.json');
    expect(result.freed).toBeGreaterThan(0);
    const sys = new StyleSystem(WR, UID);
    const after = await sys.readKB();
    expect(after.length).toBeLessThan(entries.length);
    expect(after.length).toBe(220); // 200 high + 20 low
  });

  it('压缩过程中先迁移 legacy kb.json', async () => {
    const legacy = Array.from({ length: 250 }, (_, i) => makeKB(`legacy ${i}`));
    setFile(`${sharedDir()}/kb.json`, JSON.stringify(legacy));
    const result = await autoCompress(WR, UID);
    expect(result.compressed).toContain('memory.json');
    const sys = new StyleSystem(WR, UID);
    const after = await sys.readKB();
    expect(after.length).toBeGreaterThan(0);
  });

  it('insights.md 超长时压缩', async () => {
    const lines = Array.from({ length: 600 }, (_, i) => `- line ${i} with some padding to make each line long enough`);
    setFile(`${sharedDir()}/memory/insights.md`, lines.join('\n'));
    const result = await autoCompress(WR, UID);
    expect(result.compressed).toContain('insights.md');
  });

  it('insights.md 未超限时不压缩', async () => {
    setFile(`${sharedDir()}/memory/insights.md`, '# insights\n- short');
    const result = await autoCompress(WR, UID);
    expect(result.compressed).not.toContain('insights.md');
  });
});

describe('shouldCompress', () => {
  beforeEach(() => { resetFs(); vi.clearAllMocks(); });

  it('memory.json 超限时返回 true', async () => {
    const entries = Array.from({ length: 250 }, (_, i) => makeKB(`entry ${i}`));
    setFile(`${sharedDir()}/memory.json`, JSON.stringify(entries));
    expect(await shouldCompress(WR, UID)).toBe(true);
  });

  it('memory.json 未超限时返回 false', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => makeKB(`entry ${i}`));
    setFile(`${sharedDir()}/memory.json`, JSON.stringify(entries));
    expect(await shouldCompress(WR, UID)).toBe(false);
  });

  it('fallback 到 legacy kb.json', async () => {
    const entries = Array.from({ length: 250 }, (_, i) => makeKB(`entry ${i}`));
    setFile(`${sharedDir()}/kb.json`, JSON.stringify(entries));
    expect(await shouldCompress(WR, UID)).toBe(true);
  });

  it('两文件都不存在时返回 false', async () => {
    expect(await shouldCompress(WR, UID)).toBe(false);
  });
});
