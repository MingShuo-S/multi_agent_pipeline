# Voiceprint 风格冷启动 — 编排指南

## 核心交互模型

**voiceprint 的所有用户交互都由你（orchestrator）完成。工具只负责存数据、校验状态、返回提示语。**

交互循环：
```
你: 显示提示语 → 用户: 回复 → 你: 调用工具 → 工具: 存数据 + 返回下一步提示语 → 你: 显示提示语 → ...
```

状态保存在 `_shared/{userId}/voiceprint-state.json`，断连可恢复。

---

## 启动

每次只做一件事：

```
voiceprint_init()
→ 返回 { exists, state, prompt }
```

| exists | state | 你做什么 |
|--------|-------|----------|
| `true` | step=99 | 已有完成状态，直接跳过 |
| `true` | step<N | 之前中断，从 step N 继续。**把 `prompt` 发给用户** |
| `false` | step=0 | 全新开始。**把 `prompt` 发给用户** |
| `false` | step=N | 之前中断过。同上，发 prompt 继续 |

---

## 步骤流转

每一步的 trigger 和 tool 调用：

| 步骤 | 触发条件 | 你调用 | 传入 | 返回 |
|------|---------|--------|------|------|
| 0 | prompt 说"贴文章或引导写" | — | — | 看用户选路径 A 或 B |
| **路径 A** |||||
| 1-4 | 用户写了文字 | `voiceprint_proceed` | `{ sample: {text, label} }` | 下一条 prompt |
| 5 | 用户说够了 / 你判断够了 | `voiceprint_proceed` | `{ done: true }` | 跳到 7 |
| **路径 B** |||||
| 1 | 用户贴文章 | `voiceprint_proceed` | `{ sample: {text, label}, path: 'B' }` | prompt |
| 2 | 用户贴够了 / 你说够了 | `voiceprint_proceed` | `{ done: true }` | 跳到 7 |
| **校准** |||||
| 7 | 校准 prompt 已显示 | `voiceprint_calibrate` | `{ sentenceLength, useEmoji, tone }` | 跳到 9 |
| 8 | 禁用语 prompt 在步骤 9 前由你展示 | `voiceprint_calibrate` | `{ selectedForbiddenPhrases: [...] }` | 跳到 9 |
| **分析** |||||
| 9 | 先 `route_message`→content-writer，拿到分析 JSON | `voiceprint_analyze` | `{ samples, analysis }` | 跳到 10+prompt |
| **确认** |||||
| 10 | 用户说"确认" | `voiceprint_confirm` | `{}` | 锁定，step=99 |
| 10 | 用户说不对 | `voiceprint_confirm` | `{ corrections: [...] }` | 记修正不锁定 |

---

## 关键约束

1. **校准步骤（7-8）的对话由你完成**——工具只存结果。你展示选项，用户选，你解析成结构化参数再调工具。
2. **步骤 9 的分析必须交给 content-writer**——用 `route_message` 把样本原文 + 分析指令发给 content-writer，拿返回的 JSON 再调 `voiceprint_analyze`。不要自己做启发式分析。
3. **`voiceprint_proceed` 只做 3 件事**：存样本、推进步骤编号、返回下条提示。不做分析。
4. **`voiceprint_confirm` 传 `corrections`** 不会锁定，只记修正。用户修正后，你重新走步骤 9（重新发 content-writer 分析）。
5. **断连恢复**——任何时候用户重新进来，调 `voiceprint_init()` 看 state.step，从对应步骤继续。
6. 每个工具调用返回的 `prompt` 就是你应该发给用户的下一句话。

---

## 分析指令模板（发给 content-writer）

路线：`route_message` → target: `content-writer`

```
请作为风格分析师，分析下面这些用户写作样本，输出结构化的风格 DNA。

样本：
1. [标签]: [全文]
2. [标签]: [全文]
...

输出 JSON（不要 markdown 包裹）：
{
  "corePrinciples": ["3-5 条核心写作原则"],
  "forbiddenPatterns": ["检测到的 AI 腔、拖沓句式、过度连接词"],
  "highFreqWords": ["高频词或短语"],
  "techTerms": ["领域术语"],
  "syntaxPatterns": { "avgSentenceLength": 数值 },
  "growthDirection": "用户可能想提升的方向"
}
```

拿到 JSON 后调 `voiceprint_analyze { samples, analysis: <JSON> }`。

如果 content-writer 不可用，**报错，不要兜底分析**。

---

## 话术模板

| 场景 | 你说 |
|------|------|
| 开场 | "我看你是第一次用，要不要先做个风格快照？你写几段文字，我学习你的表达习惯。" |
| 选路径 B | "那你有之前写过的文字吗？贴 1-3 段过来就行。" |
| 样本不够 | "谢谢！不同类型的样本越多越准，方便再写一段吗？" |
| 展示分析结果 | "以下是我理解的你的风格，你看对吗？[展示 summary] 不对告诉我，没问题就回复确认。" |
| 用户不满意 | "你说得对。具体哪条不对？我重新调整。" |
