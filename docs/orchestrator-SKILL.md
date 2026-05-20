# 指挥家 - SKILL.md 示例

指挥家需要声明以下工具来执行管道协调、模板管理和 Agent 对话路由的职责。

## 工具声明

```yaml
tools:
  # 管道工具 - 用于读取和记录管道的运行状态
  - name: pipeline_read
    description: 读取当前管道中某个 Slot 的内容
    
  - name: pipeline_add_remark
    description: 向管道添加评论或备注（如用户反馈、决策记录等）

  # 工作区配置工具 - 用于管理模板和 Agent 记忆
  - name: workspace_config
    description: |
      管理工作区的配置、模板和 Agent 记忆
      支持操作：
      - list_templates: 列出所有模板
      - read_template: 读取指定模板
      - write_template: 创建或更新模板
      - read_memory: 查看 Agent 对用户的记忆
      - write_memory: 更新 Agent 记忆
      - reset_template: 删除模板

  # Agent 指南生成工具 - 用于生成协作指南
  - name: agent_guide_generator
    description: |
      为指定 Agent 生成或更新协作指南
      帮助 Agent 理解与其他 Agent 的协作规则和要求

  # 消息路由工具 - 用于与 Agent 对话
  - name: route_message
    description: |
      将消息路由给指定的 Agent
      用于：
      - 用户想与特定 Agent 直接对话
      - Checkpoint 阶段的快速反馈循环
      - 特殊指导或修改要求
      注意：仅限 orchestrator 使用
```

## 使用示例

### 查看模板列表

```
调用: workspace_config(action="list_templates")
返回: ["xiaohongshu-creation", "blog-creation", ...]
```

### 读取模板

```
调用: workspace_config(
  action="read_template",
  template_name="xiaohongshu-creation"
)
返回: {
  "name": "xiaohongshu-creation",
  "description": "...",
  "stages": [...],
  "slots": {...}
}
```

### 创建自定义模板

```
调用: workspace_config(
  action="write_template",
  template_name="my-custom-template",
  content={新模板的完整定义}
)
```

### 查看 Agent 记忆

```
调用: workspace_config(
  action="read_memory",
  user_id="alice",
  agent_name="content-writer"
)
返回: {
  "agent": "content-writer",
  "user_id": "alice",
  "preferences": {
    "style": "口语化、活泼",
    "avoid": ["学术化"],
    "feedback_log": [...]
  }
}
```

### 更新 Agent 记忆

```
调用: workspace_config(
  action="write_memory",
  user_id="alice",
  agent_name="content-writer",
  content={更新后的记忆}
)
```

### 生成协作指南

```
调用: agent_guide_generator(
  agent_name="content-writer",
  instructions="""
  协作指南内容...
  - 注意事项 1
  - 注意事项 2
  """,
  append=false  # 覆盖现有指南
)
```

### 与 Agent 对话

```
调用: route_message(
  target_agent="content-writer",
  message="用户消息或指导内容"
)
返回: Agent 的回复
```

## 典型工作流

### 工作流 1: 启动新项目

1. 调用 `workspace_config(action="list_templates")` 获取可用模板
2. 调用 `workspace_config(action="read_template", template_name=...)` 查看模板详情
3. 根据需要调用 `workspace_config(action="write_template", ...)` 定制模板
4. 调用 `agent_guide_generator(...)` 生成协作指南（如需要）
5. 准备启动管道（通过 CLI）

### 工作流 2: Checkpoint 反馈处理

1. 管道在 checkpoint 处停止
2. 用户提供反馈和修改要求
3. 调用 `route_message(target_agent=当前阶段的Agent, message=用户反馈)`
4. Agent 修改产出
5. 调用 `pipeline_add_remark(content=用户反馈内容)` 记录
6. 继续管道执行

### 工作流 3: 更新 Agent 记忆

1. 用户表达了某种风格偏好
2. 调用 `workspace_config(action="read_memory", ...)` 查看当前记忆
3. 根据用户的新反馈更新记忆对象
4. 调用 `workspace_config(action="write_memory", ...)` 保存

## 权限说明

- **workspace_config**: 仅指挥家可用
- **agent_guide_generator**: 仅指挥家可用
- **route_message**: 仅指挥家可用
- **pipeline_read**: 指挥家可用，同时也注册给执行管道的所有 Agent
- **pipeline_add_remark**: 指挥家可用，同时也注册给执行管道的所有 Agent

## 与其他 Agent 的配置差异

| Agent | 工具集 |
|------|--------|
| orchestrator（指挥家） | pipeline_read, pipeline_add_remark, workspace_config, agent_guide_generator, route_message |
| content-writer | pipeline_read, pipeline_write_slot, pipeline_add_remark, style_get_profile, style_record_feedback, + 自有工具 |
| quality-reviewer | pipeline_read, pipeline_write_slot, pipeline_add_remark, style_get_profile, style_record_feedback, + 自有工具 |
| ... | ... |

总原则：
- **指挥家** 不能写 slot，只能读、记录和配置
- **工作 Agent** 不能直接修改工作区配置，只能读写 slot 和更新自己的记忆
