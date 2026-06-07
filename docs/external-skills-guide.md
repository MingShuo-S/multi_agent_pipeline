# 外部 Skills 配置指南

> 部虾创管道使用 openclaw 的 AgentSkills 兼容系统。
> 与 opencode 的 skill 系统完全独立，不要混用。

---

## 1. openclaw Skill 系统概述

openclaw 的 skill 是 **SKILL.md 目录**，加载到 agent 的 system prompt 中，教会 agent **何时以及如何使用工具**。

| 特征 | 说明 |
|------|------|
| 标准 | [AgentSkills](https://agentskills.io) 兼容 |
| 核心文件 | `skills/<name>/SKILL.md`（YAML frontmatter + Markdown 正文） |
| 作用 | 注入 agent system prompt，不可执行代码 |
| 区别于 pipeline 工具 | pipeline 工具（`pipeline_read`、`style_read_profile` 等）是 `defineToolPlugin` 注册的可执行函数；skill 是教 agent **怎么用** 这些工具的文档 |

### opencode vs openclaw skill 区别

| 维度 | opencode | openclaw |
|------|---------|---------|
| 配置位置 | `~/.config/opencode/` | `openclaw.json` 或 `skills/` 目录 |
| 安装命令 | `npx skills install` | `openclaw skills install` |
| 注册表 | `npx skills registry` | `clawhub.ai`（ClawHub） |
| 格式 | AgentSkills 子集 | AgentSkills 完整 + openclaw 扩展元数据 |
| 加载机制 | 注入 prompt | 注入 prompt + 环境变量注入 + gating |
| 用户 agent | 交互式对话 | 不受限|

---

## 2. SKILL.md 格式

### 必需字段

```markdown
---
name: skill-name               # 唯一标识，小写字母+数字+连字符
description: 一句话说明          # 显示给 agent 的描述
---
```

### openclaw 扩展元数据

```markdown
---
name: my-skill
description: 一句话说明
metadata:
  {
    "openclaw":
      {
        "requires": { "bins": ["uv"], "env": ["API_KEY"], "config": ["browser.enabled"] },
        "primaryEnv": "API_KEY",
        "os": ["darwin", "linux", "win32"],
        "always": false,
      },
  }
---
```

| 元数据字段 | 说明 |
|-----------|------|
| `requires.bins` | 依赖的可执行文件（需在 PATH 上） |
| `requires.env` | 依赖的环境变量 |
| `requires.config` | 依赖的 `openclaw.json` 配置键 |
| `primaryEnv` | 主要 API Key 对应的环境变量名 |
| `os` | 平台过滤（`darwin`/`linux`/`win32`） |
| `always` | 始终加载，跳过其他 gating 条件 |

### 正文中的路径引用

用 `{baseDir}` 引用 skill 目录内的脚本或资源：

```
参考模板文件: {baseDir}/templates/checklist.md
```

---

## 3. Skill 存放位置与优先级

| # | 位置 | 作用域 | 优先级 |
|---|------|--------|--------|
| 1 | `<workspace>/skills/<name>/` | 仅该 agent | **最高** |
| 2 | `<workspace>/.agents/skills/<name>/` | 该 workspace 全部 agent | 高 |
| 3 | `~/.agents/skills/<name>/` | 该机器全部 agent | 中 |
| 4 | `~/.openclaw/skills/<name>/` | 该机器全部 agent（受管） | 中 |
| 5 | 内置（openclaw 安装自带） | 全局 | 低 |
| 6 | `skills.load.extraDirs` 配置目录 | 全局 | 最低 |

同名 skill，优先级高的覆盖低的。

### 部虾创阶段推荐

目前统一用 `~/.openclaw/skills/`（共享受管），因为 pipeline 的 subagent 共用同一台机器：

```powershell
mkdir -p ~/.openclaw/skills/style-voiceprint
mkdir -p ~/.openclaw/skills/anti-ai-detector
```

后续移到 `workspace/skills/`（各 agent 独立目录）做细粒度控制。

---

## 4. 安装方式

### 4.1 从 ClawHub 安装（公有注册表）

```bash
# 安装到当前 workspace
openclaw skills install <skill-slug>

# 安装到全局共享目录
openclaw skills install <skill-slug> --global

# 更新所有 workspace 安装的 skill
openclaw skills update --all

# 列出已安装 skill
openclaw skills list
```

ClawHub 地址：`https://clawhub.ai`

### 4.2 从 Git 安装

```bash
openclaw skills install git:owner/repo@ref
```

### 4.3 从本地目录安装

```bash
# 安装本地 skill 到 workspace
openclaw skills install ./path/to/skill --as my-skill

# 直接复制目录到 skill root
cp -r ./path/to/skill ~/.openclaw/skills/my-skill
```

### 4.4 ClawHub 访问

ClawHub (`clawhub.ai`) 当前环境可正常访问。`openclaw skills install <slug>` 直接可用。

---

## 5. Agent 级别 Skill 可见性配置

在 `openclaw.json` 的 `agents` 段配置：

```json5
{
  agents: {
    defaults: {
      skills: ["multi-search-engine", "ai-humanizer"],  // 默认所有 agent 都有
    },
    list: [
      { id: "content-writer", skills: ["ai-humanizer", "style-voiceprint"] },
      { id: "topic-researcher", skills: ["multi-search-engine"] },
      { id: "quality-reviewer", skills: ["multi-search-engine", "ai-humanizer", "fact-check", "fact-checker-cn"] },
      { id: "publisher", skills: ["multi-search-engine", "social-media-publish"] },
      { id: "post-analyst", skills: ["multi-search-engine"] },
    ],
  },
}
```

**注意**：`agents.list[].skills` 非空时**替换** defaults，不合并。

---

## 6. 环境变量与 API Key 注入

```json5
{
  skills: {
    entries: {
      "multi-search-engine": { enabled: true },
      "ai-humanizer": { enabled: true },
      "fact-check": { enabled: true },
      "fact-checker-cn": { enabled: true },
      "social-media-publish": { enabled: true },
      "style-voiceprint": { enabled: true },
    },
  },
}
```

| 字段 | 说明 |
|------|------|
| `enabled` | `false` 禁用该 skill |
| `apiKey` | 快捷方式，对应 skill metadata 的 `primaryEnv` |
| `env` | 环境变量注入（仅注入到 agent 运行期进程，不影响全局） |

---

## 7. Gating（条件加载）

skill 在 `metadata.openclaw.requires` 中声明依赖，不满足时不加载：

```yaml
metadata:
  {
    "openclaw":
      {
        "requires":
          {
            "bins": ["node"],               # 需要 node 在 PATH 上
            "env": ["OPENAI_API_KEY"],      # 需要设置此环境变量
          },
      },
  }
```

部虾创的 skill 不依赖外部二进制，gating 只需要检查 pipeline 工具是否注册。

---

## 8. 创建新 Skill 的完整流程

```
1. 创建目录 ~/.openclaw/skills/<name>/
2. 编写 SKILL.md（YAML frontmatter + Markdown 正文）
3. 在 openclaw.json 配置 agent 可见性（agents.defaults.skills）
4. 新开 session 让 openclaw 加载（openclaw gateway restart）
5. 验证：openclaw skills list
6. agent 对话中触发 skill
```

### 测试命令

```bash
# 列表验证
openclaw skills list

# 重启加载
openclaw gateway restart

# 测试对话
openclaw agent --message "开始风格提取"
```

---

## 9. 部虾创所需的外部 Skills

| Skill | Agent | 来源 | 安装命令 | 用途 |
|-------|-------|------|---------|------|
| `multi-search-engine` | topic-researcher, quality-reviewer, publisher, post-analyst | ClawHub | `openclaw skills install multi-search-engine` | 17 引擎搜索（含百度/必应中国/搜狗/360），零 API Key。替代 openclaw 内置 `web_search`（国内不可用） |
| `ai-humanizer` | content-writer, quality-reviewer | ClawHub | `openclaw skills install ai-humanizer` | 24 模式检测 + 500+ AI 词汇三级分类，检测并改写 AI 痕迹 |
| `fact-check` | quality-reviewer | ClawHub | `openclaw skills install fact-check` | 对照可靠来源验证主张、陈述和信息 |
| `fact-checker-cn` | quality-reviewer | ClawHub | `openclaw skills install fact-checker-cn` | 中文事实核查（多源权威信息 + 视觉取证） |
| `social-media-publish` | publisher | ClawHub | `openclaw skills install social-media-publish` | 通用浏览器自动化发布到微信公众号、百家号等 |
| `fox-xiaohongshu-publish` | publisher | ClawHub | `openclaw skills install fox-xiaohongshu-publish` | 小红书专用发布（网页版创作服务平台，评分 3.06） |
| `style-voiceprint` | content-writer | 本地 | `openclaw skills install ./skills/style-voiceprint --as style-voiceprint` | 10 步引导式风格提取（依赖 pipeline `voiceprint_*` 工具） |

> **注意**：不要安装无维护/低评分的同名 Skill。ClawHub 上有很多 `multi-search-engine` 的分支，统一装官方最新版。

## 各 Agent 技能分配总表

| Agent | 本地技能 | ClawHub 技能 |
|-------|---------|-------------|
| topic-researcher | 无 | `multi-search-engine`, `search-academic`, `lark-*`（企业场景） |
| content-writer | `style-voiceprint` | `ai-humanizer`（写作自检） |
| quality-reviewer | 无 | `multi-search-engine`, `fact-check`, `fact-checker-cn`, `ai-humanizer` |
| publisher | 无 | `social-media-publish`, `fox-xiaohongshu-publish`, `multi-search-engine` |
| post-analyst | 无 | `multi-search-engine`（行业基准参考） |

安装命令汇总：
```
openclaw skills install multi-search-engine fact-check fact-checker-cn ai-humanizer social-media-publish fox-xiaohongshu-publish
```

---

## 10. Bug 排查清单

| 现象 | 可能原因 | 修复 |
|------|---------|------|
| agent 不调用 skill | skill 未加载 | `openclaw skills list` 检查是否在列表；检查 agent allowlist |
| skill 加载失败 | frontmatter 格式错误 | 检查 YAML frontmatter 单行 JSON |
| agent 有 skill 但不执行 | skill 指令模糊 | 在 SKILL.md 写清**何时**调用、**怎么**调用 |
| skill 冲突 | 同名 skill 在多个目录 | 检查优先级：workspace > .agents > home |
| ClawHub 安装失败 | 无法访问 clawhub.ai | 检查代理配置，或用本地安装代替 |
