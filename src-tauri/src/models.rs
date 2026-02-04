// 模型管理模块

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const MODELS_DIR_ENV: &str = "MUSICCUT_MODELS_DIR";

/// 模型架构类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ModelArchitecture {
    /// MDX-Net (ONNX 格式)
    MdxNet,
}

/// 模型信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    /// 模型唯一标识
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 模型架构
    pub architecture: ModelArchitecture,
    /// 模型文件名
    pub filename: String,
    /// 模型描述
    pub description: String,
    /// 输出轨道数 (2=人声+伴奏, 4=人声+鼓+贝斯+其他)
    pub stems: u8,
    /// 速度评分 (1-5, 5最快)
    pub speed_rating: u8,
    /// 质量评分 (1-5, 5最高)
    pub quality_rating: u8,
    /// 模型文件大小 (bytes)
    pub file_size: u64,
}

/// 模型状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStatus {
    /// 模型 ID
    pub model_id: String,
    /// 是否已下载
    pub downloaded: bool,
    /// 本地路径
    pub local_path: Option<String>,
}

/// 获取所有可用模型列表
pub fn get_available_models() -> Vec<ModelInfo> {
    vec![
        // MDX-Net 模型 (唯一支持的模型)
        ModelInfo {
            id: "mdx-inst-hq3".to_string(),
            name: "MDX-Net Inst HQ3".to_string(),
            architecture: ModelArchitecture::MdxNet,
            filename: "UVR-MDX-NET-Inst_HQ_3.onnx".to_string(),
            description: "快速高质量，适合大多数场景".to_string(),
            stems: 2,
            speed_rating: 5,
            quality_rating: 3,
            file_size: 67_000_000, // ~67MB
        },
    ]
}

/// 根据 ID 获取模型信息
pub fn get_model_by_id(model_id: &str) -> Option<ModelInfo> {
    get_available_models().into_iter().find(|m| m.id == model_id)
}

/// 获取项目根目录
fn get_project_root() -> PathBuf {
    // 优先使用可执行文件所在目录的父目录
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            // 如果是在 target/debug 或 target/release 下运行，向上找到项目根目录
            let parent_str = parent.to_string_lossy();
            if parent_str.contains("target") {
                // 只检查 src-tauri 子目录存在，这样能准确找到项目根目录
                // 不检查 Cargo.toml，因为 src-tauri 目录下也有 Cargo.toml
                if let Some(project_root) = parent.ancestors().find(|p| {
                    p.join("src-tauri").exists()
                }) {
                    return project_root.to_path_buf();
                }
            }
            return parent.to_path_buf();
        }
    }
    // 回退到当前工作目录
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn ensure_models_root_dir() -> std::io::Result<PathBuf> {
    let models_root = get_project_root().join("models");
    fs::create_dir_all(&models_root)?;
    Ok(models_root)
}

/// 获取 audio-separator 模型根目录
/// 优先使用环境变量 MUSICCUT_MODELS_DIR（打包时指向资源目录）
/// 未设置则回退到项目目录下的 models/audio-separator
pub fn get_models_cache_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os(MODELS_DIR_ENV) {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    get_project_root().join("models").join("audio-separator")
}

pub fn get_model_dir(model: &ModelInfo) -> PathBuf {
    get_models_cache_dir().join(&model.id)
}

pub fn ensure_model_dir(model: &ModelInfo) -> std::io::Result<PathBuf> {
    let model_dir = get_model_dir(model);
    fs::create_dir_all(&model_dir)?;
    Ok(model_dir)
}

pub fn set_models_cache_dir(path: PathBuf) {
    std::env::set_var(MODELS_DIR_ENV, &path);
}

/// 检查模型是否已下载
pub fn check_model_downloaded(model: &ModelInfo) -> ModelStatus {
    let model_dir = get_model_dir(model);
    let model_path = model_dir.join(&model.filename);
    let exists = model_path.exists();
    let local_path = if exists {
        Some(model_path.to_string_lossy().to_string())
    } else {
        None
    };

    ModelStatus {
        model_id: model.id.clone(),
        downloaded: exists,
        local_path,
    }
}

/// 获取所有模型的状态
pub fn get_all_models_status() -> Vec<ModelStatus> {
    get_available_models()
        .iter()
        .map(|m| check_model_downloaded(m))
        .collect()
}
