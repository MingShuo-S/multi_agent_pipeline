# 风格学习系统实现

## 变更内容

三大核心设计全部落地：

### 1. 风格系统（Voiceprint 入站 + 硬注入）
- `types.ts`: 新增 StyleDNA、StyleProfile、KBEntry、CorrectionSignal、InjectionBlock、AgentRole 类型
- `tools/style-system.ts`: 新建，管理 `_shared/{userId}/` 下风格 DNA + 知识库读写
- `runtime/injection-layer.ts`: 新建，为不同 AgentRole 构建硬注入文本（content-writer → 风格 DNA 头注入，其他 → 工作区规则尾注入）
- `prompt-builder.ts`: 重写，prompt 组装改为 8 段式（注入头 + 角色 + 协作 + 记忆 + 上下文 + 指南 + 任务 + 注入尾）
- 旧 `profile.json` 结构保留兼容，新增 `_shared/{userId}/` 共享路径

### 2. pipeline-continue 拦截
- `pipeline-continue.ts`: 新增 `detectStyleSignals()` 函数，从用户消息中提取三种信号（纠正/禁止/正面）
- 每次对话前拦截分析，提取到信号后自动写入知识库
- 信号检测模式：`不是 X` 纠正、`不要用/别用/去掉` 禁止、`不赖/不错/可以` 正面

### 3. 工作区路径修复
- `config.ts`: WORKSPACE_ROOT 改为 `path.join(__dirname, '..', 'workspace')`，不再依赖 HOME 目录
- 新增 `SHARED_DIR` 常量导出
- `install.ts`: 初始化时创建 `_shared/` 目录结构
- WORKSPACE_TOPOLOGY.md: 新文件，详述目录结构 + 相对 .openclaw 位置

### 4. 解除 KNOWN_AGENTS 硬编码
- `workspace-config.ts`: 移除 agent 名校验，任何 agent 名都可写入模板

### 5. 新工具注册
`openclaw.plugin.json`: 新增 5 个工具合约
- style_read_profile
- style_write_profile
- style_extract_signal
- kb_write
- kb_read

`index.ts`: 注册上述 5 个工具，新增 StyleSystem 和 InjectionLayer 导出

## 未改动的文件

- `scripts/` 下所有 deploy 文件（deploy.sh, patch-*.py, gen-deploy.ps1, deploy-files.py）
- `cli.ts`: 未修改
- `pipeline-runner.ts`: 未修改（CLI 模式，非生产路径）
- `templates/`: 未修改
- `route-message.ts`: 未修改
- `tool-auth.ts`: 未修改
- `state-manager.ts`: 未修改
- `skill-runner.ts`: 未修改
- `pipeline.ts`: 未修改
- `pipeline-start.ts`: 未修改
- `pipeline-status.ts`: 未修改
- `agent-guide-generator.ts`: 未修改

## 注意事项

- 工作区路径由 `__dirname` 自动推导，不同机器 npm 安装位置不同但都能正确解析
- 旧 `~/.openclaw/workspaces/multi-agent-pipeline/` 路径可废弃，旧项目数据需手动迁移
- 子 agent 需要正确配置 `workspace_root`（通过 openclaw.json 或 ToolContext 透传）
