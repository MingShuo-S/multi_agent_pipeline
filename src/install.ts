// src/install.ts - 安装后初始化脚本，创建工作区目录

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export async function initializeWorkspace(): Promise<void> {
  try {
    const openclawDir = path.join(os.homedir(), '.openclaw');
    const workspaceRoot = path.join(openclawDir, 'workspaces', 'multi-agent-pipeline');

    // 创建所有必要的目录
    const dirs = [
      workspaceRoot,
      path.join(workspaceRoot, 'templates'),
      path.join(workspaceRoot, 'projects'),
      path.join(workspaceRoot, 'agent-guides'),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
      console.log(`✓ 创建目录: ${dir}`);
    }

    // 创建默认模板
    const defaultTemplate = {
      name: 'xiaohongshu-creation',
      description: '生成一篇小红书笔记',
      stages: [
        {
          id: 'topic-research',
          agent: 'topic-researcher',
          checkpoint: false,
          allow_read: ['*'],
          allow_write: ['topic_brief'],
        },
        {
          id: 'web-research',
          agent: 'web-researcher',
          checkpoint: false,
          allow_read: ['topic_brief'],
          allow_write: ['research_notes'],
        },
        {
          id: 'draft-writing',
          agent: 'content-writer',
          checkpoint: true,
          allow_read: ['topic_brief', 'research_notes'],
          allow_write: ['draft_content'],
        },
        {
          id: 'review',
          agent: 'quality-reviewer',
          checkpoint: false,
          allow_read: ['draft_content', 'research_notes'],
          allow_write: ['review_feedback'],
        },
        {
          id: 'publish',
          agent: 'publisher',
          checkpoint: false,
          allow_read: ['draft_content', 'review_feedback'],
          allow_write: ['final_output'],
        },
      ],
      slots: {
        topic_brief: { type: 'text', default: '' },
        research_notes: { type: 'text', default: '' },
        draft_content: { type: 'text', default: '' },
        review_feedback: { type: 'text', default: '' },
        final_output: { type: 'text', default: '' },
      },
    };

    const templatePath = path.join(workspaceRoot, 'templates', 'xiaohongshu-creation.json');
    await fs.writeFile(templatePath, JSON.stringify(defaultTemplate, null, 2), 'utf-8');
    console.log(`✓ 创建默认模板: ${templatePath}`);

    console.log(`\n✓ 工作区初始化完成: ${workspaceRoot}`);
  } catch (err) {
    console.error(`✗ 初始化失败: ${err}`);
    process.exit(1);
  }
}

// 如果直接运行此文件，执行初始化
if (process.argv[1]?.endsWith('install.ts') || process.argv[1]?.endsWith('install.js')) {
  initializeWorkspace().catch(console.error);
}
