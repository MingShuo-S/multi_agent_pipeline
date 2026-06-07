---
name: style-voiceprint
description: 引导式风格提取——收集写作样本 → LLM 分析 → 生成风格 DNA（HOT/WARM/COLD 三层）
metadata:
  {
    "openclaw": { "requires": { "config": ["plugins.entries.multi-agent-pipeline.enabled"] } },
  }
---

# style-voiceprint

> 通过 voiceprint 流程提取用户写作风格，生成 style-dna.json + persona.md。
> 依赖 pipeline 的 `voiceprint_*` 工具组 + `style_write_profile`。

---

## 流程总览

```
voiceprint_init → 检查是否已有风格 DNA
  │
  ├─ 有 → 返回 exists=true，跳过
  │
  └─ 无 → 开始 10 步引导：
        Step 0: 介绍 + 选择路径（引导写 / 贴文章）
        Step 1-4: 收集 4 段写作样本 + 1 段自由发挥
        Step 5: 确认样本够用
        Step 6: 调用子 agent 分析样本
        Step 7-8: 偏好校准（句长/emoji/感叹号/语气/禁用语）
        Step 9: voiceprint_analyze 写入 style-dna.json
        Step 10: voiceprint_confirm 锁定 + 生成 persona.md
```

---

## 触发条件

| 时机 | 谁调 | 原因 |
|------|------|------|
| content-writer 首次分配给新用户 | content-writer | 还没有风格 DNA |
| 用户说"调整风格"或"重新做一次风格快照" | content-writer | 用户主动要求 |
| 系统检测到风格 drift（50+ 反馈后） | post-analyst | 用户风格可能变了 |

---

## 工具映射

### 核心工具

| pipeline 工具 | 作用 | 在流程中的位置 |
|--------------|------|---------------|
| `voiceprint_init` | 冷启/恢复检查，返回当前步骤提示 | 入口 |
| `voiceprint_proceed` | 存储用户写的样本 + 推进步骤 1-5 | Steps 1-5 |
| `voiceprint_calibrate` | 偏好校准（句长/emoji/感叹号/语气/禁用语） | Steps 7-8 |
| `voiceprint_analyze` | 接受子 agent 分析结论写入 style-dna.json | Step 9 |
| `voiceprint_confirm` | 展示分析结果 + 确认锁定 | Step 10 |
| `voiceprint_reset` | 重置状态，允许重新做 | 重置场景 |

### 辅助工具

| pipeline 工具 | 作用 | 说明 |
|--------------|------|------|
| `route_message` | 发样本给子 agent 做分析 | Step 6 |
| `style_read_profile` | 读当前 style-dna.json 确认写入结果 | 完成后验证 |
| `kb_read` | 查用户历史风格记录 | 初始化参考 |

---

## 详细步骤说明

### Step 0 — 入口判断

调用 `voiceprint_init`：

- 返回 `exists: true` → 已有风格 DNA，跳过整个流程
- 返回 `exists: false` → 开始引导，把 `prompt` 发给用户

### Step 1-4 — 样本收集（path: A）

用户选择"引导我写"后，调用 `voiceprint_proceed` 传入 `path: 'A'`：

| 步骤 | 提示 | 用户写什么 |
|------|------|-----------|
| 1 | 自我介绍 | 3-5 句日常表达 |
| 2 | 最近琢磨的概念 | 解释性写作 |
| 3 | 推荐一样东西 | 热情/推荐型写作 |
| 4 | 随意闲聊 | 日常语气 |

每次用户回复后：
1. 调用 `voiceprint_proceed({ sample: { text: 用户输入, label: "步骤X" } })`
2. 返回的 `prompt` 给用户看

### Step 1-4 — 样本收集（path: B）

用户选择贴文章：
1. 调 `voiceprint_proceed({ path: 'B' })`
2. 用户每贴一篇 → 调 `voiceprint_proceed({ sample: { text: 文章, label: "贴文X" } })`
3. 用户说够了 → 调 `voiceprint_proceed({ done: true })`

### Step 5 — 确认样本够用

两种路径统一到 Step 5：用户确认样本够 → `voiceprint_proceed({ done: true })` → 跳到 Step 7。

### Step 6 — 子 agent 分析

`voiceprint_proceed` 推进到 Step 7 后，调 `route_message` 发样本给 content-writer 子 agent 分析。分析结论包含：

```json
{
  "corePrinciples": ["短句为主", "少用形容词", ...],
  "forbiddenPatterns": ["值得注意的是", "让我们深入探讨", ...],
  "highFreqWords": ["确实", "其实", "可能"],
  "syntaxPatterns": { "preferedSentenceLength": 20, "usesEmoji": false },
  "growthDirection": "希望更口语化"
}
```

### Step 7-8 — 偏好校准

用 `voiceprint_calibrate` 分两次调用：

1. 先调 `voiceprint_calibrate` 处理句长/emoji/感叹号/语气（Step 7）
2. 再调 `voiceprint_calibrate({ selectedForbiddenPhrases: [...] })`（Step 8）

### Step 9 — 写入分析

调 `voiceprint_analyze` 传入完整分析结论。自动写入 `style-dna.json`。

### Step 10 — 确认锁定

调 `voiceprint_confirm`：

- 用户确认 → 生成 `persona.md`，标记完成
- 用户修正 → `voiceprint_confirm({ corrections: ["修改项A"] })` → 重新分析

---

## 状态机约束

| 当前 step | 可调用的工具 |
|-----------|------------|
| 0（未开始） | `voiceprint_init` |
| 1-5（采集中） | `voiceprint_proceed` |
| 6（分析中） | `route_message` 发子 agent |
| 7-8（校准中） | `voiceprint_calibrate` |
| 9（分析写入） | `voiceprint_analyze` |
| 10（确认） | `voiceprint_confirm` |

**不按顺序调会报错**。如果流程中断，调用 `voiceprint_init` 恢复当前状态。

---

## 异常处理

| 场景 | 处理 |
|------|------|
| 用户写的内容太短（< 10 字） | 提示"多写几句，3-5 句就好" |
| 用户在中途退出 | `voiceprint_init` 可恢复当前步骤 |
| 子 agent 分析失败 | 重试 `route_message` |
| 用户说"编风格快照太难了" | 跳过，用默认风格（简洁、准确、无 AI 腔） |
| 用户要求全部重做 | `voiceprint_reset` → 重新 `voiceprint_init` |

---

## 后续验证

完成后验证：

```text
1. kb_read 确认 style-dna.json 有内容
2. style_read_profile 确认风格 DNA 可读取
3. 调 style_get_context 确认完整上下文可拉取
```
