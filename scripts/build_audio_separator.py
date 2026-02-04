#!/usr/bin/env python3
"""
audio-separator PyInstaller 打包脚本
用于创建包含 ONNX Runtime GPU 支持的独立可执行文件
仅支持 MDX-Net ONNX 模型，不需要 PyTorch
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path

# 配置
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
OUTPUT_DIR = PROJECT_ROOT / "dist" / "audio-separator"
TOOLS_DIR = PROJECT_ROOT / "tools"
VENV_DIR = TOOLS_DIR / "venv"  # 使用项目统一的 venv 目录

# PyInstaller 规格文件内容
SPEC_CONTENT = '''# -*- mode: python ; coding: utf-8 -*-
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
'''

# 入口点脚本
ENTRY_SCRIPT = '''#!/usr/bin/env python3
"""audio-separator 入口点"""
import sys
from audio_separator.separator import main

if __name__ == '__main__':
    sys.exit(main())
'''


def run_command(cmd, cwd=None, check=True):
    """运行命令并打印输出"""
    print(f"运行: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, check=check, capture_output=False)
    return result.returncode == 0


def create_venv():
    """创建虚拟环境"""
    if VENV_DIR.exists():
        print(f"虚拟环境已存在: {VENV_DIR}")
        return True

    print(f"创建虚拟环境: {VENV_DIR}")
    return run_command([sys.executable, "-m", "venv", str(VENV_DIR)])


def get_pip():
    """获取 pip 路径"""
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "pip.exe"
    return VENV_DIR / "bin" / "pip"


def get_python():
    """获取 Python 路径"""
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def install_dependencies():
    """安装依赖（仅 ONNX Runtime，不需要 PyTorch）"""
    pip = str(get_pip())

    print("安装 ONNX Runtime GPU...")
    if not run_command([pip, "install", "onnxruntime-gpu"]):
        print("警告: ONNX Runtime GPU 安装失败，尝试 CPU 版本...")
        if not run_command([pip, "install", "onnxruntime"]):
            return False

    print("安装 audio-separator...")
    if not run_command([pip, "install", "audio-separator"]):
        return False

    print("安装 PyInstaller...")
    if not run_command([pip, "install", "pyinstaller"]):
        return False

    return True


def create_spec_file():
    """创建 PyInstaller 规格文件"""
    spec_path = SCRIPT_DIR / "audio_separator.spec"
    print(f"创建规格文件: {spec_path}")
    spec_path.write_text(SPEC_CONTENT, encoding="utf-8")
    return spec_path


def create_entry_script():
    """创建入口点脚本"""
    entry_path = SCRIPT_DIR / "audio_separator_entry.py"
    print(f"创建入口点脚本: {entry_path}")
    entry_path.write_text(ENTRY_SCRIPT, encoding="utf-8")
    return entry_path


def build():
    """执行打包"""
    python = str(get_python())
    spec_path = create_spec_file()
    create_entry_script()

    print("开始 PyInstaller 打包...")
    return run_command([
        python, "-m", "PyInstaller",
        "--distpath", str(OUTPUT_DIR.parent),
        "--workpath", str(SCRIPT_DIR / "build"),
        "--clean",
        str(spec_path)
    ], cwd=SCRIPT_DIR)


def copy_to_tauri():
    """复制到 Tauri 资源目录"""
    src = OUTPUT_DIR
    dst = PROJECT_ROOT / "src-tauri" / "resources" / "audio-separator"

    if not src.exists():
        print(f"错误: 打包输出不存在: {src}")
        return False

    if dst.exists():
        print(f"删除旧版本: {dst}")
        shutil.rmtree(dst)

    print(f"复制到: {dst}")
    shutil.copytree(src, dst)
    return True


def main():
    """主函数"""
    print("=" * 60)
    print("audio-separator PyInstaller 打包工具")
    print("=" * 60)

    # 步骤 1: 创建虚拟环境
    print("\n[1/4] 创建虚拟环境...")
    if not create_venv():
        print("错误: 创建虚拟环境失败")
        return 1

    # 步骤 2: 安装依赖
    print("\n[2/4] 安装依赖...")
    if not install_dependencies():
        print("错误: 安装依赖失败")
        return 1

    # 步骤 3: 打包
    print("\n[3/4] 执行打包...")
    if not build():
        print("错误: 打包失败")
        return 1

    # 步骤 4: 复制到 Tauri 资源目录
    print("\n[4/4] 复制到 Tauri 资源目录...")
    if not copy_to_tauri():
        print("警告: 复制失败，请手动复制")

    print("\n" + "=" * 60)
    print("打包完成!")
    print(f"输出目录: {OUTPUT_DIR}")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    sys.exit(main())
