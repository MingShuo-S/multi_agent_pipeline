# 工具添加指导

> 新增一个工具需要改 4 个地方，缺失任一环节工具就不会被正确暴露给 Agent。

---

## 四步流程

```
1. src/index.ts       ← 注册工具（定义参数、实现逻辑）
2. 架构文档            ← 更新各 Agent 的工具权限表
3. agent-configs/*     ← 更新对应 Agent 的 SKILL.md
4. templates/*.json    ← 如果工具需要 slot 权限，更新 stage.allow_*
```

---

## Step 1: 注册工具

`src/index.ts` 的 `tools: (tool) => [...]` 数组中用 `tool({...})` 注册。

```ts
tool({
  name: 'my_new_tool',              // 工具名，Agent 用此名调用
  label: 'my_new_tool',             // 显示标签（通常同 name）
  description: '一句话说明',         // 写入 Agent 可读描述
  parameters: Type.Object({         // 参数 schema（typebox）
    param1: Type.String({ description: '参数说明' }),
    param2: Type.Optional(Type.Number({ default: 10 })),
  }),
  async execute(params, _config, ctx) {
    try {
      const c = toolCtx(ctx);       // 获取当前上下文
      const p = params as any;
      const result = await myFunc(c.workspace_root, c.user_id, p.param1);
      return result;
    } catch (err) {
      return `错误: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
}),
```

### 注意事项

| 规则 | 说明 |
|------|------|
| 所有工具在 `index.ts` 注册后对所有 Agent 可见 | 工具层无权限控制（权限在 slot 层 `ToolAuth`） |
| 返回值必须是字符串 | Agent 不需要 JSON 对象，序列化好再返回 |
| `toolCtx(ctx)` 提供 `agent_name`, `user_id`, `project_id`, `workspace_root`, `api` | 框架自动注入，不需要手动解析 ctx |
| 异常必须 catch | 不 catch 导致工具调用失败，Agent 会看到 raw error |
| 工具名用 snake_case | 遵循现有命名 `pipeline_read`, `snapshot_create` 等 |

---

## Step 2: 更新架构文档

在 `部虾创5个Agent详细配置.md` 的 `## 中央工具分区矩阵` 表中 Y/— 对应行。

> 加工具**只改此一个表**，不再逐个 Agent 修改。每个 Agent 的 `### 工具权限` 段仅保留 `详见中央工具分区表` 一行引用。

### 分区原则

| 工具类型 | 该给谁 | 示例 |
|---------|--------|------|
| **通用读** | 所有 Agent | `pipeline_read`, `snapshot_read`, `session_note_read` |
| **通用检索** | 所有 Agent | `session_search` |
| **通用写** | 所有 Agent（会写笔记的） | `session_note_write` |
| **角色专属读** | 只需要该角色的 | `style_get_context` → only content-writer |
| **角色专属写** | 只需要该角色的 | `style_write_profile` → only content-writer |
| **系统操作** | 特定角色 | `memory_compress` → only post-analyst |
| **危险操作** | 特定角色才给 | `group:web` → 需要联网验证的角色 |

### 决策检查表

添加新工具时自问：

- [ ] 这个工具是否所有 Agent 都需要？
- [ ] 如果是 → 加到所有 Agent 的表里
- [ ] 如果否 → 只加到需要的 Agent 表里
- [ ] 是否涉及 slot 读写？→ 还需更新 pipeline stage 的 `allow_read`/`allow_write`

---

## Step 3: 更新 SKILL.md

每个 Agent 的 `agent-configs/{agent}-SKILL.md` 是加载到 Agent system prompt 的工具参考。

必须更新：

1. **工具表** — 新增的行，说明用途和使用场景
2. **记忆/工作流模式** — 如果有推荐的使用顺序（如"先 `snapshot_read` 再写作"）

SKILL.md 是 Agent **运行时**的唯一工具文档。如果只改架构文档不改 SKILL.md，Agent 不知道有新工具。

### 目前文件清单

| Agent | SKILL.md 状态 | 路径 |
|-------|--------------|------|
| topic-researcher | ✅ 有，已更新 | `agent-configs/topic-researcher-SKILL.md` |
| content-writer | ✅ 有，已创建 | `agent-configs/content-writer-SKILL.md` |
| quality-reviewer | ✅ 有，已创建 | `agent-configs/quality-reviewer-SKILL.md` |
| publisher | ✅ 有，已创建 | `agent-configs/publisher-SKILL.md` |
| post-analyst | ✅ 有，已创建 | `agent-configs/post-analyst-SKILL.md` |

---

## Step 4: 更新模板 Slot 权限（如需要）

模板文件 `workspace/templates/{template}.json` 中的 `stages[].allow_read` / `allow_write` 控制 Slot 访问。

如果新工具涉及读写新的 slot，需要在对应 stage 添加：

```json
{
  "stages": [
    {
      "id": "topic-research",
      "agent": "topic-researcher",
      "allow_read": ["*"],
      "allow_write": ["topic_brief", "research_notes"]
    }
  ]
}
```

### Slot 权限 vs 工具权限

| 权限层 | 控制什么 | 谁执行 |
|--------|---------|--------|
| `ToolAuth` (slot 层) | Agent 能读/写哪些 slot | `pipeline_read` / `pipeline_write_slot` 调用时校验 |
| 工具注册 (工具层) | Agent 能调用哪些工具 | 在 `index.ts` 统一注册，无白名单机制 |
| SKILL.md (指导层) | Agent 知道有哪些工具可用 | 加载到 system prompt，不强制 |

**关键理解**：工具层的权限是"所有已注册的工具所有 Agent 都能调"。你无法在 `index.ts` 中限制某个 Agent 不能调某个工具。如果想限制，需要在 `execute` 内部检查 `agent_name`。目前使用约定式控制（SKILL.md 指导 + 架构文档规范），不打算增加运行时工具鉴权的复杂度。

---

## 工具分区矩阵（规范源）

**规范源**：`部虾创5个Agent详细配置.md` → `## 中央工具分区矩阵`。

加工具时直接在那张表上改，保持为唯一规范。这里不再重复。`TOOLS.md` 保持同步副本供快速参考。

---

## 常见错误

| 错误 | 表现 | 修复 |
|------|------|------|
| 工具只在 `index.ts` 注册，没写 SKILL.md | Agent 不知道有这工具，从不调用 | 更新 SKILL.md 工具表 |
| 工具只在 SKILL.md 写，没在 `index.ts` 注册 | Agent 调用时报"工具不存在" | 在 `index.ts` 注册 |
| 返回值不是字符串 | Agent 收到 `[object Object]` | 手动序列化 `JSON.stringify()` |
| 异常不 catch | Agent 收到 raw error stack | 加 `try/catch` 返回友好消息 |
| 忘了加参数 schema | TypeBox schema 不全时工具调用失败 | 所有参数都要 `description` |
| 只改架构文档不改 SKILL.md | 架构文档过期（问题相反：人看的是对的但 Agent 不知道） | 两边同步改 |
