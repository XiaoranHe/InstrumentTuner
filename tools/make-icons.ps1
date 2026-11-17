# ============================================================
# make-icons.ps1 - 生成 PWA 图标（192 / 512 / maskable-512）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-icons.ps1
# ============================================================
Add-Type -AssemblyName System.Drawing

function New-RoundRectPath {
  param([double]$X, [double]$Y, [double]$W, [double]$H, [double]$R)
  $max = [Math]::Min($W, $H) / 2
  if ($R -gt $max) { $R = $max }
  $d = $R * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc([single]$X, [single]$Y, [single]$d, [single]$d, 180, 90)
  $path.AddArc([single]($X + $W - $d), [single]$Y, [single]$d, [single]$d, 270, 90)
  $path.AddArc([single]($X + $W - $d), [single]($Y + $H - $d), [single]$d, [single]$d, 0, 90)
  $path.AddArc([single]$X, [single]($Y + $H - $d), [single]$d, [single]$d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-TunerIcon {
  param(
    [int]$Size,
    [string]$OutFile,
    [double]$ContentScale = 1.0
  )

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#05090e'))

  # --- 背景渐变 ---
  $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $bgA = [System.Drawing.ColorTranslator]::FromHtml('#0f2130')
  $bgB = [System.Drawing.ColorTranslator]::FromHtml('#04070b')
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @($rect, $bgA, $bgB, [single]90)
  $g.FillRectangle($bgBrush, $rect)

  # --- 顶部蓝色光晕 ---
  $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $glowPath.AddEllipse([single](-$Size * 0.35), [single](-$Size * 0.85), [single]($Size * 1.7), [single]($Size * 1.5))
  $glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
  $glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(64, 58, 155, 255)
  $glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 5, 20, 32))
  $g.FillPath($glowBrush, $glowPath)

  # --- 均衡器竖条 ---
  $heights = @(0.34, 0.58, 0.86, 0.50, 0.28)
  $n = $heights.Length
  $cs = $ContentScale

  $barW = $Size * 0.082 * $cs
  $gap = $Size * 0.040 * $cs
  $totalW = $n * $barW + ($n - 1) * $gap
  $startX = ($Size - $totalW) / 2
  $baseline = $Size * (0.5 + 0.30 * $cs)

  $topColor = [System.Drawing.ColorTranslator]::FromHtml('#7bf7da')
  $botColor = [System.Drawing.ColorTranslator]::FromHtml('#2b8dff')

  for ($i = 0; $i -lt $n; $i++) {
    $h = $Size * $heights[$i] * 0.72 * $cs
    $x = $startX + $i * ($barW + $gap)
    $y = $baseline - $h

    $path = New-RoundRectPath -X $x -Y $y -W $barW -H $h -R ($barW / 2)
    $brushRect = New-Object System.Drawing.RectangleF([single]$x, [single]$y, [single]$barW, [single]$h)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @($brushRect, $topColor, $botColor, [single]90)
    $g.FillPath($brush, $path)
    $path.Dispose()
    $brush.Dispose()
  }

  # --- 底部基准线（象征音准基准） ---
  $lineW = $Size * 0.56 * $cs
  $lineX = ($Size - $lineW) / 2
  $lineY = $baseline + $Size * 0.055
  $lineH = [Math]::Max(2, $Size * 0.012 * $cs)
  $linePath = New-RoundRectPath -X $lineX -Y $lineY -W $lineW -H $lineH -R ($lineH / 2)
  $lineBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 67, 226, 191))
  $g.FillPath($lineBrush, $linePath)
  $linePath.Dispose()
  $lineBrush.Dispose()

  $dir = [System.IO.Path]::GetDirectoryName($OutFile)
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

  $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)

  $lineBrush.Dispose()
  $bgBrush.Dispose()
  $glowBrush.Dispose()
  $glowPath.Dispose()
  $g.Dispose()
  $bmp.Dispose()
}

$root = Split-Path -Parent $PSScriptRoot
$iconDir = Join-Path $root 'icons'

New-TunerIcon -Size 192 -OutFile (Join-Path $iconDir 'icon-192.png') -ContentScale 1.0
New-TunerIcon -Size 512 -OutFile (Join-Path $iconDir 'icon-512.png') -ContentScale 1.0
New-TunerIcon -Size 512 -OutFile (Join-Path $iconDir 'icon-maskable-512.png') -ContentScale 0.66

Write-Output "icons generated at $iconDir"
