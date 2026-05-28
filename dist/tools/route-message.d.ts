import { ToolContext } from '../types.js';
export declare class RouteMessageHandler {
    private workspaceRoot;
    constructor(workspaceRoot: string);
    routeMessage(context: ToolContext, targetAgent: string, message: string): Promise<string>;
    private buildDialoguePrompt;
}
/**
 * route_message - 路由用户消息给指定 Agent
 */
export declare function routeMessage(context: ToolContext, targetAgent: string, message: string): Promise<string>;
/**
 * 为工具导出标准的 OpenClaw 工具定义
 */
export declare const routeMessageTool: {
    route_message: {
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                target_agent: {
                    type: string;
                    description: string;
                };
                message: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
};
//# sourceMappingURL=route-message.d.ts.map