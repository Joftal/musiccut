#!/usr/bin/env python3
"""
audio-separator PyInstaller build script
Creates a standalone executable with ONNX Runtime GPU support
Only supports MDX-Net ONNX models, no PyTorch required
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path

# Configuration
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
OUTPUT_DIR = PROJECT_ROOT / "dist" / "audio-separator"
TOOLS_DIR = PROJECT_ROOT / "tools"
VENV_DIR = TOOLS_DIR / "venv"

# PyInstaller spec file content
SPEC_CONTENT = '''# -*- mode: python ; coding: utf-8 -*-
import sys
import os
import glob
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, collect_dynamic_libs

block_cipher = None

# Collect audio-separator and its dependencies data files
datas = []
datas += collect_data_files('audio_separator')
datas += collect_data_files('onnxruntime')

# Collect NVIDIA CUDA runtime DLLs from nvidia-* pip packages
# These are required by onnxruntime_providers_cuda.dll at runtime
binaries = []
nvidia_packages = [
    'nvidia.cuda_runtime',
    'nvidia.cublas',
    'nvidia.cufft',
    'nvidia.curand',
    'nvidia.cuda_nvrtc',
    'nvidia.cudnn',
    'nvidia.nvjitlink',
]
for pkg in nvidia_packages:
    try:
        mod = __import__(pkg, fromlist=[''])
        pkg_dir = mod.__path__[0]
        bin_dir = os.path.join(pkg_dir, 'bin')
        lib_dir = os.path.join(pkg_dir, 'lib')
        for search_dir in [bin_dir, lib_dir]:
            if os.path.isdir(search_dir):
                for dll in glob.glob(os.path.join(search_dir, '*.dll')):
                    binaries.append((dll, '.'))
                    print(f'  CUDA DLL: {os.path.basename(dll)}')
    except ImportError:
        print(f'  Warning: {pkg} not installed, skipping')

# Also collect onnxruntime's own DLLs
binaries += collect_dynamic_libs('onnxruntime')

# Collect all submodules (ONNX only, no PyTorch)
hiddenimports = []
hiddenimports += collect_submodules('audio_separator')
hiddenimports += collect_submodules('onnxruntime')
hiddenimports += [
    'numpy',
    'scipy',
    'librosa',
    'soundfile',
    'pydub',
]

a = Analysis(
    ['audio_separator_entry.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib',
        'tkinter',
        'PIL',
        'IPython',
        'jupyter',
        'torch',
        'torchvision',
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
    name='audio-separator',
)
'''

# Entry point script
ENTRY_SCRIPT = '''#!/usr/bin/env python3
"""audio-separator entry point"""
import sys
from audio_separator.separator import main

if __name__ == '__main__':
    sys.exit(main())
'''


def run_command(cmd, cwd=None, check=True):
    """Run command and print output"""
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, check=check, capture_output=False)
    return result.returncode == 0


def create_venv():
    """Create virtual environment"""
    if VENV_DIR.exists():
        print(f"Virtual environment exists: {VENV_DIR}")
        return True

    print(f"Creating virtual environment: {VENV_DIR}")
    return run_command([sys.executable, "-m", "venv", str(VENV_DIR)])


def get_pip():
    """Get pip path"""
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "pip.exe"
    return VENV_DIR / "bin" / "pip"


def get_python():
    """Get Python path"""
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def install_dependencies():
    """Install dependencies (ONNX Runtime only, no PyTorch)"""
    pip = str(get_pip())

    print("Installing ONNX Runtime GPU...")
    if not run_command([pip, "install", "onnxruntime-gpu"]):
        print("Warning: ONNX Runtime GPU install failed, trying CPU version...")
        if not run_command([pip, "install", "onnxruntime"]):
            return False

    print("Installing audio-separator...")
    if not run_command([pip, "install", "audio-separator"]):
        return False

    print("Installing PyInstaller...")
    if not run_command([pip, "install", "pyinstaller"]):
        return False

    return True


def create_spec_file():
    """Create PyInstaller spec file"""
    spec_path = SCRIPT_DIR / "audio_separator.spec"
    print(f"Creating spec file: {spec_path}")
    spec_path.write_text(SPEC_CONTENT, encoding="utf-8")
    return spec_path


def create_entry_script():
    """Create entry point script"""
    entry_path = SCRIPT_DIR / "audio_separator_entry.py"
    print(f"Creating entry script: {entry_path}")
    entry_path.write_text(ENTRY_SCRIPT, encoding="utf-8")
    return entry_path


def build():
    """Execute build"""
    python = str(get_python())
    spec_path = create_spec_file()
    create_entry_script()

    print("Starting PyInstaller build...")
    return run_command([
        python, "-m", "PyInstaller",
        "--distpath", str(OUTPUT_DIR.parent),
        "--workpath", str(SCRIPT_DIR / "build"),
        "--clean",
        str(spec_path)
    ], cwd=SCRIPT_DIR)


def copy_to_tauri():
    """Copy to Tauri resources directory"""
    src = OUTPUT_DIR
    dst = PROJECT_ROOT / "src-tauri" / "resources" / "audio-separator"

    if not src.exists():
        print(f"Error: Build output not found: {src}")
        return False

    if dst.exists():
        print(f"Removing old version: {dst}")
        shutil.rmtree(dst)

    print(f"Copying to: {dst}")
    shutil.copytree(src, dst)
    return True


def main():
    """Main function"""
    print("=" * 60)
    print("audio-separator PyInstaller Build Tool")
    print("=" * 60)

    # Step 1: Create virtual environment
    print("\n[1/4] Creating virtual environment...")
    if not create_venv():
        print("Error: Failed to create virtual environment")
        return 1

    # Step 2: Install dependencies
    print("\n[2/4] Installing dependencies...")
    if not install_dependencies():
        print("Error: Failed to install dependencies")
        return 1

    # Step 3: Build
    print("\n[3/4] Building...")
    if not build():
        print("Error: Build failed")
        return 1

    # Step 4: Copy to Tauri resources
    print("\n[4/4] Copying to Tauri resources...")
    if not copy_to_tauri():
        print("Warning: Copy failed, please copy manually")

    print("\n" + "=" * 60)
    print("Build complete!")
    print(f"Output directory: {OUTPUT_DIR}")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    sys.exit(main())
