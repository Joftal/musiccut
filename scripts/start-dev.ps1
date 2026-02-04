<#
.SYNOPSIS
    MusicCut Development Server
.DESCRIPTION
    Start the development server with isolated environment
.EXAMPLE
    .\scripts\start-dev.ps1
#>

$ErrorActionPreference = "Continue"

# Path settings
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$ToolsDir = Join-Path $ProjectRoot "tools"
$VenvDir = Join-Path $ToolsDir "venv"
$FFmpegDir = Join-Path $ProjectRoot "ffmpeg"  # 内置工具目录

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       MusicCut Development Server" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Set up isolated environment paths
$venvScripts = Join-Path $VenvDir "Scripts"

# Add local tools to PATH
$envPaths = @()

if (Test-Path $FFmpegDir) {
    $envPaths += $FFmpegDir
    Write-Host "[OK] FFmpeg: $FFmpegDir" -ForegroundColor Green
} else {
    Write-Host "[X]  FFmpeg not found in $FFmpegDir" -ForegroundColor Red
}

if (Test-Path $venvScripts) {
    $envPaths += $venvScripts
    Write-Host "[OK] Python venv: $venvScripts" -ForegroundColor Green
} else {
    Write-Host "[X]  Python venv not found in tools/" -ForegroundColor Red
}

# Update PATH with isolated tools (prepend to take priority)
if ($envPaths.Count -gt 0) {
    $env:PATH = ($envPaths -join ";") + ";$env:PATH"
    Write-Host ""
    Write-Host "Environment PATH updated with local tools" -ForegroundColor Gray
}

# Verify dependencies
Write-Host ""
Write-Host "Verifying dependencies..." -ForegroundColor Cyan

$hasError = $false

# Check Node.js
$nodeVer = $null
try { $nodeVer = node --version 2>$null } catch {}
if ($nodeVer) {
    Write-Host "[OK] Node.js: $nodeVer" -ForegroundColor Green
} else {
    Write-Host "[X]  Node.js not installed" -ForegroundColor Red
    $hasError = $true
}

# Check Rust
$rustVer = $null
try { $rustVer = rustc --version 2>$null } catch {}
if ($rustVer) {
    Write-Host "[OK] Rust: $rustVer" -ForegroundColor Green
} else {
    Write-Host "[X]  Rust not installed" -ForegroundColor Red
    $hasError = $true
}

# Check FFmpeg (should use local version now)
$ffmpegVer = $null
try { $ffmpegVer = ffmpeg -version 2>$null | Select-Object -First 1 } catch {}
if ($ffmpegVer) {
    Write-Host "[OK] FFmpeg available" -ForegroundColor Green
} else {
    Write-Host "[X]  FFmpeg not available" -ForegroundColor Red
    $hasError = $true
}

# Check fpcalc (should use local version now)
$fpcalcPath = $null
try { $fpcalcPath = Get-Command fpcalc -ErrorAction SilentlyContinue } catch {}
if ($fpcalcPath) {
    Write-Host "[OK] Chromaprint (fpcalc) available" -ForegroundColor Green
} else {
    Write-Host "[X]  Chromaprint (fpcalc) not available" -ForegroundColor Red
    $hasError = $true
}

# Check Python from venv
$venvPython = Join-Path $venvScripts "python.exe"
if (Test-Path $venvPython) {
    $pyVer = & $venvPython --version 2>$null
    Write-Host "[OK] Python (venv): $pyVer" -ForegroundColor Green

    # Check audio-separator
    $separatorCheck = & $venvPython -c "import audio_separator; print('ok')" 2>$null
    if ($separatorCheck -eq "ok") {
        Write-Host "[OK] audio-separator available (venv)" -ForegroundColor Green
    } else {
        Write-Host "[X]  audio-separator not installed in venv" -ForegroundColor Red
        $hasError = $true
    }

    # Check ONNX Runtime GPU
    $onnxGpuCheck = & $venvPython -c "import onnxruntime as ort; providers = ort.get_available_providers(); print('yes' if 'CUDAExecutionProvider' in providers else 'no')" 2>$null
    if ($onnxGpuCheck -eq "yes") {
        Write-Host "[OK] ONNX Runtime GPU: CUDA available" -ForegroundColor Green
    } else {
        Write-Host "[--] ONNX Runtime GPU not available (CPU mode)" -ForegroundColor Gray
    }
} else {
    Write-Host "[X]  Python venv not found" -ForegroundColor Red
    $hasError = $true
}

if ($hasError) {
    Write-Host ""
    Write-Host "Some dependencies are missing. Please run:" -ForegroundColor Yellow
    Write-Host "  .\scripts\setup.ps1" -ForegroundColor Yellow
    Write-Host ""
    exit 1
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

# Start development server
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       Starting Development Server" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "First run will compile Rust code, please wait..." -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

Set-Location $ProjectRoot
npm run tauri:dev
