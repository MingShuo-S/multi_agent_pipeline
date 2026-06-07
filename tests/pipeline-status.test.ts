import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WR, UID, PID, simpleTemplate2Stage, template4Stage, makeBaseState, makeStateStage1Running, makeStateCompleted, makeSlotEntry, makeStageEntry, makeRemark } from './fixtures/templates.js';

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
          const entries = [...files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length).split('/')[0]);
          return [...new Set(entries)];
        },
        access: async (p: string) => { if (!files.has(norm(p))) throw enoent(p); },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

import { pipelineStatus } from '../src/tools/pipeline-status.js';

describe('pipelineStatus', () => {
  beforeEach(() => { resetFs(); vi.clearAllMocks(); });

  it('不存在项目返回 error', async () => {
    const result = await pipelineStatus(UID, 'ghost', WR);
    expect(result.status).toBe('error');
    expect(result.error).toContain('不存在');
  });

  it('返回初始状态的完整面板', async () => {
    setFile(`${WR}/templates/simple-2stage.json`, JSON.stringify(simpleTemplate2Stage));
    const state = makeBaseState();
    setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(state));
    const result = await pipelineStatus(UID, PID, WR);
    expect(result.status).toBe('ok');
    expect(result.project.template_name).toBe('simple-2stage');
    expect(result.project.pipeline_status).toBe('running');
    expect(result.progress.current_stage).toBe(1);
    expect(result.progress.total_stages).toBe(2);
    expect(result.progress.completed_stages).toBe(0);
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0].status).toBe('current');
  });

  it('stage 1 运行时状态正确', async () => {
    setFile(`${WR}/templates/simple-2stage.json`, JSON.stringify(simpleTemplate2Stage));
    const state = makeStateStage1Running();
    setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(state));
    const result = await pipelineStatus(UID, PID, WR);
    expect(result.status).toBe('ok');
    expect(result.progress.current_stage).toBe(2);
    expect(result.stages[0].status).toBe('completed');
    expect(result.stages[1].status).toBe('current');
    expect(result.slots).toHaveLength(2);
    const topicSlot = result.slots.find(s => s.name === 'topic');
    expect(topicSlot).toBeDefined();
    expect(topicSlot!.current_value).toBe('research results');
    expect(topicSlot!.version_count).toBe(1);
  });

  it('completed 状态正确', async () => {
    setFile(`${WR}/templates/simple-2stage.json`, JSON.stringify(simpleTemplate2Stage));
    const state = makeStateCompleted();
    setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(state));
    const result = await pipelineStatus(UID, PID, WR);
    expect(result.status).toBe('ok');
    expect(result.project.pipeline_status).toBe('completed');
    expect(result.progress.completed_stages).toBe(2);
    expect(result.stages.every(s => s.status === 'completed')).toBe(true);
  });

  it('remarks 正确返回', async () => {
    setFile(`${WR}/templates/simple-2stage.json`, JSON.stringify(simpleTemplate2Stage));
    const state = makeStateStage1Running();
    state.remarks = [makeRemark('orchestrator', 'checked data', 0), makeRemark('writer', 'needs more', 1)];
    setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(state));
    const result = await pipelineStatus(UID, PID, WR);
    expect(result.remarks).toHaveLength(2);
    expect(result.remarks[0].agent).toBe('orchestrator');
  });

  it('4 阶段模板状态正确', async () => {
    setFile(`${WR}/templates/4stage.json`, JSON.stringify(template4Stage));
    const state = {
      template_name: '4stage',
      current_stage: 2,
      slot_values: { slot1: 'v1', slot2: 'v2', slot3: '', slot4: '' },
      slot_history: { slot1: [makeSlotEntry('v1', 'a1', 0)], slot2: [makeSlotEntry('v2', 'a2', 0)], slot3: [], slot4: [] },
      remarks: [],
      stage_history: [
        makeStageEntry(0, 's1', 'a1', true),
        makeStageEntry(1, 's2', 'a2', true),
        { stage: 2, stage_id: 's3', agent: 'a3', started_at: '2025-01-01T00:02:00.000Z', versions: 0 },
      ],
      status: 'running' as const,
      mode: 'relay' as const,
    };
    setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(state));
    const result = await pipelineStatus(UID, PID, WR);
    expect(result.progress.completed_stages).toBe(2);
    expect(result.stages[0].status).toBe('completed');
    expect(result.stages[1].status).toBe('completed');
    expect(result.stages[2].status).toBe('current');
    expect(result.stages[3].status).toBe('pending');
  });

  it('slot history preview 截断超过 200 字符', async () => {
    setFile(`${WR}/templates/simple-2stage.json`, JSON.stringify(simpleTemplate2Stage));
    const longContent = 'a'.repeat(500);
    const state = makeBaseState({
      current_stage: 1,
      slot_values: { topic: longContent, draft: '' },
      slot_history: { topic: [makeSlotEntry(longContent, 'researcher', 0)], draft: [] },
      stage_history: [
        makeStageEntry(0, 'research', 'researcher', true),
        { stage: 1, stage_id: 'write', agent: 'writer', started_at: '2025-01-01T00:01:00.000Z', versions: 0 },
      ],
    });
    setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(state));
    const result = await pipelineStatus(UID, PID, WR);
    const topicSlot = result.slots.find(s => s.name === 'topic')!;
    expect(topicSlot.history[0].preview.length).toBeLessThanOrEqual(200);
  });
});
