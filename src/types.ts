// src/types.ts - 核心数据类型定义

export type PipelineMode = 'relay' | 'pipeline';

export interface TemplateSlot {
  type: 'text' | 'json' | 'file';
  default: string | object;
}

// ---- P0-1: Schema 分层 ----

export type SchemaLayer = 'input' | 'working' | 'output';

export type Reducer = 'replace' | 'append' | 'merge';

export interface SlotDef {
  description: string;
  type: 'string' | 'string[]' | 'object';
  reducer?: Reducer;
  required?: boolean;
  default?: string | object;
}

export interface PipelineSchema {
  input: Record<string, SlotDef>;
  working: Record<string, SlotDef>;
  output: Record<string, SlotDef>;
}

export interface PlatformRule {
  platform: string;
  ai_label_required: boolean;
  forbidden_automation: boolean;
  sensitive_words: string[];
  content_rules: string;
}

export interface PipelineStage {
  id: string;
  agent: string;
  checkpoint: boolean;
  allow_read: string[];
  allow_write: string[];
  auto_advance?: boolean;
  description?: string;
}

// ---- P0-3: Interrupt 暂停点 ----

export interface InterruptPoint {
  stage: string;
  slot: string;
  message: string;
  confirmKeywords: string[];
  reviseKeywords: string[];
}

export interface Template {
  name: string;
  description: string;
  stages: PipelineStage[];
  slots: Record<string, TemplateSlot>;
  schema?: PipelineSchema;
  interrupts?: InterruptPoint[];
  mode?: PipelineMode;
  platforms?: PlatformRule[];
  author_label?: string;
}

export interface PipelineRemark {
  agent: string;
  content: string;
  timestamp: string;
  version: number;
}

export interface SlotHistoryEntry {
  content: string | object;
  written_at: string;
  version: number;
  agent: string;
}

export interface StageHistoryEntry {
  stage: number;
  stage_id: string;
  agent: string;
  started_at: string;
  completed_at?: string;
  versions: number;
}

export interface PipelineState {
  template_name: string;
  current_stage: number;
  slot_values: Record<string, string | object>;
  slot_history: Record<string, SlotHistoryEntry[]>;
  remarks: PipelineRemark[];
  stage_history: StageHistoryEntry[];
  status: 'running' | 'paused' | 'completed' | 'failed';
  mode: PipelineMode;
  author?: string;
  pending_interrupt?: InterruptPoint | null;
}

export interface AgentProfile {
  agent: string;
  user_id: string;
  preferences: {
    style?: string;
    avoid?: string[];
    feedback_log?: Array<{
      project_id: string;
      liked?: string;
      disliked?: string;
    }>;
  };
  last_updated: string;
}

export interface SubagentAPI {
  run(params: { sessionKey: string; message: string; provider?: string; model?: string; extraSystemPrompt?: string; lightContext?: boolean; deliver?: boolean }): Promise<{ runId: string }>;
  waitForRun(params: { runId: string; timeoutMs?: number }): Promise<{ status: 'ok' | 'error' | 'timeout'; error?: string }>;
  getSessionMessages(params: { sessionKey: string; limit?: number }): Promise<{ messages: unknown[] }>;
}

export function extractAssistantText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as any;
    if (msg?.role === 'assistant' && typeof msg?.content === 'string') {
      return msg.content;
    }
  }
  return '';
}

export async function callSubagent(
  api: { runtime: { subagent: SubagentAPI } } | undefined,
  sessionKey: string,
  message: string,
  timeoutMs = 180000
): Promise<string> {
  if (!api?.runtime?.subagent) {
    throw new Error(`api.runtime.subagent 不可用：无法调用子 Agent。请确认插件已正确集成到 Gateway 运行环境。api=${typeof api}, runtime=${typeof api?.runtime}, subagent=${typeof api?.runtime?.subagent}`);
  }
  const { runId } = await api.runtime.subagent.run({ sessionKey, message });
  const result = await api.runtime.subagent.waitForRun({ runId, timeoutMs });
  if (result.status !== 'ok') {
    throw new Error(`Subagent run failed: ${result.error || result.status}`);
  }
  const { messages } = await api.runtime.subagent.getSessionMessages({ sessionKey, limit: 1 });
  return extractAssistantText(messages);
}

export interface ToolContext {
  agent_name: string;
  user_id: string;
  project_id: string;
  workspace_root: string;
  api?: { runtime: { subagent: SubagentAPI } };
}

// ---- 以下为新加类型 ----

export type AgentRole = 'content-writer' | 'topic-researcher' | 'quality-reviewer' | 'publisher' | 'orchestrator' | string;

export interface PatternEntry {
  pattern: string;
  source: string;
  timestamp: string;
  confirmed: boolean;
}

export interface Profile {
  userId: string;
  version: number;
  voiceprintStatus: 'init' | 'sampling' | 'calibrating' | 'analyzing' | 'done';
  corePrinciples: string[];
  syntaxPatterns: Record<string, unknown>;
  vocabulary: {
    highFreq: string[];
    forbidden: string[];
    techTerms: string[];
  };
  forbiddenPatterns: string[];
  learnedPatterns: PatternEntry[];
  userSelfDescription?: string;
  lastUpdated: string;
}

/** @deprecated Use Profile instead */
export interface StyleProfile extends Profile {
  /** @deprecated Legacy wrapper — use top-level fields */
  dna?: {
    corePrinciples: string[];
    syntaxPatterns: Record<string, unknown>;
    vocabulary: { highFreq: string[]; forbidden: string[]; techTerms: string[]; };
    forbiddenPatterns: string[];
    growthDirection: string;
  };
}

export interface KBEntry {
  userId: string;
  category: 'persona' | 'insight' | 'fact' | 'feedback';
  content: string;
  source: AgentRole;
  timestamp: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface PipelineContext {
  userId: string;
  projectId: string;
  templateName: string;
  currentRole: AgentRole;
  currentStage: number;
  hasStyleProfile?: boolean;
}

export interface CorrectionSignal {
  type: 'preference' | 'correction' | 'forbidden' | 'praise';
  quote: string;
  agent: AgentRole;
  userId: string;
}

export interface InjectionBlock {
  role: AgentRole;
  header: string;
  content: string;
  position: 'head' | 'tail';
}

// ---- Voiceprint 状态机 ----
export interface VoiceprintSample {
  text: string;
  label: string;
}

export interface VoiceprintPreferences {
  sentenceLength?: 'short' | 'medium' | 'long';
  useEmoji?: boolean;
  useExclamation?: boolean;
  tone?: 'casual' | 'formal' | 'balanced';
  selectedForbiddenPhrases?: string[];
}

export interface VoiceprintSubAnalysis {
  corePrinciples: string[];
  forbiddenPatterns: string[];
  highFreqWords: string[];
  techTerms?: string[];
  syntaxPatterns: Record<string, unknown>;
  growthDirection?: string;
}

export interface VoiceprintState {
  step: number;        // 0=未开始, 1-6=路径A样本收集, 7-8=校准, 9=分析, 10=确认, 99=完成
  path: 'A' | 'B' | null;
  samples: VoiceprintSample[];
  preferences?: VoiceprintPreferences;
  analysis?: VoiceprintSubAnalysis;
  confirmed: boolean;
  updatedAt: string;
}

// ---- Session Memory 类型 ----

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

export interface CompressResult {
  compressed: string[];
  freed: number;
  kept: number;
  entriesKept: number;
}
