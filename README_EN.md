<p align="center">
  <a href="./README.md">简体中文</a> | <b>English</b>
</p>

<p align="center">
  <img src="https://img.icons8.com/fluency/96/music-video.png" alt="MusicCut Logo" width="96" height="96">
</p>

<h1 align="center">🎬 MusicCut</h1>

<p align="center">
  <strong>Intelligent Video Editing Tool Based on Audio Fingerprint Recognition</strong>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-system-requirements">System Requirements</a> •
  <a href="#-Performance-Benchmark">Performance Benchmark</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-workflow">Workflow</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows-blue?style=flat-square&logo=windows" alt="Platform">
  <img src="https://img.shields.io/badge/Tauri-2.x-orange?style=flat-square&logo=tauri" alt="Tauri">
  <img src="https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react" alt="React">
  <img src="https://img.shields.io/badge/Rust-stable-dea584?style=flat-square&logo=rust" alt="Rust">
  <img src="https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square" alt="License">
</p>

---

## 📸 Application Screenshot

<p align="center">
 <img width="2000" height="1334" alt="image" src="https://github.com/user-attachments/assets/fd380c66-66a4-4197-8aef-b7c2a2b394bc" />
</p>

---

## ✨ Features

| Feature | Description |
|:---:|:---|
| 🎵 **Music Library** | Import music files and automatically extract audio fingerprints to build a local music library |
| 🔍 **Smart Recognition** | High-precision audio fingerprint matching using Chromaprint |
| 🎤 **Vocal Separation** | Integrated audio-separator with GPU-accelerated AI vocal separation |
| 👤 **Person Detection** | YOLOv11-based person detection to automatically mark segments with people on screen |
| ✂️ **Auto Editing** | Automatically mark and clip video segments based on music matching or person detection results |
| 🎛️ **Manual Adjustment** | Support manual adjustment of clip start and end times |
| 📦 **Batch Processing** | Support batch video import and parallel project analysis |

---

## 🛠️ Tech Stack

<table>
  <tr>
    <td align="center" width="96">
      <img src="https://skillicons.dev/icons?i=react" width="48" height="48" alt="React" />
      <br>React
    </td>
    <td align="center" width="96">
      <img src="https://skillicons.dev/icons?i=ts" width="48" height="48" alt="TypeScript" />
      <br>TypeScript
    </td>
    <td align="center" width="96">
      <img src="https://skillicons.dev/icons?i=tailwind" width="48" height="48" alt="Tailwind" />
      <br>Tailwind
    </td>
    <td align="center" width="96">
      <img src="https://skillicons.dev/icons?i=rust" width="48" height="48" alt="Rust" />
      <br>Rust
    </td>
    <td align="center" width="96">
      <img src="https://skillicons.dev/icons?i=tauri" width="48" height="48" alt="Tauri" />
      <br>Tauri
    </td>
    <td align="center" width="96">
      <img src="https://www.sqlite.org/images/sqlite370_banner.gif" width="64" height="48" alt="SQLite" />
      <br>SQLite
    </td>
  </tr>
</table>

**Core Components**:
- 🎬 **FFmpeg** - Video/Audio processing
- 🎵 **Chromaprint** - Audio fingerprint extraction
- 🤖 **audio-separator** - AI vocal separation
- 👤 **person-detector** - YOLOv11-based person detection

---

## 💻 System Requirements

| Item | Minimum | Recommended |
|:---:|:---:|:---:|
| 🖥️ OS | Windows 10 | Windows 11 |
| 🧠 RAM | 4 GB | 8 GB+ |
| 💾 Storage | 2 GB free space | SSD recommended |
| 🎮 GPU | - | NVIDIA GPU (CUDA) |

> 💡 **Tip**: GPU acceleration significantly improves vocal separation speed. NVIDIA GPU is recommended.

---

## ⚡ Performance Benchmark

| Item | Specification |
|:---|:---|
| CPU | Intel Core i5-13600KF |
| GPU | NVIDIA GeForce RTX 4080 |
| Input | 3-hour video + 160-song local music library |
| Processing Pipeline | Vocal separation → Audio fingerprint extraction → Full-library matching → Clip marking |
| Total Time | 9 minutes |

---

## 🚀 Quick Start

### 📥 User Installation

Download the release package, extract it, and run `MusicCut.exe` directly.

### 👨‍💻 Developer Installation

```powershell
# 1️⃣ Clone the project
git clone https://github.com/Joftal/musiccut.git
cd musiccut

# 2️⃣ One-click dependency installation
.\scripts\setup.ps1

# 3️⃣ Start development server
.\scripts\start-dev.ps1
```

📖 For detailed installation instructions, please refer to **[INSTALL_EN.md](./INSTALL_EN.md)**

---

## 📋 Workflow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  1️⃣ Import  │ ➜  │  2️⃣ Create  │ ➜  │  3️⃣ Analyze │ ➜  │  4️⃣ Confirm │ ➜  │  5️⃣ Export  │
│   Library   │    │   Project   │    │   & Match   │    │   Segments  │    │    Video    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

| Step | Action | Description |
|:---:|:---|:---|
| 1️⃣ | **Import Music Library** | Import music files to be recognized in the "Library" page |
| 2️⃣ | **Create Project** | Create a new project in the "Projects" page and select videos to process |
| 3️⃣ | **Start Recognition** | Click "Start Recognition" to auto extract audio → separate vocals → match fingerprints; or use "Person Detection" to mark segments with people on screen |
| 4️⃣ | **Confirm Segments** | Review detected segments, confirm to keep or remove |
| 5️⃣ | **Export Video** | Export edited video (merged or segmented export) |

---

## 📄 License

This project is open source under the **GNU Affero General Public License v3.0 (AGPLv3)**. See the [LICENSE](./LICENSE) file for details.

---

## 🙏 Acknowledgments

- 🎵 [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator) - Excellent audio separation tool
- 🎬 [FFmpeg](https://ffmpeg.org/) - Powerful multimedia processing framework
- 🔊 [Chromaprint](https://acoustid.org/chromaprint) - Audio fingerprint recognition library
- 🦀 [Tauri](https://tauri.app/) - Modern desktop application framework

---

<p align="center">
  Made with ❤️ by MusicCut Team
</p>
