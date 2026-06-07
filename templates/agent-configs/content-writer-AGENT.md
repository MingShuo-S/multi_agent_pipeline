# content-writer · AGENT

> 技术配置：模型、工具、权限、Slot、插件

---

## 基础信息

| 字段 | 值 |
|------|-----|
| ID | `content-writer` |
| Display Name | 写作专家 |
| SOUL.md | `./SOUL.md` |
| SKILL.md | `./SKILL.md` |
| Default Model | `bayesdl/kimi-k2.5`（创作长文用 `deepseek-v4-flash`） |

## Pipeline Stage

```json
{
  "id": "draft-writing",
  "agent": "content-writer",
  "model": "bayesdl/kimi-k2.5",
  "checkpoint": true,
  "allow_read": ["article_idea", "target_audience", "topic_brief", "research_notes"],
  "allow_write": ["draft_content"],
  "description": "创作正文：基于调研数据 + 风格档案写作",
  "_meta": {
    "outline_required": ["zhihu", "tech-blog", "enterprise"],
    "outline_auto_activate_length": 2000,
    "auto_qa": true,
    "zero_hallucination": true
  }
}
```

## Slot 权限

| Slot | 权限 | 说明 |
|------|------|------|
| `article_idea` | 只读 | 用户原始的选题想法 |
| `target_audience` | 只读 | 用户画像、目标受众、平台 |
| `topic_brief` | 只读 | 选题简报（三场景模板自适应） |
| `research_notes` | 只读 | 调研笔记（唯一的事实来源） |
| `draft_content` | 写（独占） | 正文草稿（含写作说明） |
| `review_feedback` | 不可读写 | quality-reviewer 的审核反馈 |
| `final_output` | 不可读写 | publisher 的最终输出 |
| `performance_insights` | 不可读写 | post-analyst 的回采分析 |

## 工具权限

> 详见[中央工具分区表](#中央工具分区矩阵) `content-writer` 列。注意禁止 `group:web`。

| 工具 | 用途 | 优先级 |
|------|------|--------|
| `pipeline_read` | 读 topic_brief + research_notes | 每次启动必调 |
| `pipeline_write_slot` | 写 draft_content | 主要产出 |
| `pipeline_add_remark` | 跨 stage 通知 topic-researcher 补数据 | 数据不足时 |
| `style_read_profile` | 读风格 DNA | 写前必调 |
| `style_get_context` | 拉取完整风格上下文（DNA + persona + insights） | 写前必调 |
| `style_write_profile` | 写回风格偏好（用户修正时） | 修正后调 |
| `style_extract_signal` | 记录纠正信号（对话中自动调） | 修正后调 |
| `kb_read` / `kb_write` | 平台知识库读写 | 按需 |
| `session_search` | 跨 slot 历史检索 | 按需 |
| `snapshot_read` | 读当前 KB 快照 | 写前调 |
| `session_note_read` / `session_note_write` | Agent 自述笔记 | 交接后调 |
| `group:web` | **禁止** | 无权限 |

## Model 路由

| 条件 | 模型 | 原因 |
|------|------|------|
| 默认 | `bayesdl/kimi-k2.5` | 性价比均衡，日常文案够用 |
| 长文创作（>2000 字） | `bayesdl/deepseek-v4-flash` | 长文需要更强的逻辑连贯性和指令遵循 |
| 技术博客 / 企业文档 | `bayesdl/deepseek-v4-flash` | 技术内容需要更严谨的表述 |
| 用户要求快速出稿 | `bayesdl/kimi-k2.5` | 简短文案够用 |
| 用户明确要求精确风格模仿 | `bayesdl/deepseek-v4-flash` | 风格遵循能力更强 |

## 外部 Skills（openclaw AgentSkills）

> openclaw skill 系统独立于 opencode skill，遵循 AgentSkills 标准。
> 配置指南见 `docs/external-skills-guide.md`。

### 已就绪

| Skill | 用途 | 安装方式 | 配置位置 |
|-------|------|---------|---------|
| `style-voiceprint` | Onboarding 风格提取：收集样本 → LLM 分析 → 生成 style-dna.json | 本地 `skills/style-voiceprint/` → `~/.openclaw/skills/` | `openclaw.json` agents 白名单 |

依赖 pipeline 已注册的 `voiceprint_*` 工具组（`voiceprint_init` / `voiceprint_proceed` / `voiceprint_calibrate` / `voiceprint_analyze` / `voiceprint_confirm` / `voiceprint_reset`），不额外依赖外部服务。

### 待部署

| Skill | 优先级 | 用途 | 安装方式 |
|-------|--------|------|---------|
| `anti-ai-detector` | P1 | 写作自检 + 审核查 AI 痕迹 | 本地 `skills/anti-ai-detector/` → `~/.openclaw/skills/` |

### 非必要

| Skill | 原因 |
|-------|------|
| `multi-search-engine` | content-writer 禁止联网，无需安装 |
| `platform-formatter` | 平台格式适配由 publisher 的 `mcp_platform/*` 处理 |
| `writing-assistant-enhanced` | 现有 SKILL.md 的平台指南 + 风格 DNA 系统已覆盖 |

## Plugins 配置

```json
{
  "content-writer": {
    "plugins": [
      "style-voiceprint",
      "anti-ai-detector"
    ],
    "mcp_servers": [],
    "mcp_tools": []
  }
}
```

> content-writer 不持有 `group:web`、`group:code`、`group:read`、`mcp_platform/*`。所有事实性输入来自 pipeline slot，不直接访问外部资源。
> 外部 skill（style-voiceprint / anti-ai-detector）仅在 `openclaw.json` 的 `agents.defaults.skills` 或 `agents.list[].skills` 白名单后在 agent prompt 中生效。

## Security

| 约束 | 说明 |
|------|------|
| 不接触其他 agent 的 slot | 不读不写 `draft_content` 以外 slot 的写入权 |
| 不联网 | 不持有任何联网工具。需要数据 → `pipeline_add_remark` |
| 不编造数据 | 遵守零幻觉契约：只写 research_notes 中有的内容 |
| 不写敏感内容 | 不输出个人身份信息、未授权引用、政治敏感内容 |
| 不保留风格错配 | 风格 DNA 冲突时以 HOT 层硬规则优先，COLD 层次之 |
