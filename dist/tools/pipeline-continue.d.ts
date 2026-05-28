export interface ContinueResult {
    status: 'revised' | 'checkpoint_reached' | 'completed' | 'error';
    action_taken: 'revised_current_stage' | 'proceeded_to_next_stage' | 'completed';
    current_stage: number;
    current_stage_name: string;
    slot_output?: {
        slot_name: string;
        value: string | object;
        owner?: string;
        written_at?: string;
    };
    message: string;
    error?: string;
}
/**
 * pipeline_continue 工具定义
 */
export declare const pipelineContinueTool: {
    id: string;
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            user_id: {
                type: string;
                description: string;
            };
            project_id: {
                type: string;
                description: string;
            };
            feedback: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
/**
 * pipeline_continue 实现
 */
export declare function pipelineContinue(userId: string, projectId: string, feedback: string, workspaceRoot: string): Promise<ContinueResult>;
//# sourceMappingURL=pipeline-continue.d.ts.map