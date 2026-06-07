# 测试回顾

## 一、测试集总览

| 模块 | 文件 | 测试数 | 覆盖内容 |
|------|------|--------|---------|
| **源码已有测试（7）** | | | |
| workspace-config | `workspace-config.test.ts` | ~20 | CRUD + 验证 |
| state-manager | `state-manager.test.ts` | ~20 | load/save/lock |
| style-system | `style-system.test.ts` | ~15 | profile/feedback/kb |
| style-signal-detector | `style-signal-detector.test.ts` | ~8 | 信号检测 |
| tool-auth | `tool-auth.test.ts` | ~6 | 权限检查 |
| types-utils | `types-utils.test.ts` | ~4 | 工具类型辅助 |
| workspace-config-validate | `workspace-config-validate.test.ts` | ~10 | 模板验证 |
| **新增测试（12）** | | | |
| pipeline-core | `pipeline-core.test.ts` | 9 | read/write/remark |
| pipeline-status | `pipeline-status.test.ts` | 9 | 状态面板显示 |
| pipeline-start | `pipeline-start.test.ts` | 22 | 初始化 + 路由 + checkpoint |
| pipeline-continue | `pipeline-continue.test.ts` | 25 | 推进信号 + 错误恢复 + advance |
| memory | `memory.test.ts` | 17 | profile CRUD + style 代理 |
| agent-guide-generator | `agent-guide-generator.test.ts` | 13 | 生成/覆盖/追加/读取 |
| injection-layer | `injection-layer.test.ts` | 10 | 角色 DNA 注入/全局规则 |
| prompt-builder | `prompt-builder.test.ts` | 10 | 8 个区块/profile/guide/slot |
| skill-runner | `skill-runner.test.ts` | 12 | 工具列表合并/去重/错误 |
| route-message | `route-message.test.ts` | 4 | 路由选择/pipeline 构建 |
| config | `config.test.ts` | 7 | 三大路径推导 |
| install | `install.test.ts` | 8 | 目录/文件/模板创建 |
| **合计** | **19（+1 fixtures）** | **~190** | |

---

## 二、发现的问题及解决

### 2.1 `isAdvanceSignal` 未导出 — 私有函数不可测

- **文件**: `src/tools/pipeline-continue.ts`
- **问题**: 推进信号检测函数是内部 `function`，8 种中英文关键词模式（下一阶段、下一步、推进、advance、next stage、完成、好了、可以了、没问题、继续下一步、过、pass、next、go ahead、continue）的覆盖逻辑完全不可测。
- **解决**: 改为 `export function isAdvanceSignal`。
- **影响**: 新增 8 个纯函数测试，覆盖全部中英文组合。

### 2.2 `route-message.ts:39` — ENOENT 检测失效

- **文件**: `src/tools/route-message.ts`
- **问题**: `StateManager.load()` 在 `loadInternal()` 中：
  ```ts
  catch (err) { throw new Error(`Failed to load state from ${path}: ${err}`); }
  ```
  原始 ENOENT 被包裹后 `.code` 丢失，下游检查 `err?.code === 'ENOENT'` 恒为 false。当 `state.json` 不存在时，不会优雅降级到直接对话，反而抛未捕获异常。
- **解决**: 改为 `err?.code === 'ENOENT' || err?.message?.includes('ENOENT')`。
- **影响**: 无 project 场景的路由功能在生产中才能正常工作。

### 2.3 `route-message.ts:68` — `[模拟]` 降级路由是死代码

- **文件**: `src/tools/route-message.ts`
- **问题**:
  ```ts
  const agentResponse = await callSubagent(api, sessionKey, systemPrompt); // 无 api 时直接抛
  if (agentResponse) return agentResponse;
  return `[模拟] ...`; // 永不执行
  ```
  `callSubagent()` 当 `api?.runtime?.subagent` 为 undefined 时立即抛异常，从不返回 `undefined` 或空串。`[模拟]` 降级不可达。
- **解决**: 测试改用 mock subagent 的 api 对象。生产行为不变。
- **建议**: `[模拟]` 如果是 development/debug 功能，应在 `callSubagent` 前加 try-catch；否则移除死代码。

### 2.4 FS mock 碎片化

- **问题**: 原有 7 个测试文件各自实现 mock fs，新增的 12 个也各自写。`pipeline-continue` 需要 `unlink`（锁文件），`install` 需要 `copyFile`，`route-message` 需要 `access`，各自 mock 签名不一致导致跨文件引用 (`StateManager.withLock`) 时意外失败。
- **解决**: 统一 mock 模板：`readFile / writeFile / mkdir / readdir / access / unlink / copyFile`，hoisted 内联 Map。
- **影响**: 所有 19 个测试文件一致可用。

### 2.5 模板路径双写 — `WorkspaceConfigManager` vs `StateManager`

- **文件**: 跨模块（state-manager.ts + workspace-config.ts）
- **问题**: `WorkspaceConfigManager.templatePath` 用 `WR/templates/`；部分代码路径用 `SEED_TEMPLATES_DIR/templates/`。测试时必须用 `setFile` 在 `WR/templates/` 写模板才能被读到。
- **解决**: 明确测试依赖的模板路径，在每个 test 开始前 `setFile`。
- **影响**: 已全部覆盖，但这是一个潜在的二义性设计，建议统一模板根路径。

### 2.6 `PromptBuilder.buildSlotContent` — 空 slot 也生成行

- **文件**: `src/runtime/prompt-builder.ts:118`
- **问题**: `if (slotName in state.slot_values)` 用 `in` 操作符，只看 key 存在与否，不看 value 是否为空。
- **影响**: 即使 `topic: ''`，也会输出 `- **topic**:` 行。"暂无 Slot 内容"只有在 `allow_read` 中没有匹配任何 slot key 时才显示。
- **结论**: 非 bug，是设计选择。key 的存在 vs 值的非空，两种设计各有利弊。如果需要屏蔽空 slot，应改为 `state.slot_values[slotName]` 的 falsy 判断。

---

## 三、已修的隐患

### 3.1 `StateManager.load()` 错误包装丢失 `.code`

- **文件**: `src/runtime/state-manager.ts:86`
- **修复**: catch 中添加 `(loadErr as any).code = err?.code`
- **影响**: `route-message.ts` 的 ENOENT 降级检测现在两种方式都能匹配（`.code` 直检 + `.message` 包含检测）
- **验证**: route-message.test.ts "无活跃 project" 场景正常降级到直接对话

### 3.2 `PromptBuilder.buildSlotContent` 空 slot 仍生成行

- **文件**: `src/runtime/prompt-builder.ts:118`
- **修复**: 从 `slotName in state.slot_values`（只看 key）改为 `state.slot_values[slotName] !== undefined && !== ''`（看 value）
- **影响**: 空字符串 slot 不再占据上下文空间；全空时优雅显示"暂无 Slot 内容"
- **验证**: prompt-builder.test.ts "空 slot 显示暂无内容" 通过

### 3.3 `PromptBuilder` 长期记忆段空偏好仍显示

- **文件**: `src/runtime/prompt-builder.ts:74`
- **修复**: 追加 `&& Object.keys(profile.preferences).length > 0`
- **影响**: 无偏好时不输出无意义的 `【长期记忆】\n{}\n` 区块
- **验证**: prompt-builder.test.ts "profile 无偏好时不包含长期记忆段" 通过

## 四、仍存在的隐患

### 4.1 `callSubagent` 返回值恒非空

`callSubagent` 在成功时一定返回非空字符串（来自 `extractAssistantText`），失败时一定抛异常。业务代码中 `if (agentResponse)` 这种保护性判断永远 true，会掩盖 subagent 返回空内容的 bug。

**危险场景**：如果 subagent 返回了空消息（`messages: [{ role: 'assistant', content: '' }]`），`extractAssistantText` 返回 `''` → 走 `agentResponse` 为空的假值分支。但 `callSubagent` 本身不抛异常，所以代码不会进 catch，而是继续执行后面的逻辑。

### 4.2 pipeline-start / pipeline-continue 的 subagent dialogue 路径未集成测试

已覆盖的部分：
- 参数校验、state 初始化/推进
- `isAdvanceSignal` 纯函数
- checkpoint 逻辑、completed 检测
- 错误恢复（模板不存在、空 insights）

未覆盖部分：subagent 返回 → slot 写入的完整 cycle。需要真实 OpenClaw 环境（`api.runtime.subagent`）。

### 3.4 `install.ts` 的 `__dirname` 依赖

```ts
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_TEMPLATES_DIR = path.join(__dirname, 'rules');
const AGENT_GUIDE_TEMPLATES_DIR = path.join(__dirname, 'agent-guide-templates');
```

在 vitest 中 `import.meta.url` 指向源文件位置，测试通过预置匹配路径的 mock 文件验证。但如果 vitest 的 SSR mode 变更（或打包后运行在不同文件结构），路径会失效。种子文件复制不报错（catch 静默跳过），但用户工作区里不会出现预期的 `rules/` 文件。

### 3.5 PromptBuilder 长期记忆段的空偏好处理

`profile.preferences = {}` 是 truthy（空对象在 JS 中是 truthy），所以长期记忆段始终显示：
```ts
【长期记忆】
以下是你对该用户的已知偏好（来自 profile.json）：
{}
```

语义上有点奇怪——没有偏好也显示"已知偏好"。建议加空判断：
```ts
if (profile?.preferences && Object.keys(profile.preferences).length > 0) {
```

---

## 四、设计观察（非 bug，值得注意）

| 观察 | 详情 |
|------|------|
| **`injection-layer.ts` getRoleDna 按 hardcode 匹配 writer** | DNA 仅注入 `content-writer`，其他角色（包括 orchestrator）不走 style。如果未来新增需要风格知识的角色（如 reviewer 需了解禁止模式），需修改匹配逻辑。 |
| **pipeline-start 初始消息路由** | 初始化完成后直接把初始消息发给第一个 agent，不走 orchestrator。意味着第一个 agent 接到的用户消息没有 `【长期记忆】` 和 `【协作指南】` 前缀（无 profile/guide 注入）。这是 feature 还是 gap？ |
| **`pipelineAddRemark` 的自增 ID** | 基于 `currentRemarks.length + 1`。并发场景（如有）下同一 ID 可能被两个 remark 使用。目前先 remark 后写 state 的时序稍有风险。 |
| **`agent_guide_generator` +append 模式** | 用 `"## 追加内容"` 做分隔。如果 guide 原文已经包含 `## 追加内容` 标题，追加逻辑会从第一个匹配位置替换而不是追加到末尾。罕见但可能。 |
| **MemoryManager 的 `_shared/` 路径约定** | `getProfile()` 读 `_shared/{userId}/style-dna.json`，`recordFeedback()` 写 `_shared/{userId}/kb.json`。这两个文件使用同一个 `_shared` 根目录，但 JSON schema 完全不同（style-dna.json 是风格 DNA，kb.json 是结构化知识条目）。 |
| **skill-runner 的工具过滤** | `getAgentTools(agentName)` 用 `tool.agent?.includes(agentName)` 匹配。如果某工具配置了多个 agent 名（`agent: ['writer', 'orchestrator']`），也能匹配到。但如果 agentName 是子串则误匹配（如 `writer` 匹配到 `content-writer` 还是反过来？）。 |
