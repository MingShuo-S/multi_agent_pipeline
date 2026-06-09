# sync-ai-summary.ps1 — 同步 .ai.md 伴侣文件
# 从 memory.json 生成 memory.ai.md（紧凑版），用于 L1.5 检索补全
#
# 用法:
#   powershell scripts/sync-ai-summary.ps1                                # 同步所有用户
#   powershell scripts/sync-ai-summary.ps1 -UserId alice                   # 仅同步 alice
#   powershell scripts/sync-ai-summary.ps1 -WorkspaceRoot .\workspace      # 自定义工作区根
#
# 建议: 每次 pipeline_continue 写 memory.json 后触发，或 crontab 定时执行

param(
  [string]$WorkspaceRoot = "",
  [string]$UserId = ""
)

$PluginDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
if (-not $WorkspaceRoot) {
  $WorkspaceRoot = Join-Path $PluginDir "workspace"
}
$SharedDir = Join-Path $WorkspaceRoot "_profiles"

if (-not (Test-Path $SharedDir)) {
  Write-Host "⚠ _profiles/ 不存在: $SharedDir" -ForegroundColor Yellow
  exit 0
}

$UserDirs = if ($UserId) { @($UserId) } else { Get-ChildItem -Path $SharedDir -Directory | ForEach-Object { $_.Name } }

foreach ($uid in $UserDirs) {
  $UserDir = Join-Path $SharedDir $uid
  $KbPath = Join-Path $UserDir "memory.json"
  $AiPath = Join-Path $UserDir "memory.ai.md"

  if (-not (Test-Path $KbPath)) {
    Write-Host "  ⏭ $uid — memory.json 不存在" -ForegroundColor Gray
    continue
  }

  try {
    $entries = Get-Content $KbPath -Raw | ConvertFrom-Json
  } catch {
    Write-Host "  ⚠ $uid — memory.json 解析失败: $_" -ForegroundColor Yellow
    continue
  }

  # 按 category 分组
  $groups = @{}
  foreach ($e in $entries) {
    $cat = $e.category
    if (-not $groups.ContainsKey($cat)) { $groups[$cat] = @() }
    $groups[$cat] += $e
  }

  # 生成紧凑版 Markdown
  $lines = @("# MEMORY 摘要（自动生成）", "> 源: memory.json | 生成: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", "")
  foreach ($cat in $groups.Keys | Sort-Object) {
    $items = $groups[$cat]
    $lines += "## $cat ($($items.Count) 条)", ""
    foreach ($e in $items) {
      $content = $e.content -replace '\r?\n', ' '
      $tag = switch ($e.confidence) {
        'high' { '🟢' }
        'medium' { '🟡' }
        'low' { '🟠' }
        default { '⚪' }
      }
      $lines += "- $tag $content"
      if ($e.source) { $lines[-1] += "  _($($e.source))_" }
    }
    $lines += ""
  }

  $lines | Out-File -FilePath $AiPath -Encoding utf8
  Write-Host "  ✓ $uid — memory.ai.md ($($entries.Count) 条, $($groups.Count) 类)" -ForegroundColor Green
}

Write-Host "完成" -ForegroundColor Green
