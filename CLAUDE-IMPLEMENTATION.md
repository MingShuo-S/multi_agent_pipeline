# Claude Code Implementation Ticket

> 给 Claude Code 的实现清单，基于竞品调研（Hermes/LangGraph/Voiceprint）和双重可读性原则。
> 项目路径: `C:\Users\29548\Desktop\Sunshine\Projects\multi_agent_pipeline`

---

## P0 — Must Have (决赛前)

### 0. 环境准备

```bash
npm install better-sqlite3   # 用于 Checkpoint 分层
npm install -D @types/better-sqlite3
```

---

### 1. Schema 分离: input/working/output

**目标**: 将平面 Slot 改为三层 Schema。

**设计**:
- SlotMap 拆为 `PipelineSchema { input, working, output }`
- input — 用户输入，只写一次（pipeline start 时）
- working — 中间产物，可被多个 stage 读写
- output — 最终产物，只读（写完即锁定）

**改动文件**:

| 文件 | 改动 |
|------|------|
| `src/runtime/pipeline-types.ts` | 新增 `PipelineSchema`、`SchemaLayer` 类型 |
| `src/runtime/PromptBuilder.ts` | builder 支持按层注入（input→system, working→context, output→展示）|
| `templates/*.json` | 新增 `schema` 字段定义三层结构 |

**具体的**:

```typescript
// src/runtime/pipeline-types.ts

export type SchemaLayer = 'input' | 'working' | 'output'

export interface PipelineSchema {
  input: Record<string, SlotDef>
  working: Record<string, SlotDef>
  output: Record<string, SlotDef>
}

export interface SlotDef {
  description: string
  type: 'string' | 'string[]' | 'object'
  reducer?: 'replace' | 'append' | 'merge'  // 见 P0-2
  required?: boolean
}
```

**templates/xiaohongshu-creation.json 改造示例**:

```json
{
  "schema": {
    "input": {
      "article_idea": { "description": "用户输入的文章主题", "type": "string", "required": true },
      "target_audience": { "description": "目标读者", "type": "string" }
    },
    "working": {
      "research_notes": { "description": "调研笔记", "type": "string" },
      "style_profile": { "description": "当前风格配置", "type": "object" },
      "draft_content": { "description": "草稿正文", "type": "string" },
      "verification_report": { "description": "事实核查报告", "type": "string" }
    },
    "output": {
      "final_article": { "description": "最终发布文章", "type": "string" },
      "published_url": { "description": "发布链接", "type": "string" }
    }
  },
  "stages": [...]
}
```

**测试**:
- `tests/schema-separation.test.ts`
- 验证 input slot 在 start 后锁写
- 验证 output slot 在写入后不可覆盖
- 验证 working slot 可被多 stage 读写

---

### 2. Reducer 合并模式

**目标**: Slot 级别的合并策略，替代简单的 overwrite。

**设计**:
- `SlotDef` 新增 `reducer` 字段
- `'replace'`: 默认，后写覆盖前写（当前行为）
- `'append'`: 追加到数组末尾（用于 `research_notes`, `mistakes_found`）
- `'merge'`: 深合并（用于 `style_profile`）

**改动文件**:

| 文件 | 改动 |
|------|------|
| `src/runtime/StateManager.ts` | `modifyState` 方法增加 reducer 参数，按策略合并 |
| `src/tools/pipeline-continue.ts` | `writeSlot` 调用时传递 reducer |

**Reducer 实现参考**:

```typescript
// src/runtime/reducers.ts（新建）

type Reducer = 'replace' | 'append' | 'merge'

function applyReducer(current: unknown, update: unknown, reducer: Reducer): unknown {
  switch (reducer) {
    case 'replace':
      return update
    case 'append':
      if (!Array.isArray(current)) return [current, update]
      return [...current, update]
    case 'merge':
      if (typeof current !== 'object' || typeof update !== 'object') return update
      return { ...current, ...update }
  }
}
```

**测试**:
- `tests/reducers.test.ts`
- 三种 reducer 各覆盖 3 个 case（正常、空值、类型不匹配）
- 验证 append 不乱序
- 验证 merge 深合并

---

### 3. Interrupt 暂停点

**目标**: 在 pipeline 中定义暂停点，等待用户确认后再推进。

**设计**:
- template JSON 新增 `interrupts: InterruptPoint[]`
- Route-message 收到用户输入时先检查当前是否有 pending interrupt
- 有的话执行 `checkInterrupt()`，匹配关键词则通过，不匹配则记录为普通对话
- 通过后将结果写入选定的 slot，然后 auto-advance

**改动文件**:

| 文件 | 改动 |
|------|------|
| `src/runtime/pipeline-types.ts` | 新增 `InterruptPoint` 类型 |
| `templates/*.json` | 新增 `interrupts` 字段 |
| `src/tools/route-message.ts` | 消息路由前先检查 interrupt |
| `src/runtime/pipeline-runner.ts` | `simulateAgentResponse` 前检查 interrupt |

**类型定义**:

```typescript
// src/runtime/pipeline-types.ts

export interface InterruptPoint {
  stage: string         // 等待哪个 stage 完成后触发
  slot: string          // 等待用户确认哪个 slot
  message: string       // 展示给用户的消息模板
  confirmKeywords: string[]   // 确认通过的关键词，如 ['继续', '可以', '好的', 'ok']
  reviseKeywords: string[]    // 修改关键词，如 ['改', '不要', '不行', '重写']——匹配时记录为纠正信号
}
```

**templates 示例**:

```json
{
  "interrupts": [
    {
      "stage": "content-writer",
      "slot": "final_draft",
      "message": "草稿已完成。输入「继续」发布，或告诉我修改意见。",
      "confirmKeywords": ["继续", "可以", "好的", "ok", "yes", "go"],
      "reviseKeywords": ["改", "不要", "不行", "太重写", "不对", "太长"]
    }
  ]
}
```

**测试**:
- `tests/interrupt-flow.test.ts`
- pipeline 推进到 interrupt 点时暂停
- 用户确认后推进到下一 stage
- 用户修改时记录纠正信号但不推进
- 关键词不匹配时当作普通对话继续等待

---

### 4. Voiceprint 迁移: sync-style + loading chain

**目标**: 将 Voiceprint 改为 Hybrid 方案——Claude Voiceprint 输出 SKILL.md，本地脚本拆到 .styles/。

**具体改动**:

| 文件 | 改动 |
|------|------|
| `scripts/sync-style.ps1` | **已创建**，但需要测试和修复路径 |
| `openclaw.plugin.json` | 注册 `sync-style` 工具 |
| `docs/orchestrator-SKILL.md` | 更新 tool 声明 |
| `applications/buxiachuang/deploy.sh` | 部署时同步 Voiceprint 输出 |

**sync-style.ps1 需要修复**:
- 确认 `$env:AI_WORKSPACE` 或 fallback 路径正确指向 `C:\Users\29548\Documents\Sunshine\0. AI工作区`
- 处理 SKILL.md 中可能缺失的 section 边界（有些 Voiceprint 输出不分 ##）
- 追加 `.ai.md` 伴侣文件同步

**测试**:
- `tests/sync-style.test.ts`（如果走 TS）
- 或手动测试: `scripts/sync-style.ps1 -From <test-SKILL.md> -DryRun`

---

## P1 — Should Have

### 5. Checkpoint 分层: JSON → SQLite

**目标**: 增加 SQLite 后端作为可选 checkpoint 存储。

**设计**:
- `JsonCheckpointer`: 当前实现（slotHistory JSON）
- `SqliteCheckpointer`: 新增，用 `better-sqlite3`
- 切换方式: `pipeline.settings.checkpointer: 'json' | 'sqlite'`

**改动文件**:

| 文件 | 改动 |
|------|------|
| `src/runtime/StateManager.ts` | 内部使用 checkpointer 接口 |
| `src/runtime/checkpointers.ts`（新建）| `Checkpointer` 接口 + 两个实现 |

**测试**:
- `tests/checkpointers.test.ts`
- JsonCheckpointer 保留当前行为
- SqliteCheckpointer 支持 time travel（按版本号查历史 slot）
- 两者结果一致（同一 pipeline 同一输入，输出相同）

---

### 6. Prefetch 上下文预取

**目标**: 在 session 开始或 stage 切换前，自动预取相关上下文。

**设计**:
- `scripts/prefetch-context.ps1` 已创建，但需集成到 pipeline
- pipeline-start 时可选执行 prefetch，结果写入 `working.prefetched_context`

**改动文件**:

| 文件 | 改动 |
|------|------|
| `scripts/prefetch-context.ps1` | 已在 AI 工作区创建，需确认路径正确 |
| `src/tools/pipeline-start.ts` | 可选 `--prefetch` 参数，调用 prefetch-context |

**测试**:
- 简单集成测试：pipeline 启动后检查 prefetched_context 存在

---

## P2 — Nice to Have

### 7. 记忆回采回调 (Hermes-inspired MemoryProvider 接口)

将当前 StateManager 的读写抽象为插件式接口，为后续换 SQLite/Honcho 后端做准备。不做完整实现，只定义接口 + 保留当前实现。

### 8. 复合评分排序

在 search-graph.ps1 的嵌入 Python 中将 `np.dot(...)` 替换为 `0.5*sim + 0.3*recency + 0.2*importance`。

---

## 实现顺序建议

```
P0-1 Schema 分离 → 4h
P0-2 Reducer → 3h
P0-3 Interrupt → 6h
P0-4 Voiceprint → 2h（已有 sync-style.ps1）
P1-5 Checkpoint 分层 → 4h
P1-6 Prefetch → 1h（已有脚本）
P2-7 MemoryProvider 接口 → 2h
P2-8 复合评分 → 1h
```

---

## 参考文件

| 参考 | 位置 |
|------|------|
| LangGraph Schemas | `AI工作区\调研\理科\09-LangGraph深度竞品调研.md` §2 |
| LangGraph Reducer | `AI工作区\调研\理科\09-LangGraph深度竞品调研.md` §2.3 |
| LangGraph Interrupt | `AI工作区\调研\理科\09-LangGraph深度竞品调研.md` §4 |
| Hermes MemoryProvider | `AI工作区\调研\理科\08-Hermes-Agent记忆系统调研.md` §3.4 |
| Voiceprint 方案 C | `AI工作区\调研\理科\10-Voiceprint现状评估与复用方案.md` §5 |
| 完整对比表 | `AI工作区\调研\理科\07-部虾做部虾创创新点竞品调研.md` §3 |
| Dual Readability | `AI工作区\AI笔记\03-人与AI双重可读性设计原则.md` |
| deploy.sh | `applications/buxiachuang/deploy.sh` |
