export declare class AgentGuideGenerator {
    private workspaceRoot;
    constructor(workspaceRoot: string);
    generateGuide(agentName: string, instructions: string, append?: boolean): Promise<void>;
    readGuide(agentName: string): Promise<string | null>;
}
/**
 * agent_guide_generator - 生成或更新 Agent 协作指南
 */
export declare function agentGuideGenerator(workspaceRoot: string, agentName: string, instructions: string, append?: boolean): Promise<void>;
/**
 * 为工具导出标准的 OpenClaw 工具定义
 */
export declare const agentGuideTool: {
    agent_guide_generator: {
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                agent_name: {
                    type: string;
                    description: string;
                };
                instructions: {
                    type: string;
                    description: string;
                };
                append: {
                    type: string;
                    description: string;
                    default: boolean;
                };
            };
            required: string[];
        };
    };
};
//# sourceMappingURL=agent-guide-generator.d.ts.map