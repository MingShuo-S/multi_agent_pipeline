import { Template } from '../types.js';
export declare class WorkspaceConfigManager {
    private workspaceRoot;
    constructor(workspaceRoot: string);
    listTemplates(): Promise<string[]>;
    readTemplate(templateName: string): Promise<Template>;
    writeTemplate(templateName: string, template: Template): Promise<void>;
    readMemory(userId: string, agentName: string): Promise<object>;
    writeMemory(userId: string, agentName: string, memory: object): Promise<void>;
    resetTemplate(templateName: string): Promise<void>;
}
/**
 * workspace_config - 工作区配置操作
 */
export declare function workspaceConfig(workspaceRoot: string, action: string, params: Record<string, any>): Promise<any>;
/**
 * 为工具导出标准的 OpenClaw 工具定义
 */
export declare const workspaceConfigTool: {
    workspace_config: {
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                action: {
                    type: string;
                    enum: string[];
                    description: string;
                };
                template_name: {
                    type: string;
                    description: string;
                };
                agent_name: {
                    type: string;
                    description: string;
                };
                user_id: {
                    type: string;
                    description: string;
                };
                content: {
                    type: string[];
                    description: string;
                };
            };
            required: string[];
        };
    };
};
//# sourceMappingURL=workspace-config.d.ts.map