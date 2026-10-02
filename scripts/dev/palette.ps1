param([string]$text, [int]$wait = 1500)
# Opens the palette (Ctrl+Alt+K) and types into it from one process. Refuses to
# type unless Winsle really has the keyboard, so text never lands in another app.
Add-Type -A System.Windows.Forms
Add-Type 'using System;using System.Runtime.InteropServices;public class K{[DllImport("user32.dll")]public static extern void keybd_event(byte v,byte s,int f,int e);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern int GetWindowThreadProcessId(IntPtr h,out int p);}'
[K]::keybd_event(0x11,0,0,0); [K]::keybd_event(0x12,0,0,0); [K]::keybd_event(0x4B,0,0,0)
Start-Sleep -Milliseconds 60
[K]::keybd_event(0x4B,0,2,0); [K]::keybd_event(0x12,0,2,0); [K]::keybd_event(0x11,0,2,0)
Start-Sleep -Milliseconds $wait
$p = 0; [K]::GetWindowThreadProcessId([K]::GetForegroundWindow(), [ref]$p) | Out-Null
$name = (Get-Process -Id $p).Name
if ($name -ne 'winsle') { "foreground is $name - not typing"; exit 1 }
[System.Windows.Forms.SendKeys]::SendWait($text)
"typed"
