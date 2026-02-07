# -*- mode: python ; coding: utf-8 -*-
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

# Collect PyTorch DLLs (torch is required by audio-separator for tensor ops and STFT)
binaries += collect_dynamic_libs('torch')

# Collect all submodules
hiddenimports = []
hiddenimports += collect_submodules('audio_separator')
hiddenimports += collect_submodules('onnxruntime')
hiddenimports += collect_submodules('torch')
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
