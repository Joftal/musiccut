<p align="center">
  <b>简体中文</b> | <a href="./INSTALL_EN.md">English</a>
</p>

<h1 align="center">📦 MusicCut 安装指南</h1>

<p align="center">
  <a href="#-快速开始">快速开始</a> •
  <a href="#-手动安装">手动安装</a> •
  <a href="#-开发命令">开发命令</a> •
  <a href="#-构建发布">构建发布</a> •
  <a href="#-常见问题">常见问题</a>
</p>

---

## 🚀 快速开始

### ⚡ 一键安装

```powershell
.\scripts\setup.ps1
```

> 🔧 脚本会自动安装 Node.js 依赖、Python 虚拟环境、audio-separator 及 ONNX Runtime GPU

### ▶️ 启动开发服务器

```powershell
.\scripts\start-dev.ps1
```

### 🧹 清理项目

```powershell
.\scripts\cleanup.ps1              # 扫描并清理
.\scripts\cleanup.ps1 -SkipConfirm # 跳过确认
```

---

## 🔧 手动安装

### 📋 系统依赖

| 依赖 | 版本要求 | 下载地址 | 说明 |
|:---:|:---:|:---:|:---|
| 📗 Node.js | >= 18.0.0 | [nodejs.org](https://nodejs.org/) | JavaScript 运行时 |
| 🦀 Rust | 最新稳定版 | [rustup.rs](https://rustup.rs/) | 后端编译 |
| 🐍 Python | >= 3.10 | [python.org](https://www.python.org/) | 推荐 3.12 |

### 🎬 FFmpeg 工具

下载以下工具并放入 `ffmpeg/` 目录：

| 工具 | 下载地址 | 用途 |
|:---:|:---|:---|
| 🎬 FFmpeg + FFprobe | [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (essentials 版本) | 视频处理 |
| 🎵 fpcalc | [acoustid.org](https://acoustid.org/chromaprint) | 音频指纹 |

### 🐍 Python 依赖

```powershell
# 创建虚拟环境
python -m venv tools/venv

# 激活虚拟环境
.\tools\venv\Scripts\Activate.ps1

# 安装 audio-separator
pip install audio-separator

# 如有 NVIDIA GPU，安装 GPU 加速支持
pip install onnxruntime-gpu
```

### 📦 Node.js 依赖

```bash
npm install
```

---

## 💻 开发命令

| 命令 | 说明 |
|:---|:---|
| `npm run tauri:dev` | 🔄 开发模式（热重载） |
| `npm run tauri:build` | 📦 构建生产版本 |
| `npm run dev` | 🌐 仅前端开发 |
| `npm run lint` | 🔍 代码检查 |

---

## 📦 构建发布

构建 Windows 便携包，用户解压后可直接使用。

### ✅ 前置条件

1. ✔️ 已安装开发环境（运行 `.\scripts\setup.ps1`）
2. ✔️ 安装 [7-Zip](https://www.7-zip.org/)
3. ✔️ 打包 audio-separator（首次构建）：

```powershell
.\tools\venv\Scripts\python.exe .\scripts\build_audio_separator.py
```

### 🔨 构建命令

```powershell
.\scripts\build-7z.ps1              # 完整构建
.\scripts\build-7z.ps1 -SkipBuild   # 跳过 Tauri 构建（仅打包）
```

### 📁 输出结构

```
dist/
├── 📂 MusicCut/                 # 组装目录
│   ├── 🎯 MusicCut.exe          # 主程序
│   ├── 📂 ffmpeg/               # FFmpeg 工具
│   ├── 📂 models/               # AI 模型
│   └── 📂 audio-separator/      # 人声分离工具
└── 📦 MusicCut_1.0.0_x64.7z     # 发布包
```

---

## 🎮 GPU 加速

### 💚 NVIDIA GPU (推荐)

| 要求 | 说明 |
|:---|:---|
| 驱动版本 | >= 450 |
| 安装方式 | `setup.ps1` 会自动安装 ONNX Runtime GPU |

### 💙 Intel GPU

- 需要 FFmpeg 支持 **QSV** (Quick Sync Video)

### ❤️ AMD GPU

- 需要 FFmpeg 支持 **AMF** (Advanced Media Framework)

---

## ❓ 常见问题

<details>
<summary><b>🔴 Q: 脚本执行策略错误</b></summary>

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

</details>

<details>
<summary><b>🔴 Q: audio-separator 安装失败</b></summary>

确保 Python >= 3.10，推荐使用 Python 3.12。

```powershell
python --version  # 检查版本
```

</details>

<details>
<summary><b>🔴 Q: Rust 编译错误</b></summary>

确保已安装 **Visual Studio Build Tools**：
- 下载：[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- 安装时选择「使用 C++ 的桌面开发」

</details>

<details>
<summary><b>🔴 Q: 如何检查依赖状态？</b></summary>

```powershell
.\scripts\check-deps.ps1
```

</details>

---

## 🤖 人声分离模型

| 模型 | 说明 |
|:---|:---|
| 📥 MDX-Net Inst HQ3 | 默认模型，首次使用时自动下载 |
| 📂 存储位置 | `models/audio-separator/` |

> 💡 模型文件约 100MB，首次下载需要稳定的网络连接

---

<p align="center">
  <b>🎉 安装完成后，运行 <code>.\scripts\start-dev.ps1</code> 开始开发！</b>
</p>
