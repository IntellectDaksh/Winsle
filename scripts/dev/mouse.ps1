param([int]$x, [int]$y, [switch]$click)
Add-Type -A System.Windows.Forms
Add-Type 'using System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(int f,int dx,int dy,int d,int e);}'
[M]::SetProcessDPIAware() | Out-Null
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
[M]::SetCursorPos([int]($b.Width / 2 - 650) + $x, $y) | Out-Null
if ($click) { Start-Sleep -Milliseconds 250; [M]::mouse_event(2,0,0,0,0); Start-Sleep -Milliseconds 60; [M]::mouse_event(4,0,0,0,0) }
