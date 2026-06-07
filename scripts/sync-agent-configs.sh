#!/bin/bash
# scripts/sync-agent-configs.sh
# 将 agent-configs/（外部路径）同步到项目 templates/agent-configs/
# 用法: bash scripts/sync-agent-configs.sh
set -euo pipefail

SRC="C:/Users/29548/Desktop/阳关/南京大学/11-比赛/小龙虾/决赛路演/agent-configs"
DST="$(cd "$(dirname "$0")/.." && pwd)/templates/agent-configs"

mkdir -p "$DST"

for agent in topic-researcher content-writer quality-reviewer publisher post-analyst; do
  if [ -f "${SRC}/${agent}-SOUL.md" ]; then
    cp "${SRC}/${agent}-SOUL.md"  "${DST}/${agent}-SOUL.md"
    cp "${SRC}/${agent}-AGENT.md" "${DST}/${agent}-AGENT.md"
    cp "${SRC}/${agent}-SKILL.md" "${DST}/${agent}-SKILL.md"
    echo "  ✓ ${agent}"
  else
    echo "  ⚠ ${agent}: 未找到配置文件"
  fi
done

echo "已同步到 ${DST}"
