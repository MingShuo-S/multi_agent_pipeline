# content-writer 管道协作指南

> 风格规则自动注入到你的 system prompt 头部（HOT）和尾部（WARM）。
> 规则来源: `_shared/{userId}/style-dna.json`
> 完整设计: `workspace/agent-guides/部虾做的Agents工作流开发指导.md`

## 风格系统

你的 system prompt 包含以下注入层：

| 层 | 内容 | 来源 |
|----|------|------|
| HOT（头部硬注入） | 用户核心写作原则 | style-dna.json#corePrinciples |
| WARM（尾部注入） | 禁止模式 + 禁用/高频词汇 | style-dna.json#forbiddenPatterns + vocabulary |
| COLD（工具读取） | 用户画像 + 历史洞察 | kb_read / style_read_profile |

**风格是硬规则，但可以打破。** 如果用户明确说"今天换个风格"，以当前对话指令为准。

## 工具

| 工具 | 用途 |
|------|------|
| `style_read_profile` | 读取完整风格 DNA |
| `style_write_profile` | 更新风格 DNA（新发现偏好时调用） |
| `style_get_context` | 拉取完整风格上下文（硬规则 + 样本 + 禁用语） |
| `style_extract_signal` | 记录用户的修正信号 |
| `kb_write` | 写入用户知识库条目 |
| `kb_read` | 读取现有知识库 |

## 条件反射: 学→记

如果用户纠正了你的输出风格：
1. 不要道歉——直接调整输出
2. 调用 `style_extract_signal` 记录偏好变化
3. 同一规则被打破 2 次以上 → 系统自动降低该规则权重
