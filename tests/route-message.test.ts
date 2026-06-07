import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WR, UID, PID, simpleTemplate2Stage, makeStateStage1Running, mockToolContext } from './fixtures/templates.js';

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
        readdir: async (dir: string) => { const prefix = norm(dir) + '/'; return [...files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length).split('/')[0]); },
        access: async () => {},
        unlink: async (p: string) => { const k = norm(p); if (files.has(k)) files.delete(k); },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

const mockSubagent = {
  run: vi.fn().mockResolvedValue({ runId: 'mock-run' }),
  waitForRun: vi.fn().mockResolvedValue({ status: 'ok' }),
  getSessionMessages: vi.fn().mockResolvedValue({ messages: [{ role: 'assistant', content: 'mock response' }] }),
};
const mockApi = { runtime: { subagent: mockSubagent } };

import { RouteMessageHandler, routeMessage } from '../src/tools/route-message.js';

describe('RouteMessageHandler', () => {
  let handler: RouteMessageHandler;

  beforeEach(() => { resetFs(); vi.clearAllMocks(); handler = new RouteMessageHandler(WR); });

  describe('routeMessage', () => {
    it('非 orchestrator 调用抛错', async () => {
      const context = { ...mockToolContext, agent_name: 'writer' };
      await expect(handler.routeMessage(context, 'topic-researcher', 'hello', mockApi))
        .rejects.toThrow('route_message can only be called by orchestrator');
    });

    it('无活跃 project 时使用直接对话 prompt', async () => {
      const context = { ...mockToolContext, agent_name: 'orchestrator' };
      const result = await handler.routeMessage(context, 'writer', '写点东西', mockApi);
      expect(mockSubagent.run).toHaveBeenCalledWith(
        expect.objectContaining({ sessionKey: 'writer:user-1:project-1' })
      );
    });

    it('有活跃 project 时使用 pipeline prompt', async () => {
      setFile(`${WR}/templates/simple-2stage.json`, JSON.stringify(simpleTemplate2Stage));
      const state = makeStateStage1Running();
      setFile(`${WR}/projects/${UID}/${PID}/state.json`, JSON.stringify(state));
      const context = { ...mockToolContext, agent_name: 'orchestrator' };
      await handler.routeMessage(context, 'writer', '写点东西', mockApi);
      const runArgs = mockSubagent.run.mock.calls[0][0];
      expect(runArgs.message).toContain('【强制系统指令】');
    });
  });
});

describe('routeMessage (top-level)', () => {
  beforeEach(() => { resetFs(); vi.clearAllMocks(); });

  it('非 orchestrator 抛错', async () => {
    const context = { ...mockToolContext, agent_name: 'writer' };
    await expect(routeMessage(context, 'target', 'msg', mockApi)).rejects.toThrow('only be called by orchestrator');
  });
});
