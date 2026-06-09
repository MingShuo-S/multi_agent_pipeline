// src/install.ts - 安装后初始化脚本，创建工作区目录和结构

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WORKSPACE_ROOT, SHARED_DIR } from './config.js';

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const RULES_TEMPLATES_DIR = path.join(__dirname, 'rules');
  const AGENT_GUIDE_TEMPLATES_DIR = path.join(__dirname, 'agent-guide-templates');

export async function initializeWorkspace(): Promise<void> {
  try {
    const root = WORKSPACE_ROOT;
    const shared = SHARED_DIR;

    // ===== 目录结构 =====
    const dirs = [
      root,
      path.join(root, 'templates'),
      path.join(root, 'projects'),
      path.join(root, 'projects', '__example__', 'agents'),
      path.join(root, 'agent-guides'),
      path.join(root, 'rules'),
      shared,
      path.join(shared, '__template__', 'profile'),
      path.join(shared, '__template__', 'memory'),
      path.join(shared, '__template__', 'logs'),
    ];

    for (const d of dirs) {
      await fs.mkdir(d, { recursive: true });
    }

    // ===== 00-README.md 索引文件 =====
    const readmes: Record<string, string> = {
      'README.md': `# 部虾创工作区

由 \`install.ts\` / \`setup-workspace.sh\` 自动初始化。

## 目录索引

| 目录 | 对应 0.AI工作区 | 用途 |
|------|----------------|------|
| \`rules/\` | AGENTS.md + 05-全局规则体系 | Agent 行为准则 |
| \`templates/\` | — | 管道模板 JSON |
| \`projects/\` | — | 项目运行状态（自动生成） |
| \`agent-guides/\` | 指导/ | Agent 管道协作指南 |
| \`_shared/\` | AI笔记/ + 用户建模/ + .styles/ | 跨 Agent 共享知识库 |

## 温度图谱

| 温度 | 目录 | 注入策略 |
|------|------|---------|
| HOT | \`_shared/{userId}/style-dna.json#corePrinciples\` | 每 session 必读，头部硬注入 |
| WARM | \`_shared/{userId}/style-dna.json#forbiddenPatterns + #vocabulary\` | 按角色需求注入 |
| COLD | \`_shared/{userId}/kb.json + profile/\` | 通过工具按需读取 |
`,
      'rules/README.md': `# 规则目录

管道 Agent 行为准则。对应 0.AI工作区 的 AGENTS.md + 05-全局规则体系。

| 文件 | 对应 0.AI工作区 | 用途 |
|------|----------------|------|
| \`temperature-layering.md\` | 温度分层 | 知识活跃度分类：HOT/WARM/COLD |
| \`retrieval-fallback.md\` | 检索补全协议 L1-L3 | 查找信息时的四级 fallback |
| \`reflex-learn-record.md\` | 条件反射学→记 | 新信息必须立即写入 |
| \`anti-hallucination.md\` | 防幻觉规则 | 内容生成约束 |
`,
      'templates/README.md': `# 管道模板

JSON 格式。每文件一个模板。由 \`workspace_config\` 工具读写。

## 字段说明

参考 \`xiaohongshu-creation.json\`。
`,
      'agent-guides/README.md': `# Agent 协作指南

每文件对应一个 Agent。由 \`agent_guide_generator\` 工具读写。

## 约定

| 文件 | Agent |
|------|-------|
| \`content-writer-guide.md\` | content-writer |
| \`orchestrator-guide.md\` | orchestrator |
| \`topic-researcher-guide.md\` | topic-researcher |
| \`quality-reviewer-guide.md\` | quality-reviewer |
| \`publisher-guide.md\` | publisher |
`,
    };

    for (const [relPath, content] of Object.entries(readmes)) {
      const fullPath = path.join(root, relPath);
      await fs.writeFile(fullPath, content, 'utf-8');
    }

    // ===== 复制 rules/ 种子文件 =====
    try {
      const ruleFiles = await fs.readdir(RULES_TEMPLATES_DIR);
      for (const file of ruleFiles.filter(f => f.endsWith('.md'))) {
        const src = path.join(RULES_TEMPLATES_DIR, file);
        const dst = path.join(root, 'rules', file);
        await fs.copyFile(src, dst);
      }
    } catch {
      // src/rules/ 不存在则跳过
    }

    // ===== 复制 agent-guide 模板 =====
    try {
      const guideFiles = await fs.readdir(AGENT_GUIDE_TEMPLATES_DIR);
      for (const file of guideFiles.filter(f => f.endsWith('.md'))) {
        const src = path.join(AGENT_GUIDE_TEMPLATES_DIR, file);
        const dst = path.join(root, 'agent-guides', file);
        await fs.copyFile(src, dst);
      }
    } catch {
      // src/agent-guide-templates/ 不存在则跳过
    }

    // ===== 共享知识库模板 =====
    const templateDir = path.join(shared, '__template__');

    // style-dna.json
    const styleTemplate = {
      comment: '风格 DNA 模板。由 Voiceprint 流程或 style_write_profile 工具填充。',
      userId: '__USER_ID__',
      version: 1,
      dna: {
        corePrinciples: [],
        syntaxPatterns: {},
        vocabulary: { highFreq: [], forbidden: [], techTerms: [] },
        forbiddenPatterns: [],
        growthDirection: '',
      },
      lastUpdated: '',
    };
    await fs.writeFile(
      path.join(templateDir, 'style-dna.json'),
      JSON.stringify(styleTemplate, null, 2),
      'utf-8',
    );

    // kb.json
    await fs.writeFile(path.join(templateDir, 'kb.json'), '[]', 'utf-8');

    // README.md for _shared/{userId}/
    const sharedUserReadme = `# 用户知识库 — _shared/{userId}/

| 文件 | 对应 0.AI工作区 | 温度 | 用途 |
|------|----------------|------|------|
| \`style-dna.json\` | .styles/ | HOT + WARM | 风格 DNA，content-writer 独占 |
| \`kb.json\` | AI笔记/ | COLD | 结构化知识条目，所有 agent 可读 |
| \`kb.ai.md\` | _ai/ 伴侣文件 | COLD | kb.json 的 AI 可扫描紧凑版 |
| \`profile/persona.md\` | 用户建模/ | COLD | 用户画像，所有 agent 可读 |
| \`memory/insights.md\` | AI笔记/洞察 | COLD | 交互洞察，所有 agent 追加 |
| \`logs/\` | 0logs/ | COLD | 变更日志 |

## 访问规则

| Agent | 读 | 写 |
|-------|----|----|
| content-writer | style-dna.json + 全部 | 全部 |
| 其他 Agent | persona.md + kb.json + insights.md | memory/ 追加 |
| orchestrator | 全部 | 全部 |

## 自动填充

- style-dna.json: Voiceprint 首次写入，后续由纠正信号自动更新
- kb.json: style_record_feedback + kb_write 工具写入
- persona.md: pipeline-continue 拦截钩子更新
- insights.md: 每次纠正/正面信号追加
`;
    await fs.writeFile(path.join(shared, '__template__', 'README.md'), sharedUserReadme, 'utf-8');

    // profile/00-README.md
    const profileReadme = `# profile/ — 用户画像

对应 0.AI工作区 的 用户建模/。

| 文件 | 用途 | 写入者 |
|------|------|--------|
| \`persona.md\` | 用户画像（基本事实、沟通偏好） | pipeline-continue 拦截钩子 |
`;
    await fs.writeFile(path.join(templateDir, 'profile', '00-README.md'), profileReadme, 'utf-8');

    // memory/00-README.md
    const memoryReadme = `# memory/ — 交互记忆

对应 0.AI工作区 的 AI笔记/。

| 文件 | 用途 | 写入者 |
|------|------|--------|
| \`insights.md\` | 累积洞察（纠正信号、偏好发现） | pipeline-continue 拦截钩子 |
`;
    await fs.writeFile(path.join(templateDir, 'memory', '00-README.md'), memoryReadme, 'utf-8');

    // logs/00-README.md
    const logsReadme = `# logs/ — 变更日志

对应 0.AI工作区 的 0logs/。

记录知识库的结构性变更。每次 style-dna.json 或 kb.json 更新时追加。
`;
    await fs.writeFile(path.join(templateDir, 'logs', '00-README.md'), logsReadme, 'utf-8');

    // persona.md 模板（不含个人数据）
    const personaTemplate = `# 用户画像

> 由 pipeline-continue 拦截钩子自动填充。不含预填数据。

## 基本信息

（留空）

## 沟通偏好

（留空）

## 已知事实

（留空）
`;
    await fs.writeFile(path.join(templateDir, 'profile', 'persona.md'), personaTemplate, 'utf-8');

    // insights.md 模板
    const insightsTemplate = `# 交互洞察

> 由 pipeline-continue 拦截钩子自动填充。记录每次交互中提取的用户偏好、纠正信号和正面反馈。

## 日志
`;
    await fs.writeFile(path.join(templateDir, 'memory', 'insights.md'), insightsTemplate, 'utf-8');

    // ===== 默认模板 =====
    const defaultTemplate = {
      name: 'xiaohongshu-creation',
      description: '小红书笔记创作：选题调研 → 写作 → 审核 → 发布 → 回采',
      stages: [
        { id: 'topic-research', agent: 'topic-researcher', checkpoint: false, allow_read: ['*'], allow_write: ['topic_brief', 'research_notes'] },
        { id: 'draft-writing', agent: 'content-writer', checkpoint: true, allow_read: ['topic_brief', 'research_notes'], allow_write: ['draft_content'] },
        { id: 'review', agent: 'quality-reviewer', checkpoint: false, allow_read: ['draft_content', 'research_notes'], allow_write: ['review_feedback'] },
        { id: 'publish', agent: 'publisher', checkpoint: false, allow_read: ['draft_content', 'review_feedback'], allow_write: ['final_output'] },
        { id: 'post-analysis', agent: 'post-analyst', checkpoint: false, allow_read: ['final_output'], allow_write: ['performance_insights'] },
      ],
      slots: {
        topic_brief: { type: 'text', default: '' },
        research_notes: { type: 'text', default: '' },
        draft_content: { type: 'text', default: '' },
        review_feedback: { type: 'text', default: '' },
        final_output: { type: 'text', default: '' },
        performance_insights: { type: 'text', default: '' },
      },
    };

    await fs.writeFile(
      path.join(root, 'templates', 'xiaohongshu-creation.json'),
      JSON.stringify(defaultTemplate, null, 2),
      'utf-8',
    );

  } catch (err) {
    console.error(`初始化失败: ${err}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('install.ts') || process.argv[1]?.endsWith('install.js')) {
  initializeWorkspace().catch(console.error);
}
