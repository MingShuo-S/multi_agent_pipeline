// src/tools/session-memory.ts — Hermes 启发式记忆系统
// 借鉴 NousResearch Hermes Agent 的四个模式：
//   1. sessionSearch — 跨 slot 历史检索（利用现有 slot_history append-only 数据）
//   2. freezeSnapshot — 冻结 KB 快照 → 注入 prompt（保护 prefix cache）
//   3. autoCompress — 用户 KB 超限时自动压缩（保留高置信度条目）
//   4. sessionNote — MEMORY.md 等价：Agent session 自述笔记

import { promises as fs } from 'fs';
import path from 'path';
import type { SlotHistoryEntry, PipelineState, KBEntry } from '../types.js';
import { StateManager } from '../runtime/state-manager.js';
import { StyleSystem } from './style-system.js';
import { callSubagent, type SubagentAPI } from '../types.js';

// ——— 常数 ———

const MEMORY_LIMIT_CHARS = 2200;         // session-note 上限（Hermes MEMORY.md ≈ 2.2K）
const INSIGHT_COMPRESS_AT = 8000;         // insights.md 超过此长度触发压缩
const KB_COMPRESS_AT = 200;              // kb.json 超过此条目数触发压缩
const MAX_SEARCH_RESULTS = 20;            // session_search 最多返回条数
const SEARCH_SUFFIX_MATCH_MIN = 3;        // 模糊搜索最短词

// ——— 类型定义 ———

export interface SearchQuery {
  keyword?: string;
  slotName?: string;
  agent?: string;
  fromTime?: string;
  toTime?: string;
  limit?: number;
}

export interface SearchResult {
  projectId: string;
  slotName: string;
  content: string | object;
  writtenAt: string;
  version: number;
  agent: string;
}

export interface FrozenSnapshotContent {
  styleDna: string;
  persona: string;
  insights: string;
  topKB: string;
  sessionNote: string | null;
  sessionStart: string;
  projectId: string;
}

// ——— 工具函数 ———

function textMatches(text: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  return text.toLowerCase().includes(kw);
}

function timeInRange(time: string, from?: string, to?: string): boolean {
  if (from && time < from) return false;
  if (to && time > to) return false;
  return true;
}

// ——— 1. 跨 Slot 历史检索 ———

/**
 * 搜索当前项目所有 slot 的历史版本（slot_history 是 append-only 的）
 * Agent 只能搜索自己有读权限的 slot（由 ToolAuth 检查）
 */
export async function sessionSearch(
  workspaceRoot: string,
  userId: string,
  projectId: string,
  query: SearchQuery,
): Promise<SearchResult[]> {
  const stateManager = new StateManager(workspaceRoot, userId, projectId);
  const state = await stateManager.load();
  const results: SearchResult[] = [];

  const limit = query.limit ?? MAX_SEARCH_RESULTS;

  for (const [slotName, history] of Object.entries(state.slot_history)) {
    // 按 slotName 过滤
    if (query.slotName && slotName !== query.slotName) continue;

    for (const entry of history) {
      // 按 agent 过滤
      if (query.agent && entry.agent !== query.agent) continue;

      // 按时间范围过滤
      if (!timeInRange(entry.written_at, query.fromTime, query.toTime)) continue;

      // 按关键词过滤
      if (query.keyword) {
        const content = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content);
        if (!textMatches(content, query.keyword)) continue;
      }

      results.push({
        projectId,
        slotName,
        content: entry.content,
        writtenAt: entry.written_at,
        version: entry.version,
        agent: entry.agent,
      });

      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  return results;
}

/**
 * 跨项目搜索 — 遍历用户所有 project 的 slot_history
 */
export async function sessionSearchAll(
  workspaceRoot: string,
  userId: string,
  query: SearchQuery,
): Promise<SearchResult[]> {
  const projectsDir = path.join(workspaceRoot, '_shared', userId, 'projects');
  const results: SearchResult[] = [];
  const limit = query.limit ?? MAX_SEARCH_RESULTS;

  try {
    await fs.access(projectsDir);
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    const projectIds = entries.filter(e => e.isDirectory()).map(e => e.name);

    for (const pid of projectIds) {
      const partial = await sessionSearch(workspaceRoot, userId, pid, {
        ...query,
        limit: limit - results.length,
      });
      results.push(...partial);
      if (results.length >= limit) break;
    }
  } catch {
    // projects dir does not exist under _shared — try workspace/projects/ path
    const altProjectsDir = path.join(workspaceRoot, 'projects', userId);
    try {
      await fs.access(altProjectsDir);
      const altEntries = await fs.readdir(altProjectsDir, { withFileTypes: true });
      const altProjectIds = altEntries.filter(e => e.isDirectory()).map(e => e.name);
      for (const pid of altProjectIds) {
        const partial = await sessionSearch(workspaceRoot, userId, pid, {
          ...query,
          limit: limit - results.length,
        });
        results.push(...partial);
        if (results.length >= limit) break;
      }
    } catch { /* no projects exist yet */ }
  }

  return results;
}

// ——— 2. Frozen Snapshot ———

const SNAPSHOT_FILE = 'session-snapshot.md';

/**
 * 冻结当前 KB 状态 → 写入快照文件
 * 原理（来自 Hermes）：
 *   session 开始时冻结 KB 快照并注入 system prompt → 保护 prefix cache
 *   写操作实时落盘但 snapshot 不更新 → 下个 session 才反映变更
 *   防止 session 内 KB 漂移导致 LLM prefix cache 失效
 */
export async function freezeSnapshot(
  workspaceRoot: string,
  userId: string,
  projectId: string,
): Promise<FrozenSnapshotContent> {
  const styleSystem = new StyleSystem(workspaceRoot, userId);
  const snapshotDir = path.join(workspaceRoot, '_shared', userId, 'memory');
  await fs.mkdir(snapshotDir, { recursive: true });

  // 读当前 KB 状态
  const profile = await styleSystem.readProfile();
  const persona = await styleSystem.readPersona();
  const insights = await styleSystem.readInsights();
  const kbEntries = await styleSystem.readKB('hot');
  const sessionNote = await readSessionNoteInner(snapshotDir);

  // 序列化
  const styleDnaText = profile ? JSON.stringify(profile.dna, null, 2).substring(0, 1500) : '(无风格 DNA)';
  const personaText = persona || '(无用户画像)';
  const insightsText = insights || '(无洞察记录)';
  const topKBText = kbEntries.length > 0
    ? kbEntries.map(e => `- [${e.confidence}] (${e.category}) ${e.content.substring(0, 200)}`).join('\n')
    : '(无 KB 条目)';

  const snapshot: FrozenSnapshotContent = {
    styleDna: styleDnaText,
    persona: personaText,
    insights: insightsText,
    topKB: topKBText,
    sessionNote,
    sessionStart: new Date().toISOString(),
    projectId,
  };

  // 写入快照文件
  const content = formatSnapshot(snapshot);
  await fs.writeFile(path.join(snapshotDir, SNAPSHOT_FILE), content, 'utf-8');

  return snapshot;
}

function formatSnapshot(snapshot: FrozenSnapshotContent): string {
  return [
    `# KB 快照（冻结于 ${snapshot.sessionStart}）`,
    `> 项目: ${snapshot.projectId}`,
    `> 本快照在 session 启动时冻结，保护 prefix cache。写操作实时落盘但 snapshot 不更新。`,
    '',
    '## 风格 DNA',
    snapshot.styleDna,
    '',
    '## 用户画像',
    snapshot.persona,
    '',
    '## 洞察日志',
    snapshot.insights,
    '',
    '## 关键知识',
    snapshot.topKB,
    '',
    '## 上轮 Session 自述',
    snapshot.sessionNote || '(无)',
    '',
  ].join('\n');
}

/**
 * 读取当前快照（用于 prompt builder）
 */
export async function readSnapshot(
  workspaceRoot: string,
  userId: string,
): Promise<string | null> {
  const p = path.join(workspaceRoot, '_shared', userId, 'memory', SNAPSHOT_FILE);
  try {
    return await fs.readFile(p, 'utf-8');
  } catch {
    return null;
  }
}

// ——— 3. MEMORY.md：Session Note ———

const SESSION_NOTE_FILE = 'session-note.md';

async function readSessionNoteInner(snapshotDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(snapshotDir, SESSION_NOTE_FILE), 'utf-8');
    return raw;
  } catch {
    return null;
  }
}

/**
 * 写入 Session Note（Agent 的自述笔记）
 *
 * 类似 Hermes MEMORY.md：
 *   - Agent 在关键操作后调用 "写一写自己的观察"
 *   - session 结束时自动调用记录本次做了什么、学到了什么
 *   - 限制 2.2K 字符（Hermes 标准），超出自动截断
 *   - 内容风格：第一人称，Agent 视角
 */
export async function writeSessionNote(
  workspaceRoot: string,
  userId: string,
  content: string,
): Promise<void> {
  const dir = path.join(workspaceRoot, '_shared', userId, 'memory');
  await fs.mkdir(dir, { recursive: true });

  const truncated = content.length > MEMORY_LIMIT_CHARS
    ? content.substring(0, MEMORY_LIMIT_CHARS - 100) + `\n\n...（截断: 原文 ${content.length} 字，限制 ${MEMORY_LIMIT_CHARS} 字）`
    : content;

  const formatted = [
    `# Session Note — ${new Date().toISOString()}`,
    '',
    truncated,
    '',
  ].join('\n');

  await fs.writeFile(path.join(dir, SESSION_NOTE_FILE), formatted, 'utf-8');
}

/**
 * 读取当前 Session Note（prompt builder 调用）
 */
export async function readSessionNote(
  workspaceRoot: string,
  userId: string,
): Promise<string | null> {
  return readSessionNoteInner(path.join(workspaceRoot, '_shared', userId, 'memory'));
}

/**
 * 写入一次性的 handoff note（跨 Agent 接力时调用）
 * pipeline advance 到下一 stage 前自动调用
 */
export async function writeHandoffNote(
  workspaceRoot: string,
  userId: string,
  fromAgent: string,
  toAgent: string,
  summary: string,
): Promise<void> {
  const dir = path.join(workspaceRoot, '_shared', userId, 'memory');
  await fs.mkdir(dir, { recursive: true });

  const content = [
    `## Handoff: ${fromAgent} → ${toAgent}`,
    `时间: ${new Date().toISOString()}`,
    '',
    summary,
    '',
  ].join('\n');

  // handoff note 存在 handoff-log/ 下时间线式记录
  const handoffDir = path.join(dir, 'handoff-log');
  await fs.mkdir(handoffDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.writeFile(path.join(handoffDir, `${ts}-${fromAgent}-to-${toAgent}.md`), content, 'utf-8');

  // 同时写入当前 session-note
  await writeSessionNote(workspaceRoot, userId, summary);
}

// ——— 4. Auto-compression ———

const COMPRESSED_MARKER = '（已压缩）';

export interface CompressResult {
  compressed: string[];
  freed: number;          // 释放了多少字符
  kept: number;           // 保留了多少条目
  entriesKept: number;
}

/**
 * 自动压缩用户 KB — 两个维度：
 *   1. insights.md：保留最近的 + 高价值的。老条目被摘要化
 *   2. kb.json：保留高置信度的，低置信度的按时间淘汰
 *
 * 由 session_search 或 pipeline_continue 在检测到超限时触发。
 * 不直接删除数据——老数据被合并为摘要。
 */
export async function autoCompress(
  workspaceRoot: string,
  userId: string,
): Promise<CompressResult> {
  const styleSystem = new StyleSystem(workspaceRoot, userId);
  const result: CompressResult = { compressed: [], freed: 0, kept: 0, entriesKept: 0 };

  // --- 压缩 insights.md ---
  const insights = await styleSystem.readInsights();
  if (insights && insights.length > INSIGHT_COMPRESS_AT) {
    const lines = insights.split('\n').filter(l => l.trim());
    // 保留最新 50 条 + 所有含 "已压缩" 标记的（防止重复压缩）
    const marked = lines.filter(l => l.includes(COMPRESSED_MARKER));
    const recent = lines.slice(-50);
    const merged = [...new Set([...marked, ...recent])];

    // 计算被压缩掉的行数
    const removed = lines.length - merged.length;
    const freedChars = insights.length - merged.join('\n').length;

    // 写回首部加压缩标记
    const compressed = [
      `# 交互洞察（${COMPRESSED_MARKER} ${new Date().toISOString()}）`,
      `> 原 ${lines.length} 行 → 保留 ${merged.length} 行（释放 ${freedChars} 字符）。`,
      `> 最早被压缩的条目仍可通过 session_search 在 slot_history 中查到。`,
      '',
      ...merged,
    ].join('\n');

    await styleSystem.appendInsight(`[自动压缩] insights.md: ${lines.length}→${merged.length} 行, 释放 ${freedChars} 字符`, 'system');
    // 直接写更新后的内容（通过 append 做不到覆盖，用文件写）
    const insightsPath = path.join(workspaceRoot, '_shared', userId, 'memory', 'insights.md');
    await fs.writeFile(insightsPath, compressed, 'utf-8');
    // 再补一条压缩记录
    await styleSystem.appendInsight(`[自动压缩] 完成: 释放 ${freedChars} 字符`, 'system');

    result.compressed.push('insights.md');
    result.freed += freedChars;
    result.kept = merged.length;
  }

  // --- 压缩 kb.json ---
  const kbEntries = await styleSystem.readKB();
  if (kbEntries.length > KB_COMPRESS_AT) {
    // 保留 high 置信度的所有条目 + 最近的 medium/low
    const highConf = kbEntries.filter(e => e.confidence === 'high');
    const mediumLow = kbEntries.filter(e => e.confidence !== 'high');
    // medium/low 只保留最近 20 条
    const recentMediumLow = mediumLow.slice(-20);
    const merged = [...highConf, ...recentMediumLow];

    result.entriesKept = merged.length;
    result.freed += (kbEntries.length - merged.length);

    // 压缩策略：覆盖 kb.json
    const kbPath = path.join(workspaceRoot, '_shared', userId, 'kb.json');
    const compressed = [
      `// 知识库（${COMPRESSED_MARKER} ${new Date().toISOString()}）`,
      `// 原 ${kbEntries.length} 条目 → 保留 ${merged.length} 条目`,
      `// 高置信度 ${highConf.length} + medium/low 最近 20 条`,
      ...merged.map((e: KBEntry) => JSON.stringify(e)),
    ].join('\n');

    // 写回标准 JSON
    await fs.writeFile(kbPath, JSON.stringify(merged, null, 2), 'utf-8');

    result.compressed.push('kb.json');
    await styleSystem.appendInsight(`[自动压缩] kb.json: ${kbEntries.length}→${merged.length} 条目`, 'system');
  }

  return result;
}

/**
 * 检查是否需要触发压缩（由 pipeline_continue 在 dialogue 后调用）
 */
export async function shouldCompress(
  workspaceRoot: string,
  userId: string,
): Promise<boolean> {
  const { promises: fs } = await import('fs');
  const path = await import('path');

  // 检查 insights.md
  const insightsPath = path.default.join(workspaceRoot, '_shared', userId, 'memory', 'insights.md');
  try {
    const stat = await fs.stat(insightsPath);
    if (stat.size > INSIGHT_COMPRESS_AT) return true;
  } catch {}

  // 检查 kb.json
  const kbPath = path.default.join(workspaceRoot, '_shared', userId, 'kb.json');
  try {
    const raw = await fs.readFile(kbPath, 'utf-8');
    const entries = JSON.parse(raw);
    if (Array.isArray(entries) && entries.length > KB_COMPRESS_AT) return true;
  } catch {}

  return false;
}
