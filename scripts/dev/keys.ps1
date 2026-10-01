param([string]$key)
Add-Type 'using System;using System.Runtime.InteropServices;public class K{[DllImport("user32.dll")]public static extern void keybd_event(byte v,byte s,int f,int e);}'
$vk = [byte][char]$key.ToUpper()
[K]::keybd_event(0x11,0,0,0); [K]::keybd_event(0x12,0,0,0); [K]::keybd_event($vk,0,0,0)
Start-Sleep -Milliseconds 60
[K]::keybd_event($vk,0,2,0); [K]::keybd_event(0x12,0,2,0); [K]::keybd_event(0x11,0,2,0)
