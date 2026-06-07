# 部虾做 — Multi-Agent Pipeline 插件设计

> OpenClaw 插件：多 Agent 接力流水线引擎
> 包名: `@buxiazuo/multi-agent-pipeline`
> 最后更新: 2026-06-04

---

## 0. 身份定位

| 层 | 名称 | 说明 |
|----|------|------|
| 底层框架 | **部虾做** | 本插件。通用多 Agent 协作框架，OpenClaw 插件形态 |
| 上层应用 | **部虾创** | 框架孵化的第一个产品：小红书内容创作助手 |

赛后部虾做将拆出为独立框架，不依赖 OpenClaw。

架构一言蔽之：**部署一套龙虾（Agents），让你不再瞎做。**

---

## 1. 当前已有架构

### 1.1 已注册的工具（11 个）

| 工具 | 用途 | 调用者 |
|------|------|--------|
| `pipeline_read` | 读当前阶段允许的 Slot | 所有 agent |
| `pipeline_write_slot` | 写入 Slot（权限隔离） | 当前阶段 agent |
| `pipeline_add_remark` | 加批注（版本化） | 所有 agent |
| `pipeline_status` | 查看完整状态面板 | orchestrator / 用户 |
| `pipeline_start` | 启动新管道 | main agent |
| `pipeline_continue` | **唯一入口**，处理所有用户消息 | orchestrator |
| `route_message` | 路由消息给子 agent | orchestrator 专用 |
| `style_get_profile` | 读取风格偏好 | 所有 agent |
| `style_record_feedback` | 更新风格偏好 | 所有 agent |
| `workspace_config` | 读写模板/记忆文件 | 管理员 |
| `agent_guide_generator` | 生成 agent 协作指南 | orchestrator |

### 1.2 管道执行 + 灵活对话（双模式）

核心设计：状态机驱动的管道引擎**硬推进** + 用户可以随时跳出固定流程。

#### 硬编码管道

项目启动后按 `template.json` 硬推进，每个阶段谁读什么 Slot、谁写什么 Slot 全部预先定义：

```
用户 → topic-researcher → web-researcher → content-writer → quality-reviewer → publisher
       (选题对话)        (调研验证)         (写作)         (审核)            (发布)
       checkpoint        checkpoint        checkpoint      checkpoint         checkpoint
```

每阶段结束后用户确认才推进。所有 slot 和 remark 写入 `.json` 文件的"伪 session"中，全程可追溯。

#### 灵活对话

用户可随时提醒 orchestrator **调用固定流程之外的 agent** 来帮忙，形成评论与修正：

```
用户："等等，让 web-researcher 再查一下这个数据的来源"
→ orchestrator 调用 web-researcher（非当前阶段）
→ web-researcher 通过 remark 机制在对应 slot 上提意见
→ 当前阶段 agent 看到 remark，决定是否采纳
→ 继续推进
```

这让人在回路不只是"点确认"，而是**真正的协作**——用户可以随时拉人进来帮忙，不改动流水线的完整性。

### 1.3 已部署的 Agent

| Agent | 模型 | 工具组 |
|-------|------|--------|
| main | 默认 | 检测需求 → 调 pipeline_start |
| orchestrator | qwen3-max | 路由 + 推进 + 全部管道工具 |
| topic-researcher | qwen3.5-plus | 管道工具 + plugins + fs + web |
| web-researcher | deepseek-v4-flash | 同上 |
| content-writer | kimi-k2.5 | 同上 + 风格工具 |
| quality-reviewer | qwen3.5-plus | 同上 |
| publisher | deepseek-v4-flash | 同上 |

每个 agent 注册后用户还可以按自己的想法继续升级配置——自主性 + 可用性都保障了。

### 1.4 当前风格系统（需要升级的部分）

| 组件 | 现状 | 问题 |
|------|------|------|
| `AgentProfile.preferences` | `Record<string, any>`，flat JSON | 无结构，由 agent 自由填写 |
| `style_get_profile` | 读 profile.json | 内容不可控 |
| `style_record_feedback` | 简单 JSON merge | agent 自觉调才更新，漏报率极高 |
| `prompt-builder.ts` 注入 | profile JSON 塞进 `【长期记忆】` 段 | 软注入，agent 可忽略 |
| 样本管理 | 无 | 无 onboarding 流程 |

---

## 2. 部署目标环境：BayesDL 云平台

### 2.1 平台特性

部虾做部署在**OpenClaw 大赛**指定的 BayesDL 平台。不是 Docker，是一台带用户权限限制的 Linux 云服务器。关键约束：

| 项目 | 说明 |
|------|------|
| OS | Linux (bash) |
| Git 可用性 | 有但 HTTP2 framing error，需 `git config --global http.version HTTP/1.1` |
| GitHub 可达性 | 需镜像/代理 |
| 持久化 | 平台处理，不需要我们操心 |
| OpenClaw 位置 | `/usr/local/bin/openclaw` → `/app/openclaw.mjs` |
| 网关端口 | 18789 |
| 插件工具权限 | 必须用 `group:plugins`，独立工具名不生效 |
| 部署方式 | 终端 bash 脚本 + heredoc Python（git clone 不可靠） |

### 2.2 部署流程

当前部署脚本已迭代 10+ 次，流程如下：

```
Phase 1: OpenClaw 更新
  Step 1: 终端执行 openclaw skills install multi-search-engine
          → 提供网络访问能力（容器默认无网络）
  Step 2: 在 Dashboard「聊天」页让 OpenClaw 自主更新
          → "请更新到最新版本"
          → OpenClaw 会自行下载并重启
          （Dashboard 会因进程重启而消失，正常现象）
  Step 3: 手动重启容器 → 重新进入后即最新版 OpenClaw

Phase 2: 运行部署脚本
  通过 heredoc Python 或 bash 直接改配置：
  - 创建 6 个 agent，分配独立 workspace
  - 配置每个 agent 的模型（不同角色用不同模型）
  - 注册 pipeline 插件
  - 设置 agent 的 tool allow list（用 group:plugins）
  - 生成每个 agent 的 AGENTS.md、SOUL.md
  - 初始化公共 AI 工作区目录结构

Phase 3: 用户按需调整
  - 部署完用户可以自己改配置
  - 换模型、加 skill、调权限——随意
```

### 2.3 部署脚本现状

| 脚本 | 用途 | 当前状态 |
|------|------|---------|
| `scripts/deploy.sh` | 一键部署（主入口） | 已迭代 10+ 次，可用 |
| `scripts/deploy-files.py` | Python 部署辅助（避免 git 问题） | 存在 |
| `scripts/gen-deploy.ps1` | PowerShell 版（本地开发用） | 存在，云端不用此版 |
| `scripts/` 整体 | 全套配置模板 + agent 定义 | 需要整合为一个入口 |

**待解决**：skills 的自动化配置（当前无法通过脚本自动装到对应 agent）。

### 2.4 升级策略详解

BayesDL 容器中 OpenClaw 更新是最关键、最容易踩坑的环节：

| 问题 | 现象 | 解法 |
|------|------|------|
| 容器无网络 | `openclaw skills install` 失败 | 先装 `multi-search-engine` skill → OpenClaw 自动配网络 |
| OpenClaw 不知有新版 | 不触发自更新 | multi-search-engine skill 让 OpenClaw 知道自己版本号 |
| 更新丢依赖 | 插件/配置丢失 | main agent 自更新时保留依赖，部署脚本在更新后补全 |
| 旧版跑部署脚本 | 各种莫名其妙错误 | 部署脚本开头检测 OpenClaw 版本，不够新版先更新 |

---

## 3. 公共 AI 工作区

### 3.1 架构原则

- 每个 agent 有自己的 workspace（OpenClaw 原生支持：`agents.list[].workspace`）
- 公共数据放在 `_shared/` 目录，pipeline 工具通过**绝对路径**读写
- OpenClaw 的 AGENTS.md 从各自 workspace 加载（agent 专属规则）
- PromptBuilder 额外注入 `_shared/AGENTS.md` 到所有 agent 的 system prompt（全局规则）
- 无沙箱限制时绝对路径可访问；若启用沙箱需配 `workspaceAccess: "rw"`

### 3.2 目录结构

```
~/.openclaw/workspaces/map/
│
├── orchestrator/               ← 每个 agent 独立的 workspace
│   ├── AGENTS.md               ← orchestrator 专属规则
│   └── SOUL.md                 ← orchestrator 人格（枢纽型、冷静）
├── topic-researcher/
│   ├── AGENTS.md
│   └── SOUL.md                 ← 好奇心强、追问型
├── web-researcher/
│   ├── AGENTS.md
│   └── SOUL.md                 ← 严谨、考据型
├── content-writer/
│   ├── AGENTS.md
│   └── SOUL.md                 ← 创意、风格敏感型
├── quality-reviewer/
│   ├── AGENTS.md
│   └── SOUL.md                 ← 挑剔、细节控
├── publisher/
│   ├── AGENTS.md
│   └── SOUL.md
│
└── _shared/                    ← 公共 AI 工作区（绝对路径访问）
    ├── AGENTS.md               ← 全局规则模板（PromptBuilder 注入用）
    ├── styles/
    │   └── {userId}/
    │       ├── writing-dna.md         ← 风格 DNA
    │       ├── forbidden-patterns.md  ← AI 腔禁用语
    │       ├── growth-direction.md    ← 目标状态
    │       ├── samples/               ← 原始写作样本
    │       └── profile.json           ← 现有升级版
    ├── kb/
    │   └── {userId}/
    │       ├── user_profile.md        ← 用户画像（所有 agent 共享读）
    │       └── insights.md            ← 洞察积累（所有 agent 共享写）
    ├── projects/                      ← pipeline 项目
    │   └── {projectId}/
    │       ├── state.json
    │       ├── manifest.json
    │       └── ...
    ├── scripts/                       ← 维护脚本
    ├── 0logs/                         ← 变更日志
    └── _kg/                           ← 知识图谱（可选）
```

### 3.3 AGENTS.md 全局规则（`_shared/AGENTS.md`）

这个文件部署时自动生成，PrompBuilder 在每次调用时硬注入到所有 agent：

```markdown
# 工作区全局规则

## 知识库规则
- 用户画像在 `_shared/kb/{userId}/user_profile.md`，每次对话前**必须读取**
- 发现用户新偏好 → 写入 `_shared/kb/{userId}/insights.md`
- 如果用户纠正了你 → 记录到 insights.md，不要假装没发生

## 管道规则
- 你只能读写当前阶段授权的 slot
- 发现问题 → 用 remark 提意见，不要直接改别人产出
- 不确定的时候 → 问 orchestrator，不要自己猜

## 风格学习（仅 content-writer 执行）
- 写作前必须调用 style_get_context
- 写作后必须等待用户确认
- 用户纠正 → 调用 style_record_feedback
```

### 3.4 PromptBuilder 硬注入结构

PromptBuilder 构建 system prompt 时，对不同 agent 注入不同内容：

```
【系统指令】（来自 AGENTS.md / SOUL.md）
...

【工作区全局规则】（来自 _shared/AGENTS.md，所有 agent 必读）
  所有 agent 必须遵守工作区规则。
  ...

【用户画像】（所有 agent 共享，每 session 快照）
  用户是...

【管道上下文】（非管道 agent 无此项）
  topic_brief: ...
  research_notes: ...

【风格硬规则】（仅 content-writer）
  以下规则**必须遵守**，不是建议：
  - 句长：20 字以内
  - 不要用"首先、其次、最后"
  - ...
```

### 3.5 越用越懂你的三层次

| 层次 | 机制 | 数据位置 | 受益方 |
|------|------|---------|--------|
| 懂风格 | style_record_feedback → writing-dna.md | `_shared/styles/` | content-writer |
| 懂工作流 | 用户纠正信号 → insights.md | `_shared/kb/` | 所有 agent |
| 懂需求 | 项目历史 + prompt 累计 | `_shared/projects/` | orchestrator 调度 |

---

## 4. 风格增强设计

### 4.1 新增/改动的工具

| 工具 | 来源 | 用途 | 调用者 |
|------|------|------|--------|
| `style_get_context` | **新增** | 拉取完整风格档案（硬规则 + 样本 + 禁用语） | content-writer 专用 |
| `style_record_feedback` | **改造** | 从"agent 自觉调"改为 Hook 自动触发 | pipeline 层拦截 |
| `kb_read` | **新增** | 读用户画像/洞察 | 所有 agent |
| `kb_write` | **新增** | 记录用户偏好观察 | 所有 agent |

### 4.2 所有 agent 协同修缮机制

**不依赖任何 agent 自觉。** `pipeline_continue` 是唯一入口，pipeline 层在每次对话回合后自动拦截：

```
pipeline_continue(user_msg, agent_response)
  ↓
  正常路由给当前 agent 并得到回复
  ↓
  自动分析 user_msg:
    有纠正信号("别" "不要" "太" "不对" "改"...)？
    → 是: 写入 _shared/kb/{userId}/insights.md（全部 agent 受益）
          如果涉风格 → 同时更新 _shared/styles/{userId}/profile.json
    → 否: 不操作
  ↓
  返回结果给用户
```

这样 orchestrator、topic-researcher、quality-reviewer、publisher 的对话回合都能贡献风格数据。

### 4.3 Onboarding 流程

新用户首次使用时的完整流程。

#### 入口

用户第一个消息 → `pipeline_start` 触发 → 检测到 `styles/{userId}/` 不存在 → 进入 onboarding 模式。

#### 双路径

```
Onboarding Agent 第一句话:
"初次见面。你有写过的文章吗？可以直接贴过来。
不想贴的话，我引导你写几段也行，大概 10 分钟。"
```

**路径 A：引导式写入（参考 Voiceprint 方法论）**

| 步骤 | 内容 | 形式 |
|------|------|------|
| 1 | 欢迎 + 说明流程 | 对话 |
| 2 | "写下你最近做的一件事，跟朋友聊天那样" | 开放写作 |
| 3 | "解释一个你擅长的概念" | 开放写作 |
| 4 | "推荐一个你超喜欢的东西" | 开放写作 |
| 5 | "吐槽一个不爽的事" | 开放写作 |
| 6 | "给个观点——大家都接受但你反对的事" | 开放写作 |
| 7 | 偏好校准（句长？标点？emoji？） | 多选题 |
| 8 | 禁用语选择（"值得注意的是"？"让我们深入探讨"？） | 多选题 |
| 9 | → 子 agent 分析全部样本 → 生成风格档案 | 自动 |
| 10 | "我理解的风格是这样的，对吗？" → 确认/调整 | 对话 |

**路径 B：贴现有文章**

```
用户说"我贴给你"或直接发文章
→ agent 接受:
   1. 粘贴文本（全部渠道）
   2. 文件上传（Dashboard / Telegram / WhatsApp）
   3. 发链接（agent 抓取）
   4. 多篇逐步提供
→ agent 从文章中提取 5 种情绪基调的段落
→ 如果缺某种情绪，补问一句引导式问题
```

两种路径在"5 样本 + 偏好校准 + 禁用语"汇合，产物完全一致。

#### Onboarding 产物

写入 `_shared/styles/{userId}/`：
- `writing-dna.md`
- `forbidden-patterns.md`
- `growth-direction.md`
- `samples/`（原始样本）

同时写入 `_shared/kb/{userId}/user_profile.md`（所有 agent 共享）。

---

## 5. 错误恢复

| 错误类型 | 检测 | 处理 |
|---------|------|------|
| agent 调用超时 | pipeline_continue 计时 | mark 当前 stage 为 failed，通知用户重试/回退 |
| agent 输出空 slot | 写完后校验 slot 非空 | 空 → 重试当前 agent（最多 2 次）→ 失败则回退 |
| agent 假装工作无产出 | 校验 slot 内容格式是否符合预期 | 格式不对 → 打回重写 + 记录到 insights |
| 用户连续否定 | 检测到 N 次纠正信号 | 建议暂停，检查 style 配置 |

---

## 6. 赛后独立框架路线图

当前是 OpenClaw 插件。赛后拆出为独立 npm 包：

```
阶段 1（比赛期）：OpenClaw 插件形态
  - `@buxiazuo/multi-agent-pipeline`
  - 依赖 OpenClaw plugin-sdk

阶段 2（赛后）：抽离核心，独立运行
  - 抽离 PipelineManager / StateManager / PromptBuilder 为核心包
  - 提供独立 CLI（`map run`）
  - 仍可嵌入 OpenClaw 作为插件

阶段 3（独立框架）：
  - 独立状态机引擎，不依赖任何平台
  - 插件化 agent 注册
  - 知识库 + 风格引擎内置
```

---

## 7. 与现有架构的关系

```
OpenClaw Gateway
  │
  ├── channels (WhatsApp / Telegram / Dashboard ...)
  │
  └── agents
       ├── main → pipeline_start
       ├── orchestrator → pipeline_continue / route_message
       ├── topic-researcher
       ├── web-researcher
       ├── content-writer   ← 风格引擎受益者
       ├── quality-reviewer
       └── publisher
              │
              └── 全部使用 pipeline 注册的 11+ 个工具
                   pipeline 的 PromptBuilder 在每次调用时注入:
                   - 所有 agent: 全局工作区规则 + 用户画像
                   - content-writer 额外: 风格硬规则
```

pipeline 工具反向注册到 OpenClaw agent 的工具箱。OpenClaw 不感知风格学习——它只提供工具调用通道。

---

## 8. 交付物检查清单

- [ ] 插件设计文档（本文）
- [ ] content-writer 设计文档（`docs/content-writer-design.md`）
- [ ] 部署脚本整合（bash 版，兼容 BayesDL 环境，skills 配置待解决）
- [ ] 公共 AI 工作区结构实现（`_shared/` 目录初始化 + 各 agent workspace 配置）
- [ ] PromptBuilder 硬注入改造（全局规则通用 + 风格规则专属）
- [ ] 文件存储结构实现（`styles/` + `kb/` 目录）
- [ ] `types.ts` 新增 `StyleProfile`、`KBEntry` 类型
- [ ] `memory.ts` 重构：flat JSON → 结构化 + 自动检测
- [ ] `pipeline-continue.ts` 加纠正信号检测
- [ ] 注册新工具 `style_get_context` + `kb_read` + `kb_write`
- [ ] Onboarding 流程接入（路径 A + 路径 B）
- [ ] 错误恢复机制
