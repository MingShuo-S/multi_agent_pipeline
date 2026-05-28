import { Template } from '../types.js';
export declare class ToolAuth {
    static checkSlotAccess(agentName: string, slotName: string, action: 'read' | 'write', template: Template, currentStageIndex: number): void;
    static getReadableSlots(template: Template, currentStageIndex: number): string[];
    static getWritableSlots(template: Template, currentStageIndex: number): string[];
}
//# sourceMappingURL=tool-auth.d.ts.map