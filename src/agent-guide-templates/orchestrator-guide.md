# orchestrator 管道协作指南

> 工作区根: `_shared/` 在 pipeline 插件的 workspace 下（自动注入）
> 规则文档: `workspace/rules/`（温度分层、检索补全、条件反射、防幻觉）
> Voiceprint 详细指导: `workspace/agent-guides/voiceprint-guide.md`

---

## 第一步：检查风格 DNA（pipeline 启动前必须做）

用户第一次使用或尚无风格 DNA 时，**必须先做 voiceprint，再启动 pipeline**。

```
1. voiceprint_init()
   → 如果 state.step === 0，展示提示让用户写文字
   → 如果 state.step >= 99，跳过（已有完成状态）
   → 否则从断点恢复

2. 按 10 步流程收集样本 + 校准 + 分析 + 确认
   （每一步用对应 voiceprint_* 工具，返回的 prompt 直接展示给用户）
   详细步骤见 voiceprint-guide.md

3. 确认完成后，再调用 pipeline_start
```

**不做 voiceprint → content-writer 收不到风格约束 → 输出不带用户风格。**

---

## 第二步：启动 pipeline

```
pipeline_start({ template_name, user_id, project_id, initial_message })
```

pipeline 启动后所有用户消息都走 `pipeline_continue`。

| 你发什么 | 结果 |
|----------|------|
| 普通对话 | 路由给当前阶段专家 |
| "下一阶段"/"advance"/"完成" | 推进到下一阶段 |
| 纠正（"不是X"/"不要用Y"） | 自动拦截写入 style-dna.json |

---

## 可用工具速查

| 工具 | 谁用 | 用途 |
|------|------|------|
| `voiceprint_init` | orchestrator | 创建/恢复 voiceprint 状态机 |
| `voiceprint_proceed` | orchestrator | 存写作样本并推进步骤 |
| `voiceprint_calibrate` | orchestrator | 偏好校准（句长/emoji/语气） |
| `voiceprint_analyze` | orchestrator | 写入子 agent 分析结论 |
| `voiceprint_confirm` | orchestrator | 确认锁定风格 DNA |
| `voiceprint_reset` | orchestrator | 重置 voiceprint 重新开始 |
| `style_read_profile` | 所有 agent | 读取风格 DNA |
| `style_write_profile` | content-writer | 写入风格 DNA |
| `style_extract_signal` | 所有 agent | 手动记录纠正信号 |
| `kb_write` | 所有 agent | 写入知识库 |
| `kb_read` | 所有 agent | 读取知识库 |
| `style_get_context` | content-writer | 拉取完整风格上下文 |
| `route_message` | orchestrator | 路由给指定 agent（步骤 9 分析用） |
