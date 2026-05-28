// src/tools/workspace-config.ts - 工作区配置管理
import { promises as fs } from 'fs';
import path from 'path';
export class WorkspaceConfigManager {
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    async listTemplates() {
        try {
            const templatesDir = path.join(this.workspaceRoot, 'templates');
            const files = await fs.readdir(templatesDir);
            return files.filter(f => f.endsWith('.json'));
        }
        catch (err) {
            return [];
        }
    }
    async readTemplate(templateName) {
        const templatePath = path.join(this.workspaceRoot, 'templates', `${templateName}.json`);
        try {
            const content = await fs.readFile(templatePath, 'utf-8');
            return JSON.parse(content);
        }
        catch (err) {
            throw new Error(`Failed to read template '${templateName}': ${err}`);
        }
    }
    async writeTemplate(templateName, template) {
        const templatePath = path.join(this.workspaceRoot, 'templates', `${templateName}.json`);
        try {
            // 校验 JSON 合法性
            const json = JSON.stringify(template, null, 2);
            JSON.parse(json);
            const dir = path.dirname(templatePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(templatePath, json, 'utf-8');
        }
        catch (err) {
            throw new Error(`Failed to write template: ${err}`);
        }
    }
    async readMemory(userId, agentName) {
        const profilePath = path.join(this.workspaceRoot, 'projects', userId, 'agents', `${agentName}-profile.json`);
        try {
            const content = await fs.readFile(profilePath, 'utf-8');
            return JSON.parse(content);
        }
        catch (err) {
            return {};
        }
    }
    async writeMemory(userId, agentName, memory) {
        const profilePath = path.join(this.workspaceRoot, 'projects', userId, 'agents', `${agentName}-profile.json`);
        try {
            const json = JSON.stringify(memory, null, 2);
            JSON.parse(json);
            const dir = path.dirname(profilePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(profilePath, json, 'utf-8');
        }
        catch (err) {
            throw new Error(`Failed to write memory: ${err}`);
        }
    }
    async resetTemplate(templateName) {
        const templatePath = path.join(this.workspaceRoot, 'templates', `${templateName}.json`);
        try {
            await fs.unlink(templatePath);
        }
        catch (err) {
            throw new Error(`Failed to reset template: ${err}`);
        }
    }
}
/**
 * workspace_config - 工作区配置操作
 */
export async function workspaceConfig(workspaceRoot, action, params) {
    const manager = new WorkspaceConfigManager(workspaceRoot);
    switch (action) {
        case 'list_templates':
            return await manager.listTemplates();
        case 'read_template':
            if (!params.template_name)
                throw new Error('template_name required');
            return await manager.readTemplate(params.template_name);
        case 'write_template':
            if (!params.template_name || !params.content) {
                throw new Error('template_name and content required');
            }
            const template = typeof params.content === 'string'
                ? JSON.parse(params.content)
                : params.content;
            return await manager.writeTemplate(params.template_name, template);
        case 'read_memory':
            if (!params.user_id || !params.agent_name) {
                throw new Error('user_id and agent_name required');
            }
            return await manager.readMemory(params.user_id, params.agent_name);
        case 'write_memory':
            if (!params.user_id || !params.agent_name || !params.content) {
                throw new Error('user_id, agent_name, and content required');
            }
            const memory = typeof params.content === 'string'
                ? JSON.parse(params.content)
                : params.content;
            return await manager.writeMemory(params.user_id, params.agent_name, memory);
        case 'reset_template':
            if (!params.template_name)
                throw new Error('template_name required');
            return await manager.resetTemplate(params.template_name);
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}
/**
 * 为工具导出标准的 OpenClaw 工具定义
 */
export const workspaceConfigTool = {
    workspace_config: {
        id: 'workspace_config',
        name: 'workspace_config',
        description: '管理管道工作区的配置、模板和记忆文件',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['list_templates', 'read_template', 'write_template', 'read_memory', 'write_memory', 'reset_template'],
                    description: '执行的操作',
                },
                template_name: {
                    type: 'string',
                    description: '模板名称（部分操作需要）',
                },
                agent_name: {
                    type: 'string',
                    description: 'Agent 名称（记忆操作需要）',
                },
                user_id: {
                    type: 'string',
                    description: '用户 ID（记忆操作需要）',
                },
                content: {
                    type: ['string', 'object'],
                    description: '模板或记忆的内容（write 操作需要）',
                },
            },
            required: ['action'],
        },
    },
};
//# sourceMappingURL=workspace-config.js.map