param([string]$out, [int]$w = 1300, [int]$hh = 420)
Add-Type -A System.Windows.Forms, System.Drawing
Add-Type 'using System;using System.Runtime.InteropServices;public class D{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();}'
[D]::SetProcessDPIAware() | Out-Null
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen([int]($b.Width / 2 - $w / 2), 0, 0, 0, $bmp.Size)
$bmp.Save($out)
