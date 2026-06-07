// src/runtime/composite-score.ts - 复合评分排序 (P2-10)
// 将单纯的相似度评分替换为: 0.5*sim + 0.3*recency + 0.2*importance

export interface ScoredItem {
  id: string;
  content: string;
  similarity: number;   // 语义相似度 (0-1)
  recency: number;      // 时间新鲜度 (0-1)
  importance: number;   // 重要度 (0-1)
  compositeScore: number; // 综合评分
  metadata?: Record<string, unknown>;
}

export interface ScoreWeights {
  similarity: number;
  recency: number;
  importance: number;
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  similarity: 0.5,
  recency: 0.3,
  importance: 0.2,
};

/**
 * 计算复合评分
 *
 * 公式: composite = w1*similarity + w2*recency + w3*importance
 */
export function calculateCompositeScore(
  similarity: number,
  recency: number,
  importance: number,
  weights: ScoreWeights = DEFAULT_WEIGHTS
): number {
  return (
    weights.similarity * similarity +
    weights.recency * recency +
    weights.importance * importance
  );
}

/**
 * 计算时间新鲜度
 *
 * 基于时间衰减函数: recency = exp(-lambda * age_hours)
 * lambda = 0.01 表示约 3 天后新鲜度降到 50%
 */
export function calculateRecency(
  timestamp: string | Date,
  now: Date = new Date(),
  lambda: number = 0.01
): number {
  const time = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const ageHours = (now.getTime() - time.getTime()) / (1000 * 60 * 60);
  return Math.exp(-lambda * ageHours);
}

/**
 * 计算重要度
 *
 * 基于多个信号：
 * - 被引用次数
 * - 用户标记为重要
 * - 来源可信度
 */
export function calculateImportance(
  signals: {
    citationCount?: number;
    userMarkedImportant?: boolean;
    sourceTrust?: number;  // 0-1
  }
): number {
  let score = 0.5; // 基础分

  if (signals.citationCount) {
    score += Math.min(signals.citationCount * 0.05, 0.3);
  }
  if (signals.userMarkedImportant) {
    score += 0.2;
  }
  if (signals.sourceTrust !== undefined) {
    score = score * 0.5 + signals.sourceTrust * 0.5;
  }

  return Math.min(Math.max(score, 0), 1);
}

/**
 * 对 items 进行复合评分排序
 */
export function rankByCompositeScore(
  items: Array<{
    id: string;
    content: string;
    similarity: number;
    timestamp?: string;
    importance?: number;
    metadata?: Record<string, unknown>;
  }>,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  now: Date = new Date()
): ScoredItem[] {
  const scored = items.map(item => {
    const recency = item.timestamp ? calculateRecency(item.timestamp, now) : 0.5;
    const importance = item.importance ?? 0.5;
    const compositeScore = calculateCompositeScore(item.similarity, recency, importance, weights);

    return {
      id: item.id,
      content: item.content,
      similarity: item.similarity,
      recency,
      importance,
      compositeScore,
      metadata: item.metadata,
    };
  });

  // 按综合评分降序排序
  scored.sort((a, b) => b.compositeScore - a.compositeScore);
  return scored;
}

/**
 * 格式化排序结果为 markdown
 */
export function formatScoredItems(items: ScoredItem[], topN: number = 5): string {
  if (items.length === 0) return '（无结果）';

  const lines: string[] = [];
  lines.push(`**Top ${Math.min(topN, items.length)} 结果**（综合评分 = 0.5×相似度 + 0.3×新鲜度 + 0.2×重要度）:`);
  lines.push('');

  for (const item of items.slice(0, topN)) {
    const simPct = Math.round(item.similarity * 100);
    const recPct = Math.round(item.recency * 100);
    const impPct = Math.round(item.importance * 100);
    const totalPct = Math.round(item.compositeScore * 100);

    lines.push(`**${item.id}** — 综合 ${totalPct}%`);
    lines.push(`  相似度: ${simPct}% | 新鲜度: ${recPct}% | 重要度: ${impPct}%`);
    lines.push(`  ${item.content.substring(0, 100)}`);
    lines.push('');
  }

  return lines.join('\n');
}
