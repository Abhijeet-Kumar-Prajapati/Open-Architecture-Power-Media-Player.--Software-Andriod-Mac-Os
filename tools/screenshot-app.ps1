param(
  [string]$Media = "tools\testmedia\smoke-60s.mp4",
  [int]$WarmupSeconds = 14,
  [string]$Out = "screenshot-app.png"
)

# Launches APM Open Player on a real file, waits for playback, then captures the
# whole desktop so we can see BOTH the Electron UI and the native video window
# that sits on top of it (capturePage() alone would miss the video surface).

$ErrorActionPreference = "Stop"
$root = "C:\Users\abhij\OneDrive\Documents\Default Project\APM-Open-Player"
$desktop = Join-Path $root "desktop"
$electron = Join-Path $desktop "node_modules\electron\dist\electron.exe"
$mediaPath = Join-Path $root $Media

if (-not (Test-Path $mediaPath)) { throw "media not found: $mediaPath" }

Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

$env:APM_SMOKE = ""
$p = Start-Process -FilePath $electron -ArgumentList ".", "--dev", "--no-single-instance", $mediaPath `
  -WorkingDirectory $desktop -PassThru -WindowStyle Normal

Write-Host "launched pid=$($p.Id); warming up ${WarmupSeconds}s ..."
Start-Sleep -Seconds $WarmupSeconds

# The agent's own window usually has focus, so explicitly raise the player.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@

$target = (Get-Process electron -ErrorAction SilentlyContinue |
           Where-Object { $_.MainWindowHandle -ne 0 } |
           Sort-Object StartTime | Select-Object -First 1)

if ($target) {
  [void][Win]::ShowWindow($target.MainWindowHandle, 9)   # SW_RESTORE
  [void][Win]::BringWindowToTop($target.MainWindowHandle)
  [void][Win]::SetForegroundWindow($target.MainWindowHandle)
  Start-Sleep -Seconds 3
  Write-Host "raised electron window: pid=$($target.Id) hwnd=$($target.MainWindowHandle)"
} else {
  Write-Warning "no electron window handle found"
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$outPath = Join-Path $root $Out
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

Write-Host "saved $outPath ($($bounds.Width)x$($bounds.Height))"

try { $p.CloseMainWindow() | Out-Null } catch {}
Start-Sleep -Seconds 2
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force