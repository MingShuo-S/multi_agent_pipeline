import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WR, UID, PID, template3Stage, simpleTemplate2Stage, template4Stage,
} from './fixtures/templates.js';

const { mockFs, resetFs, setFile } = vi.hoisted(() => {
  const files = new Map<string, string>();
  const enoent = (p: string) => { const e = new Error(`ENOENT: ${p}`) as any; e.code = 'ENOENT'; throw e; };
  const norm = (p: string) => p.replace(/\\/g, '/');
  return {
    mockFs: {
      mkdirSync: () => {},
      promises: {
        readFile: async (p: string) => { const k = norm(p); if (files.has(k)) return files.get(k)!; throw enoent(p); },
        writeFile: async (p: string, c: string) => { files.set(norm(p), c); },
        mkdir: async () => {},
        readdir: async (dir: string) => {
          const prefix = norm(dir) + '/';
          return [...files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length).split('/')[0]);
        },
        access: async () => {},
        copyFile: async (src: string, dst: string) => { const sk = norm(src); if (files.has(sk)) files.set(norm(dst), files.get(sk)!); },
        unlink: async (p: string) => { const k = norm(p); if (files.has(k)) files.delete(k); },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

import { pipelineStart } from '../src/tools/pipeline-start.js';
import { pipelineContinue } from '../src/tools/pipeline-continue.js';
import { SEED_TEMPLATES_DIR } from '../src/config.js';

const sdir = SEED_TEMPLATES_DIR.replace(/\\/g, '/');

function putTpl(name: string, tpl: object) {
  const json = JSON.stringify(tpl);
  setFile(`${WR}/templates/${name}.json`, json);
  setFile(`${sdir}/templates/${name}.json`, json);
}

describe('pipeline 全流程模拟', () => {
  let mockSubagent: any;
  let mockApi: any;

  beforeEach(() => {
    resetFs();
    mockSubagent = {
      run: vi.fn().mockResolvedValue({ runId: 'mock-run' }),
      waitForRun: vi.fn().mockResolvedValue({ status: 'ok' }),
      getSessionMessages: vi.fn().mockResolvedValue({
        messages: [{ role: 'assistant', content: '这是 agent 针对当前需求的回复内容' }],
      }),
    };
    mockApi = { runtime: { subagent: mockSubagent } };
  });

  describe('3-stage 模板（非cp→cp→非cp）', () => {
    beforeEach(() => {
      putTpl('3stage', template3Stage);
    });

    it('完整流程：初始化→对话→推进→完成', async () => {
      const startResult = await pipelineStart('3stage', UID, PID, '帮我写篇文章', WR, mockApi);
      expect(startResult.status).toBe('checkpoint_reached');
      expect(startResult.current_stage).toBe(1);
      expect(startResult.current_agent).toBe('a2');
      expect(startResult.slot_output).toBeDefined();
      expect(startResult.slot_output!.slot_name).toBe('out2');
      expect(mockSubagent.run).toHaveBeenCalledTimes(2);
      expect(mockSubagent.run.mock.calls[0][0].sessionKey).toContain('a1');
      expect(mockSubagent.run.mock.calls[1][0].sessionKey).toContain('a2');

      const dialogueResult = await pipelineContinue(UID, PID, '需要更多细节', WR, mockApi);
      expect(dialogueResult.status).toBe('dialogue_continued');
      expect(dialogueResult.current_agent).toBe('a2');
      expect(mockSubagent.run).toHaveBeenCalledTimes(3);

      const advanceResult = await pipelineContinue(UID, PID, '下一阶段', WR, mockApi);
      expect(advanceResult.status).toBe('completed');
      expect(advanceResult.action_taken).toBe('completed');
      // auto-advance s3 adds 1 call
      expect(mockSubagent.run).toHaveBeenCalledTimes(4);
      expect(mockSubagent.run.mock.calls[3][0].sessionKey).toContain('a3');
    });

    it('无初始消息启动后手动对话', async () => {
      const startResult = await pipelineStart('3stage', UID, PID, '', WR, mockApi);
      expect(startResult.status).toBe('initialized');
      expect(startResult.current_stage).toBe(1);
      expect(startResult.current_agent).toBe('a2');
      expect(mockSubagent.run).toHaveBeenCalledTimes(1);
      expect(mockSubagent.run.mock.calls[0][0].sessionKey).toContain('a1');

      const dialogueResult = await pipelineContinue(UID, PID, '开始工作', WR, mockApi);
      expect(dialogueResult.status).toBe('dialogue_continued');
      expect(mockSubagent.run).toHaveBeenCalledTimes(2);
    });

    it('推进到完成：不需要对话', async () => {
      await pipelineStart('3stage', UID, PID, '', WR, mockApi);
      const result = await pipelineContinue(UID, PID, '下一阶段', WR, mockApi);
      expect(result.status).toBe('completed');
      expect(mockSubagent.run).toHaveBeenCalledTimes(2);
    });
  });

  describe('全 checkpoint 模板（4-stage）', () => {
    beforeEach(() => {
      putTpl('4stage', template4Stage);
    });

    it('每阶段逐步推进', async () => {
      const startResult = await pipelineStart('4stage', UID, PID, '', WR, mockApi);
      expect(startResult.status).toBe('initialized');
      expect(startResult.current_stage).toBe(0);
      expect(startResult.current_agent).toBe('a1');
      expect(mockSubagent.run).not.toHaveBeenCalled();

      const d1 = await pipelineContinue(UID, PID, '帮我研究', WR, mockApi);
      expect(d1.status).toBe('dialogue_continued');
      expect(mockSubagent.run).toHaveBeenCalledTimes(1);

      const a1 = await pipelineContinue(UID, PID, '下一阶段', WR, mockApi);
      expect(a1.status).toBe('stage_advanced');
      expect(a1.current_agent).toBe('a2');

      const d2 = await pipelineContinue(UID, PID, '写初稿', WR, mockApi);
      expect(d2.status).toBe('dialogue_continued');
      expect(mockSubagent.run).toHaveBeenCalledTimes(2);

      const a2 = await pipelineContinue(UID, PID, '下一阶段', WR, mockApi);
      expect(a2.status).toBe('stage_advanced');
      expect(a2.current_agent).toBe('a3');

      const d3 = await pipelineContinue(UID, PID, '审校', WR, mockApi);
      expect(d3.status).toBe('dialogue_continued');
      expect(mockSubagent.run).toHaveBeenCalledTimes(3);

      const a3 = await pipelineContinue(UID, PID, '下一阶段', WR, mockApi);
      expect(a3.status).toBe('stage_advanced');
      expect(a3.current_agent).toBe('a4');

      const d4 = await pipelineContinue(UID, PID, '发布', WR, mockApi);
      expect(d4.status).toBe('dialogue_continued');
      expect(mockSubagent.run).toHaveBeenCalledTimes(4);

      const complete = await pipelineContinue(UID, PID, '下一阶段', WR, mockApi);
      expect(complete.status).toBe('completed');
    });
  });

  describe('2-stage 模板自动推进', () => {
    beforeEach(() => {
      putTpl('simple-2stage', simpleTemplate2Stage);
    });

    it('非cp→cp 自动推进', async () => {
      const startResult = await pipelineStart('simple-2stage', UID, PID, '', WR, mockApi);
      expect(startResult.status).toBe('initialized');
      expect(startResult.current_stage).toBe(1);
      expect(startResult.current_agent).toBe('writer');
      expect(mockSubagent.run).toHaveBeenCalledTimes(1);
      expect(mockSubagent.run.mock.calls[0][0].sessionKey).toContain('researcher');
    });

    it('初始消息+自动推进+对话', async () => {
      const startResult = await pipelineStart('simple-2stage', UID, PID, '写一篇南京游记', WR, mockApi);
      expect(startResult.status).toBe('checkpoint_reached');
      expect(startResult.current_stage).toBe(1);
      expect(startResult.current_agent).toBe('writer');
      expect(mockSubagent.run).toHaveBeenCalledTimes(2);
      expect(mockSubagent.run.mock.calls[0][0].sessionKey).toContain('researcher');
      expect(mockSubagent.run.mock.calls[1][0].sessionKey).toContain('writer');

      const complete = await pipelineContinue(UID, PID, '下一阶段', WR, mockApi);
      expect(complete.status).toBe('completed');
    });
  });

  describe('错误恢复：executeDialogue 短输出触发重试', () => {
    beforeEach(() => {
      putTpl('simple-2stage', simpleTemplate2Stage);
    });

    it('短输出后重试成功 (via pipelineContinue)', async () => {
      // First, set up state at stage 1 (writer) with normal content
      await pipelineStart('simple-2stage', UID, PID, '帮我写一篇笔记', WR, mockApi);

      // Now test retry in pipelineContinue (which uses executeDialogue with retry)
      let msgCallCount = 0;
      mockSubagent.getSessionMessages.mockImplementation(async () => {
        msgCallCount++;
        if (msgCallCount === 1) return { messages: [{ role: 'assistant', content: '短' }] };
        return { messages: [{ role: 'assistant', content: '重试后的正常回复内容' }] };
      });

      const totalRunBefore = mockSubagent.run.mock.calls.length;
      const result = await pipelineContinue(UID, PID, '帮我修改一下', WR, mockApi);
      expect(result.status).toBe('dialogue_continued');
      // executeDialogue called run twice (original + retry)
      expect(mockSubagent.run.mock.calls.length).toBe(totalRunBefore + 2);
    });

    it('超出重试次数后返回 error (via pipelineContinue)', async () => {
      await pipelineStart('simple-2stage', UID, PID, '帮我写一篇笔记', WR, mockApi);

      mockSubagent.getSessionMessages.mockImplementation(async () => ({
        messages: [{ role: 'assistant', content: '短' }],
      }));

      const result = await pipelineContinue(UID, PID, '帮我修改', WR, mockApi);
      expect(result.status).toBe('error');
      expect(result.error).toContain('重');
    });
  });
});
