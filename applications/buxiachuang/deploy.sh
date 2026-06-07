#!/bin/bash
set -euo pipefail

# ============================================================
# 部虾创（BuXiaChuang）— 应用 #0 部署脚本
# 被 scripts/deploy.sh 在步骤 6 调用
#
# 环境变量（由主脚本传入）:
#   OPENCLAW_HOME, AGENT_WORKSPACE_ROOT, PLUGIN_WORKSPACE, PLUGIN_DIR
# ============================================================

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${PLUGIN_DIR}/scripts/lib.sh"

echo "  部虾创 v0.2 — 小红书/抖音内容创作流水线"

# ---------- 1. Agent 列表 ----------
AGENTS=(
  "topic-researcher"
  "content-writer"
  "quality-reviewer"
  "publisher"
  "post-analyst"
)

# ---------- 2. 创建 Agent 工作区 ----------
for agent in "${AGENTS[@]}"; do
  mkdir -p "${AGENT_WORKSPACE_ROOT}/${agent}"
done

# ---------- 3. 写入 Agent 配置（SOUL.md + AGENT.md + SKILL.md）----------
# 从 templates/agent-configs/ 复制生产级三件套

AGENT_CONFIGS_SRC="${PLUGIN_DIR}/templates/agent-configs"

for agent in "${AGENTS[@]}"; do
  WS="${AGENT_WORKSPACE_ROOT}/${agent}"

  if [ -f "${AGENT_CONFIGS_SRC}/${agent}-SOUL.md" ]; then
    cp "${AGENT_CONFIGS_SRC}/${agent}-SOUL.md"  "${WS}/SOUL.md"
    cp "${AGENT_CONFIGS_SRC}/${agent}-AGENT.md" "${WS}/AGENT.md"
    cp "${AGENT_CONFIGS_SRC}/${agent}-SKILL.md" "${WS}/SKILL.md"
    echo "  ✓ ${agent}: SOUL.md + AGENT.md + SKILL.md"
  else
    echo "  ⚠ ${agent}: 未找到生产级配置，保留默认占位"
  fi
done

# ---------- 4. 拷贝模板 ----------
echo ""
echo "  --- 拷贝模板 ---"

# 到插件工作区
for tpl in xiaohongshu-creation.json; do
  if [ -f "${PLUGIN_DIR}/templates/${tpl}" ]; then
    cp "${PLUGIN_DIR}/templates/${tpl}" "${PLUGIN_WORKSPACE}/templates/${tpl}"
    echo "  ✓ ${tpl}"
  fi
done

# 到 orchestrator 工作区（让它能列出来）
mkdir -p "${AGENT_WORKSPACE_ROOT}/orchestrator/templates"
if [ -f "${PLUGIN_DIR}/templates/xiaohongshu-creation.json" ]; then
  cp "${PLUGIN_DIR}/templates/xiaohongshu-creation.json" "${AGENT_WORKSPACE_ROOT}/orchestrator/templates/xiaohongshu-creation.json"
fi

# 拷贝开发指导到 agent-guides
if [ -f "${PLUGIN_DIR}/docs/部虾做的Agents工作流开发指导.md" ]; then
  cp "${PLUGIN_DIR}/docs/部虾做的Agents工作流开发指导.md" "${PLUGIN_WORKSPACE}/agent-guides/部虾做的Agents工作流开发指导.md"
  echo "  ✓ 部虾做的Agents工作流开发指导.md"
fi

# ---------- 5. 写入应用清单 ----------
echo ""
echo "  --- 写入应用清单 ---"

mkdir -p "${PLUGIN_WORKSPACE}/applications/buxiachuang"
cat > "${PLUGIN_WORKSPACE}/applications/buxiachuang/manifest.json" << EOF
{
  "name": "部虾创",
  "version": "0.2.0",
  "description": "小红书/抖音内容创作流水线：选题调研 → 写作 → 审核 → 发布 → 回采",
  "agents": ["topic-researcher","content-writer","quality-reviewer","publisher","post-analyst"],
  "templates": ["xiaohongshu-creation.json"],
  "platforms": ["xiaohongshu", "douyin"]
}
EOF
echo "  ✓ manifest.json"

# ---------- 6. 注册 Agents 到 openclaw.json ----------
echo ""
echo "  --- 注册 Agents ---"

# ---------- 6a. 按角色定义工具权限 ----------
# 原则：最小权限。只有需要联网搜索的 agent 才给 group:web，无人需要文件系统。
declare -A TOOLS
TOOLS[topic-researcher]='{"allow":["group:plugins","group:web"]}'
TOOLS[content-writer]='{"allow":["group:plugins"]}'
TOOLS[quality-reviewer]='{"allow":["group:plugins","group:web"]}'
TOOLS[publisher]='{"allow":["group:plugins"]}'
TOOLS[post-analyst]='{"allow":["group:plugins"]}'

declare -A MODELS
MODELS[topic-researcher]="bayesdl/qwen3.5-plus"
MODELS[content-writer]="bayesdl/kimi-k2.5"
MODELS[quality-reviewer]="bayesdl/qwen3.5-plus"
MODELS[publisher]="bayesdl/deepseek-v4-flash"
MODELS[post-analyst]="bayesdl/qwen3.5-plus"

for agent in "${AGENTS[@]}"; do
  register_agent "$agent" "${MODELS[$agent]}" "${AGENT_WORKSPACE_ROOT}/${agent}" "${TOOLS[$agent]}"
done

echo "  ✓ 全部 Agents 已注册到 openclaw.json"
echo ""
echo "  部虾创部署完成"
