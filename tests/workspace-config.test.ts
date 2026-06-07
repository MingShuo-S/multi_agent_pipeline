import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Template } from '../src/types.js';

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

import { WorkspaceConfigManager, workspaceConfig, initWorkspace } from '../src/tools/workspace-config.js';

const WR = 'C:/workspace';

const validTemplate: Template = {
  name: 'test',
  description: 'test template',
  stages: [
    { id: 's1', agent: 'a1', checkpoint: true, allow_read: ['*'], allow_write: ['s1out'] },
  ],
  slots: {
    s1out: { type: 'text', default: '' },
  },
};

describe('WorkspaceConfigManager', () => {
  let mgr: WorkspaceConfigManager;

  beforeEach(() => {
    resetFs();
    vi.clearAllMocks();
    mgr = new WorkspaceConfigManager(WR);
  });

  describe('listTemplates', () => {
    it('空目录返回空数组', async () => {
      const list = await mgr.listTemplates();
      expect(list).toEqual([]);
    });

    it('列出 .json 文件', async () => {
      setFile(`${WR}/templates/a.json`, '{}');
      setFile(`${WR}/templates/b.json`, '{}');
      setFile(`${WR}/templates/readme.md`, '');
      const list = await mgr.listTemplates();
      expect(list).toHaveLength(2);
      expect(list).toContain('a.json');
      expect(list).toContain('b.json');
    });
  });

  describe('readTemplate', () => {
    it('读取合法模板', async () => {
      setFile(`${WR}/templates/test.json`, JSON.stringify(validTemplate));
      const t = await mgr.readTemplate('test');
      expect(t.name).toBe('test');
      expect(t.stages).toHaveLength(1);
    });

    it('读取带 .json 后缀也正常工作', async () => {
      setFile(`${WR}/templates/mytpl.json`, JSON.stringify(validTemplate));
      const t = await mgr.readTemplate('mytpl.json');
      expect(t.name).toBe('test');
    });

    it('不存在的模板抛错', async () => {
      await expect(mgr.readTemplate('nonexistent')).rejects.toThrow('不存在');
    });

    it('结构无效的模板抛错', async () => {
      setFile(`${WR}/templates/bad.json`, JSON.stringify({ name: 'bad' }));
      await expect(mgr.readTemplate('bad')).rejects.toThrow('结构无效');
    });
  });

  describe('writeTemplate', () => {
    it('写入合法模板', async () => {
      await mgr.writeTemplate('new-tpl', validTemplate);
      const read = await mgr.readTemplate('new-tpl');
      expect(read.name).toBe('test');
    });

    it('无效模板抛错', async () => {
      const invalid = { name: 'x' } as any;
      await expect(mgr.writeTemplate('x', invalid)).rejects.toThrow('模板数据无效');
    });
  });

  describe('memory operations', () => {
    it('readMemory 返回空对象当文件不存在', async () => {
      const mem = await mgr.readMemory('user1', 'agent-a');
      expect(mem).toEqual({});
    });

    it('readMemory 读已有 profile', async () => {
      setFile(`${WR}/projects/user1/agents/agent-a-profile.json`, JSON.stringify({ style: 'formal' }));
      const mem = await mgr.readMemory('user1', 'agent-a');
      expect(mem).toEqual({ style: 'formal' });
    });

    it('writeMemory 后读回一致', async () => {
      await mgr.writeMemory('user1', 'agent-b', { preference: 'casual' });
      const mem = await mgr.readMemory('user1', 'agent-b');
      expect(mem).toEqual({ preference: 'casual' });
    });
  });

  describe('shared profile', () => {
    it('readSharedProfile 返回空对象当文件不存在', async () => {
      const p = await mgr.readSharedProfile('u1');
      expect(p).toEqual({});
    });

    it('writeSharedProfile 后读回一致', async () => {
      await mgr.writeSharedProfile('u1', { dna: { core: ['简洁'] } });
      const p = await mgr.readSharedProfile('u1');
      expect(p).toEqual({ dna: { core: ['简洁'] } });
    });
  });

  describe('resetTemplate', () => {
    it('删除模板文件', async () => {
      setFile(`${WR}/templates/todel.json`, JSON.stringify(validTemplate));
      await mgr.resetTemplate('todel');
      await expect(mgr.readTemplate('todel')).rejects.toThrow('不存在');
    });

    it('删除不存在的模板抛错', async () => {
      await expect(mgr.resetTemplate('ghost')).rejects.toThrow('Failed to reset');
    });
  });
});

describe('workspaceConfig (top-level dispatch)', () => {
  beforeEach(() => {
    resetFs();
    vi.clearAllMocks();
  });

  it('list_templates', async () => {
    const result = await workspaceConfig(WR, 'list_templates', {});
    expect(result).toEqual([]);
  });

  it('read_template', async () => {
    setFile(`${WR}/templates/t.json`, JSON.stringify(validTemplate));
    const result = await workspaceConfig(WR, 'read_template', { template_name: 't' });
    expect(result.name).toBe('test');
  });

  it('write_template', async () => {
    await workspaceConfig(WR, 'write_template', { template_name: 'new', content: validTemplate });
    const list = await workspaceConfig(WR, 'list_templates', {});
    expect(list).toContain('new.json');
  });

  it('unknown action 抛错', async () => {
    await expect(workspaceConfig(WR, 'unknown', {})).rejects.toThrow('Unknown action');
  });
});

describe('initWorkspace', () => {
  beforeEach(() => {
    resetFs();
    vi.clearAllMocks();
  });

  it('创建目录结构和默认模板', async () => {
    // Seed a template so initWorkspace copies it
    const { SEED_TEMPLATES_DIR } = await import('../src/config.js');
    setFile(`${SEED_TEMPLATES_DIR.replace(/\\/g, '/')}/seed.json`, JSON.stringify({
      name: 'seed', description: 'seed tpl',
      stages: [{ id: 's1', agent: 'a', checkpoint: true, allow_read: ['*'], allow_write: ['out'] }],
      slots: { out: { type: 'text', default: '' } },
    }));
    const result = await initWorkspace(WR);
    expect(result.created.length).toBeGreaterThanOrEqual(4);
    expect(result.message).toContain('工作区初始化完成');
    const mgr = new WorkspaceConfigManager(WR);
    const list = await mgr.listTemplates();
    expect(list).toContain('seed.json');
  });
});
