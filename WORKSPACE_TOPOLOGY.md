# 工作区拓扑

## 目录结构

```
<plugin_root>/                          # npm 安装位置（如 node_modules/@buxiazuo/multi-agent-pipeline/）
├── workspace/                          # WORKSPACE_ROOT（由 __dirname 自动推导）
│   ├── templates/                      # 管道模板 JSON
│   ├── projects/                       # 项目状态
│   │   └── {userId}/
│   │       ├── {projectId}/
│   │       │   └── state.json          # 管道运行状态
│   │       └── agents/
│   │           └── {agentName}-profile.json  # per-agent 偏好（兼容旧版）
│   ├── agent-guides/                   # Agent 协作指南
│   ├── kb_platform/                    # 内部知识库（开发者维护，Agent 只读）
│   │   └── {platform}/
│   │       ├── 00-README.md            # 索引
│   │       ├── platform-data.md        # 平台数据
│   │       ├── algorithm-rules.md      # 算法规则
│   │       ├── format-rules.md         # 格式规范
│   │       ├── content-templates.md    # 内容模板
│   │       ├── title-formulas.md       # 标题公式
│   │       ├── sensitive-words.md      # 敏感词库
│   │       ├── insights/               # 行业数据（可选）
│   │       └── _ai/                    # AI 摘要（自动生成）
│   └── _shared/                        # 用户知识库（Agent 读写）
│       └── {userId}/
│           ├── style-dna.json          # 风格 DNA（content-writer 维护）
│           ├── persona.md              # 用户画像（所有 agent 可读）
│           ├── writing-patterns.md     # 写作偏好（content-writer 维护）
│           ├── kb.json                 # 结构化知识条目
│           ├── change-log/             # 风格演化历史
│           ├── memory/                 # 记忆系统（Hermes 启发式）
│           │   ├── session-snapshot.md # 冻结快照（session 启动时冻结）
│           │   ├── session-note.md     # Agent 自述笔记（≤2.2K 字符）
│           │   └── handoff-log/        # Agent 接力时间线
│           ├── content/                # 历史内容归档（publisher 写）
│           │   └── {platform}/
│           └── analytics/              # 效果分析数据（post-analyst 维护核心区）
│               └── {platform}/
│                   ├── insights/       # 单篇分析存档
│                   ├── titles-leaderboard.md    # 标题公式排名
│                   └── templates-effectiveness.md # 模板效果排名
├── src/                                # 源代码
├── dist/                               # 编译输出
├── openclaw.plugin.json                # 插件注册
└── package.json
```

## 相对 .openclaw

```
~/.openclaw/
├── config/openclaw.json                # 主配置
├── agents/{agentName}/...              # 各 Agent 配置（skills, tools 等）
└── workspaces/multi-agent-pipeline/    # OLD 路径（改用 __dirname 推导，此路径废弃）

<plugin_root>/workspace/               # NEW 工作区（自动定位，不依赖 HOME）
```

## 关键路径

| 用途 | 表达式 | 实际值示例 |
|------|--------|-----------|
| 工作区根 | `path.join(__dirname, '..', 'workspace')` | `.../multi-agent-pipeline/workspace/` |
| 内部知识库 | `join(WORKSPACE_ROOT, 'kb_platform', platform)` | `.../workspace/kb_platform/xiaohongshu/` |
| 用户知识库 | `join(WORKSPACE_ROOT, '_shared', userId)` | `.../workspace/_shared/alice/` |
| 用户分析数据 | `join(WORKSPACE_ROOT, '_shared', userId, 'analytics', platform)` | `.../workspace/_shared/alice/analytics/xiaohongshu/` |
| 用户内容存档 | `join(WORKSPACE_ROOT, '_shared', userId, 'content', platform)` | `.../workspace/_shared/alice/content/xiaohongshu/` |
| 记忆快照 | `join(WORKSPACE_ROOT, '_shared', userId, 'memory', 'session-snapshot.md')` | `.../workspace/_shared/alice/memory/session-snapshot.md` |
| Agent 自述笔记 | `join(WORKSPACE_ROOT, '_shared', userId, 'memory', 'session-note.md')` | `.../workspace/_shared/alice/memory/session-note.md` |
| 接力日志 | `join(WORKSPACE_ROOT, '_shared', userId, 'memory', 'handoff-log')` | `.../workspace/_shared/alice/memory/handoff-log/` |
| 模板目录 | `join(WORKSPACE_ROOT, 'templates')` | `.../workspace/templates/` |
| 状态文件 | `join(projects, userId, projectId, 'state.json')` | `.../workspace/projects/alice/travel/state.json` |

## 环境变量

- `OPENCLAW_WORKSPACE`: 可覆盖默认路径（优先级最高）
- 未设置时自动使用 `<plugin_root>/workspace/`
