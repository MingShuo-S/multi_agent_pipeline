// src/tools/memory.ts - 用户长期记忆管理
import { promises as fs } from 'fs';
import path from 'path';
export class MemoryManager {
    constructor(workspaceRoot, userId, agentName) {
        this.profilePath = path.join(workspaceRoot, 'projects', userId, 'agents', `${agentName}-profile.json`);
    }
    async getProfile() {
        try {
            const content = await fs.readFile(this.profilePath, 'utf-8');
            return JSON.parse(content);
        }
        catch (err) {
            // 如果文件不存在，返回空 profile
            return {
                agent: '',
                user_id: '',
                preferences: {},
                last_updated: new Date().toISOString(),
            };
        }
    }
    async recordFeedback(agentName, userId, preferenceUpdates) {
        try {
            let profile = await this.getProfile();
            // 如果 profile 为空，初始化
            if (!profile.agent) {
                profile.agent = agentName;
                profile.user_id = userId;
            }
            // 合并更新
            profile.preferences = {
                ...profile.preferences,
                ...preferenceUpdates,
            };
            profile.last_updated = new Date().toISOString();
            // 确保目录存在
            const dir = path.dirname(this.profilePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(this.profilePath, JSON.stringify(profile, null, 2), 'utf-8');
        }
        catch (err) {
            console.error(`Failed to record feedback: ${err}`);
        }
    }
}
/**
 * style_get_profile - 获取用户对 Agent 的风格偏好
 */
export async function styleGetProfile(context) {
    const manager = new MemoryManager(context.workspace_root, context.user_id, context.agent_name);
    const profile = await manager.getProfile();
    return profile.preferences || {};
}
/**
 * style_record_feedback - 更新用户风格偏好记录
 */
export async function styleRecordFeedback(context, preferenceUpdates) {
    const manager = new MemoryManager(context.workspace_root, context.user_id, context.agent_name);
    await manager.recordFeedback(context.agent_name, context.user_id, preferenceUpdates);
}
/**
 * 为工具导出标准的 OpenClaw 工具定义
 */
export const memoryTools = {
    style_get_profile: {
        id: 'style_get_profile',
        name: 'style_get_profile',
        description: '获取用户对本 Agent 的已知风格偏好和反馈记录',
        parameters: {
            type: 'object',
            properties: {},
        },
    },
    style_record_feedback: {
        id: 'style_record_feedback',
        name: 'style_record_feedback',
        description: '更新用户对本 Agent 的风格偏好和反馈',
        parameters: {
            type: 'object',
            properties: {
                preference_updates: {
                    type: 'object',
                    description: '偏好更新内容，可包含 style, avoid, feedback_log 等',
                },
            },
            required: ['preference_updates'],
        },
    },
};
//# sourceMappingURL=memory.js.map