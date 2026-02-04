# MusicCut Build Script
# Run: .\scripts\build.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$FFmpegDir = Join-Path $ProjectRoot "ffmpeg"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       MusicCut Production Build" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Add bundled tools to PATH
if (Test-Path $FFmpegDir) {
    $env:PATH = "$FFmpegDir;$env:PATH"
    Write-Host "[OK] FFmpeg: $FFmpegDir" -ForegroundColor Green
}

# Check node_modules
$nodeModules = Join-Path $ProjectRoot "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host ""
    Write-Host "Node.js dependencies not installed." -ForegroundColor Yellow
    Write-Host "Press Enter to run npm install, or Ctrl+C to cancel..." -ForegroundColor Cyan
    Read-Host | Out-Null

    Write-Host "Installing Node.js dependencies..." -ForegroundColor Cyan
    Push-Location $ProjectRoot
    npm install
    Pop-Location
}

# Start build
Write-Host "Starting build..." -ForegroundColor Cyan
Write-Host "This may take a while, please wait..." -ForegroundColor Yellow
Write-Host ""

Set-Location $ProjectRoot

$startTime = Get-Date
npm run tauri:build
$endTime = Get-Date
$duration = $endTime - $startTime

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "       Build Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Duration: $($duration.Minutes) min $($duration.Seconds) sec" -ForegroundColor Cyan
Write-Host ""
Write-Host "Output location:" -ForegroundColor Cyan

$bundleDir = Join-Path $ProjectRoot "src-tauri\target\release\bundle"

# List generated installers
if (Test-Path $bundleDir) {
    Get-ChildItem -Path $bundleDir -Recurse -File | Where-Object {
        $_.Extension -in @(".msi", ".exe", ".dmg", ".AppImage", ".deb")
    } | ForEach-Object {
        Write-Host "  $($_.FullName)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  $bundleDir" -ForegroundColor Yellow
}

Write-Host ""
