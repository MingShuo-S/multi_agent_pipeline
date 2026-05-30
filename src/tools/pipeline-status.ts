// src/tools/pipeline-status.ts - 状态面板工具

import { PipelineState, Template } from '../types.js';
import { StateManager } from '../runtime/state-manager.js';
import { WorkspaceConfigManager } from './workspace-config.js';
import { WORKSPACE_ROOT } from '../config.js';

export interface PipelineStatusResult {
  status: 'ok' | 'error';
  project: {
    template_name: string;
    user_id: string;
    project_id: string;
    mode: string;
    author?: string;
    pipeline_status: string;
  };
  progress: {
    current_stage: number;
    total_stages: number;
    current_agent: string;
    current_stage_name: string;
    completed_stages: number;
  };
  stages: Array<{
    index: number;
    id: string;
    agent: string;
    checkpoint: boolean;
    status: 'completed' | 'current' | 'pending';
    started_at?: string;
    completed_at?: string;
  }>;
  slots: Array<{
    name: string;
    current_value: string | object;
    version_count: number;
    history: Array<{
      version: number;
      agent: string;
      written_at: string;
      preview: string;
    }>;
  }>;
  remarks: Array<{
    version: number;
    agent: string;
    content: string;
    timestamp: string;
  }>;
  error?: string;
}

export async function pipelineStatus(
  userId: string,
  projectId: string,
  workspaceRoot: string
): Promise<PipelineStatusResult> {
  try {
    const root = workspaceRoot || WORKSPACE_ROOT;
    const stateManager = new StateManager(root, userId, projectId);
    const configManager = new WorkspaceConfigManager(root);

    let state: PipelineState;
    try {
      state = await stateManager.load();
    } catch {
      return {
        status: 'error',
        project: { template_name: '', user_id: userId, project_id: projectId, mode: '', pipeline_status: 'not_found' },
        progress: { current_stage: -1, total_stages: 0, current_agent: '', current_stage_name: '', completed_stages: 0 },
        stages: [],
        slots: [],
        remarks: [],
        error: '项目状态文件不存在',
      };
    }

    const template = await configManager.readTemplate(state.template_name);

    return {
      status: 'ok',
      project: {
        template_name: state.template_name,
        user_id: userId,
        project_id: projectId,
        mode: state.mode || 'relay',
        author: state.author,
        pipeline_status: state.status,
      },
      progress: {
        current_stage: state.current_stage + 1,
        total_stages: template.stages.length,
        current_agent: state.current_stage < template.stages.length ? template.stages[state.current_stage].agent : '',
        current_stage_name: state.current_stage < template.stages.length ? template.stages[state.current_stage].id : '完成',
        completed_stages: state.stage_history.filter(s => s.completed_at).length,
      },
      stages: template.stages.map((s, i) => {
        const historyEntry = state.stage_history.find(h => h.stage === i);
        return {
          index: i,
          id: s.id,
          agent: s.agent,
          checkpoint: s.checkpoint,
          status: (i < state.current_stage ? 'completed' : i === state.current_stage ? 'current' : 'pending') as 'completed' | 'current' | 'pending',
          started_at: historyEntry?.started_at,
          completed_at: historyEntry?.completed_at,
        };
      }),
      slots: Object.entries(state.slot_values).map(([name, value]) => {
        const history = (state.slot_history[name] || []).map(h => ({
          version: h.version,
          agent: h.agent,
          written_at: h.written_at,
          preview: typeof h.content === 'string' ? h.content.substring(0, 200) : JSON.stringify(h.content).substring(0, 200),
        }));
        return {
          name,
          current_value: value,
          version_count: history.length,
          history,
        };
      }),
      remarks: state.remarks.map(r => ({
        version: r.version,
        agent: r.agent,
        content: r.content,
        timestamp: r.timestamp,
      })),
    };
  } catch (err) {
    return {
      status: 'error',
      project: { template_name: '', user_id: userId, project_id: projectId, mode: '', pipeline_status: 'error' },
      progress: { current_stage: -1, total_stages: 0, current_agent: '', current_stage_name: '', completed_stages: 0 },
      stages: [],
      slots: [],
      remarks: [],
      error: String(err),
    };
  }
}

export const pipelineStatusTool = {
  id: 'pipeline_status',
  name: 'pipeline_status',
  description: '查看管道项目状态面板，包括当前阶段、各阶段进度、Slot 版本历史、批注记录。',
  parameters: {
    type: 'object',
    properties: {
      user_id: {
        type: 'string',
        description: '用户 ID',
      },
      project_id: {
        type: 'string',
        description: '项目 ID',
      },
    },
    required: ['user_id', 'project_id'],
  },
};
