#!/usr/bin/env python3
"""
audio-separator PyInstaller build script
Creates standalone executables with GPU support:
  - cuda variant: ONNX Runtime GPU (CUDA) + PyTorch CUDA for NVIDIA GPUs
  - dml variant:  ONNX Runtime DirectML + PyTorch CPU for AMD/Intel GPUs
"""

import sys
import subprocess
import shutil
import argparse
from pathlib import Path

# Configuration
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
TOOLS_DIR = PROJECT_ROOT / "tools"

# ── Pinned dependency versions ──
# Keep in sync with .github/workflows/build.yml env variables
TORCH_VERSION = "2.10.0"
TORCHVISION_VERSION = "0.25.0"
PILLOW_VERSION = "12.1.0"
AUDIO_SEPARATOR_VERSION = "0.41.1"
ONNXRUNTIME_DML_VERSION = "1.24.1"
ONNXRUNTIME_GPU_VERSION = "1.24.1"
ONNX_VERSION = "1.20.1"
PYINSTALLER_VERSION = "6.18.0"

TORCH_CPU_INDEX = "https://download.pytorch.org/whl/cpu"
TORCH_CUDA_INDEX = "https://download.pytorch.org/whl/cu124"

def get_spec_content(variant):
    """Generate PyInstaller spec file content for the given variant."""
    collect_name = f"audio-separator-{variant}"
    return f'''# -*- mode: python ; coding: utf-8 -*-
import sys
import os
import glob
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, collect_dynamic_libs

block_cipher = None

# Collect audio-separator and its dependencies data files
datas = []
datas += collect_data_files('audio_separator')
datas += collect_data_files('onnxruntime')
datas += collect_data_files('torch')
datas += collect_data_files('onnx2torch')
datas += collect_data_files('torchvision')
datas += collect_data_files('samplerate')
datas += collect_data_files('resampy')
datas += collect_data_files('librosa')
datas += collect_data_files('PIL')
datas += collect_data_files('onnx')

# Collect native shared libraries (DLLs / .so) that PyInstaller may miss
binaries = []
binaries += collect_dynamic_libs('onnxruntime')
binaries += collect_dynamic_libs('torch')

# --- Explicitly collect CUDA / cuDNN DLLs for the cuda variant ---
# onnxruntime-gpu and torch+cu* ship CUDA runtime DLLs inside their
# package directories, but PyInstaller's automatic analysis sometimes
# misses them (especially cuDNN, cuBLAS, cuFFT, etc.).
# We glob for all matching DLLs and add them as binaries.
if '{variant}' == 'cuda':
    import importlib
    _cuda_dll_patterns = [
        'cudnn*.dll', 'cublas*.dll', 'cufft*.dll', 'curand*.dll',
        'cusolver*.dll', 'cusparse*.dll', 'cudart*.dll',
        'nvrtc*.dll', 'nvJitLink*.dll',
        'zlibwapi.dll',  # cuDNN dependency
    ]
    _search_dirs = set()
    for pkg in ('onnxruntime', 'torch'):
        try:
            mod = importlib.import_module(pkg)
            pkg_dir = os.path.dirname(mod.__file__)
            _search_dirs.add(pkg_dir)
            # Also check lib/ subdirectory (torch stores DLLs there)
            _search_dirs.add(os.path.join(pkg_dir, 'lib'))
            # onnxruntime capi directory
            _search_dirs.add(os.path.join(pkg_dir, 'capi'))
        except Exception:
            pass
    # Also search nvidia packages that pip installs alongside
    for nvidia_pkg in (
        'nvidia.cublas', 'nvidia.cuda_runtime', 'nvidia.cudnn',
        'nvidia.cufft', 'nvidia.curand', 'nvidia.cusolver',
        'nvidia.cusparse', 'nvidia.nvjitlink', 'nvidia.nvtx',
    ):
        try:
            mod = importlib.import_module(nvidia_pkg)
            pkg_dir = os.path.dirname(mod.__file__)
            _search_dirs.add(pkg_dir)
            _search_dirs.add(os.path.join(pkg_dir, 'lib'))
            _search_dirs.add(os.path.join(pkg_dir, 'bin'))
        except Exception:
            pass

    _found_cuda_dlls = set()
    for d in _search_dirs:
        if not os.path.isdir(d):
            continue
        for pattern in _cuda_dll_patterns:
            for dll_path in glob.glob(os.path.join(d, pattern)):
                dll_name = os.path.basename(dll_path).lower()
                if dll_name not in _found_cuda_dlls:
                    _found_cuda_dlls.add(dll_name)
                    binaries.append((dll_path, '.'))
    print(f"[spec] Collected {{len(_found_cuda_dlls)}} CUDA DLLs for bundling")

# Collect all submodules
hiddenimports = []
hiddenimports += collect_submodules('PIL')
hiddenimports += collect_submodules('audio_separator')
hiddenimports += collect_submodules('onnxruntime')
hiddenimports += collect_submodules('torch')
hiddenimports += collect_submodules('onnx2torch')
hiddenimports += collect_submodules('torchvision')
hiddenimports += collect_submodules('samplerate')
hiddenimports += collect_submodules('resampy')
hiddenimports += collect_submodules('onnx')
hiddenimports += [
    'numpy',
    'scipy',
    'librosa',
    'soundfile',
    'pydub',
    'einops',
    'julius',
    'diffq',
    'beartype',
    'ml_collections',
    'rotary_embedding_torch',
    'tqdm',
    '_cffi_backend',
    'audio_separator.utils.cli',
    'requests',
    'yaml',
    'packaging',
    'packaging.version',
    'packaging.specifiers',
    'packaging.requirements',
]

a = Analysis(
    ['audio_separator_entry.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[],
    excludes=[
        'matplotlib',
        'tkinter',
        'IPython',
        'jupyter',
        'torchaudio',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='audio-separator',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='{collect_name}',
)
'''


def run_command(cmd, cwd=None, check=True):
    """Run command and print output"""
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, check=check, capture_output=False)
    return result.returncode == 0


def get_variant_paths(variant):
    """Get output and venv paths for a given variant."""
    output_dir = PROJECT_ROOT / "dist" / f"audio-separator-{variant}"
    venv_dir = TOOLS_DIR / f"venv-{variant}"
    return output_dir, venv_dir


def create_venv(venv_dir):
    """Create virtual environment"""
    if venv_dir.exists():
        print(f"Virtual environment exists: {venv_dir}")
        return True

    print(f"Creating virtual environment: {venv_dir}")
    return run_command([sys.executable, "-m", "venv", str(venv_dir)])


def get_pip(venv_dir):
    """Get pip path"""
    if sys.platform == "win32":
        return venv_dir / "Scripts" / "pip.exe"
    return venv_dir / "bin" / "pip"


def get_python(venv_dir):
    """Get Python path"""
    if sys.platform == "win32":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def install_dependencies(variant, venv_dir):
    """Install dependencies for the given variant.

    cuda: PyTorch CUDA + onnxruntime-gpu
    dml:  PyTorch CPU  + onnxruntime-directml
    """
    pip = str(get_pip(venv_dir))

    print(f"Installing Pillow=={PILLOW_VERSION} (required by torchvision)...")
    if not run_command([pip, "install", f"pillow=={PILLOW_VERSION}"]):
        print("Warning: Pillow install failed")
        return False

    if variant == "cuda":
        print(f"Installing PyTorch=={TORCH_VERSION} (CUDA, for NVIDIA GPU)...")
        if not run_command([pip, "install", f"torch=={TORCH_VERSION}", f"torchvision=={TORCHVISION_VERSION}", "--index-url", TORCH_CUDA_INDEX]):
            print("Warning: PyTorch CUDA install failed")
            return False
    else:
        print(f"Installing PyTorch=={TORCH_VERSION} (CPU only)...")
        if not run_command([pip, "install", f"torch=={TORCH_VERSION}", f"torchvision=={TORCHVISION_VERSION}", "--index-url", TORCH_CPU_INDEX]):
            print("Warning: PyTorch CPU install failed")
            return False

    print(f"Installing audio-separator=={AUDIO_SEPARATOR_VERSION}...")
    if not run_command([pip, "install", f"audio-separator=={AUDIO_SEPARATOR_VERSION}", f"onnx=={ONNX_VERSION}"]):
        return False

    if variant == "cuda":
        print(f"Installing ONNX Runtime GPU=={ONNXRUNTIME_GPU_VERSION} (CUDA)...")
        if not run_command([pip, "install", f"onnxruntime-gpu=={ONNXRUNTIME_GPU_VERSION}"]):
            print("Warning: ONNX Runtime GPU install failed")
            return False
    else:
        print(f"Installing ONNX Runtime DirectML=={ONNXRUNTIME_DML_VERSION}...")
        if not run_command([pip, "install", f"onnxruntime-directml=={ONNXRUNTIME_DML_VERSION}"]):
            print("Warning: ONNX Runtime DirectML install failed, trying CPU version...")
            if not run_command([pip, "install", "onnxruntime"]):
                return False

    print(f"Installing PyInstaller=={PYINSTALLER_VERSION}...")
    if not run_command([pip, "install", f"pyinstaller=={PYINSTALLER_VERSION}"]):
        return False

    # Verify CUDA variant actually has CUDA PyTorch (not CPU fallback)
    if variant == "cuda":
        python = str(get_python(venv_dir))
        result = subprocess.run(
            [python, "-c", "import torch; print(torch.__version__)"],
            capture_output=True, text=True,
        )
        torch_ver = result.stdout.strip() if result.returncode == 0 else "unknown"
        print(f"Installed PyTorch version: {torch_ver}")
        if "+cpu" in torch_ver:
            print("ERROR: CUDA variant got CPU-only PyTorch! "
                  "Delete tools/venv-cuda and retry.")
            return False
        if "+cu" not in torch_ver:
            print(f"WARNING: PyTorch version '{torch_ver}' may not include CUDA support")

    return True


def create_spec_file(variant):
    """Create PyInstaller spec file for the given variant"""
    spec_path = SCRIPT_DIR / f"audio_separator_{variant}.spec"
    print(f"Creating spec file: {spec_path}")
    spec_path.write_text(get_spec_content(variant), encoding="utf-8")
    return spec_path


def create_entry_script():
    """Verify entry point script exists"""
    entry_path = SCRIPT_DIR / "audio_separator_entry.py"
    if not entry_path.exists():
        raise FileNotFoundError(f"Entry script not found: {entry_path}")
    print(f"Using entry script: {entry_path}")
    return entry_path


def build(variant, output_dir, venv_dir):
    """Execute build for the given variant"""
    python = str(get_python(venv_dir))
    spec_path = create_spec_file(variant)
    create_entry_script()

    print(f"Starting PyInstaller build ({variant})...")
    return run_command([
        python, "-m", "PyInstaller",
        "--distpath", str(output_dir.parent),
        "--workpath", str(SCRIPT_DIR / f"build-{variant}"),
        "--clean",
        str(spec_path)
    ], cwd=SCRIPT_DIR)


def copy_to_tauri(variant, output_dir):
    """Copy to Tauri resources directory"""
    src = output_dir
    dst = PROJECT_ROOT / "src-tauri" / "resources" / f"audio-separator-{variant}"

    if not src.exists():
        print(f"Error: Build output not found: {src}")
        return False

    if dst.exists():
        print(f"Removing old version: {dst}")
        shutil.rmtree(dst)

    print(f"Copying to: {dst}")
    shutil.copytree(src, dst)
    return True


def build_variant(variant):
    """Build a single variant (cuda or dml)."""
    output_dir, venv_dir = get_variant_paths(variant)

    print(f"\n{'=' * 60}")
    print(f"Building audio-separator [{variant.upper()}] variant")
    print(f"{'=' * 60}")

    # Step 1: Create virtual environment
    print(f"\n[1/4] Creating virtual environment ({variant})...")
    if not create_venv(venv_dir):
        print(f"Error: Failed to create virtual environment for {variant}")
        return 1

    # Step 2: Install dependencies
    print(f"\n[2/4] Installing dependencies ({variant})...")
    if not install_dependencies(variant, venv_dir):
        print(f"Error: Failed to install dependencies for {variant}")
        return 1

    # Step 3: Build
    print(f"\n[3/4] Building ({variant})...")
    if not build(variant, output_dir, venv_dir):
        print(f"Error: Build failed for {variant}")
        return 1

    # Step 4: Copy to Tauri resources
    print(f"\n[4/4] Copying to Tauri resources ({variant})...")
    if not copy_to_tauri(variant, output_dir):
        print(f"Warning: Copy failed for {variant}, please copy manually")

    print(f"\nBuild complete for [{variant.upper()}]: {output_dir}")
    return 0


def main():
    """Main function"""
    parser = argparse.ArgumentParser(description="audio-separator PyInstaller Build Tool")
    parser.add_argument(
        "--variant",
        choices=["cuda", "dml", "both"],
        default="both",
        help="Build variant: cuda (NVIDIA), dml (AMD/Intel), or both (default: both)",
    )
    args = parser.parse_args()

    variants = ["cuda", "dml"] if args.variant == "both" else [args.variant]

    print("=" * 60)
    print("audio-separator PyInstaller Build Tool")
    print(f"Variants to build: {', '.join(v.upper() for v in variants)}")
    print("=" * 60)

    for variant in variants:
        result = build_variant(variant)
        if result != 0:
            return result

    print("\n" + "=" * 60)
    print("All builds complete!")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    sys.exit(main())
