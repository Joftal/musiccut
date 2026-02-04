# MusicCut Dependency Checker
# Run: .\scripts\check-deps.ps1

$ErrorActionPreference = "Continue"

function Write-Success { param([string]$Msg) Write-Host $Msg -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host $Msg -ForegroundColor Yellow }
function Write-Err { param([string]$Msg) Write-Host $Msg -ForegroundColor Red }
function Write-Info { param([string]$Msg) Write-Host $Msg -ForegroundColor Cyan }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$ToolsDir = Join-Path $ProjectRoot "tools"
$FFmpegDir = Join-Path $ProjectRoot "ffmpeg"
$VenvDir = Join-Path $ToolsDir "venv"

Write-Info "============================================"
Write-Info "     MusicCut Dependency Checker"
Write-Info "============================================"
Write-Host ""

$RequiredNodeVersion = [version]"18.0.0"
$RequiredPythonVersion = [version]"3.10.0"
$Results = @()

function Add-Result {
    param([string]$Name, [string]$Status, [string]$Version, [string]$Path, [string]$Note)
    $script:Results += [PSCustomObject]@{
        Name = $Name; Status = $Status; Version = $Version; Path = $Path; Note = $Note
    }
}

function Test-Command {
    param([string]$Command)
    try { $null = Get-Command $Command -ErrorAction Stop; return $true }
    catch { return $false }
}

Write-Info "Checking dependencies..."
Write-Host ""

# 1. Node.js
Write-Host "Checking Node.js..." -NoNewline
try {
    $nodeVersion = node --version 2>$null
    if ($nodeVersion -match "v(\d+\.\d+\.\d+)") {
        $version = [version]$Matches[1]
        $nodePath = (Get-Command node).Source
        if ($version -ge $RequiredNodeVersion) {
            Write-Success " OK"
            Add-Result -Name "Node.js" -Status "OK" -Version $nodeVersion -Path $nodePath -Note ""
        } else {
            Write-Warn " Version too low"
            Add-Result -Name "Node.js" -Status "WARN" -Version $nodeVersion -Path $nodePath -Note "Need >= v$RequiredNodeVersion"
        }
    }
} catch {
    Write-Err " Not installed"
    Add-Result -Name "Node.js" -Status "FAIL" -Version "-" -Path "-" -Note "https://nodejs.org/"
}

# 2. npm
Write-Host "Checking npm..." -NoNewline
try {
    $npmVersion = npm --version 2>$null
    if ($npmVersion) {
        $npmPath = (Get-Command npm).Source
        Write-Success " OK"
        Add-Result -Name "npm" -Status "OK" -Version "v$npmVersion" -Path $npmPath -Note ""
    }
} catch {
    Write-Err " Not installed"
    Add-Result -Name "npm" -Status "FAIL" -Version "-" -Path "-" -Note "Comes with Node.js"
}

# 3. Rust
Write-Host "Checking Rust..." -NoNewline
try {
    $rustVersion = rustc --version 2>$null
    if ($rustVersion -match "rustc (\d+\.\d+\.\d+)") {
        $rustPath = (Get-Command rustc).Source
        Write-Success " OK"
        Add-Result -Name "Rust" -Status "OK" -Version $Matches[1] -Path $rustPath -Note ""
    }
} catch {
    Write-Err " Not installed"
    Add-Result -Name "Rust" -Status "FAIL" -Version "-" -Path "-" -Note "https://rustup.rs/"
}

# 4. Cargo
Write-Host "Checking Cargo..." -NoNewline
try {
    $cargoVersion = cargo --version 2>$null
    if ($cargoVersion -match "cargo (\d+\.\d+\.\d+)") {
        $cargoPath = (Get-Command cargo).Source
        Write-Success " OK"
        Add-Result -Name "Cargo" -Status "OK" -Version $Matches[1] -Path $cargoPath -Note ""
    }
} catch {
    Write-Err " Not installed"
    Add-Result -Name "Cargo" -Status "FAIL" -Version "-" -Path "-" -Note "Comes with Rust"
}

# 5. FFmpeg
Write-Host "Checking FFmpeg..." -NoNewline
$ffmpegFound = $false
if (Test-Command "ffmpeg") {
    $ffmpegVersion = ffmpeg -version 2>$null | Select-Object -First 1
    if ($ffmpegVersion -match "ffmpeg version (\S+)") {
        $ffmpegPath = (Get-Command ffmpeg).Source
        Write-Success " OK"
        Add-Result -Name "FFmpeg" -Status "OK" -Version $Matches[1] -Path $ffmpegPath -Note ""
        $ffmpegFound = $true
    }
}
if (-not $ffmpegFound) {
    $localFFmpeg = Join-Path $FFmpegDir "ffmpeg.exe"
    if (Test-Path $localFFmpeg) {
        $ffmpegVersion = & $localFFmpeg -version 2>$null | Select-Object -First 1
        if ($ffmpegVersion -match "ffmpeg version (\S+)") {
            Write-Success " OK (local)"
            Add-Result -Name "FFmpeg" -Status "OK" -Version $Matches[1] -Path $localFFmpeg -Note "Local"
            $ffmpegFound = $true
        }
    }
}
if (-not $ffmpegFound) {
    Write-Err " Not installed"
    Add-Result -Name "FFmpeg" -Status "FAIL" -Version "-" -Path "-" -Note "Put in ffmpeg/ folder"
}

# 6. Chromaprint
Write-Host "Checking Chromaprint..." -NoNewline
$fpcalcFound = $false
if (Test-Command "fpcalc") {
    $fpcalcPath = (Get-Command fpcalc).Source
    Write-Success " OK"
    Add-Result -Name "Chromaprint" -Status "OK" -Version "-" -Path $fpcalcPath -Note ""
    $fpcalcFound = $true
}
if (-not $fpcalcFound) {
    $localFpcalc = Join-Path $FFmpegDir "fpcalc.exe"
    if (Test-Path $localFpcalc) {
        Write-Success " OK (local)"
        Add-Result -Name "Chromaprint" -Status "OK" -Version "-" -Path $localFpcalc -Note "Local"
        $fpcalcFound = $true
    }
}
if (-not $fpcalcFound) {
    Write-Err " Not installed"
    Add-Result -Name "Chromaprint" -Status "FAIL" -Version "-" -Path "-" -Note "Put in ffmpeg/ folder"
}

# 7. Python
Write-Host "Checking Python..." -NoNewline
try {
    $pythonVersion = python --version 2>$null
    if ($pythonVersion -match "Python (\d+\.\d+\.\d+)") {
        $version = [version]$Matches[1]
        $pythonPath = (Get-Command python).Source
        if ($version -ge $RequiredPythonVersion) {
            Write-Success " OK"
            Add-Result -Name "Python" -Status "OK" -Version $Matches[1] -Path $pythonPath -Note ""
        } else {
            Write-Warn " Version too low"
            Add-Result -Name "Python" -Status "WARN" -Version $Matches[1] -Path $pythonPath -Note "Need >= $RequiredPythonVersion"
        }
    }
} catch {
    Write-Err " Not installed"
    Add-Result -Name "Python" -Status "FAIL" -Version "-" -Path "-" -Note "https://www.python.org/"
}

# 8. pip
Write-Host "Checking pip..." -NoNewline
try {
    $pipVersion = pip --version 2>$null
    if ($pipVersion -match "pip (\d+\.\d+)") {
        Write-Success " OK"
        Add-Result -Name "pip" -Status "OK" -Version $Matches[1] -Path "-" -Note ""
    }
} catch {
    Write-Err " Not installed"
    Add-Result -Name "pip" -Status "FAIL" -Version "-" -Path "-" -Note "Comes with Python"
}

# 9. Python venv
Write-Host "Checking Python venv..." -NoNewline
$venvPython = Join-Path $VenvDir "Scripts\python.exe"
if (Test-Path $venvPython) {
    Write-Success " OK"
    Add-Result -Name "Python venv" -Status "OK" -Version "-" -Path $VenvDir -Note "Isolated env"
} else {
    Write-Warn " Not created"
    Add-Result -Name "Python venv" -Status "WARN" -Version "-" -Path "-" -Note "Run setup.ps1"
}

# 10. audio-separator
Write-Host "Checking audio-separator..." -NoNewline
if (Test-Path $venvPython) {
    try {
        $sepVer = & $venvPython -c "import audio_separator; print(audio_separator.__version__)" 2>$null
        if ($sepVer) {
            Write-Success " OK"
            Add-Result -Name "audio-separator" -Status "OK" -Version $sepVer -Path "-" -Note "venv"
        } else { throw "not found" }
    } catch {
        Write-Warn " Not installed"
        Add-Result -Name "audio-separator" -Status "WARN" -Version "-" -Path "-" -Note "Run setup.ps1"
    }
} else {
    Write-Warn " venv not ready"
    Add-Result -Name "audio-separator" -Status "WARN" -Version "-" -Path "-" -Note "Create venv first"
}

# 11. ONNX Runtime
Write-Host "Checking ONNX Runtime..." -NoNewline
if (Test-Path $venvPython) {
    try {
        $onnxVer = & $venvPython -c "import onnxruntime; print(onnxruntime.__version__)" 2>$null
        if ($onnxVer) {
            Write-Success " OK"
            Add-Result -Name "ONNX Runtime" -Status "OK" -Version $onnxVer -Path "-" -Note "venv"
        } else { throw "not found" }
    } catch {
        Write-Warn " Not installed"
        Add-Result -Name "ONNX Runtime" -Status "WARN" -Version "-" -Path "-" -Note "audio-separator dep"
    }
} else {
    Write-Warn " venv not ready"
    Add-Result -Name "ONNX Runtime" -Status "WARN" -Version "-" -Path "-" -Note "Create venv first"
}

Write-Host ""
Write-Info "Checking GPU support..."
Write-Host ""

# NVIDIA GPU
Write-Host "Checking NVIDIA GPU..." -NoNewline
try {
    $nvidiaSmi = nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>$null
    if ($nvidiaSmi) {
        Write-Success " OK"
        $gpuInfo = $nvidiaSmi -split ","
        Add-Result -Name "NVIDIA GPU" -Status "OK" -Version $gpuInfo[1].Trim() -Path "-" -Note $gpuInfo[0].Trim()
    } else { throw "not found" }
} catch {
    Write-Info " Not detected"
    Add-Result -Name "NVIDIA GPU" -Status "INFO" -Version "-" -Path "-" -Note "Optional"
}

# ONNX Runtime GPU
Write-Host "Checking ONNX Runtime GPU..." -NoNewline
if (Test-Path $venvPython) {
    try {
        $onnxGpuOk = & $venvPython -c "import onnxruntime as ort; providers = ort.get_available_providers(); print('yes' if 'CUDAExecutionProvider' in providers else 'no')" 2>$null
        if ($onnxGpuOk -eq "yes") {
            Write-Success " OK"
            Add-Result -Name "ONNX GPU" -Status "OK" -Version "-" -Path "-" -Note "CUDA ready"
        } else { throw "not available" }
    } catch {
        Write-Info " Not available"
        Add-Result -Name "ONNX GPU" -Status "INFO" -Version "-" -Path "-" -Note "Optional"
    }
} else {
    Write-Info " venv not ready"
    Add-Result -Name "ONNX GPU" -Status "INFO" -Version "-" -Path "-" -Note "Optional"
}

Write-Host ""
Write-Info "Checking project files..."
Write-Host ""

# package.json
Write-Host "Checking package.json..." -NoNewline
$packageJson = Join-Path $ProjectRoot "package.json"
if (Test-Path $packageJson) {
    Write-Success " OK"
    Add-Result -Name "package.json" -Status "OK" -Version "-" -Path $packageJson -Note ""
} else {
    Write-Err " Missing"
    Add-Result -Name "package.json" -Status "FAIL" -Version "-" -Path "-" -Note "Config missing"
}

# node_modules
Write-Host "Checking node_modules..." -NoNewline
$nodeModules = Join-Path $ProjectRoot "node_modules"
if (Test-Path $nodeModules) {
    $moduleCount = (Get-ChildItem $nodeModules -Directory).Count
    Write-Success " OK ($moduleCount modules)"
    Add-Result -Name "node_modules" -Status "OK" -Version "-" -Path $nodeModules -Note "$moduleCount modules"
} else {
    Write-Warn " Not installed"
    Add-Result -Name "node_modules" -Status "WARN" -Version "-" -Path "-" -Note "Run npm install"
}

# Cargo.toml
Write-Host "Checking Cargo.toml..." -NoNewline
$cargoToml = Join-Path $ProjectRoot "src-tauri\Cargo.toml"
if (Test-Path $cargoToml) {
    Write-Success " OK"
    Add-Result -Name "Cargo.toml" -Status "OK" -Version "-" -Path $cargoToml -Note ""
} else {
    Write-Err " Missing"
    Add-Result -Name "Cargo.toml" -Status "FAIL" -Version "-" -Path "-" -Note "Rust config missing"
}

Write-Host ""
Write-Info "============================================"
Write-Info "           Results Summary"
Write-Info "============================================"
Write-Host ""

$okCount = ($Results | Where-Object { $_.Status -eq "OK" }).Count
$warnCount = ($Results | Where-Object { $_.Status -eq "WARN" }).Count
$failCount = ($Results | Where-Object { $_.Status -eq "FAIL" }).Count
$infoCount = ($Results | Where-Object { $_.Status -eq "INFO" }).Count

$Results | ForEach-Object {
    $icon = switch ($_.Status) { "OK" { "[OK]  " } "WARN" { "[WARN]" } "FAIL" { "[FAIL]" } "INFO" { "[INFO]" } }
    $color = switch ($_.Status) { "OK" { "Green" } "WARN" { "Yellow" } "FAIL" { "Red" } "INFO" { "Cyan" } }
    Write-Host $icon -ForegroundColor $color -NoNewline
    Write-Host (" {0,-18}" -f $_.Name) -NoNewline
    Write-Host ("{0,-12}" -f $_.Version) -NoNewline
    if ($_.Note) { Write-Host " $($_.Note)" -ForegroundColor DarkGray } else { Write-Host "" }
}

Write-Host ""
Write-Host "Summary: $okCount OK, $warnCount WARN, $failCount FAIL, $infoCount INFO"
Write-Host ""

if ($failCount -eq 0) {
    Write-Success "============================================"
    Write-Success "  All required dependencies installed!"
    Write-Success "============================================"
    Write-Host ""
    Write-Info "Start: .\scripts\start-dev.ps1"
    exit 0
} else {
    Write-Err "============================================"
    Write-Err "  Missing required dependencies!"
    Write-Err "============================================"
    Write-Host ""
    Write-Info "Run: .\scripts\setup.ps1"
    exit 1
}
