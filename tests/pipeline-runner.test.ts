import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WR, UID, PID, simpleTemplate2Stage, template3Stage, makeStateCompleted } from './fixtures/templates.js';

// 状态写入辅助
function makeState(index: number, stageCount: number, completed = false) {
  const stages = simpleTemplate2Stage.stages.slice(0, stageCount);
  return {
    project_id: PID, user_id: UID, template_name: 'simple-2stage', mode: 'relay' as const,
    current_stage: index,
    status: completed ? 'completed' as const : 'running' as const,
    slot_values: { topic: 'test', draft: '' },
    stage_history: stages.slice(0, index).map((s, i) => ({
      stage: i, stage_id: s.id, agent: s.agent,
      status: 'completed' as const, started_at: '', completed_at: '',
      checkpoint: s.checkpoint, versions: 1,
    })),
    slot_history: { topic: [{ slot_name: 'topic', value: 'test', agent: 'researcher', version: 1, timestamp: '' }] },
    version: 1, created_at: '', updated_at: '',
  };
}

const { mockFs, resetFs, setFile } = vi.hoisted(() => {
  const files = new Map<string, string>();
  const enoent = (p: string) => { const e: any = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; };
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
        unlink: async (p: string) => { const k = norm(p); files.delete(k); },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

// mock readline
const readlineMock = vi.hoisted(() => {
  let questionHandler: ((q: string, cb: (a: string) => void) => void) | null = null;
  return {
    default: {
      createInterface: vi.fn(() => ({
        question: vi.fn((q: string, cb: (a: string) => void) => {
          questionHandler?.(q, cb);
        }),
        close: vi.fn(),
      })),
    },
    _setQuestionHandler: (h: typeof questionHandler) => { questionHandler = h; },
  };
});
vi.mock('readline', () => readlineMock);

import { PipelineRunner } from '../src/runtime/pipeline-runner.js';

describe('PipelineRunner', () => {
  beforeEach(() => {
    resetFs();
    vi.clearAllMocks();
    readlineMock._setQuestionHandler(null);
    setFile(`${WR}/templates/simple-2stage.json`, JSON.stringify(simpleTemplate2Stage));
    setFile(`${WR}/templates/3stage.json`, JSON.stringify(template3Stage));
  });

  // ── simulateAgentResponse ──
  describe('simulateAgentResponse', () => {
    it('topic-researcher 返回选题方向', () => {
      const runner = new (PipelineRunner as any)(WR, UID, PID, 'simple-2stage');
      const state = makeState(0, 2);
      const r = runner.simulateAgentResponse('topic-researcher', '写南京', state, simpleTemplate2Stage);
      expect(r).toContain('选题方向已确认');
      expect(r).toContain('方向');
    });

    it('topic-researcher 返回调研数据', () => {
      const runner = new (PipelineRunner as any)(WR, UID, PID, 'simple-2stage');
      const state = makeState(1, 2);
      const r = runner.simulateAgentResponse('topic-researcher', '查路线', state, simpleTemplate2Stage);
      expect(r).toContain('调研数据');
      expect(r).toContain('红庙');
    });

    it('content-writer 返回初稿', () => {
      const runner = new (PipelineRunner as any)(WR, UID, PID, 'simple-2stage');
      const state = makeState(1, 2);
      const r = runner.simulateAgentResponse('content-writer', '写笔记', state, simpleTemplate2Stage);
      expect(r).toContain('内容创作者');
      expect(r).toContain('南京烟火气');
    });

    it('未知 agent 返回通用响应', () => {
      const runner = new (PipelineRunner as any)(WR, UID, PID, 'simple-2stage');
      const state = makeState(0, 2);
      const r = runner.simulateAgentResponse('publisher', '发布', state, simpleTemplate2Stage);
      expect(r).toContain('publisher');
    });

    it('截断超长用户消息到 100 字符', () => {
      const runner = new (PipelineRunner as any)(WR, UID, PID, 'simple-2stage');
      const state = makeState(0, 2);
      const longMsg = 'a'.repeat(200);
      const r = runner.simulateAgentResponse('topic-researcher', longMsg, state, simpleTemplate2Stage);
      expect(r).toContain('a'.repeat(100));
      expect(r).not.toContain('a'.repeat(101));
    });
  });

  // isAdvanceSignal 在 pipeline-runner.ts 中是模块级私有函数，通过 dialogueWithAgent 间接测试

  // ── autoAdvanceNonCheckpoint ──
  describe('autoAdvanceNonCheckpoint', () => {
    it('跳过非 checkpoint 阶段（stage 0 无 checkpoint）', async () => {
      // simple-2stage: stage0=research(checkpoint=false), stage1=write(checkpoint=true)
      setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(makeState(0, 2)));
      const runner = new (PipelineRunner as any)(WR, UID, PID, 'simple-2stage');
      const state = makeState(0, 2);
      const result = await runner.autoAdvanceNonCheckpoint(simpleTemplate2Stage, state);
      expect(result.current_stage).toBe(1);
      expect(result.stage_history.length).toBeGreaterThanOrEqual(1);
    });

    it('checkpoint 阶段不跳过', async () => {
      // 已经是 checkpoint 阶段
      setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(makeState(1, 2)));
      const runner = new (PipelineRunner as any)(WR, UID, PID, 'simple-2stage');
      const state = makeState(1, 2);
      const result = await runner.autoAdvanceNonCheckpoint(simpleTemplate2Stage, state);
      expect(result.current_stage).toBe(1);
    });

    it('多阶段自动推进: 非 checkpoint 链', async () => {
      // template3Stage: s1(non-cp), s2(cp), s3(non-cp)
      setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify({ ...makeState(0, 3), template_name: '3stage' }));
      const runner = new (PipelineRunner as any)(WR, UID, PID, '3stage');
      const state = { ...makeState(0, 3), template_name: '3stage' };
      const result = await runner.autoAdvanceNonCheckpoint(template3Stage, state);
      // s1 自动跳过 → 停在 s2 (checkpoint)
      expect(result.current_stage).toBe(1);
    });

    it('已完成时不再推进', async () => {
      const runner = new (PipelineRunner as any)(WR, UID, PID, 'simple-2stage');
      const state = makeStateCompleted();
      const result = await runner.autoAdvanceNonCheckpoint(simpleTemplate2Stage, state as any);
      expect(result.current_stage).toBe(2);
    });
  });

  // ── dialogueWithAgent ──
  describe('dialogueWithAgent', () => {
    it('推进信号返回 true', async () => {
      setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(makeState(1, 2)));
      const runner = new (PipelineRunner as any)(WR, UID, PID, 'simple-2stage');
      const state = makeState(1, 2);

      // 模拟用户输入"下一阶段"
      readlineMock._setQuestionHandler((_q, cb) => cb('下一阶段'));
      const result = await runner.dialogueWithAgent(simpleTemplate2Stage, state, simpleTemplate2Stage.stages[1]);
      expect(result).toBe(true);
    });

    it('普通消息调用 simulateAgentResponse 并继续循环', async () => {
      setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(makeState(1, 2)));
      const runner = new (PipelineRunner as any)(WR, UID, PID, 'simple-2stage');
      const state = makeState(1, 2);

      // 模拟用户输入普通消息然后推进信号
      let callCount = 0;
      readlineMock._setQuestionHandler((_q, cb) => {
        callCount++;
        cb(callCount === 1 ? '帮我写一篇笔记' : '下一阶段');
      });
      const result = await runner.dialogueWithAgent(simpleTemplate2Stage, state, simpleTemplate2Stage.stages[1]);
      expect(result).toBe(true);
      expect(callCount).toBe(2);
    });
  });
});
