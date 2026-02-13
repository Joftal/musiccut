// 错误处理模块

use thiserror::Error;
use serde::Serialize;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON 解析错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("FFmpeg 错误: {0}")]
    FFmpeg(String),

    #[error("指纹提取错误: {0}")]
    Fingerprint(String),

    #[error("人声分离错误: {0}")]
    VocalSeparation(String),

    #[error("人物检测错误: {0}")]
    Detection(String),

    #[error("视频处理错误: {0}")]
    Video(String),

    #[error("配置错误: {0}")]
    Config(String),

    #[error("依赖缺失: {0}")]
    DependencyMissing(String),

    #[error("任务已取消")]
    Cancelled,

    #[error("未找到: {0}")]
    NotFound(String),

    #[error("无效参数: {0}")]
    InvalidArgument(String),
}

// 实现 Serialize 以便通过 Tauri 传递错误
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
