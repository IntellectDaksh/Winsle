$exe = "D:\Project X\winsle\app\target\release\winsle.exe"
Add-Type -AssemblyName System.Windows.Forms
$p = Get-Process winsle -ErrorAction SilentlyContinue
if ($p) { $p | Stop-Process -Force; $msg = "Winsle stopped" }
else { Start-Process $exe -WorkingDirectory (Split-Path $exe); $msg = "Winsle started" }
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe); $n.Visible = $true
$n.ShowBalloonTip(2000, "Winsle", $msg, "Info"); Start-Sleep 3; $n.Dispose()
