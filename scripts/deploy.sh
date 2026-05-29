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
if [ -f "${PLUGIN_DIR}/templates/xiaohongshu-creation.json" ]; then
  cp "${PLUGIN_DIR}/templates/xiaohongshu-creation.json" "${PLUGIN_WORKSPACE}/templates/xiaohongshu-creation.json"
  echo "✓ 模板已从源码复制"
else
  # 兜底：写入默认模板
  cat > "${PLUGIN_WORKSPACE}/templates/xiaohongshu-creation.json" << 'TEMPLATE'
{
  "name": "xiaohongshu-creation",
  "description": "生成一篇小红书笔记（人机协作交互版）",
  "stages": [
    { "id": "topic-research", "agent": "topic-researcher", "checkpoint": true, "allow_read": [], "allow_write": ["topic_brief"] },
    { "id": "web-research", "agent": "web-researcher", "checkpoint": true, "allow_read": ["topic_brief"], "allow_write": ["research_notes"] },
    { "id": "draft-writing", "agent": "content-writer", "checkpoint": true, "allow_read": ["topic_brief", "research_notes"], "allow_write": ["draft_content"] },
    { "id": "review", "agent": "quality-reviewer", "checkpoint": true, "allow_read": ["draft_content", "topic_brief"], "allow_write": ["draft_content", "review_feedback"] },
    { "id": "publish", "agent": "publisher", "checkpoint": true, "allow_read": ["draft_content", "review_feedback"], "allow_write": ["final_output"] }
  ],
  "slots": {
    "topic_brief": { "type": "text", "default": "" },
    "research_notes": { "type": "text", "default": "" },
    "draft_content": { "type": "text", "default": "" },
    "review_feedback": { "type": "text", "default": "" },
    "final_output": { "type": "text", "default": "" }
  }
}
TEMPLATE
fi
echo "✓ 插件工作区已初始化: ${PLUGIN_WORKSPACE}"

# ---------- 步骤 2: 创建 Agent 工作区 ----------
echo ""
echo "=== 步骤 2: 创建 Agent 工作区 ==="

AGENTS=("orchestrator" "topic-researcher" "web-researcher" "content-writer" "quality-reviewer" "publisher")
for agent in "${AGENTS[@]}"; do
  mkdir -p "${AGENT_WORKSPACE_ROOT}/${agent}"
  echo "  ✓ ${AGENT_WORKSPACE_ROOT}/${agent}"
done

# ---------- 步骤 3: 写入 SOUL.md ----------
echo ""
echo "=== 步骤 3: 写入 SOUL.md ==="

# orchestrator
cat > "${AGENT_WORKSPACE_ROOT}/orchestrator/SOUL.md" << 'EOF'
你是多 Agent 创作管道的指挥家，负责调度流程、展示结果并收集用户反馈。

## 核心规则（必须严格遵守，违者将导致管道异常）

### 规则 1：绝对禁止自己生成创作内容
- 你不能代替子 Agent 写作、分析、调研或审核。
- 你只能调度和展示，不能生产。

### 规则 2：管道驱动，禁止绕过
- 所有创作任务必须通过 pipeline_start → pipeline_continue("agree") 逐阶段推进。
- 禁止连续调用 pipeline_continue("agree") 跳过阶段——每次推进后，等待用户反馈。
- 禁止用 route_message 或 subagent 代替管道工具来"手动"完成任务。

### 规则 3：每次 checkpoint 必须展示子 Agent 产出
- 调用 pipeline_start 或 pipeline_continue 后，检查 slot_output.value。
- 将 slot_output.value 的内容完整、直接地呈现给用户（不要加"内容已写入××"这类系统表述）。
- 在展示完内容之前，绝对禁止调用 pipeline_continue("agree") 推进。

### 规则 4：正确定义"同意"并推进
- 用户说"继续""继续继续""同意""可以""好的""嗯"等确认词 → feedback="agree"
- 用户说其他内容 → 将用户原话作为 feedback 传入 pipeline_continue，
  系统会自动路由给当前子 Agent 进行修改/对话

### 规则 5：route_message 的正确用法
- 仅在用户需要与当前阶段子 Agent 深度对话时才用 route_message
- 使用后，必须将子 Agent 的回复写回 slot（用 pipeline_write_slot）
- 不允许用 route_message 替代 pipeline_start

## 工作流程（必须按此执行）

步骤 1：用户提出创作需求 → 调用 pipeline_start(template_name, user_id, project_id)
步骤 2：检查返回的 slot_output.value → 展示给用户
步骤 3：等待用户反馈
步骤 4：用户说"继续" → 调用 pipeline_continue(..., feedback="agree") → 回到步骤 2
步骤 5：用户说修改意见 → 调用 pipeline_continue(..., feedback=用户原话) → 回到步骤 2
步骤 6：所有阶段完成后，管道返回 completed

## 正确 vs 错误示例

❌ 错误：用户说"继续"后，你连续调用两次 pipeline_continue("agree") 跳过两个阶段
✅ 正确：用户说"继续"→ pipeline_continue("agree")→展示新产出→等待反馈

❌ 错误：调用 pipeline_start 后说"内容已写入 topic_brief"而不展示内容
✅ 正确：展示 slot_output.value 的完整内容给用户

❌ 错误：用 route_message 叫子 Agent 干活，再手动写 slot
✅ 正确：用 pipeline_start/continue 驱动，子 Agent 会自动写 slot

## 可用工具速查
- pipeline_start(template_name, user_id, project_id) → 启动管道
- pipeline_continue(user_id, project_id, feedback) → 推进或反馈
- route_message(target_agent, message) → 深度对话
- pipeline_read, pipeline_write_slot, pipeline_add_remark
- workspace_config, agent_guide_generator
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
echo "=== 步骤 4: 生成插件清单（确保 tool-plugin 元数据一致） ==="

cd "${PLUGIN_DIR}"
npx openclaw plugins build --entry ./dist/index.js 2>/dev/null || {
  openclaw plugins build --entry ./dist/index.js 2>/dev/null || echo "⚠ openclaw plugins build 失败，使用已有 manifest"
}
echo "✓ 插件清单已更新"
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
    base = ["group:fs","group:web","pipeline_read","pipeline_write_slot","pipeline_add_remark","style_get_profile","style_record_feedback"]
    return {"allow": base + (extra or [])}
agents_list = [
    {"id": "main"},
    {
        "id": "orchestrator",
        "model": "bayesdl/qwen3-max",
        "workspace": agent_ws("orchestrator"),
        "tools": {
            "allow": ["pipeline_start","pipeline_continue","route_message","workspace_config","agent_guide_generator","pipeline_read","pipeline_add_remark","group:fs","group:sessions","group:agents"]
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
