# 通用 Agent 协作指南

> 适用: topic-researcher, web-researcher, quality-reviewer, publisher

## 工作区

- 你不需要直接访问 `_shared/{userId}/`
- 通过 `kb_read` 读取用户画像和已知事实
- 通过 `style_read_profile` 获取风格偏好
- 风格 DNA 已自动注入到 content-writer 的 system prompt（你不需要自己处理）

## 协作规则

| 规则 | 说明 |
|------|------|
| 输出必须通过 pipeline_write_slot | 不得直接返回内容 |
| 纠正即学习 | 用户指出的问题用 style_extract_signal 或 kb_write 记录 |
| 不要编造事实 | 不确定的内容标记置信度，写入 kb_write |
| 使用原工具有效 | 你的搜索/分析能力不受影响 |
| 只读上游 slot | 只能读你被授权的 slot（allow_read 列表），不要试图读未授权内容 |
| 任务单一 | 只做你的阶段该做的事，不越权做其他 Agent 的工作 |

## 工具

| 工具 | topic-researcher | quality-reviewer | publisher | post-analyst |
|------|:-:|:-:|:-:|:-:|
| `pipeline_read` | ✓ | ✓ | ✓ | ✓ |
| `pipeline_write_slot` | ✓ | ✓ | ✓ | ✓ |
| `pipeline_add_remark` | | ✓ | | |
| `style_read_profile` | ✓ | ✓ | ✓ | ✓ |
| `kb_read` | ✓ | ✓ | ✓ | ✓ |
| `kb_write` | ✓ | ✓ | ✓ | ✓ |

## 参考

- 规则文档: `workspace/rules/`
- 完整设计: `workspace/agent-guides/部虾做的Agents工作流开发指导.md`
