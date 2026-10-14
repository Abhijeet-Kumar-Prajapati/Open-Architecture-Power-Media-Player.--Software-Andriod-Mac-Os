param(
  [string]$OutDir = "C:\Users\abhij\OneDrive\Documents\Default Project\APM-Open-Player\desktop\build"
)

# Draws the APM Open Player launcher icon at several sizes.
#
# This produces the PNGs plus icon.ico (via tools/make-ico.js). The .icns has to
# be built separately - electron-builder does not convert one for us - so run:
#
#   node tools/make-ico.js
#   node tools/make-icns.js
#
# without icon.icns, `npm run dist:mac` fails on a missing file.

Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function New-Icon([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  # Rounded-square background with a diagonal blue -> violet gradient.
  $pad = [int]($size * 0.06)
  $r = [int]($size * 0.22)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $x = $pad; $y = $pad; $w = $size - 2 * $pad; $h = $size - 2 * $pad
  $d = 2 * $r
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush `
    (New-Object System.Drawing.Point $x, $y), (New-Object System.Drawing.Point ($x + $w), ($y + $h)),
    ([System.Drawing.Color]::FromArgb(255, 76, 141, 255)), ([System.Drawing.Color]::FromArgb(255, 124, 92, 255))
  $g.FillPath($brush, $path)

  # Play triangle.
  $tri = New-Object System.Drawing.Drawing2D.GraphicsPath
  $cx = $size * 0.44; $cy = $size * 0.50; $hw = $size * 0.20; $hh = $size * 0.26
  $tri.AddPolygon(@(
    (New-Object System.Drawing.PointF ($cx - $hw * 0.55), ($cy - $hh)),
    (New-Object System.Drawing.PointF ($cx + $hw), $cy),
    (New-Object System.Drawing.PointF ($cx - $hw * 0.55), ($cy + $hh))
  ))
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $g.FillPath($white, $tri)

  $g.Dispose()
  return $bmp
}

$sizes = @(16, 24, 32, 48, 64, 128, 256, 512, 1024)
$master = New-Icon 1024
$master.Save((Join-Path $OutDir "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
foreach ($s in $sizes) {
  if ($s -eq 1024) { continue }
  $img = New-Icon $s
  $img.Save((Join-Path $OutDir "icon-$s.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $img.Dispose()
}
$master.Dispose()

Write-Host "wrote icon.png and $($sizes.Count - 1) sizes into $OutDir"