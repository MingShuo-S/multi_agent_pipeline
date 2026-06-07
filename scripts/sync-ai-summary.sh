#!/bin/bash
# sync-ai-summary.sh — 同步 .ai.md 伴侣文件（Linux 版）
# 从 kb.json 生成 kb.ai.md（紧凑版），用于 L1.5 检索补全
#
# 用法:
#   bash scripts/sync-ai-summary.sh                           # 同步所有用户
#   bash scripts/sync-ai-summary.sh -u alice                  # 仅同步 alice
#   bash scripts/sync-ai-summary.sh -w /path/to/workspace     # 自定义工作区根
#   bash scripts/sync-ai-summary.sh -d                        # dry-run
set -euo pipefail

DRY_RUN=false
USER_ID=""
WORKSPACE_ROOT=""

while getopts "u:w:d" opt; do
  case "$opt" in
    u) USER_ID="$OPTARG" ;;
    w) WORKSPACE_ROOT="$OPTARG" ;;
    d) DRY_RUN=true ;;
    *) echo "用法: $0 [-u userId] [-w workspaceRoot] [-d]"; exit 1 ;;
  esac
done

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "$WORKSPACE_ROOT" ]; then
  WORKSPACE_ROOT="${PLUGIN_DIR}/workspace"
fi
SHARED_DIR="${WORKSPACE_ROOT}/_shared"

if [ ! -d "$SHARED_DIR" ]; then
  echo "⚠ _shared/ 不存在: $SHARED_DIR" >&2
  exit 0
fi

generate_kb_ai() {
  local user_dir="$1"
  local kb_path="${user_dir}/kb.json"
  local ai_path="${user_dir}/kb.ai.md"

  if [ ! -f "$kb_path" ]; then
    echo "  ⏭ $(basename "$user_dir") — kb.json 不存在" >&2
    return
  fi

  local tmp
  tmp=$(mktemp)
  # shellcheck disable=SC2016
  python3 -c "
import json, sys
from collections import defaultdict

with open('$kb_path', 'r') as f:
    entries = json.load(f)

groups = defaultdict(list)
for e in entries:
    groups[e.get('category', 'unknown')].append(e)

lines = ['# KB 摘要（自动生成）', '> 源: kb.json | 生成: $(date '+%Y-%m-%d %H:%M:%S')', '']
for cat in sorted(groups.keys()):
    items = groups[cat]
    lines.append(f'## {cat} ({len(items)} 条)')
    lines.append('')
    for e in items:
        content = e.get('content', '').replace(chr(10), ' ').replace(chr(13), ' ')
        conf = e.get('confidence', 'low')
        tag = {'high': '🟢', 'medium': '🟡', 'low': '🟠'}.get(conf, '⚪')
        line = f'- {tag} {content}'
        if e.get('source'):
            line += f'  _({e[\"source\"]})_'
        lines.append(line)
    lines.append('')

sys.stdout.write(chr(10).join(lines))
" > "$tmp"

  if $DRY_RUN; then
    echo "  [DRY] $(basename "$user_dir") — kb.ai.md ($(python3 -c "import json; print(len(json.load(open('$kb_path'))))") 条)"
    rm -f "$tmp"
  else
    mv "$tmp" "$ai_path"
    local count
    count=$(python3 -c "import json; print(len(json.load(open('$kb_path'))))")
    echo "  ✓ $(basename "$user_dir") — kb.ai.md ($count 条)"
  fi
}

echo "=== sync-ai-summary ==="
echo "  工作区: ${WORKSPACE_ROOT}"

if [ -n "$USER_ID" ]; then
  generate_kb_ai "${SHARED_DIR}/${USER_ID}"
else
  for d in "${SHARED_DIR}"/*/; do
    [ -d "$d" ] && generate_kb_ai "$d"
  done
fi

echo "完成"
