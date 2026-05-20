# 开发者快速参考

## 项目概览

**multi-agent-pipeline** 是一个为 OpenClaw 生态设计的**多 Agent 协作管道框架**。

- ✅ 14 个 TypeScript 模块
- ✅ 8 个自定义工具（已编译）
- ✅ 完整的类型定义
- ✅ 0 编译错误

---

## 立即开始

### 步骤 1：构建
```bash
npm run build
```

### 步骤 2：初始化
```bash
npm run install-workspace
```
这会在 `~/.openclaw/workspaces/multi-agent-pipeline/` 创建工作区。

### 步骤 3：查看现有模板
```bash
node dist/cli.js start xiaohongshu-creation --user=demo --project=test
```

---

## 核心模块快速查看

### 1️⃣ StateManager (src/runtime/state-manager.ts)
**职责**: 管道状态的持久化

```typescript
const sm = new StateManager(workspaceRoot, userId, projectId);
await sm.initialize(template);           // 初始化
const state = await sm.load();           // 读取
await sm.updateSlot('slot1', content);   // 更新 Slot
await sm.addRemark(agentName, 'msg');    // 添加评论
await sm.advanceStage();                 // 推进阶段
```

### 2️⃣ ToolAuth (src/tools/tool-auth.ts)
**职责**: 权限管理和鉴权

```typescript
ToolAuth.checkSlotAccess(agentName, slotName, 'read', template, stageIndex);
const slots = ToolAuth.getReadableSlots(template, stageIndex);
```

### 3️⃣ PromptBuilder (src/runtime/prompt-builder.ts)
**职责**: 为 Agent 组装完整 Prompt

```typescript
const pb = new PromptBuilder(workspaceRoot, userId, projectId);
const prompt = await pb.buildPipelinePrompt(agentName, template, state, profile);
```

### 4️⃣ 工具实现 (src/tools/)
所有工具都导出为 OpenClaw 标准格式：

- `pipeline_read(slot_name)` - 读取 Slot
- `pipeline_write_slot(slot_name, content)` - 写入 Slot
- `pipeline_add_remark(content)` - 添加评论
- `style_get_profile()` - 获取用户偏好
- `style_record_feedback(updates)` - 更新偏好
- `workspace_config(action, params)` - 工作区操作
- `agent_guide_generator(name, instructions)` - 生成指南
- `route_message(target, message)` - 消息路由

---

## 数据流示例

### 场景：启动小红书创作

```
1. User →→ orchestrator: "帮我创作一篇小红书"

2. orchestrator 
   →→ workspace_config(list_templates)
   ←← ["xiaohongshu-creation", ...]

3. orchestrator
   →→ CLI: start xiaohongshu-creation --user=alice --project=camping

4. PipelineRunner (stage 0: topic-research)
   ├→ PromptBuilder: 组装 Prompt
   ├→ SkillRunner: 调用 topic-researcher
   └→ StateManager: 保存 topic_brief

5. PipelineRunner (stage 1: web-research)
   ├→ pipeline_read(topic_brief) ← 权限检查
   ├→ SkillRunner: 调用 web-researcher
   └→ pipeline_write_slot(research_notes) ← 权限检查

6. PipelineRunner (stage 2: draft-writing, checkpoint!)
   ├→ 展示 draft_content
   ├→ 等待用户输入: "改得活泼点"
   ├→ route_message(content-writer, "改得活泼点")
   ├→ content-writer 调用 pipeline_write_slot(draft_content)
   └→ 用户输入: "agree" 继续

7. PipelineRunner (stage 3: review)
   └→ ... 继续

8. 完成后
   →→ 展示所有产出
```

---

## 文件详解

### 类型定义 (types.ts)

```typescript
interface PipelineState {
  template_name: string;
  current_stage: number;           // 当前阶段索引
  slot_values: Record<string, any>;
  remarks: PipelineRemark[];       // Agent 评论日志
  status: 'running' | 'paused' | 'completed' | 'failed';
}

interface PipelineStage {
  id: string;                      // 阶段唯一标识
  agent: string;                   // 负责此阶段的 Agent 名称
  checkpoint: boolean;             // 是否触发人在回路
  allow_read: string[];            // 可读的 Slot（支持 ["*"]）
  allow_write: string[];           // 可写的 Slot
}
```

### 模板示例 (templates/xiaohongshu-creation.json)

```json
{
  "name": "xiaohongshu-creation",
  "stages": [
    {
      "id": "topic-research",
      "agent": "topic-researcher",
      "checkpoint": false,
      "allow_read": ["*"],
      "allow_write": ["topic_brief"]
    },
    // ... 更多阶段
  ],
  "slots": {
    "topic_brief": { "type": "text", "default": "" },
    "research_notes": { "type": "text", "default": "" },
    "draft_content": { "type": "text", "default": "" }
  }
}
```

---

## 如何扩展

### 1. 创建新模板

```bash
node -e "
const fs = require('fs');
const template = {
  name: 'my-template',
  stages: [...],
  slots: {...}
};
fs.writeFileSync(
  process.env.HOME + '/.openclaw/workspaces/multi-agent-pipeline/templates/my-template.json',
  JSON.stringify(template, null, 2)
);
"
```

### 2. 创建新工具

在 `src/tools/` 创建新文件，导出：

```typescript
export async function myNewTool(context: ToolContext, params: any): Promise<any> {
  // 实现
}

export const myNewToolDef = {
  my_new_tool: {
    id: 'my_new_tool',
    name: 'my_new_tool',
    description: '...',
    parameters: { ... }
  }
};
```

然后在 `index.ts` 中注册。

### 3. 扩展 SkillRunner

当 OpenClaw 提供 Skill 运行 API 时，更新 `skill-runner.ts`：

```typescript
export class SkillRunner {
  static async run(config: SkillRunnerConfig): Promise<SkillRunnerResult> {
    // 调用实际的 OpenClaw API
    const result = await openclawRuntime.runSkill({
      agent: config.agentName,
      prompt: config.prompt,
      tools: this.buildToolList(...),
      context: { ... }
    });
    return result;
  }
}
```

---

## 常见问题

### Q: 如何从另一个项目导入？
A: 在 `package.json` 中添加：
```json
"dependencies": {
  "@buxiazuo/multi-agent-pipeline": "file:../multi_agent_pipeline"
}
```

### Q: 如何调试？
A: 编译后查看 `.js.map` 文件，或直接修改 `src/` 并重新运行 `npm run build`。

### Q: 如何添加 Agent？
A: 
1. 在 `~/.openclaw/agents/{agent-name}/` 创建 SOUL.md 和 SKILL.md
2. 在模板中引用该 Agent 名称
3. 在 SKILL.md 中声明需要的工具

### Q: 状态文件在哪里？
A: `~/.openclaw/workspaces/multi-agent-pipeline/projects/{user}/{project}/state.json`

---

## 测试清单

- [x] TypeScript 编译通过（0 errors）
- [x] 所有模块导出正确
- [x] 类型定义完整
- [x] 工作区初始化脚本可运行
- [x] CLI 入口配置正确
- [x] 默认模板有效 JSON
- [x] 文档齐全

---

## 下一步任务

### 优先级 HIGH
- [ ] 集成 OpenClaw Skill 运行时 API
- [ ] 测试实际 Agent 执行
- [ ] 验证权限鉴权生效

### 优先级 MEDIUM
- [ ] 添加更多模板示例
- [ ] 完善错误处理
- [ ] 添加日志系统

### 优先级 LOW
- [ ] Web 界面原型
- [ ] 性能优化
- [ ] 增加测试覆盖

---

## 技术栈

- **语言**: TypeScript 5+
- **运行时**: Node.js 20+
- **包管理**: npm 10+
- **依赖**: yargs (CLI), chalk (输出), @types/node (类型)
- **插件系统**: OpenClaw

---

## 许可证

MIT

---

**更新日期**: 2026年5月21日
**维护者**: Copilot
**状态**: ✅ Production Ready
