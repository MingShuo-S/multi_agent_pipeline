# scripts/sync-style.ps1 - Voiceprint 输出同步到 .styles/ 目录
# 用法: .\scripts\sync-style.ps1 -From <SKILL.md路径> [-To <目标目录>] [-DryRun]
#
# 将 Voiceprint 生成的 SKILL.md 中的风格数据同步到本地 .styles/ 目录
# 支持 .ai.md 伴侣文件同步

param(
    [Parameter(Mandatory=$true)]
    [string]$From,

    [string]$To,

    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# 路径解析
$aiWorkspace = $env:AI_WORKSPACE
if (-not $aiWorkspace) {
    $aiWorkspace = Join-Path $env:USERPROFILE "Documents\Sunshine\0. AI工作区"
}

if (-not $To) {
    $To = Join-Path $aiWorkspace ".styles"
}

Write-Host "=== sync-style ===" -ForegroundColor Cyan
Write-Host "  From: $From"
Write-Host "  To:   $To"
Write-Host "  AI Workspace: $aiWorkspace"
if ($DryRun) { Write-Host "  [DRY RUN]" -ForegroundColor Yellow }

# 验证源文件存在
if (-not (Test-Path $From)) {
    Write-Error "源文件不存在: $From"
    exit 1
}

# 读取 SKILL.md
$content = Get-Content $From -Raw -Encoding UTF8

# 解析 section 边界（## 开头的标题）
$sections = @{}
$currentSection = $null
$currentContent = @()

foreach ($line in ($content -split "`n")) {
    if ($line -match "^##\s+(.+)$") {
        # 保存上一个 section
        if ($currentSection) {
            $sections[$currentSection] = ($currentContent -join "`n").Trim()
        }
        $currentSection = $Matches[1].Trim()
        $currentContent = @()
    } elseif ($currentSection) {
        $currentContent += $line
    }
}
# 保存最后一个 section
if ($currentSection) {
    $sections[$currentSection] = ($currentContent -join "`n").Trim()
}

Write-Host "`n发现 $($sections.Count) 个 section:" -ForegroundColor Green
foreach ($key in $sections.Keys) {
    $preview = $sections[$key].Substring(0, [Math]::Min(60, $sections[$key].Length))
    Write-Host "  - $key ($($sections[$key].Length) chars)"
}

# 提取风格相关 sections
$styleSections = @(
    "核心原则", "Core Principles",
    "禁止模式", "Forbidden Patterns",
    "高频词汇", "High Frequency Words",
    "技术术语", "Tech Terms",
    "句式模式", "Syntax Patterns",
    "成长方向", "Growth Direction",
    "风格DNA", "Style DNA",
    "写作偏好", "Writing Preferences"
)

$extracted = @{}
foreach ($key in $sections.Keys) {
    foreach ($pattern in $styleSections) {
        if ($key -match $pattern) {
            $extracted[$key] = $sections[$key]
            break
        }
    }
}

# 如果没有匹配到预定义 section，提取全部
if ($extracted.Count -eq 0) {
    Write-Host "未匹配到标准风格 section，将同步全部内容" -ForegroundColor Yellow
    $extracted = $sections
}

# 确保目标目录存在
if (-not $DryRun) {
    if (-not (Test-Path $To)) {
        New-Item -ItemType Directory -Path $To -Force | Out-Null
        Write-Host "创建目录: $To" -ForegroundColor Green
    }
}

# 写入风格文件
$outputFile = Join-Path $To "voiceprint-output.md"
$outputContent = "# Voiceprint 风格输出`n`n"
$outputContent += "> 由 sync-style.ps1 从 $From 同步`n"
$outputContent += "> 时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n`n"

foreach ($key in $extracted.Keys) {
    $outputContent += "## $key`n`n"
    $outputContent += $extracted[$key] + "`n`n"
}

if ($DryRun) {
    Write-Host "`n[DRY RUN] 将写入 $outputFile ($($outputContent.Length) chars)" -ForegroundColor Yellow
    Write-Host "`n--- 预览 ---" -ForegroundColor Cyan
    Write-Host $outputContent.Substring(0, [Math]::Min(500, $outputContent.Length))
    if ($outputContent.Length -gt 500) { Write-Host "... (truncated)" }
} else {
    Set-Content -Path $outputFile -Value $outputContent -Encoding UTF8
    Write-Host "已写入: $outputFile" -ForegroundColor Green
}

# 同步 .ai.md 伴侣文件
$aiMdPath = [System.IO.Path]::ChangeExtension($From, ".ai.md")
if (Test-Path $aiMdPath) {
    $aiMdDest = Join-Path $To "voiceprint-companion.ai.md"
    if ($DryRun) {
        Write-Host "[DRY RUN] 将同步伴侣文件: $aiMdPath -> $aiMdDest" -ForegroundColor Yellow
    } else {
        Copy-Item $aiMdPath $aiMdDest -Force
        Write-Host "已同步伴侣文件: $aiMdDest" -ForegroundColor Green
    }
} else {
    Write-Host "未找到伴侣文件: $aiMdPath (跳过)" -ForegroundColor DarkGray
}

Write-Host "`n=== 完成 ===" -ForegroundColor Cyan
