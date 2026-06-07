// src/tools/pipeline.ts - 核心管道工具实现

import { promises as fs } from 'fs';
import path from 'path';
import { ToolContext, Template } from '../types.js';
import { StateManager } from '../runtime/state-manager.js';
import { ToolAuth } from './tool-auth.js';

/**
 * pipeline_read - 读取 Slot 的内容
 */
export async function pipelineRead(
  context: ToolContext,
  slotName: string,
  template: Template
): Promise<string | object> {
  const stateManager = new StateManager(context.workspace_root, context.user_id, context.project_id);
  const state = await stateManager.load();

  // 鉴权检查
  ToolAuth.checkSlotAccess(
    context.agent_name,
    slotName,
    'read',
    template,
    state.current_stage
  );

  if (!(slotName in state.slot_values)) {
    return `（Slot '${slotName}' 尚无内容，请先等待前面的 Agent 完成。）`;
  }

  const value = state.slot_values[slotName];
  if (value === '' || value === null || value === undefined) {
    return `（Slot '${slotName}' 当前为空，暂无可用内容。）`;
  }

  return value;
}

/**
 * pipeline_write_slot - 写入 Slot 的内容
 */
export async function pipelineWriteSlot(
  context: ToolContext,
  slotName: string,
  content: string | object,
  template: Template
): Promise<void> {
  const stateManager = new StateManager(context.workspace_root, context.user_id, context.project_id);
  const state = await stateManager.load();

  // 鉴权检查
  ToolAuth.checkSlotAccess(
    context.agent_name,
    slotName,
    'write',
    template,
    state.current_stage
  );

  if (!(slotName in state.slot_values)) {
    throw new Error(`Slot '${slotName}' not found in template`);
  }

  await stateManager.updateSlot(slotName, content, context.agent_name);
}

/**
 * pipeline_add_remark - 添加评论
 */
export async function pipelineAddRemark(
  context: ToolContext,
  content: string
): Promise<void> {
  const stateManager = new StateManager(context.workspace_root, context.user_id, context.project_id);
  await stateManager.addRemark(context.agent_name, content);
}


