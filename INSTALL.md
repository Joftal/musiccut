# MusicCut 安装指南

## 快速开始

### 一键安装

```powershell
.\scripts\setup.ps1
```

脚本会自动安装 Node.js 依赖、Python 虚拟环境、audio-separator 及 ONNX Runtime GPU。

### 启动开发服务器

```powershell
.\scripts\start-dev.ps1
```

### 清理项目

```powershell
.\scripts\cleanup.ps1              # 扫描并清理
.\scripts\cleanup.ps1 -SkipConfirm # 跳过确认
```

---

## 手动安装

### 系统依赖

| 依赖 | 版本要求 | 下载地址 |
|------|----------|----------|
| Node.js | >= 18.0.0 | https://nodejs.org/ |
| Rust | 最新稳定版 | https://rustup.rs/ |
| Python | >= 3.10 (推荐 3.12) | https://www.python.org/ |

### FFmpeg 工具

下载以下工具并放入 `ffmpeg/` 目录：

| 工具 | 下载地址 |
|------|----------|
| FFmpeg + FFprobe | https://www.gyan.dev/ffmpeg/builds/ (essentials 版本) |
| fpcalc | https://acoustid.org/chromaprint |

### Python 依赖

```powershell
python -m venv tools/venv
.\tools\venv\Scripts\Activate.ps1
pip install audio-separator
pip install onnxruntime-gpu  # 如有 NVIDIA GPU
```

### Node.js 依赖

```bash
npm install
```

---

## 开发命令

```bash
npm run tauri:dev    # 开发模式
npm run tauri:build  # 构建生产版本
npm run dev          # 仅前端开发
npm run lint         # 代码检查
```

---

## 构建发布版本

构建 Windows 便携包，用户解压后可直接使用。

### 前置条件

1. 已安装开发环境（运行 `.\scripts\setup.ps1`）
2. 安装 7-Zip：https://www.7-zip.org/
3. 打包 audio-separator（首次构建）：
   ```powershell
   .\tools\venv\Scripts\python.exe .\scripts\build_audio_separator.py
   ```

### 构建

```powershell
.\scripts\build-7z.ps1              # 完整构建
.\scripts\build-7z.ps1 -SkipBuild   # 跳过 Tauri 构建
```

### 输出

```
dist\
├── MusicCut\                # 组装目录
│   ├── MusicCut.exe         # 主程序
│   ├── ffmpeg\              # FFmpeg 工具
│   ├── models\              # AI 模型
│   └── audio-separator\     # 人声分离工具
└── MusicCut_1.0.0_x64.7z    # 发布包
```

---

## GPU 加速

### NVIDIA GPU (推荐)
- 安装 NVIDIA 驱动 (>= 450)
- setup.ps1 会自动安装 ONNX Runtime GPU

### Intel/AMD GPU
- 需要 FFmpeg 支持 QSV (Intel) 或 AMF (AMD)

---

## 常见问题

**Q: 脚本执行策略错误**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Q: audio-separator 安装失败**
确保 Python >= 3.10，推荐 3.12。

**Q: Rust 编译错误**
确保已安装 Visual Studio Build Tools。

**Q: 检查依赖状态**
```powershell
.\scripts\check-deps.ps1
```

---

## 人声分离模型

使用 MDX-Net Inst HQ3 模型，首次使用时自动下载到 `models/audio-separator/` 目录。
