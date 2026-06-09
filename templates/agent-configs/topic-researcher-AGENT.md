# topic-researcher · AGENT

> 技术配置：模型、工具、权限、Slot

---

## 基础信息

| 字段 | 值 |
|------|-----|
| ID | `topic-researcher` |
| Display Name | 选题调研专家 |
| SOUL.md | `./SOUL.md` |
| SKILL.md | `./SKILL.md` |
| Default Model | `bayesdl/qwen3.5-plus`（R1: 企业/技术场景用 `step-1x-medium`） |

## Pipeline Stage

```json
{
  "id": "topic-research",
  "agent": "topic-researcher",
  "checkpoint": true,
  "allow_read": ["*"],
  "allow_write": ["topic_brief", "research_notes"],
  "description": "选题调研：对话确定选题 + 多源搜索验证数据 + 置信度标定"
}
```

## Slot 权限

| Slot | 权限 | 说明 |
|------|------|------|
| `article_idea` | 只读 | 用户输入的选题想法 |
| `target_audience` | 只读 | 用户画像、受众信息 |
| `topic_brief` | 写（独占） | 选题简报（三场景模板自适应） |
| `research_notes` | 写（独占） | 调研笔记（每项标置信度+来源） |
| `draft_content` | 不可读 | 写作阶段的正文，调研阶段不接触 |
| `review_feedback` | 不可读 | 审核阶段的反馈，调研阶段不接触 |
| `final_output` | 不可读 | 发布阶段的产出，调研阶段不接触 |
| `performance_insights` | 不可读 | 回采分析，调研阶段不接触 |
| 其他 `*` | 只读 | 可读全部已有内容 |

## 工具权限

注意：子 agent 运行在隔离 sandbox 下，pipeline 工具（`pipeline_read`/`pipeline_write_slot`/`pipeline_add_remark`）不可用。
上下文已通过 prompt 直接注入，搜索通过 `web_fetch` 进行。

| 工具 | 用途 | 必选/可选 |
|------|------|----------|
| `web_fetch` | 网络搜索 + 内容抓取（替代 `web_search`） | 必选 |
| `style_read_profile` | 读用户风格 DNA（选题偏好） | 可选 |
| `kb_read` | 读用户画像 + 历史选题 + 领域知识 | 可选 |
| `kb_write` | 记录调研洞察到知识库 | 可选 |
| `group:code` | 代码执行（数据处理） | 可选 |
| `group:read` | 文件读取（本地资料） | 可选 |

## Model 路由

| 条件 | 模型 | 原因 |
|------|------|------|
| 默认 | `bayesdl/qwen3.5-plus` | 性价比均衡，日常对话+搜索够用 |
| 场景=R1（企业/技术） | `bayesdl/step-1x-medium` | 企业/技术场景需要更严谨的推理和事实判断 |
| 深度搜索触发 | `bayesdl/step-1x-medium` | 多轮下钻需要更强的推理 |
| 用户要求快速 | `bayesdl/qwen3.5-plus` | 快，够用 |

## 已安装 Skills（ClawHub）

| Skill | 版本 | 用途 | 对应能力 |
|-------|------|------|---------|
| `multi-search-engine` | 1.x | 17 搜索引擎，支持高级搜索、时间过滤、站点搜索 | 通用 web 搜索 |
| `search-academic` | 1.x | arXiv / Semantic Scholar / Google Scholar 检索 | 论文搜索（技术场景） |
| `lark-wiki` | 1.x | 飞书知识库文档搜索与读取 | 企业 KB 搜索 |
| `lark-drive` | 1.x | 云空间文件搜索与读取 | 企业文件搜索 |
| `lark-minutes` | 1.x | 飞书妙记搜索与内容提取 | 企业会议内容检索 |
| `webfetch` | 1.x | 网页内容提取 | 深度页面读取 |
| `lark-base` | 1.x | 飞书多维表格搜索与读取 | 企业数据查询 |

## 待开发/接入 Skills

| Skill | 优先级 | 用途 | 来源 |
|-------|--------|------|------|
| `connector-internal-kb` | P1 | 企业内部 KB 适配器（非飞书场景） | 自建或 ClawHub |
| `trend-analysis` | P1 | 社交媒体趋势检测：关键词热度、话题生命周期 | ClawHub 或自建 |
| `search-patent` | P2 | 专利检索 | ClawHub |
| `search-news` | P2 | 新闻/媒体搜索（时序敏感场景） | ClawHub |

## Plugins 配置

```json
{
  "topic-researcher": {
    "plugins": [
      "multi-search-engine",
      "search-academic",
      "lark-wiki",
      "lark-drive",
      "lark-minutes",
      "webfetch",
      "lark-base"
    ],
    "mcp_servers": [
      "internal-kb-connector",
      "enterprise-search"
    ],
    "mcp_tools": [
      "kb_semantic_search",
      "doc_compare",
      "entity_lookup"
    ]
  }
}
```

## Security

| 约束 | 说明 |
|------|------|
| 不接触正文 | 不读、不写 `draft_content` 及之后的所有 slot |
| 不执行外部命令 | 搜索只用 skill 接口，不直接执行 shell |
| 不写用户隐私 | knowledge base 中不记录用户身份信息 |
