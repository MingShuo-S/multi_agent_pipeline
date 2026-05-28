import { Template, PipelineState, AgentProfile } from '../types.js';
export declare class PromptBuilder {
    private workspaceRoot;
    private userId;
    private projectId;
    constructor(workspaceRoot: string, userId: string, projectId: string);
    /**
     * 为管道调用构建 Prompt
     */
    buildPipelinePrompt(agentName: string, template: Template, state: PipelineState, profile: AgentProfile | null, userMessage?: string): Promise<string>;
    private buildSlotContent;
    private indent;
}
//# sourceMappingURL=prompt-builder.d.ts.map