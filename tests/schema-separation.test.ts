import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Template, PipelineSchema } from '../src/types.js';
import { SEED_TEMPLATES_DIR } from '../src/config.js';

const _norm = (p: string) => p.replace(/\\/g, '/');

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
      mkdirSync: () => {},
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
          return [...new Set(
            [...files.keys()]
              .filter(k => k.startsWith(prefix))
              .map(k => k.slice(prefix.length).split('/')[0])
          )];
        },
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

const WR = 'C:/workspace';
const UID = 'user-1';
const PID = 'project-1';

const testSchema: PipelineSchema = {
  input: {
    article_idea: { description: '用户输入的文章主题', type: 'string', required: true },
    target_audience: { description: '目标读者', type: 'string' },
  },
  working: {
    research_notes: { description: '调研笔记', type: 'string', reducer: 'append' },
    draft_content: { description: '草稿正文', type: 'string' },
  },
  output: {
    final_article: { description: '最终文章', type: 'string' },
  },
};

const schemaTemplate: Template = {
  name: 'schema-test',
  description: '测试 schema 分层',
  stages: [
    { id: 's1', agent: 'agent-a', checkpoint: true, allow_read: ['*'], allow_write: ['research_notes'] },
    { id: 's2', agent: 'agent-b', checkpoint: true, allow_read: ['article_idea', 'research_notes'], allow_write: ['draft_content'] },
    { id: 's3', agent: 'agent-c', checkpoint: true, allow_read: ['draft_content'], allow_write: ['final_article'] },
  ],
  slots: {},
  schema: testSchema,
};

import { StateManager } from '../src/runtime/state-manager.js';

const templateDir = _norm(SEED_TEMPLATES_DIR);

describe('Schema 分离 (P0-1)', () => {
  let sm: StateManager;

  beforeEach(() => {
    resetFs();
    vi.clearAllMocks();
    setFile(`${templateDir}/templates/schema-test.json`, JSON.stringify(schemaTemplate));
    sm = new StateManager(WR, UID, PID);
  });

  it('初始化时 schema 的三层 slot 都创建默认值', async () => {
    const state = await sm.initialize(schemaTemplate);
    // input
    expect(state.slot_values).toHaveProperty('article_idea');
    expect(state.slot_values).toHaveProperty('target_audience');
    // working
    expect(state.slot_values).toHaveProperty('research_notes');
    expect(state.slot_values).toHaveProperty('draft_content');
    // output
    expect(state.slot_values).toHaveProperty('final_article');
  });

  it('schema slot 的历史记录初始化为空数组', async () => {
    const state = await sm.initialize(schemaTemplate);
    expect(state.slot_history.article_idea).toEqual([]);
    expect(state.slot_history.research_notes).toEqual([]);
    expect(state.slot_history.final_article).toEqual([]);
  });

  it('schema slot 可正常写入和读取', async () => {
    await sm.initialize(schemaTemplate);
    await sm.updateSlot('article_idea', '南京烟火气', 'user');
    await sm.updateSlot('research_notes', '调研数据', 'agent-a');

    const state = await sm.load();
    expect(state.slot_values.article_idea).toBe('南京烟火气');
    expect(state.slot_values.research_notes).toBe('调研数据');
  });

  it('schema 和旧 slots 格式共存', async () => {
    const mixedTemplate: Template = {
      ...schemaTemplate,
      slots: {
        legacy_slot: { type: 'text', default: 'legacy' },
      },
    };
    const state = await sm.initialize(mixedTemplate);
    // schema slots
    expect(state.slot_values).toHaveProperty('article_idea');
    // legacy slot
    expect(state.slot_values).toHaveProperty('legacy_slot');
    expect(state.slot_values.legacy_slot).toBe('legacy');
  });

  it('schema slot 不覆盖已有值', async () => {
    const state = await sm.initialize(schemaTemplate);
    // 如果 schema 和 slots 都定义了同名 slot，slots 不覆盖 schema
    expect(state.slot_values.article_idea).toBe('');
  });
});
