import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Template, PipelineState, PipelineMode } from '../src/types.js';

const _norm = (p: string) => p.replace(/\\/g, '/');

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
          return [...new Set([...files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length).split('/')[0]))];
        },
        access: async (p: string) => { if (!files.has(norm(p))) throw enoent(p); },
        unlink: async (p: string) => { files.delete(norm(p)); },
        copyFile: async (src: string, dst: string) => { const sk = norm(src); if (files.has(sk)) files.set(norm(dst), files.get(sk)!); },
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

const testTemplate: Template = {
  name: 'test-display',
  description: 'test pipeline display',
  stages: [
    { id: 'research', agent: 'researcher', checkpoint: true, allow_read: ['*'], allow_write: ['topic'] },
    { id: 'write', agent: 'writer', checkpoint: true, allow_read: ['topic'], allow_write: ['draft'] },
  ],
  slots: {
    topic: { type: 'text', default: '' },
    draft: { type: 'text', default: '' },
  },
};

function makeState(overrides?: Partial<PipelineState>): PipelineState {
  return {
    template_name: 'test-display',
    current_stage: 0,
    slot_values: { topic: '', draft: '' },
    slot_history: { topic: [], draft: [] },
    remarks: [],
    stage_history: [
      { stage: 0, stage_id: 'research', agent: 'researcher', started_at: '2025-01-01T00:00:00.000Z', versions: 0 },
    ],
    status: 'running',
    mode: 'relay' as PipelineMode,
    pending_interrupt: null,
    ...overrides,
  };
}

import { pipelineDisplay } from '../src/tools/pipeline-display.js';
import { SEED_TEMPLATES_DIR } from '../src/config.js';

const templateDir = _norm(SEED_TEMPLATES_DIR);

describe('pipelineDisplay', () => {
  beforeEach(() => {
    resetFs();
    vi.clearAllMocks();
    setFile(`${templateDir}/templates/test-display.json`, JSON.stringify(testTemplate));
    setFile(`${WR}/templates/test-display.json`, JSON.stringify(testTemplate));
  });

  it('无产出时返回等待提示', async () => {
    setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(makeState()));
    const result = await pipelineDisplay(UID, PID, WR);
    expect(result).toContain('尚未产出内容');
    expect(result).toContain('researcher');
  });

  it('有 slot 产出时返回格式化内容', async () => {
    const state = makeState({
      slot_values: { topic: '南京美食探店', draft: '' },
      slot_history: {
        topic: [{
          content: '南京美食探店',
          written_at: '2025-01-01T00:01:00.000Z',
          version: 0,
          agent: 'researcher',
        }],
        draft: [],
      },
    });
    setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(state));
    const result = await pipelineDisplay(UID, PID, WR);
    expect(result).toContain('topic');
    expect(result).toContain('南京美食探店');
    expect(result).toContain('researcher');
  });

  it('有 remark 时展示评论和相关内容', async () => {
    const state = makeState({
      slot_values: { topic: '南京美食探店', draft: '' },
      slot_history: {
        topic: [{
          content: '南京美食探店',
          written_at: '2025-01-01T00:01:00.000Z',
          version: 0,
          agent: 'researcher',
        }],
        draft: [],
      },
      remarks: [{
        agent: 'researcher',
        content: '建议聚焦科巷美食街',
        timestamp: '2025-01-01T00:02:00.000Z',
        version: 0,
      }],
    });
    setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(state));
    const result = await pipelineDisplay(UID, PID, WR);
    expect(result).toContain('评论');
    expect(result).toContain('建议聚焦科巷美食街');
  });

  it('项目不存在时返回错误', async () => {
    const result = await pipelineDisplay(UID, PID, WR);
    expect(result).toContain('❌');
  });

  it('所有阶段完成时返回完成提示', async () => {
    const state = makeState({
      current_stage: 2,
      status: 'completed',
    });
    setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(state));
    const result = await pipelineDisplay(UID, PID, WR);
    expect(result).toContain('已完成');
  });
});
