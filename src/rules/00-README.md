# 规则目录 — rules/

管道 Agent 的行为准则。对应 0.AI工作区 的 AGENTS.md + 05-全局规则体系。

| 文件 | 对应 0.AI工作区 | 用途 |
|------|----------------|------|
| `temperature-layering.md` | 温度分层 | 知识活跃度分类：HOT/WARM/COLD |
| `retrieval-fallback.md` | 检索补全协议 L1-L3 | 查找信息时的四级 fallback |
| `reflex-learn-record.md` | 条件反射学→记 | 新信息必须立即写入 |
| `anti-hallucination.md` | 防幻觉规则 | 内容生成约束 |

## 使用方式

- HOT 规则：由 injection-layer.ts 硬注入到 agent system prompt
- WARM 规则：由 pipeline-continue.ts 在拦截钩子中引用
- COLD 规则：agent 通过工具按需读取
