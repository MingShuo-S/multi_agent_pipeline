// src/tools/pipeline-start.ts - 启动管道（relay 模式：初始化 + 首次对话）

import { promises as fs } from 'fs';
import path from 'path';
import { ToolContext, Template, PipelineState, PipelineStage, callSubagent, PipelineMode } from '../types.js';
import { StateManager } from '../runtime/state-manager.js';
import { WorkspaceConfigManager, initWorkspace } from './workspace-config.js';
import { MemoryManager } from './memory.js';
import { PromptBuilder } from '../runtime/prompt-builder.js';
import { WORKSPACE_ROOT } from '../config.js';
import { freezeSnapshot } from './session-memory.js';

export interface PipelineStartResult {
  status: 'initialized' | 'checkpoint_reached' | 'completed' | 'error';
  mode: PipelineMode;
  current_stage: number;
  current_stage_name: string;
  current_agent: string;
  stage_description?: string;
  total_stages: number;
  stages: Array<{ name: string; agent: string; checkpoint: boolean; completed: boolean }>;
  slot_output?: {
    slot_name: string;
    value: string | object;
    owner?: string;
    version: number;
  };
  message: string;
  error?: string;
  status_panel?: {
    template: string;
    author?: string;
    completed_stages: number;
    stages: Array<{
      id: string;
      agent: string;
      status: 'current' | 'completed' | 'pending';
      checkpoint: boolean;
    }>;
    slots: Record<string, { value: string | object; versions: number }>;
  };
}

function buildStatusPanel(state: PipelineState, template: Template, currentStage: number): PipelineStartResult['status_panel'] {
  return {
    template: template.name,
    author: state.author,
    completed_stages: state.stage_history.filter(s => s.completed_at).length,
    stages: template.stages.map((s, i) => ({
      id: s.id,
      agent: s.agent,
      status: i < currentStage ? 'completed' : i === currentStage ? 'current' : 'pending',
      checkpoint: s.checkpoint,
    })),
    slots: Object.fromEntries(
      Object.entries(state.slot_values).map(([k, v]) => [
        k,
        { value: v, versions: (state.slot_history[k] || []).length },
      ])
    ),
  };
}

/**
 * 执行 relay 模式：路由消息给当前阶段 Agent 并返回响应
 * 注意：初始子 Agent 调用不使用 buildPipelinePrompt（避免注入 pipeline 工具指令，
 * 因为 subagent.run() 可能运行在隔离 sandbox 下，pipeline 工具不可用会导致 agent 卡死）
 */
async function executeRelayDialogue(
  stateManager: StateManager,
  state: PipelineState,
  template: Template,
  userId: string,
  projectId: string,
  workspaceRoot: string,
  message: string,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<{ response: string; slotName: string }> {
  const currentStage = template.stages[state.current_stage];
  if (!currentStage) {
    throw new Error(`阶段 ${state.current_stage} 不存在`);
  }

  const memoryManager = new MemoryManager(workspaceRoot, userId, currentStage.agent);
  const profile = await memoryManager.getProfile();

  // 使用简单 prompt，不含 pipeline 工具指令
  const promptParts: string[] = [];

  // 角色定义
  promptParts.push(
    `你正在参与一个多阶段创作流程。\n` +
    `你的角色是：${currentStage.agent}\n` +
    `当前阶段：${currentStage.id} - ${currentStage.description || ''}\n` +
    `项目：${userId}/${projectId}（模板：${template.name}）\n`
  );

  // 可读的上下文 slot 内容
  const readableSlots = currentStage.allow_read;
  if (readableSlots.includes('*') || readableSlots.length > 0) {
    const slotLines: string[] = [];
    for (const slotName of readableSlots) {
      if (slotName === '*') {
        // 读取所有非空 slot
        for (const [k, v] of Object.entries(state.slot_values)) {
          if (v !== undefined && v !== '') {
            const content = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
            slotLines.push(`${k}:\n${content}`);
          }
        }
        break;
      }
      const value = state.slot_values[slotName];
      if (value !== undefined && value !== '') {
        const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        slotLines.push(`${slotName}:\n${content}`);
      }
    }
    if (slotLines.length > 0) {
      promptParts.push(`【已有上下文】\n${slotLines.join('\n')}\n`);
    }
  }

  // 用户偏好（可选）
  if (profile?.preferences && Object.keys(profile.preferences).length > 0) {
    promptParts.push(
      `【用户偏好】\n${JSON.stringify(profile.preferences, null, 2)}\n`
    );
  }

  // 搜索提示
  promptParts.push(
    `【搜索说明】\n` +
    `搜索请用 \`web_fetch\` 替代 \`web_search\`（当前环境未配置 \`web_search\`）。\n` +
    `推荐引擎：搜狗 https://www.sogou.com/web?query={keyword}（中文首选）、百度、必应、DuckDuckGo。\n`
  );

  // 可用工具说明
  promptParts.push(
    `【可用工具】\n` +
    `- \`memory_read\` / \`memory_write\`：读写用户记忆库（记录调研发现、用户偏好、事实条目）\n` +
    `- \`kb_read\` / \`kb_write\`：同上，旧名称仍可用\n` +
    `- \`style_read_profile\`：读取用户风格偏好\n` +
    `- \`style_extract_signal\`：记录用户对你输出的纠正信号\n` +
    `- \`style_get_context\`：获取完整风格上下文（content-writer 专用）\n` +
    `以上工具可随时使用，不需要预先授权。\n`
  );

  // 用户消息
  if (message) {
    promptParts.push(
      `【用户消息】\n${message}\n\n请根据以上信息完成你的工作。直接输出内容，不要使用工具调用。`
    );
  }

  const prompt = promptParts.join('\n');

  const sessionKey = `${currentStage.agent}:${userId}:${projectId}`;
  const agentResponse = await callSubagent(api, sessionKey, prompt);

  const slotName = currentStage.allow_write[0];
  if (slotName) {
    await stateManager.updateSlot(slotName, agentResponse, currentStage.agent);
  }

  return { response: agentResponse, slotName };
}

/**
 * 执行 relay 模式自动推进（跳过不需要 checkpoints 的阶段）
 */
async function autoAdvanceNonCheckpointStages(
  stateManager: StateManager,
  template: Template,
  state: PipelineState,
  userId: string,
  projectId: string,
  workspaceRoot: string,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<PipelineState> {
  let nextStage = state.current_stage;
  while (nextStage < template.stages.length) {
    const stage = template.stages[nextStage];
    // 如果是 checkpoint 阶段，停止
    if (stage.checkpoint) break;
    // 构建简洁 prompt（不含 pipeline 工具指令，防止隔离 sandbox 下 agent 卡死）
    const promptParts: string[] = [
      `你正在参与一个多阶段创作流程。\n` +
      `你的角色是：${stage.agent}\n` +
      `当前阶段：${stage.id} - ${stage.description || ''}\n` +
      `项目：${userId}/${projectId}（模板：${template.name}）\n`
    ];
    const slotLines: string[] = [];
    for (const slotName of stage.allow_read) {
      const value = state.slot_values[slotName];
      if (value !== undefined && value !== '') {
        const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        slotLines.push(`${slotName}:\n${content}`);
      }
    }
    if (slotLines.length > 0) {
      promptParts.push(`【已有上下文】\n${slotLines.join('\n')}\n`);
    }
    promptParts.push(
      `【搜索说明】搜索请用 \`web_fetch\` 替代 \`web_search\`（未配置）。推荐引擎：搜狗、百度、必应、DuckDuckGo。\n`
    );
    promptParts.push(
      `【可用工具】\`memory_read\`/\`memory_write\` 读写记忆库，\`kb_read\`/\`kb_write\`（旧名兼容），\`style_read_profile\` 读风格偏好。\n`
    );
    promptParts.push(
      `请根据以上信息完成你的工作。直接输出内容，不要使用工具调用。`
    );
    const prompt = promptParts.join('\n');
    const sessionKey = `${stage.agent}:${userId}:${projectId}`;
    const agentResponse = await callSubagent(api, sessionKey, prompt);
    const slotName = stage.allow_write[0];
    if (slotName) {
      await stateManager.updateSlot(slotName, agentResponse, stage.agent);
    }
    // 完成当前阶段
    const currentEntry = state.stage_history.find(h => h.stage === nextStage && !h.completed_at);
    if (currentEntry) currentEntry.completed_at = new Date().toISOString();
    nextStage++;
  }
  // 重新从磁盘加载，避免 updateSlot 写入的 slot 数据被内存中旧 state 覆盖
  const saved = await stateManager.load();
  saved.current_stage = nextStage;
  // 合并 stage_history 变更（completed_at + 新阶段条目）
  for (const entry of state.stage_history) {
    if (entry.completed_at) {
      const existing = saved.stage_history.find(h => h.stage === entry.stage);
      if (existing) {
        existing.completed_at = entry.completed_at;
      } else {
        saved.stage_history.push(entry);
      }
    }
  }
  // 如果推进到了新阶段且磁盘中没有，补充记录
  if (nextStage < template.stages.length && !saved.stage_history.find(h => h.stage === nextStage)) {
    saved.stage_history.push({
      stage: nextStage,
      stage_id: template.stages[nextStage].id,
      agent: template.stages[nextStage].agent,
      started_at: new Date().toISOString(),
      versions: 0,
    });
  }
  await stateManager.save(saved);
  return saved;
}

/**
 * pipeline_start - relay 模式：初始化项目并开始与第一个专家对话
 */
export async function pipelineStart(
  templateName: string,
  userId: string,
  projectId: string,
  initialMessage: string,
  workspaceRoot: string,
  api?: { runtime: { subagent: import('../types.js').SubagentAPI } }
): Promise<PipelineStartResult> {
  try {
    if (!templateName) {
      return { status: 'error', mode: 'relay', current_stage: -1, current_stage_name: '错误', current_agent: '', total_stages: 0, stages: [], message: '缺少 template_name', error: 'template_name is required' };
    }
    if (!userId) {
      return { status: 'error', mode: 'relay', current_stage: -1, current_stage_name: '错误', current_agent: '', total_stages: 0, stages: [], message: '缺少 user_id', error: 'user_id is required' };
    }
    if (!projectId) {
      return { status: 'error', mode: 'relay', current_stage: -1, current_stage_name: '错误', current_agent: '', total_stages: 0, stages: [], message: '缺少 project_id', error: 'project_id is required' };
    }

    const root = workspaceRoot || WORKSPACE_ROOT;
    const stateManager = new StateManager(root, userId, projectId);
    const configManager = new WorkspaceConfigManager(root);

    // 强制创建项目目录 — 确保后续 withLock 不会因目录不存在而失败
    const projectDir = path.join(root, 'projects', userId, projectId);
    await fs.mkdir(projectDir, { recursive: true });

    let template: Template;
    try {
      template = await configManager.readTemplate(templateName);
    } catch {
      await initWorkspace(root);
      template = await configManager.readTemplate(templateName);
    }

    const mode = template.mode || 'relay';

    // 检查是否已有运行中的项目
    let state: PipelineState;
    try {
      state = await stateManager.load();
      if (state.status === 'running') {
        const currentStage = state.current_stage < template.stages.length
          ? template.stages[state.current_stage]
          : null;
        return {
          status: 'initialized',
          mode: state.mode,
          current_stage: state.current_stage,
          current_stage_name: currentStage?.id || '完成',
          current_agent: currentStage?.agent || '',
          stage_description: currentStage?.description,
          total_stages: template.stages.length,
          stages: template.stages.map((s, i) => ({
            name: s.id,
            agent: s.agent,
            checkpoint: s.checkpoint,
            completed: i < state.current_stage,
          })),
          message: `项目已存在，当前在第 ${state.current_stage + 1}/${template.stages.length} 阶段，专家 [${currentStage?.agent}] 正在待命。请继续对话。`,
          status_panel: buildStatusPanel(state, template, state.current_stage),
        };
      }
    } catch {
      // 状态文件不存在，初始化
    }

    // 初始化
    state = await stateManager.initialize(template, mode);

    // Hermes 模式：session 启动时冻结 KB 快照 → 保护 prefix cache
    await freezeSnapshot(root, userId, projectId);

    // 自动推进不需要 checkpoints 的阶段
    state = await autoAdvanceNonCheckpointStages(stateManager, template, state, userId, projectId, root, api);

    // 获取当前阶段
    if (state.current_stage >= template.stages.length) {
      state.status = 'completed';
      await stateManager.save(state);
      return {
        status: 'completed',
        mode,
        current_stage: state.current_stage,
        current_stage_name: '完成',
        current_agent: '',
        total_stages: template.stages.length,
        stages: template.stages.map(s => ({ name: s.id, agent: s.agent, checkpoint: s.checkpoint, completed: true })),
        message: '所有阶段已完成！',
        status_panel: buildStatusPanel(state, template, state.current_stage),
      };
    }

    const currentStage = template.stages[state.current_stage];
    const stagesSummary = template.stages.map((s, i) => ({
      name: s.id,
      agent: s.agent,
      checkpoint: s.checkpoint,
      completed: i < state.current_stage,
    }));

    // 如果有初始消息，路由给第一个 Agent
    if (initialMessage) {
      const { response, slotName } = await executeRelayDialogue(
        stateManager, state, template, userId, projectId, root, initialMessage, api
      );

      // P0-4: reload 确保 slot_output 版本信息从磁盘读取而非 stale 变量
      state = await stateManager.load();

      return {
        status: 'checkpoint_reached',
        mode,
        current_stage: state.current_stage,
        current_stage_name: currentStage.id,
        current_agent: currentStage.agent,
        stage_description: currentStage.description,
        total_stages: template.stages.length,
        stages: state.current_stage >= template.stages.length
          ? template.stages.map(s => ({ name: s.id, agent: s.agent, checkpoint: s.checkpoint, completed: true }))
          : stagesSummary,
        slot_output: {
          slot_name: slotName,
          value: response,
          owner: currentStage.agent,
          version: (state.slot_history[slotName]?.length || 0) - 1,
        },
        message: `${response}\n\n---\n💬 继续与 [${currentStage.agent}] 对话，或输入 "下一阶段" 推进。`,
        status_panel: buildStatusPanel(state, template, state.current_stage),
      };
    }

    return {
      status: 'initialized',
      mode,
      current_stage: state.current_stage,
      current_stage_name: currentStage.id,
      current_agent: currentStage.agent,
      stage_description: currentStage.description,
      total_stages: template.stages.length,
      stages: stagesSummary,
      message: `项目已启动（${mode === 'relay' ? '接力' : '管道'}模式）！第 ${state.current_stage + 1}/${template.stages.length} 阶段：由 [${currentStage.agent}] 为您服务。请告诉我你的需求。`,
      status_panel: buildStatusPanel(state, template, state.current_stage),
    };
  } catch (err) {
    return {
      status: 'error',
      mode: 'relay',
      current_stage: -1,
      current_stage_name: '错误',
      current_agent: '',
      total_stages: 0,
      stages: [],
      message: `执行出错: ${String(err)}`,
      error: String(err),
    };
  }
}

