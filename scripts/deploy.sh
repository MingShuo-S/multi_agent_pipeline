#!/bin/bash
set -euo pipefail

# ============================================================
# 部虾做框架 — 主部署脚本
#
# 职责：部署框架核心（orchestrator + 插件），然后委派给
#       各应用的 deploy.sh 部署其专有 Agents。
#
# 用法: bash scripts/deploy.sh
# ============================================================

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${PLUGIN_DIR}/scripts/lib.sh"

# ---------- 版本检查 ----------
echo "=== 版本检查 ==="
check_version || exit 1
echo ""

# ---------- 路径配置 ----------
OPENCLAW_HOME=$(detect_openclaw_home)
if [ -z "$OPENCLAW_HOME" ]; then
  OPENCLAW_HOME="${HOME}/.openclaw"
  echo "⚠ 未找到现有 openclaw.json，使用 ${OPENCLAW_HOME}"
fi
AGENT_WORKSPACE_ROOT="${OPENCLAW_HOME}/workspace"
PLUGIN_WORKSPACE="${OPENCLAW_HOME}/workspaces/multi-agent-pipeline"

# 导出供子脚本使用
export OPENCLAW_HOME
export AGENT_WORKSPACE_ROOT
export PLUGIN_WORKSPACE
export PLUGIN_DIR

# ---------- 检查权限 ----------
if [ -d "$OPENCLAW_HOME" ] && [ ! -w "$OPENCLAW_HOME" ]; then
  echo "⚠ ${OPENCLAW_HOME} 不可写，尝试修复..."
  chmod -R u+w "$OPENCLAW_HOME" 2>/dev/null || echo "  权限修复失败，请手动执行: chown -R $(whoami) $OPENCLAW_HOME"
fi
if [ "$(whoami)" = "root" ] && echo "$PLUGIN_DIR" | grep -q "^/home/"; then
  chown -R root:root "$PLUGIN_DIR" 2>/dev/null || true
fi

# ---------- 步骤 1: 安装依赖 + 编译插件 ----------
echo "=== 步骤 1: 安装依赖 + 编译插件 ==="
cd "${PLUGIN_DIR}"

# 配置 npm 国内镜像（如果未配置）
if ! npm config get registry 2>/dev/null | grep -q "npmmirror"; then
  echo "  配置 npm 国内镜像..."
  npm config set registry https://registry.npmmirror.com
fi

echo "  安装依赖（首次可能需要 1-2 分钟）..."
npm install --include=dev 2>&1 | tail -3
npm run build 2>&1
echo "✓ 编译完成"
cd - > /dev/null

# ---------- 步骤 2: 初始化插件工作区 ----------
echo ""
echo "=== 步骤 2: 初始化插件工作区 ==="
# 插件代码的 WORKSPACE_ROOT = <plugin_root>/workspace/ (config.ts)
PLUGIN_WS="${PLUGIN_DIR}/workspace"
mkdir -p "${PLUGIN_WS}/templates"
mkdir -p "${PLUGIN_WS}/projects"
mkdir -p "${PLUGIN_WS}/agent-guides"
mkdir -p "${PLUGIN_WS}/_shared"
echo "✓ 插件工作区已初始化: ${PLUGIN_WS}"

# ---------- 步骤 3: 部署 Orchestrator Agent ----------
echo ""
echo "=== 步骤 3: 部署 Orchestrator ==="

mkdir -p "${AGENT_WORKSPACE_ROOT}/orchestrator"
cat > "${AGENT_WORKSPACE_ROOT}/orchestrator/SOUL.md" << 'EOF'
# 部虾做框架 — Orchestrator（通用指挥家）

你是多 Agent 接力管道的指挥家，不隶属于任何具体应用。
你掌握通用技能，但不了解具体业务领域的细节——业务由各应用模板定义。

## 通用技能

### 1. 风格冷启动（Voiceprint）
新用户第一次对话，先做 voiceprint 再启动任何应用。
- 用 `voiceprint_init` → `voiceprint_proceed` → `voiceprint_calibrate` → 系列工具
- 详细步骤见: workspace/agent-guides/voiceprint-guide.md

### 2. 知识管理
- `kb_read` / `kb_write`：读写用户知识库
- `style_read_profile` / `style_extract_signal`：读/记录风格偏好
- 用户修正你的输出时，用 `style_extract_signal` 记录修正信号

### 3. 应用发现
可用应用列表在 workspace/applications/ 下，每个子目录是一个应用。
查看可用应用: 列出 workspace/applications/ 目录下的条目
查看应用模板: workspace/templates/ 下列出 `{app_name}-*.json`
启动应用: pipeline_start(template_name, ...)

### 4. 内容回采（post-publishing data collection）
内容发布后，用户可能告诉你效果数据。你的职责是识别这类消息并路由给 post-analyst。

**不要自己去分析数据，不要自己去匹配内容。** 你只负责识别和路由。

## 强制规则

### 规则 1：先发现，再启动
- 用户说"帮我写一篇×" → 先看 workspace/applications/ 有什么可用应用
- 根据用户的场景选择匹配的应用模板
- 不要不懂装懂——如果应用目录为空，告知用户当前未安装任何应用

### 规则 2：接力模式，不代劳（违规后果严重）
- **你不能代替子 Agent 写作、调研、审核或发布**
- 任何用户产生了创作需求（"写一篇…""帮我改…""调研一下…"）→ **必须先调 pipeline_start 或 pipeline_continue**，不能自己直接干活
- 违规后果：用户发现你在代劳而不是调度专家，会认为系统不可靠，直接导致项目失败
- 你只能做三件事：调度（pipeline）、展示（转发子 Agent 输出）、记录（风格/知识库）

### 规则 3：所有用户消息走 pipeline_continue（触发条件表）
- pipeline 启动后，用户所有消息必须用 pipeline_continue，**没有例外**
- 判断依据：只要用户提的是创作/内容/调研相关需求，一律视为"管道已在运行中"，走 pipeline_continue

| 用户说了什么 | 你的动作 | 说明 |
|-------------|---------|------|
| "帮我写一篇关于X的文章" | `pipeline_start`（首次） | 启动管道，传 initial_message |
| "题目换成Y方向" / "改一下第二段" | `pipeline_continue` | 路由给当前专家 |
| "下一阶段" / "完成" / "过" | `pipeline_continue`（自动推进） | 推进到下一阶段 |
| "这个数据不对，核实一下" | `pipeline_continue` | 路由给当前专家，插 remark |
| "帮我看看有什么模板" | `workspace_config`（管道外） | 应用发现，非创作需求 |
| "那篇小红书有数据了" / "阅读量5000" / "发出去效果不错" / 提及具体指标（阅读/点赞/评论） | `route_message("post-analyst", ...)` | **回采事件** — 把用户消息原样路由给 post-analyst，让它去匹配内容和做分析 |

### 规则 4：展示内容，不加包装
- 展示 slot_output.value 的完整内容
- 不要加"内容已写入××"这类系统表述
- 不要加自己的评价

## 工具速查

| 工具 | 用途 |
|------|------|
| pipeline_start/continue/status/read/write_slot/add_remark | 管道全生命周期 |
| voiceprint_init/proceed/calibrate/analyze/confirm/reset | 风格冷启动 |
| style_read_profile/write_profile/extract_signal/get_context | 风格 DNA 读写 |
| kb_read/write | 知识库管理 |
| route_message | 直接路由给指定 Agent |
| workspace_config | 模板管理 |
| agent_guide_generator | 生成 Agent 协作指南 |

## 参考
- Voiceprint 详细指导: workspace/agent-guides/voiceprint-guide.md
- 架构规则: workspace/rules/
- 应用指南: workspace/applications/
EOF
echo "  ✓ orchestrator/SOUL.md"

# ---------- 步骤 4: 配置 openclaw.json（基座配置）----------
echo ""
echo "=== 步骤 4: 配置 openclaw.json（基座）==="

OPENCLAW_HOME="$OPENCLAW_HOME" PLUGIN_DIR="$PLUGIN_DIR" python3 << 'PYEOF'
import json, os
h = os.environ.get('OPENCLAW_HOME') or os.path.expanduser('~/.openclaw')
cfg_path = os.path.join(h, 'openclaw.json')
try:
    with open(cfg_path) as f:
        cfg = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    cfg = {}
ws_root = os.path.join(h, 'workspace')

# ---------- provider ----------
providers = cfg.setdefault('models', {}).setdefault('providers', {})
maas_key = providers.get('maas', {}).get('apiKey', '')
bayesdl_key = providers.get('bayesdl', {}).get('apiKey', '')
if not bayesdl_key or bayesdl_key.startswith('sk-你的') or bayesdl_key == '${BAYESDL_API_KEY}':
    providers['bayesdl'] = {
        "baseUrl": "https://token.bayesdl.com/api/maas/v1",
        "api": "openai-completions",
        "apiKey": maas_key,
        "models": [
            {"id":"deepseek-v4-flash","contextWindow":128000,"maxTokens":4096,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"reasoning":True},
            {"id":"qwen3-max","contextWindow":128000,"maxTokens":4096,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"reasoning":False},
            {"id":"qwen3.5-plus","contextWindow":128000,"maxTokens":4096,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"reasoning":False},
            {"id":"kimi-k2.5","contextWindow":128000,"maxTokens":4096,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"reasoning":False},
        ]
    }

# ---------- 全局 tools ----------
cfg['tools'] = cfg.get('tools', {})
cfg['tools'].update({"profile": "full", "sessions": {"visibility": "all"}})

# ---------- 设备认证 ----------
cfg['gateway'] = cfg.get('gateway', {})
cfg['gateway']['controlUi'] = cfg['gateway'].get('controlUi', {})
cfg['gateway']['controlUi']['dangerouslyDisableDeviceAuth'] = True

# ---------- 插件路径 ----------
cur_plugin = (os.environ.get('PLUGIN_DIR') or '').strip()
if cur_plugin:
    cfg.setdefault('plugins', {}).setdefault('load', {})['paths'] = [cur_plugin]

# ---------- 写入 Orchestrator + 默认模型配置 ----------
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
    "list": [
        {"id": "main"},
        {
            "id": "orchestrator",
            "model": "bayesdl/qwen3-max",
            "workspace": os.path.join(ws_root, "orchestrator"),
            "tools": {"allow": ["group:plugins", "group:sessions", "group:agents"]},
            "subagents": {"allowAgents": []}
        }
    ]
}

with open(cfg_path, 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
print('✓ 基座配置已写入（orchestrator + provider + models）')
PYEOF

# ---------- 步骤 5: 注册插件 ----------
echo ""
echo "=== 步骤 5: 注册插件到 OpenClaw ==="

openclaw plugins install "${PLUGIN_DIR}" --link 2>/dev/null || {
  openclaw plugins uninstall multi-agent-pipeline 2>/dev/null || true
  openclaw plugins install "${PLUGIN_DIR}" --link
}
echo "✓ 插件已注册"

# ---------- 步骤 6: 部署各应用 ----------
echo ""
echo "=== 步骤 6: 部署应用 ==="

app_count=0
for app_deploy in "${PLUGIN_DIR}/applications/"*/deploy.sh; do
  if [ -f "$app_deploy" ]; then
    app_dir="$(dirname "$app_deploy")"
    app_name="$(basename "$app_dir")"
    echo "--- 部署应用: ${app_name} ---"
    bash "$app_deploy"
    app_count=$((app_count + 1))
    echo ""
  fi
done

if [ "$app_count" -eq 0 ]; then
  echo "⚠ 未找到任何应用部署脚本（applications/*/deploy.sh）"
  echo "   框架核心已部署完成，但没有任何应用 Agents 可用。"
fi

# ---------- 步骤 7: 安装外部 Skills ----------
echo ""
echo "=== 步骤 7: 安装外部 Skills ==="

# 7a: ClawHub 技能
if command -v openclaw &>/dev/null; then
  SKILLS=(
    "multi-search-engine"
    "ai-humanizer"
    "fact-check"
    "fact-checker-cn"
    "social-media-publish"
    "xiaohongshu-mcp"
  )
  for skill in "${SKILLS[@]}"; do
    if openclaw skills list 2>/dev/null | grep -qi "$skill"; then
      echo "  ✓ $skill 已安装"
    else
      echo "  → 安装 $skill..."
      openclaw skills install "$skill" 2>&1 && echo "  ✓ $skill 安装完成" || echo "  ⚠ $skill 安装失败（已存在或网络问题，可跳过）"
    fi
  done
else
  echo "  ⚠ openclaw 命令不可用，跳过 ClawHub skill 安装"
fi

# 7b: 本地技能（style-voiceprint 依赖 pipeline voiceprint_* 工具）
LOCAL_SKILL_SRC="${PLUGIN_DIR}/skills"
if [ -d "${LOCAL_SKILL_SRC}/style-voiceprint" ]; then
  if command -v openclaw &>/dev/null; then
    if [ ! -d "$(openclaw skills list --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print([s['dir'] for s in d if s['name']=='style-voiceprint'][0] if any(s['name']=='style-voiceprint' for s in d) else '')" 2>/dev/null)" ]; then
      echo "  → 安装 style-voiceprint（本地）..."
      openclaw skills install "${LOCAL_SKILL_SRC}/style-voiceprint" --as style-voiceprint 2>&1 && echo "  ✓ style-voiceprint 安装完成" || echo "  ⚠ style-voiceprint 安装失败"
    else
      echo "  ✓ style-voiceprint 已安装"
    fi
  fi
fi
# 7c: xiaohongshu-mcp 外部 MCP Server 二进制
XHS_MCP_VERSION="latest"
XHS_MCP_DIR="${OPENCLAW_HOME}/mcp-servers/xiaohongshu"
XHS_MCP_BIN="${XHS_MCP_DIR}/xiaohongshu-mcp-linux-amd64"

# 使用 ghproxy.net 镜像（GitHub 直连在 BayesDL 不稳定）
GITHUB_MIRROR="https://ghproxy.net"

if [ ! -f "$XHS_MCP_BIN" ]; then
  echo "  → 下载 xiaohongshu-mcp MCP Server..."
  mkdir -p "${XHS_MCP_DIR}"
  XHS_URL="${GITHUB_MIRROR}/https://github.com/xpzouying/xiaohongshu-mcp/releases/${XHS_MCP_VERSION}/download/xiaohongshu-mcp-linux-amd64"
  if command -v wget &>/dev/null; then
    wget -q "${XHS_URL}" -O "$XHS_MCP_BIN" && echo "  ✓ MCP Server 下载完成" || echo "  ⚠ MCP Server 下载失败"
  elif command -v curl &>/dev/null; then
    curl -sL "${XHS_URL}" -o "$XHS_MCP_BIN" && echo "  ✓ MCP Server 下载完成" || echo "  ⚠ MCP Server 下载失败"
  fi
  chmod +x "$XHS_MCP_BIN" 2>/dev/null || true
fi

# 尝试登录（仅在 MCP Server 二进制存在且无 session 时）
LOGIN_BIN="${XHS_MCP_DIR}/xiaohongshu-login-linux-amd64"
if [ -f "$XHS_MCP_BIN" ] && [ ! -f "${XHS_MCP_DIR}/session.data" ]; then
  if [ ! -f "$LOGIN_BIN" ]; then
    LOGIN_URL="${GITHUB_MIRROR}/https://github.com/xpzouying/xiaohongshu-mcp/releases/${XHS_MCP_VERSION}/download/xiaohongshu-login-linux-amd64"
    echo "  → 下载 xiaohongshu 登录工具..."
    if command -v wget &>/dev/null; then
      wget -q "${LOGIN_URL}" -O "$LOGIN_BIN" && echo "  ✓ 登录工具下载完成" || echo "  ⚠ 登录工具下载失败"
    elif command -v curl &>/dev/null; then
      curl -sL "${LOGIN_URL}" -o "$LOGIN_BIN" && echo "  ✓ 登录工具下载完成" || echo "  ⚠ 登录工具下载失败"
    fi
    chmod +x "$LOGIN_BIN" 2>/dev/null || true
  fi

  if [ -f "$LOGIN_BIN" ]; then
    echo ""
    echo "  ┌─────────────────────────────────────────────┐"
    echo "  │  登录小红书 ? [y/N]                          │"
    echo "  │  需要浏览器环境扫描二维码。                    │"
    echo "  │  如当前终端无显示支持，选 N 后手动登录。        │"
    echo "  └─────────────────────────────────────────────┘"
    read -r XHS_LOGIN_CHOICE
    if [ "$XHS_LOGIN_CHOICE" = "y" ] || [ "$XHS_LOGIN_CHOICE" = "Y" ]; then
      echo "  → 打开登录页面，请用手机小红书扫码..."
      "$LOGIN_BIN"
      if [ $? -eq 0 ]; then
        echo "  ✓ 登录成功"
      else
        echo "  ⚠ 登录失败或无显示支持。可手动登录："
        echo "    将 ${LOGIN_BIN} 复制到有浏览器的机器执行扫码，"
        echo "    将 session.data 复制回 ${XHS_MCP_DIR}/"
      fi
    else
      echo "  ℹ 跳过登录。可稍后手动登录："
      echo "    将 ${LOGIN_BIN} 复制到有浏览器的机器执行扫码，"
      echo "    将 session.data 复制回 ${XHS_MCP_DIR}/"
    fi
  fi
fi

# 启动 MCP Server（headless）
if [ -f "$XHS_MCP_BIN" ]; then
  if ! curl -sf http://localhost:18060/api/v1/login/status > /dev/null 2>&1; then
    echo "  → 启动 xiaohongshu-mcp MCP Server（headless）..."
    nohup "$XHS_MCP_BIN" > "${XHS_MCP_DIR}/server.log" 2>&1 &
    sleep 2
    echo "  ✓ MCP Server 已启动（PID: $!）"
  else
    echo "  ✓ xiaohongshu-mcp MCP Server 运行中"
  fi
fi
echo "✓ 步骤 7 完成"

# ---------- 步骤 8: 生成插件清单（可选）----------
echo "=== 步骤 8: 生成插件清单 ==="
cd "${PLUGIN_DIR}"
if command -v openclaw &>/dev/null; then
  openclaw plugins build --entry ./dist/index.js 2>&1 || echo "⚠ plugins build 非关键步骤，跳过"
fi
cd - > /dev/null
echo "✓ 步骤 8 完成"

# ---------- 完成 ----------
echo ""
echo "============================================"
echo "  部虾做框架部署完成！"
echo "============================================"
echo ""
echo "已部署 ${app_count} 个应用"
echo ""
echo "已安装 Skill: multi-search-engine, ai-humanizer, fact-check, fact-checker-cn, social-media-publish, xiaohongshu-mcp"
echo ""
echo "下一步："
echo "  1. openclaw gateway restart"
echo "  2. 回到 OpenClaw dashboard"
echo ""
echo "小红书发布登录："
echo "  首次部署：${OPENCLAW_HOME}/mcp-servers/xiaohongshu/xiaohongshu-login-linux-amd64"
echo "  在本机有浏览器的环境执行 → 手机扫码 → session.data 复制回该目录"
echo "  换号：删除 session.data，重新执行上述步骤"
echo ""
echo "验证: openclaw plugins inspect multi-agent-pipeline --runtime"
