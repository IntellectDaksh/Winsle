# Prints seconds since the last real keyboard/mouse input (used to run UI tests only while nobody is at the PC).
Add-Type 'using System;using System.Runtime.InteropServices;public class I{[StructLayout(LayoutKind.Sequential)]public struct L{public uint cb;public uint t;}[DllImport("user32.dll")]public static extern bool GetLastInputInfo(ref L l);[DllImport("kernel32.dll")]public static extern uint GetTickCount();}'
$l = New-Object I+L
$l.cb = 8
[I]::GetLastInputInfo([ref]$l) | Out-Null
[math]::Floor(([I]::GetTickCount() - $l.t) / 1000)
