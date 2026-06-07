import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CorrectionSignal, VoiceprintState, StyleProfile } from '../src/types.js';

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

import { StyleSystem, styleReadProfile, styleWriteProfile, kbWrite, kbRead, styleGetContext, voiceprintInit, voiceprintProceed, voiceprintCalibrate, voiceprintAnalyze, voiceprintConfirm, voiceprintReset, styleExtractSignal } from '../src/tools/style-system.js';

const WR = 'C:/workspace';
const UID = 'user-1';

function sharedDir() { return `${WR}/_shared/${UID}`; }

function makeProfile(overrides?: Partial<StyleProfile>): StyleProfile {
  return {
    userId: UID,
    version: 1,
    dna: {
      corePrinciples: [],
      syntaxPatterns: {},
      vocabulary: { highFreq: [], forbidden: [], techTerms: [] },
      forbiddenPatterns: [],
      growthDirection: '',
    },
    lastUpdated: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeState(overrides?: Partial<VoiceprintState>): VoiceprintState {
  return {
    step: 0,
    path: null,
    samples: [],
    confirmed: false,
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('StyleSystem', () => {

  beforeEach(() => {
    resetFs();
    vi.clearAllMocks();
  });

  describe('readProfile / writeProfile', () => {
    it('文件存在时 readProfile 返回解析后的对象', async () => {
      const profile = makeProfile();
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(profile));
      const sys = new StyleSystem(WR, UID);
      const result = await sys.readProfile();
      expect(result).toBeDefined();
      expect(result!.userId).toBe(UID);
    });

    it('文件不存在时 readProfile 返回 null', async () => {
      const sys = new StyleSystem(WR, UID);
      const result = await sys.readProfile();
      expect(result).toBeNull();
    });

    it('writeProfile 写入文件', async () => {
      const profile = makeProfile();
      const sys = new StyleSystem(WR, UID);
      await sys.writeProfile(profile);
      const read = await sys.readProfile();
      expect(read).toBeDefined();
    });

    it('写后读回一致', async () => {
      const profile = makeProfile({ dna: { ...makeProfile().dna, corePrinciples: ['test'] } });
      const sys = new StyleSystem(WR, UID);
      await sys.writeProfile(profile);
      const read = await sys.readProfile();
      expect(read!.dna.corePrinciples).toEqual(['test']);
    });
  });

  describe('voiceprint state', () => {
    it('voiceprintInit 创建默认 profile 和 state', async () => {
      const result = await voiceprintInit(WR, UID);
      expect(result.exists).toBe(false);
      expect(result.state).toBeDefined();
      expect(result.state!.step).toBe(0);
      expect(result.prompt).toBeDefined();
    });

    it('voiceprintInit 已完成时返回 exists=true', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 99, confirmed: true })));
      const result = await voiceprintInit(WR, UID);
      expect(result.exists).toBe(true);
    });

    it('voiceprintInit 从中间步骤恢复', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 3 })));
      const result = await voiceprintInit(WR, UID);
      expect(result.state!.step).toBe(3);
      expect(result.prompt).toContain('推荐');
    });

    it('voiceprintReset 删除 state 文件', async () => {
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState()));
      await voiceprintReset(WR, UID);
      const result = await voiceprintInit(WR, UID);
      expect(result.state!.step).toBe(0);
    });
  });

  describe('voiceprintProceed', () => {
    it('step 1-4 路径 A 自动推进', async () => {
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 1, path: 'A' })));
      const result = await voiceprintProceed(WR, UID, {
        sample: { text: 'hello', label: 'intro' },
      });
      expect(result.state.step).toBe(2);
    });

    it('step 4+1 后自动跳到 step 7（step 5 瞬态）', async () => {
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 4, path: 'A' })));
      const result = await voiceprintProceed(WR, UID, {
        sample: { text: 'test', label: 'final' },
      });
      expect(result.state.step).toBe(7);
    });

    it('done=true 跳到 step 7', async () => {
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 5, path: 'A' })));
      const result = await voiceprintProceed(WR, UID, { done: true });
      expect(result.state.step).toBe(7);
    });

    it('路径 B 设置后自动跳到 step 7（step 5 瞬态）', async () => {
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 1 })));
      const result = await voiceprintProceed(WR, UID, {
        sample: { text: 'article', label: 'existing' },
        path: 'B',
      });
      expect(result.state.path).toBe('B');
      expect(result.state.step).toBe(7);
    });

    it('无 state 时报错', async () => {
      await expect(voiceprintProceed(WR, UID, {})).rejects.toThrow('请先调用 voiceprint_init');
    });

    it('返回的 prompt 对应当前 step', async () => {
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 7 })));
      const result = await voiceprintProceed(WR, UID, {});
      expect(result.prompt).toContain('句子长度');
    });
  });

  describe('voiceprintCalibrate', () => {
    it('写入偏好并推进到 step 9', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 7 })));
      const result = await voiceprintCalibrate(WR, UID, {
        sentenceLength: 'short',
        useEmoji: false,
        tone: 'formal',
      });
      expect(result.state.step).toBe(9);
      expect(result.profile.dna.syntaxPatterns.preferedSentenceLength).toBe(15);
      expect(result.profile.dna.syntaxPatterns.usesEmoji).toBe(false);
      expect(result.profile.dna.syntaxPatterns.tone).toBe('formal');
    });

    it('step 不是 7 或 8 时报错', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 3 })));
      await expect(voiceprintCalibrate(WR, UID, {})).rejects.toThrow('还不能做校准');
    });

    it('selectedForbiddenPhrases 写入禁用列表', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 8 })));
      const result = await voiceprintCalibrate(WR, UID, {
        selectedForbiddenPhrases: ['此外', '值得注意的是'],
      });
      expect(result.profile.dna.vocabulary.forbidden).toContain('此外');
      expect(result.profile.dna.forbiddenPatterns).toContain('值得注意的是');
    });
  });

  describe('voiceprintAnalyze', () => {
    it('写入分析结果并推进到 step 10', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 9 })));
      const result = await voiceprintAnalyze(WR, UID, {
        samples: [{ text: 'hello world', label: 'intro' }],
        analysis: {
          corePrinciples: ['简洁', '口语化'],
          forbiddenPatterns: ['首先', '其次'],
          highFreqWords: ['非常', '比较'],
          syntaxPatterns: { preferedSentenceLength: 20 },
        },
      });
      expect(result.state.step).toBe(10);
      expect(result.profile.dna.corePrinciples).toContain('简洁');
      expect(result.profile.dna.vocabulary.forbidden).toContain('首先');
      expect(result.prompt).toContain('风格快照已经锁定');
    });

    it('step 不是 9 时报错', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 5 })));
      await expect(voiceprintAnalyze(WR, UID, { samples: [], analysis: {} as any })).rejects.toThrow('还不能做分析');
    });

    it('无 profile 时报错', async () => {
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 9 })));
      await expect(voiceprintAnalyze(WR, UID, { samples: [], analysis: {} as any })).rejects.toThrow('尚无 style-dna.json');
    });
  });

  describe('voiceprintConfirm', () => {
    it('确认后生成 persona 并标记 step=99', async () => {
      const profile = makeProfile({ dna: { ...makeProfile().dna, corePrinciples: ['简洁'] } });
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(profile));
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 10 })));
      const result = await voiceprintConfirm(WR, UID);
      expect(result.profile.dna.corePrinciples).toContain('简洁');
      const sys = new StyleSystem(WR, UID);
      const persona = await sys.readPersona();
      expect(persona).toBeDefined();
      expect(persona).toContain('风格 DNA');
      const state = await sys.readVoiceprintState();
      expect(state!.step).toBe(99);
      expect(state!.confirmed).toBe(true);
    });

    it('corrections 非空时不锁定', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 10 })));
      const result = await voiceprintConfirm(WR, UID, { corrections: ['太正式了'] });
      expect(result.summary).toContain('修正');
      const sys = new StyleSystem(WR, UID);
      const state = await sys.readVoiceprintState();
      expect(state!.step).toBe(10);
    });

    it('step 不是 10 时报错', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 5 })));
      await expect(voiceprintConfirm(WR, UID)).rejects.toThrow('还不能做确认');
    });
  });

  describe('processCorrectionSignal', () => {
    it('forbidden 信号追加到 forbiddenPatterns', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      const sys = new StyleSystem(WR, UID);
      await sys.processCorrectionSignal({
        type: 'forbidden', quote: '不要用感叹号', agent: 'orchestrator', userId: UID,
      });
      const profile = await sys.readProfile();
      expect(profile!.dna.forbiddenPatterns).toContain('不要用感叹号');
    });

    it('preference 信号追加到 highFreq', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      const sys = new StyleSystem(WR, UID);
      await sys.processCorrectionSignal({
        type: 'preference', quote: '多用短句', agent: 'orchestrator', userId: UID,
      });
      const profile = await sys.readProfile();
      expect(profile!.dna.vocabulary.highFreq).toContain('多用短句');
    });

    it('无 profile 时返回 false', async () => {
      const sys = new StyleSystem(WR, UID);
      const result = await sys.processCorrectionSignal({
        type: 'forbidden', quote: 'x', agent: 'orchestrator', userId: UID,
      });
      expect(result).toBe(false);
    });

    it('praise 信号写入 KB', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      const sys = new StyleSystem(WR, UID);
      await sys.processCorrectionSignal({
        type: 'praise', quote: '很好', agent: 'orchestrator', userId: UID,
      });
      const kb = await sys.readKB();
      expect(kb.some(e => e.category === 'feedback' && e.content === '很好')).toBe(true);
    });

    it('重复信号不重复写入', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      const sys = new StyleSystem(WR, UID);
      const signal: CorrectionSignal = {
        type: 'forbidden', quote: '不要用感叹号', agent: 'orchestrator', userId: UID,
      };
      const first = await sys.processCorrectionSignal(signal);
      const second = await sys.processCorrectionSignal(signal);
      const profile = await sys.readProfile();
      const matches = profile!.dna.forbiddenPatterns.filter(p => p === '不要用感叹号');
      expect(matches).toHaveLength(1);
      expect(first).toBe(true);
      expect(second).toBe(false);
    });
  });

  describe('KB operations', () => {
    it('kbWrite 追加条目', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      await kbWrite(WR, UID, {
        userId: UID, category: 'insight', content: 'test entry', source: 'orchestrator', timestamp: '', confidence: 'high',
      });
      const entries = await kbRead(WR, UID);
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe('test entry');
    });

    it('kbRead 按 category 过滤', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      await kbWrite(WR, UID, { userId: UID, category: 'insight', content: 'i1', source: 'a', timestamp: '', confidence: 'high' });
      await kbWrite(WR, UID, { userId: UID, category: 'feedback', content: 'f1', source: 'a', timestamp: '', confidence: 'high' });
      const insights = await kbRead(WR, UID, 'insight');
      expect(insights).toHaveLength(1);
      expect(insights[0].content).toBe('i1');
    });

    it('kbRead 空文件返回空数组', async () => {
      const entries = await kbRead(WR, UID);
      expect(entries).toEqual([]);
    });
  });

  describe('styleGetContext', () => {
    it('返回三层上下文', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile({ dna: { ...makeProfile().dna, corePrinciples: ['简洁'] } })));
      setFile(`${sharedDir()}/profile/persona.md`, 'user persona');
      setFile(`${sharedDir()}/memory/insights.md`, '# insights');
      const ctx = await styleGetContext(WR, UID);
      expect(ctx.styleDNA).toBeDefined();
      expect(ctx.styleDNA!.dna.corePrinciples).toContain('简洁');
      expect(ctx.persona).toBe('user persona');
      expect(ctx.insights).toContain('insights');
    });
  });

  describe('styleExtractSignal', () => {
    it('调用 processCorrectionSignal 并返回结果', async () => {
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      const changed = await styleExtractSignal(WR, UID, {
        type: 'forbidden', quote: 'test', agent: 'orchestrator', userId: UID,
      });
      expect(changed).toBe(true);
    });
  });

  describe('appendInsight', () => {
    it('追加到 insights.md', async () => {
      const sys = new StyleSystem(WR, UID);
      await sys.appendInsight('test log', 'orchestrator');
      const log = await sys.readInsights();
      expect(log).toContain('test log');
    });
  });

  describe('readPersona / writePersona', () => {
    it('写 persona.md 后读回一致', async () => {
      const sys = new StyleSystem(WR, UID);
      await sys.writePersona('# persona content');
      const read = await sys.readPersona();
      expect(read).toBe('# persona content');
    });

    it('无 persona 文件返回 null', async () => {
      const sys = new StyleSystem(WR, UID);
      const read = await sys.readPersona();
      expect(read).toBeNull();
    });
  });

  describe('uniq', () => {
    it('dedup 数组', async () => {
      // uniq is used internally by voiceprintAnalyze
      // It's also exported standalone - but it's just [...new Set(arr)]
      // We'll test it indirectly through analyze
      setFile(`${sharedDir()}/style-dna.json`, JSON.stringify(makeProfile()));
      setFile(`${sharedDir()}/voiceprint-state.json`, JSON.stringify(makeState({ step: 9 })));
      const result = await voiceprintAnalyze(WR, UID, {
        samples: [],
        analysis: {
          corePrinciples: ['a', 'a', 'b'],
          forbiddenPatterns: [],
          highFreqWords: ['x', 'x'],
          syntaxPatterns: {},
        },
      });
      expect(result.profile.dna.corePrinciples).toHaveLength(2);
      expect(result.profile.dna.vocabulary.highFreq).toHaveLength(1);
    });
  });
});
