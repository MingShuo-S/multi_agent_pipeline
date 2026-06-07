# Claude Code Implementation Ticket

> 给 Claude Code 的实现清单，基于竞品调研（Hermes/LangGraph/Voiceprint）和双重可读性原则。
> 项目路径: `C:\Users\29548\Desktop\Sunshine\Projects\multi_agent_pipeline`

---

## P0 — Must Have (决赛前)

编号: P0-1 ~ P0-5

### 环境准备

```bash
npm install better-sqlite3   # 用于 Checkpoint 分层
npm install -D @types/better-sqlite3
```

---

### P0-1. Schema 分离: input/working/output

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

### P0-2. Reducer 合并模式

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

### P0-3. Interrupt 暂停点

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

### P0-4. Voiceprint 迁移: sync-style + loading chain

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

编号: P1-6 ~ P1-8

### P1-6. Checkpoint 分层: JSON → SQLite

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

### P1-7. Prefetch 上下文预取

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

编号: P2-9 ~ P2-10

### P2-9. 记忆回采回调 (Hermes-inspired MemoryProvider 接口)

将当前 StateManager 的读写抽象为插件式接口，为后续换 SQLite/Honcho 后端做准备。不做完整实现，只定义接口 + 保留当前实现。

### P2-10. 复合评分排序

在 search-graph.ps1 的嵌入 Python 中将 `np.dot(...)` 替换为 `0.5*sim + 0.3*recency + 0.2*importance`。

---

## P-Future. 插件配置 TUI

**目标**: 给插件加一个终端交互界面，用户能可视化地创建应用、配模板、部署 agent。

**现状**: 创建新应用流程是手动的——写 template JSON → 改 deploy.sh → 建 SOUL.md → 部署。门槛高。

### 设计思路

一个 CLI 向导（`npx multi-agent-pipeline tui` 或 `bash scripts/init-app.sh`）：

```
部虾创 — 新应用向导
====================

步骤 1/5: 应用名称
> 小红书创作

步骤 2/5: 选择 Agent
可用 Agent 模板:
  [x] topic-researcher   选题调研
  [x] content-writer     内容创作
  [ ] quality-reviewer   质量审核
  [ ] publisher          发布排版
  [ ] post-analyst       回采分析
  [*] 自定义 Agent       创建新角色

步骤 3/5: 配置模板
  编辑 stages 顺序 (↑↓ 移动, Space 选中)

步骤 4/5: ClawHub Skills
  推荐:
  [x] web-search     (topic-researcher 需要)
  [ ] summarize      (可选)
  [x] humanizer-zh   (content-writer 推荐)

步骤 5/5: 部署
  → 生成 template JSON
  → 写入 SOUL.md
  → 注册到 openclaw.json
  → 安装 skills
  → 完成
```

### 实现方式

| 方案 | 优缺点 |
|------|--------|
| **A: bash 脚本** (`scripts/init-app.sh`) | 零依赖，用 `read` + `select` 做交互。功能受限但够用。 |
| **B: Node.js CLI** (`src/cli/tui.ts`) | 可用 `enquirer`/`inquirer` 做漂亮的终端交互。需要加依赖。 |
| **C: 插件 tool + Web UI** | 通过 openclaw gateway 暴露配置 API，搭一个简单的 Web 界面。太重。 |

**推荐方案 B**: Node.js CLI + `enquirer`（轻量、交互好、和现有构建流程一致）

### 依赖

```bash
npm install enquirer       # 终端交互提示
npm install -D @types/enquirer
```

### 核心功能

1. **应用模板库** — 预置 `xiaohongshu-creation` 等模板，用户可以 fork 修改
2. **Agent 市场** — 从 ClawHub 搜索/安装 agent SOUL.md 模板
3. **一键部署** — 生成所有配置 → 写入 openclaw.json → restart gateway
4. **Skill 推荐** — 根据选中的 agent 自动推荐需要的 ClawHub skills

### 优先级

决赛后。当前手工流程已可用，TUI 是降低使用门槛的体验优化。

---

## 实现顺序建议

```
P0-1 Schema 分离 → 4h
P0-2 Reducer → 3h
P0-3 Interrupt → 6h
P0-4 Voiceprint → 2h（已有 sync-style.ps1）
P0-5 Orchestrator 透传 → 1h（改 SOUL.md）
P1-6 Checkpoint 分层 → 4h
P1-7 Prefetch → 1h（已有脚本）
P1-8 extract-md-summary → 1h（已有 python 脚本）
P2-9 MemoryProvider 接口 → 2h
P2-10 复合评分 → 1h
P-Post-1 Agent SOUL.md 独立化 → 3h（不改代码）
```

---

## P0-5. Orchestrator 透传 Sub-Agent 输出

**目标**: 让 orchestrator 不再"总结"子 agent 的回复，而是直接把完整回复展示给用户。

### 根因
在 `pipeline-continue.ts:477`，`return.message` 已经包含了完整的 agent response：
```
message: `${response}\n\n---\n💬 继续与 [${currentStageInfo.agent}] 对话...`,
```
但 orchestrator（OpenClaw 主 Agent）收到 `ContinueResult` 后，习惯性地**用自己语言重述**了子 agent 的输出，导致用户只看到"草稿已生成"这类概括，看不到实际内容。

### 改动

**文件**: `docs/orchestrator-SKILL.md`

在"使用示例"→"与 Agent 对话"部分之后，新增一条**强制规则**：

```markdown
## 强制规则：透传通信

> 你（指挥家）的角色是**信使**，不是**编辑**。

当使用 `pipeline_continue` 或 `route_message` 等工具调用子 Agent 时：
1. **必须**将子 Agent 的 `message` 完整转发给用户，不做任何总结、缩写、重述
2. 用户应当看到子 Agent 的原始输出，就像子 Agent 直接对用户说话一样
3. **唯一允许的附加**：在原始消息末尾追加分隔行和服务信息：
   ```
   [子 Agent 的完整原始回复]
   ---
   你可以继续对话，或输入"下一阶段"推进。
   ```
4. **禁止的行为**：
   - 不要用"他说"、"Content-writer 表示"等引述
   - 不要截断长输出
   - 不要用自己的话复述子 Agent 的内容
   - 不要省略代码块、表格、列表等格式
5. 如果子 Agent 的输出包含 `slot_output`，也要在转发时一并展示给用户
```

### 原理
orchestrator 相当于一个**透明代理**——它负责路由消息和管理生命周期，但不应该"解释"子 Agent 说了什么。用户需要看到子 Agent 的原始输出来判断质量。

---

## P1-8. extract-md-summary Python 版（Linux 服务器用）

**目标**: 将 `extract-md-summary.ps1`（PowerShell Only）移植为 Python 脚本，在 Linux 服务器上也可运行。

**文件**: `scripts/extract-md-summary.py`

```python
#!/usr/bin/env python3
"""
extract-md-summary.py — 从 .md 文件提取结构化摘要生成 .ai.md 伴侣文件。
Linux 服务器版。依赖: Python 3.8+（无第三方包）。
"""

import sys, os, re, hashlib, json
from pathlib import Path
from typing import List, Dict, Optional

def extract_sections(content: str) -> List[Dict]:
    """提取标题层级结构"""
    sections = []
    lines = content.split('\n')
    current = {'level': 0, 'title': 'preamble', 'items': []}
    
    for line in lines:
        m = re.match(r'^(#{1,6})\s+(.+)$', line)
        if m:
            if current['items']:
                sections.append(current)
            current = {
                'level': len(m.group(1)),
                'title': m.group(2).strip(),
                'items': []
            }
        else:
            stripped = line.strip()
            if stripped:
                current['items'].append(stripped)
    
    if current['items']:
        sections.append(current)
    return sections

def extract_tables(content: str) -> List[Dict]:
    """提取 markdown 表格"""
    tables = []
    lines = content.split('\n')
    i = 0
    while i < len(lines):
        if re.match(r'^\|.+\|$', lines[i]) and i + 1 < len(lines) and re.match(r'^\|[\s\-:|]+\|$', lines[i+1]):
            headers = [h.strip() for h in lines[i].strip('|').split('|')]
            rows = []
            i += 2
            while i < len(lines) and re.match(r'^\|.+\|$', lines[i]):
                cells = [c.strip() for c in lines[i].strip('|').split('|')]
                rows.append(cells)
                i += 1
            tables.append({'headers': headers, 'rows': rows})
        else:
            i += 1
    return tables

def extract_links(content: str) -> List[Dict]:
    """提取 [text](url) 链接"""
    links = []
    for m in re.finditer(r'\[([^\]]+)\]\(([^)]+)\)', content):
        if m.group(2).startswith('http'):
            links.append({'text': m.group(1), 'url': m.group(2)})
    return links

def generate_summary(md_path: Path) -> str:
    content = md_path.read_text(encoding='utf-8')
    
    sections = extract_sections(content)
    tables = extract_tables(content)
    links = extract_links(content)
    
    # 提取文件头元信息
    title = sections[0]['title'] if sections else md_path.stem
    first_para = ''
    for s in sections:
        for item in s['items']:
            if item and not item.startswith('>') and not item.startswith('|'):
                first_para = item[:200]
                break
        if first_para:
            break
    
    # 提取关键数字/日期
    dates = re.findall(r'\d{4}-\d{2}-\d{2}', content)
    
    # 构建摘要
    summary = f"# {title} (.ai.md)\n\n"
    if first_para:
        summary += f"> {first_para}\n\n"
    if dates:
        summary += f"**日期**: {dates[0]}\n\n"
    
    # 表格摘要
    for t in tables:
        summary += f"**{' | '.join(t['headers'])}**\n\n"
        for row in t['rows'][:5]:
            summary += f"- {' | '.join(row)}\n"
        summary += '\n'
    
    # 链接
    if links:
        summary += "## 参考链接\n\n"
        for link in links[:10]:
            summary += f"- [{link['text']}]({link['url']})\n"
    
    return summary.strip()

def main():
    if len(sys.argv) < 2:
        print("Usage: extract-md-summary.py <file.md> [file2.md ...]")
        sys.exit(1)
    
    for arg in sys.argv[1:]:
        md_path = Path(arg)
        if not md_path.exists() or md_path.suffix.lower() != '.md':
            print(f"SKIP {arg}: not a .md file or not found")
            continue
        
        summary = generate_summary(md_path)
        
        # Write to _ai/{name}.ai.md
        ai_dir = md_path.parent / '_ai'
        ai_dir.mkdir(exist_ok=True)
        ai_path = ai_dir / f"{md_path.stem}.ai.md"
        ai_path.write_text(summary + '\n', encoding='utf-8')
        print(f"  OK {ai_path}")

if __name__ == '__main__':
    main()
```

**使用方式**:
```bash
# Linux 服务器
python3 scripts/extract-md-summary.py docs/*.md

# 批量递归
find . -name '*.md' -not -name '*.ai.md' -exec python3 scripts/extract-md-summary.py {} \;
```

---

## P-Deploy-1. ClawHub Skills（deploy.sh 已自动安装）

**现状**: 子 agent（topic-researcher, quality-reviewer）只有 `group:plugins` 权限，没有搜索工具。
`multi-search-engine` 是 opencode 的本地 skill，在 openclaw 子 agent 上下文中不生效。

已通过 `scripts/deploy.sh` 步骤 7 自动安装:

| 技能 | 安装方式 | 用途 |
|------|---------|------|
| **web-search** | `openclaw skills install web-search` | DuckDuckGo API 搜索。topic-researcher 调研 + quality-reviewer 撞车检测 |
| **summarize** | `openclaw skills install summarize` | 长文本摘要。topic-researcher 提炼搜索结果 |

**不需要 SSH 手动操作** — `bash scripts/deploy.sh` 运行时会自动执行安装。如果服务器上 `openclaw` 命令不可用则跳过。

**关于 web_fetch 工具**: 不额外添加。ClawHub 的 `web-search` skill 已覆盖搜索需求。如需抓取特定 URL，子 agent 可用 `web_fetch`（openclaw 内置工具，`group:plugins` 权限已包括）。如果发现 `web_fetch` 在子 agent 上下文中不可用，再考虑注册为插件 tool。

---

## P-Deploy-2. Agent SOUL.md 独立化

**目标**: 每个 agent 既能在 pipeline 内跑，也能单独拿出来直接用。
**现状**: SOUL.md 只写了 pipeline 内的工作流，脱离 pipeline 没法用。

### 设计模式：双模式 SOUL.md

每个 agent 的 SOUL.md 包含两个工作流章节：
- **pipeline 模式**（当前已有）：读 slot → 干活 → 写 slot
- **独立模式**（新加）：直接对话 → 干同样的话 → 输出到对话框

**不依赖工具可用性检测**（LLM 不可靠）。而是 SOUL.md 里同时列出两种模式，让 orchestrator 告诉 agent 当前处于哪种模式。orchestrator 在 `pipeline_continue` 时注入 "当前模式: pipeline"，在 `route_message` 直接聊天时注入 "当前模式: standalone"。

```
## 工作流（pipeline 模式）
当 orchestrator 说"当前模式: pipeline"时执行此流程：
读 slot → 干活 → 写 slot

## 工作流（独立模式）
当 orchestrator 说"当前模式: standalone"时执行此流程：
直接问用户 → 干活 → 输出到对话框 → kb_write 记新信息
```

### P4.1 topic-researcher

| 维度 | pipeline 模式 | 独立模式 |
|------|-------------|---------|
| 输入 | 读 topic_brief slot（或 initial_message） | 直接问用户"想写什么？目标读者？" |
| 调研 | 用 web-search 搜，写 research_notes slot | 用 web-search 搜，输出结构化报告到对话框 |
| 输出 | `pipeline_write_slot("topic_brief")` + `pipeline_write_slot("research_notes")` | 直接展示选题简报 + 调研笔记，等用户确认 |
| 记忆 | 无（由 pipeline 管理） | 自己调 `kb_read`/`kb_write` 读写用户画像 |

**独立模式典型对话**:
```
用户: 帮我调研一下南京烟火气路线
agent: 目标读者是谁？（学生/游客/本地人）
用户: 大学生周末逛
agent: [搜] → [整理] → 出选题简报 + 调研笔记
用户: 不错，收下
agent: kb_write("用户偏好南京本地生活类选题")
```

### P4.2 content-writer

| 维度 | pipeline 模式 | 独立模式 |
|------|-------------|---------|
| 输入 | 读 topic_brief + research_notes | 用户直接给主题/文件/粘贴内容 |
| 写作 | 按风格 DNA 写 draft_content | 按用户当前对话语气写 |
| 修正 | `style_extract_signal` → 重写 → write_slot | `style_extract_signal` → 重写 → 输出到对话框 |
| 自查 | 无搜索权限，靠 research_notes | 同上 + 可要求用户提供更多上下文 |
| 风格 | InjectionLayer 已注入 | 自己调 `style_read_profile` + `kb_read` 获取用户风格 |

**独立模式典型对话**:
```
用户: 帮我写一篇关于南京烟火气的文章
agent: 有选题方向吗？还是我直接按你之前的风格来？
       [检测：新用户 vs 老用户]
       [老用户 → 读 style DNA + kb]
       [新用户 → "先写一段给我看看你的风格"]
用户: 随便写一段
agent: [分析样本 → 出初稿]
用户: 太啰嗦了，短一点
agent: style_extract_signal("用户偏好短句") → 重写
```

### P4.3 quality-reviewer

| 维度 | pipeline 模式 | 独立模式 |
|------|-------------|---------|
| 输入 | 读 draft_content + research_notes | 用户粘贴/上传内容 |
| 检查 | 事实/原创/合规/质量 四类 | 同四类检查，但主动问用户平台规则 |
| 搜索 | web-search 做撞车检测 | 同 |
| 输出 | write_slot("review_feedback") | 直接输出审核报告，逐条 P0/P1/P2 |

### P4.4 publisher

| 维度 | pipeline 模式 | 独立模式 |
|------|-------------|---------|
| 输入 | 读 draft_content + review_feedback | 用户粘贴内容，或说"帮我发到XX平台" |
| 处理 | 标题优化 + 标签 + 格式化 | 同 + 问用户目标平台 |
| 输出 | write_slot("final_output") | 直接展示，用户手动复制发布 |

### P4.5 post-analyst

| 维度 | pipeline 模式 | 独立模式 |
|------|-------------|---------|
| 输入 | 读 final_output，等用户提供数据 | 直接问"最近发了什么？数据怎样？" |
| 分析 | 对比历史基线 → 提炼洞察 | 同 + 自己从 kb 读历史数据做对比 |
| 输出 | write_slot("performance_insights") | 出分析报告，自动 kb_write 记录 |

### 实现清单

1. **改每个 agent 的 SOUL.md**（`applications/buxiachuang/deploy.sh` 中内嵌部分）
   - 加模式检测头（工具可用性判断）
   - 加独立模式工作流章节
   - 加独立模式对话示例
2. **改 shared-agent-guide.md** — 补充独立模式下的工具使用说明
3. **不改代码** — SOUL.md 级别的改造，不需要动 TypeScript

### 优先级
P4.1 topic-researcher → P4.2 content-writer → P4.3 quality-reviewer → P4.4 publisher → P4.5 post-analyst

---

---

## P-Deploy-3. Agent 配置全面替换（SOUL.md + AGENT.md + SKILL.md）

**目标**: 将 `applications/buxiachuang/deploy.sh` 中的 5 个 inline SOUL.md（老旧精简版）替换为生产级的三件套。

生产级配置已位于（手动编写完成）:
```
C:\Users\29548\Desktop\阳关\南京大学\11-比赛\小龙虾\决赛路演\agent-configs\
├── topic-researcher-SOUL.md  + AGENT.md + SKILL.md
├── content-writer-SOUL.md    + AGENT.md + SKILL.md
├── quality-reviewer-SOUL.md  + AGENT.md + SKILL.md
├── publisher-SOUL.md         + AGENT.md + SKILL.md
└── post-analyst-SOUL.md      + AGENT.md + SKILL.md
```

### 改动清单

#### 1. `applications/buxiachuang/deploy.sh`

将 `# 3. 写入 SOUL.md` 段的 5 个 `cat > ... << 'EOF'` heredoc 替换为文件复制:

```bash
# ---------- 3. 写入 Agent 配置（SOUL.md + AGENT.md + SKILL.md）----------
AGENT_CONFIGS_SRC="C:/Users/29548/Desktop/阳关/南京大学/11-比赛/小龙虾/决赛路演/agent-configs"

for agent in "${AGENTS[@]}"; do
  WS="${AGENT_WORKSPACE_ROOT}/${agent}"

  # 从源目录复制生产级配置
  if [ -f "${AGENT_CONFIGS_SRC}/${agent}-SOUL.md" ]; then
    cp "${AGENT_CONFIGS_SRC}/${agent}-SOUL.md"   "${WS}/SOUL.md"
    cp "${AGENT_CONFIGS_SRC}/${agent}-AGENT.md"  "${WS}/AGENT.md"
    cp "${AGENT_CONFIGS_SRC}/${agent}-SKILL.md"  "${WS}/SKILL.md"
    echo "  ✓ ${agent}: SOUL.md + AGENT.md + SKILL.md"
  else
    echo "  ⚠ ${agent}: 未找到生产级配置，保留默认占位"
  fi
done
```

> **注意**: 如果部署环境是 Linux 容器，路径 `C:/Users/...` 不可达。解决方案：在提交代码前，运行一次 `scripts/sync-agent-configs.sh`（见下方）将 config 文件复制到项目内的 `templates/agent-configs/` 目录，再提交 Git。

#### 2. 更新 `register_agent` 调用的工具权限和模型

当前 `applications/buxiachuang/deploy.sh` 第 260 行的 `register_agent` 调用保持不变（基础权限），**但 AGENT.md 文件中的模型路由只在 AGENT.md 中声明，pipeline template JSON 阶段定义才是实际生效的模型选择**。确保 `templates/xiaohongshu-creation.json` 的每个 stage 有正确的 `model` 字段。

#### 3. 新增同步脚本 `scripts/sync-agent-configs.sh`

用于将外部 `agent-configs/` 目录同步到项目内，方便 Git 管理:

```bash
#!/bin/bash
# scripts/sync-agent-configs.sh
# 将 agent-configs/（南京大学路径）同步到项目 templates/agent-configs/
set -euo pipefail

SRC="C:/Users/29548/Desktop/阳关/南京大学/11-比赛/小龙虾/决赛路演/agent-configs"
DST="$(cd "$(dirname "$0")/.." && pwd)/templates/agent-configs"

mkdir -p "$DST"
for agent in topic-researcher content-writer quality-reviewer publisher post-analyst; do
  cp "${SRC}/${agent}-SOUL.md"  "${DST}/${agent}-SOUL.md"
  cp "${SRC}/${agent}-AGENT.md" "${DST}/${agent}-AGENT.md"
  cp "${SRC}/${agent}-SKILL.md" "${DST}/${agent}-SKILL.md"
  echo "  ✓ ${agent}"
done
echo "已同步到 ${DST}"
```

#### 4. 验证清单

实现后 `ssh` 到部署环境验证:

```bash
# 检查各 agent 工作区
ls -la ~/.openclaw/workspace/{topic-researcher,content-writer,quality-reviewer,publisher,post-analyst}/
# 预期: 每个目录有 SOUL.md + AGENT.md + SKILL.md

# 检查注册
cat ~/.openclaw/openclaw.json | python3 -c "import json,sys;d=json.load(sys.stdin);[print(a['id']) for a in d['agents']['list']]"

# 检查已安装 skill
openclaw skills list

# 重启生效
openclaw gateway restart
```

### 各 Agent 配置概览（供实现后对照）

| Agent | SOUL.md 核心身份 | AGENT.md 默认模型 | SKILL.md 核心步骤 | 外部 Skills |
|-------|-----------------|-------------------|-------------------|-------------|
| topic-researcher | 选题调研分身，先聊天再搜索 | qwen3.5-plus | 6 步：出题→分类→搜→下钻→简报→笔记 | multi-search-engine, search-academic, lark-* |
| content-writer | 写作分身，用用户声音说话 | kimi-k2.5 | 6 步+6 平台指南+风格 DNA 系统+零幻觉 | style-voiceprint, ai-humanizer |
| quality-reviewer | 质检员，不改原文 | qwen3.5-plus | 4 步+加权评分（7.0 通过）+6 平台清单 | multi-search-engine, fact-check, fact-checker-cn, ai-humanizer |
| publisher | 发布专家，保真/合规/可回溯 | qwen3.5-plus | 7 步：门禁→平台→规则→适配→确认→发布→记录+待回采 | social-media-publish, xiaohongshu-mcp, multi-search-engine |
| post-analyst | 效果分析师，闭环最后一环 | kimi-k2.5 | 0（外部回采匹配）+5 步：收集→评估→模式→反馈→归档 | multi-search-engine |

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
| Agent 生产配置源 | `C:\Users\29548\Desktop\阳关\南京大学\11-比赛\小龙虾\决赛路演\agent-configs\` |
| 外部 Skills 指南 | `docs/external-skills-guide.md` |
| ClawHub | https://clawhub.ai |
| web-search skill | https://clawhub.ai/skills/web-search |
