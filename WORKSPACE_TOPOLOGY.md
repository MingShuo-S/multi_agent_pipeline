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
│   └── _shared/                        # 共享知识库（所有 agent 可读）
│       └── {userId}/
│           ├── style-dna.json          # 风格 DNA（content-writer 硬注入）
│           ├── persona.md              # 用户画像（所有 agent 可读）
│           ├── insights.md             # 累积洞察（所有 agent 贡献）
│           ├── kb.json                 # 结构化知识条目
│           └── change-log/             # 风格演化历史
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
| 共享知识库 | `join(WORKSPACE_ROOT, '_shared', userId)` | `.../workspace/_shared/alice/` |
| 模板目录 | `join(WORKSPACE_ROOT, 'templates')` | `.../workspace/templates/` |
| 状态文件 | `join(projects, userId, projectId, 'state.json')` | `.../workspace/projects/alice/travel/state.json` |

## 环境变量

- `OPENCLAW_WORKSPACE`: 可覆盖默认路径（优先级最高）
- 未设置时自动使用 `<plugin_root>/workspace/`
