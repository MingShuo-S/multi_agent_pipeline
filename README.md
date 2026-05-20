# multi-agent-pipeline 使用指南

通用多 Agent 协作管道框架，为 OpenClaw 生态提供强约束的管道执行与灵活的对话指挥。

## 核心特性

- **Slot 管理**：以数据所有权为核心的 Agent 间数据交换
- **Remark 追溯**：记录每个 Agent 的处理意见和修改日志
- **双层进化记忆**：短期（会话上下文）+ 长期（profile.json）
- **人在回路**：Checkpoint 支持用户在关键阶段介入和调整
- **确定性管道 + 灵活对话**：管道运行时是代码（不会遗忘），指挦家常驻处理乱序消息
- **云端透明管理**：所有配置通过与指挦家的对话完成修改

## 安装

### 标准安装

```bash
openclaw plugins install .
```

### 开发模式（符号链接）

```bash
openclaw plugins install . --link
```

安装后，所有工具会自动注册到 OpenClaw 运行时，`SKILL.md` 会被注入到指挦家的系统提示词中。

## 文件路径约定

所有数据存储基于 `$OPENCLAW_HOME`（默认：`~/.openclaw`）

| 内容 | 路径 |
|------|------|
| 项目管道文件 | `$OPENCLAW_HOME/workspaces/multi-agent-pipeline/projects/<user_id>/<project_id>/state.json` |
| Agent 长期记忆 | `$OPENCLAW_HOME/workspaces/multi-agent-pipeline/agents/<agent_id>-profile.json` |
| Agent 角色定义 | `$OPENCLAW_HOME/agents/<agent_id>/workspace/SOUL.md` |
| Agent 工具声明 | `$OPENCLAW_HOME/agents/<agent_id>/workspace/SKILL.md` |
| 指挦家系统提示词 | `$OPENCLAW_HOME/agents/orchestrator/workspace/SKILL.md` |
| 管道模板示例 | `插件根目录/templates/xiaohongshu-creation/template.json` |

---

## 核心概念

### 1. 双层架构

#### 📌 管道层（Pipeline Layer）

**确定性状态机**，按 `template.json` 硬推进：

- 启动方式：CLI 命令 `multi-agent-pipeline start <template> --user=<user_id> --project=<project_id>`
- 行为：
  1. 读取 `state.json` 获取当前阶段
  2. 从 `template.json` 查询该阶段的 Agent、权限、checkpoint
  3. **派发子 Agent**（通过 RPC 或进程调用，不通过大模型）
  4. 等待 Agent 通过 `pipeline_write_slot` 提交结果
  5. 检查 Slot 值，推进到下一阶段或暂停（checkpoint）
  6. 循环直到完成

- 特点：
  - **完全确定性**：不会遗忘任何阶段，不会跳过 checkpoint
  - **状态持久化**：每一步都记录在 `state.json`，故障后可恢复
  - **人在回路**：Checkpoint 触发暂停，等待用户确认或修改

#### 📌 对话层（Conversation Layer）

**灵活的指挦家常驻进程**，处理用户的乱序消息和配置管理：

- 启动方式：`openclaw run orchestrator`（在另一个终端）
- 职责：
  1. **消息路由**：通过 `route_message` 把用户消息动态路由给任意 Agent 或管道
  2. **配置管理**：通过 `workspace_config` 修改模板、查看/修改记忆
  3. **指南生成**：通过 `agent_guide_generator` 为 Agent 生成协作指南
  4. **Checkpoint 交互**：当管道暂停时，指挦家向用户展示产出并收集反馈

- 特点：
  - **LLM 驱动**：大模型决策何时调用工具、如何响应用户
  - **乱序对话**：用户可在任何时刻与任意 Agent 对话，不受管道阶段限制
  - **轻量主会话**：本身不维护业务上下文，只保留项目状态摘要

### 2. Slot（插槽）— 数据所有权模型

Slot 是管道中的数据容器，核心特性是**所有权**：

```json
{
  "topic_brief": {
    "value": "露营新手装备推荐",
    "owner": "topic-researcher",
    "written_at": "2026-05-21T10:00:00Z",
    "remarks": [...]
  },
  "research_notes": {
    "value": "2025 年露营装备趋势分析...",
    "owner": "web-researcher",
    "written_at": "2026-05-21T10:30:00Z",
    "remarks": [...]
  }
}
```

**关键规则**：

- 每个 Slot 由特定 Agent **独占写入**（通过 `owner` 字段标记）
- 读权限由 `template.json` 中的 `allow_read` 控制
- `pipeline_write_slot` 会验证调用者是否为 Slot owner，非 owner 写入被拒绝
- 一旦写入，其他 Agent 只能通过 `pipeline_read` 读取（不能修改）
- 修改只能由 owner 通过重新调用 `pipeline_write_slot` 来完成

**使用场景**：

- topic-researcher 写入 `topic_brief`，其他 Agent 只能读
- web-researcher 写入 `research_notes`
- content-writer 基于前两者写入 `draft_content`
- 后续 Agent 可读前面的 Slot，但不能改动

### 3. Remark（批注）— 意见与建议追溯

Agent 对 Slot 的评论、建议或警告，记录在 Slot 内的 `remarks` 数组：

```json
{
  "remarks": [
    {
      "id": "r1234567890",
      "from": "quality-reviewer",
      "type": "suggest",
      "text": "第二段可以加入更多具体例子",
      "priority": "normal",
      "resolved": false,
      "created_at": "2026-05-21T10:45:00Z"
    }
  ]
}
```

**特点**：

- 与 Slot 值正交，不阻断流程
- 可选性高——Agent 可自由决定是否采纳建议
- 完整保存，后续 Agent 可查看所有历史批注
- 不受写权限限制，任何 Agent 可添加

**示例流程**：

1. content-writer 写入 `draft_content`
2. quality-reviewer 读取并调用 `pipeline_add_remark` 添加建议
3. 指挦家或用户查看 remarks，决定是否让 content-writer 修改
4. 若修改，复用 content-writer 会话，发送修改指令，新版本覆盖旧版本

### 4. 长期记忆（Profile）— 双层架构

**短期记忆**：

- 子 Agent 的会话对话历史
- 本次任务内自动维护的上下文
- 任务结束后消失

**长期记忆**：

- Agent 对特定用户的已知偏好、风格反馈、规则调整
- 文件路径：`~/.openclaw/workspaces/multi-agent-pipeline/agents/<agent_id>-profile.json`
- 通过 `style_record_feedback` 更新
- 每次新任务自动注入到 Prompt 中

示例 profile：

```json
{
  "agent_id": "content-writer",
  "owner": "user123",
  "rules": [
    {
      "id": "r1",
      "rule": "用口语化、活泼的语气",
      "confidence": 0.8,
      "disabled": false
    }
  ],
  "samples": [
    {
      "id": "s1",
      "type": "positive",
      "content": "用户喜欢开头问句引入",
      "created_at": "2026-05-21T09:00:00Z"
    }
  ],
  "stats": {
    "total_tasks": 5,
    "positive_feedback": 4,
    "negative_feedback": 1
  }
}
```

---

## 10 个工具详解

### 核心工具组（5 个）— 管道协作

#### 工具 1: `pipeline_read`

**作用**：读取管道状态和 Slot 内容

**参数**：

```json
{
  "project_id": "proj_20260519_001"
}
```

**返回**：完整的 `state.json`（当前阶段、所有 Slots、remarks、历史）

**权限**：由 `template.json` 的 `allow_read` 控制

**用途**：指挦家启动时读取状态，Agent 需要时读取上文阶段的产出

---

#### 工具 2: `pipeline_write_slot`

**作用**：写入或更新 Slot 内容

**参数**：

```json
{
  "project_id": "proj_20260519_001",
  "slot_name": "draft_content",
  "value": "初稿内容...",
  "written_by": "content-writer"
}
```

**返回**：成功或失败（若调用者非 owner，返回权限错误）

**权限**：只有 Slot owner 可写，权限检查由 `tool_auth` 完成

**用途**：Agent 提交产出，管道层读取后推进下一阶段

---

#### 工具 3: `pipeline_add_remark`

**作用**：为 Slot 添加批注

**参数**：

```json
{
  "project_id": "proj_20260519_001",
  "slot_name": "draft_content",
  "type": "suggest|warning|question",
  "text": "可以增加更多具体例子",
  "from": "quality-reviewer",
  "priority": "high|normal|low"
}
```

**权限**：无限制，任何 Agent 可添加

**用途**：记录意见，供下一轮参考或用户决策

---

#### 工具 4: `style_get_profile`

**作用**：获取 Agent 对当前用户的已知偏好和规则

**参数**：

```json
{
  "user_id": "user123",
  "agent_id": "content-writer"
}
```

**返回**：Profile 的 rules、samples、stats

**用途**：Agent 在任务开始时调用，自动加载用户偏好

---

#### 工具 5: `style_record_feedback`

**作用**：更新 Agent 的长期记忆（记录用户反馈）

**参数**：

```json
{
  "user_id": "user123",
  "agent_id": "content-writer",
  "feedback": "positive|negative",
  "content": "用户喜欢的文本样本（可选）",
  "note": "开头问句很好，多用这种"
}
```

**用途**：任务完成后调用，让 Agent 从用户反馈中学习

---

### 指挦家工具组（3 个）— 对话和配置

#### 工具 6: `route_message`

**作用**：路由用户消息给指定 Agent，或回复指定问题

**参数**：

```json
{
  "target_agent": "content-writer",
  "message": "能改成更活泼的风格吗？加 emoji",
  "context": {
    "project_id": "proj_20260519_001",
    "current_output": "..."
  }
}
```

**权限**：仅指挦家可调用

**用途**：

- **Checkpoint 反馈**：用户提修改意见，路由给原 Agent
- **乱序对话**：用户随时想和某个 Agent 聊天，路由给它
- **实时咨询**：用户问"怎样写得更好"，路由给相关 Agent

---

#### 工具 7: `workspace_config`

**作用**：查看和修改工作区配置（模板、记忆、指南）

**参数**：

```json
{
  "action": "read_template|write_template|read_memory|write_memory|list_templates",
  "template_name": "xiaohongshu-creation",
  "user_id": "user123",
  "agent_id": "content-writer",
  "content": {...}
}
```

**权限**：仅指挦家可调用

**用途**：

- 查看现有模板：`action: "list_templates"`
- 修改 Slot、Stage、权限：`action: "write_template"`
- 查看记忆：`action: "read_memory"`
- 编辑偏好：`action: "write_memory"`

---

#### 工具 8: `agent_guide_generator`

**作用**：为 Agent 生成或更新协作指南

**参数**：

```json
{
  "agent_id": "content-writer",
  "instructions": "在这个项目中，你需要...",
  "template_name": "xiaohongshu-creation"
}
```

**权限**：仅指挦家可调用

**用途**：

- 项目启动时生成角色指南
- 中途发现 Agent 需要调整时更新指南
- 指南保存在 `~/.openclaw/workspaces/multi-agent-pipeline/guides/<agent_id>-<project_id>.md`

---

### 辅助工具组（2 个）— 执行日志

#### 工具 9: `execution_log_append`

**作用**：记录 Agent 的执行步骤和总结

**参数**：

```json
{
  "project_id": "proj_20260519_001",
  "agent_id": "content-writer",
  "entry": {
    "stage": "writing",
    "summary": "生成初稿 800 字，采纳了主题研究员的建议",
    "status": "completed|in_progress|failed",
    "duration_ms": 5000
  }
}
```

**用途**：

- 完整的审计日志
- 故障排查和流程重放
- 性能监控

---

#### 工具 10: `execution_log_read`

**作用**：查看 Agent 的执行日志

**参数**：

```json
{
  "project_id": "proj_20260519_001",
  "agent_id": "content-writer",
  "limit": 10
}
```

**返回**：最近 N 条执行记录

---

## ⚠️ 重要：Agent 工具白名单合并

在管道执行时，**Agent 仍然可以调用为它配置的所有原有工具**来完成专家任务（例如调用搜索、编程、设计工具等）。

**但是**，Agent **必须** 通过 `pipeline_read` / `pipeline_write_slot` / `pipeline_add_remark` 来：

- 获取协作上下文（读取上一阶段的产出）
- 提交结果到管道（让下一阶段可用）
- 记录意见和建议（供其他 Agent 参考）

否则，它的产出**无法进入管道**，下一个 Agent 看不到。

---

## 快速开始

### Step 1: 安装插件

```bash
openclaw plugins install . --link
```

### Step 2: 准备 Agent

为每个参与者创建 Agent 及其配置：

```bash
openclaw agents add topic-researcher
openclaw agents add web-researcher
openclaw agents add content-writer
openclaw agents add quality-reviewer
openclaw agents add publisher
openclaw agents add orchestrator  # 指挦家
```

每个 Agent 需要 `SOUL.md`（角色定义）、`SKILL.md`（工具声明）。

指挦家（orchestrator）的 `SKILL.md` 应该包含：

```yaml
tools:
  - route_message
  - workspace_config
  - agent_guide_generator
  - pipeline_read
  - pipeline_add_remark
```

其他 Agent 的 `SKILL.md` 应该包含：

```yaml
tools:
  - pipeline_read
  - pipeline_write_slot
  - pipeline_add_remark
  - style_get_profile
  - style_record_feedback
  - [原有的专家工具，如搜索、代码生成等]
```

### Step 3: 准备模板和项目

创建 `~/.openclaw/workspaces/multi-agent-pipeline/projects/<user_id>/<project_id>/state.json`：

```json
{
  "template_name": "xiaohongshu-creation",
  "current_stage": 0,
  "current_stage_name": "topic-research",
  "slot_values": {
    "topic_brief": "",
    "research_notes": "",
    "draft_content": "",
    "final_output": ""
  },
  "remarks": [],
  "status": "running"
}
```

### Step 4: 启动管道（通过对话驱动）

**完全通过 Dashboard 对话完成，无需 SSH 或 CLI。**

用户在 Dashboard 与指挦家对话：

```
User: "用小红书模板帮我创作一篇露营笔记，用户 alice，项目 camping-post"

Orchestrator (指挦家):
  1. 识别意图
  2. 调用 pipeline_start(template_name: "xiaohongshu-creation", 
                          user_id: "alice", 
                          project_id: "camping-post")
  
  [系统执行]
  ✓ 初始化 state.json
  ✓ Stage 0: topic-researcher 完成 topic_brief
  ✓ Stage 1: web-researcher 完成 research_notes
  ✓ Stage 2: content-writer 完成 draft_content (checkpoint!)
  
Orchestrator 返回：

"✅ 已完成：draft-writing 阶段

内容已写入 draft_content，请检查：
---
露营新手装备推荐
这个春天，如果你还没想好去哪玩...
---

输入'agree'继续发布，或直接说修改意见。"

---

User: "太正式了，改得活泼点，加 emoji"

Orchestrator:
  调用 pipeline_continue(user_id: "alice", 
                        project_id: "camping-post",
                        feedback: "太正式了，改得活泼点，加 emoji")
  
  [系统执行]
  ✗ 反馈不是 "agree"
  → 路由给 content-writer 修改
  → content-writer 在同一会话中修改产出
  → 覆盖 draft_content

Orchestrator 返回：

"✅ 已重新提交。请确认修改是否满意，或继续反馈。

---
🏕️ 露营新手装备推荐，超实用！
春天到了，想出去玩但不知道怎么准备？别怕...
---"

---

User: "agree"

Orchestrator:
  调用 pipeline_continue(user_id: "alice", 
                        project_id: "camping-post",
                        feedback: "agree")
  
  [系统执行]
  ✓ 推进 stage++
  ✓ Stage 3: quality-reviewer 完成 review_feedback
  ✓ Stage 4: publisher 完成 final_output (最后一个)
  ✓ 管道完成

Orchestrator 返回：

"✨ 小红书笔记已发布！

最终版本：
---
🏕️ 露营新手装备推荐，超实用！
...（最终版本）
---

整个流程已完成。下次继续？"
```

---

## 12 个工具完整列表

### 核心工具组（5 个）— 管道协作

- `pipeline_read` - 读取 Slot 和管道状态
- `pipeline_write_slot` - 写入 Slot（只有 owner 可写）
- `pipeline_add_remark` - 为 Slot 添加批注
- `style_get_profile` - 获取 Agent 的长期记忆
- `style_record_feedback` - 记录用户反馈并更新记忆

### 指挦家工具组（5 个）— 对话和配置

- `route_message` - 路由消息给指定 Agent
- `workspace_config` - 查看/修改模板和记忆
- `agent_guide_generator` - 为 Agent 生成协作指南
- `pipeline_start` - 启动管道，执行到第一个 checkpoint
- `pipeline_continue` - 处理反馈，推进管道或修改当前阶段

### 辅助工具组（2 个）— 执行日志

- `execution_log_append` - 记录 Agent 执行步骤
- `execution_log_read` - 查看 Agent 执行日志

---

## 典型使用场景

### 场景 1: 简单对话启动（Dashboard 一次完成）

```
用户: "用小红书模板创作露营笔记，alice，camping"
↓
指挦家调用 pipeline_start → 自动执行所有非 checkpoint 阶段 → 暂停
指挦家: "✅ 初稿已完成，请检查..."
用户: "agree"
↓
指挦家调用 pipeline_continue → 推进到下一 checkpoint 或完成
指挦家: "✨ 已发布！"
```

### 场景 2: 多轮修改（Dashboard 中持续反馈）

```
指挦家: "✅ 初稿已完成，请检查..."
用户: "改活泼点，加 emoji"
↓
指挦家调用 pipeline_continue(feedback: "改活泼点...")
系统路由给 content-writer 修改并重新提交
指挦家: "✅ 已修改，请确认..."
用户: "很好，agree"
↓
指挦家调用 pipeline_continue(feedback: "agree")
推进下一阶段...
```

### 场景 3: 乱序对话（中途咨询其他 Agent）

```
[管道运行中，暂停在 checkpoint]
用户: "先问问 web-researcher 有没有最新的露营数据"
↓
指挦家调用 route_message(target: "web-researcher", message: "...")
web-researcher 回答相关数据
↓
用户: "用这个信息改一下草稿，改活泼点"
↓
指挦家调用 pipeline_continue(feedback: "用...改活泼点")
系统路由给 content-writer 修改
↓
用户: "好的，agree"
↓
管道继续推进
```

---

### Q: Slot 被其他 Agent 改了怎么办？

**A**: 插件会在 `pipeline_write_slot` 时验证权限。如果 Agent A 没有写入 Slot X 的权限（不是 owner），调用会被拒绝并返回明确错误。

### Q: Agent 执行失败了怎么办？

**A**: 

1. 在 `execution_log_append` 中记录 `status: "failed"`
2. 指挦家根据失败原因决策：
   - 重试：再次 route_message 给该 Agent
   - 跳过：修改 `state.json` 的 `current_stage`，推进到下一阶段
   - 中止：停止管道，等待用户修复

### Q: 如何在多个项目间复用 Agent？

**A**: Agent 是全局配置（在 `~/.openclaw/agents/` 下），每个项目有独立的 `project_id`。同一个 Agent 可同时参与多个项目的管道，各自维护不同的 profile（基于 user_id）。

### Q: 能否条件分支（如果用户不满意就回到编辑）？

**A**: 可以。指挦家根据用户反馈决策：

- **同意**：调用 `pipeline_read`，检查 `current_stage`，推进到下一阶段
- **修改**：路由给原 Agent，让它修改并重新提交
- **回到上一阶段**：修改 `state.json` 的 `current_stage`

### Q: 如何监控整个项目的执行？

**A**: 

1. 查看 `state.json` 的 `current_stage_name` 和 `slot_values`
2. 读取 `execution_log_read` 查看每个 Agent 的处理历程
3. 查看每个 Slot 的 `remarks` 了解意见交换

---

## 许可证

MIT
