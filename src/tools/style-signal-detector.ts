// src/tools/style-signal-detector.ts — 用户风格信号检测（纯函数）
// 从 pipeline-continue.ts 独立，无 pipeline 依赖，可单独测试

import type { CorrectionSignal, AgentRole } from '../types.js';
import { StyleSystem } from './style-system.js';

/**
 * 从用户消息中检测风格纠正信号
 * 在对话路由给 agent 之前先拦截分析
 */
export function detectStyleSignals(userMessage: string): CorrectionSignal[] {
  const signals: CorrectionSignal[] = [];
  const lower = userMessage.toLowerCase();

  // --- 中文纠正: "不是X" ---
  const cnCorrection = userMessage.match(/不是(.+?)(?:，|,| 是|。)/);
  if (cnCorrection) {
    signals.push({ type: 'correction', quote: cnCorrection[0].trim(), agent: 'orchestrator', userId: '' });
  }

  // --- 英文纠正: "it's not X" / "that is not X" ---
  const enCorrection = lower.match(/(?:it'?s|that'?s|that is|this is)\s+not\s+(.+?)(?:,|\.|;|$)/);
  if (enCorrection && !signals.some(s => s.type === 'correction')) {
    signals.push({ type: 'correction', quote: enCorrection[0].trim(), agent: 'orchestrator', userId: '' });
  }

  // --- 间接纠正: "改成X", "应该是X" ---
  const rewritePatterns = [
    /改成(.+?)吧/,
    /应该是(.+?)(?:[,，。]|$)/,
    /写成(.+?)更好/,
    /建议写成(.+?)[。，]/,
    /改为(.+?)[。，]/,
  ];
  for (const p of rewritePatterns) {
    const m = userMessage.match(p);
    if (m) {
      signals.push({ type: 'correction', quote: `用户建议改为: ${m[1].trim()}`, agent: 'orchestrator', userId: '' });
      break;
    }
  }

  // --- 中文禁止: 匹配即触发，只取第一个匹配 ---
  const cnForbidden = ['不要用', '别用', '不要加', '去掉', '别加', '别写', '不要', '不希望', '别再'];
  const foundCnForbidden = cnForbidden.find(ind => lower.includes(ind));
  if (foundCnForbidden && !signals.some(s => s.type === 'forbidden')) {
    const idx = userMessage.indexOf(foundCnForbidden);
    signals.push({
      type: 'forbidden',
      quote: userMessage.substring(idx, Math.min(idx + 30, userMessage.length)).trim(),
      agent: 'orchestrator', userId: '',
    });
  }

  // --- 英文禁止 ---
  const enForbidden = ["don't use", "stop using", "don't add", "remove", "never use", "avoid"];
  if (!signals.some(s => s.type === 'forbidden')) {
    const foundEn = enForbidden.find(ind => lower.includes(ind));
    if (foundEn) {
      const idx = lower.indexOf(foundEn);
      signals.push({
        type: 'forbidden',
        quote: lower.substring(idx, Math.min(idx + 30, lower.length)).trim(),
        agent: 'orchestrator', userId: '',
      });
    }
  }

  // --- 正面信号: 短消息整体认可 ---
  const praisePattern = /^(不赖|可以|不错|对|就是这个|好|很好|对的|good|great|perfect|nice|exactly|yes)[。，！.!?,]?$/i;
  if (praisePattern.test(userMessage.trim()) && !signals.some(s => s.type === 'praise')) {
    signals.push({ type: 'praise', quote: userMessage.trim(), agent: 'orchestrator', userId: '' });
  }

  return signals;
}

/**
 * 将检测到的信号写入风格知识库
 */
export async function extractAndRecordSignals(
  workspaceRoot: string,
  userId: string,
  signals: CorrectionSignal[],
  currentAgent: string,
): Promise<void> {
  for (const signal of signals) {
    signal.agent = currentAgent as AgentRole;
    signal.userId = userId;
    const styleSystem = new StyleSystem(workspaceRoot, userId);
    await styleSystem.processCorrectionSignal(signal);
    await styleSystem.appendInsight(
      `检测到${signal.type === 'correction' ? '纠正' : signal.type === 'forbidden' ? '禁止' : signal.type === 'praise' ? '正向' : '偏好'}信号: ${signal.quote}`,
      currentAgent as AgentRole,
    );
  }
}
