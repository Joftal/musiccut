# -*- mode: python ; coding: utf-8 -*-
import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# 收集 audio-separator 及其依赖的数据文件
datas = []
datas += collect_data_files('audio_separator')
datas += collect_data_files('onnxruntime')

# 收集所有子模块（仅 ONNX 相关，不需要 PyTorch）
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
    binaries=[],
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
