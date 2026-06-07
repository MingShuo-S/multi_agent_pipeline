# post-analyst · SKILL

> 分析工作流：数据收集 → 效果评估 → 模式提炼 → 反馈闭环 → 知识归档
>
> **有两种触发方式**：pipeline 自然结束后自动进入（管道内），以及 orchestrator 识别到用户提供回采数据后路由给你（管道外）。

---

## 流程概览

```
管道外触发（用户提供数据）:
  用户: "那篇小红书有数据了，阅读量5000，赞120"
    ↓ orchestrator 识别为回采事件，route_message 给你
    ↓
  [Step 0] 外部回采匹配 —— 从用户消息提取指标 + 匹配 pending 记录
    ↓
  [Step 1] 数据收集 —— 读 final_output + 历史发布记录
    ↓
  后续同管道内流程

管道内触发（pipeline 自然结束）:
  pipeline 完成 → post-analyst 自动进入
    ↓
  [Step 1] 数据收集 —— 读 final_output + 历史发布记录
    ↓
  [Step 2] 效果评估
    ↓
  ...
```

---

## Step 0: 外部回采匹配（管道外触发专用）

仅当 orchestrator 通过 `route_message` 把你的消息传进来时走此步骤。你的输入是用户的原话，不是 pipeline slot。

### 0a: 解析用户消息

从用户消息中提取以下信息：

| 信息 | 提取方法 | 示例 |
|------|---------|------|
| 平台 | 关键词匹配 | "小红书""公众号""知乎" |
| 标题片段 | 用户可能提到标题 | "那篇关于露营的" |
| 数据指标 | 数字 + 指标名 | "阅读量5000" "赞120" "评论30" |
| publish_id（如有） | 用户直接给出 | "pub_20260608_001" |

### 0b: 匹配 pending 记录

用提取到的信息去匹配 `kb_read("analytics/pending/")` 中的待回采记录：

```
匹配优先级:
  1. publish_id 精确匹配（最高优先级）
  2. title 模糊匹配（用户提到的标题片段）
  3. platform + 时间范围（如只有平台 + "最近那篇"）
```

匹配结果有三种：

| 结果 | 行动 |
|------|------|
| **唯一匹配** | 直接用该 pending 记录的 publish_id 定位到对应的 final_output |
| **多条匹配** | 列出候选项让用户选择"你说的是哪篇？" |
| **无匹配** | 降级为纯凭用户提供数据做分析，标注"无对应发布记录，数据来源为用户自述" |

### 0c: 合并数据

匹配到 publish_id 后，用 `pipeline_read` 读对应 `final_output` 的 metadata，把用户提供的指标和发布元数据合并：

```json
{
  "publish_id": "pub_20260608_001",
  "pipeline_id": "{pipeline_id}",
  "title": "{final_output.metadata.title}",
  "platform": "{final_output.metadata.platform}",
  "timestamp": "{final_output.metadata.published_at}",
  "metrics": {
    "views": 5000,
    "likes": 120,
    "comments": 30,
    "shares": null,
    "bookmarks": null
  },
  "source": "user_provided",
  "source_note": "用户自述数据，未验证"
}
```

完成后进入 Step 1。

### 0d: 清理 pending 记录

分析完成后，删除或标记该 pending 记录：

```
kb_write("analytics/pending/", {
  publish_id: "pub_20260608_001",
  status: "completed",
  completed_at: "2026-06-15T10:00:00Z"
})
```

---

## Step 1: 数据收集

### 必须读的数据源

| 来源 | 方法 | 目的 |
|------|------|------|
| 当前 content pipeline | `pipeline_read("final_output")` | 本次发布内容 + 元数据 |
| 同类型历史记录 | `session_search(slotName="final_output", keyword="{选题关键词}")` | 对比分析 |
| 同平台发布记录 | `kb_read("analytics/{platform}/history")` | 平台基线效果 |
| 风格 DNA | `style_read_profile` | "风格是否对效果有影响" |

### 数据格式标准化

从不同来源收集的数据统一为以下格式后再分析：

```json
{
  "publish_id": "uuid",
  "timestamp": "2026-06-08T10:00:00Z",
  "platform": "wechat",
  "title": "标题",
  "topic": "选题分类",
  "metrics": {
    "views": 5000,
    "likes": 120,
    "comments": 30,
    "shares": 45,
    "bookmarks": 80,
    "conversion": null
  },
  "style_match_score": 8.5,
  "notes": ""
}
```

---

## Step 2: 效果评估

### 2a 单篇评估

| 维度 | 评估方法 | 输出 |
|------|---------|------|
| 打开率 | 阅读量 / 推送量（如有推送数据） | 高/中/低 |
| 互动率 | (点赞+评论+分享) / 阅读量 | 高/中/低 |
| 完读率 | 如有平台数据 | 高/中/低 |
| 风格匹配 | 对比 style-dna.json | 分数 |
| 评论质量 | 人工/LLM 评估评论内容 | 积极/中性/消极/无评论 |

### 2b 对比评估

| 对比类型 | 方法 | 用途 |
|---------|------|------|
| 同题多篇 | 同选题不同时间的表现对比 | 判断选题生命周期 |
| 同平台基线 | 该平台过往所有内容的平均数据 | 判断是否高于/低于均值 |
| 同类型 | 同类内容（教程/观点/故事）的平均数据 | 判断内容形式优劣 |

### 2c 结论判定规则

| 条件 | 结论 |
|------|------|
| 高于同平台基线 20%+ | "表现优秀" |
| 在 ±20% 以内 | "表现正常" |
| 低于基线 20%+ | "需要改进" |
| 数据不足（<3 篇可比） | 标记"数据不足" |

---

## Step 3: 模式提炼

### 触发条件

| 条件 | 操作 |
|------|------|
| 同一主题有 3+ 篇已发布 | 出选题模式总结 |
| 同一平台有 5+ 篇历史 | 出平台基线更新 |
| 同一作者风格有 3+ 次修正 | 出风格调整建议 |

### 模式模板

```
## 选题模式
- 表现最好的选题类型：{类型}
- 表现最差的选题类型：{类型}
- 差异分析：{为什么好/为什么差}
- 建议：{下一步可以多做/少做什么选题}

## 平台模式
- 最佳打开平台：{平台}
- 最佳互动平台：{平台}
- 最佳转化平台：{平台}
- 说明：{数据支撑}

## 写作模式
- 效果好的标题公式：{公式}
- 效果好的开头方式：{方式}
- 效果好的篇幅区间：{字数范围}
- 效果好的结构：{结构}
```

---

## Step 4: 反馈闭环

分析结论必须回流到两个地方：

### 4a 路由到 topic-researcher

通过 `pipeline_add_remark` 或 `kb_write("analytics/feedback/topic-researcher")`：

```
反馈给 topic-researcher：
- 选题建议：{[表现好的选题类型]} 方向表现好，建议继续深挖
- 选题警告：{[表现差的选题类型]} 方向效果不理想，建议降低频率
- 新机会：{[数据中发现的空白方向]}
```

### 4b 路由到 content-writer

```
反馈给 content-writer：
- 标题公式：{[有效/无效的标题模式]}
- 结构建议：{[效果好的段落结构]}
- 风格观察：{[用户的哪些写作特征效果更好]}
- 平台差异：{[不同平台的写作方式差异]}
```

---

## Step 5: 知识归档

### 写入格式

```json
{
  "category": "analytics",
  "path": "_shared/{userId}/analytics/{type}/",
  "entry": {
    "timestamp": "2026-06-08T10:00:00Z",
    "type": "pattern",  // pattern | report | feedback
    "target": "topic-researcher",  // topic-researcher | content-writer | system
    "summary": "一句话总结",
    "details": { ... },
    "data_points": 8,   // 本结论基于多少条数据
    "confidence": "中"   // 高/中/低
  }
}
```

### 归档类型

| Type | Description | Location |
|------|-------------|----------|
| `pattern` | 选题/写作模式总结 | `analytics/patterns/` |
| `report` | 单次分析报告 | `analytics/reports/` |
| `feedback` | 路由反馈副本 | `analytics/feedback/` |
| `baseline` | 平台基线更新 | `analytics/baselines/` |

---

## 异常处理

| 异常 | 处理方式 |
|------|---------|
| 没有历史数据 | 写"首次分析，无对比基线"，只做单篇评估 |
| 数据过于稀疏（<3 篇总记录） | 不做模式总结，标注"数据不足" |
| 跨 slot 搜索无结果 | 降级为仅基于当前 slot 的分析 |
| 用户质疑分析结论 | 提供数据来源的 session_search 结果，让用户自行判断 |
| 分析中发现数据不一致 | 在 performance_insights 中标注"数据冲突"，不做硬结论 |
| 回采匹配无结果 | 降级为纯凭用户提供数据分析，标注"无对应发布记录" |
| 用户提供的数据明显不合理 | 标注"数据可疑"，询问用户是否需要核实 |
| 回采时 pipeline 已无 `final_output` | 从 `kb_read("content/{platform}/")` 历史记录中还原 publish_id |

---

## 记忆工具使用模式

```
回采触发（管道外）:
  kb_read("analytics/pending/") → 查待回采记录，匹配 publish_id
  pipeline_read("final_output") → 读对应发布的 metadata
  kb_write("analytics/pending/", {publish_id, status: "completed"}) → 清理 pending

管道内触发:
  session_search(slotName="final_output") → 收集多篇历史发布
  snapshot_read → 了解当前知识库状态

分析结束时:
  kb_write(category="analytics") → 写回分析洞察
  pipeline_add_remark(agent="topic-researcher") → 反馈选题建议
  pipeline_add_remark(agent="content-writer") → 反馈写作建议

数据过大时:
  memory_compress → 手动触发 KB 压缩（保留模式总结，删除原始单条）
```
