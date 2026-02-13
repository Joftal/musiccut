// 配置管理模块

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::fs;
use crate::error::{AppError, AppResult};
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use tracing::info;

static CONFIG: OnceCell<RwLock<AppConfig>> = OnceCell::new();
static CONFIG_PATH: OnceCell<std::path::PathBuf> = OnceCell::new();

/// 加速模式
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AccelerationMode {
    /// 仅使用 CPU
    Cpu,
    /// 仅使用 GPU
    Gpu,
    /// 混合模式：CPU + GPU
    Hybrid,
    /// 自动选择最佳模式
    Auto,
}

impl Default for AccelerationMode {
    fn default() -> Self {
        Self::Gpu
    }
}

/// GPU 类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum GpuType {
    Nvidia,
    Amd,
    Intel,
    None,
}

impl Default for GpuType {
    fn default() -> Self {
        Self::None
    }
}

/// 日志级别
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl Default for LogLevel {
    fn default() -> Self {
        Self::Info
    }
}

impl LogLevel {
    /// 转换为 tracing 过滤器字符串
    pub fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Error => "error",
            LogLevel::Warn => "warn",
            LogLevel::Info => "info",
            LogLevel::Debug => "debug",
            LogLevel::Trace => "trace",
        }
    }
}

/// 人声分离配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeparationConfig {
    /// 当前选择的模型 ID
    #[serde(default = "default_model_id")]
    pub selected_model_id: String,
    /// 输出格式
    pub output_format: String,
}

fn default_model_id() -> String {
    "mdx-inst-hq3".to_string()
}

impl Default for SeparationConfig {
    fn default() -> Self {
        Self {
            selected_model_id: "mdx-inst-hq3".to_string(),
            output_format: "wav".to_string(),
        }
    }
}

/// 窗口状态配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    /// 窗口宽度
    pub width: u32,
    /// 窗口高度
    pub height: u32,
    /// 窗口 X 坐标
    pub x: Option<i32>,
    /// 窗口 Y 坐标
    pub y: Option<i32>,
    /// 是否最大化
    pub maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: 1400,
            height: 800,
            x: None,
            y: None,
            maximized: false,
        }
    }
}

/// 人物检测配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionConfig {
    /// 置信度阈值 (0.0 - 1.0)
    pub confidence_threshold: f32,
    /// 抽帧间隔（每 N 帧检测一次）
    pub frame_interval: u32,
    /// 最小片段时长 (秒)
    pub min_segment_duration: f32,
    /// 最大合并间隔 (秒)
    pub max_gap_duration: f32,
}

impl Default for DetectionConfig {
    fn default() -> Self {
        Self {
            confidence_threshold: 0.5,
            frame_interval: 5,
            min_segment_duration: 1.0,
            max_gap_duration: 2.0,
        }
    }
}

/// 匹配配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchConfig {
    /// 最小匹配置信度 (0.0 - 1.0)
    pub min_confidence: f32,
    /// 片段最小长度 (秒)
    pub min_segment_duration: f32,
    /// 片段分析窗口大小 (秒)
    pub window_size: f32,
    /// 窗口滑动步长 (秒)
    pub hop_size: f32,
    /// 最大允许间隙 (秒)，超过此间隙则分割为独立片段
    #[serde(default = "default_max_gap_duration")]
    pub max_gap_duration: f32,
}

fn default_max_gap_duration() -> f32 {
    10.0
}

impl Default for MatchConfig {
    fn default() -> Self {
        Self {
            min_confidence: 0.6,
            min_segment_duration: 5.0,
            window_size: 15.0,
            hop_size: 5.0,
            max_gap_duration: 10.0,
        }
    }
}

/// 应用配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// 检测到的 GPU 类型
    pub detected_gpu: GpuType,
    /// 人声分离配置
    pub separation: SeparationConfig,
    /// 匹配配置
    pub matching: MatchConfig,
    /// 人物检测配置
    #[serde(default)]
    pub detection: DetectionConfig,
    /// 窗口状态
    #[serde(default)]
    pub window_state: WindowState,
    /// 日志级别
    #[serde(default)]
    pub log_level: LogLevel,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            detected_gpu: GpuType::None,
            separation: SeparationConfig::default(),
            matching: MatchConfig::default(),
            detection: DetectionConfig::default(),
            window_state: WindowState::default(),
            log_level: LogLevel::default(),
        }
    }
}

/// 初始化配置
pub fn init_config(config_path: &Path) -> AppResult<()> {
    CONFIG_PATH.set(config_path.to_path_buf())
        .map_err(|_| AppError::Config("配置路径已初始化".to_string()))?;

    let config = if config_path.exists() {
        let content = fs::read_to_string(config_path)?;
        serde_json::from_str(&content).unwrap_or_else(|e| {
            tracing::warn!("配置文件 JSON 解析失败: {}，使用默认配置", e);
            AppConfig::default()
        })
    } else {
        let config = AppConfig::default();
        let content = serde_json::to_string_pretty(&config)?;
        fs::write(config_path, content)?;
        config
    };

    info!("[CONFIG] 配置已加载");

    CONFIG.set(RwLock::new(config))
        .map_err(|_| AppError::Config("配置已初始化".to_string()))?;

    Ok(())
}

/// 获取配置
pub fn get_config() -> AppConfig {
    CONFIG.get()
        .map(|c| c.read().clone())
        .unwrap_or_default()
}

/// 更新配置
pub fn update_config(config: AppConfig) -> AppResult<()> {
    info!("[CONFIG] 配置更新");

    // 先写入文件，成功后再更新内存，避免文件写入失败导致内存与文件不一致
    if let Some(path) = CONFIG_PATH.get() {
        let content = serde_json::to_string_pretty(&config)?;
        fs::write(path, content)?;
    }

    if let Some(lock) = CONFIG.get() {
        let mut current = lock.write();
        *current = config;
    }

    Ok(())
}

/// 更新窗口状态（窗口关闭时调用）
pub fn update_window_state(window_state: WindowState) -> AppResult<()> {
    info!("[CONFIG] 窗口状态更新: {}x{}", window_state.width, window_state.height);

    if let Some(lock) = CONFIG.get() {
        // 先准备新配置
        let mut new_config = lock.read().clone();
        new_config.window_state = window_state;

        // 先写入文件，成功后再更新内存
        if let Some(path) = CONFIG_PATH.get() {
            let content = serde_json::to_string_pretty(&new_config)?;
            fs::write(path, content)?;
        }

        // 文件写入成功后更新内存
        let mut current = lock.write();
        *current = new_config;
    }

    Ok(())
}
