# 温度分层规则 — 知识活跃度分类

## 策略

| 温度 | 活跃度 | 注入策略 | 文件位置 |
|------|--------|---------|---------|
| HOT | 每 session 必读 | 注入 system prompt 头部，不可覆盖 | `_shared/{userId}/style-dna.json#corePrinciples` |
| WARM | 任务需要时读 | 注入 system prompt 尾部，或按工具逻辑注入 | `_shared/{userId}/style-dna.json#forbiddenPatterns` + `#vocabulary` |
| COLD | 明确请求才读 | 不注入，通过 kb_read 等工具按需获取 | `_shared/{userId}/kb.json` + `profile/persona.md` |

## 执行

- 只有 `content-writer` 拿到 HOT + WARM
- 其他 Agent 只拿 COLD（persona.md） + 工作区全局规则
