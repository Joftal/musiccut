#!/usr/bin/env python3
"""
person-detector PyInstaller build script
Creates a standalone executable with ultralytics + CUDA support
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path

# Configuration
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
PERSON_DETECTOR_SRC = PROJECT_ROOT / "python" / "person-detector"
OUTPUT_DIR = PROJECT_ROOT / "dist" / "person-detector"
TOOLS_DIR = PROJECT_ROOT / "tools"
VENV_DIR = TOOLS_DIR / "venv-detector"

# PyInstaller spec file content
SPEC_CONTENT = '''# -*- mode: python ; coding: utf-8 -*-
import sys
import os
import glob
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, collect_dynamic_libs

block_cipher = None

datas = []
datas += collect_data_files('ultralytics')
datas += collect_data_files('numpy')
datas += collect_data_files('PIL')

binaries = []
# Collect NVIDIA CUDA runtime DLLs
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

binaries += collect_dynamic_libs('torch')
binaries += collect_dynamic_libs('PIL')
binaries += collect_dynamic_libs('torchvision')

hiddenimports = []
hiddenimports += collect_submodules('ultralytics')
hiddenimports += collect_submodules('torch')
hiddenimports += collect_submodules('numpy')
hiddenimports += collect_submodules('PIL')
hiddenimports += collect_submodules('torchvision')
hiddenimports += [
    'cv2',
    'tqdm',
]

a = Analysis(
    ['person_detector_entry.py'],
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
    name='person-detector',
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
    name='person-detector',
)
'''

# Entry point script
ENTRY_SCRIPT = '''#!/usr/bin/env python3
"""person-detector entry point"""
import sys
import os

# Add the source directory to path
sys.path.insert(0, os.path.dirname(__file__))

from main import main

if __name__ == '__main__':
    main()
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
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "pip.exe"
    return VENV_DIR / "bin" / "pip"


def get_python():
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def install_dependencies():
    """Install dependencies"""
    pip = str(get_pip())

    print("Installing PyTorch + TorchVision (CUDA 12.8)...")
    if not run_command([pip, "install", "torch==2.10.0", "torchvision==0.25.0", "--index-url", "https://download.pytorch.org/whl/cu128"]):
        return False

    print("Installing ultralytics...")
    if not run_command([pip, "install", "ultralytics>=8.0.0"]):
        return False

    print("Installing opencv-python-headless...")
    if not run_command([pip, "install", "opencv-python-headless>=4.8.0"]):
        return False

    print("Installing tqdm...")
    if not run_command([pip, "install", "tqdm>=4.65.0"]):
        return False

    print("Installing Pillow (PIL)...")
    if not run_command([pip, "install", "Pillow>=10.0.0"]):
        return False

    print("Installing PyInstaller...")
    if not run_command([pip, "install", "pyinstaller==6.13.0"]):
        return False

    return True


def create_spec_file():
    spec_path = SCRIPT_DIR / "person_detector.spec"
    print(f"Creating spec file: {spec_path}")
    spec_path.write_text(SPEC_CONTENT, encoding="utf-8")
    return spec_path


def create_entry_script():
    entry_path = SCRIPT_DIR / "person_detector_entry.py"
    print(f"Creating entry script: {entry_path}")
    entry_path.write_text(ENTRY_SCRIPT, encoding="utf-8")
    return entry_path


def build():
    python = str(get_python())
    spec_path = create_spec_file()
    create_entry_script()

    # Copy main.py to scripts dir for PyInstaller
    src_main = PERSON_DETECTOR_SRC / "main.py"
    dst_main = SCRIPT_DIR / "main.py"
    shutil.copy2(src_main, dst_main)

    print("Starting PyInstaller build...")
    success = run_command([
        python, "-m", "PyInstaller",
        "--distpath", str(OUTPUT_DIR.parent),
        "--workpath", str(SCRIPT_DIR / "build"),
        "--clean",
        str(spec_path)
    ], cwd=SCRIPT_DIR)

    # Clean up copied main.py
    if dst_main.exists():
        dst_main.unlink()

    return success


def copy_to_tauri():
    src = OUTPUT_DIR
    dst = PROJECT_ROOT / "src-tauri" / "resources" / "person-detector"

    if not src.exists():
        print(f"Error: Build output not found: {src}")
        return False

    if dst.exists():
        print(f"Removing old version: {dst}")
        shutil.rmtree(dst)

    print(f"Copying to: {dst}")
    shutil.copytree(src, dst)
    return True


def main_build():
    print("=" * 60)
    print("person-detector PyInstaller Build Tool")
    print("=" * 60)

    print("\n[1/4] Creating virtual environment...")
    if not create_venv():
        print("Error: Failed to create virtual environment")
        return 1

    print("\n[2/4] Installing dependencies...")
    if not install_dependencies():
        print("Error: Failed to install dependencies")
        return 1

    print("\n[3/4] Building...")
    if not build():
        print("Error: Build failed")
        return 1

    print("\n[4/4] Copying to Tauri resources...")
    if not copy_to_tauri():
        print("Warning: Copy failed, please copy manually")

    print("\n" + "=" * 60)
    print("Build complete!")
    print(f"Output directory: {OUTPUT_DIR}")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    sys.exit(main_build())
