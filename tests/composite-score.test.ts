import { describe, it, expect } from 'vitest';
import {
  calculateCompositeScore,
  calculateRecency,
  calculateImportance,
  rankByCompositeScore,
  formatScoredItems,
} from '../src/runtime/composite-score.js';

describe('calculateCompositeScore', () => {
  it('默认权重计算正确', () => {
    // 0.5*1.0 + 0.3*1.0 + 0.2*1.0 = 1.0
    expect(calculateCompositeScore(1.0, 1.0, 1.0)).toBe(1.0);
  });

  it('混合值计算正确', () => {
    // 0.5*0.8 + 0.3*0.6 + 0.2*0.4 = 0.4 + 0.18 + 0.08 = 0.66
    expect(calculateCompositeScore(0.8, 0.6, 0.4)).toBeCloseTo(0.66, 2);
  });

  it('全零返回 0', () => {
    expect(calculateCompositeScore(0, 0, 0)).toBe(0);
  });

  it('自定义权重生效', () => {
    const weights = { similarity: 1.0, recency: 0, importance: 0 };
    expect(calculateCompositeScore(0.8, 0.6, 0.4, weights)).toBeCloseTo(0.8, 2);
  });
});

describe('calculateRecency', () => {
  it('刚发布的文章新鲜度接近 1', () => {
    const now = new Date('2025-01-01T12:00:00Z');
    const timestamp = '2025-01-01T12:00:00Z';
    expect(calculateRecency(timestamp, now)).toBeCloseTo(1.0, 2);
  });

  it('1 小时前的文章新鲜度约 0.99', () => {
    const now = new Date('2025-01-01T12:00:00Z');
    const timestamp = '2025-01-01T11:00:00Z';
    const recency = calculateRecency(timestamp, now);
    expect(recency).toBeGreaterThan(0.9);
    expect(recency).toBeLessThan(1.0);
  });

  it('3 天前的文章新鲜度约 0.5', () => {
    const now = new Date('2025-01-04T12:00:00Z');
    const timestamp = '2025-01-01T12:00:00Z';
    const recency = calculateRecency(timestamp, now);
    expect(recency).toBeGreaterThan(0.4);
    expect(recency).toBeLessThan(0.6);
  });

  it('30 天前的文章新鲜度很低', () => {
    const now = new Date('2025-01-31T12:00:00Z');
    const timestamp = '2025-01-01T12:00:00Z';
    const recency = calculateRecency(timestamp, now);
    expect(recency).toBeLessThan(0.1);
  });
});

describe('calculateImportance', () => {
  it('基础分 0.5', () => {
    expect(calculateImportance({})).toBeCloseTo(0.5, 2);
  });

  it('被引用增加重要度', () => {
    const imp = calculateImportance({ citationCount: 3 });
    expect(imp).toBeGreaterThan(0.5);
  });

  it('用户标记为重要增加 0.2', () => {
    const imp = calculateImportance({ userMarkedImportant: true });
    expect(imp).toBeCloseTo(0.7, 2);
  });

  it('来源可信度影响重要度', () => {
    const imp = calculateImportance({ sourceTrust: 0.9 });
    expect(imp).toBeGreaterThan(0.5);
  });

  it('组合信号', () => {
    const imp = calculateImportance({
      citationCount: 2,
      userMarkedImportant: true,
      sourceTrust: 0.8,
    });
    expect(imp).toBeGreaterThan(0.7);
    expect(imp).toBeLessThanOrEqual(1.0);
  });

  it('不超过 1.0', () => {
    const imp = calculateImportance({
      citationCount: 100,
      userMarkedImportant: true,
      sourceTrust: 1.0,
    });
    expect(imp).toBeLessThanOrEqual(1.0);
  });
});

describe('rankByCompositeScore', () => {
  it('按综合评分降序排列', () => {
    const items = [
      { id: 'a', content: '高相似度', similarity: 0.9, importance: 0.3 },
      { id: 'b', content: '高重要度', similarity: 0.3, importance: 0.9 },
      { id: 'c', content: '均衡', similarity: 0.6, importance: 0.6 },
    ];
    const ranked = rankByCompositeScore(items);
    expect(ranked[0].compositeScore).toBeGreaterThanOrEqual(ranked[1].compositeScore);
    expect(ranked[1].compositeScore).toBeGreaterThanOrEqual(ranked[2].compositeScore);
  });

  it('新鲜度影响排序', () => {
    const now = new Date('2025-01-01T12:00:00Z');
    const items = [
      { id: 'old', content: '旧内容', similarity: 0.9, timestamp: '2024-12-01T12:00:00Z' },
      { id: 'new', content: '新内容', similarity: 0.9, timestamp: '2025-01-01T11:00:00Z' },
    ];
    const ranked = rankByCompositeScore(items, undefined, now);
    expect(ranked[0].id).toBe('new');
  });

  it('空数组返回空', () => {
    expect(rankByCompositeScore([])).toHaveLength(0);
  });
});

describe('formatScoredItems', () => {
  it('空结果返回提示', () => {
    expect(formatScoredItems([])).toContain('无结果');
  });

  it('格式化输出包含评分信息', () => {
    const items = [
      { id: 'test', content: '测试内容', similarity: 0.8, recency: 0.9, importance: 0.7, compositeScore: 0.8 },
    ];
    const formatted = formatScoredItems(items);
    expect(formatted).toContain('test');
    expect(formatted).toContain('80%');
    expect(formatted).toContain('相似度');
    expect(formatted).toContain('新鲜度');
    expect(formatted).toContain('重要度');
  });

  it('topN 限制输出数', () => {
    const items = [
      { id: 'a', content: 'a', similarity: 0.9, recency: 0.9, importance: 0.9, compositeScore: 0.9 },
      { id: 'b', content: 'b', similarity: 0.8, recency: 0.8, importance: 0.8, compositeScore: 0.8 },
      { id: 'c', content: 'c', similarity: 0.7, recency: 0.7, importance: 0.7, compositeScore: 0.7 },
    ];
    const formatted = formatScoredItems(items, 2);
    expect(formatted).toContain('a');
    expect(formatted).toContain('b');
    expect(formatted).not.toContain('c');
  });
});
