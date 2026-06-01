#!/bin/bash
set -euo pipefail

# ============================================================
# multi-agent-pipeline 一键部署脚本
# 用法: bash scripts/deploy.sh
# ============================================================

# ---------- 配置（按需修改） ----------
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# 自动探测 gateway 配置目录
OPENCLAW_HOME=""
for candidate in "$HOME/.openclaw" "/root/.openclaw" "/home/node/.openclaw"; do
  if [ -f "$candidate/openclaw.json" ]; then
    OPENCLAW_HOME="$candidate"
    break
  fi
done
if [ -z "$OPENCLAW_HOME" ]; then
  OPENCLAW_HOME="${HOME}/.openclaw"
  echo "⚠ 未找到现有 openclaw.json，使用 ${OPENCLAW_HOME}"
fi
AGENT_WORKSPACE_ROOT="${OPENCLAW_HOME}/workspace"
PLUGIN_WORKSPACE="${OPENCLAW_HOME}/workspaces/multi-agent-pipeline"

# ---------- 检查权限 ----------
if [ -d "$OPENCLAW_HOME" ] && [ ! -w "$OPENCLAW_HOME" ]; then
  echo "⚠ ${OPENCLAW_HOME} 不可写，尝试修复..."
  chmod -R u+w "$OPENCLAW_HOME" 2>/dev/null || echo "  权限修复失败，请手动执行: chown -R $(whoami) $OPENCLAW_HOME"
fi
# 确保插件源码目录与 gateway 用户一致（否则 OpenClaw 安全策略会 block）
if [ "$(whoami)" = "root" ] && echo "$PLUGIN_DIR" | grep -q "^/home/"; then
  chown -R root:root "$PLUGIN_DIR" 2>/dev/null || true
fi

# ---------- 步骤 0: 编译插件 ----------
echo "=== 步骤 0: 编译插件 ==="

cd "${PLUGIN_DIR}"
npm run build 2>&1
echo "✓ 编译完成"
cd - > /dev/null

# ---------- 步骤 1: 初始化插件工作区 ----------
echo ""
echo "=== 步骤 1: 初始化插件工作区 ==="

mkdir -p "${PLUGIN_WORKSPACE}/templates"
mkdir -p "${PLUGIN_WORKSPACE}/projects"
mkdir -p "${PLUGIN_WORKSPACE}/agent-guides"

# 从源码拷贝模板到工作区（保持同步）
for tpl in xiaohongshu-creation.json blog-writing.json; do
  if [ -f "${PLUGIN_DIR}/templates/${tpl}" ]; then
    cp "${PLUGIN_DIR}/templates/${tpl}" "${PLUGIN_WORKSPACE}/templates/${tpl}"
    echo "  ✓ ${tpl}"
  fi
done
if [ -d "${PLUGIN_DIR}/templates/xiaohongshu-creation" ]; then
  mkdir -p "${PLUGIN_WORKSPACE}/templates/xiaohongshu-creation"
  cp "${PLUGIN_DIR}/templates/xiaohongshu-creation/"* "${PLUGIN_WORKSPACE}/templates/xiaohongshu-creation/" 2>/dev/null
  echo "  ✓ xiaohongshu-creation/ 子目录"
fi
echo "✓ 模板已从源码复制"
echo "✓ 插件工作区已初始化: ${PLUGIN_WORKSPACE}"

# ---------- 步骤 2: 创建 Agent 工作区 ----------
echo ""
echo "=== 步骤 2: 创建 Agent 工作区 ==="

AGENTS=("orchestrator" "topic-researcher" "web-researcher" "content-writer" "quality-reviewer" "publisher")
for agent in "${AGENTS[@]}"; do
  mkdir -p "${AGENT_WORKSPACE_ROOT}/${agent}"
  echo "  ✓ ${AGENT_WORKSPACE_ROOT}/${agent}"
done

# ---------- 步骤 2.5: 拷贝模板到 Agent 工作区 ----------
echo ""
echo "=== 步骤 2.5: 拷贝模板到 Agent 工作区 ==="

mkdir -p "${AGENT_WORKSPACE_ROOT}/orchestrator/templates"
if [ -f "${PLUGIN_DIR}/templates/xiaohongshu-creation.json" ]; then
  cp "${PLUGIN_DIR}/templates/xiaohongshu-creation.json" "${AGENT_WORKSPACE_ROOT}/orchestrator/templates/xiaohongshu-creation.json"
  echo "  ✓ 模板已复制到 orchestrator 工作区"
else
  echo "  ⚠ 未找到源码模板，跳过"
fi

# ---------- 步骤 3: 写入 SOUL.md ----------
echo ""
echo "=== 步骤 3: 写入 SOUL.md ==="

# orchestrator
cat > "${AGENT_WORKSPACE_ROOT}/orchestrator/SOUL.md" << 'EOF'
你是多 Agent 创作管道的指挥家，负责接力调度流程。

## 可用 Agent 列表（创建模板时必须使用以下标准名称）

| Agent 名称 | 职责 |
|---|---|
| topic-researcher | 与用户对话确定选题方向，产出 topic_brief |
| web-researcher | 联网调研验证数据，产出 research_notes |
| content-writer | 基于调研数据写作，产出 draft_content |
| quality-reviewer | 事实核查 + 规则检查，产出 review_feedback |
| publisher | 标题优化 + 标签生成 + 平台格式化，产出 final_output |

创建模板时，stages[].agent 必须使用以上标准名称，不能发明新名称。

## 强制规则（必须严格遵守，不得违反）

### 规则 0（最高优先级）：禁止用 write 工具写模板文件
- **你无法访问 write/read 等通用文件工具。模板操作只能通过 workspace_config。**
- 创建/修改模板：`workspace_config(action="write_template", template_name="...", content={...})`
- 查看可用模板：`workspace_config(action="list_templates")`
- 读取已有模板：`workspace_config(action="read_template", template_name="...")`
- **如果你试图用 write 工具写文件，将会失败——你已经没有权限使用 write 工具了。**
- 这是硬性限制，不是建议。

### 规则 1：接力模式，不要自动执行
- 你不能代替子 Agent 写作、分析、调研或审核。
- 你只能调度和展示，不能生产。

### 规则 2：使用 pipeline_start 启动
- 用户提出创作需求时，先调用 workspace_config(action=list_templates) 查看可用模板
- 推荐 xiaohongshu-creation 模板（5 阶段接力：选题→调研→写作→审核→发布）
- 使用 pipeline_start(template_name, user_id, project_id, initial_message=用户原话)
- 如果需要自定义模板，先读取现有模板做参考，确保 stages[].agent 使用标准名称

### 规则 3：每次对话都路由给当前专家
- 用户发来消息 → 调用 pipeline_continue(user_id, project_id, message=用户原话)
- 系统会自动路由给当前阶段的专家
- 将专家的回复完整展示给用户

### 规则 4：用户说"下一阶段"才推进
- 用户说"继续""下一阶段""advance""pass"等 → 系统自动检测并推进
- 你只需原样传递用户消息给 pipeline_continue
- 推进后，展示新专家的信息给用户

### 规则 5：展示内容
- pipeline_continue 返回后，展示 slot_output.value 的完整内容
- 不要加"内容已写入××"这类系统表述

### 规则 6：查看状态
- 需要时调用 pipeline_status 查看完整状态面板

## 工作流程

步骤 1：用户提出需求 → 先 list_templates 看可用模板 → pipeline_start 启动
步骤 2：展示返回的 slot_output.value → 等待用户反馈
步骤 3：用户发消息 → pipeline_continue(user_id, project_id, message=用户原话) → 展示专家回复
步骤 4：用户说"下一阶段" → 系统自动推进 → 展示新专家信息
步骤 5：重复步骤 3-4 直到所有阶段完成
EOF
echo "  ✓ orchestrator/SOUL.md"

# topic-researcher
cat > "${AGENT_WORKSPACE_ROOT}/topic-researcher/SOUL.md" << 'EOF'
你是 topic-researcher，专攻小红书选题策划。
必须通过 pipeline_read/pipeline_write_slot 获取和提交内容。
开始前调用 style_get_profile 获取用户偏好，完成后写入 topic_brief 并调用 style_record_feedback。
EOF
echo "  ✓ topic-researcher/SOUL.md"

# web-researcher
cat > "${AGENT_WORKSPACE_ROOT}/web-researcher/SOUL.md" << 'EOF'
你是 web-researcher，负责搜索资料并生成 research_notes。
必须通过管道工具交互，保留原有搜索能力，但所有输入输出必须经过 slot。
EOF
echo "  ✓ web-researcher/SOUL.md"

# content-writer
cat > "${AGENT_WORKSPACE_ROOT}/content-writer/SOUL.md" << 'EOF'
你是 content-writer，小红书文案专家，风格口语化活泼。
动笔前必须调用 style_get_profile 获取用户偏好，完成后写入 draft_content 并更新记忆。
EOF
echo "  ✓ content-writer/SOUL.md"

# quality-reviewer
cat > "${AGENT_WORKSPACE_ROOT}/quality-reviewer/SOUL.md" << 'EOF'
你是 quality-reviewer，审核内容草案，写出 review_feedback。
审核前获取用户偏好，通过管道工具提交意见。
EOF
echo "  ✓ quality-reviewer/SOUL.md"

# publisher
cat > "${AGENT_WORKSPACE_ROOT}/publisher/SOUL.md" << 'EOF'
你是 publisher，将最终文案整理为发布版 final_output。
使用管道工具获取上游内容并提交。
EOF
echo "  ✓ publisher/SOUL.md"

# ---------- 步骤 4: 生成插件清单 ----------
echo ""
echo "=== 步骤 4: 生成插件清单 ==="

cd "${PLUGIN_DIR}"
if command -v openclaw &>/dev/null; then
  openclaw plugins build --entry ./dist/index.js 2>&1 || echo "⚠ plugins build 非关键步骤，跳过"
else
  echo "⚠ openclaw CLI 不在 PATH 中，跳过 plugins build"
fi
echo "✓ 步骤 4 完成"
cd - > /dev/null

# ---------- 步骤 5: 注册插件 ----------
echo ""
echo "=== 步骤 5: 注册插件到 OpenClaw ==="

openclaw plugins install "${PLUGIN_DIR}" --link 2>/dev/null || {
  openclaw plugins uninstall multi-agent-pipeline 2>/dev/null || true
  openclaw plugins install "${PLUGIN_DIR}" --link
}
echo "✓ 插件已注册"

# ---------- 步骤 6: 配置 orchestrator Agent ----------
echo ""
echo "=== 步骤 6: 配置 orchestrator Agent ==="

OPENCLAW_HOME="$OPENCLAW_HOME" PLUGIN_DIR="$PLUGIN_DIR" python3 << 'PYEOF' 2>/dev/null && echo "✓ agents/models/tools 已配置" || echo "⚠ 自动配置失败，请手动编辑 ~/.openclaw/openclaw.json"
import json, os
h = os.environ.get('OPENCLAW_HOME') or os.path.expanduser('~/.openclaw')
cfg_path = os.path.join(h, 'openclaw.json')
try:
    with open(cfg_path) as f:
        cfg = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    cfg = {}
ws_root = os.path.join(h, 'workspace')
# ---------- 确保 bayesdl provider 有 key（从 maas 继承） ----------
providers = cfg.setdefault('models', {}).setdefault('providers', {})
maas_key = providers.get('maas', {}).get('apiKey', '')
bayesdl_key = providers.get('bayesdl', {}).get('apiKey', '')
if not bayesdl_key or bayesdl_key.startswith('sk-你的') or bayesdl_key == '${BAYESDL_API_KEY}':
    providers['bayesdl'] = {
        "baseUrl": "https://token.bayesdl.com/api/maas/v1",
        "api": "openai-completions",
        "apiKey": maas_key,
        "models": providers['bayesdl'].get('models', []) if 'bayesdl' in providers else [
            {"id":"deepseek-v4-flash","contextWindow":128000,"maxTokens":4096,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"reasoning":True},
            {"id":"qwen3-max","contextWindow":128000,"maxTokens":4096,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"reasoning":False},
            {"id":"qwen3.5-plus","contextWindow":128000,"maxTokens":4096,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"reasoning":False},
            {"id":"kimi-k2.5","contextWindow":128000,"maxTokens":4096,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"reasoning":False},
        ]
    }
# ---------- 全局 tools ----------
cfg['tools'] = cfg.get('tools', {})
cfg['tools'].update({"profile": "full", "sessions": {"visibility": "all"}})
# ---------- 确保 plugins.load.paths 只有当前路径 ----------
cur_plugin = (os.environ.get('PLUGIN_DIR') or '').strip()
if cur_plugin:
    cfg.setdefault('plugins', {}).setdefault('load', {})['paths'] = [cur_plugin]
# ---------- 替换 agents.list ----------
SUB_AGENTS = ["topic-researcher","web-researcher","content-writer","quality-reviewer","publisher"]
def agent_ws(name):
    return os.path.join(ws_root, name)
def sub_tools(extra=None):
    base = ["group:plugins","group:fs","group:web"]
    return {"allow": base + (extra or [])}
agents_list = [
    {"id": "main"},
    {
        "id": "orchestrator",
        "model": "bayesdl/qwen3-max",
        "workspace": agent_ws("orchestrator"),
        "tools": {
            "allow": ["group:plugins","group:sessions","group:agents"]
        },
        "subagents": {"allowAgents": list(SUB_AGENTS)}
    },
    {
        "id": "topic-researcher",
        "model": "bayesdl/qwen3.5-plus",
        "workspace": agent_ws("topic-researcher"),
        "tools": sub_tools()
    },
    {
        "id": "web-researcher",
        "model": "bayesdl/deepseek-v4-flash",
        "workspace": agent_ws("web-researcher"),
        "tools": sub_tools()
    },
    {
        "id": "content-writer",
        "model": "bayesdl/kimi-k2.5",
        "workspace": agent_ws("content-writer"),
        "tools": sub_tools()
    },
    {
        "id": "quality-reviewer",
        "model": "bayesdl/qwen3.5-plus",
        "workspace": agent_ws("quality-reviewer"),
        "tools": sub_tools()
    },
    {
        "id": "publisher",
        "model": "bayesdl/deepseek-v4-flash",
        "workspace": agent_ws("publisher"),
        "tools": sub_tools()
    },
]
cfg['agents'] = {
    "defaults": {
        "workspace": ws_root,
        "model": {"primary": "maas/qwen3.6-flash"},
        "models": {
            "maas/qwen3.6-flash": {"alias": "qwen3.6-flash"},
            "bayesdl/deepseek-v4-flash": {"alias": "DeepSeek V4 Flash"},
            "bayesdl/qwen3-max": {"alias": "Qwen3 Max"},
            "bayesdl/qwen3.5-plus": {"alias": "Qwen3.5 Plus"},
            "bayesdl/kimi-k2.5": {"alias": "Kimi K2.5"}
        }
    },
    "list": agents_list
}
with open(cfg_path, 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
print('✓ agents/models/tools 已配置')
PYEOF

# ---------- 完成 ----------
echo ""
echo "============================================"
echo "  部署完成！"
echo "============================================"
echo ""
echo "下一步："
echo "  1. 手动执行: openclaw gateway restart"
echo "  2. 回到 OpenClaw dashboard"
echo ""
echo "验证: openclaw plugins inspect multi-agent-pipeline --runtime"
echo "      应显示 10 个工具名称"
