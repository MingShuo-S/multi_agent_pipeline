// src/tools/style-system.ts — PROFILE + MEMORY 管理层
// PROFILE: profile.json (voiceprint 产出 + AI 增量学习)
// MEMORY:  memory.json (运行时 insight/fact/feedback)
// 旧格式: style-dna.json + kb.json → 首次读时自动迁移

import { promises as fs } from 'fs';
import path from 'path';
import type { Profile, KBEntry, CorrectionSignal, AgentRole, PatternEntry } from '../types.js';

export type Temperature = 'hot' | 'warm' | 'cold';

export interface TunedProfile extends Profile {
  temperatures?: {
    corePrinciples: 'hot';
    forbiddenPatterns: 'warm';
    vocabulary: 'warm';
    kbEntries: 'cold';
    persona: 'cold';
  };
}

// ——— 文件锁 ———
const LOCK_RETRY_MS = 100;
const LOCK_TIMEOUT_MS = 5000;

async function withLock<T>(dir: string, label: string, fn: () => Promise<T>): Promise<T> {
  const lockFile = path.join(dir, '.write.lock');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      await fs.writeFile(lockFile, `${process.pid || 0}\n${label}`, { flag: 'wx' });
      break;
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const stale = await fs.readFile(lockFile, 'utf-8');
        const pid = parseInt(stale.split('\n')[0], 10);
        if (!isNaN(pid) && pid > 0) {
          try { process.kill(pid, 0); } catch {
            await fs.unlink(lockFile).catch(() => {});
            continue;
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, LOCK_RETRY_MS));
      lastError = err;
    }
  }

  if (Date.now() >= deadline && lastError) {
    throw new Error(`[lock] 获取锁超时 (${LOCK_TIMEOUT_MS}ms) — ${label}: ${lastError.message}`);
  }

  try {
    return await fn();
  } finally {
    await fs.unlink(lockFile).catch(() => {});
  }
}

const PROFILE_FILE = 'profile.json';
const MEMORY_FILE = 'memory.json';
const LEGACY_STYLE_FILE = 'style-dna.json';
const LEGACY_KB_FILE = 'kb.json';

export class StyleSystem {
  private sharedDir: string;

  constructor(workspaceRoot: string, userId: string) {
    this.sharedDir = path.join(workspaceRoot, '_profiles', userId);
  }

  async ensureDirs(): Promise<void> {
    const subdirs = [
      this.sharedDir,
      path.join(this.sharedDir, 'profile'),
      path.join(this.sharedDir, 'memory'),
      path.join(this.sharedDir, 'logs'),
    ];
    for (const d of subdirs) {
      await fs.mkdir(d, { recursive: true });
    }
  }

  // ========== 迁移 ==========

  async migrateLegacyKB(): Promise<number> {
    let count = 0;
    try {
      const raw = await fs.readFile(path.join(this.sharedDir, LEGACY_KB_FILE), 'utf-8');
      const entries: KBEntry[] = JSON.parse(raw);
      const nonPersona = entries.filter(e => e.category !== 'persona');
      if (nonPersona.length === 0) return 0;
      // 直接从 memory.json 读（跳过 readKB 的 kb.json fallback，避免自引）
      let existing: KBEntry[] = [];
      try {
        const memRaw = await fs.readFile(path.join(this.sharedDir, MEMORY_FILE), 'utf-8');
        existing = JSON.parse(memRaw);
      } catch {}
      const existingSet = new Set(existing.map(e => e.content));
      const toAdd = nonPersona.filter(e => !existingSet.has(e.content));
      if (toAdd.length === 0) return 0;
      // 直接写 memory.json（绕过 appendKB 避免 legacy 自引）
      const merged = [...existing, ...toAdd];
      await this.ensureDirs();
      await withLock(this.sharedDir, 'migrateLegacyKB', async () => {
        await fs.writeFile(path.join(this.sharedDir, MEMORY_FILE), JSON.stringify(merged, null, 2), 'utf-8');
      });
      count = toAdd.length;
      // 写回 kb.json 仅保留 persona 条目（readProfile 迁移仍会用）
      const persona = entries.filter(e => e.category === 'persona');
      await fs.writeFile(path.join(this.sharedDir, LEGACY_KB_FILE), JSON.stringify(persona, null, 2), 'utf-8');
    } catch {
      return 0;
    }
    return count;
  }

  private async migrateFromLegacy(): Promise<Profile | null> {
    const legacyStylePath = path.join(this.sharedDir, LEGACY_STYLE_FILE);
    let legacy: any;
    try {
      const raw = await fs.readFile(legacyStylePath, 'utf-8');
      legacy = JSON.parse(raw);
    } catch {
      return null;
    }

    const dna = legacy.dna || {};
    const profile: Profile = {
      userId: legacy.userId || '',
      version: legacy.version || 1,
      voiceprintStatus: 'done',
      corePrinciples: [...(dna.corePrinciples || [])],
      syntaxPatterns: { ...(dna.syntaxPatterns || {}) },
      vocabulary: {
        highFreq: [...((dna.vocabulary as any)?.highFreq || [])],
        forbidden: [...((dna.vocabulary as any)?.forbidden || [])],
        techTerms: [...((dna.vocabulary as any)?.techTerms || [])],
      },
      forbiddenPatterns: [...(dna.forbiddenPatterns || [])],
      learnedPatterns: [],
      lastUpdated: legacy.lastUpdated || '',
    };

    // Merge persona KB entries from legacy kb.json
    try {
      const kbRaw = await fs.readFile(path.join(this.sharedDir, LEGACY_KB_FILE), 'utf-8');
      const entries: KBEntry[] = JSON.parse(kbRaw);
      for (const e of entries) {
        if (e.category === 'persona' && e.source !== 'voiceprint') {
          profile.learnedPatterns.push({
            pattern: e.content,
            source: e.source,
            timestamp: e.timestamp,
            confirmed: e.confidence === 'high',
          });
        }
      }
    } catch {}

    await this.writeProfile(profile);
    return profile;
  }

  // ========== PROFILE ==========

  async readProfile(): Promise<Profile | null> {
    try {
      const p = path.join(this.sharedDir, PROFILE_FILE);
      const raw = await fs.readFile(p, 'utf-8');
      return JSON.parse(raw);
    } catch {}

    // Legacy: migrate from style-dna.json
    return this.migrateFromLegacy();
  }

  async writeProfile(profile: Profile): Promise<void> {
    await this.ensureDirs();
    await withLock(this.sharedDir, 'writeProfile', async () => {
      const p = path.join(this.sharedDir, PROFILE_FILE);
      await fs.writeFile(p, JSON.stringify(profile, null, 2), 'utf-8');
    });
  }

  // ========== MEMORY ==========

  async readKB(temperature?: Temperature): Promise<KBEntry[]> {
    try {
      const p = path.join(this.sharedDir, MEMORY_FILE);
      const raw = await fs.readFile(p, 'utf-8');
      const entries: KBEntry[] = JSON.parse(raw);
      if (temperature === 'hot') {
        return entries.filter(e => e.confidence === 'high');
      }
      return entries;
    } catch {
      // Legacy: read from kb.json
      try {
        const raw = await fs.readFile(path.join(this.sharedDir, LEGACY_KB_FILE), 'utf-8');
        const entries: KBEntry[] = JSON.parse(raw);
        if (temperature === 'hot') {
          return entries.filter(e => e.confidence === 'high');
        }
        return entries;
      } catch {
        return [];
      }
    }
  }

  async appendKB(entry: KBEntry): Promise<void> {
    await this.ensureDirs();
    const p = path.join(this.sharedDir, MEMORY_FILE);
    await withLock(this.sharedDir, 'appendKB', async () => {
      let existing: KBEntry[] = [];
      try {
        const raw = await fs.readFile(p, 'utf-8');
        existing = JSON.parse(raw);
      } catch {
        // Try legacy kb.json
        try {
          const raw = await fs.readFile(path.join(this.sharedDir, LEGACY_KB_FILE), 'utf-8');
          existing = JSON.parse(raw);
        } catch {}
      }
      existing.push(entry);
      await fs.writeFile(p, JSON.stringify(existing, null, 2), 'utf-8');
    });

    await this.appendInsight(
      `[KB] ${entry.category}: ${entry.content.substring(0, 120)}`,
      entry.source,
    );
  }

  // ========== 用户画像 ==========

  async readPersona(): Promise<string | null> {
    try {
      const p = path.join(this.sharedDir, 'profile', 'persona.md');
      return await fs.readFile(p, 'utf-8');
    } catch {
      return null;
    }
  }

  async writePersona(content: string): Promise<void> {
    await this.ensureDirs();
    const p = path.join(this.sharedDir, 'profile', 'persona.md');
    await withLock(this.sharedDir, 'writePersona', async () => {
      await fs.writeFile(p, content, 'utf-8');
    });
  }

  // ========== 洞察日志 ==========

  async readInsights(): Promise<string | null> {
    try {
      const p = path.join(this.sharedDir, 'memory', 'insights.md');
      return await fs.readFile(p, 'utf-8');
    } catch {
      return null;
    }
  }

  async appendInsight(content: string, source: AgentRole): Promise<void> {
    const timestamp = new Date().toISOString();
    const line = `- [${timestamp}] (${source}) ${content}\n`;
    await this.ensureDirs();
    const p = path.join(this.sharedDir, 'memory', 'insights.md');
    await withLock(this.sharedDir, 'appendInsight', async () => {
      try {
        const existing = await fs.readFile(p, 'utf-8');
        await fs.writeFile(p, existing + line, 'utf-8');
      } catch {
        await fs.writeFile(p, `# 交互洞察\n\n> 由 pipeline-continue 拦截钩子自动填充\n\n${line}`, 'utf-8');
      }
    });
  }

  // ========== Voiceprint 状态机 ==========

  private statePath(): string {
    return path.join(this.sharedDir, 'voiceprint-state.json');
  }

  async readVoiceprintState(): Promise<import('../types.js').VoiceprintState | null> {
    try {
      const raw = await fs.readFile(this.statePath(), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async writeVoiceprintState(state: import('../types.js').VoiceprintState): Promise<void> {
    await this.ensureDirs();
    await withLock(this.sharedDir, 'voiceprintState', async () => {
      await fs.writeFile(this.statePath(), JSON.stringify(state, null, 2), 'utf-8');
    });
  }

  async resetVoiceprintState(): Promise<void> {
    try { await fs.unlink(this.statePath()); } catch {}
  }

  // ========== 组合查询 ==========

  async buildInjectionContext(temperature: Temperature): Promise<{
    profile: Profile | null;
    topKB: KBEntry[];
    persona: string | null;
  }> {
    const p = await this.readProfile();
    const topKB = await this.readKB(temperature);
    const persona = await this.readPersona();
    return { profile: p, topKB, persona };
  }

  // ========== 纠正信号 ==========

  async processCorrectionSignal(signal: CorrectionSignal): Promise<boolean> {
    let changed = false;
    const profile = await this.readProfile();
    if (!profile) return false;

    if (signal.type === 'forbidden') {
      if (!profile.forbiddenPatterns.includes(signal.quote)) {
        profile.forbiddenPatterns.push(signal.quote);
        profile.version += 1;
        profile.lastUpdated = new Date().toISOString();
        await this.writeProfile(profile);
        changed = true;
      }
    }

    if (signal.type === 'preference') {
      if (!profile.vocabulary.highFreq.includes(signal.quote)) {
        profile.vocabulary.highFreq.push(signal.quote);
        profile.version += 1;
        profile.lastUpdated = new Date().toISOString();
        await this.writeProfile(profile);
        changed = true;
      }
    }

    const entry: KBEntry = {
      userId: signal.userId,
      category: signal.type === 'praise' ? 'feedback' : 'insight',
      content: signal.quote,
      source: signal.agent,
      timestamp: new Date().toISOString(),
      confidence: 'high',
    };
    await this.appendKB(entry);

    return changed;
  }
}

// ========== 导出工具函数 ==========

export async function styleReadProfile(
  workspaceRoot: string,
  userId: string,
): Promise<Profile | null> {
  const system = new StyleSystem(workspaceRoot, userId);
  return await system.readProfile();
}

export async function styleWriteProfile(
  workspaceRoot: string,
  userId: string,
  profile: Profile,
): Promise<void> {
  const system = new StyleSystem(workspaceRoot, userId);
  await system.writeProfile(profile);
}

export async function styleExtractSignal(
  workspaceRoot: string,
  userId: string,
  signal: CorrectionSignal,
): Promise<boolean> {
  const system = new StyleSystem(workspaceRoot, userId);
  return await system.processCorrectionSignal(signal);
}

export async function kbWrite(
  workspaceRoot: string,
  userId: string,
  entry: KBEntry,
): Promise<void> {
  const system = new StyleSystem(workspaceRoot, userId);
  await system.appendKB(entry);
}

export async function kbRead(
  workspaceRoot: string,
  userId: string,
  category?: string,
): Promise<KBEntry[]> {
  const system = new StyleSystem(workspaceRoot, userId);
  const entries = await system.readKB();
  if (category) {
    return entries.filter(e => e.category === category);
  }
  return entries;
}

export async function styleGetContext(
  workspaceRoot: string,
  userId: string,
): Promise<{
  profile: Profile | null;
  persona: string | null;
  insights: string | null;
  recentKB: KBEntry[];
}> {
  const system = new StyleSystem(workspaceRoot, userId);
  const p = await system.readProfile();
  const persona = await system.readPersona();
  const insights = await system.readInsights();
  const recentKB = await system.readKB('hot');
  return { profile: p, persona, insights, recentKB };
}

// ========== Voiceprint 步骤 ==========

const STEP_PROMPTS: Record<number, (state: import('../types.js').VoiceprintState) => string> = {
  0: () => [
    '我看你是第一次用这个系统。要不要先做个"风格快照"？',
    '你写几段文字，我学习一下你的表达习惯，后面输出会更贴你的风格。',
    '',
    '你有之前写过的文字吗？贴 1-3 段过来也行。',
    '或者，如果你愿意，我引导你写 4 段不同类型的文字。',
    '',
    '直接贴文章，或者回复"好，引导我写"都可以。',
  ].join('\n'),

  1: () => '先写一段自我介绍吧：你是谁、做什么的、平时写什么内容？不用很长，3-5 句就行。',

  2: () => '再写一段你最近深入思考的概念或想法。比如你最近在琢磨什么，有什么见解？',

  3: () => '推荐一个你喜欢的东西（书/工具/电影/产品），说说为什么推荐。',

  4: () => '最后一段：用你给朋友发消息的语气，写一两句随意的表达。随便说什么都行。',

  5: (s) => {
    const labels = s.samples.map(s => `  - ${s.label}`).join('\n');
    return [
      '好了，我收集了这些样本：',
      '',
      labels,
      '',
      '够用了，开始分析你的风格吧。如果你想再补充一段，也可以继续贴。',
      '回复"分析"进行下一步，或者再发一段文字。',
    ].join('\n');
  },

  6: () => [
    '现在我总结一下刚才收集的样本，发给分析助手做深度分析。',
    '稍等一下……',
  ].join('\n'),

  7: () => [
    '句子长度，你倾向哪种？',
    '  A) 短句为主（< 20 字）— 短促有力',
    '  B) 中等（20-40 字）— 平常自然（推荐）',
    '  C) 长句为主（> 40 字）— 信息密集',
    '',
    'Emoji 呢？',
    '  A) 喜欢用',
    '  B) 基本不用',
    '',
    '感叹号？',
    '  A) 喜欢用',
    '  B) 基本不用',
    '',
    '整体语气？',
    '  A) 随意 / 口语化',
    '  B) 正式 / 书面感',
    '  C) 平衡（推荐）',
    '',
    '直接回复选项，比如"AAB"或者"短句中等等等不用不用平衡"。',
  ].join('\n'),

  8: (s) => {
    const detected = (s.analysis?.forbiddenPatterns || []).slice(0, 6);
    if (!detected.length) {
      return '我没发现明显的 AI 腔或禁用语，跳过这一步。回复"继续"。';
    }
    const list = detected.map((p, i) => `  ${i + 1}. "${p}"`).join('\n');
    return [
      '我注意到你用了这些表达，有点像 AI 腔，以后要禁止吗？',
      '',
      list,
      '',
      '回复序号来勾选，比如"1 2 3"，或者回复"都不加"。',
    ].join('\n');
  },

  9: () => [
    '分析完成了，我来看看结果……',
    '',
    '我的理解是这样，你看对吗？',
    '不对的地方告诉我，我调整。如果没问题，回复"确认"。',
  ].join('\n'),

  10: () => [
    '风格快照已经锁定。',
    '以后写东西我会自动参考你的风格偏好。',
    '随时可以跟我说"调整风格"来修改。',
  ].join('\n'),
};

export async function voiceprintInit(
  workspaceRoot: string,
  userId: string,
): Promise<{
  exists: boolean;
  state: import('../types.js').VoiceprintState | null;
  prompt?: string;
  profile?: Profile;
}> {
  const system = new StyleSystem(workspaceRoot, userId);
  const profile = await system.readProfile();
  const state = await system.readVoiceprintState();

  if (state && state.step >= 99) {
    return { exists: true, state, profile: profile || undefined };
  }

  if (!profile) {
    const defaultProfile: Profile = {
      userId, version: 1,
      voiceprintStatus: 'init',
      corePrinciples: [],
      syntaxPatterns: {},
      vocabulary: { highFreq: [], forbidden: [], techTerms: [] },
      forbiddenPatterns: [],
      learnedPatterns: [],
      lastUpdated: new Date().toISOString(),
    };
    await system.writeProfile(defaultProfile);
  }

  if (!state) {
    const newState: import('../types.js').VoiceprintState = {
      step: 0, path: null, samples: [], confirmed: false, updatedAt: new Date().toISOString(),
    };
    await system.writeVoiceprintState(newState);
  }

  const currentState = state || await system.readVoiceprintState();
  const currentPrompt = currentState ? STEP_PROMPTS[currentState.step]?.(currentState) : undefined;

  return { exists: !!profile, state: currentState, prompt: currentPrompt };
}

export async function voiceprintReset(
  workspaceRoot: string,
  userId: string,
): Promise<{ message: string }> {
  const system = new StyleSystem(workspaceRoot, userId);
  await system.resetVoiceprintState();
  return { message: 'Voiceprint 状态已重置。下次调用 voiceprint_init 将从头开始。' };
}

export async function voiceprintProceed(
  workspaceRoot: string,
  userId: string,
  params: {
    sample?: { text: string; label: string };
    path?: 'A' | 'B';
    done?: boolean;
  },
): Promise<{
  state: import('../types.js').VoiceprintState;
  prompt: string;
}> {
  const system = new StyleSystem(workspaceRoot, userId);
  const state = await system.readVoiceprintState();
  if (!state) throw new Error('请先调用 voiceprint_init 初始化');

  if (params.path) state.path = params.path;

  if (params.sample) {
    state.samples.push(params.sample);
  }

  if (state.path === 'A' && state.step >= 1 && state.step <= 4 && params.sample) {
    state.step += 1;
  }

  if (state.path === 'B' && state.step <= 5) {
    state.step = 5;
  }

  if (params.done || state.step === 5) {
    state.step = 7;
  }

  state.updatedAt = new Date().toISOString();
  await system.writeVoiceprintState(state);

  const prompt = STEP_PROMPTS[state.step]?.(state) || '继续。';

  return { state, prompt };
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export async function voiceprintAnalyze(
  workspaceRoot: string,
  userId: string,
  params: {
    samples: Array<{ text: string; label: string }>;
    analysis: {
      corePrinciples: string[];
      forbiddenPatterns: string[];
      highFreqWords: string[];
      techTerms?: string[];
      syntaxPatterns: Record<string, unknown>;
      growthDirection?: string;
    };
  },
): Promise<{ profile: Profile; state: import('../types.js').VoiceprintState; prompt: string }> {
  const system = new StyleSystem(workspaceRoot, userId);

  const state = await system.readVoiceprintState();
  if (!state) throw new Error('尚无 voiceprint 状态，请先调用 voiceprint_init');
  if (state.step !== 9) {
    throw new Error(`当前在步骤 ${state.step}，还不能做分析。请先完成步骤 7-8 校准。`);
  }

  const existing = await system.readProfile();
  if (!existing) throw new Error('尚无 profile.json');

  // 写入样本到 KB
  for (const sample of params.samples) {
    await system.appendKB({
      userId, category: 'persona',
      content: `写作样本 (${sample.label}): ${sample.text.substring(0, 300)}`,
      source: 'voiceprint', timestamp: new Date().toISOString(), confidence: 'high',
    });
  }

  // 写入分析结论
  existing.corePrinciples = uniq([...existing.corePrinciples, ...params.analysis.corePrinciples]);
  existing.forbiddenPatterns = uniq([...existing.forbiddenPatterns, ...params.analysis.forbiddenPatterns]);
  existing.syntaxPatterns = { ...existing.syntaxPatterns, ...params.analysis.syntaxPatterns };

  const v = existing.vocabulary;
  v.highFreq = uniq([...v.highFreq, ...params.analysis.highFreqWords]);
  if (params.analysis.techTerms) v.techTerms = uniq([...v.techTerms, ...params.analysis.techTerms]);
  const suggestedForbidden = params.analysis.forbiddenPatterns.filter(p => !v.forbidden.includes(p));
  v.forbidden = uniq([...v.forbidden, ...suggestedForbidden]);

  existing.version += 1;
  existing.lastUpdated = new Date().toISOString();
  existing.voiceprintStatus = 'analyzing';
  await system.writeProfile(existing);

  state.analysis = {
    corePrinciples: params.analysis.corePrinciples,
    forbiddenPatterns: params.analysis.forbiddenPatterns,
    highFreqWords: params.analysis.highFreqWords,
    techTerms: params.analysis.techTerms,
    syntaxPatterns: params.analysis.syntaxPatterns,
    growthDirection: params.analysis.growthDirection,
  };
  state.step = 10;
  state.updatedAt = new Date().toISOString();
  await system.writeVoiceprintState(state);

  await system.appendInsight(
    `[Voiceprint] 子 agent 分析完成: ${params.samples.length} 个样本, ${params.analysis.corePrinciples.length} 条核心原则, ${params.analysis.forbiddenPatterns.length} 条禁止模式`,
    'voiceprint',
  );

  const prompt = STEP_PROMPTS[10]?.(state) || '风格分析完成。回复"确认"锁定。';

  return { profile: existing, state, prompt };
}

export async function voiceprintCalibrate(
  workspaceRoot: string,
  userId: string,
  preferences: {
    sentenceLength?: 'short' | 'medium' | 'long';
    useEmoji?: boolean;
    useExclamation?: boolean;
    useDash?: boolean;
    tone?: 'casual' | 'formal' | 'balanced';
    selectedForbiddenPhrases?: string[];
  },
): Promise<{ profile: Profile; state: import('../types.js').VoiceprintState; prompt: string }> {
  const system = new StyleSystem(workspaceRoot, userId);
  const existing = await system.readProfile();
  if (!existing) throw new Error('尚无 profile.json，请先调用 voiceprint_init');

  const state = await system.readVoiceprintState();
  if (!state) throw new Error('尚无 voiceprint 状态，请先调用 voiceprint_init');
  if (state.step !== 7 && state.step !== 8) {
    throw new Error(`当前在步骤 ${state.step}，还不能做校准。请按流程推进。`);
  }

  if (preferences.sentenceLength) {
    const lengthMap = { short: 15, medium: 30, long: 50 };
    existing.syntaxPatterns.preferedSentenceLength = lengthMap[preferences.sentenceLength];
  }
  if (preferences.useEmoji !== undefined) existing.syntaxPatterns.usesEmoji = preferences.useEmoji;
  if (preferences.useExclamation !== undefined) existing.syntaxPatterns.usesExclamation = preferences.useExclamation;
  if (preferences.useDash !== undefined) existing.syntaxPatterns.usesDash = preferences.useDash;
  if (preferences.tone) existing.syntaxPatterns.tone = preferences.tone;

  if (preferences.selectedForbiddenPhrases?.length) {
    const v = existing.vocabulary;
    for (const phrase of preferences.selectedForbiddenPhrases) {
      if (!v.forbidden.includes(phrase)) v.forbidden.push(phrase);
      if (!existing.forbiddenPatterns.includes(phrase)) existing.forbiddenPatterns.push(phrase);
    }
  }

  existing.version += 1;
  existing.lastUpdated = new Date().toISOString();
  existing.voiceprintStatus = 'calibrating';
  await system.writeProfile(existing);

  state.preferences = { ...state.preferences, ...preferences };
  state.step = 9;
  state.updatedAt = new Date().toISOString();
  await system.writeVoiceprintState(state);

  await system.appendInsight(`[Voiceprint] 偏好校准完成: 句长=${preferences.sentenceLength || '未设置'}, 禁用词=${preferences.selectedForbiddenPhrases?.length || 0} 个`, 'voiceprint');

  const prompt = STEP_PROMPTS[state.step]?.(state) || '继续。';

  return { profile: existing, state, prompt };
}

export async function voiceprintConfirm(
  workspaceRoot: string,
  userId: string,
  params?: { corrections?: string[] },
): Promise<{ summary: string; profile: Profile; prompt: string }> {
  const system = new StyleSystem(workspaceRoot, userId);

  const state = await system.readVoiceprintState();
  if (!state) throw new Error('尚无 voiceprint 状态，请先调用 voiceprint_init');
  if (state.step !== 10) {
    throw new Error(`当前在步骤 ${state.step}，还不能做确认。请先完成步骤 9 分析。`);
  }

  const profile = await system.readProfile();
  if (!profile) throw new Error('尚无以确认的风格 DNA');

  // 如果用户有修正，记录到 KB 但不写死
  if (params?.corrections?.length) {
    for (const c of params.corrections) {
      await system.appendKB({
        userId, category: 'feedback',
        content: `Voiceprint 确认时的修正: ${c}`,
        source: 'voiceprint', timestamp: new Date().toISOString(), confidence: 'high',
      });
    }
    return {
      summary: '已记录修正。请重新做一次分析以应用修正。',
      profile,
      prompt: '我记录了你的修正。需要重新分析一下吗？回复"重新分析"或"确认"。',
    };
  }

  // 生成 human-readable 摘要
  const lines: string[] = [
    `# ${userId} 的风格 DNA`,
    '',
    '## 核心原则',
    ...(profile.corePrinciples.length ? profile.corePrinciples.map(p => `- ${p}`) : ['- （无）']),
    '',
    '## 禁用模式',
    ...(profile.forbiddenPatterns.length ? profile.forbiddenPatterns.map(p => `- ${p}`) : ['- （无）']),
    '',
    '## 句法偏好',
    ...(() => {
      const sp = profile.syntaxPatterns;
      const items: string[] = [];
      if (sp.preferedSentenceLength) items.push(`- 句长: ${sp.preferedSentenceLength} 字符`);
      if (sp.usesEmoji !== undefined) items.push(`- Emoji: ${sp.usesEmoji ? '使用' : '不使用'}`);
      if (sp.usesExclamation !== undefined) items.push(`- 感叹号: ${sp.usesExclamation ? '使用' : '不使用'}`);
      if (sp.tone) items.push(`- 语气: ${sp.tone}`);
      if (!items.length) items.push('- （无）');
      return items;
    })(),
    '',
    '## 高频词汇',
    ...(profile.vocabulary.highFreq.length ? profile.vocabulary.highFreq.map(w => `- ${w}`) : ['- （无）']),
    '',
    '## 禁用词汇',
    ...(profile.vocabulary.forbidden.length ? profile.vocabulary.forbidden.map(w => `- ${w}`) : ['- （无）']),
    '',
    '## 领域术语',
    ...(profile.vocabulary.techTerms.length ? profile.vocabulary.techTerms.map(t => `- ${t}`) : ['- （无）']),
    '',
    ...(profile.learnedPatterns.length ? [
      '## 学习中的模式（待确认）',
      ...profile.learnedPatterns.map(p => `- ${p.pattern} (${p.source})`),
      '',
    ] : []),
    '',
    `> 由 Voiceprint 流程于 ${new Date().toISOString()} 生成`,
  ];

  const summary = lines.join('\n');

  await system.writePersona(summary);

  // 标记状态完成
  state.step = 99;
  state.confirmed = true;
  state.updatedAt = new Date().toISOString();
  await system.writeVoiceprintState(state);

  profile.version += 1;
  profile.lastUpdated = new Date().toISOString();
  profile.voiceprintStatus = 'done';
  await system.writeProfile(profile);

  await system.appendInsight(`[Voiceprint] 已完成并确认。${profile.corePrinciples.length} 条原则, ${profile.forbiddenPatterns.length} 个禁用模式`, 'voiceprint');

  const prompt = STEP_PROMPTS[99]?.(state) || '风格快照已锁定。';

  return { summary, profile, prompt };
}
