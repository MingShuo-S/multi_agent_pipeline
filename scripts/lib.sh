# ============================================================
# lib.sh — 部虾做框架共享函数库
# 被 deploy.sh 和 applications/*/deploy.sh source 使用
# ============================================================

# ---------- 版本检查 ----------
MIN_OPENCLAW_VERSION="2026.5.18"

ver_to_int() {
  local ver="${1//[^0-9.]/}"
  local parts=(${ver//./ })
  printf "%d%03d%03d" "${parts[0]:-0}" "${parts[1]:-0}" "${parts[2]:-0}"
}

check_version() {
  if ! command -v openclaw &>/dev/null; then
    echo "❌ openclaw 未安装。请先安装 OpenClaw。"
    echo "   参考: https://opencode.ai"
    return 1
  fi

  local raw clean
  raw=$(openclaw --version 2>&1 | head -1)
  clean=$(echo "$raw" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  if [ -z "$clean" ]; then
    echo "⚠ 无法解析 openclaw 版本号（原始: $raw），跳过版本检查"
    return 0
  fi

  if [ "$(ver_to_int "$clean")" -lt "$(ver_to_int "$MIN_OPENCLAW_VERSION")" ]; then
    echo "❌ openclaw 版本过旧（当前: $clean，需要: $MIN_OPENCLAW_VERSION）"
    echo "   请按照说明书更新 OpenClaw 后再部署"
    echo "   参考: https://opencode.ai"
    return 1
  fi

  echo "✓ openclaw $clean"
  return 0
}

# ---------- 检测 openclaw 目录 ----------
detect_openclaw_home() {
  local home=""
  for candidate in "$HOME/.openclaw" "/root/.openclaw" "/home/node/.openclaw"; do
    if [ -f "$candidate/openclaw.json" ]; then
      home="$candidate"
      break
    fi
  done
  echo "${home:-${HOME}/.openclaw}"
}

# ---------- 子 Agent 标准工具权限 ----------
readonly SUB_AGENT_TOOLS='{"allow":["group:plugins"]}'

# ---------- 注册 Agent 到 openclaw.json ----------
# 用法: register_agent <agent_id> <model> <workspace_path> [tools_json]
register_agent() {
  local agent_id="$1"
  local model="$2"
  local ws="$3"
  local tools="${4:-$SUB_AGENT_TOOLS}"
  local cfg_path="$OPENCLAW_HOME/openclaw.json"

  python3 -c "
import json, os, sys
cfg_path = '$cfg_path'
agent_id = '$agent_id'
model = '$model'
workspace = '$ws'
tools = json.loads('$tools')

try:
    with open(cfg_path) as f:
        cfg = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    print(f'⚠ {cfg_path} 不存在，请先运行主部署脚本', file=sys.stderr)
    sys.exit(1)

agents_list = cfg.setdefault('agents', {}).setdefault('list', [])

# 检查是否已注册（避免重复）
for i, agent in enumerate(agents_list):
    if agent.get('id') == agent_id:
        agents_list[i] = {'id': agent_id, 'model': model, 'workspace': workspace, 'tools': tools}
        break
else:
    agents_list.append({'id': agent_id, 'model': model, 'workspace': workspace, 'tools': tools})

# 同时加入 orchestrator 的 subagents 白名单
for agent in agents_list:
    if agent.get('id') == 'orchestrator':
        subs = agent.setdefault('subagents', {}).setdefault('allowAgents', [])
        if agent_id not in subs:
            subs.append(agent_id)

with open(cfg_path, 'w') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
print(f'✓ 已注册 agent: {agent_id}')
" 2>&1
}
