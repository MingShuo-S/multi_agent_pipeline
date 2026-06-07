# post-analyst · AGENT

> 技术配置：模型、工具、权限、Slot、插件

---

## 基础信息

| 字段 | 值 |
|------|-----|
| ID | `post-analyst` |
| Display Name | 效果分析师 |
| SOUL.md | `./SOUL.md` |
| SKILL.md | `./SKILL.md` |
| Default Model | `bayesdl/kimi-k2.5`（分析+洞察提炼，需要较强的综合推理） |

## Pipeline Stage

```json
{
  "id": "analysis",
  "agent": "post-analyst",
  "model": "bayesdl/kimi-k2.5",
  "checkpoint": false,
  "allow_read": ["*"],
  "allow_write": ["performance_insights"],
  "description": "效果分析：汇总对比多篇历史数据，提炼选题+写作改进建议，写回知识库",
  "_meta": {
    "min_samples_for_pattern": 3,
    "feedback_targets": ["topic-researcher", "content-writer"],
    "auto_kb_write": true
  }
}
```

## Slot 权限

| Slot | 权限 | 说明 |
|------|------|------|
| `article_idea` | 只读 | 用户原始的选题想法 |
| `target_audience` | 只读 | 目标受众信息 |
| `topic_brief` | 只读 | 选题简报 |
| `research_notes` | 只读 | 调研笔记 |
| `draft_content` | 只读 | 正文草稿 |
| `review_feedback` | 只读 | 审核反馈 |
| `final_output` | 只读 | 最终发布内容（含发布元数据） |
| `performance_insights` | 写（独占） | 效果分析报告 + 改进建议 |
| 其他 `*` | 只读 | 可读全部已有内容 |

## 工具权限

> 详见[中央工具分区表](#中央工具分区矩阵) `post-analyst` 列。

| 工具 | 用途 | 优先级 |
|------|------|--------|
| `pipeline_read` | 读 final_output + 其他已有 slot | 每次启动必调 |
| `pipeline_write_slot` | 写 performance_insights | 主要产出 |
| `pipeline_add_remark` | 向 topic-researcher/content-writer 推送反馈 | 必调 |
| `style_read_profile` | 读风格 DNA | 分析风格对效果的影响 |
| `kb_read` / `kb_write` | 知识库读写（核心——写回报表 + 洞察） | 必调 |
| `session_search` | 跨 slot 历史检索（对比多篇数据） | 必调 |
| `snapshot_read` | 读当前 KB 快照 | 了解知识库基线 |
| `memory_compress` | KB 数据压缩（数据累积过多时） | 按需 |
| `group:web` | **不持有**——不联网搜索 | 无权限 |

## Model 路由

| 条件 | 模型 | 原因 |
|------|------|------|
| 默认 | `bayesdl/kimi-k2.5` | 分析+写作类任务，综合推理需求高但不需要极大 context |
| 长周期对比分析（50 篇+） | `bayesdl/deepseek-v4-flash` | 长上下文 + 强推理，跨篇模式识别 |
| 知识库数据压缩 | `bayesdl/deepseek-v4-flash` | 压缩需要精确判断什么保留什么丢弃 |
| 用户要求快速概览 | `bayesdl/kimi-k2.5` | 够用 |

## 外部 Skills（openclaw AgentSkills）

> 配置指南见 `docs/external-skills-guide.md`。

### 已确认（ClawHub）

| Skill | 用途 | 安装命令 | 优先级 |
|-------|------|---------|--------|
| `multi-search-engine` | 查询行业基准数据、竞品效果参考 | `openclaw skills install multi-search-engine` | P1——分析参考 |

### 非必要

| 能力 | 说明 |
|------|------|
| 数据分析工具 | post-analyst 的主要分析基于 KB 记录和 slot 数据，不需要独立的数据分析 skill |
| 趋势预测 | 当前版本不做预测性分析，只做回顾性总结 |

## Plugins 配置

```json
{
  "post-analyst": {
    "plugins": ["multi-search-engine"],
    "mcp_servers": [],
    "mcp_tools": []
  }
}
```

> post-analyst 不持有 `group:web`、`group:code`、`mcp_platform/*`。`multi-search-engine` 仅用于行业基准参考，不作为核心依赖。

## Security

| 约束 | 说明 |
|------|------|
| 不修改已有 slot | 只写 `performance_insights`，不碰其他 agent 的产出 |
| 不从外部爬取数据 | `multi-search-engine` 仅用于行业基准对比 |
| 不保留个人身份信息 | 分析报表不包含用户姓名、社交媒体账号等 PII |
| 反馈闭环不涉及第三方 | 分析结论仅在管道内路由，不对外推送 |
