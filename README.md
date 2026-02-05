<p align="center">
  <b>简体中文</b> | <a href="./README_EN.md">English</a>
</p>

<p align="center">
  <img src="https://img.icons8.com/fluency/96/music-video.png" alt="MusicCut Logo" width="96" height="96">
</p>

<h1 align="center">🎬 MusicCut</h1>

<p align="center">
  <strong>基于音频指纹识别的智能视频剪辑工具</strong>
</p>

<p align="center">
  <a href="#-功能特性">功能特性</a> •
  <a href="#-技术栈">技术栈</a> •
  <a href="#-系统要求">系统要求</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-使用流程">使用流程</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows-blue?style=flat-square&logo=windows" alt="Platform">
  <img src="https://img.shields.io/badge/Tauri-2.x-orange?style=flat-square&logo=tauri" alt="Tauri">
  <img src="https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react" alt="React">
  <img src="https://img.shields.io/badge/Rust-stable-dea584?style=flat-square&logo=rust" alt="Rust">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
</p>

---

## 📸 应用截图

<p align="center">
  <img width="1404" height="864" alt="xiezuo20260205-144740" src="https://github.com/user-attachments/assets/59e184f3-b7af-49b8-83cf-ce57294ff871" />
</p>

---

## ✨ 功能特性

| 功能 | 描述 |
|:---:|:---|
| 🎵 **音乐指纹库** | 导入音乐文件，自动提取音频指纹建立本地音乐库 |
| 🔍 **智能识别** | 使用 Chromaprint 进行高精度音频指纹匹配 |
| 🎤 **人声分离** | 集成 audio-separator，支持 GPU 加速的 AI 人声分离 |
| ✂️ **自动剪辑** | 根据音乐匹配结果自动标记并剪辑视频片段 |
| 🎛️ **二次编辑** | 支持手动调整剪辑片段的起止时间 |
| 📦 **批量处理** | 支持批量导入视频，多项目并行分析 |

---

## 🛠️ 技术栈

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

**核心组件**:
- 🎬 **FFmpeg** - 视频/音频处理
- 🎵 **Chromaprint** - 音频指纹提取
- 🤖 **audio-separator** - AI 人声分离

---

## 💻 系统要求

| 项目 | 最低配置 | 推荐配置 |
|:---:|:---:|:---:|
| 🖥️ 操作系统 | Windows 10 | Windows 11 |
| 🧠 内存 | 4 GB | 8 GB+ |
| 💾 硬盘 | 2 GB 可用空间 | SSD 推荐 |
| 🎮 显卡 | - | NVIDIA GPU (CUDA) |

> 💡 **提示**: GPU 加速可大幅提升人声分离速度，推荐使用 NVIDIA 显卡

---

## 🚀 快速开始

### 📥 用户安装

下载发布包，解压后直接运行 `MusicCut.exe` 即可。

### 👨‍💻 开发者安装

```powershell
# 1️⃣ 克隆项目
git clone https://github.com/Joftal/musiccut.git
cd musiccut

# 2️⃣ 一键安装依赖
.\scripts\setup.ps1

# 3️⃣ 启动开发服务器
.\scripts\start-dev.ps1
```

📖 详细安装说明请参阅 **[INSTALL.md](./INSTALL.md)**

---

## 📋 使用流程

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  1️⃣ 导入    │ ➜  │  2️⃣ 创建    │ ➜  │  3️⃣ 识别    │ ➜  │  4️⃣ 确认    │ ➜  │  5️⃣ 导出    │
│   音乐库    │    │    项目     │    │    分析     │    │    片段     │    │    视频     │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

| 步骤 | 操作 | 说明 |
|:---:|:---|:---|
| 1️⃣ | **导入音乐库** | 在「音乐库」页面导入需要识别的音乐文件 |
| 2️⃣ | **创建项目** | 在「项目」页面创建新项目，选择要处理的视频 |
| 3️⃣ | **开始识别** | 点击「开始识别」，自动提取音频 → 分离人声 → 匹配指纹 |
| 4️⃣ | **确认片段** | 查看检测到的片段，确认保留或移除 |
| 5️⃣ | **导出视频** | 导出剪辑后的视频（合并或分段导出） |

---

## 📄 许可证

本项目基于 **MIT License** 开源。

---

## 🙏 致谢

- 🎵 [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator) - 优秀的音频分离工具
- 🎬 [FFmpeg](https://ffmpeg.org/) - 强大的多媒体处理框架
- 🔊 [Chromaprint](https://acoustid.org/chromaprint) - 音频指纹识别库
- 🦀 [Tauri](https://tauri.app/) - 现代化桌面应用框架

---

<p align="center">
  Made with ❤️ by MusicCut Team
</p>
