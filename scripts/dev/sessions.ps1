# Developer probe: inspect active coding sessions, hook links, and relay pipe state.

Write-Host "=== Winsle Coding Session Probe ===" -ForegroundColor Cyan

# 1. Check Winsle process
$winsle = Get-Process winsle -ErrorAction SilentlyContinue
if ($winsle) {
    Write-Host "[OK] Winsle app is running (PID: $($winsle.Id), WorkingSet: $([math]::Round($winsle.WorkingSet64 / 1MB, 1)) MB)" -ForegroundColor Green
} else {
    Write-Host "[INFO] Winsle app is not currently running" -ForegroundColor Yellow
}

# 2. Check hook relay pipe
$pipeExists = [System.IO.Directory]::GetFiles("\\.\pipe\") -match "winsle-hook"
if ($pipeExists) {
    Write-Host "[OK] Named pipe '\\.\pipe\winsle-hook' is active and listening" -ForegroundColor Green
} else {
    Write-Host "[WARN] Named pipe '\\.\pipe\winsle-hook' not detected" -ForegroundColor DarkYellow
}

# 3. Check Claude Code and Antigravity hooks configuration
$claudeSettings = Join-Path $env:USERPROFILE ".claude\settings.json"
if (Test-Path $claudeSettings) {
    $raw = Get-Content -Raw $claudeSettings
    $hasHook = $raw -match "winsle-hook"
    $statusText = if ($hasHook) { "Linked with winsle-hook" } else { "Not linked" }
    $color = if ($hasHook) { "Green" } else { "DarkYellow" }
    Write-Host "[INFO] Claude Code settings: $statusText" -ForegroundColor $color
}

$agyHooks = Join-Path $env:USERPROFILE ".gemini\config\hooks.json"
if (Test-Path $agyHooks) {
    $raw = Get-Content -Raw $agyHooks
    $hasHook = $raw -match "antigravity-bridge"
    $statusText = if ($hasHook) { "Linked with antigravity-bridge" } else { "Not linked" }
    $color = if ($hasHook) { "Green" } else { "DarkYellow" }
    Write-Host "[INFO] Antigravity hooks: $statusText" -ForegroundColor $color
}

# 4. Check for active node / python / claude child processes
$aiProcesses = Get-Process | Where-Object { $_.ProcessName -match "claude|antigravity" }
if ($aiProcesses) {
    Write-Host "`nActive Coding Tool Processes:" -ForegroundColor Cyan
    $aiProcesses | Select-Object Id, ProcessName, @{Name="Memory (MB)"; Expression={[math]::Round($_.WorkingSet64 / 1MB, 1)}} | Format-Table -AutoSize
} else {
    Write-Host "`nNo active Claude or Antigravity child processes detected." -ForegroundColor Gray
}
