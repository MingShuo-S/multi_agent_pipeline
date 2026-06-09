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
        readdir: async (dir: string, _opts?: any) => {
          const prefix = norm(dir) + '/';
          const names = [...files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
          return names.map(n => ({ name: n, isFile: () => true, isDirectory: () => false }));
        },
        access: async (p: string) => {
          const k = norm(p);
          if (files.has(k)) return;
          const prefix = k.endsWith('/') ? k : k + '/';
          if ([...files.keys()].some(fk => fk.startsWith(prefix))) return;
          throw enoent(p);
        },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

import { knowledgeRead } from '../src/tools/knowledge-reader.js';

const WR = 'C:/workspace';

describe('knowledgeRead', () => {
  beforeEach(() => { resetFs(); vi.clearAllMocks(); });

  it('无 docName 时返回文档列表', async () => {
    setFile(`${WR}/knowledge/rules.md`, '# rules');
    setFile(`${WR}/knowledge/faq.md`, '# faq');
    const result = await knowledgeRead(WR);
    expect(Array.isArray(result)).toBe(true);
    const docs = result as { name: string; content: string }[];
    expect(docs.length).toBe(2);
    expect(docs.find(d => d.name === 'rules.md')!.content).toBe('# rules');
    expect(docs.find(d => d.name === 'faq.md')!.content).toBe('# faq');
  });

  it('传 docName 时返回对应文档', async () => {
    setFile(`${WR}/knowledge/rules.md`, '# rules content');
    const result = await knowledgeRead(WR, 'rules.md');
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
    const doc = result as { name: string; content: string };
    expect(doc.name).toBe('rules.md');
    expect(doc.content).toBe('# rules content');
  });

  it('文档不存在返回 null', async () => {
    const result = await knowledgeRead(WR, 'nonexistent.md');
    expect(result).toBeNull();
  });

  it('目录不存在时返回空数组', async () => {
    const result = await knowledgeRead(WR);
    expect(result).toEqual([]);
  });

  it('只返回 .md 和 .txt 文件', async () => {
    setFile(`${WR}/knowledge/rules.md`, '# rules');
    setFile(`${WR}/knowledge/data.json`, '{}');
    setFile(`${WR}/knowledge/notes.txt`, 'notes');
    const result = await knowledgeRead(WR);
    const docs = result as { name: string }[];
    expect(docs.length).toBe(2);
    expect(docs.some(d => d.name === 'rules.md')).toBe(true);
    expect(docs.some(d => d.name === 'notes.txt')).toBe(true);
    expect(docs.some(d => d.name === 'data.json')).toBe(false);
  });
});
