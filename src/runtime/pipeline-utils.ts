// src/runtime/pipeline-utils.ts - 管道共享工具函数

import { PipelineState, Template, callSubagent } from '../types.js';
import { StateManager } from './state-manager.js';
import { PromptBuilder } from './prompt-builder.js';

/**
 * 推进关键词列表
 */
const ADVANCE_KEYWORDS = [
  '下一阶段', '下一步', '推进', 'advance', 'next stage',
  '完成', '好了', '可以了', '没问题', '继续下一步',
  '过', 'pass', 'next', 'go ahead', 'continue',
];

/**
 * 检测是否为推进信号
 */
export function isAdvanceSignal(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return ADVANCE_KEYWORDS.some(kw => {
    const kwLower = kw.toLowerCase();
    return trimmed === kwLower
      || trimmed.startsWith(kwLower + ' ')
      || trimmed.endsWith(' ' + kwLower)
      || trimmed.includes(kwLower + kwLower);
  });
}

/**
 * 自动推进不需要 checkpoint 的阶段
 */
export async function autoAdvanceNonCheckpoint(
  stateManager: StateManager,
  template: Template,
  state: PipelineState,
  userId: string,
  projectId: string,
  workspaceRoot: string,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<PipelineState> {
  let s = { ...state };
  let nextStage = s.current_stage;
  while (nextStage < template.stages.length) {
    const stage = template.stages[nextStage];
    if (stage.checkpoint) break;

    const promptBuilder = new PromptBuilder(workspaceRoot, userId, projectId);
    const prompt = await promptBuilder.buildPipelinePrompt(
      stage.agent, template, s, {} as any, '请根据已有信息完成你的工作'
    );
    const sessionKey = `${stage.agent}:${userId}:${projectId}`;
    const agentResponse = await callSubagent(api, sessionKey, prompt);
    const slotName = stage.allow_write[0];
    if (slotName) {
      await stateManager.updateSlot(slotName, agentResponse, stage.agent);
    }
    const currentEntry = s.stage_history.find(h => h.stage === nextStage && !h.completed_at);
    if (currentEntry) currentEntry.completed_at = new Date().toISOString();
    nextStage++;
  }
  s.current_stage = nextStage;
  if (nextStage < template.stages.length) {
    const exists = s.stage_history.find(h => h.stage === nextStage);
    if (!exists) {
      s.stage_history.push({
        stage: nextStage,
        stage_id: template.stages[nextStage].id,
        agent: template.stages[nextStage].agent,
        started_at: new Date().toISOString(),
        versions: 0,
      });
    }
  }
  await stateManager.save(s);
  return s;
}
