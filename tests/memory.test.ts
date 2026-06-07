import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WR, UID, PID, makeEmptyProfile, mockToolContext, mockToolContextWriter } from './fixtures/templates.js';

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
        readdir: async () => [],
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

import { MemoryManager, styleGetProfile, styleRecordFeedback } from '../src/tools/memory.js';

describe('MemoryManager', () => {
  let mm: MemoryManager;

  beforeEach(() => {
    resetFs();
    vi.clearAllMocks();
    mm = new MemoryManager(WR, UID, 'writer');
  });

  describe('getProfile', () => {
    it('文件不存在返回空 profile', async () => {
      const profile = await mm.getProfile();
      expect(profile.agent).toBe('');
      expect(profile.user_id).toBe('');
      expect(profile.preferences).toEqual({});
    });

    it('文件存在返回解析后的 profile', async () => {
      const data = {
        agent: 'writer',
        user_id: UID,
        preferences: { style: 'formal', avoid: ['emoji'] },
        last_updated: '2025-01-01T00:00:00.000Z',
      };
      setFile(`${WR}/projects/${UID}/agents/writer-profile.json`, JSON.stringify(data));
      const profile = await mm.getProfile();
      expect(profile.agent).toBe('writer');
      expect(profile.preferences.style).toBe('formal');
    });

    it('preferences 为空时返回默认', async () => {
      const data = { agent: 'writer', user_id: UID, preferences: {}, last_updated: '2025-01-01T00:00:00.000Z' };
      setFile(`${WR}/projects/${UID}/agents/writer-profile.json`, JSON.stringify(data));
      const profile = await mm.getProfile();
      expect(profile.preferences).toEqual({});
    });
  });

  describe('recordFeedback', () => {
    it('新用户创建 profile', async () => {
      await mm.recordFeedback('writer', UID, { style: 'casual' });
      const profile = await mm.getProfile();
      expect(profile.agent).toBe('writer');
      expect(profile.user_id).toBe(UID);
    });

    it('追加偏好到已有 profile', async () => {
      setFile(`${WR}/projects/${UID}/agents/writer-profile.json`, JSON.stringify({
        agent: 'writer', user_id: UID, preferences: { style: 'formal' }, last_updated: '2025-01-01T00:00:00.000Z',
      }));
      await mm.recordFeedback('writer', UID, { avoid: ['emoji'] });
      const profile = await mm.getProfile();
      expect(profile.preferences.style).toBe('formal');
      expect(profile.preferences.avoid).toEqual(['emoji']);
    });

    it('覆盖已有偏好', async () => {
      setFile(`${WR}/projects/${UID}/agents/writer-profile.json`, JSON.stringify({
        agent: 'writer', user_id: UID, preferences: { style: 'formal' }, last_updated: '2025-01-01T00:00:00.000Z',
      }));
      await mm.recordFeedback('writer', UID, { style: 'casual' });
      const profile = await mm.getProfile();
      expect(profile.preferences.style).toBe('casual');
    });

    it('合并不同 key 的偏好', async () => {
      await mm.recordFeedback('writer', UID, { style: 'casual' });
      await mm.recordFeedback('writer', UID, { avoid: ['emoji'] });
      const profile = await mm.getProfile();
      expect(profile.preferences.style).toBe('casual');
      expect(profile.preferences.avoid).toEqual(['emoji']);
    });
  });
});

describe('styleGetProfile (top-level tool)', () => {
  beforeEach(() => { resetFs(); vi.clearAllMocks(); });

  it('无 profile 返回空对象', async () => {
    const prefs = await styleGetProfile(mockToolContext);
    expect(prefs).toEqual({});
  });

  it('有 profile 返回 preferences', async () => {
    setFile(`${WR}/projects/${UID}/agents/orchestrator-profile.json`, JSON.stringify({
      agent: 'orchestrator', user_id: UID, preferences: { style: 'direct' }, last_updated: '2025-01-01T00:00:00.000Z',
    }));
    const prefs = await styleGetProfile(mockToolContext);
    expect(prefs).toEqual({ style: 'direct' });
  });
});

describe('styleRecordFeedback (top-level tool)', () => {
  beforeEach(() => { resetFs(); vi.clearAllMocks(); });

  it('记录偏好并读取', async () => {
    await styleRecordFeedback(mockToolContextWriter, { style: 'poetic' });
    const prefs = await styleGetProfile(mockToolContextWriter);
    expect(prefs).toHaveProperty('style', 'poetic');
  });
});
