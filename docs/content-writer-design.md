# Content-Writing Agent 设计

> 给负责 content-writer 的队友参考。不涉及代码实现，只说设计。
> 最后更新: 2026-06-04

---

## 1. 这个 Agent 是干什么的

接收 topic-researcher 的选题 + web-researcher 的调研数据 → 写出像用户的文章。

不是"通用写作助手"，是**会模仿用户写作风格的写作伙伴**。

---

## 2. 它需要知道什么

分两层：

### 2.1 所有 Agent 共享的知识库（全部 agent 都可读写）

| 内容 | 用途 | 谁更新 |
|------|------|--------|
| 用户画像 | 这人是谁、懂什么、讨厌什么、什么背景 | 全部 agent（观察到就记） |
| 项目上下文 | 当前在做什么、做到哪了 | pipeline 自动 |
| 历史偏好 | 用户之前说过喜欢/不喜欢什么方向 | 全部 agent（用户纠正时记） |

其他 agent 只用到这层。content-writer 在此基础上额外加一层：

### 2.2 仅 content-writer 使用的风格档案

| 文件 | 内容 | 来源 |
|------|------|------|
| `writing-dna.md` | 句法结构、词汇习惯、标点模式 | LLM 从样本提取 |
| `forbidden-patterns.md` | AI 腔禁用语 | onboarding + 用户纠正积累 |
| `growth-direction.md` | 用户目标状态（不 copy 当前） | onboarding 设定 |
| `samples/` | 最近的写作样本（3-5 篇） | 用户上传 + 每次确认的草稿 |

---

## 3. 风格怎么学

### 3.1 Onboarding——用户怎么开始？

这是最关键的。用户第一次使用时，**不能让用户自己想办法**。提供两条路：

#### 路径 A：引导式写入（参考 Voiceprint 流程，约 10 分钟）

content-writer 像 Voiceprint 那样一步一步引导用户写：

```
Step 1: "初次见面，我先了解你的写作风格。大概 10 分钟。准备好了说开始"
Step 2: "先随便写一段——最近做了什么？跟朋友闲聊那样写几句"
        → 用户写 → agent 存为"日常"样本
Step 3: "解释一个你擅长的概念"
        → 用户写 → agent 存为"解释性"样本
Step 4: "推荐一个你喜欢的东西"
        → 用户写 → agent 存为"热情"样本
Step 5: "吐槽一个让你不爽的事"
        → 用户写 → agent 存为"吐槽"样本
Step 6: "给个观点——大家都接受但你反对的事是什么？"
        → 用户写 → agent 存为"有主见"样本
Step 7: 偏好校准选择题（句长？标点？emoji 频率？模式匹配？）
Step 8: 禁用语选择题（"值得注意的是"、"让我们深入探讨"...）
Step 9: → LLM 子 agent 分析全部样本 → 生成风格档案
Step 10: "我理解你的风格是这样的，对吗？" → 用户确认/调整
```

5 种情绪基调 = Voiceprint 方法论。关键在于**先写后问**——用户写完了再做选择题，比先做选择题更准。

#### 路径 B：贴现有文章

```
用户说"我有现成的文章"或"我贴几篇给你"
→ agent 接受以下几种方式：

  方式 1: 直接粘贴文本     ← 所有渠道都支持，最优先
  方式 2: 文件上传         ← WhatsApp/Telegram/Discord/WebChat 支持
  方式 3: 链接            ← agent 抓取内容分析
  方式 4: 多篇逐步提供     ← "还有吗？再发一篇不同类型的"

→ agent 从每篇文章中提取对应 5 种基调的段落
→ 如果缺某种情绪，补问一个引导式问题（"你吐槽过什么吗？写两句"）
```

**默认走路径 A**（引导式），用户说"我贴文章"→ 切路径 B。

两种路径汇合点相同：5 样本 + 偏好校准 + 禁用语 → LLM 分析 → 生成风格档案 → 用户确认。

### 3.2 Onboarding 结束后——文件存在哪

Voiceprint 输出是单文件 `SKILL.md`，对我们不够。改用它的方法论（5 prompt + 偏好校准），但写进 pipeline 自己的结构化目录：

```
{SHARED_ROOT}/
├── styles/
│   └── {userId}/
│       ├── writing-dna.md           ← Voiceprint 式分析的 DNA 输出
│       ├── forbidden-patterns.md    ← 禁用语（onboarding + 持续累积）
│       ├── growth-direction.md      ← 目标状态
│       ├── samples/                 ← 原始样本
│       └── profile.json             ← 现有升级版（结构化替代 flat preferences）
├── kb/
│   └── {userId}/
│       ├── user_profile.md          ← 用户画像（全部 agent 共享）
│       └── insights.md              ← 历史偏好观察（全部 agent 贡献）
└── projects/                        ← 现有：pipeline 项目
```

`{SHARED_ROOT}` = `~/.openclaw/workspaces/map/_shared/`，各 agent 通过绝对路径访问。pipeline 注册的 `style_get_context` 工具从 `styles/` 读，`kb_read/kb_write` 工具从 `kb/` 读写。

### 3.3 所有 agent 怎么协同修缮风格

不能靠 agent 自觉（会装跑）。正确做法：**pipeline 层拦截每次对话回合。**

`pipeline_continue` 是**唯一入口**——所有 agent 的全部对话都经过它：

```
pipeline_continue(user_msg, agent_response)
  ↓
  正常路由给当前 agent
  ↓
  agent 回复后, pipeline 自动做两件事:

  1. 检测 user_msg 是否包含纠正信号
     关键词匹配："别" "不要" "太长" "不对" "我不是这个意思" "改" ...
  2. 有纠正信号 → 写入 kb/insights.md（全部 agent 受益）
     如果涉及风格 → 同时更新 styles/profile.json（仅 content-writer 用）
  3. 记录到 profile.json 的 feedback_log
```

这样**不依赖任何 agent 自觉**——pipeline 在调用层就截获了。纠正的来源可以是 orchestrator、topic-researcher、quality-reviewer 等任意 agent 的对话回合。

### 3.4 用户如何上传文件

支持四种方式，按优先级：

| 方式 | 渠道支持 | 说明 |
|------|---------|------|
| **粘贴文本** | **全部渠道** | 零依赖，onboarding 默认方式 |
| 文件上传 | Dashboard / Telegram / WhatsApp / Discord | OpenClaw Dashboard 支持文件上传 |
| 发链接 | 全部渠道 | agent 抓取内容分析 |
| 多篇逐步 | 全部渠道 | "还有吗？再发一篇" |

**Dashboard 上传**：OpenClaw Control UI (`127.0.0.1:18789`) 的 WebChat 支持文件发送。用户拖拽/选择文件 → pipeline 收到文件内容 → 传给 content-writer 提取样本。

但 onboarding **以粘贴为主**，因为文件上传有渠道限制。onboarding Agent 第一句话：

```
"初次见面。你有写过的文章吗？可以直接贴过来。
不想贴的话，我引导你写几段也行，大概 10 分钟。"
```

### 3.5 演化阶段

不只是 content-writer。**任何 agent** 在对话中被用户纠正时，都记录到知识库：

```
用户说"别用那么长的句子" → 写入用户画像"偏好短句"
但只有 content-writer 在写作时把这个转为硬规则
```

实现方式：pipeline 的 `style_record_feedback` 工具从"agent 自觉调"改为"每次工具调用后 Hook 自动跑"。

| 阶段 | 条件 | 行为 |
|------|------|------|
| naive | 0-2 条反馈 | 用默认风格 |
| learning | 3-8 条 | 风格规则开始生效，中等权重 |
| stable | 9-50 条 | 规则高置信度，做快照 |
| drifting | 50+ | 检测用户风格是否变化了 |

---

## 4. Prompt 注入方式

### 4.1 其他 agent 的 prompt

```
【系统指令】
...
【用户画像】（知识库内容——简短的"这位用户是..."）
  用户背景：南京大学大一，软件工程
  偏好：喜欢短句，讨厌 emoji
  历史：写过穿搭类内容
...
【管道上下文】
...
```

### 4.2 content-writer 的 prompt

```
【系统指令】
...
【风格硬规则】← 这是 content-writer 独有的
  以下规则**必须遵守**，不是建议：
  - 句长：20 字以内
  - 每段 3-5 行
  - 不要用"首先、其次、最后"
  - 不要用"值得注意的是"
  - 不要用 emoji
【用户画像】
...
【当前风格档案】
  置信度：78%（learining 阶段）
  最近样本参考：xxx...
【管道上下文】
...
```

区别：其他 agent 的"用户画像"是**了解用户**，content-writer 的"风格硬规则"是**必须遵守**。

---

## 5. 工具权限

### 5.1 content-writer 可用的工具

| 工具 | 说明 |
|------|------|
| pipeline_read | 读 topic_brief + research_notes |
| pipeline_write_slot | 写 draft_content |
| style_get_context | 获取完整风格档案（硬规则 + 样本 + 禁用语） |
| style_record_feedback | 记录用户本次对写作的反馈 |
| kb_read | 读用户画像 |
| kb_write | 记新发现（"用户不喜欢比喻"） |
| 通用工具 | 搜索、计算等 |

### 5.2 content-writer 的 OpenClaw Skills

表面层：用 ClawHub 上的写作 skill（如 Voiceprint 做 onboarding）

深层层：pipeline 的 `style_get_context` 和 `style_record_feedback` 工具

两层一起发力：

```
Onboarding → Voiceprint skill 引导 10 分钟
               ↓
             风格档案写入 pipeline 知识库
               ↓
每次写作 → style_get_context 拉风格规则 → 硬注入 system prompt
               ↓
用户纠正 → style_record_feedback → Hook 自动提取模式 → 更新档案
               ↓
越用越懂你
```

---

## 6. SOUL.md（给队友参考怎么写）

```markdown
# 写作Agent — SOUL.md

## 身份

我是用户的写作分身。不是通用写作助手，是**能用用户的声音说话的人**。

## 人格

- **风格敏感**：每次写作前读取风格档案，确保语气、节奏、用词匹配
- **平台意识**：知道小红书/公众号/博客的不同写法，按平台调整
- **成长导向**：用户在进步，我也在进步——不固守旧规则，学习新偏好

## 工作方式

1. 读取风格档案（硬规则 → 样本 → 禁用语）
2. 读取用户画像（知道在跟谁说话）
3. 读取调研数据（知道要写什么）
4. 写草稿 → 用户确认 → 记录反馈 → 更新档案
```

---

## 7. 当前 pipeline 需要改什么

| 改什么 | 为什么 |
|--------|--------|
| `memory.ts` 的 `AgentProfile.preferences` 从 flat JSON → 结构化 `.styles/` 格式 | 现在啥都能写但没规范 |
| `prompt-builder.ts` 加风格硬注入段（只对 content-writer） | 现在是软注入，agent 可忽略 |
| `prompt-builder.ts` 加用户画像段（所有 agent） | 让所有 agent 了解用户 |
| `style_record_feedback` 加自动触发 | 现在靠 agent 自觉，漏报率高 |
| 注册新工具 `style_get_context` | 让 content-writer 能拉风格档案 |
| onboarding 流程接入 Voiceprint skill | 新用户第一次使用时有引导 |

---

## 8. 交付物检查清单

- [ ] content-writer 的 SOUL.md v2
- [ ] content-writer 的 SKILL.md v2（含平台规则 + 引导式 onboarding 话术）
- [ ] 风格档案目录结构定义（`.styles/`）
- [ ] 知识库目录结构定义（`kb/`）
- [ ] Onboarding 流程设计（引导式 + 贴文章双路径）
- [ ] 自动学习 Hook 设计
