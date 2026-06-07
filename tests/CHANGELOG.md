# 测试变更日志

## 2025-06-05 — 全流程集成测试 + pipeline-start.ts bugfix

### 新增
- `tests/pipeline-flow.test.ts`: 全流程集成测试（8 tests）
  - 3-stage 模板完整流程：初始消息启动→对话→推进→完成
  - 无初始消息启动后手动对话
  - 全 checkpoint 模板每阶段逐步推进（4-step）
  - 2-stage 模板自动推进
  - 错误恢复：executeDialogue 短输出重试
  - 错误恢复：超出重试次数返回 error

### 修改
- `src/tools/pipeline-start.ts`: `current_stage: 0` → `state.current_stage`（消息中的阶段号也同步修正）
- `tests/debug.test.ts`: console.log → 真实 assertion

### 全量
- 24 test files, 226 tests, 全部通过
