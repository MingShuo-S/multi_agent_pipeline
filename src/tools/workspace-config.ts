// src/tools/workspace-config.ts - 工作区配置管理

import { promises as fs } from 'fs';
import path from 'path';
import { Template } from '../types.js';
import { SEED_TEMPLATES_DIR } from '../config.js';

// 标准可用 Agent 名称（创建模板时只能使用这些）
const KNOWN_AGENTS = [
  'topic-researcher',
  'web-researcher',
  'content-writer',
  'quality-reviewer',
  'publisher',
];

export class WorkspaceConfigManager {
  constructor(private workspaceRoot: string) {}

  async listTemplates(): Promise<string[]> {
    try {
      const templatesDir = path.join(this.workspaceRoot, 'templates');
      const files = await fs.readdir(templatesDir);
      return files.filter(f => f.endsWith('.json'));
    } catch (err) {
      return [];
    }
  }

  async readTemplate(templateName: string): Promise<Template> {
    const cleanName = templateName.replace(/\.json$/i, '');
    const templatePath = path.join(this.workspaceRoot, 'templates', `${cleanName}.json`);
    try {
      const content = await fs.readFile(templatePath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      throw new Error(
        `模板 '${templateName}' 不存在于 ${path.join(this.workspaceRoot, 'templates')}。` +
        `请先调用 workspace_config 的 init_workspace 操作初始化工作区，` +
        `或确认 template_name 参数正确。`
      );
    }
  }

  async writeTemplate(templateName: string, template: Template): Promise<void> {
    const templatePath = path.join(this.workspaceRoot, 'templates', `${templateName}.json`);
    try {
      // 校验 JSON 合法性
      const json = JSON.stringify(template, null, 2);
      JSON.parse(json);

      // 校验 stages 中的 agent 名称
      if (template.stages && Array.isArray(template.stages)) {
        const invalidAgents = template.stages
          .map(s => s.agent)
          .filter(a => a && !KNOWN_AGENTS.includes(a));
        if (invalidAgents.length > 0) {
          throw new Error(
            `模板包含无效的 agent 名称: ${invalidAgents.join(', ')}。` +
            `可用 agent: ${KNOWN_AGENTS.join(', ')}`
          );
        }
      }

      const dir = path.dirname(templatePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(templatePath, json, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to write template: ${err}`);
    }
  }

  async readMemory(userId: string, agentName: string): Promise<object> {
    const profilePath = path.join(
      this.workspaceRoot,
      'projects',
      userId,
      'agents',
      `${agentName}-profile.json`
    );
    try {
      const content = await fs.readFile(profilePath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      return {};
    }
  }

  async writeMemory(userId: string, agentName: string, memory: object): Promise<void> {
    const profilePath = path.join(
      this.workspaceRoot,
      'projects',
      userId,
      'agents',
      `${agentName}-profile.json`
    );
    try {
      const json = JSON.stringify(memory, null, 2);
      JSON.parse(json);

      const dir = path.dirname(profilePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(profilePath, json, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to write memory: ${err}`);
    }
  }

  async resetTemplate(templateName: string): Promise<void> {
    const templatePath = path.join(this.workspaceRoot, 'templates', `${templateName}.json`);
    try {
      await fs.unlink(templatePath);
    } catch (err) {
      throw new Error(`Failed to reset template: ${err}`);
    }
  }
}

/**
 * workspace_config - 工作区配置操作
 */
export async function workspaceConfig(
  workspaceRoot: string,
  action: string,
  params: Record<string, any>
): Promise<any> {
  const manager = new WorkspaceConfigManager(workspaceRoot);

  switch (action) {
    case 'list_templates':
      return await manager.listTemplates();

    case 'read_template':
      if (!params.template_name) throw new Error('template_name required');
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
      if (!params.template_name) throw new Error('template_name required');
      return await manager.resetTemplate(params.template_name);

    case 'init_workspace':
      return await initWorkspace(workspaceRoot);

    default:
      throw new Error(`Unknown action: ${action}. 可用操作: list_templates, read_template, write_template, init_workspace, read_memory, write_memory`);
  }
}

/**
 * 初始化工作区：创建目录结构、写入种子模板
 */
export async function initWorkspace(workspaceRoot: string): Promise<{ created: string[]; message: string }> {
  const dirs = [
    path.join(workspaceRoot, 'templates'),
    path.join(workspaceRoot, 'projects'),
    path.join(workspaceRoot, 'projects', '__example__', 'agents'),
  ];
  const created: string[] = [];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
    created.push(dir);
  }

  const seedDir = SEED_TEMPLATES_DIR;
  try {
    const seedFiles = await fs.readdir(seedDir);
    for (const file of seedFiles.filter(f => f.endsWith('.json'))) {
      const src = path.join(seedDir, file);
      const dst = path.join(workspaceRoot, 'templates', file);
      await fs.copyFile(src, dst);
      created.push(dst);
    }
  } catch {
    // 种子目录不存在时创建默认模板
    const defaultTemplate = {
      name: 'default',
      description: '默认流水线模板：调研 → 创作 → 审核',
      stages: [
        { id: 'research', agent: 'web-researcher', checkpoint: true, allow_read: ['topic'], allow_write: ['research'] },
        { id: 'write', agent: 'content-writer', checkpoint: true, allow_read: ['topic', 'research'], allow_write: ['draft'] },
        { id: 'review', agent: 'quality-reviewer', checkpoint: true, allow_read: ['topic', 'draft'], allow_write: ['output'] },
      ],
      slots: {
        topic: { type: 'text', default: '' },
        research: { type: 'text', default: '' },
        draft: { type: 'text', default: '' },
        output: { type: 'text', default: '' },
      },
    };
    const fallbackPath = path.join(workspaceRoot, 'templates', 'default.json');
    await fs.writeFile(fallbackPath, JSON.stringify(defaultTemplate, null, 2));
    created.push(fallbackPath);
  }

  return {
    created,
    message: `工作区初始化完成。模板目录: ${path.join(workspaceRoot, 'templates')}`,
  };
}

/**
 * 为工具导出标准的 OpenClaw 工具定义
 */
export const workspaceConfigTool = {
    workspace_config: {
    id: 'workspace_config',
    name: 'workspace_config',
    description: '管理管道工作区的配置、模板和记忆文件。首次使用前请先调用 init_workspace 初始化工作区。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list_templates', 'read_template', 'write_template', 'read_memory', 'write_memory', 'reset_template', 'init_workspace'],
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
