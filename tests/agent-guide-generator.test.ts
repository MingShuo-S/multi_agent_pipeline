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
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

import { AgentGuideGenerator, agentGuideGenerator } from '../src/tools/agent-guide-generator.js';

const WR = 'C:/workspace';

describe('AgentGuideGenerator', () => {
  let gen: AgentGuideGenerator;

  beforeEach(() => { resetFs(); vi.clearAllMocks(); gen = new AgentGuideGenerator(WR); });

  describe('generateGuide', () => {
    it('生成新的协作指南', async () => {
      await gen.generateGuide('test-agent', '# Test Guide\n\n内容');
      const guide = await gen.readGuide('test-agent');
      expect(guide).toBe('# Test Guide\n\n内容');
    });

    it('append=false 覆盖已有文件', async () => {
      setFile(`${WR}/agent-guides/test-agent-guide.md`, '# Old Content');
      await gen.generateGuide('test-agent', '# New Content');
      const guide = await gen.readGuide('test-agent');
      expect(guide).toBe('# New Content');
    });

    it('append=true 追加到已有文件', async () => {
      setFile(`${WR}/agent-guides/test-agent-guide.md`, '# Part 1');
      await gen.generateGuide('test-agent', '# Part 2', true);
      const guide = await gen.readGuide('test-agent');
      expect(guide).toContain('# Part 1');
      expect(guide).toContain('# Part 2');
      expect(guide).toContain('---');
    });

    it('append=true 但文件不存在时直接写入', async () => {
      await gen.generateGuide('new-agent', '# Fresh', true);
      const guide = await gen.readGuide('new-agent');
      expect(guide).toBe('# Fresh');
    });
  });

  describe('readGuide', () => {
    it('不存在的文件返回 null', async () => {
      const guide = await gen.readGuide('ghost-agent');
      expect(guide).toBeNull();
    });

    it('读取已有指南', async () => {
      setFile(`${WR}/agent-guides/writer-guide.md`, '# Writer Guide\n\n规则');
      const guide = await gen.readGuide('writer');
      expect(guide).toBe('# Writer Guide\n\n规则');
    });
  });
});

describe('agentGuideGenerator (top-level)', () => {
  beforeEach(() => { resetFs(); vi.clearAllMocks(); });

  it('生成指南', async () => {
    await agentGuideGenerator(WR, 'top-agent', '# Top', false);
    const gen = new AgentGuideGenerator(WR);
    const guide = await gen.readGuide('top-agent');
    expect(guide).toBe('# Top');
  });

  it('追加指南', async () => {
    await agentGuideGenerator(WR, 'top-agent', '# First', false);
    await agentGuideGenerator(WR, 'top-agent', '# Second', true);
    const gen = new AgentGuideGenerator(WR);
    const guide = await gen.readGuide('top-agent');
    expect(guide).toContain('# First');
    expect(guide).toContain('# Second');
  });
});
