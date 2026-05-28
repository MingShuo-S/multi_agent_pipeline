#!/bin/bash
set -euo pipefail

# ============================================================
# multi-agent-pipeline 一键部署脚本
# 用法: bash scripts/deploy.sh
# ============================================================

# ---------- 配置（按需修改） ----------
source ~/.bashrc 2>/dev/null || true
BAYESDL_API_KEY="${BAYESDL_API_KEY:-}"
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OPENCLAW_HOME="${HOME}/.openclaw"
AGENT_WORKSPACE_ROOT="${OPENCLAW_HOME}/workspace"
PLUGIN_WORKSPACE="${OPENCLAW_HOME}/workspaces/multi-agent-pipeline"

# ---------- 步骤 0: 检查环境 ----------
echo "=== 步骤 0: 检查环境 ==="

if [ ! -f "${PLUGIN_DIR}/dist/index.js" ]; then
  echo "✗ 未找到 dist/index.js，请先 npm run build"
  exit 1
fi

if [ -z "$BAYESDL_API_KEY" ]; then
  echo "⚠ BAYESDL_API_KEY 未设置，跳过 API Key 配置"
  echo "  部署完成后执行: openclaw config set models.providers.bayesdl.apiKey \"sk-你的key\""
else
  openclaw config set models.providers.bayesdl.apiKey "${BAYESDL_API_KEY}"
  echo "✓ API Key 已配置"
fi

# ---------- 步骤 1: 初始化插件工作区 ----------
echo ""
echo "=== 步骤 1: 初始化插件工作区 ==="

mkdir -p "${PLUGIN_WORKSPACE}/templates"
mkdir -p "${PLUGIN_WORKSPACE}/projects"
mkdir -p "${PLUGIN_WORKSPACE}/agent-guides"

# 写入默认模板（xiaohongshu-creation）
cat > "${PLUGIN_WORKSPACE}/templates/xiaohongshu-creation.json" << 'TEMPLATE'
{
  "name": "xiaohongshu-creation",
  "description": "生成一篇小红书笔记",
  "stages": [
    { "id": "topic-research", "agent": "topic-researcher", "checkpoint": false, "allow_read": ["*"], "allow_write": ["topic_brief"] },
    { "id": "web-research", "agent": "web-researcher", "checkpoint": false, "allow_read": ["topic_brief"], "allow_write": ["research_notes"] },
    { "id": "draft-writing", "agent": "content-writer", "checkpoint": true, "allow_read": ["topic_brief", "research_notes"], "allow_write": ["draft_content"] },
    { "id": "review", "agent": "quality-reviewer", "checkpoint": false, "allow_read": ["draft_content", "research_notes"], "allow_write": ["review_feedback"] },
    { "id": "publish", "agent": "publisher", "checkpoint": false, "allow_read": ["draft_content", "review_feedback"], "allow_write": ["final_output"] }
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

核心规则（必须遵守）：
1. 绝对不自己生成文案、分析等专业内容。
2. 禁止直接向子 Agent 派发任务或使用 agentId/task/taskName 字段。
   所有创作任务必须用 pipeline_start 启动管道，不要自己调用子 Agent。
3. 遇到 checkpoint 时展示产出并等待用户确认。
4. 用户反馈用 pipeline_continue 传递。
5. 需要用 route_message 让用户直接与专业 Agent 对话时才使用。
6. subagents 只用于 route_message 的目标路由，不用于任务派发。

可用工具：
- pipeline_start：启动管道（参数 template_name, user_id, project_id）
- pipeline_continue：推进管道（参数 user_id, project_id, feedback）
- route_message：将消息路由给指定 Agent（参数 target_agent, message）
- pipeline_read / pipeline_add_remark：读取进度和添加批注
- workspace_config / agent_guide_generator：管理工作区和指南
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

python3 << 'PYEOF' 2>/dev/null && echo "✓ orchestrator agent + sessions 可见性已配置" || echo "⚠ 自动配置失败，请手动编辑 ~/.openclaw/openclaw.json"
import json, os
cfg_path = os.path.expanduser('~/.openclaw/openclaw.json')
try:
    with open(cfg_path) as f:
        cfg = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    cfg = {}
# 全局 tools 配置：允许跨 agent 发消息
cfg['tools'] = cfg.get('tools', {})
cfg['tools']['sessions'] = cfg['tools'].get('sessions', {})
cfg['tools']['sessions']['visibility'] = 'all'
# orchestrator agent 配置
agents = cfg.setdefault('agents', {})
SUB_AGENTS = ["topic-researcher","web-researcher","content-writer","quality-reviewer","publisher"]
SUB_TOOLS = {"allow": ["group:fs","group:web","pipeline_read","pipeline_write_slot","pipeline_add_remark","style_get_profile","style_record_feedback"]}
agents['orchestrator'] = {
    "enabled": True,
    "model": "bayesdl/qwen3.6-flash",
    "role": "orchestrator",
    "tools": {
        "allow": ["group:fs","group:sessions","group:agents","group:plugins","pipeline_start","pipeline_continue","route_message","pipeline_read","pipeline_add_remark","workspace_config","agent_guide_generator"]
    },
    "subagents": {
        "allowAgents": SUB_AGENTS
    }
}
for name in SUB_AGENTS:
    if name not in agents:
        agents[name] = {
            "enabled": True,
            "model": "bayesdl/qwen3.6-flash",
            "tools": SUB_TOOLS
        }
with open(cfg_path, 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
print('✓ orchestrator agent + sessions 可见性已配置')
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
