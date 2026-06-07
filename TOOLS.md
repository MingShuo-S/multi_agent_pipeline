# 工具注册表

> 本文件记录 `src/index.ts` 中 `defineToolPlugin` 注册的所有工具及其 Agent 可见性。
> 添加/修改工具时同步更新此表 + 中央工具分区矩阵（架构文档）。

## 已注册工具

| 工具名 | 用途 | SDK | 参数 | 注册位置 |
|--------|------|-----|------|---------|
| `pipeline_read` | 读取 slot 内容 | openclaw/plugin-sdk/pipeline | `slot_name` | `src/index.ts` |
| `pipeline_write_slot` | 写入 slot | openclaw/plugin-sdk/pipeline | `slot_name`, `content` | `src/index.ts` |
| `pipeline_add_remark` | 跨 stage 微小建议 | openclaw/plugin-sdk/sdk | `stage_id`, `message` | `src/index.ts` |
| `style_read_profile` | 读用户风格 DNA | openclaw/plugin-sdk/style | `field`, `tier` | `src/index.ts` |
| `style_write_profile` | 写回风格偏好 | openclaw/plugin-sdk/style | `field`, `value` | `src/index.ts` |
| `style_get_context` | 拉取完整风格上下文 | openclaw/plugin-sdk/style | — | `src/index.ts` |
| `style_extract_signal` | 记录纠正信号 | openclaw/plugin-sdk/style | `signal` | `src/index.ts` |
| `kb_read` | 读知识库 | openclaw/plugin-sdk/knowledge | `path`, `type` | `src/index.ts` |
| `kb_write` | 写知识库 | openclaw/plugin-sdk/knowledge | `path`, `content`, `metadata` | `src/index.ts` |
| `session_search` | 跨 slot 历史检索 | 自定义 `src/tools/session-memory.ts` | `query` | `src/index.ts` |
| `snapshot_create` | 冻结 KB 快照 | 自定义 `src/tools/session-memory.ts` | — | `src/index.ts` |
| `snapshot_read` | 读 KB 快照 | 自定义 `src/tools/session-memory.ts` | — | `src/index.ts` |
| `session_note_write` | 写 Agent 自述笔记 | 自定义 `src/tools/session-memory.ts` | `content` | `src/index.ts` |
| `session_note_read` | 读 Agent 自述笔记 | 自定义 `src/tools/session-memory.ts` | — | `src/index.ts` |
| `memory_compress` | 压缩 KB 数据 | 自定义 `src/tools/session-memory.ts` | `target` | `src/index.ts` |
| `group:web` | 联网搜索 | 内置 | — | 框架 |
| `group:code` | 代码执行 | 内置 | — | 框架 |
| `group:read` | 文件读取 | 内置 | — | 框架 |
| `mcp_platform/*` | 各平台格式化 MCP | 自定义 | — | 平台插件 |

## Agent 分区矩阵

详见架构文档 [`部虾创5个Agent详细配置.md#中央工具分区矩阵`](C:\Users\29548\Desktop\阳关\南京大学\11-比赛\小龙虾\决赛路演\部虾创5个Agent详细配置.md)。

| 工具 | topic-researcher | content-writer | quality-reviewer | publisher | post-analyst |
|------|:---:|:---:|:---:|:---:|:---:|
| `pipeline_read` | Y | Y | Y | Y | Y |
| `pipeline_write_slot` | Y | Y | Y | Y | Y |
| `pipeline_add_remark` | Y | Y | Y | — | — |
| `style_read_profile` | Y | Y | Y | Y | Y |
| `style_write_profile` | — | Y | — | — | — |
| `style_get_context` | — | Y | — | — | — |
| `style_extract_signal` | — | Y | — | — | — |
| `kb_read` | Y | Y | Y | Y | Y |
| `kb_write` | Y | Y | Y | Y | Y |
| `session_search` | Y | Y | Y | Y | Y |
| `snapshot_read` | Y | Y | Y | Y | Y |
| `snapshot_create` | — | — | — | — | —¹ |
| `session_note_read` | Y | Y | Y | Y | Y |
| `session_note_write` | Y | Y | — | — | — |
| `memory_compress` | — | — | — | — | Y |
| `group:web` | Y | — | Y | — | — |
| `group:code` | Y | — | — | — | — |
| `group:read` | Y | — | — | — | — |
| `mcp_platform/*` | — | — | — | Y | — |

> ¹ `snapshot_create` 由 `pipeline-start.ts` 自动调用，无需 agent 手动触发。

## 分区原则

| 类别 | 规则 |
|------|------|
| 通用读 | 所有 Agent → Y |
| 通用检索 | 所有 Agent → Y |
| 角色专属写 | 职责相关的 Agent → Y |
| 系统操作 | 特定角色 → Y |
| 联网/文件/代码 | topic-researcher 最宽松；content-writer/publisher/post-analyst 禁止联网 |
