param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$version = '8.1.2'
$archiveSha256 = 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec'
$archiveUrl = "https://github.com/GyanD/codexffmpeg/releases/download/$version/ffmpeg-$version-essentials_build.zip"
$repoRoot = Split-Path -Parent $PSScriptRoot
$targetDirectory = Join-Path $repoRoot 'vendor\ffmpeg\win32-x64'
$targetPath = Join-Path $targetDirectory 'ffmpeg.exe'

function Test-InstalledVersion {
  if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) { return $false }
  try {
    $versionOutput = @(& $targetPath -version 2>&1)
    $exitCode = $LASTEXITCODE
    $firstLine = $versionOutput | Select-Object -First 1
    return $exitCode -eq 0 -and $firstLine -match "^ffmpeg version $([regex]::Escape($version))\b"
  } catch {
    return $false
  }
}

if (-not $Force -and (Test-InstalledVersion)) {
  Write-Host "FFmpeg $version is already installed."
  exit 0
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "socialdeck-ffmpeg-$([guid]::NewGuid())"
$archivePath = Join-Path $temporaryDirectory 'ffmpeg.zip'
$extractPath = Join-Path $temporaryDirectory 'extracted'

try {
  New-Item -ItemType Directory -Force -Path $temporaryDirectory, $extractPath, $targetDirectory | Out-Null
  Write-Host "Downloading FFmpeg $version..."
  Invoke-WebRequest -UseBasicParsing -Uri $archiveUrl -OutFile $archivePath

  $actualSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $archiveSha256) {
    throw "FFmpeg archive checksum mismatch. Expected $archiveSha256, received $actualSha256."
  }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
  $binary = Get-ChildItem -LiteralPath $extractPath -Recurse -Filter 'ffmpeg.exe' -File |
    Where-Object { $_.FullName -match '[\\/]bin[\\/]ffmpeg\.exe$' } |
    Select-Object -First 1
  if (-not $binary) { throw 'The verified FFmpeg archive did not contain bin/ffmpeg.exe.' }

  Copy-Item -LiteralPath $binary.FullName -Destination $targetPath -Force
  if (-not (Test-InstalledVersion)) {
    Remove-Item -LiteralPath $targetPath -Force -ErrorAction SilentlyContinue
    throw "Installed FFmpeg did not report the expected version $version."
  }

  Write-Host "Installed FFmpeg $version at $targetPath"
} finally {
  Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
