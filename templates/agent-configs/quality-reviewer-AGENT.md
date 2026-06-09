# quality-reviewer · AGENT

> 技术配置：模型、工具、权限、Slot、插件

---

## 基础信息

| 字段 | 值 |
|------|-----|
| ID | `quality-reviewer` |
| Display Name | 审核专家 |
| SOUL.md | `./SOUL.md` |
| SKILL.md | `./SKILL.md` |
| Default Model | `bayesdl/qwen3.5-plus`（审核任务对推理要求不高，性价比优先） |

## Pipeline Stage

```json
{
  "id": "review",
  "agent": "quality-reviewer",
  "model": "bayesdl/qwen3.5-plus",
  "checkpoint": true,
  "allow_read": ["draft_content", "research_notes", "article_idea"],
  "allow_write": ["review_feedback"],
  "description": "质量审核：事实核查、撞车检测、平台规则检查、写作质量评估",
  "_meta": {
    "auto_recheck": true,
    "pass_threshold": 7.0,
    "p0_blocking": true,
    "web_fallback": "text-only"
  }
}
```

## Slot 权限

| Slot | 权限 | 说明 |
|------|------|------|
| `article_idea` | 只读 | 用户原始的选题想法 |
| `topic_brief` | 只读 | 选题简报（了解写作背景） |
| `research_notes` | 只读 | 调研笔记（唯一的事实对照） |
| `draft_content` | 只读 | 正文草稿（审核对象） |
| `review_feedback` | 写（独占） | 审核报告（含评分 + 问题列表） |
| `topic_brief` | 只读 | 选题简报（了解平台和目标） |
| `target_audience` | 只读 | 目标受众信息 |
| `draft_content` | 不可写 | 不改原文 |
| `final_output` | 不可读写 | 发布阶段的产出 |
| `performance_insights` | 不可读写 | 回采分析 |

## 工具权限

> 详见[中央工具分区表](#中央工具分区矩阵) `quality-reviewer` 列。注意可用 `group:web`。

| 工具 | 用途 | 优先级 |
|------|------|--------|
| `pipeline_read` | 读 draft_content + research_notes | 每次启动必调 |
| `pipeline_write_slot` | 写 review_feedback | 主要产出 |
| `pipeline_add_remark` | 微小建议（不走 feedback 通道的小意见） | 可选 |
| `style_read_profile` | 读风格 DNA（检查改味） | 必调 |
| `memory_read`（旧名 kb_read）/ `memory_write`（旧名 kb_write）| 知识库读写（平台规则 + 审核历史） | 必调 |
| `session_search` | 跨 slot 历史检索（查历史同类审核记录） | 按需 |
| `snapshot_read` | 读当前 KB 快照 | 参考冻结知识状态 |
| `session_note_read` | 读前序 Agent 自述笔记 | 了解创作背景 |
| `group:web` | 撞车检测 + 事实交叉验证 | P0 检查时必调 |
| `group:read` | 文件读取（本地平台规则文档） | 按需 |

## Model 路由

| 条件 | 模型 | 原因 |
|------|------|------|
| 默认 | `bayesdl/qwen3.5-plus` | 审核偏规则检查，不需要顶级推理能力 |
| 技术博客/企业文档审核（深度事实核查） | `bayesdl/step-1x-medium` | 复杂事实交叉验证需要更强推理 |
| 大量 group:web 撞车搜索 | `bayesdl/qwen3.5-plus` | 搜索为主的审核不需要高推理成本 |
| 用户要求快速出结果 | `bayesdl/qwen3.5-plus` | 够用 |

## 外部 Skills（openclaw AgentSkills）

> 通过 `npx clawhub search` 从 ClawHub 检索到以下对口的技能。
> 安装脚本：`scripts/install-skills.sh`（一键安装全部 Agent 所需技能）。

### 已确认（ClawHub）

| Skill | 用途 | 安装命令 | 优先级 |
|-------|------|---------|--------|
| `multi-search-engine` | 17 引擎搜索（8 国内 + 9 国际），零 API Key | `openclaw skills install multi-search-engine` | **P0**—联网验证 + 撞车检测的来源 |
| `fact-check` | 对照可靠来源验证主张、陈述和信息 | `openclaw skills install fact-check` | **P1**—增强事实核查能力 |
| `fact-checker-cn` | 中文事实核查（基于多源权威信息 + 视觉取证） | `openclaw skills install fact-checker-cn` | P2—中文场景专用 |
| `ai-humanizer` | 24 模式检测器 + 500+ AI 词汇三级分类，检测 + 改写 AI 痕迹 | `openclaw skills install ai-humanizer` | P1—写作质量维度的 AI 痕迹检测 |

### 非必要

| 能力 | 说明 |
|------|------|
| 平台合规规则 | 已在 `kb_platform/` 知识库中，无需独立 skill |
| 抄袭对比工具 | 目前通过 `group:web` + 关键词搜索实现，效果足够 |

## Plugins 配置

```json
{
  "quality-reviewer": {
    "plugins": [
      "multi-search-engine",
      "fact-check",
      "fact-checker-cn",
      "ai-humanizer"
    ],
    "mcp_servers": [],
    "mcp_tools": []
  }
}
```

> quality-reviewer 是唯一拥有 `group:web` 的非调研 Agent。联网搜索用于撞车检测和事实交叉验证，不作为每篇必做项。
> 如果 `_meta.web_fallback` 设为 `text-only`，联网失败时降级为纯文本审查。

## Security

| 约束 | 说明 |
|------|------|
| 不改原文 | 任何情况下不写 `draft_content` |
| 不替换审核标准 | 不因为用户催促就降低 P0 标准 |
| 不泄露审核细节 | review_feedback 不包含原始数据原文 |
| 联网搜索仅用于验证 | 搜索结果不写入 KB，除非确认有问题 |
