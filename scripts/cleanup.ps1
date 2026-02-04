<#
.SYNOPSIS
    MusicCut Cleanup Script
.DESCRIPTION
    Scan and clean up development cache, build files, and dependencies
.EXAMPLE
    .\scripts\cleanup.ps1
.EXAMPLE
    .\scripts\cleanup.ps1 -SkipConfirm
#>

param(
    [switch]$SkipConfirm,
    [switch]$IncludeSystemCache
)

$ErrorActionPreference = "Continue"

# Path settings
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$CleanupListFile = Join-Path $ProjectRoot "cleanup-list.txt"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       MusicCut Cleanup Script" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project Root: $ProjectRoot" -ForegroundColor Gray
Write-Host ""

# Initialize cleanup list
$CleanupItems = @()

function Add-CleanupItem {
    param(
        [string]$Path,
        [string]$Category,
        [string]$Description
    )

    if (Test-Path $Path) {
        $size = 0
        $itemCount = 0

        try {
            if ((Get-Item $Path).PSIsContainer) {
                $items = Get-ChildItem -Path $Path -Recurse -Force -ErrorAction SilentlyContinue
                $size = ($items | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
                $itemCount = $items.Count
            } else {
                $size = (Get-Item $Path).Length
                $itemCount = 1
            }
        } catch {}

        $sizeStr = Format-Size $size

        $script:CleanupItems += [PSCustomObject]@{
            Path = $Path
            Category = $Category
            Description = $Description
            Size = $size
            SizeStr = $sizeStr
            ItemCount = $itemCount
            Exists = $true
        }
    }
}

function Format-Size {
    param([long]$Bytes)

    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N2} KB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

Write-Host "Scanning for cleanup items..." -ForegroundColor Cyan
Write-Host ""

# ============================================
# Project Directory Cleanup Items
# ============================================

Write-Host "[Project] Scanning project directory..." -ForegroundColor Gray

# Node.js
Add-CleanupItem -Path (Join-Path $ProjectRoot "node_modules") `
    -Category "Project" -Description "Node.js dependencies"

# Tools directory
Add-CleanupItem -Path (Join-Path $ProjectRoot "tools\venv") `
    -Category "Project" -Description "Python virtual environment"

Add-CleanupItem -Path (Join-Path $ProjectRoot "tools\downloads") `
    -Category "Project" -Description "Downloaded archives"

# Rust build
Add-CleanupItem -Path (Join-Path $ProjectRoot "src-tauri\target") `
    -Category "Project" -Description "Rust build output"

# Frontend build
Add-CleanupItem -Path (Join-Path $ProjectRoot "dist") `
    -Category "Project" -Description "Frontend build output"

# Vite cache
Add-CleanupItem -Path (Join-Path $ProjectRoot ".vite") `
    -Category "Project" -Description "Vite cache"

Add-CleanupItem -Path (Join-Path $ProjectRoot "node_modules\.vite") `
    -Category "Project" -Description "Vite dependency cache"

# TypeScript cache
Add-CleanupItem -Path (Join-Path $ProjectRoot "tsconfig.tsbuildinfo") `
    -Category "Project" -Description "TypeScript build info"

# ESLint cache
Add-CleanupItem -Path (Join-Path $ProjectRoot ".eslintcache") `
    -Category "Project" -Description "ESLint cache"

# Package lock
Add-CleanupItem -Path (Join-Path $ProjectRoot "package-lock.json") `
    -Category "Project" -Description "npm lock file"

# Cleanup report file
Add-CleanupItem -Path (Join-Path $ProjectRoot "cleanup-list.txt") `
    -Category "Project" -Description "Cleanup report file"

# ============================================
# System Cache Cleanup Items (C: drive)
# ============================================

if ($IncludeSystemCache) {
    Write-Host "[System] Scanning system cache directories..." -ForegroundColor Gray

    # npm cache
    $npmCache1 = Join-Path $env:APPDATA "npm-cache"
    $npmCache2 = Join-Path $env:LOCALAPPDATA "npm-cache"
    Add-CleanupItem -Path $npmCache1 -Category "System" -Description "npm cache (AppData)"
    Add-CleanupItem -Path $npmCache2 -Category "System" -Description "npm cache (LocalAppData)"

    # Cargo cache
    $cargoRegistry = Join-Path $env:USERPROFILE ".cargo\registry"
    $cargoGit = Join-Path $env:USERPROFILE ".cargo\git"
    Add-CleanupItem -Path $cargoRegistry -Category "System" -Description "Cargo registry cache"
    Add-CleanupItem -Path $cargoGit -Category "System" -Description "Cargo git cache"

    # pip cache
    $pipCache = Join-Path $env:LOCALAPPDATA "pip\cache"
    Add-CleanupItem -Path $pipCache -Category "System" -Description "pip cache"

    # Tauri cache
    $tauriCache = Join-Path $env:LOCALAPPDATA "tauri"
    Add-CleanupItem -Path $tauriCache -Category "System" -Description "Tauri cache"

    # Rust toolchain cache (be careful with this)
    # $rustupDownloads = Join-Path $env:USERPROFILE ".rustup\downloads"
    # Add-CleanupItem -Path $rustupDownloads -Category "System" -Description "Rustup downloads"

    # Windows temp files related to build
    $tempDir = $env:TEMP
    $rustTmp = Join-Path $tempDir "rust*"
    $npmTmp = Join-Path $tempDir "npm-*"

    # Scan temp directories
    Get-ChildItem -Path $tempDir -Directory -Filter "rust*" -ErrorAction SilentlyContinue | ForEach-Object {
        Add-CleanupItem -Path $_.FullName -Category "System" -Description "Rust temp files"
    }

    Get-ChildItem -Path $tempDir -Directory -Filter "npm-*" -ErrorAction SilentlyContinue | ForEach-Object {
        Add-CleanupItem -Path $_.FullName -Category "System" -Description "npm temp files"
    }

    # PyTorch model cache
    $torchCache = Join-Path $env:USERPROFILE ".cache\torch\hub\checkpoints"
    Add-CleanupItem -Path $torchCache -Category "System" -Description "PyTorch model cache"

    # Hugging Face cache (used by some ML models)
    $hfCache = Join-Path $env:USERPROFILE ".cache\huggingface"
    Add-CleanupItem -Path $hfCache -Category "System" -Description "Hugging Face cache"
}

# ============================================
# Generate Cleanup Report
# ============================================

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       Cleanup Items Found" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Group by category
$projectItems = $CleanupItems | Where-Object { $_.Category -eq "Project" }
$systemItems = $CleanupItems | Where-Object { $_.Category -eq "System" }

$totalSize = ($CleanupItems | Measure-Object -Property Size -Sum).Sum
$totalSizeStr = Format-Size $totalSize

# Display project items
if ($projectItems.Count -gt 0) {
    Write-Host "=== Project Files ===" -ForegroundColor Yellow
    $projectItems | ForEach-Object {
        Write-Host ("  [{0,10}] {1}" -f $_.SizeStr, $_.Description) -ForegroundColor White
        Write-Host ("             {0}" -f $_.Path) -ForegroundColor Gray
    }
    $projectSize = ($projectItems | Measure-Object -Property Size -Sum).Sum
    Write-Host ("  Subtotal: {0}" -f (Format-Size $projectSize)) -ForegroundColor Cyan
    Write-Host ""
}

# Display system items
if ($systemItems.Count -gt 0) {
    Write-Host "=== System Cache (C: drive) ===" -ForegroundColor Yellow
    $systemItems | ForEach-Object {
        Write-Host ("  [{0,10}] {1}" -f $_.SizeStr, $_.Description) -ForegroundColor White
        Write-Host ("             {0}" -f $_.Path) -ForegroundColor Gray
    }
    $systemSize = ($systemItems | Measure-Object -Property Size -Sum).Sum
    Write-Host ("  Subtotal: {0}" -f (Format-Size $systemSize)) -ForegroundColor Cyan
    Write-Host ""
}

if ($CleanupItems.Count -eq 0) {
    Write-Host "No cleanup items found." -ForegroundColor Green
    exit 0
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host ("  Total: {0} items, {1}" -f $CleanupItems.Count, $totalSizeStr) -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ============================================
# Generate Cleanup List File
# ============================================

$reportContent = @"
MusicCut Cleanup Report
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Project Root: $ProjectRoot

============================================
CLEANUP ITEMS
============================================

"@

if ($projectItems.Count -gt 0) {
    $reportContent += "=== Project Files ===`n"
    $projectItems | ForEach-Object {
        $reportContent += "[{0,10}] {1}`n" -f $_.SizeStr, $_.Description
        $reportContent += "            {0}`n" -f $_.Path
    }
    $projectSize = ($projectItems | Measure-Object -Property Size -Sum).Sum
    $reportContent += "Subtotal: $(Format-Size $projectSize)`n`n"
}

if ($systemItems.Count -gt 0) {
    $reportContent += "=== System Cache (C: drive) ===`n"
    $systemItems | ForEach-Object {
        $reportContent += "[{0,10}] {1}`n" -f $_.SizeStr, $_.Description
        $reportContent += "            {0}`n" -f $_.Path
    }
    $systemSize = ($systemItems | Measure-Object -Property Size -Sum).Sum
    $reportContent += "Subtotal: $(Format-Size $systemSize)`n`n"
}

$reportContent += @"
============================================
TOTAL: $($CleanupItems.Count) items, $totalSizeStr
============================================

WARNING:
- Deleting node_modules will require running 'npm install' again
- Deleting tools/venv will require running setup.ps1 again
- Deleting Rust target/ will require recompilation
- System cache deletion may affect other projects using the same tools
- FFmpeg binaries in ffmpeg/ folder are NOT deleted (bundled with project)

To proceed with cleanup, confirm when prompted or run:
  .\scripts\cleanup.ps1 -SkipConfirm

To include system cache (C: drive), run:
  .\scripts\cleanup.ps1 -IncludeSystemCache
"@

$reportContent | Out-File -FilePath $CleanupListFile -Encoding UTF8
Write-Host "Cleanup list saved to: $CleanupListFile" -ForegroundColor Gray
Write-Host ""

# ============================================
# Confirm and Execute Cleanup
# ============================================

if (-not $SkipConfirm) {
    Write-Host "WARNING: This will delete all items listed above!" -ForegroundColor Red
    Write-Host ""

    $choices = @(
        [System.Management.Automation.Host.ChoiceDescription]::new("&Yes", "Delete all listed items")
        [System.Management.Automation.Host.ChoiceDescription]::new("&Project Only", "Delete only project files (not system cache)")
        [System.Management.Automation.Host.ChoiceDescription]::new("&No", "Cancel cleanup")
    )

    $decision = $Host.UI.PromptForChoice(
        "Confirm Cleanup",
        "Do you want to proceed with the cleanup?",
        $choices,
        2  # Default to No
    )

    if ($decision -eq 2) {
        Write-Host ""
        Write-Host "Cleanup cancelled." -ForegroundColor Yellow
        Write-Host "Review the cleanup list at: $CleanupListFile" -ForegroundColor Gray
        exit 0
    }

    if ($decision -eq 1) {
        # Project only - filter out system items
        $CleanupItems = $CleanupItems | Where-Object { $_.Category -eq "Project" }
    }
}

# Execute cleanup
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       Executing Cleanup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$deletedCount = 0
$deletedSize = 0
$failedItems = @()

foreach ($item in $CleanupItems) {
    Write-Host "Deleting: $($item.Description)..." -NoNewline

    try {
        if (Test-Path $item.Path) {
            Remove-Item -Path $item.Path -Recurse -Force -ErrorAction Stop
            Write-Host " OK" -ForegroundColor Green
            $deletedCount++
            $deletedSize += $item.Size
        } else {
            Write-Host " Skipped (not found)" -ForegroundColor Gray
        }
    } catch {
        Write-Host " FAILED" -ForegroundColor Red
        Write-Host "  Error: $_" -ForegroundColor Red
        $failedItems += $item
    }
}

# ============================================
# Cleanup Summary
# ============================================

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       Cleanup Complete" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Deleted: $deletedCount items" -ForegroundColor Green
Write-Host "Space freed: $(Format-Size $deletedSize)" -ForegroundColor Green

if ($failedItems.Count -gt 0) {
    Write-Host ""
    Write-Host "Failed to delete $($failedItems.Count) items:" -ForegroundColor Red
    $failedItems | ForEach-Object {
        Write-Host "  - $($_.Path)" -ForegroundColor Red
    }
}

# Remove cleanup list file
if (Test-Path $CleanupListFile) {
    Remove-Item $CleanupListFile -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "To reinstall dependencies, run:" -ForegroundColor Cyan
Write-Host "  .\scripts\setup.ps1" -ForegroundColor Yellow
Write-Host ""
