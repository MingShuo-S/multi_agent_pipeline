// src/types.ts - 核心数据类型定义

export interface TemplateSlot {
  type: 'text' | 'json' | 'file';
  default: string | object;
}

export interface PipelineStage {
  id: string;
  agent: string;
  checkpoint: boolean;
  allow_read: string[];
  allow_write: string[];
}

export interface Template {
  name: string;
  description: string;
  stages: PipelineStage[];
  slots: Record<string, TemplateSlot>;
}

export interface PipelineRemark {
  agent: string;
  content: string;
  timestamp: string;
}

export interface PipelineState {
  template_name: string;
  current_stage: number;
  slot_values: Record<string, string | object>;
  remarks: PipelineRemark[];
  status: 'running' | 'paused' | 'completed' | 'failed';
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
