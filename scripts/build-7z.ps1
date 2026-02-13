# MusicCut 7z Self-Extracting Package Builder
# Creates a portable package with all dependencies
# Run: .\scripts\build-7z.ps1

param(
    [switch]$SkipBuild,
    [switch]$SkipConfirm
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$FFmpegDir = Join-Path $ProjectRoot "ffmpeg"
$ModelsDir = Join-Path $ProjectRoot "models"
$AudioSeparatorDist = Join-Path $ProjectRoot "src-tauri\resources\audio-separator"
$PersonDetectorDist = Join-Path $ProjectRoot "src-tauri\resources\person-detector"
$ReleaseDir = Join-Path $ProjectRoot "src-tauri\target\release"
$OutputDir = Join-Path $ProjectRoot "dist\MusicCut"
$FinalOutput = Join-Path $ProjectRoot "dist"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "    MusicCut 7z Package Builder" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check 7-Zip
$7zPath = $null
$7zPaths = @(
    "C:\Program Files\7-Zip\7z.exe",
    "C:\Program Files (x86)\7-Zip\7z.exe",
    (Get-Command 7z -ErrorAction SilentlyContinue).Source
)

foreach ($path in $7zPaths) {
    if ($path -and (Test-Path $path)) {
        $7zPath = $path
        break
    }
}

if (-not $7zPath) {
    Write-Host "[X] 7-Zip not found" -ForegroundColor Red
    Write-Host "    Please install from: https://www.7-zip.org/" -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] 7-Zip: $7zPath" -ForegroundColor Green

# Check resources
Write-Host ""
Write-Host "Checking resources..." -ForegroundColor Cyan

$hasError = $false

# FFmpeg
if (Test-Path (Join-Path $FFmpegDir "ffmpeg.exe")) {
    $ffmpegSize = (Get-ChildItem -Path $FFmpegDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
    $ffmpegSizeMB = [math]::Round($ffmpegSize / 1MB, 2)
    Write-Host "[OK] FFmpeg: $ffmpegSizeMB MB" -ForegroundColor Green
} else {
    Write-Host "[X]  FFmpeg not found" -ForegroundColor Red
    $hasError = $true
}

# Models
$modelFiles = Get-ChildItem -Path $ModelsDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @(".onnx", ".ckpt", ".th", ".yaml", ".pt") }
$modelCount = $modelFiles.Count
$modelSize = ($modelFiles | Measure-Object -Property Length -Sum).Sum
$modelSizeMB = [math]::Round($modelSize / 1MB, 2)

if ($modelCount -gt 0) {
    Write-Host "[OK] Models: $modelCount files ($modelSizeMB MB)" -ForegroundColor Green
} else {
    Write-Host "[!]  No models found" -ForegroundColor Yellow
}

# audio-separator
if (Test-Path $AudioSeparatorDist) {
    $sepSize = (Get-ChildItem -Path $AudioSeparatorDist -Recurse -File | Measure-Object -Property Length -Sum).Sum
    $sepSizeMB = [math]::Round($sepSize / 1MB, 2)
    Write-Host "[OK] audio-separator: $sepSizeMB MB" -ForegroundColor Green
} else {
    Write-Host "[!]  audio-separator not found" -ForegroundColor Yellow
}

# person-detector
$detSizeMB = 0
if (Test-Path $PersonDetectorDist) {
    $detSize = (Get-ChildItem -Path $PersonDetectorDist -Recurse -File | Measure-Object -Property Length -Sum).Sum
    $detSizeMB = [math]::Round($detSize / 1MB, 2)
    Write-Host "[OK] person-detector: $detSizeMB MB" -ForegroundColor Green
} else {
    Write-Host "[!]  person-detector not found" -ForegroundColor Yellow
}

if ($hasError) {
    Write-Host ""
    Write-Host "Missing required resources." -ForegroundColor Red
    exit 1
}

# Calculate total size
$totalSizeMB = $ffmpegSizeMB + $modelSizeMB + $sepSizeMB + $detSizeMB + 20
Write-Host ""
Write-Host "Estimated package size: ~$totalSizeMB MB (before compression)" -ForegroundColor Cyan

if (-not $SkipConfirm) {
    Write-Host ""
    Write-Host "Press Enter to continue, or Ctrl+C to cancel..." -ForegroundColor Cyan
    Read-Host | Out-Null
}

# Step 1: Build Tauri (if not skipped)
if (-not $SkipBuild) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  [1/3] Building Tauri application" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""

    # Check node_modules
    $nodeModules = Join-Path $ProjectRoot "node_modules"
    if (-not (Test-Path $nodeModules)) {
        Write-Host "Installing Node.js dependencies..." -ForegroundColor Cyan
        Push-Location $ProjectRoot
        npm install
        Pop-Location
    }

    # Add FFmpeg to PATH
    $env:PATH = "$FFmpegDir;$env:PATH"

    Write-Host "Building Tauri application..." -ForegroundColor Cyan
    Set-Location $ProjectRoot
    npm run tauri:build

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[X] Tauri build failed" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host ""
    Write-Host "[--] Skipping Tauri build" -ForegroundColor Gray
}

# Check if exe exists
$mainExe = Join-Path $ReleaseDir "MusicCut.exe"
if (-not (Test-Path $mainExe)) {
    Write-Host "[X] MusicCut.exe not found at $mainExe" -ForegroundColor Red
    exit 1
}

# Step 2: Assemble package
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  [2/3] Assembling package" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Clean output directory
if (Test-Path $OutputDir) {
    Write-Host "Cleaning previous output..." -ForegroundColor Gray
    Remove-Item -Recurse -Force $OutputDir
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

# Copy main exe
Write-Host "Copying MusicCut.exe..." -ForegroundColor Gray
Copy-Item $mainExe $OutputDir

# Copy WebView2Loader.dll if exists
$webview2Dll = Join-Path $ReleaseDir "WebView2Loader.dll"
if (Test-Path $webview2Dll) {
    Copy-Item $webview2Dll $OutputDir
}

# Copy FFmpeg
Write-Host "Copying FFmpeg..." -ForegroundColor Gray
$destFFmpeg = Join-Path $OutputDir "ffmpeg"
Copy-Item -Recurse $FFmpegDir $destFFmpeg

# Copy models
if ($modelCount -gt 0) {
    Write-Host "Copying models ($modelSizeMB MB)..." -ForegroundColor Gray
    $destModels = Join-Path $OutputDir "models"
    Copy-Item -Recurse $ModelsDir $destModels
}

# Copy audio-separator
if (Test-Path $AudioSeparatorDist) {
    Write-Host "Copying audio-separator ($sepSizeMB MB)..." -ForegroundColor Gray
    $destSep = Join-Path $OutputDir "audio-separator"
    Copy-Item -Recurse $AudioSeparatorDist $destSep
}

# Copy person-detector
if (Test-Path $PersonDetectorDist) {
    Write-Host "Copying person-detector ($detSizeMB MB)..." -ForegroundColor Gray
    $destDet = Join-Path $OutputDir "person-detector"
    Copy-Item -Recurse $PersonDetectorDist $destDet
}

# Create run script
$runScript = @"
@echo off
cd /d "%~dp0"
start "" "MusicCut.exe"
"@
# $runScript | Out-File -FilePath (Join-Path $OutputDir "Run MusicCut.bat") -Encoding ASCII

Write-Host "[OK] Package assembled" -ForegroundColor Green

# Step 3: Create 7z archive
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  [3/3] Creating 7z archive" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$archiveName = "MusicCut_1.0.0_x64.7z"
$archivePath = Join-Path $FinalOutput $archiveName

if (Test-Path $archivePath) {
    Remove-Item $archivePath -Force
}

Write-Host "Compressing with 7-Zip (this may take a while)..." -ForegroundColor Cyan
& $7zPath a -t7z -mx=9 -mfb=64 -md=32m -ms=on $archivePath "$OutputDir\*"

if ($LASTEXITCODE -ne 0) {
    Write-Host "[X] 7z compression failed" -ForegroundColor Red
    exit 1
}

# Get final size
$archiveSize = (Get-Item $archivePath).Length
$archiveSizeMB = [math]::Round($archiveSize / 1MB, 2)

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "       Package Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Output: $archivePath" -ForegroundColor Yellow
Write-Host "Size:   $archiveSizeMB MB" -ForegroundColor Yellow
Write-Host ""
Write-Host "Usage:" -ForegroundColor Cyan
Write-Host "  1. Extract the 7z file to any folder" -ForegroundColor Gray
Write-Host "  2. Run 'MusicCut.exe'" -ForegroundColor Gray
Write-Host ""
