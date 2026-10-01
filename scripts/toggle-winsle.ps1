# Starts Winsle if it is not running, stops it if it is.
# Meant for a desktop shortcut:
#   powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "<repo>\scripts\toggle-winsle.ps1"
$root = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $root 'app\target\release\winsle.exe'
$running = Get-Process winsle -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Windows.Forms
if ($running) {
    $running | Stop-Process -Force
    # Force-kill skips WebView2 shutdown, so its helper processes would linger.
    Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
        Where-Object { $_.CommandLine -match 'com\.winsle\.app' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} elseif (Test-Path $exe) {
    # Re-link ai-assistant Code (terminal + VS Code) and Antigravity on every start; no-op when already linked.
    node (Join-Path $PSScriptRoot 'hooks\link-hooks.mjs') | Out-Null
    Start-Process $exe
} else {
    [System.Windows.Forms.MessageBox]::Show("Not built yet:`n$exe", 'Winsle') | Out-Null
}
