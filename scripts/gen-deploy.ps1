param(
    [string]$ProjectDir = "C:\Users\29548\Desktop\Sunshine\Projects\multi_agent_pipeline"
)

$files = @(
    "src/tools/workspace-config.ts",
    "src/tools/pipeline.ts",
    "src/tools/pipeline-continue.ts",
    "scripts/deploy.sh",
    "docs/orchestrator-SOUL.md"
)

$scriptLines = @()
$scriptLines += "import base64, os, sys, subprocess"
$scriptLines += ""
$scriptLines += "base_dir = '/root/multi_agent_pipeline'"
$scriptLines += ""
$scriptLines += "files = ["

foreach ($f in $files) {
    $fullPath = Join-Path $ProjectDir ($f -replace '/', '\')
    $content = Get-Content $fullPath -Raw -Encoding UTF8
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
    $b64 = [Convert]::ToBase64String($bytes)
    $scriptLines += "    ('$f', '$b64'),"
}

$scriptLines += "]"
$scriptLines += ""
$scriptLines += "for path, b64 in files:"
$scriptLines += "    full_path = os.path.join(base_dir, path)"
$scriptLines += "    os.makedirs(os.path.dirname(full_path), exist_ok=True)"
$scriptLines += "    try:"
$scriptLines += "        content = base64.b64decode(b64).decode('utf-8')"
$scriptLines += "        with open(full_path, 'w', encoding='utf-8') as f:"
$scriptLines += "            f.write(content)"
$scriptLines += "        print(f'  OK {path}')"
$scriptLines += "    except Exception as e:"
$scriptLines += "        print(f'  FAIL {path}: {e}')"
$scriptLines += ""
$scriptLines += "print()"
$scriptLines += "print('=== Building... ===')"
$scriptLines += "os.chdir(base_dir)"
$scriptLines += "r = subprocess.run(['npm', 'run', 'build'], capture_output=True, text=True)"
$scriptLines += "if r.returncode != 0:"
$scriptLines += "    print('BUILD FAILED:')"
$scriptLines += "    print(r.stderr[-1500:])"
$scriptLines += "    sys.exit(1)"
$scriptLines += ""
$scriptLines += "print('=== BUILD OK. Running deploy.sh... ===')"
$scriptLines += "r = subprocess.run(['bash', 'scripts/deploy.sh'], capture_output=True, text=True)"
$scriptLines += "out = r.stdout"
$scriptLines += "if len(out) > 3000: out = out[-3000:]"
$scriptLines += "print(out)"
$scriptLines += "if r.returncode != 0:"
$scriptLines += "    err = r.stderr"
$scriptLines += "    if len(err) > 1500: err = err[-1500:]"
$scriptLines += "    print(f'DEPLOY FAILED: {err}')"
$scriptLines += "    sys.exit(1)"
$scriptLines += ""
$scriptLines += "print('=== DEPLOY OK ===')"
$scriptLines += "print('Restart: openclaw gateway restart')"

$scriptText = $scriptLines -join "`n"
$outPath = Join-Path $ProjectDir "scripts\deploy-files.py"
Set-Content -Path $outPath -Value $scriptText -Encoding UTF8

Write-Host "Wrote $outPath ($($scriptText.Length) bytes)"
Write-Host "Lines: $($scriptLines.Count)"

# Verify by reading first 10 lines
Get-Content $outPath -TotalCount 10
