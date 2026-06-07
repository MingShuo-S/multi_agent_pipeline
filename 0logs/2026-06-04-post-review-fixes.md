# 2026-06-04 审查后修复

## 变更

| 文件 | 变更 | 原因 |
|------|------|------|
| `scripts/deploy.sh:97-217` | 更新 SOUL.md 文字段 | 旧 SOUL 引用已删除的 KNOWN_AGENTS + 旧工具名 |
| `src/tools/pipeline-continue.ts:85` | detectStyleSignals 增强 | 加英文模式、间接纠正（用户重写）、更多 forbidden/praise |
| `scripts/sync-ai-summary.ps1` | 新增 | .ai.md 伴侣文件生成器（Windows） |
| `scripts/sync-ai-summary.sh` | 新增 | .ai.md 伴侣文件生成器（Linux） |
| `src/tools/style-system.ts` | 加文件锁 `withLock()` | 防并发写冲突（read→modify→write 的 TOCTOU） |
| `src/tools/style-system.ts` | 加 `voiceprintInit()` | 冷启动创建空 style-dna.json + 5 引导问题 |
| `src/index.ts` | 注册 `voiceprint_init` 工具 | 第 17 个工具 |
| `openclaw.plugin.json` | 添加 `voiceprint_init` 合约 | 同步更新 |
| `src/agent-guide-templates/voiceprint-guide.md` | 新增 | Voiceprint 流程指南 |
| `src/runtime/injection-layer.ts` | `buildForRole` + `projectId` 参数 | 修复 `project_id` 不存在于 PipelineState 问题 |
| `src/runtime/prompt-builder.ts` | 传 `projectId` 到 `buildForRole` | 配合 injection-layer 签名变更 |
| `src/tools/style-system.ts` | `kbRead` 加 `category` 参数 | index.ts 传了第三个参数但函数签名缺了 `category` |

## 未解决的问题

- 无（本次修复覆盖了所有已知问题）

## 验证

- `npx tsc --noEmit` 通过（0 错误）
