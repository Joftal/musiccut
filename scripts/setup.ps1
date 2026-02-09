<#
.SYNOPSIS
    MusicCut Setup Script (Isolated Environment)
.DESCRIPTION
    Check and install MusicCut dependencies in isolated environment
.EXAMPLE
    .\scripts\setup.ps1
#>

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

# Path settings
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$ToolsDir = Join-Path $ProjectRoot "tools"
$DownloadsDir = Join-Path $ToolsDir "downloads"
$VenvDir = Join-Path $ToolsDir "venv"
$FFmpegDir = Join-Path $ProjectRoot "ffmpeg"  # 内置工具目录

# Create directories
if (-not (Test-Path $ToolsDir)) { New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null }
if (-not (Test-Path $DownloadsDir)) { New-Item -ItemType Directory -Path $DownloadsDir -Force | Out-Null }

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   MusicCut Setup Script (Isolated Env)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project Root:  $ProjectRoot" -ForegroundColor Cyan
Write-Host "Tools Dir:     $ToolsDir" -ForegroundColor Cyan
Write-Host "FFmpeg Dir:    $FFmpegDir" -ForegroundColor Cyan
Write-Host "Python Venv:   $VenvDir" -ForegroundColor Cyan
Write-Host ""

# Version requirements
$RequiredNodeVersion = [version]"18.0.0"
$RequiredPythonVersion = [version]"3.10.0"

# Check results
$NodeOK = $false
$RustOK = $false
$FFmpegOK = $false
$FFmpegSource = ""  # "system" or "bundled"
$FpcalcOK = $false
$FpcalcSource = ""  # "system" or "bundled"
$PythonOK = $false
$VenvOK = $false
$AudioSeparatorOK = $false
$OnnxGpuOK = $false
$TorchGpuOK = $false

function Test-CommandExists {
    param([string]$Cmd)
    $null -ne (Get-Command $Cmd -ErrorAction SilentlyContinue)
}

# Get venv Python path
function Get-VenvPython {
    $venvPython = Join-Path $VenvDir "Scripts\python.exe"
    if (Test-Path $venvPython) { return $venvPython }
    return $null
}

# Get venv pip path
function Get-VenvPip {
    $venvPip = Join-Path $VenvDir "Scripts\pip.exe"
    if (Test-Path $venvPip) { return $venvPip }
    return $null
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       Step 1: Check Dependencies" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
Write-Host "Checking Node.js... " -NoNewline
$nodeVer = $null
try { $nodeVer = node --version 2>$null } catch {}
if ($nodeVer -and $nodeVer -match "v(\d+\.\d+\.\d+)") {
    $ver = [version]$Matches[1]
    if ($ver -ge $RequiredNodeVersion) {
        Write-Host "OK ($nodeVer)" -ForegroundColor Green
        $NodeOK = $true
    } else {
        Write-Host "Version too low: $nodeVer (need >= $RequiredNodeVersion)" -ForegroundColor Yellow
    }
} else {
    Write-Host "Not installed" -ForegroundColor Red
    Write-Host "  Please install from: https://nodejs.org/" -ForegroundColor Yellow
}

# Check Rust
Write-Host "Checking Rust... " -NoNewline
if (Test-CommandExists "rustc") {
    $rustVer = rustc --version 2>$null
    Write-Host "OK ($rustVer)" -ForegroundColor Green
    $RustOK = $true
} else {
    Write-Host "Not installed" -ForegroundColor Red
    Write-Host "  Please install from: https://rustup.rs/" -ForegroundColor Yellow
}

# Check FFmpeg (bundled first, then system)
Write-Host "Checking FFmpeg... " -NoNewline
$ffmpegBundled = Join-Path $FFmpegDir "ffmpeg.exe"
if (Test-Path $ffmpegBundled) {
    Write-Host "OK (bundled: $ffmpegBundled)" -ForegroundColor Green
    $FFmpegOK = $true
    $FFmpegSource = "bundled"
} elseif (Test-CommandExists "ffmpeg") {
    $ffmpegPath = (Get-Command ffmpeg).Source
    Write-Host "OK (system: $ffmpegPath)" -ForegroundColor Green
    $FFmpegOK = $true
    $FFmpegSource = "system"
} else {
    Write-Host "Not found" -ForegroundColor Red
    Write-Host "  Please place ffmpeg.exe in: $FFmpegDir" -ForegroundColor Yellow
}

# Check fpcalc (bundled first, then system)
Write-Host "Checking fpcalc... " -NoNewline
$fpcalcBundled = Join-Path $FFmpegDir "fpcalc.exe"
if (Test-Path $fpcalcBundled) {
    Write-Host "OK (bundled: $fpcalcBundled)" -ForegroundColor Green
    $FpcalcOK = $true
    $FpcalcSource = "bundled"
} elseif (Test-CommandExists "fpcalc") {
    $fpcalcPath = (Get-Command fpcalc).Source
    Write-Host "OK (system: $fpcalcPath)" -ForegroundColor Green
    $FpcalcOK = $true
    $FpcalcSource = "system"
} else {
    Write-Host "Not found" -ForegroundColor Red
    Write-Host "  Please place fpcalc.exe in: $FFmpegDir" -ForegroundColor Yellow
}

# Check Python (system - needed to create venv)
Write-Host "Checking Python (system)... " -NoNewline
$pyVer = $null
try { $pyVer = python --version 2>$null } catch {}
if ($pyVer -and $pyVer -match "(\d+\.\d+\.\d+)") {
    $ver = [version]$Matches[1]
    if ($ver -ge $RequiredPythonVersion) {
        Write-Host "OK ($pyVer)" -ForegroundColor Green
        $PythonOK = $true
    } else {
        Write-Host "Version too low: $pyVer (need >= $RequiredPythonVersion)" -ForegroundColor Yellow
    }
} else {
    Write-Host "Not installed" -ForegroundColor Red
    Write-Host "  Please install from: https://www.python.org/" -ForegroundColor Yellow
}

# Check Python venv
Write-Host "Checking Python venv... " -NoNewline
$venvPython = Get-VenvPython
if ($venvPython) {
    Write-Host "OK ($VenvDir)" -ForegroundColor Green
    $VenvOK = $true
} else {
    Write-Host "Not created" -ForegroundColor Yellow
}

# Check audio-separator (in venv)
Write-Host "Checking audio-separator (venv)... " -NoNewline
if ($venvPython) {
    $separatorCheck = $null
    try { $separatorCheck = & $venvPython -c "import audio_separator; print('ok')" 2>$null } catch {}
    if ($separatorCheck -eq "ok") {
        Write-Host "OK" -ForegroundColor Green
        $AudioSeparatorOK = $true
    } else {
        Write-Host "Not installed" -ForegroundColor Yellow
    }
} else {
    Write-Host "Venv not ready" -ForegroundColor Yellow
}

# Check ONNX Runtime GPU (in venv)
Write-Host "Checking ONNX Runtime GPU (venv)... " -NoNewline
if ($venvPython) {
    $onnxGpuCheck = $null
    try { $onnxGpuCheck = & $venvPython -c "import onnxruntime as ort; providers = ort.get_available_providers(); print('yes' if 'CUDAExecutionProvider' in providers else 'no')" 2>$null } catch {}
    if ($onnxGpuCheck -eq "yes") {
        Write-Host "OK (CUDA available)" -ForegroundColor Green
        $OnnxGpuOK = $true
    } else {
        Write-Host "Not available" -ForegroundColor Yellow
    }
} else {
    Write-Host "Venv not ready" -ForegroundColor Yellow
}

# Check PyTorch CUDA (in venv)
Write-Host "Checking PyTorch CUDA (venv)... " -NoNewline
if ($venvPython) {
    $torchGpuCheck = $null
    try { $torchGpuCheck = & $venvPython -c "import torch; print('yes' if torch.cuda.is_available() else 'no')" 2>$null } catch {}
    if ($torchGpuCheck -eq "yes") {
        Write-Host "OK (CUDA available)" -ForegroundColor Green
        $TorchGpuOK = $true
    } else {
        Write-Host "Not available (CPU-only PyTorch)" -ForegroundColor Yellow
    }
} else {
    Write-Host "Venv not ready" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       Step 2: Install Missing" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# FFmpeg and fpcalc are bundled - no auto-download needed
if (-not $FFmpegOK) {
    Write-Host "[!] FFmpeg not found in bundled directory" -ForegroundColor Red
    Write-Host "    Please download from: https://www.gyan.dev/ffmpeg/builds/" -ForegroundColor Yellow
    Write-Host "    Extract ffmpeg.exe and ffprobe.exe to: $FFmpegDir" -ForegroundColor Yellow
    Write-Host ""
}

if (-not $FpcalcOK) {
    Write-Host "[!] fpcalc not found in bundled directory" -ForegroundColor Red
    Write-Host "    Please download from: https://acoustid.org/chromaprint" -ForegroundColor Yellow
    Write-Host "    Extract fpcalc.exe to: $FFmpegDir" -ForegroundColor Yellow
    Write-Host ""
}

# Create Python venv
if ($PythonOK -and -not $VenvOK) {
    Write-Host ""
    Write-Host "Python virtual environment not found." -ForegroundColor Yellow
    Write-Host "  Location: $VenvDir" -ForegroundColor Gray
    Write-Host "Press Enter to create venv, or Ctrl+C to cancel..." -ForegroundColor Cyan
    Read-Host | Out-Null

    Write-Host "Creating Python virtual environment..." -ForegroundColor Cyan
    try {
        python -m venv $VenvDir
        if (Test-Path (Join-Path $VenvDir "Scripts\python.exe")) {
            Write-Host "  Venv created successfully" -ForegroundColor Green
            $VenvOK = $true
            $venvPython = Get-VenvPython
        }
    } catch {
        Write-Host "  Failed to create venv: $_" -ForegroundColor Red
    }
}

# Install Python dependencies in venv
if ($VenvOK -and -not $AudioSeparatorOK) {
    Write-Host ""
    Write-Host "audio-separator not installed in venv." -ForegroundColor Yellow
    Write-Host "  This will download and install audio-separator and its dependencies." -ForegroundColor Gray
    Write-Host "Press Enter to install, or Ctrl+C to cancel..." -ForegroundColor Cyan
    Read-Host | Out-Null

    Write-Host "Installing audio-separator in venv..." -ForegroundColor Cyan
    $venvPip = Get-VenvPip
    $venvPython = Get-VenvPython

    try {
        # Upgrade pip
        Write-Host "  Upgrading pip..." -ForegroundColor Gray
        & $venvPython -m pip install --upgrade pip 2>$null | Out-Null

        # Install audio-separator
        Write-Host "  Installing audio-separator (this may take a while)..." -ForegroundColor Gray
        & $venvPip install audio-separator

        # Verify installation
        $separatorCheck = & $venvPython -c "import audio_separator; print('ok')" 2>$null
        if ($separatorCheck -eq "ok") {
            Write-Host "  audio-separator installed successfully" -ForegroundColor Green
            $AudioSeparatorOK = $true
        }
    } catch {
        Write-Host "  Failed to install audio-separator: $_" -ForegroundColor Red
    }
}

# Install GPU packages in venv (ONNX Runtime GPU + CUDA PyTorch)
if ($VenvOK -and $AudioSeparatorOK) {
    # Check for NVIDIA GPU
    $hasNvidia = $false
    try {
        nvidia-smi 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $hasNvidia = $true }
    } catch {}

    if ($hasNvidia) {
        $venvPip = Get-VenvPip
        $venvPython = Get-VenvPython

        # Install ONNX Runtime GPU
        if (-not $OnnxGpuOK) {
            Write-Host ""
            Write-Host "NVIDIA GPU detected. ONNX Runtime GPU not installed." -ForegroundColor Yellow
            Write-Host "  This will install ONNX Runtime with CUDA support." -ForegroundColor Gray
            Write-Host "Press Enter to install, or Ctrl+C to skip..." -ForegroundColor Cyan
            Read-Host | Out-Null

            try {
                Write-Host "  Removing CPU-only ONNX Runtime..." -ForegroundColor Gray
                & $venvPip uninstall onnxruntime -y 2>$null | Out-Null

                Write-Host "  Installing ONNX Runtime GPU..." -ForegroundColor Gray
                & $venvPip install onnxruntime-gpu

                $onnxGpuCheck = & $venvPython -c "import onnxruntime as ort; providers = ort.get_available_providers(); print('yes' if 'CUDAExecutionProvider' in providers else 'no')" 2>$null
                if ($onnxGpuCheck -eq "yes") {
                    Write-Host "  ONNX Runtime GPU installed successfully" -ForegroundColor Green
                    $OnnxGpuOK = $true
                } else {
                    Write-Host "  ONNX Runtime installed but CUDA not available (driver issue?)" -ForegroundColor Yellow
                }
            } catch {
                Write-Host "  Failed to install ONNX Runtime GPU: $_" -ForegroundColor Red
            }
        }

        # Install CUDA-enabled PyTorch (replaces CPU-only version from audio-separator)
        if (-not $TorchGpuOK) {
            Write-Host ""
            Write-Host "NVIDIA GPU detected. PyTorch CUDA not installed." -ForegroundColor Yellow
            Write-Host "  This will replace CPU-only PyTorch with CUDA-enabled version." -ForegroundColor Gray
            Write-Host "  audio-separator needs PyTorch CUDA to enable GPU acceleration." -ForegroundColor Gray
            Write-Host "Press Enter to install, or Ctrl+C to skip..." -ForegroundColor Cyan
            Read-Host | Out-Null

            try {
                Write-Host "  Removing CPU-only PyTorch..." -ForegroundColor Gray
                & $venvPip uninstall torch torchvision -y 2>$null | Out-Null

                Write-Host "  Installing PyTorch with CUDA support (this may take a while)..." -ForegroundColor Gray
                & $venvPip install torch torchvision --index-url https://download.pytorch.org/whl/cu128

                $torchGpuCheck = & $venvPython -c "import torch; print('yes' if torch.cuda.is_available() else 'no')" 2>$null
                if ($torchGpuCheck -eq "yes") {
                    Write-Host "  PyTorch CUDA installed successfully" -ForegroundColor Green
                    $TorchGpuOK = $true
                } else {
                    Write-Host "  PyTorch installed but CUDA not available (driver issue?)" -ForegroundColor Yellow
                }
            } catch {
                Write-Host "  Failed to install PyTorch CUDA: $_" -ForegroundColor Red
            }
        }
    } else {
        if (-not $OnnxGpuOK -or -not $TorchGpuOK) {
            Write-Host "No NVIDIA GPU detected, skipping GPU installation" -ForegroundColor Gray
        }
    }
}

# Install Node.js dependencies
if ($NodeOK) {
    $nodeModules = Join-Path $ProjectRoot "node_modules"
    if (-not (Test-Path $nodeModules)) {
        Write-Host ""
        Write-Host "Node.js dependencies not installed." -ForegroundColor Yellow
        Write-Host "  Location: $ProjectRoot\node_modules" -ForegroundColor Gray
        Write-Host "Press Enter to run npm install, or Ctrl+C to cancel..." -ForegroundColor Cyan
        Read-Host | Out-Null
    }

    Write-Host "Installing Node.js dependencies..." -ForegroundColor Cyan
    Write-Host "  Location: $ProjectRoot\node_modules" -ForegroundColor Gray
    Push-Location $ProjectRoot
    try {
        npm install 2>&1 | Out-Null
        Write-Host "  Node.js dependencies installed successfully" -ForegroundColor Green
    } catch {
        Write-Host "  Failed: $_" -ForegroundColor Red
    }
    Pop-Location
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       Environment Summary" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Dependencies location:" -ForegroundColor Gray
Write-Host ""
Write-Host "  Node.js deps:  $ProjectRoot\node_modules\" -ForegroundColor White
if ($FFmpegSource -eq "system") {
    Write-Host "  FFmpeg:        System PATH" -ForegroundColor White
} else {
    Write-Host "  FFmpeg:        $FFmpegDir\" -ForegroundColor White
}
if ($FpcalcSource -eq "system") {
    Write-Host "  fpcalc:        System PATH" -ForegroundColor White
} else {
    Write-Host "  fpcalc:        $FFmpegDir\" -ForegroundColor White
}
Write-Host "  Python venv:   $VenvDir\" -ForegroundColor White
Write-Host ""

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       Dependency Status" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$allOk = $true

if ($NodeOK) { Write-Host "  [OK] Node.js" -ForegroundColor Green }
else { Write-Host "  [X]  Node.js" -ForegroundColor Red; $allOk = $false }

if ($RustOK) { Write-Host "  [OK] Rust" -ForegroundColor Green }
else { Write-Host "  [X]  Rust" -ForegroundColor Red; $allOk = $false }

if ($FFmpegOK) {
    if ($FFmpegSource -eq "system") {
        Write-Host "  [OK] FFmpeg (system)" -ForegroundColor Green
    } else {
        Write-Host "  [OK] FFmpeg (bundled)" -ForegroundColor Green
    }
}
else { Write-Host "  [X]  FFmpeg" -ForegroundColor Red; $allOk = $false }

if ($FpcalcOK) {
    if ($FpcalcSource -eq "system") {
        Write-Host "  [OK] fpcalc (system)" -ForegroundColor Green
    } else {
        Write-Host "  [OK] fpcalc (bundled)" -ForegroundColor Green
    }
}
else { Write-Host "  [X]  fpcalc" -ForegroundColor Red; $allOk = $false }

if ($PythonOK) { Write-Host "  [OK] Python (system)" -ForegroundColor Green }
else { Write-Host "  [X]  Python (system)" -ForegroundColor Red; $allOk = $false }

if ($VenvOK) { Write-Host "  [OK] Python venv" -ForegroundColor Green }
else { Write-Host "  [X]  Python venv" -ForegroundColor Red; $allOk = $false }

if ($AudioSeparatorOK) { Write-Host "  [OK] audio-separator (venv)" -ForegroundColor Green }
else { Write-Host "  [X]  audio-separator (venv)" -ForegroundColor Red; $allOk = $false }

if ($OnnxGpuOK) { Write-Host "  [OK] ONNX Runtime GPU (venv)" -ForegroundColor Green }
else { Write-Host "  [--] ONNX Runtime GPU (optional)" -ForegroundColor Gray }

if ($TorchGpuOK) { Write-Host "  [OK] PyTorch CUDA (venv)" -ForegroundColor Green }
else { Write-Host "  [--] PyTorch CUDA (optional)" -ForegroundColor Gray }

Write-Host ""

if ($allOk) {
    Write-Host "All dependencies are ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "To start development server:" -ForegroundColor Cyan
    Write-Host "  .\scripts\start-dev.ps1" -ForegroundColor Yellow
} else {
    Write-Host "Some dependencies are missing." -ForegroundColor Yellow
    Write-Host "Please install them manually and run this script again." -ForegroundColor Yellow
    Write-Host ""
    if (-not $NodeOK) { Write-Host "  Node.js: https://nodejs.org/" -ForegroundColor Gray }
    if (-not $RustOK) { Write-Host "  Rust: https://rustup.rs/" -ForegroundColor Gray }
    if (-not $PythonOK) { Write-Host "  Python: https://www.python.org/" -ForegroundColor Gray }
    if (-not $FFmpegOK -or -not $FpcalcOK) {
        Write-Host "  FFmpeg/fpcalc: Place in $FFmpegDir\" -ForegroundColor Gray
    }
}

Write-Host ""
