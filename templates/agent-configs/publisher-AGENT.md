# publisher · AGENT

> 技术配置：模型、工具、权限、Slot、插件

---

## 基础信息

| 字段 | 值 |
|------|-----|
| ID | `publisher` |
| Display Name | 发布专家 |
| SOUL.md | `./SOUL.md` |
| SKILL.md | `./SKILL.md` |
| Default Model | `bayesdl/step-3.5-flash`（格式适配+发布任务，速度快成本低） |

## Pipeline Stage

```json
{
  "id": "publishing",
  "agent": "publisher",
  "model": "bayesdl/step-3.5-flash",
  "checkpoint": false,
  "allow_read": ["draft_content", "review_feedback"],
  "allow_write": ["final_output"],
  "description": "内容发布：格式适配 + 平台规则检查 + 跨平台分发",
  "_meta": {
    "p0_blocking": true,
    "record_history": true,
    "platforms": ["wechat", "xiaohongshu", "zhihu", "bilibili", "tech-blog", "enterprise-kb"]
  }
}
```

## Slot 权限

| Slot | 权限 | 说明 |
|------|------|------|
| `article_idea` | 只读 | 用户原始的选题想法（了解背景） |
| `target_audience` | 只读 | 目标平台信息（决定发布渠道） |
| `topic_brief` | 只读 | 选题简报（了解上下文） |
| `research_notes` | 只读 | 调研笔记（了解素材来源） |
| `draft_content` | 只读 | 正文草稿（发布源内容） |
| `review_feedback` | 只读 | 审核反馈（P0 检查） |
| `final_output` | 写（独占） | 最终发布内容（含平台适配版本） |
| `performance_insights` | 不可读写 | 回采分析，发布阶段不涉及 |

## 工具权限

> 详见[中央工具分区表](#中央工具分区矩阵) `publisher` 列。

| 工具 | 用途 | 优先级 |
|------|------|--------|
| `pipeline_read` | 读 draft_content + review_feedback | 每次启动必调 |
| `pipeline_write_slot` | 写 final_output | 主要产出 |
| `style_read_profile` | 读风格 DNA（检查标题风格合规） | 必调 |
| `kb_read` / `kb_write` | 知识库读写（平台规则 + 发布历史） | 必调 |
| `session_search` | 跨 slot 历史检索 | 按需 |
| `snapshot_read` | 读当前 KB 快照 | 按需 |
| `session_note_read` | 读前序 Agent 自述笔记 | 了解创作背景 |
| `group:web` | 平台规则最新状态查询 | 发布前可选 |
| `mcp_platform/*` | 平台特定格式适配与内容组织 | 核心工具组 |

## Model 路由

| 条件 | 模型 | 原因 |
|------|------|------|
| 默认 | `bayesdl/step-3.5-flash` | Flash 系列，速度快成本低，格式适配够用 |
| 多平台并行发布 | `bayesdl/step-3.5-flash` | Flash 并发性能好，多个平台一次搞定 |
| 平台规则复杂场景 | `bayesdl/step-1x-medium` | 复杂规则匹配需要更强推理 |
| 用户要求高精度格式 | `bayesdl/step-1x-medium` | 排版一致性要求高时 |

## 外部 Skills（openclaw AgentSkills）

> **publisher 是所有 Agent 中外部 skill 依赖最多的一个** — 每个目标平台都需要对应的发布 Skill 或 MCP。
> 配置指南见 `docs/external-skills-guide.md`。

### 已确认（ClawHub）

| Skill | 用途 | 安装命令 | 优先级 |
|-------|------|---------|--------|
| `social-media-publish` | 通用浏览器自动化发布：微信公众号、百家号、小红书等 | `openclaw skills install social-media-publish` | **P0**—多平台统一分发 |
| `xiaohongshu-mcp` | 小红书全功能 MCP（发布+搜索+分析），Go 编译无浏览器依赖，headless 运行 | `openclaw skills install xiaohongshu-mcp` | **P0**—小红书发布核心（方案 A） |
| `multi-search-engine` | 17 引擎搜索—查最新平台规则、限流政策 | `openclaw skills install multi-search-engine` | **P1**—发布前平台规则验证 |

> 为什么选 `xiaohongshu-mcp` 而不是 `fox-xiaohongshu-publish`：后者依赖 Chrome 内核 + Openclaw 内置浏览器，云容器（BayesDL）不可用。`xiaohongshu-mcp` 是 Go 编译的独立二进制 MCP Server（项目地址：github.com/xpzouying/xiaohongshu-mcp，8.4k+ stars），headless 运行在 localhost:18060，Python client 通过 HTTP API 调用。首次登录需在带浏览器的机器上跑一次登录工具扫码，session 持久化后后续发布无需浏览器。
>
> `social-media-publish` 作为多平台兜底（公众号/百家号等）。

### 非必要

| 能力 | 说明 |
|------|------|
| 平台格式格式化 | publisher 的主要工作，由 SKILL.md 平台指南 + `mcp_platform/*` 工具处理 |
| SEO 优化 | 不在 publisher 职责范围内——各平台 SEO 策略由 content-writer 写作时考虑 |
| `ai-humanizer` | 写作质量相关，由 content-writer 和 quality-reviewer 负责 |
| `fact-check` / `fact-checker-cn` | 事实核查，由 quality-reviewer 负责 |

## Plugins 配置

```json
{
  "publisher": {
    "plugins": [
      "social-media-publish",
      "xiaohongshu-mcp",
      "multi-search-engine"
    ],
    "mcp_servers": ["platform-formatter-server", "xiaohongshu-mcp"],
    "mcp_tools": ["format_wechat", "format_xiaohongshu", "format_zhihu", "format_bilibili", "format_techblog", "format_enterprise"]
  }
}
```

> publisher 不持有 `group:code`、`group:read`。`mcp_platform/*` 工具是核心依赖——由 platform-formatter-server MCP 提供。
> 发布 Skill（`xiaohongshu-mcp`、`social-media-publish`）仅在用户明确要求自动发布时启用。xiaohongshu-mcp 依赖 `~/.openclaw/mcp-servers/xiaohongshu/xiaohongshu-mcp-linux-amd64` 二进制运行（由 deploy.sh 自动下载启动）。

## Security

| 约束 | 说明 |
|------|------|
| 不修改原文实质 | 格式适配只涉及换行/缩进/标签，不改动措辞和事实 |
| P0 未清零不发布 | 读到 review_feedback 中仍有 P0 时标记阻断 |
| 发布历史不包含正文 | `kb_write` 记录只包含元数据（时间、平台、标题、链接），不存全文 |
| 不自动发布 | 每次发布前必须等待用户确认 |
