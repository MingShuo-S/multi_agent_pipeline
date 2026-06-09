import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WR } from './fixtures/templates.js';

const { mockFs, resetFs, setFile, mkdirCalls, getFiles } = vi.hoisted(() => {
  const files = new Map<string, string>();
  const mkdirs: string[] = [];
  const norm = (p: string) => p.replace(/\\/g, '/');
  return {
    mockFs: {
      promises: {
        readFile: async (p: string) => { const k = norm(p); if (files.has(k)) return files.get(k)!; const e: any = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; },
        writeFile: async (p: string, c: string) => { files.set(norm(p), c); },
        mkdir: async (p: string) => { mkdirs.push(norm(p)); },
        readdir: async (dir: string) => {
          const prefix = norm(dir) + '/';
          const entries = [...files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length).split('/')[0]);
          return [...new Set(entries)];
        },
        copyFile: async (src: string, dst: string) => { const sk = norm(src); if (files.has(sk)) files.set(norm(dst), files.get(sk)!); },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => { files.clear(); mkdirs.length = 0; },
    mkdirCalls: mkdirs,
    getFiles: () => new Map(files),
  };
});
vi.mock('fs', () => mockFs);

import { initializeWorkspace } from '../src/install.js';

describe('initializeWorkspace', () => {
  beforeEach(() => { resetFs(); });

  it('创建所有必需目录', async () => {
    await initializeWorkspace();
    expect(mkdirCalls.some(d => d.endsWith('/templates'))).toBe(true);
    expect(mkdirCalls.some(d => d.endsWith('/projects'))).toBe(true);
    expect(mkdirCalls.some(d => d.endsWith('/agent-guides'))).toBe(true);
    expect(mkdirCalls.some(d => d.endsWith('/rules'))).toBe(true);
    expect(mkdirCalls.some(d => d.endsWith('/_profiles'))).toBe(true);
    expect(mkdirCalls.some(d => d.endsWith('__template__/profile'))).toBe(true);
    expect(mkdirCalls.some(d => d.endsWith('__template__/memory'))).toBe(true);
    expect(mkdirCalls.some(d => d.endsWith('__template__/logs'))).toBe(true);
  });

  it('创建 README 索引文件', async () => {
    await initializeWorkspace();
    const keys = [...getFiles().keys()];
    expect(keys.some(k => k.endsWith('/README.md'))).toBe(true);
    expect(keys.some(k => k.endsWith('/rules/README.md'))).toBe(true);
    expect(keys.some(k => k.endsWith('/templates/README.md'))).toBe(true);
    expect(keys.some(k => k.endsWith('/agent-guides/README.md'))).toBe(true);
  });

  it('创建 style-dna.json 模板', async () => {
    await initializeWorkspace();
    const files = getFiles();
    const k = [...files.keys()].find(k => k.includes('style-dna'));
    expect(k).toBeTruthy();
    expect(files.get(k!)).toContain('corePrinciples');
    expect(files.get(k!)).toContain('forbiddenPatterns');
  });

  it('创建 kb.json 模板', async () => {
    await initializeWorkspace();
    expect([...getFiles().keys()].some(k => k.endsWith('kb.json'))).toBe(true);
  });

  it('创建 persona.md 模板', async () => {
    await initializeWorkspace();
    const files = getFiles();
    const k = [...files.keys()].find(k => k.includes('persona'));
    expect(k).toBeTruthy();
    expect(files.get(k!)).toContain('用户画像');
  });

  it('创建 insights.md 模板', async () => {
    await initializeWorkspace();
    expect([...getFiles().keys()].some(k => k.includes('insights'))).toBe(true);
  });

  it('创建默认 pipeline 模板', async () => {
    await initializeWorkspace();
    const files = getFiles();
    const k = [...files.keys()].find(k => k.includes('xiaohongshu-creation'));
    expect(k).toBeTruthy();
    expect(files.get(k!)).toContain('topic-researcher');
    expect(files.get(k!)).toContain('content-writer');
  });

  it('复制 rules 种子文件', async () => {
    const rulesPath = process.cwd().replace(/\\/g, '/') + '/src/rules/temperature-layering.md';
    setFile(rulesPath, '# Temperature Layering Rule');
    await initializeWorkspace();
    expect([...getFiles().keys()].some(k => k.includes('/rules/temperature-layering'))).toBe(true);
  });
});
