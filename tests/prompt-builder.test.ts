import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WR, UID, PID, simpleTemplate2Stage, makeStateStage1Running, makeEmptyProfile } from './fixtures/templates.js';

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
        access: async () => {},
        unlink: async (p: string) => { const k = norm(p); if (files.has(k)) files.delete(k); },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

import { PromptBuilder } from '../src/runtime/prompt-builder.js';

describe('PromptBuilder', () => {
  let pb: PromptBuilder;

  beforeEach(() => { resetFs(); vi.clearAllMocks(); pb = new PromptBuilder(WR, UID, PID); });

  describe('buildPipelinePrompt', () => {
    it('包含所有关键 prompt 区块', async () => {
      const state = makeStateStage1Running();
      const prompt = await pb.buildPipelinePrompt('writer', simpleTemplate2Stage, state, null, '写一篇关于AI的文章');
      expect(prompt).toContain('【强制系统指令】');
      expect(prompt).toContain('【角色定位】');
      expect(prompt).toContain('writer');
      expect(prompt).toContain('【协作规则】');
      expect(prompt).toContain('pipeline_read');
      expect(prompt).toContain('pipeline_write_slot');
      expect(prompt).toContain('【当前管道上下文】');
      expect(prompt).toContain('【用户消息】');
      expect(prompt).toContain('写一篇关于AI的文章');
      expect(prompt).toContain('【阶段约束】');
      expect(prompt).toContain('stage 2/2');
    });

    it('无 userMessage 时使用任务提示', async () => {
      const state = makeStateStage1Running();
      const prompt = await pb.buildPipelinePrompt('writer', simpleTemplate2Stage, state, null);
      expect(prompt).toContain('【任务】');
      expect(prompt).toContain('完成本阶段工作');
      expect(prompt).not.toContain('【用户消息】');
    });

    it('profile 有偏好时包含长期记忆段', async () => {
      const state = makeStateStage1Running();
      const profile = {
        agent: 'writer',
        user_id: UID,
        preferences: { style: 'formal' },
        last_updated: '2025-01-01T00:00:00.000Z',
      };
      const prompt = await pb.buildPipelinePrompt('writer', simpleTemplate2Stage, state, profile, 'hello');
      expect(prompt).toContain('【长期记忆】');
      expect(prompt).toContain('formal');
    });

    it('profile 无偏好时不包含长期记忆段', async () => {
      const state = makeStateStage1Running();
      const profile = makeEmptyProfile();
      const prompt = await pb.buildPipelinePrompt('writer', simpleTemplate2Stage, state, profile, 'hello');
      expect(prompt).not.toContain('【长期记忆】');
    });

    it('包含协作指南当文件存在时', async () => {
      setFile(`${WR}/agent-guides/writer-guide.md`, '# Writer Guide\n\n协作规则');
      const state = makeStateStage1Running();
      const prompt = await pb.buildPipelinePrompt('writer', simpleTemplate2Stage, state, null, 'hello');
      expect(prompt).toContain('【协作指南】');
      expect(prompt).toContain('Writer Guide');
    });

    it('slot 内容正确格式化', async () => {
      const state = makeStateStage1Running();
      const prompt = await pb.buildPipelinePrompt('writer', simpleTemplate2Stage, state, null, 'hello');
      expect(prompt).toContain('research results');
    });

    it('空 slot 显示暂无内容', async () => {
      const emptyState = {
        ...makeStateStage1Running(),
        slot_values: { topic: '', draft: '' },
      };
      const prompt = await pb.buildPipelinePrompt('writer', simpleTemplate2Stage, emptyState, null, 'hello');
      expect(prompt).toContain('暂无 Slot 内容');
    });
  });
});
