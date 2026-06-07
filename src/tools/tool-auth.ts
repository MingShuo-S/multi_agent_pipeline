// src/tools/tool-auth.ts - 工具调用鉴权

import { Template, PipelineStage } from '../types.js';

export class ToolAuth {
  static checkSlotAccess(
    agentName: string,
    slotName: string,
    action: 'read' | 'write',
    template: Template,
    currentStageIndex: number
  ): void {
    if (currentStageIndex < 0 || currentStageIndex >= template.stages.length) {
      throw new Error(`Invalid stage index: ${currentStageIndex}`);
    }

    const currentStage = template.stages[currentStageIndex];
    const allowList = action === 'read' ? currentStage.allow_read : currentStage.allow_write;

    // 检查是否有通配符权限
    if (allowList.includes('*')) {
      return;
    }

    // 检查特定 slot 权限
    if (!allowList.includes(slotName)) {
      throw new Error(
        `Agent '${agentName}' is not allowed to ${action} slot '${slotName}' at stage '${currentStage.id}'. ` +
        `Allowed slots: ${allowList.join(', ')}`
      );
    }
  }

  /**
   * 获取所有已注册的 slot 名称（兼容 schema 和旧 slots 格式）
   */
  static getAllSlotNames(template: Template): string[] {
    if (template.schema) {
      return [
        ...Object.keys(template.schema.input),
        ...Object.keys(template.schema.working),
        ...Object.keys(template.schema.output),
      ];
    }
    return Object.keys(template.slots);
  }

  static getReadableSlots(template: Template, currentStageIndex: number): string[] {
    if (currentStageIndex < 0 || currentStageIndex >= template.stages.length) {
      return [];
    }
    const stage = template.stages[currentStageIndex];
    if (stage.allow_read.includes('*')) {
      return this.getAllSlotNames(template);
    }
    return stage.allow_read;
  }

  static getWritableSlots(template: Template, currentStageIndex: number): string[] {
    if (currentStageIndex < 0 || currentStageIndex >= template.stages.length) {
      return [];
    }
    const stage = template.stages[currentStageIndex];
    if (stage.allow_write.includes('*')) {
      return this.getAllSlotNames(template);
    }
    return stage.allow_write;
  }
}
