# publisher · SKILL

> 发布工作流：质量门禁 → 格式适配 → 平台规则检查 → 发布执行 → 历史记录

---

## 流程概览

```
pipeline_read(draft_content + review_feedback)
  ↓
[Step 1] 质量门禁 —— 检查 review_feedback 中 P0 是否清零
  ↓
[Step 2] 平台确认 —— 确认发布平台（从 pipeline slot 或用户对话获取）
  ↓
[Step 3] 规则检查 —— 每个目标平台的最新规则验证
  ↓
[Step 4] 格式适配 —— 按平台规范格式化内容
  ↓
[Step 5] 用户确认 —— 展示最终版，等用户说"发"
  ↓
[Step 6] 发布执行 —— 自动或半自动跨平台发布
  ↓
[Step 7] 历史记录 —— memory_write（旧名 kb_write）写入发布元数据
```

---

## Step 1: 质量门禁

从 `pipeline_read("review_feedback")` 中读取审核结果。

如果 `review_feedback` 中有 P0 级别问题且未修复：
- **阻断发布**
- 通过 `pipeline_add_remark` 通知 quality-reviewer
- 在 `final_output` 中写入 `{ "status": "blocked", "reason": "有未修复的 P0 问题", "p0_items": [...] }`

如果 P0 已清零或 review_feedback 不存在：
- 继续到 Step 2

---

## Step 2: 平台确认

从 `target_audience` slot 或 `session_note_read` 获取目标平台。

| 来源 | 优先级 | 说明 |
|------|--------|------|
| `target_audience` slot | 高 | pipeline 传入的固定信息 |
| 用户对话 | 中 | 用户口头说的发布平台 |
| 上一次 pipeline 的发布记录 | 低 | 历史偏好参考 |

如果目标平台不明确，问用户："这篇发在哪个平台？"
如果多平台，确认主平台和副平台。

---

## Step 3: 规则检查

发布前检查目标平台最新规则。

### 检查项

| 检查项 | 方法 | 阻断/警告 |
|--------|------|----------|
| 字数限制 | `memory_read("platform_rules/{platform}")`（旧名 kb_read）| 超出 → 阻断 |
| 敏感词 | `memory_read("platform_rules/{platform}/sensitive_words")` | 命中 → 阻断 |
| 封面/图片要求 | `memory_read("platform_rules/{platform}/media")` | 缺乏 → 警告 |
| 标题字数 | `memory_read("platform_rules/{platform}/title")` | 超出 → 警告 |
| 链接政策 | `memory_read("platform_rules/{platform}/links")` | 违规 → 阻断 |
| 新规预警 | `multi-search-engine` 搜索平台最新公告 | 重大变化 → 阻断 |

### 规则来源优先级

1. `kb_platform/{platform}/` 知识库（本地维护，最可靠）
2. `multi-search-engine` 搜索最新公告（辅助，标记"需确认"）
3. 用户口头告知（标记"用户自述，未验证"）

规则冲突时以用户告知为准——用户可能已和运营确认过。

---

## Step 4: 格式适配

根据不同平台的规范对内容做仅格式层面的调整。

### 通用规则

- **不改正文文字**：不增加、不删减、不修改原文措辞
- **只做格式转换**：换行策略、段落间隔、标题层级、标签/话题

### 平台适配表

| 平台 | 格式要求 | 适配操作 |
|------|---------|---------|
| 微信公众号 | 1.75 倍行距、14-16px 字号建议、段落间空行 | 正文用空行分节，标题用 ### 层，引用用 > |
| 小红书 | 短段落（2-3 行）、emoji 点缀、#话题标签（文末） | 拆长段为短段，文末加 3-5 个 #标签 |
| 知乎 | 标题层级多、代码块支持、引用规范 | 保留完整 Markdown 结构，优化标题层级 |
| B站专栏 | 中长段落、图文穿插、弹幕互动引导 | 适当合并短段，在文末加互动引导语 |
| 技术博客 | 代码块高亮、流程图、表格 | 确保代码块格式完整，保留技术术语原文 |
| 企业知识库 | 无特殊格式要求、但注意内部术语一致性 | 术语统一，删除平台化表达（"点赞""关注"） |

### 标题适配

| 平台 | 标题限制 | 适配 |
|------|---------|------|
| 微信 | 64 字内 | 可用完整标题 |
| 小红书 | 20 字内 | 提炼核心 + 数字/悬念 |
| 知乎 | 30-50 字内 | 包含关键词 + 结论 |
| B站 | 30 字内 | 抓眼球，含关键词 |
| 技术博客 | 不限，但建议 < 60 字 | 准确描述即可 |

标题适配若大幅改变原意，先问用户。

---

## Step 5: 用户确认

适配完成后，展示最终版本给用户确认：

- 字数对比（原始 vs 适配后）
- 平台规则摘要（这项检查已过，那项有风险）
- 适配说明（为什么调整了这个格式）

等用户说"发"或"可以"后才执行 Step 6。

---

## Step 6: 写入 final_output

发布前，`pipeline_write_slot("final_output")` 必须写入结构化数据，而不是纯文本。这样才能被 post-analyst 回采时匹配到。

### final_output 结构

```json
{
  "content": "{平台适配后的正文}",
  "metadata": {
    "publish_id": "pub_{日期}_{序号}",
    "pipeline_id": "{pipeline_id}",
    "title": "{最终标题}",
    "platform": "{xiaohongshu|wechat|zhihu|...}",
    "published_at": "2026-06-08T10:00:00Z",
    "url": "{发布链接（如有）}",
    "publish_mode": "auto|manual"
  }
}
```

**publish_id 生成规则**：`pub_YYYYMMDD_NNN`（日期+当日序号，如 `pub_20260608_001`）。

### 发布执行

### 自动发布

根据目标平台选择对应的发布 Skill：

| 平台 | Skill | 说明 |
|------|-------|------|
| 小红书 | `xiaohongshu-mcp` | Go MCP Server（headless），`python xhs_client.py publish` 发帖 |
| 微信公众号 / 百家号 | `social-media-publish` | 通用浏览器自动化发布 |
| 其他 | `social-media-publish` | 未列出的平台先用通用方案 |

```json
// 小红书发布（通过 xiaohongshu-mcp MCP Server）
{
  "skill": "xiaohongshu-mcp",
  "action": "publish",
  "title": "{标题}",
  "content": "{正文}",
  "images": "{图片URL,逗号分隔}",
  "tags": "{标签,逗号分隔}",
  "command": "python {skill_dir}/scripts/xhs_client.py publish \"{title}\" \"{content}\" \"{images}\""
}
```

### 半自动发布

如果是手动发布场景（用户亲自发），输出适配后的内容，附上操作指南：
- 每个平台的排版建议
- 需要用户手动添加的图片/封面
- 发布后回复指引

### 多平台发布策略

| 场景 | 策略 |
|------|------|
| 主平台 + 1 个副平台 | 主平台全文，副平台精华摘要 + 原文链接 |
| 全平台同步 | 统一正文 + 各平台独有标签/标题 |
| 首+分发 | 主平台先发，3-7 天后分发到副平台 |

---

## Step 7: 历史记录 + 待回采标记

发布完成后，做两件事：

### 7a: 归档发布记录

`memory_write` 写入永久发布记录。

```json
{
  "category": "publish_history",
  "path": "_profiles/{userId}/content/{platform}/",
  "entry": {
    "publish_id": "pub_20260608_001",
    "timestamp": "2026-06-08T10:00:00Z",
    "platform": "wechat",
    "title": "标题",
    "url": "https://...",
    "status": "published",
    "publish_mode": "auto/manual",
    "notes": "第一次发布到该平台，未使用定时发送"
  }
}
```

### 7b: 写待回采记录

额外写一条到 `_profiles/{userId}/analytics/pending/`，告诉 post-analyst 这篇内容在等数据。

```json
{
  "category": "pending_analytics",
  "path": "_profiles/{userId}/analytics/pending/",
  "entry": {
    "publish_id": "pub_20260608_001",
    "pipeline_id": "{pipeline_id}",
    "title": "标题",
    "platform": "xiaohongshu",
    "created_at": "2026-06-08T10:00:00Z",
    "status": "awaiting_data"
  }
}
```

post-analyst 收到用户回采数据后，用 `publish_id` 或 `title + platform` 匹配到这条记录，然后产出分析。分析完成后会删除或标记该 pending 记录。

### 必须记录的字段

| 字段 | 说明 |
|------|------|
| `publish_id` | 发布唯一 ID（post-analyst 回采时匹配用） |
| `timestamp` | 发布时间（UTC） |
| `platform` | 目标平台 |
| `title` | 最终发布标题 |
| `url` | 发布后的链接（如有） |
| `status` | published / scheduled / failed |
| `publish_mode` | auto / manual |

---

## 异常处理

| 异常 | 处理方式 |
|------|---------|
| 平台规则检查发现敏感词 | 在 `final_output` 中标注敏感词位置，问用户是否改为同义替换 |
| 平台字数超过限制 | 提供 2-3 种删减方案让用户选择 |
| `social-media-publish` 自动发布失败 | 降级为半自动模式：输出适配后内容 + 手动发布指南 |
| 用户不确定平台 | 提供常见平台列表让用户选择，并给出各平台差异化建议 |
| 发布后链接获取失败 | 记录 status 为 published（无链接），提示用户手动补充 |
