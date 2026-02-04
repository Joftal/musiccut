// 工具模块

use std::path::PathBuf;
use std::process::Command;
use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows 下隐藏控制台窗口的标志
#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 创建一个隐藏控制台窗口的 Command（Windows 专用）
/// 在非 Windows 平台上等同于 Command::new
#[cfg(target_os = "windows")]
pub fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(target_os = "windows"))]
pub fn hidden_command(program: &str) -> Command {
    Command::new(program)
}

/// 应用状态
pub struct AppState {
    pub db_path: PathBuf,
    pub config_path: PathBuf,
    pub app_dir: PathBuf,
}

/// 音乐信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicInfo {
    pub id: String,
    pub title: String,
    pub album: Option<String>,
    pub duration: f64,
    pub file_path: String,
    pub fingerprint_hash: String,
    pub created_at: String,
    /// 源文件是否存在
    #[serde(default = "default_file_exists")]
    pub file_exists: bool,
}

fn default_file_exists() -> bool {
    true
}

/// 视频信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub path: String,
    pub filename: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub video_codec: String,
    pub audio_codec: String,
    pub bitrate: u64,
    pub size: u64,
    pub format: String,
}

/// 片段信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub id: String,
    pub project_id: String,
    pub music_id: Option<String>,
    pub music_title: Option<String>,
    pub start_time: f64,
    pub end_time: f64,
    pub confidence: f64,
    pub status: SegmentStatus,
}

/// 片段状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SegmentStatus {
    Detected,
    Removed,
}

/// 项目信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub source_video_path: String,
    /// 预览视频路径（用于播放不支持的格式，如 FLV）
    #[serde(default)]
    pub preview_video_path: Option<String>,
    pub video_info: VideoInfo,
    pub segments: Vec<Segment>,
    pub created_at: String,
    pub updated_at: String,
    /// 源视频文件是否存在
    #[serde(default = "default_file_exists")]
    pub file_exists: bool,
}

/// 匹配结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchResult {
    pub music_id: String,
    pub music_title: String,
    pub confidence: f64,
    pub start_time: f64,
    pub end_time: f64,
}

/// 分离结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeparationResult {
    pub vocals_path: String,
    pub accompaniment_path: String,
    pub duration: f64,
}

/// 剪辑参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CutParams {
    pub project_id: String,
    pub output_path: String,
    pub keep_matched: bool,
}

/// GPU 信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub available: bool,
    pub name: String,
    pub gpu_type: String,
    pub memory: u64,
    pub onnx_gpu_available: bool,
}

/// 系统信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub cpu_model: String,
    pub cpu_cores: usize,
    pub cpu_threads: usize,
    pub memory: u64,
    pub gpu: GpuInfo,
    pub ffmpeg_version: Option<String>,
    pub fpcalc_available: bool,
    pub python_available: bool,
}

/// 依赖检查结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyCheck {
    pub name: String,
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub message: String,
}

/// 加速选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccelerationOptions {
    pub cpu_available: bool,
    pub cpu_threads: usize,
    pub gpu_available: bool,
    pub gpu_name: String,
    pub gpu_type: String,
    pub onnx_gpu_available: bool,
    pub recommended: String,
}

/// 生成 UUID
pub fn generate_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// 获取可执行文件所在目录
pub fn get_exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(|p| p.to_path_buf())
}

/// 解析程序路径，优先使用相对于可执行文件的 ffmpeg 目录
pub fn resolve_tool_path(tool_name: &str) -> String {
    if let Some(exe_dir) = get_exe_dir() {
        // 检查 ffmpeg 子目录
        let tool_path = exe_dir.join("ffmpeg").join(format!("{}.exe", tool_name));
        if tool_path.exists() {
            return tool_path.to_string_lossy().to_string();
        }
        // 检查可执行文件同级目录
        let tool_path = exe_dir.join(format!("{}.exe", tool_name));
        if tool_path.exists() {
            return tool_path.to_string_lossy().to_string();
        }
    }
    // 回退到系统 PATH
    tool_name.to_string()
}
