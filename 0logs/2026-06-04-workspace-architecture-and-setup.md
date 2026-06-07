# 工作区架构改造 + Linux 配置脚本

## 变更内容

### 架构复制：0.AI工作区 模式 → 插件

| 0.AI工作区 模式 | 插件实现 | 文件 |
|---------------|---------|------|
| 温度分层 (HOT/WARM/COLD) | StyleSystem.buildInjectionContext(temperature) | `style-system.ts` |
| 检索补全 (L1→L2→L3) | readProfile 逐级 fallback | `style-system.ts:26-33` |
| 条件反射: 学→记 | processCorrectionSignal 即学即写 | `style-system.ts:175-198` |
| 双格式 (.md + .ai.md) | readKB 优先读 kb.ai.md（紧凑版） | `style-system.ts:43-67` |
| 变更日志 | `_shared/{userId}/logs/` + `0logs/` | 目录结构 |
| 共享知识库 | `_shared/{userId}/` 跨 agent 可读 | 目录结构 |

### 新文件

| 文件 | 用途 |
|------|------|
| `scripts/setup-workspace.sh` | Linux 工作区配置脚本（companion，不碰 deploy.sh） |
| `WORKSPACE_TOPOLOGY.md` | 目录结构拓扑 + 与 .openclaw 相对位置 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `tools/style-system.ts` | 重写：温度分层、双格式读取、检索补全 fallback、条件反射学→记 |
| `runtime/injection-layer.ts` | 重写：HOT 核心原则头注入 + WARM 约束尾注入 |

## 重要决策

- **插件不含个人数据**：所有模板文件为空/占位，style-dna.json 不含 29548 风格数据
- **setup-workspace.sh 是 deploy.sh 的 companion**：不改 deploy.sh，纯新增
- **_shared/ 目录结构**：profile/（画像）+ memory/（洞察）+ logs/（变更日志），与 0.AI工作区 的 用户建模/、AI笔记/、0logs/ 对应
- **OPENCLAW_WORKSPACE** 环境变量优先，未设置时自动使用 `<plugin_root>/workspace/`

### 新增：完整工作区文件结构（Architecture Lift）

| 新建内容 | 对应 0.AI工作区 | 文件 |
|---------|----------------|------|
| rules/ 目录 | AGENTS.md + 05-全局规则体系 | `src/rules/{temperature-layering,retrieval-fallback,reflex-learn-record,anti-hallucination}.md` |
| 00-README.md 索引 | 目录索引 | 工作区根、rules/、templates/、agent-guides/、_shared/{userId}/、profile/、memory/、logs/ |
| install.ts 生成 | — | 初始化时创建完整结构（含 README、rules 模板、persona.md 占位、insights.md 占位） |
| setup-workspace.sh | — | Linux companion 脚本同步创建 |
| injection-layer.ts | — | 规则引用：注入时提示 rules/ 文档路径 |

### 架构对照（完整版）

| 0.AI工作区 | 插件 workspace/ | 注入方式 |
|-----------|----------------|---------|
| AGENTS.md | `rules/` | injection-layer.ts 头部注入 |
| 05-全局规则体系 | `rules/{...}.md` | injection-layer.ts 尾部引用 |
| 00-README.ai.md | `README.md` + 各子目录 `00-README.md` | 文件级，不注入 |
| AI笔记/ | `_shared/{userId}/kb.json + memory/` | COLD，工具读取 |
| 用户建模/ | `_shared/{userId}/profile/persona.md` | COLD，工具读取 |
| .styles/ | `_shared/{userId}/style-dna.json` | HOT+WARM，content-writer 专属注入 |
| 0logs/ | `_shared/{userId}/logs/` | COLD，文件级 |
| 双格式 (.md+.ai.md) | `kb.json + kb.ai.md` | 检索补全 L1.5 优先读紧凑版 |

## 未改动

- 所有 deploy 脚本（deploy.sh + patch-*.py + gen-deploy.ps1 + deploy-files.py）
- tsconfig.json, package.json
- cli.ts, pipeline-runner.ts, state-manager.ts
- pipeline.ts, pipeline-start.ts, pipeline-status.ts, route-message.ts
- tool-auth.ts, skill-runner.ts, agent-guide-generator.ts
- templates/
- openclaw.plugin.json
