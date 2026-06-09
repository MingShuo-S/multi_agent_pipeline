// src/tools/workspace-config.ts - 工作区配置管理

import { promises as fs } from 'fs';
import path from 'path';
import { Template } from '../types.js';
import { SEED_TEMPLATES_DIR } from '../config.js';

/**
 * 校验模板 JSON 结构完整性
 * 返回错误字符串数组，空数组表示通过
 */
export function validateTemplate(data: unknown): string[] {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') return ['模板必须是对象'];

  const t = data as Record<string, unknown>;

  if (!t.name || typeof t.name !== 'string') errors.push('缺少 name (string)');
  if (!t.description || typeof t.description !== 'string') errors.push('缺少 description (string)');

  // stages
  if (!Array.isArray(t.stages)) {
    errors.push('缺少 stages (array)');
  } else if (t.stages.length === 0) {
    errors.push('stages 不能为空');
  } else {
    for (let i = 0; i < t.stages.length; i++) {
      const s = t.stages[i] as Record<string, unknown>;
      if (!s || typeof s !== 'object') { errors.push(`stages[${i}] 必须是对象`); continue; }
      if (!s.id || typeof s.id !== 'string') errors.push(`stages[${i}] 缺少 id (string)`);
      if (!s.agent || typeof s.agent !== 'string') errors.push(`stages[${i}] 缺少 agent (string)`);
      if (typeof s.checkpoint !== 'boolean') errors.push(`stages[${i}] 缺少 checkpoint (boolean)`);
      if (!Array.isArray(s.allow_read)) errors.push(`stages[${i}] 缺少 allow_read (string[])`);
      if (!Array.isArray(s.allow_write)) errors.push(`stages[${i}] 缺少 allow_write (string[])`);
    }
  }

  // slots（兼容旧格式，schema 存在时 slots 可选）
  const hasSchema = t.schema && typeof t.schema === 'object';
  if (!t.slots || typeof t.slots !== 'object') {
    if (!hasSchema) {
      errors.push('缺少 slots (object) — 必须定义 slots 或 schema');
    }
  } else {
    for (const [key, slot] of Object.entries(t.slots)) {
      const s = slot as Record<string, unknown>;
      if (!s || typeof s !== 'object') { errors.push(`slots.${key} 必须是对象`); continue; }
      if (!['text', 'json', 'file'].includes(s.type as string)) errors.push(`slots.${key} 缺少有效的 type (text|json|file)`);
      if (s.default === undefined) errors.push(`slots.${key} 缺少 default`);
    }
  }

  // schema（可选，P0-1）
  if (hasSchema) {
    const schema = t.schema as Record<string, unknown>;
    for (const layer of ['input', 'working', 'output']) {
      if (schema[layer] && typeof schema[layer] !== 'object') {
        errors.push(`schema.${layer} 必须是对象`);
      }
    }
  }

  // interrupts（可选，P0-3）
  if (t.interrupts && !Array.isArray(t.interrupts)) {
    errors.push('interrupts 必须是数组');
  }

  return errors;
}

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
      const parsed = JSON.parse(content);
      const errs = validateTemplate(parsed);
      if (errs.length > 0) {
        throw new Error(`模板 '${templateName}' 结构无效:\n  ${errs.join('\n  ')}`);
      }
      return parsed;
    } catch (err) {
      if (err instanceof Error && err.message.includes('结构无效')) throw err;
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
      const errs = validateTemplate(template);
      if (errs.length > 0) {
        throw new Error(`模板数据无效:\n  ${errs.join('\n  ')}`);
      }
      const json = JSON.stringify(template, null, 2);

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

  async readSharedProfile(userId: string): Promise<object> {
    const profilePath = path.join(this.workspaceRoot, '_shared', userId, 'style-dna.json');
    try {
      const content = await fs.readFile(profilePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  async writeSharedProfile(userId: string, profile: object): Promise<void> {
    const profilePath = path.join(this.workspaceRoot, '_shared', userId, 'style-dna.json');
    const dir = path.dirname(profilePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), 'utf-8');
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

    case 'read_shared_profile':
      if (!params.user_id) throw new Error('user_id required');
      return await manager.readSharedProfile(params.user_id);

    case 'write_shared_profile':
      if (!params.user_id || !params.content) {
        throw new Error('user_id and content required');
      }
      const sharedProfile = typeof params.content === 'string'
        ? JSON.parse(params.content)
        : params.content;
      return await manager.writeSharedProfile(params.user_id, sharedProfile);

    case 'reset_template':
      if (!params.template_name) throw new Error('template_name required');
      return await manager.resetTemplate(params.template_name);

    case 'init_workspace':
      return await initWorkspace(workspaceRoot);

    default:
      throw new Error(`Unknown action: ${action}. 可用操作: list_templates, read_template, write_template, init_workspace, read_memory, write_memory, read_shared_profile, write_shared_profile`);
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
    path.join(workspaceRoot, 'agent-guides'),
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
    const defaultTemplate = {
      name: 'default',
      description: '默认流水线模板：调研 → 创作 → 审核',
      stages: [
        { id: 'research', agent: 'topic-researcher', checkpoint: true, allow_read: ['topic'], allow_write: ['topic_brief', 'research_notes'] },
        { id: 'write', agent: 'content-writer', checkpoint: true, allow_read: ['topic', 'topic_brief', 'research_notes'], allow_write: ['draft'] },
        { id: 'review', agent: 'quality-reviewer', checkpoint: true, allow_read: ['topic', 'draft'], allow_write: ['output'] },
      ],
      slots: {
        topic: { type: 'text', default: '' },
        topic_brief: { type: 'text', default: '' },
        research_notes: { type: 'text', default: '' },
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

