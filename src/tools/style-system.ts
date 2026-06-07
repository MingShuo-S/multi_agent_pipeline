// src/tools/style-system.ts - 共享知识库管理
// 架构复制自 0.AI工作区：
//   温度分层 (HOT/WARM/COLD) — 活跃度决定注入策略
//   双格式 (compact + full) — _shared/ 索引 + 详情文件
//   条件反射: 学→记 — processCorrectionSignal 即学即写
//   检索补全 (L1-L3) — readProfile 逐级 fallback
//   文件锁 — writeLock 防并发写冲突

import { promises as fs } from 'fs';
import path from 'path';
import type { StyleProfile, KBEntry, CorrectionSignal, AgentRole } from '../types.js';

export type Temperature = 'hot' | 'warm' | 'cold';

export interface TunedProfile extends StyleProfile {
  temperatures?: {
    corePrinciples: 'hot';
    forbiddenPatterns: 'warm';
    vocabulary: 'warm';
    kbEntries: 'cold';
    persona: 'cold';
  };
}

// ——— 文件锁 ———
// advisory lock: 写前建 .lock，写后删除。超时自动放弃。
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
      // 检查是否僵死锁
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

export class StyleSystem {
  private sharedDir: string;

  constructor(workspaceRoot: string, userId: string) {
    this.sharedDir = path.join(workspaceRoot, '_shared', userId);
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

  // ---- HOT: 核心原则（始终注入 prompt） ----

  async readProfile(): Promise<StyleProfile | null> {
    // L1: 精确路径
    // L2: 读 style-dna.json
    // L3: 返回 null
    try {
      const p = path.join(this.sharedDir, 'style-dna.json');
      const raw = await fs.readFile(p, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async writeProfile(profile: StyleProfile): Promise<void> {
    await this.ensureDirs();
    await withLock(this.sharedDir, 'writeProfile', async () => {
      const p = path.join(this.sharedDir, 'style-dna.json');
      await fs.writeFile(p, JSON.stringify(profile, null, 2), 'utf-8');
    });
  }

  // ---- Voiceprint 状态机 ----

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

  // ---- WARM: 结构化知识条目（按需读取） ----

  async readKB(temperature?: Temperature): Promise<KBEntry[]> {
    // L1.5: 先读 .ai.md 伴侣文件（紧凑版）
    const aiPath = path.join(this.sharedDir, 'kb.ai.md');
    try {
      // kb.ai.md 是 kb.json 的 AI 可扫描摘要，由外部脚本维护
      await fs.access(aiPath);
      // 如果 .ai.md 存在且请求 warm，返回紧凑版
      if (temperature === 'warm') {
        const raw = await fs.readFile(aiPath, 'utf-8');
        return [{ userId: '', category: 'insight', content: raw, source: 'system', timestamp: '', confidence: 'high' }];
      }
    } catch {
      // L2: 无 .ai.md 文件，读完整 kb.json
    }

    try {
      const p = path.join(this.sharedDir, 'kb.json');
      const raw = await fs.readFile(p, 'utf-8');
      const entries: KBEntry[] = JSON.parse(raw);
      if (temperature === 'hot') {
        return entries.filter(e => e.confidence === 'high');
      }
      return entries;
    } catch {
      // L3: 都找不到，返回空
      return [];
    }
  }

  async appendKB(entry: KBEntry): Promise<void> {
    // 条件反射: 学→记 — 不等待"请记录下来"的指令
    await this.ensureDirs();
    const p = path.join(this.sharedDir, 'kb.json');
    await withLock(this.sharedDir, 'appendKB', async () => {
      let existing: KBEntry[] = [];
      try {
        const raw = await fs.readFile(p, 'utf-8');
        existing = JSON.parse(raw);
      } catch {}
      existing.push(entry);
      await fs.writeFile(p, JSON.stringify(existing, null, 2), 'utf-8');
    });

    await this.appendInsight(
      `[KB] ${entry.category}: ${entry.content.substring(0, 120)}`,
      entry.source,
    );
  }

  // ---- WARM: 用户画像 ----

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

  // ---- WARM: 洞察日志 ----

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

  // ---- HOT/WARM 组合注入查询 ----

  async buildInjectionContext(temperature: Temperature): Promise<{
    styleDNA: StyleProfile | null;
    topKB: KBEntry[];
    persona: string | null;
  }> {
    const styleDNA = await this.readProfile();
    const topKB = await this.readKB(temperature);
    const persona = await this.readPersona();
    return { styleDNA, topKB, persona };
  }

  // ---- 纠正信号处理（条件反射: 学→记） ----

  async processCorrectionSignal(signal: CorrectionSignal): Promise<boolean> {
    let changed = false;
    const profile = await this.readProfile();
    if (!profile) return false;

    const dna = profile.dna;

    // 学→记：发现即写入，不等确认
    if (signal.type === 'forbidden') {
      if (!dna.forbiddenPatterns.includes(signal.quote)) {
        dna.forbiddenPatterns.push(signal.quote);
        profile.version += 1;
        profile.lastUpdated = new Date().toISOString();
        await this.writeProfile(profile);
        changed = true;
      }
    }

    if (signal.type === 'preference') {
      if (!dna.vocabulary.highFreq.includes(signal.quote)) {
        dna.vocabulary.highFreq.push(signal.quote);
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

/**
 * style_read_profile — 读取用户风格 DNA（L1: 精确路径）
 */
export async function styleReadProfile(
  workspaceRoot: string,
  userId: string,
): Promise<StyleProfile | null> {
  const system = new StyleSystem(workspaceRoot, userId);
  return await system.readProfile();
}

/**
 * style_write_profile — 写入用户风格 DNA
 */
export async function styleWriteProfile(
  workspaceRoot: string,
  userId: string,
  profile: StyleProfile,
): Promise<void> {
  const system = new StyleSystem(workspaceRoot, userId);
  await system.writeProfile(profile);
}

/**
 * style_extract_signal — 条件反射: 学→记
 * 由 pipeline-continue 拦截钩子自动调用
 */
export async function styleExtractSignal(
  workspaceRoot: string,
  userId: string,
  signal: CorrectionSignal,
): Promise<boolean> {
  const system = new StyleSystem(workspaceRoot, userId);
  return await system.processCorrectionSignal(signal);
}

/**
 * kb_write — 写入一条知识库条目
 */
export async function kbWrite(
  workspaceRoot: string,
  userId: string,
  entry: KBEntry,
): Promise<void> {
  const system = new StyleSystem(workspaceRoot, userId);
  await system.appendKB(entry);
}

/**
 * kb_read — 读取知识库
 */
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

/**
 * style_get_context — content-writer 专用：拉取完整风格上下文
 * 返回 HOT（核心原则）+ WARM（禁止模式/词汇/句法）+ COLD（persona + insights）
 */
export async function styleGetContext(
  workspaceRoot: string,
  userId: string,
): Promise<{
  styleDNA: StyleProfile | null;
  persona: string | null;
  insights: string | null;
  recentKB: KBEntry[];
}> {
  const system = new StyleSystem(workspaceRoot, userId);
  const styleDNA = await system.readProfile();
  const persona = await system.readPersona();
  const insights = await system.readInsights();
  const recentKB = await system.readKB('hot');
  return { styleDNA, persona, insights, recentKB };
}

/**
 * voiceprint_init — 冷启动：创建初始风格 DNA
 * 如果用户尚无 style-dna.json，创建一个空模板并返回引导提示。
 * 返回: { exists: boolean, prompt?: string, profile?: StyleProfile }
 */
// ——— Voiceprint 步骤提示模板 ——— //

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
  profile?: StyleProfile;
}> {
  const system = new StyleSystem(workspaceRoot, userId);
  const profile = await system.readProfile();
  const state = await system.readVoiceprintState();

  if (state && state.step >= 99) {
    // 已完成
    return { exists: true, state, profile: profile || undefined };
  }

  if (!profile) {
    const defaultProfile: StyleProfile = {
      userId, version: 1, lastUpdated: new Date().toISOString(),
      dna: { corePrinciples: [], syntaxPatterns: {}, vocabulary: { highFreq: [], forbidden: [], techTerms: [] }, forbiddenPatterns: [], growthDirection: '' },
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

/**
 * voiceprint_proceed — 推进 voiceprint 步骤并返回下一步提示
 *
 * 由 orchestrator 在每次用户回复后调用。处理步骤 1-6（样本收集）的自动推进：
 *   - step 1-4: 存储用户写的样本，step +1
 *   - step 5:   orchestrator 判断样本是否足够，传 done=true 则跳到 7
 *   - step 当 path='B': 用户贴文章，orchestrator 判断够了传 done=true
 */
/**
 * voiceprint_reset — 重置 voiceprint 状态，允许用户重新做风格快照
 */
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
    sample?: { text: string; label: string };  // 步骤 1-5 时传入
    path?: 'A' | 'B';
    done?: boolean;   // orchestrator 判断样本够了，跳到步骤 7
  },
): Promise<{
  state: import('../types.js').VoiceprintState;
  prompt: string;
}> {
  const system = new StyleSystem(workspaceRoot, userId);
  const state = await system.readVoiceprintState();
  if (!state) throw new Error('请先调用 voiceprint_init 初始化');

  // 设置路径（首次）
  if (params.path) state.path = params.path;

  // 存储样本
  if (params.sample) {
    state.samples.push(params.sample);
  }

  // 路径 A: 步骤 1-4 自动推进
  if (state.path === 'A' && state.step >= 1 && state.step <= 4 && params.sample) {
    state.step += 1;
  }

  // 路径 B: 不会自动推进步骤，orchestrator 判断够了传 done
  if (state.path === 'B' && state.step <= 5) {
    state.step = 5;  // 固定在"收集够了吗"步骤
  }

  // orchestrator 说够了 → 跳到校准
  if (params.done || state.step === 5) {
    state.step = 7;
  }

  state.updatedAt = new Date().toISOString();
  await system.writeVoiceprintState(state);

  const prompt = STEP_PROMPTS[state.step]?.(state) || '继续。';

  return { state, prompt };
}

/**
 * voiceprint_analyze — 接受子 agent 的分析结论，写入 style-dna.json
 *
 * 工作流（由 orchestrator 按 voiceprint-guide.md 执行）:
 *   1. 收集用户写作样本（路径 A: 5 段引导式 / 路径 B: 贴现有文章）
 *   2. orchestrator 调用 route_message 发给 content-writer 分析
 *   3. content-writer 返回分析结论（含 corePrinciples / forbiddenPatterns / vocabulary / syntaxPatterns / growthDirection）
 *   4. orchestrator 调 voiceprint_analyze 写入
 */
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
): Promise<{ profile: StyleProfile; state: import('../types.js').VoiceprintState; prompt: string }> {
  const system = new StyleSystem(workspaceRoot, userId);

  // 校验状态
  const state = await system.readVoiceprintState();
  if (!state) throw new Error('尚无 voiceprint 状态，请先调用 voiceprint_init');
  if (state.step !== 9) {
    throw new Error(`当前在步骤 ${state.step}，还不能做分析。请先完成步骤 7-8 校准。`);
  }

  const existing = await system.readProfile();
  if (!existing) throw new Error('尚无 style-dna.json');

  // 写入样本到 KB
  for (const sample of params.samples) {
    await system.appendKB({
      userId, category: 'persona',
      content: `写作样本 (${sample.label}): ${sample.text.substring(0, 300)}`,
      source: 'voiceprint', timestamp: new Date().toISOString(), confidence: 'high',
    });
  }

  // 写入分析结论
  existing.dna.corePrinciples = uniq([...existing.dna.corePrinciples, ...params.analysis.corePrinciples]);
  existing.dna.forbiddenPatterns = uniq([...existing.dna.forbiddenPatterns, ...params.analysis.forbiddenPatterns]);
  existing.dna.syntaxPatterns = { ...existing.dna.syntaxPatterns, ...params.analysis.syntaxPatterns };
  if (params.analysis.growthDirection) existing.dna.growthDirection = params.analysis.growthDirection;

  const v = existing.dna.vocabulary;
  v.highFreq = uniq([...v.highFreq, ...params.analysis.highFreqWords]);
  if (params.analysis.techTerms) v.techTerms = uniq([...v.techTerms, ...params.analysis.techTerms]);
  const suggestedForbidden = params.analysis.forbiddenPatterns.filter(p => !v.forbidden.includes(p));
  v.forbidden = uniq([...v.forbidden, ...suggestedForbidden]);

  existing.version += 1;
  existing.lastUpdated = new Date().toISOString();
  await system.writeProfile(existing);

  // 存储分析到 state，推进到步骤 10
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

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/**
 * voiceprint_calibrate — 偏好校准：写入用户选择的偏好选项
 *
 * 在 Voiceprint 步骤 7-8 中调用：
 *   步骤 7: 句长 / 标点 / emoji 偏好（多选题）
 *   步骤 8: 禁用语选择（多选题）
 */
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
): Promise<{ profile: StyleProfile; state: import('../types.js').VoiceprintState; prompt: string }> {
  const system = new StyleSystem(workspaceRoot, userId);
  const existing = await system.readProfile();
  if (!existing) throw new Error('尚无 style-dna.json，请先调用 voiceprint_init');

  // 校验状态
  const state = await system.readVoiceprintState();
  if (!state) throw new Error('尚无 voiceprint 状态，请先调用 voiceprint_init');
  if (state.step !== 7 && state.step !== 8) {
    throw new Error(`当前在步骤 ${state.step}，还不能做校准。请按流程推进。`);
  }

  if (preferences.sentenceLength) {
    const lengthMap = { short: 15, medium: 30, long: 50 };
    existing.dna.syntaxPatterns.preferedSentenceLength = lengthMap[preferences.sentenceLength];
  }
  if (preferences.useEmoji !== undefined) existing.dna.syntaxPatterns.usesEmoji = preferences.useEmoji;
  if (preferences.useExclamation !== undefined) existing.dna.syntaxPatterns.usesExclamation = preferences.useExclamation;
  if (preferences.useDash !== undefined) existing.dna.syntaxPatterns.usesDash = preferences.useDash;
  if (preferences.tone) existing.dna.syntaxPatterns.tone = preferences.tone;

  if (preferences.selectedForbiddenPhrases?.length) {
    const v = existing.dna.vocabulary;
    for (const phrase of preferences.selectedForbiddenPhrases) {
      if (!v.forbidden.includes(phrase)) v.forbidden.push(phrase);
      if (!existing.dna.forbiddenPatterns.includes(phrase)) existing.dna.forbiddenPatterns.push(phrase);
    }
  }

  existing.version += 1;
  existing.lastUpdated = new Date().toISOString();
  await system.writeProfile(existing);

  // 存储偏好到 state
  state.preferences = { ...state.preferences, ...preferences };
  state.step = 9;  // 校准完成，跳转到分析
  state.updatedAt = new Date().toISOString();
  await system.writeVoiceprintState(state);

  await system.appendInsight(`[Voiceprint] 偏好校准完成: 句长=${preferences.sentenceLength || '未设置'}, 禁用词=${preferences.selectedForbiddenPhrases?.length || 0} 个`, 'voiceprint');

  const prompt = STEP_PROMPTS[state.step]?.(state) || '继续。';

  return { profile: existing, state, prompt };
}

/**
 * voiceprint_confirm — 展示当前风格 DNA → 确认 → 写死 persona.md
 *
 * 在 Voiceprint 步骤 10 中调用：
 *   1. 读取 style-dna.json 中的完整分析结论
 *   2. 写入 profile/persona.md（human-readable 版本）
 *   3. 写入 KB 一条 { category: 'persona', confidence: 'high' } 表示 Voiceprint 已完成
 */
export async function voiceprintConfirm(
  workspaceRoot: string,
  userId: string,
  params?: { corrections?: string[] },
): Promise<{ summary: string; profile: StyleProfile; prompt: string }> {
  const system = new StyleSystem(workspaceRoot, userId);

  // 校验状态
  const state = await system.readVoiceprintState();
  if (!state) throw new Error('尚无 voiceprint 状态，请先调用 voiceprint_init');
  if (state.step !== 10) {
    throw new Error(`当前在步骤 ${state.step}，还不能做确认。请先完成步骤 9 分析。`);
  }

  const profile = await system.readProfile();
  if (!profile) throw new Error('尚无以确认的风格 DNA');

  const dna = profile.dna;

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
    ...(dna.corePrinciples.length ? dna.corePrinciples.map(p => `- ${p}`) : ['- （无）']),
    '',
    '## 禁用模式',
    ...(dna.forbiddenPatterns.length ? dna.forbiddenPatterns.map(p => `- ${p}`) : ['- （无）']),
    '',
    '## 句法偏好',
    ...(() => {
      const sp = dna.syntaxPatterns;
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
    ...(dna.vocabulary.highFreq.length ? dna.vocabulary.highFreq.map(w => `- ${w}`) : ['- （无）']),
    '',
    '## 禁用词汇',
    ...(dna.vocabulary.forbidden.length ? dna.vocabulary.forbidden.map(w => `- ${w}`) : ['- （无）']),
    '',
    '## 领域术语',
    ...(dna.vocabulary.techTerms.length ? dna.vocabulary.techTerms.map(t => `- ${t}`) : ['- （无）']),
    '',
    '## 成长方向',
    dna.growthDirection || '（无）',
    '',
    `> 由 Voiceprint 流程于 ${new Date().toISOString()} 生成`,
  ];

  const summary = lines.join('\n');

  // 写入 persona.md
  await system.writePersona(summary);

  // 写入 KB
  const entry: import('../types.js').KBEntry = {
    userId, category: 'persona',
    content: `Voiceprint 已完成。核心原则: ${dna.corePrinciples.join('; ').substring(0, 200)}`,
    source: 'voiceprint', timestamp: new Date().toISOString(), confidence: 'high',
  };
  await system.appendKB(entry);

  // 标记状态完成
  state.step = 99;
  state.confirmed = true;
  state.updatedAt = new Date().toISOString();
  await system.writeVoiceprintState(state);

  profile.version += 1;
  profile.lastUpdated = new Date().toISOString();
  await system.writeProfile(profile);

  await system.appendInsight(`[Voiceprint] 已完成并确认。${dna.corePrinciples.length} 条原则, ${dna.forbiddenPatterns.length} 个禁用模式`, 'voiceprint');

  const prompt = STEP_PROMPTS[99]?.(state) || '风格快照已锁定。';

  return { summary, profile, prompt };
}

// 所有 voiceprint / style 工具的 OpenClaw 注册在 index.ts 中完成
// styleToolsExport 已弃用，将所有注册移到 index.ts 统一管理
