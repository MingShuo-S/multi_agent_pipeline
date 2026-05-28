import type { Template, ToolContext } from '../types.js';
import { StateManager } from './state-manager.js';
export declare class PipelineRunner {
    private workspaceRoot;
    private userId;
    private projectId;
    private templateName;
    private stateManager;
    private rl;
    constructor(workspaceRoot: string, userId: string, projectId: string, templateName: string);
    run(): Promise<void>;
    private waitForCheckpointApproval;
    private prompt;
}
/**
 * 执行管道直到遇到 checkpoint 或完成
 * 被 pipeline_start 和 pipeline_continue 调用
 */
export declare function executeUntilCheckpoint(stateManager: StateManager, template: Template, context: ToolContext): Promise<any>;
//# sourceMappingURL=pipeline-runner.d.ts.map