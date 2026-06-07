// src/runtime/prefetch.ts - 上下文预取模块 (P1-7)
// 在 session 开始或 stage 切换前，自动预取相关上下文

import { promises as fs } from 'fs';
import path from 'path';

export interface PrefetchResult {
  query: string;
  results: PrefetchEntry[];
  totalFound: number;
  timestamp: string;
}

export interface PrefetchEntry {
  source: string;
  title: string;
  content: string;
  relevance: number;  // 0-1
  type: 'kb' | 'style' | 'guide' | 'template' | 'history';
}

/**
 * 预取上下文
 *
 * 搜索策略：
 * 1. 知识库 (_shared/{userId}/kb.json)
 * 2. 风格档案 (_shared/{userId}/style-dna.json)
 * 3. Agent 指南 (agent-guides/)
 * 4. 历史项目 (projects/{userId}/)
 */
export async function prefetchContext(
  query: string,
  workspaceRoot: string,
  userId: string,
  maxResults: number = 8
): Promise<PrefetchResult> {
  const results: PrefetchEntry[] = [];
  const keywords = extractKeywords(query);

  // 1. 搜索知识库
  const kbResults = await searchKB(workspaceRoot, userId, keywords);
  results.push(...kbResults);

  // 2. 搜索风格档案
  const styleResults = await searchStyle(workspaceRoot, userId, keywords);
  results.push(...styleResults);

  // 3. 搜索 Agent 指南
  const guideResults = await searchGuides(workspaceRoot, keywords);
  results.push(...guideResults);

  // 4. 搜索历史项目
  const historyResults = await searchHistory(workspaceRoot, userId, keywords);
  results.push(...historyResults);

  // 按相关度排序，取 top N
  results.sort((a, b) => b.relevance - a.relevance);
  const topResults = results.slice(0, maxResults);

  return {
    query,
    results: topResults,
    totalFound: results.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 从查询中提取关键词
 */
function extractKeywords(query: string): string[] {
  // 简单实现：按空格分词，去掉停用词
  const stopWords = new Set(['的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这']);
  return query
    .split(/[\s,，。.!！?？、；;：:（）()【】\[\]{}]+/)
    .filter(w => w.length > 1 && !stopWords.has(w))
    .slice(0, 10);
}

/**
 * 计算文本与关键词的相关度
 */
function calculateRelevance(text: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const lowerText = text.toLowerCase();
  let matches = 0;
  for (const kw of keywords) {
    if (lowerText.includes(kw.toLowerCase())) {
      matches++;
    }
  }
  return matches / keywords.length;
}

/**
 * 搜索知识库
 */
async function searchKB(
  workspaceRoot: string,
  userId: string,
  keywords: string[]
): Promise<PrefetchEntry[]> {
  const results: PrefetchEntry[] = [];
  const kbPath = path.join(workspaceRoot, '_shared', userId, 'kb.json');

  try {
    const content = await fs.readFile(kbPath, 'utf-8');
    const entries = JSON.parse(content) as Array<{ category: string; content: string; source: string }>;

    for (const entry of entries) {
      const relevance = calculateRelevance(entry.content, keywords);
      if (relevance > 0) {
        results.push({
          source: 'kb',
          title: `[${entry.category}] ${entry.source}`,
          content: entry.content.substring(0, 500),
          relevance,
          type: 'kb',
        });
      }
    }
  } catch {}

  return results;
}

/**
 * 搜索风格档案
 */
async function searchStyle(
  workspaceRoot: string,
  userId: string,
  keywords: string[]
): Promise<PrefetchEntry[]> {
  const results: PrefetchEntry[] = [];
  const stylePath = path.join(workspaceRoot, '_shared', userId, 'style-dna.json');

  try {
    const content = await fs.readFile(stylePath, 'utf-8');
    const style = JSON.parse(content);
    const styleText = JSON.stringify(style);
    const relevance = calculateRelevance(styleText, keywords);

    if (relevance > 0) {
      results.push({
        source: 'style-dna',
        title: '风格 DNA',
        content: styleText.substring(0, 500),
        relevance,
        type: 'style',
      });
    }
  } catch {}

  return results;
}

/**
 * 搜索 Agent 指南
 */
async function searchGuides(
  workspaceRoot: string,
  keywords: string[]
): Promise<PrefetchEntry[]> {
  const results: PrefetchEntry[] = [];
  const guidesDir = path.join(workspaceRoot, 'agent-guides');

  try {
    const files = await fs.readdir(guidesDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(guidesDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const relevance = calculateRelevance(content, keywords);
      if (relevance > 0) {
        results.push({
          source: `agent-guides/${file}`,
          title: file.replace('.md', ''),
          content: content.substring(0, 500),
          relevance,
          type: 'guide',
        });
      }
    }
  } catch {}

  return results;
}

/**
 * 搜索历史项目
 */
async function searchHistory(
  workspaceRoot: string,
  userId: string,
  keywords: string[]
): Promise<PrefetchEntry[]> {
  const results: PrefetchEntry[] = [];
  const projectsDir = path.join(workspaceRoot, 'projects', userId);

  try {
    const projects = await fs.readdir(projectsDir);
    for (const projectId of projects) {
      const statePath = path.join(projectsDir, projectId, 'state.json');
      try {
        const content = await fs.readFile(statePath, 'utf-8');
        const state = JSON.parse(content);
        const stateText = JSON.stringify(state.slot_values);
        const relevance = calculateRelevance(stateText, keywords);
        if (relevance > 0) {
          results.push({
            source: `projects/${userId}/${projectId}`,
            title: `项目: ${projectId} (${state.template_name})`,
            content: stateText.substring(0, 300),
            relevance,
            type: 'history',
          });
        }
      } catch {}
    }
  } catch {}

  return results;
}

/**
 * 格式化预取结果为 markdown（供 agent 使用）
 */
export function formatPrefetchResult(result: PrefetchResult): string {
  if (result.results.length === 0) {
    return '（未找到相关上下文）';
  }

  const lines: string[] = [];
  lines.push(`**预取上下文**（${result.totalFound} 条相关，展示 top ${result.results.length}）:`);
  lines.push('');

  for (const entry of result.results) {
    lines.push(`### ${entry.title}`);
    lines.push(`来源: ${entry.source} | 类型: ${entry.type} | 相关度: ${Math.round(entry.relevance * 100)}%`);
    lines.push('');
    lines.push(entry.content);
    lines.push('');
  }

  return lines.join('\n');
}
