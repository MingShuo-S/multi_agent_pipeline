import { describe, it, expect, vi, beforeEach } from 'vitest';

const MOCK_ROOT = 'C:/workspace';

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
        access: async (p: string) => {
          const k = norm(p);
          if (files.has(k)) return;
          const prefix = k.endsWith('/') ? k : k + '/';
          if ([...files.keys()].some(fk => fk.startsWith(prefix))) return;
          const e: any = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e;
        },
        rename: async (src: string, dst: string) => {
          const sk = norm(src);
          const dk = norm(dst);
          const toMove = [...files.keys()].filter(k => k.startsWith(sk));
          for (const k of toMove) {
            const rel = k.slice(sk.length);
            files.set(dk + rel, files.get(k)!);
            files.delete(k);
          }
        },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => { files.clear(); mkdirs.length = 0; },
    mkdirCalls: mkdirs,
    getFiles: () => new Map(files),
  };
});
vi.mock('fs', () => mockFs);

vi.mock('../src/config.js', () => ({
  WORKSPACE_ROOT: 'C:/workspace',
  PROFILES_DIR: 'C:/workspace/_profiles',
  SEED_TEMPLATES_DIR: 'C:/workspace/templates',
  SHARED_DIR: 'C:/workspace/_profiles',
}));

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

  it('创建 profile.json 模板', async () => {
    await initializeWorkspace();
    const files = getFiles();
    const k = [...files.keys()].find(k => k.includes('profile.json') && k.includes('__template__'));
    expect(k).toBeTruthy();
    expect(files.get(k!)).toContain('corePrinciples');
    expect(files.get(k!)).toContain('forbiddenPatterns');
  });

  it('创建 memory.json 模板', async () => {
    await initializeWorkspace();
    expect([...getFiles().keys()].some(k => k.endsWith('memory.json'))).toBe(true);
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

  it('从 _shared/ 迁移到 _profiles/', async () => {
    setFile(`${MOCK_ROOT}/_shared/user-1/profile.json`, '{"version":1}');
    setFile(`${MOCK_ROOT}/_shared/user-1/memory.json`, '[]');
    await initializeWorkspace();
    const keys = [...getFiles().keys()];
    expect(keys.some(k => k.includes('/_profiles/user-1/profile.json'))).toBe(true);
    expect(keys.some(k => k.includes('/_shared'))).toBe(false);
  });

  it('从 kb_platform/ 迁移到 knowledge/', async () => {
    setFile(`${MOCK_ROOT}/kb_platform/rules.md`, '# rules');
    setFile(`${MOCK_ROOT}/kb_platform/faq.md`, '# faq');
    setFile(`${MOCK_ROOT}/kb_platform/data.json`, '{}');
    await initializeWorkspace();
    const keys = [...getFiles().keys()];
    expect(keys.some(k => k.includes('/knowledge/rules.md'))).toBe(true);
    expect(keys.some(k => k.includes('/knowledge/faq.md'))).toBe(true);
    expect(keys.some(k => k.includes('/knowledge/data.json'))).toBe(true);
    expect(keys.some(k => k.includes('/kb_platform'))).toBe(false);
  });

  it('新旧目录都存在时合并', async () => {
    setFile(`${MOCK_ROOT}/_shared/old-user/profile.json`, '{"old":true}');
    setFile(`${MOCK_ROOT}/_profiles/new-user/profile.json`, '{"new":true}');
    await initializeWorkspace();
    const keys = [...getFiles().keys()];
    expect(keys.some(k => k.includes('/_profiles/old-user/profile.json'))).toBe(true);
    expect(keys.some(k => k.includes('/_profiles/new-user/profile.json'))).toBe(true);
    expect(keys.some(k => k.includes('/_shared'))).toBe(false);
  });
});
