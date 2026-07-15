param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\build')
)

Add-Type -AssemblyName System.Drawing

function New-RoundedPath {
  param(
    [System.Drawing.RectangleF]$Rectangle,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($Rectangle.X, $Rectangle.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rectangle.X, $Rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-SocialDeckPng {
  param([int]$Size)

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $scale = $Size / 512.0
  $blue = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#4e9af0'))
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $background = New-RoundedPath ([System.Drawing.RectangleF]::new(40 * $scale, 40 * $scale, 432 * $scale, 432 * $scale)) (90 * $scale)
  $graphics.FillPath($blue, $background)

  foreach ($x in 128, 224, 320) {
    $column = New-RoundedPath ([System.Drawing.RectangleF]::new($x * $scale, 146 * $scale, 64 * $scale, 220 * $scale)) (16 * $scale)
    $graphics.FillPath($white, $column)
    $column.Dispose()
  }

  $graphics.Dispose()
  $blue.Dispose()
  $white.Dispose()
  $background.Dispose()
  return $bitmap
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null

$pngPath = Join-Path $resolvedOutput 'icon.png'
$bitmap = New-SocialDeckPng 512
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

$icoBitmap = New-SocialDeckPng 256
$stream = [System.IO.MemoryStream]::new()
$icoBitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$icoBitmap.Dispose()
$pngBytes = $stream.ToArray()
$stream.Dispose()

$icoPath = Join-Path $resolvedOutput 'icon.ico'
$writer = [System.IO.BinaryWriter]::new([System.IO.File]::Create($icoPath))
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]1)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([uint16]1)
$writer.Write([uint16]32)
$writer.Write([uint32]$pngBytes.Length)
$writer.Write([uint32]22)
$writer.Write($pngBytes)
$writer.Dispose()

Write-Output "Generated $pngPath and $icoPath"
