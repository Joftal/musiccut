# MusicCut

基于音频指纹识别的智能视频剪辑工具。

## 功能特性

- **音乐指纹库管理**: 导入音乐文件，自动提取音频指纹
- **智能音频识别**: 使用 Chromaprint 进行高精度音频指纹匹配
- **人声分离**: 集成 audio-separator，支持 GPU 加速
- **自动视频剪辑**: 根据音乐匹配结果自动剪辑视频
- **二次编辑**: 支持手动调整剪辑片段

## 技术栈

- **前端**: React + TypeScript + TailwindCSS
- **后端**: Rust + Tauri
- **音频处理**: FFmpeg + Chromaprint + audio-separator
- **数据库**: SQLite

## 系统要求

- Windows 10/11
- 4GB+ RAM (推荐 8GB+)
- NVIDIA GPU + CUDA (可选，用于 GPU 加速)

## 安装与使用

详见 [INSTALL.md](./INSTALL.md)

## 使用流程

1. **导入音乐库**: 在"音乐库"页面导入需要识别的音乐文件
2. **创建项目**: 在"项目"页面创建新项目，选择要处理的视频
3. **开始识别**: 在编辑器中点击"开始识别"，自动提取音频、分离人声、匹配指纹
4. **确认片段**: 查看检测到的片段，确认或移除
5. **导出视频**: 导出剪辑后的视频

## 许可证

MIT License

## 致谢

- [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator) - 音频分离 CLI/Python 包
