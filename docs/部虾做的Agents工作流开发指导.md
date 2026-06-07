# 部虾做的 Agents 工作流开发指导

> 基于 Feishu 部虾创 Agents 原始设计，适配到 multi_agent_pipeline 接力架构。
> 最后更新: 2026-06-04

---

## 目录

1. [架构概述](#1-架构概述)
2. [Agent 总览](#2-agent-总览)
3. [Agent 详设](#3-agent-详设)
   - [topic-researcher](#31-topic-researcher--选题调研专家)
   - [content-writer](#32-content-writer--写作专家)
   - [quality-reviewer](#33-quality-reviewer--审核专家)
   - [publisher](#34-publisher--发布专家)
   - [post-analyst](#35-post-analyst--回采分析专家)
4. [Pipeline 模板格式](#4-pipeline-模板格式)
5. [Slot 系统](#5-slot-系统)
6. [风格 DNA / Voiceprint](#6-风格-dna--voiceprint)
7. [设计变更：原版 → 适配版](#7-设计变更原版--适配版)
8. [新增 Agent 模板](#8-新增-agent-模板)
9. [人在回路：两种用户的使用场景](#9-人在回路两种用户的使用场景)

---

## 1. 架构概述

### 1.1 为什么用接力（relay）而不是独立 Agent

原始设计把每个 Agent 当作独立运行单元——各有自己的 template.json + 完整工作流 + LLM 配置 + 多模式路由。

但实际运行中暴露了问题：

| 问题 | 原版 | 适配版 |
|------|------|--------|
| Agent 自己决定"模式"（generate/rewrite/learn） | 每个 Agent 内部做路由判断 | orchestrator 负责调度，Agent 只做一件事 |
| 风格规则靠 Agent 自觉遵守 | Agent 自己读 USER.md | 固定写入 system prompt（硬约束） |
| `input_slots`/`output_slots` 在 Agent 模板定义 | 每个 Agent 自行声明 | pipeline 统一管理 slots |
| `execute_command` 给 Agent shell 权限 | 有安全风险 | 删掉，发布走 slot 输出 |
| Agent 可以绕过管道直接执行 | 独立模板 | 所有交互经 pipeline_continue |

**适配方案：接力管道**。一个模板定义 5 个 stage，每个 stage 引用一个 Agent。Agent 只读写 slot、不决定流程、不管理模式。

### 1.2 人在回路：实际数据流

Pipeline 不是直流水线——**每个 stage 都是人与 Agent 的对话回合**，用户全程坐在驾驶位上。

```
orchestrator
  │
  ├─ voiceprint (新用户) → 10 步风格冷启动
  │
  └─ pipeline_start → pipeline_continue →
       │
       ├─ Stage 1: topic-researcher
       │   用户 ↔ agent 对话确定选题 → agent 联网调研 → 用户确认方向
       │
       ├─ Stage 2: content-writer  ← ★ 核心迭代区
       │   ┌──────────────────────────────────────────────────┐
       │   │ agent 写初稿 → 用户反馈 → agent 改 → 用户再反馈 →│
       │   │ → agent 再改 → 用户满意 → 进入下一 stage         │
       │   │                                                  │
       │   │ 每次用户反馈:                                     │
       │   │   - style_extract_signal → 记风格偏好             │
       │   │   - kb_write → 记用户洞察                        │
       │   │   - 如果用户说"数据不对" → add_remark(调研不足)    │
       │   │     → topic-researcher 重调研 → update research   │
       │   │     → content-writer 整合修正                    │
       │   └──────────────────────────────────────────────────┘
       │
       ├─ Stage 3: quality-reviewer
       │   agent 出审核报告 → 用户确认 or 打回修改
       │
       ├─ Stage 4: publisher
       │   agent 出标题+标签 → 用户手动复制发布（不做自动发布）
       │
       └─ Stage 5: post-analyst (可选)
           用户提供数据 → agent 分析 → kb_write 记效果
```

**核心原则：人负责思想（选题方向、风格判断、数据真实性），AI 负责效率（初稿、调研、格式优化、重复修改）。**

### 1.3 人在回路的 3 层迭代

| 迭代层 | 发生在 | 用户做什么 | 系统学到什么 |
|--------|--------|-----------|------------|
| L1 写作修改 | content-writer stage | "这段太啰嗦""换个开头""语气不对" | 风格偏好（句长/词汇/语气）、禁用词 |
| L2 事实回查 | 跨 stage（content-writer → topic-researcher → content-writer） | "这个数据你核实了吗？我记得不对" | 用户知识领域、信息核实偏好 |
| L3 审核修改 | quality-reviewer stage | "这条规则我不 care，删掉""这个 P0 改好了" | 用户对平台规则的态度、风险偏好 |

每一轮修正都是学习机会——不是把用户当质检员，而是把每次反馈转化为结构化知识。

### 1.4 知识积累机制

每次迭代产生的数据不丢：

```
用户反馈
  ├→ style_extract_signal → 风格 DNA 更新（下次写作自动生效）
  ├→ kb_write → 知识库（用户画像、领域事实、写作洞察）
  └→ pipeline_add_remark → 工程日志（供调试和复盘）
```

积累到一定量后，系统可以做：
- **风格 drift 检测**：用户最近 10 次的偏好跟之前不一样了？
- **自动摘要**：从 kb 提取"用户最近关心什么话题"
- **质量控制**：哪个 agent 被用户打回的次数最多

### 1.5 Tool 权限矩阵

每个 Agent 可用的工具按角色控制：

| Agent | pipeline 工具 | 风格工具 | 知识库工具 |
|-------|--------------|---------|-----------|
| orchestrator | start/continue/status/read/write_slot/add_remark | voiceprint_全系列, style_read_profile | kb_read/write |
| topic-researcher | read, write_slot | style_read_profile | kb_read/write |
| content-writer | read, write_slot | style_read/get_context/write_profile, style_extract_signal | kb_read/write |
| quality-reviewer | read, write_slot, add_remark | style_read_profile | kb_read/write |
| publisher | read, write_slot | style_read_profile | kb_read/write |
| post-analyst | read, write_slot | style_read_profile | kb_read/write |

---

## 2. Agent 总览

| Agent | 管道角色 | 上游输入 | 下游输出 | 核心职责 |
|-------|---------|---------|---------|---------|
| topic-researcher | 选题调研 | 用户需求 + 风格 DNA | topic_brief + research_notes | 对话出题 + 联网调研（合并）|
| content-writer | 写作 | topic_brief + research_notes | draft_content | 模仿用户风格生成正文 |
| quality-reviewer | 审核 | draft_content + research_notes | review_feedback | 事实核查 + 撞车检测 + 规则校验 |
| publisher | 发布 | draft_content + review_feedback | final_output | 标题优化 + 标签 + 平台格式化 |
| post-analyst | 回采 | final_output | performance_insights | 发布后效果跟踪 + 策略洞察 |

---

## 3. Agent 详设

### 3.1 topic-researcher — 选题调研专家

选题+调研合并为一个 Agent。原始飞书设计的选题Agent 本就自己负责调研，拆分是过度设计。

#### 身份

用户的选题调研专家。一次对话搞定选题锁定 + 事实验证。

#### 工作流

| 阶段 | 动作 | 说明 |
|------|------|------|
| 选题 | `style_read_profile` | 获取风格偏好和历史选题 |
| 选题 | 对话出题 | 自动分类用户背景，引导确定选题方向 |
| 调研 | 联网搜索验证 | 收集路线、价格、数据等具体信息 |
| 产出 | `pipeline_write_slot("topic_brief")` | 写选题简报 |
| 产出 | `pipeline_write_slot("research_notes")` | 写调研笔记 |

选题和调研在同一次对话中完成——不需要拆成两轮。

#### 输出格式

```markdown
## 选题简报

### 标题
{一句话标题}

### 目标受众
{身份标签，如：南京大学大一新生/职场 3 年数据分析师}

### 核心信息
- 核心观点：{一句话}
- 目标平台：{小红书/公众号/博客}
- 预期长度：{字数范围}

### 用户画像快照
- 当前身份：{学生/职场/创业/自由职业}
- 经验等级：{新手/进阶/专家}
- 平台调性：{平台名→语气/字数/emoji 策略}
- 写作目的：{涨粉/变现/记录/科普}

### 参考来源
- {用户提供的参考链接或想法来源}
```

```markdown
## 调研笔记

### 验证结论
- {关键词} → {来源} → {结论} → {置信度: 高/中/低}

### 数据汇总
| 项目 | 数据 | 来源 |
|------|------|------|
| ... | ... | ... |

### 注意事项
- {不确定或需要用户确认的信息}
```

#### 工具权限

| 工具 | 用途 |
|------|------|
| `pipeline_read` | 读已有内容（恢复）|
| `pipeline_write_slot` | 写 topic_brief + research_notes |
| `style_read_profile` | 读用户风格 DNA |
| `kb_read` | 读用户画像 + 历史选题 |
| `kb_write` | 记录本次选题/调研洞察 |

---

### 3.2 content-writer — 写作专家

#### 身份

用户的写作分身。不是通用写作助手，是**能用用户的声音说话的人**。

#### 三模式原始设计（飞书文档原文）

原始飞书文档的写作Agent 定义了三种模式，由 Agent 内部自行路由判断：

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| **创作模式** | 默认——有选题+调研数据 | 从零生成正文。读 topic_brief + research_notes，按平台调性写 |
| **改写模式** | 用户直接贴一段文字说"帮我改改" | 不经过选题调研阶段，直接改写用户原文。读用户文本 + 风格 DNA |
| **学习模式** | 用户贴 3-5 篇样本 | 分析句长、标点、emoji、高频词，输出风格档案到 `.styles/{userId}/` |

原始设计的问题：Agent 自己判断"现在是哪种模式"→ 路由逻辑冗杂、风格学习和写作混在一起、改写场景和创作场景共用同一 session。

#### 适配：单模式

| 原始模式 | 适配方案 |
|---------|---------|
| 创作模式 | **保留为唯一模式**——content-writer 只做"读槽位 → 写正文" |
| 改写模式 | 不再由 content-writer 处理。用户需要改写时，orchestrator 启动一个不同的 pipeline 或直接用 `pipeline_start` 传自定义消息 |
| 学习模式 | 交由 Voiceprint 流程覆盖——orchestrator 做 10 步 onboarding，content-writer 只做第 9 步的分析（`route_message` 路由给它分析样本） |

**content-writer 不再自己判断"哪种模式"——每次进来都是写新草稿。**

#### 工作流：写 → 改 → 改 → 改 → 过

content-writer 不是"写一次就完"。它是一个迭代循环：

```
进入 stage
  ↓
读 topic_brief + research_notes + 风格 DNA
  ↓
写初稿 → pipeline_write_slot("draft_content")
  ↓
用户看稿
  ├→ "不错，过了" → advance 到下一 stage
  ├→ "这里改一下" → pipeline_continue(message=反馈)
  │    → 分析反馈中的修正信号
  │    → style_extract_signal 记录偏好
  │    → kb_write 记录洞察（如果发现新的用户事实）
  │    → 重写 → pipeline_write_slot("draft_content")
  │    → 等用户下一轮反馈
  │
  └→ "这个数据你核实过吗？" → cross-stage 回查
       → pipeline_add_remark("topic-researcher", "请核实：{具体数据}")
       → orchestrator 看到 remark → 调 topic-researcher 重调研
       → topic-researcher 更新 research_notes
       → content-writer 拿到新数据 → 修改正文
       → 继续迭代
```

#### 迭代中的知识积累

| 用户反馈类型 | 你做什么 | 数据写到哪里 | 谁受益 |
|-------------|---------|-------------|--------|
| "语气不对，我要更专业的" | `style_extract_signal` | 风格 DNA（tone 字段） | 下次写作 |
| "这个词别用，我用另一种说法" | `kb_write`（用户词汇偏好） | 知识库 | 全部 agent |
| "这段逻辑有问题" | `kb_write`（用户思维习惯） | 知识库 | 下次选题 |
| "这个排版太难看了" | `style_extract_signal` | 风格 DNA | 下次写作 |

**每轮修改都在积累用户的思维模型。** 不是用完即弃的草稿，最终产出是 draft_content + 更新后的知识库。

#### 风格变通机制

InjectionLayer 注入的风格是**硬规则，但可以打破**。规则：

1. 如果用户在当前对话中明确说"今天换个风格" → 以当前对话指令为准
2. 写作后发现用户不满意 → `style_extract_signal` 记录修正信号
3. 同一规则被打破 2 次以上 → InjectionLayer 自动降低该规则权重

#### 输出格式（draft_content）

```markdown
## 正文

{完整正文，按目标平台格式排版}

---

## 写作说明
- 风格 DNA 版本：{v1.2}
- 迭代次数：{3}
- 本次遵循的核心规则：{...}
- 本轮修改记录：
  - 用户要求缩短第二段 → 已执行
  - 用户说不要用"首先其次" → 已记入禁止模式
  - 用户要求核实某数据 → 已通过 topic-researcher 重调研
```

#### 原始设计变更

| 原始 Feishu 设计 | 适配变更 |
|------------------|---------|
| 三模式路由 | 单模式（创作），路由由 orchestrator 管理 |
| 从 USER.md 学风格 | InjectionLayer 从 style-dna.json 硬注入 |
| 从样本文件读风格档案 | `style_get_context` 工具读取 |
| `pipeline_read_slot` | `pipeline_read`（匹配当前注册名） |
| 写 `execute_command` 执行 publish | 删掉 |

---

### 3.3 quality-reviewer — 审核专家

#### 身份

用户的内容质检员。确保文案无误、不违规、不撞车。

#### 工作流

| 步骤 | 动作 | 说明 |
|------|------|------|
| 1 | `pipeline_read("draft_content")` | 读正文 |
| 2 | `pipeline_read("research_notes")` | 读参考资料（用于事实核查） |
| 3 | `style_read_profile` | 读风格 DNA（确认合规） |
| 4 | 执行四类检查 | 见下 |
| 5 | `pipeline_write_slot("review_feedback")` | 输出审核报告 |
| 6 | （可选）`pipeline_add_remark` | 微小建议不阻塞流程 |

#### 四类检查

| 检查项 | 检测内容 | 判定标准 | 严重度 |
|--------|---------|---------|--------|
| 事实核查 | 调研数据是否被正确引用 | 对比 research_notes | P0（阻断） |
| 撞车检测 | 内容是否与近期平台热文相似 | 搜索相似标题/论点 | P1（警告） |
| 平台规则 | 是否含敏感词/违反规定 | 模板中的 `sensitive_words` | P0（阻断） |
| 写作质量 | 字数、结构、逻辑流 | 风格 DNA + 通用标准 | P2（建议） |

#### 输出格式（review_feedback）

```markdown
## 审核报告

### 结果：{通过/有条件通过/不通过}

### 各维度评分
| 维度 | 得分 | 说明 |
|------|------|------|
| 事实准确性 | 8/10 | {...} |
| 原创性 | 7/10 | {...} |
| 平台合规 | 10/10 | ✓ |
| 写作质量 | 9/10 | {...} |

### 需要修改
1. **[P0]** {必须修改的内容} → {建议修改方案}
2. **[P1]** {建议修改的内容}

### 微小建议
{一系列 pipeline_add_remark 条目，每条约 1 行}
```

#### 撞车检测工作流

```
quality-reviewer:
  1. 从 draft_content 中提取前 3 句
  2. 用搜索引擎搜索相似内容（可选，不强制要求工具）
  3. 如果发现高度相似的已发布内容:
     → P1 警告 + 建议改写方向
  4. 如果搜索工具不可用:
     → 跳过撞车检测，报告"搜索工具不可用，未做撞车检测"
```

#### 原始设计变更

| 原始 Feishu 设计 | 适配变更 |
|------------------|---------|
| 审核 Agent 自行决定"是否通过" | 保留，决策权在 reviewer |
| 抄袭检测依赖搜索引擎 | 可选（search 工具可用则用，不可用则跳过） |
| `input_slots: [draft, research]` | pipeline 统一管理读权限 |
| 输出为纯文本 | 结构化审核报告 + add_remark |

---

### 3.4 publisher — 发布专家

#### 身份

用户的发布排版助手。把审核通过的文案优化为发布就绪格式。

#### 工作流

| 步骤 | 动作 | 说明 |
|------|------|------|
| 1 | `pipeline_read("draft_content")` | 读正文 |
| 2 | `pipeline_read("review_feedback")` | 读审核意见，确认 P0 已修复 |
| 3 | 标题优化 | 生成 7 个标题变体 → 选 3 个最优 → 写入 |
| 4 | 标签生成 | 基于内容生成 5-10 个标签 |
| 5 | 平台格式化 | 按平台规则调整格式 |
| 6 | `pipeline_write_slot("final_output")` | 写入发布版 |

#### 标题优化策略

| 步骤 | 动作 |
|------|------|
| 1 | 从正文提取关键词 + 核心观点 |
| 2 | 生成 7 个标题变体（数字式、悬念式、对比式、直给式、故事式、提问式、反常识式）|
| 3 | 用风格 DNA 过滤风格不匹配的标题 |
| 4 | 保留 3 个最优标题 |
| 5 | 如果用户偏好的平台是小标题式（小红书等），标记主标题和副标题 |

#### 输出格式（final_output）

```markdown
## 发布就绪版

### 标题选项
1. {标题 A}（推荐）
2. {标题 B}
3. {标题 C}

### 正文
{格式化后的正文}

### 标签
#{标签1} #{标签2} #{标签3} ...

---

## 发布检查清单
- [ ] AI 标注：{需要/不需要}
- [ ] 平台限制词检查：{通过/有警告}
- [ ] 已按 {平台} 格式调整
```

#### 原始设计变更

| 原始 Feishu 设计 | 适配变更 |
|------------------|---------|
| 有预览环节（用户确认后再发） | 后移。预览在当前版本由 orchestrator 展示 final_output |
| 调用 `execute_command` 跑 publish 脚本 | **删掉**。publisher 不执行任何外部命令 |
| 发布后将结果写回 Agent 记忆 | 发布结果记录到 kb_write（可选） |

---

### 3.5 post-analyst — 回采分析专家

#### 身份

发布后的效果分析师。不是自动爬虫——数据由用户提供或基于知识库已有记录。

#### 定位

回采不是默认流程。post-analyst 默认不启动——当用户说"看看效果""这篇怎么样"时，orchestrator 将 pipeline advance 到回采 stage。

#### 工作流

| 步骤 | 动作 | 说明 |
|------|------|------|
| 1 | `pipeline_read("final_output")` | 获取已发布内容 |
| 2 | `kb_read` | 查看知识库中是否有该内容的互动数据 |
| 3 | 对话收集数据 | 引导用户提供点赞/收藏/评论/阅读量 |
| 4 | 对比分析 | 对比同领域平均水平 |
| 5 | `pipeline_write_slot("performance_insights")` | 写入效果报告 |
| 6 | `kb_write` | 记录洞察到知识库（供下次创作参考） |

#### 输出格式（performance_insights）

```markdown
## 效果分析报告

### 数据摘要
- 阅读量：{值}（领域平均：{值}）
- 点赞：{值}（领域平均：{值}）
- 收藏：{值}
- 评论：{值}

### 效果判断
{超预期 / 正常 / 低于预期}

### 可复制的策略
- 标题模式：{...}
- 内容结构：{...}
- 标签策略：{...}

### 改进建议
下次可以尝试：{...}

### 知识库更新
- 已记录到 kb_write
```

#### 约束

| 约束 | 说明 |
|------|------|
| 不主动爬取 | 数据由用户提供或 kb 已有 |
| 不做猜测定性 | 只基于用户提供的数据分析 |
| 不是默认流程 | 需要用户主动触发 |

---

## 4. Pipeline 模板格式

```jsonc
{
  "name": "模板名",
  "description": "描述",
  "mode": "relay",
  "author_label": "版权标注",
  "stages": [
    {
      "id": "topic-research",          // 阶段 ID
      "agent": "topic-researcher",     // 对应 OpenClaw Agent ID
      "checkpoint": true,              // 是否允许中断恢复
      "allow_read": ["*"],             // 可读的 slot 列表
      "allow_write": ["topic_brief", "research_notes"],  // 可写的 slot 列表
      "description": "描述"
    }
  ],
  "slots": {
    "topic_brief": { "type": "text", "default": "" },
    "research_notes": { "type": "text", "default": "" },
    "draft_content": { "type": "text", "default": "" },
    "review_feedback": { "type": "text", "default": "" },
    "final_output": { "type": "text", "default": "" }
  },
  "platforms": [
    {
      "platform": "xiaohongshu",
      "ai_label_required": true,
      "forbidden_automation": true,
      "sensitive_words": ["最", "第一"],
      "content_rules": "必须标注AI辅助创作"
    }
  ]
}
```

### 重要约束

| 字段 | 可出现在哪里 |
|------|-------------|
| `stages` | pipeline template 内 |
| `slots` | pipeline template 内 |
| `version`、`id`、`agent_type`、`llm`、`tools`、`input_slots`、`output_slots` | **不能出现在 template 中**——这些字段属于原始 OpenClaw Agent 配置，不属于 pipeline template schema |

---

## 5. Slot 系统

### 5.1 当前 slot

| Slot | 写入者 | 读取者 | 格式 |
|------|--------|--------|------|
| topic_brief | topic-researcher | content-writer | text |
| research_notes | topic-researcher | content-writer, quality-reviewer | text |
| draft_content | content-writer | quality-reviewer, publisher | text |
| review_feedback | quality-reviewer | publisher | text |
| final_output | publisher | post-analyst, orchestrator（展示给用户） | text |
| performance_insights | post-analyst | orchestrator（展示给用户） | text |

### 5.2 设计原则

1. **单向传递**：信息只向前流，不允许往回写
2. **版本化**：每次写入生成新版本（v1, v2, v3...），`slot_history` 可回溯
3. **checkpoint 恢复**：`checkpoint: true` 的 stage，中断后可重新进入
4. **最小权限**：每个 Agent 只读它需要的 slot，不暴露全部

---

## 6. 风格 DNA / Voiceprint

### 6.1 Voiceprint vs 原始设计的风格学习

| 维度 | 原始 Feishu 设计 | 当前 Voiceprint |
|------|-----------------|----------------|
| 收集方式 | content-writer 自己做 10 步 onboarding | orchestrator 做 10 步，content-writer 只做步骤 9 的分析 |
| 样本数量 | 5 种情绪基调各 1 篇 | 3-5 篇不限情绪 |
| 校准方式 | 问句长/emoji/语气 | `voiceprint_calibrate` 工具 |
| 分析者 | content-writer | content-writer（orchestrator 路由给它）|
| 输出存储 | `.styles/{userId}/` 目录 | `style-dna.json` |
| 注入方式 | 读 USER.md | InjectionLayer 硬注入 |
| 修正 | agent 自觉调 | `style_extract_signal` 工具 |

### 6.2 Voiceprint 的 10 步流程速查

| Step | 谁做 | 工具 | 说明 |
|------|------|------|------|
| 0 | orchestrator | `voiceprint_init` | 检查是否已有/断连恢复 |
| 1-4 | orchestrator + 用户 | `voiceprint_proceed` | 收集写作样本 |
| 5 | orchestrator | `voiceprint_proceed`(done) | 样本收集完成 |
| 7 | orchestrator + 用户 | `voiceprint_calibrate` | 偏好校准 |
| 8 | orchestrator + 用户 | `voiceprint_calibrate` | 禁用语选择 |
| 9 | orchestrator → content-writer | `route_message` → `voiceprint_analyze` | 分析样本 |
| 10 | orchestrator + 用户 | `voiceprint_confirm` | 确认/修正 |

### 6.3 偏离原始设计的说明

原始设计把 10 步 onboarding 放在 content-writer 内部（路径 A：引导式写入/路径 B：贴文章），但这样做的问题是：

1. content-writer 在做风格学习时无法同时写作——同一个 Agent 在同一个 session 里没法既当老师又当学生
2. 风格学习是一次性活动，不应该占用 content-writer 的 "创作 session"

适配方案：**orchestrator 主持 onboarding，content-writer 只做第 9 步的分析**。这条链路已经在 Voiceprint 工作流中实现。详细参见 `src/agent-guide-templates/voiceprint-guide.md`。

---

## 7. 设计变更：原版 → 适配版

### 7.1 Agent 映射

| 原始 Feishu Agent | pipeline Agent | 变更类型 |
|-------------------|---------------|---------|
| 选题Agent（含调研） | topic-researcher | **合并回归**——选题+调研不分家，一次完成 |
| 写作Agent | content-writer | 重构——三模式→单模式，风格注入改用 InjectionLayer |
| 审核Agent | quality-reviewer | 强化——加结构化报告 + 撞车检测工作流 |
| 发布Agent | publisher | 简化——去 execute_command，去预览环节 |
| 回采Agent | post-analyst | **新增**——发布后效果分析 |

### 7.2 模板格式变更

| 原始 template.json | 当前 template.json |
|-------------------|-------------------|
| `version`, `id`, `agent_type` | **删掉**——不属于 pipeline schema |
| `llm`, `tools` | **删掉**——由 OpenClaw 配置管理 |
| `input_slots: []`, `output_slots: []` | **删掉**——替换为 `slots: {}` |
| `agents: [{id, description, memory}]` | **删掉**——信息冗余 |
| `stages: [{name, agent, read_slots, write_slot}]` | `stages: [{id, agent, allow_read, allow_write, checkpoint}]` |
| `flow: {type, default, advance_keywords}` | `mode: "relay"` |
| `slots: {slotName: {type, default}}` | **保留**，格式一致 |

### 7.3 工具名变更

| 原始文档 | 实际名称 |
|---------|---------|
| `pipeline_read_slot` | `pipeline_read` |
| `pipeline_write_slot` | `pipeline_write_slot`（未变） |
| `multi_search_engine` | 不适配（需要额外安装 skill）|
| `execute_command` | **已删除** |

### 7.4 架构思维变更

| 维度 | 原始设计 | 适配设计 |
|------|---------|---------|
| Agent 运行单元 | 独立 OpenClaw Agent，各有 template.json | pipeline 中的 stage |
| 流程控制 | Agent 自己决定路由 | orchestrator + pipeline 调度 |
| 风格学习 | content-writer 内部 10 步 | orchestrator 主持 + Voiceprint 工具链 |
| 输出提交 | Agent 直接返回 | 写 slot → orchestrator 展示 |
| 工具权限 | 每个 Agent 可以声明任意工具 | 按角色固定分配 |

---

## 8. 新增 Agent 模板

如果想在现有 pipeline 中增加 Agent（如回采Agent），按以下步骤：

### 8.1 在 deploy.sh 中注册

```bash
# 1. 在 AGENTS=() 数组末尾加新 agent 名称
AGENTS=("orchestrator" "topic-researcher" "content-writer" "quality-reviewer" "publisher" "post-analyst" "新Agent名")

# 2. 写入 SOUL.md
cat > "${AGENT_WORKSPACE_ROOT}/新Agent名/SOUL.md" << 'EOF'
你是 xxx，职责是 ...
参考: workspace/agent-guides/shared-agent-guide.md
EOF

# 3. 在 agents.list 中注册
SUB_AGENTS = ["topic-researcher","content-writer","quality-reviewer","publisher","post-analyst","新Agent名"]
```

### 8.2 在 template 中添加 stage

```json
{
  "stages": [
    ...现有 stage,
    {
      "id": "新stage-id",
      "agent": "新Agent名",
      "checkpoint": false,
      "allow_read": ["上游_slot"],
      "allow_write": ["新_slot"],
      "description": "..."
    }
  ],
  "slots": {
    ...现有 slots,
    "新_slot": { "type": "text", "default": "" }
  }
}
```

### 8.3 添加 Agent guide

在 `src/agent-guide-templates/` 下新建 `新Agent名-guide.md`，遵循 `shared-agent-guide.md` 的格式。

---

## 9. 人在回路：两种用户的使用场景

### 9.1 小红书运营者

人设：有现成内容风格，每天要出 2-3 篇，追求效率，但有自己的判断标准。

**第1次使用（完整接力 + 多轮修改）：**

```
1. voiceprint 路径 B——贴 3 篇历史爆文让系统学风格
   用户粘贴文章 → system 分析句长/emoji/结构
   → calibration 确认："你偏好短句+每段3行，对吗？"
   → 用户："对，但有时候也会写长段落，别限制太死"
   → system 记"长段落为可选规则，非硬约束"
   → 5 分钟完成风格 DNA

2. "帮我写一篇 XX 防晒霜的使用报告"
   → topic-researcher 问：目标读者？主要卖点？竞品？
   → 用户回几句 → topic-researcher 出选题 + 联网搜产品数据
   → content-writer 出初稿
   
3. 用户看稿 → 修改循环开始：
   用户："开头太长了，小红书前三行要抓眼球"
   → content-writer 改开头 → 写 slot
   用户："还行，但第二段那个成分介绍太硬，改成体验描述"
   → content-writer 改 → style_extract_signal("用户偏好体验式描述，非成分党")
   用户："对了你写的那个"防晒指数 SPF50+" 我查了下这个产品是 SPF30"
   → pipeline_add_remark("topic-researcher", "核实 SPF 指数")
   → topic-researcher 重新搜索 → 确认 SPF30
   → kb_write("用户熟悉护肤产品成分，不要编数据")
   → content-writer 修正
   用户："好，这篇过了"

4. quality-reviewer 出审核报告
   → 查敏感词："第一"（违规）
   → 用户："这个我有依据，小红书管得不严，跳过"
   → advance
```

**日常使用（第5次以后）：**
```
用户："还是防晒，这次写物理防晒 vs 化学防晒"
→ 已有风格 DNA → pipeline_start
→ topic-researcher 简要对话 → 出题+调研（复用上次的品类知识）
→ content-writer 出稿
→ 用户改一次标题 → 过

整个过程 15 分钟，用户实际修改 1 次。
```

**这个人学到了什么：**
- kb 积累：用户是做护肤品类的内容创作者，懂成分
- 风格 DNA：偏好体验式描述 > 成分说明，对平台规则有选择性地遵守
- 修正习惯：用户会核实产品数据 → 说明她对内容准确性要求高

### 9.2 技术大牛但不会写

人设：有深厚技术积累，写出来的东西像论文，没人看。需要反复打磨才能产出可读内容。

**第1次使用（voiceprint A + 深度迭代）：**

```
1. voiceprint 路径 A——引导式写作
   Step 1: "写一段你最近做的技术项目"
   → 用户写了 300 字的技术介绍，全是术语
   Step 2: "用聊天口吻跟朋友解释"
   → 用户写得还是僵硬
   Step 3: calibration → 句长平均 45 字，无 emoji，大量术语
   → 风格 DNA：技术背景，句长偏长，需优化可读性

2. "我想写一篇 DeepSeek MoE 架构的科普"
   → topic-researcher 进入深度对话：
     agent: "目标读者是谁？"
     user: "想给产品经理看，但他们不懂技术"
     agent: "那核心想传达什么？"
     user: "MoE 为什么比其他架构省算力，但又够强"
     agent: "有没有比喻方向可以用？"
     user: "...没想过，你帮我想"
     → topic-researcher 建议"用公司部门分工比喻 MoE"
     → 用户："这个好！"
   → topic-researcher 联网搜 DeepSeek 最新论文数据
   → 出 topic_brief："用公司部门比喻 MoE"

3. content-writer 初稿 → 进入[写→改→写→改] 循环：
   第1轮：agent 出稿 → 用户 "还行，但还是太技术了，把数学公式去掉"
   第2轮：agent 改 → 用户 "好多了，但开头太平淡"
   第3轮：agent 改 → 用户 "这个比喻不太对，MoE 的 router 不是 CEO"
          → style_extract_signal("用户对技术比喻的准确性很敏感")
          → agent 换比喻 → 用户 "对了"
   第4轮：用户 "等一下，你说 MoE 有 7 个 expert，但我记得 DeepSeek 论文里是 8 个"
          → pipeline_add_remark("topic-researcher", "核实 MoE expert 数量")
          → topic-researcher 重查论文 → 确认是 8 个
          → kb_write("用户对技术细节的记忆力好，不要编数据")
          → content-writer 修正
   第5轮：用户 "可以了，发吧"
          → 总共 5 轮修改，耗时 45 分钟

4. quality-reviewer → 事实核查全通过（因为已核实）
   publisher → 生成标签 #DeepSeek #MoE #AI科普
```

**回采（1周后）：**
```
用户："那篇 MoE 文反响不错，但有人评论说 expert 数量写错了"
→ post-analyst stage：
  agent: "数据是多少？"
  用户: "评论说 DeepSeek V2 是 8 个，V3 是 12 个"
  agent: "已核实，V3 确实是 12 个，V2 是 8 个。文章写的是 V2 版本"
  → 用户确认
  → kb_write("用户的技术文章需要标注版本号，避免版本混淆")
```

**这个人学到了什么：**
- kb 积累：用户是 AI 工程师，熟悉模型架构细节
- 风格 DNA：对技术比喻的准确性要求高，偏好具体数据而非模糊表述
- 写作习惯：愿意花时间打磨，但需要 AI 帮他想表达角度（比喻、结构）
- 回采价值：发现版本标注的漏项，成为后续文章的默认规则

### 9.3 两种用户的对比

| 维度 | 小红书运营者 | 技术大牛 |
|------|-------------|---------|
| voiceprint 路径 | B（贴现成文章） | A（引导式写） |
| topic-researcher 对话 | 浅——用户清楚要写什么 | 深——需要帮用户找到表达角度 |
| 修改轮数 | 1-3 轮 | 3-5 轮 |
| 修改重点 | 标题、排版、平台规则 | 技术准确性、比喻恰当性 |
| 跨 stage 回查频率 | 低（品类熟悉） | 高（对数据敏感） |
| quality-reviewer 态度 | 选择性遵守规则 | 全部遵守 |
| post-analyst 价值 | 关注哪个标题效果好 | 关注技术细节有没有写错 |
| kb 积累方向 | 品类知识（护肤/穿搭） | 领域知识（AI/架构） |
| "人在回路"的核心贡献 | 平台语感、选品判断 | 技术判断、表述方向 |

## 附录：原始 Feishu 文档对照

| 原始文档章节 | 适配位置 |
|-------------|---------|
| 部虾创基础 Agents 设计 — 选题Agent（含调研） | topic-researcher SOUL.md + §3.1（合并）|
| 部虾创基础 Agents 设计 — 写作Agent（三模式） | content-writer SOUL.md + §3.2（简化为单模式 + 原始三模式说明）|
| 部虾创基础 Agents 设计 — 审核Agent | quality-reviewer SOUL.md + §3.3 |
| 部虾创基础 Agents 设计 — 发布Agent | publisher SOUL.md + §3.4 |
| 部虾创基础 Agents 设计 — 回采Agent | post-analyst SOUL.md + §3.5（已完成设计）|
| Voiceprint 风格档案 | §6 + voiceprint-guide.md |
| content-writer 风格学习设计 | content-writer-design.md（已存在）|
