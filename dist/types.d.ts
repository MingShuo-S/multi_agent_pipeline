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
export interface ToolContext {
    agent_name: string;
    user_id: string;
    project_id: string;
    workspace_root: string;
}
//# sourceMappingURL=types.d.ts.map