import { ToolContext, AgentProfile } from '../types.js';
export declare class MemoryManager {
    private profilePath;
    constructor(workspaceRoot: string, userId: string, agentName: string);
    getProfile(): Promise<AgentProfile>;
    recordFeedback(agentName: string, userId: string, preferenceUpdates: Partial<AgentProfile['preferences']>): Promise<void>;
}
/**
 * style_get_profile - 获取用户对 Agent 的风格偏好
 */
export declare function styleGetProfile(context: ToolContext): Promise<AgentProfile['preferences']>;
/**
 * style_record_feedback - 更新用户风格偏好记录
 */
export declare function styleRecordFeedback(context: ToolContext, preferenceUpdates: Partial<AgentProfile['preferences']>): Promise<void>;
/**
 * 为工具导出标准的 OpenClaw 工具定义
 */
export declare const memoryTools: {
    style_get_profile: {
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {};
        };
    };
    style_record_feedback: {
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                preference_updates: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
};
//# sourceMappingURL=memory.d.ts.map