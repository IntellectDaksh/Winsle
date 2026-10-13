$candidates = @(
    (Join-Path $PSScriptRoot "..\app\target\release\winsle.exe"),
    (Join-Path $env:LOCALAPPDATA "Winsle\bin\winsle.exe"),
    "D:\Project X\winsle\app\target\release\winsle.exe",
    "D:\project x\Github Pushes\winsle-export\app\target\release\winsle.exe"
)

$exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

Add-Type -AssemblyName System.Windows.Forms
$p = Get-Process winsle -ErrorAction SilentlyContinue

if ($p) {
    $p | Stop-Process -Force
    $msg = "Winsle stopped"
} else {
    if (-not $exe) {
        [System.Windows.Forms.MessageBox]::Show("Could not find winsle.exe. Please run 'cargo build --release' or install via setup.", "Winsle", "OK", "Warning")
        exit 1
    }
    Start-Process $exe -WorkingDirectory (Split-Path $exe)
    $msg = "Winsle started"
}

if ($exe -and (Test-Path $exe)) {
    $n = New-Object System.Windows.Forms.NotifyIcon
    $n.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
    $n.Visible = $true
    $n.ShowBalloonTip(2000, "Winsle", $msg, "Info")
    Start-Sleep 3
    $n.Dispose()
}
