#!/bin/bash
# ============================================================
# setup-workspace.sh — 部虾创 Linux 工作区配置脚本
#
# 创建 _profiles/ 用户知识库结构 + rules/ 规则目录
# + README 索引 + 占位模板
#
# 与 deploy.sh 的关系:
#   deploy.sh — 编译 + 注册插件 + 配置 openclaw.json (不改)
#   setup-workspace.sh — 工作区文件结构 (纯新增)
#
# 用法:
#   bash scripts/setup-workspace.sh                # 正常安装
#   bash scripts/setup-workspace.sh --dry-run      # 仅预览不写入
#   bash scripts/setup-workspace.sh --skip-skills  # 跳过 skills 安装
# ============================================================
set -euo pipefail

DRY_RUN=false
SKIP_SKILLS=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --skip-skills) SKIP_SKILLS=true ;;
  esac
done

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${PLUGIN_DIR}/workspace"
SHARED="${ROOT}/_profiles"
TEMPLATE_DIR="${SHARED}/__template__"
RULES_DIR="${ROOT}/rules"
AGENT_GUIDES_DIR="${ROOT}/agent-guides"
TEMPLATES_DIR="${ROOT}/templates"

echo "============================================"
echo "  部虾创 — Linux 工作区文件结构配置"
echo "============================================"
echo "  插件目录:   ${PLUGIN_DIR}"
echo "  工作区根:   ${ROOT}"
echo "  用户知识区: ${SHARED}"
echo "  规则目录:   ${RULES_DIR}"
echo "  Dry-run:    ${DRY_RUN}"
echo ""

run() {
  if $DRY_RUN; then echo "  $1"; else eval "$1"; fi
}

# ===== 步骤 1: 创建目录 =====
echo "=== 步骤 1: 目录结构 ==="

for d in \
  "${ROOT}" \
  "${TEMPLATES_DIR}" \
  "${ROOT}/projects" \
  "${ROOT}/projects/__example__/agents" \
  "${AGENT_GUIDES_DIR}" \
  "${RULES_DIR}" \
  "${SHARED}" \
  "${TEMPLATE_DIR}/profile" \
  "${TEMPLATE_DIR}/memory" \
  "${TEMPLATE_DIR}/logs"; do
  run "mkdir -p \"$d\""
done
echo "  ... done"
echo ""

# ===== 步骤 2: README 索引文件 =====
echo "=== 步骤 2: README 索引 ==="

write_readme() {
  local f="$1"; shift
  if $DRY_RUN; then echo "  write $f"; else cat > "$f" << READMEEOF
$@
READMEEOF
  fi
}

write_readme "${ROOT}/README.md" \
"# 部虾创工作区

由 \`install.ts\` / \`setup-workspace.sh\` 自动初始化。

## 目录索引

| 目录 | 对应 0.AI工作区 | 用途 |
|------|----------------|------|
| \`rules/\` | AGENTS.md + 05-全局规则体系 | Agent 行为准则 |
| \`templates/\` | — | 管道模板 JSON |
| \`projects/\` | — | 项目运行状态（自动生成） |
| \`agent-guides/\` | 指导/ | Agent 管道协作指南 |
| \`_profiles/\` | AI笔记/ + 用户建模/ + .styles/ | 用户私有知识区 |

## 温度图谱

| 温度 | 目录 | 注入策略 |
|------|------|---------|
| HOT | \`profile.json#corePrinciples\` | 每 session 必读，头部硬注入 |
| WARM | \`profile.json#forbiddenPatterns + #vocabulary\` | 按角色需求注入 |
| COLD | \`memory.json + profile/\` | 通过工具按需读取 |
"

write_readme "${RULES_DIR}/README.md" \
"# 规则目录

管道 Agent 行为准则。对应 0.AI工作区 的 AGENTS.md + 05-全局规则体系。

| 文件 | 对应 | 用途 |
|------|------|------|
| \`temperature-layering.md\` | 温度分层 | 知识活跃度分类 |
| \`retrieval-fallback.md\` | 检索补全协议 | L1-L3 四级 fallback |
| \`reflex-learn-record.md\` | 条件反射学→记 | 新信息立即写入 |
| \`anti-hallucination.md\` | 防幻觉规则 | 内容生成约束 |
"

write_readme "${TEMPLATES_DIR}/README.md" \
"# 管道模板

JSON 格式。每文件一个模板。由 \`workspace_config\` 工具读写。
"

write_readme "${AGENT_GUIDES_DIR}/README.md" \
"# Agent 协作指南

每文件对应一个 Agent。由 \`agent_guide_generator\` 工具读写。
"

echo "  ... done"
echo ""

# ===== 步骤 3: 规则文件 =====
echo "=== 步骤 3: 写入规则文件 + Agent 指南 ==="

RULES_SRC="${PLUGIN_DIR}/src/rules"
if [ -d "$RULES_SRC" ]; then
  for f in "$RULES_SRC"/*.md; do
    fname=$(basename "$f")
    run "cp \"$f\" \"${RULES_DIR}/${fname}\""
  done
  echo "  ✓ rules/"
else
  echo "  ⚠ src/rules/ 不存在，跳过"
fi

GUIDE_SRC="${PLUGIN_DIR}/src/agent-guide-templates"
if [ -d "$GUIDE_SRC" ]; then
  for f in "$GUIDE_SRC"/*.md; do
    fname=$(basename "$f")
    run "cp \"$f\" \"${AGENT_GUIDES_DIR}/${fname}\""
  done
  echo "  ✓ agent-guides/"
else
  echo "  ⚠ src/agent-guide-templates/ 不存在，跳过"
fi
echo ""

# ===== 步骤 4: 共享知识库模板 =====
echo "=== 步骤 4: 共享知识库模板 ==="

write_readme "${TEMPLATE_DIR}/README.md" \
"# 用户知识区 — _profiles/{userId}/

| 文件 | 对应 0.AI工作区 | 层 | 用途 |
|------|----------------|-----|------|
| \`profile.json\` | .styles/ + 用户建模/ | PROFILE | 风格 DNA + 画像，进化式学习 |
| \`memory.json\` | AI笔记/ | MEMORY | 运行时记忆（insight/fact/feedback） |
| \`profile/persona.md\` | 用户建模/ | COLD | 用户画像摘要，只读 |
| \`memory/insights.md\` | AI笔记/洞察 | COLD | 交互洞察，追加日志 |
| \`logs/\` | 0logs/ | COLD | 变更日志 |

## PROFILE 写入规则

| 操作 | AI | User |
|------|----|------|
| corePrinciples | ❌（仅 voiceprint 初始写入） | ✅（确认 learned 后提升） |
| forbiddenPatterns | ✅（检测到用户禁止时追加） | ✅ |
| learnedPatterns | ✅（检测到偏好变化时追加） | ❌（但可确认提升） |
| voiceprint 字段 | ✅（仅 voiceprint 流程写入） | ❌ |
"

write_readme "${TEMPLATE_DIR}/profile/00-README.md" \
"# profile/ — 用户画像. 对应 用户建模/.
\`persona.md\` — 画像（基本事实、沟通偏好），由 pipeline-continue 写入。
"

write_readme "${TEMPLATE_DIR}/memory/00-README.md" \
"# memory/ — 交互记忆. 对应 AI笔记/.
\`insights.md\` — 累积洞察（纠正信号、偏好发现），由 pipeline-continue 追加。
"

write_readme "${TEMPLATE_DIR}/logs/00-README.md" \
"# logs/ — 变更日志. 对应 0logs/.
"

# profile.json 模板（不含个人数据）
if ! $DRY_RUN; then
  cat > "${TEMPLATE_DIR}/profile.json" << 'PROFEOF'
{
  "comment": "风格 DNA 模板。由 Voiceprint 流程或 style_write_profile 工具填充。不含个人数据。",
  "userId": "__USER_ID__",
  "version": 1,
  "dna": {
    "corePrinciples": [],
    "syntaxPatterns": {},
    "vocabulary": {
      "highFreq": [],
      "forbidden": [],
      "techTerms": []
    },
    "forbiddenPatterns": [],
    "growthDirection": ""
  },
  "lastUpdated": ""
}
PROFEOF

  echo '[]' > "${TEMPLATE_DIR}/memory.json"

  cat > "${TEMPLATE_DIR}/profile/persona.md" << 'PERSOEOF'
# 用户画像

> 由 pipeline-continue 拦截钩子自动填充。不含预填数据。

## 基本信息

（留空）

## 沟通偏好

（留空）

## 已知事实

（留空）
PERSOEOF

  cat > "${TEMPLATE_DIR}/memory/insights.md" << 'INSIGHTEOF'
# 交互洞察

> 由 pipeline-continue 拦截钩子自动填充。

## 日志
INSIGHTEOF
fi
echo "  ... done"
echo ""

# ===== 步骤 5: 配置 OPENCLAW_WORKSPACE =====
echo "=== 步骤 5: 工作区路径配置 ==="

if ! $DRY_RUN; then
  cat > "${PLUGIN_DIR}/.env.workspace" << ENVEOF
# 部虾创 - 工作区路径
# 由 setup-workspace.sh 自动生成
OPENCLAW_WORKSPACE=${ROOT}
ENVEOF
  echo "  ✓ .env.workspace: OPENCLAW_WORKSPACE=${ROOT}"
fi
echo ""

# ===== 步骤 6: 安装 Skills =====
echo "=== 步骤 6: Agent Skills ==="

if $SKIP_SKILLS; then
  echo "  --skip-skills 跳过"
else
  if command -v npx &>/dev/null; then
    for skill in multi-search-engine; do
      if $DRY_RUN; then
        echo "  npx skills add $skill"
      else
        npx skills add "$skill" 2>/dev/null && echo "  ✓ $skill" || echo "  ⚠ $skill 失败（可手动: npx skills add $skill）"
      fi
    done
    if ! $DRY_RUN; then
      echo "  ℹ 在 openclaw.json 的 agents.list[].skills 引用"
    fi
  else
    echo "  ⚠ npx 不可用，跳过"
  fi
fi
echo ""

# ===== 完成 =====
echo "============================================"
echo "  配置完成！"
echo "============================================"
echo ""
echo "下一步:"
echo "  1. source ${PLUGIN_DIR}/.env.workspace"
echo "  2. bash ${PLUGIN_DIR}/scripts/deploy.sh"
echo "  3. openclaw gateway restart"
echo "  4. (可选) bash scripts/sync-ai-summary.sh  # 同步 memory.json → memory.ai.md 伴侣文件"
echo ""
echo "验证:"
echo "  ls ${ROOT}/rules/"
echo "  ls ${SHARED}/__template__/"
