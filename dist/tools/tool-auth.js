// src/tools/tool-auth.ts - 工具调用鉴权
export class ToolAuth {
    static checkSlotAccess(agentName, slotName, action, template, currentStageIndex) {
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
            throw new Error(`Agent '${agentName}' is not allowed to ${action} slot '${slotName}' at stage '${currentStage.id}'. ` +
                `Allowed slots: ${allowList.join(', ')}`);
        }
    }
    static getReadableSlots(template, currentStageIndex) {
        if (currentStageIndex < 0 || currentStageIndex >= template.stages.length) {
            return [];
        }
        const stage = template.stages[currentStageIndex];
        if (stage.allow_read.includes('*')) {
            return Object.keys(template.slots);
        }
        return stage.allow_read;
    }
    static getWritableSlots(template, currentStageIndex) {
        if (currentStageIndex < 0 || currentStageIndex >= template.stages.length) {
            return [];
        }
        const stage = template.stages[currentStageIndex];
        if (stage.allow_write.includes('*')) {
            return Object.keys(template.slots);
        }
        return stage.allow_write;
    }
}
//# sourceMappingURL=tool-auth.js.map