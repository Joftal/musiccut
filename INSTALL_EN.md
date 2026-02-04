<p align="center">
  <a href="./INSTALL.md">简体中文</a> | <b>English</b>
</p>

<h1 align="center">📦 MusicCut Installation Guide</h1>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-manual-installation">Manual Installation</a> •
  <a href="#-development-commands">Development Commands</a> •
  <a href="#-build--release">Build & Release</a> •
  <a href="#-faq">FAQ</a>
</p>

---

## 🚀 Quick Start

### ⚡ One-Click Installation

```powershell
.\scripts\setup.ps1
```

> 🔧 The script will automatically install Node.js dependencies, Python virtual environment, audio-separator, and ONNX Runtime GPU

### ▶️ Start Development Server

```powershell
.\scripts\start-dev.ps1
```

### 🧹 Clean Project

```powershell
.\scripts\cleanup.ps1              # Scan and clean
.\scripts\cleanup.ps1 -SkipConfirm # Skip confirmation
```

---

## 🔧 Manual Installation

### 📋 System Dependencies

| Dependency | Version | Download | Description |
|:---:|:---:|:---:|:---|
| 📗 Node.js | >= 18.0.0 | [nodejs.org](https://nodejs.org/) | JavaScript runtime |
| 🦀 Rust | Latest stable | [rustup.rs](https://rustup.rs/) | Backend compilation |
| 🐍 Python | >= 3.10 | [python.org](https://www.python.org/) | Recommended 3.12 |

### 🎬 FFmpeg Tools

Download the following tools and place them in the `ffmpeg/` directory:

| Tool | Download | Purpose |
|:---:|:---|:---|
| 🎬 FFmpeg + FFprobe | [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (essentials version) | Video processing |
| 🎵 fpcalc | [acoustid.org](https://acoustid.org/chromaprint) | Audio fingerprint |

### 🐍 Python Dependencies

```powershell
# Create virtual environment
python -m venv tools/venv

# Activate virtual environment
.\tools\venv\Scripts\Activate.ps1

# Install audio-separator
pip install audio-separator

# If you have an NVIDIA GPU, install GPU acceleration support
pip install onnxruntime-gpu
```

### 📦 Node.js Dependencies

```bash
npm install
```

---

## 💻 Development Commands

| Command | Description |
|:---|:---|
| `npm run tauri:dev` | 🔄 Development mode (hot reload) |
| `npm run tauri:build` | 📦 Build production version |
| `npm run dev` | 🌐 Frontend development only |
| `npm run lint` | 🔍 Code linting |

---

## 📦 Build & Release

Build a Windows portable package that users can use directly after extraction.

### ✅ Prerequisites

1. ✔️ Development environment installed (run `.\scripts\setup.ps1`)
2. ✔️ Install [7-Zip](https://www.7-zip.org/)
3. ✔️ Package audio-separator (first build only):

```powershell
.\tools\venv\Scripts\python.exe .\scripts\build_audio_separator.py
```

### 🔨 Build Commands

```powershell
.\scripts\build-7z.ps1              # Full build
.\scripts\build-7z.ps1 -SkipBuild   # Skip Tauri build (package only)
```

### 📁 Output Structure

```
dist/
├── 📂 MusicCut/                 # Assembly directory
│   ├── 🎯 MusicCut.exe          # Main program
│   ├── 📂 ffmpeg/               # FFmpeg tools
│   ├── 📂 models/               # AI models
│   └── 📂 audio-separator/      # Vocal separation tool
└── 📦 MusicCut_1.0.0_x64.7z     # Release package
```

---

## 🎮 GPU Acceleration

### 💚 NVIDIA GPU (Recommended)

| Requirement | Description |
|:---|:---|
| Driver version | >= 450 |
| Installation | `setup.ps1` will automatically install ONNX Runtime GPU |

### 💙 Intel GPU

- Requires FFmpeg with **QSV** (Quick Sync Video) support

### ❤️ AMD GPU

- Requires FFmpeg with **AMF** (Advanced Media Framework) support

---

## ❓ FAQ

<details>
<summary><b>🔴 Q: Script execution policy error</b></summary>

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

</details>

<details>
<summary><b>🔴 Q: audio-separator installation failed</b></summary>

Ensure Python >= 3.10, Python 3.12 is recommended.

```powershell
python --version  # Check version
```

</details>

<details>
<summary><b>🔴 Q: Rust compilation error</b></summary>

Ensure **Visual Studio Build Tools** is installed:
- Download: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Select "Desktop development with C++" during installation

</details>

<details>
<summary><b>🔴 Q: How to check dependency status?</b></summary>

```powershell
.\scripts\check-deps.ps1
```

</details>

---

## 🤖 Vocal Separation Model

| Model | Description |
|:---|:---|
| 📥 MDX-Net Inst HQ3 | Default model, automatically downloaded on first use |
| 📂 Storage location | `models/audio-separator/` |

> 💡 Model file is about 100MB, first download requires a stable network connection

---

<p align="center">
  <b>🎉 After installation, run <code>.\scripts\start-dev.ps1</code> to start development!</b>
</p>
