export interface CheckpointResult {
    status: 'checkpoint_reached' | 'completed' | 'error';
    current_stage: number;
    current_stage_name: string;
    checkpoint: boolean;
    slot_output?: {
        slot_name: string;
        value: string | object;
        owner?: string;
        written_at?: string;
    };
    previous_remarks?: any[];
    message: string;
    error?: string;
}
/**
 * 执行管道直到遇到 checkpoint 或完成
 */
export declare function executeUntilCheckpoint(workspaceRoot: string, userId: string, projectId: string, templateName: string, skipFirstStage?: boolean): Promise<CheckpointResult>;
/**
 * pipeline_start 工具定义
 */
export declare const pipelineStartTool: {
    id: string;
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            template_name: {
                type: string;
                description: string;
            };
            user_id: {
                type: string;
                description: string;
            };
            project_id: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
/**
 * pipeline_start 实现
 */
export declare function pipelineStart(templateName: string, userId: string, projectId: string, workspaceRoot: string): Promise<CheckpointResult>;
//# sourceMappingURL=pipeline-start.d.ts.map