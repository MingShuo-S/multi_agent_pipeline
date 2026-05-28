import { PipelineState, Template } from '../types.js';
export declare class StateManager {
    private statePath;
    constructor(workspaceRoot: string, userId: string, projectId: string);
    initialize(template: Template): Promise<PipelineState>;
    load(): Promise<PipelineState>;
    save(state: PipelineState): Promise<void>;
    updateSlot(slotName: string, content: string | object): Promise<void>;
    addRemark(agentName: string, content: string): Promise<void>;
    advanceStage(): Promise<void>;
    setStatus(status: 'running' | 'paused' | 'completed' | 'failed'): Promise<void>;
}
//# sourceMappingURL=state-manager.d.ts.map