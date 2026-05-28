// src/tools/pipeline.ts - 核心管道工具实现
import { StateManager } from '../runtime/state-manager.js';
import { ToolAuth } from './tool-auth.js';
/**
 * pipeline_read - 读取 Slot 的内容
 */
export async function pipelineRead(context, slotName, template) {
    const stateManager = new StateManager(context.workspace_root, context.user_id, context.project_id);
    const state = await stateManager.load();
    // 鉴权检查
    ToolAuth.checkSlotAccess(context.agent_name, slotName, 'read', template, state.current_stage);
    if (!(slotName in state.slot_values)) {
        throw new Error(`Slot '${slotName}' not found`);
    }
    return state.slot_values[slotName];
}
/**
 * pipeline_write_slot - 写入 Slot 的内容
 */
export async function pipelineWriteSlot(context, slotName, content, template) {
    const stateManager = new StateManager(context.workspace_root, context.user_id, context.project_id);
    const state = await stateManager.load();
    // 鉴权检查
    ToolAuth.checkSlotAccess(context.agent_name, slotName, 'write', template, state.current_stage);
    if (!(slotName in state.slot_values)) {
        throw new Error(`Slot '${slotName}' not found in template`);
    }
    await stateManager.updateSlot(slotName, content);
}
/**
 * pipeline_add_remark - 添加评论
 */
export async function pipelineAddRemark(context, content) {
    const stateManager = new StateManager(context.workspace_root, context.user_id, context.project_id);
    await stateManager.addRemark(context.agent_name, content);
}
/**
 * 为工具导出标准的 OpenClaw 工具定义
 */
export const pipelineTools = {
    pipeline_read: {
        id: 'pipeline_read',
        name: 'pipeline_read',
        description: '读取管道中当前阶段允许的 Slot 内容',
        parameters: {
            type: 'object',
            properties: {
                slot_name: {
                    type: 'string',
                    description: 'Slot 的名称',
                },
            },
            required: ['slot_name'],
        },
    },
    pipeline_write_slot: {
        id: 'pipeline_write_slot',
        name: 'pipeline_write_slot',
        description: '写入 Slot 的内容（仅限当前阶段允许的 Slot）',
        parameters: {
            type: 'object',
            properties: {
                slot_name: {
                    type: 'string',
                    description: 'Slot 的名称',
                },
                content: {
                    type: ['string', 'object'],
                    description: 'Slot 的内容',
                },
            },
            required: ['slot_name', 'content'],
        },
    },
    pipeline_add_remark: {
        id: 'pipeline_add_remark',
        name: 'pipeline_add_remark',
        description: '向管道添加一条评论或备注',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: '评论内容',
                },
            },
            required: ['content'],
        },
    },
};
//# sourceMappingURL=pipeline.js.map