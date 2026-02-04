// 配置命令

use crate::config::{self, AppConfig, WindowState};
use crate::error::AppResult;
use crate::utils::AccelerationOptions;
use crate::commands::system::get_gpu_info;
use crate::commands::video::detect_gpu_capabilities;
use crate::database;
use serde::{Deserialize, Serialize};
use tauri::{State, Window};
use crate::utils::AppState;
use std::fs;

/// 获取配置
#[tauri::command]
pub async fn get_config() -> AppResult<AppConfig> {
    Ok(config::get_config())
}

/// 更新配置
#[tauri::command]
pub async fn update_config(window: Window, new_config: AppConfig) -> AppResult<()> {
    // 从当前窗口获取实际状态，避免覆盖用户调整后的窗口大小
    let current_window_state = if let (Ok(size), Ok(position), Ok(maximized), Ok(minimized)) = (
        window.outer_size(),
        window.outer_position(),
        window.is_maximized(),
        window.is_minimized()
    ) {
        let mut state = WindowState::default();
        if minimized || maximized {
            // 最小化或最大化时保留之前保存的尺寸，避免获取到错误的窗口状态
            let saved = config::get_config().window_state;
            state.width = saved.width;
            state.height = saved.height;
            state.x = saved.x;
            state.y = saved.y;
        } else {
            // 正常状态时获取实际尺寸
            state.width = size.width;
            state.height = size.height;
            state.x = Some(position.x);
            state.y = Some(position.y);
        }
        state.maximized = maximized;
        state
    } else {
        config::get_config().window_state
    };

    let mut config_to_save = new_config;
    config_to_save.window_state = current_window_state;

    config::update_config(config_to_save)
}

/// 获取加速选项
#[tauri::command]
pub async fn get_acceleration_options() -> AppResult<AccelerationOptions> {
    let cpu_threads = num_cpus::get();
    let gpu_info = get_gpu_info().await?;

    // 使用缓存的 GPU 能力检测结果
    let gpu_caps = detect_gpu_capabilities();
    let onnx_gpu_available = gpu_caps.onnx_gpu_available;

    let recommended = if onnx_gpu_available {
        "hybrid".to_string()
    } else {
        "cpu".to_string()
    };

    Ok(AccelerationOptions {
        cpu_available: true,
        cpu_threads,
        gpu_available: gpu_info.available,
        gpu_name: gpu_info.name,
        gpu_type: gpu_info.gpu_type,
        onnx_gpu_available,
        recommended,
    })
}

/// 存储信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageInfo {
    pub app_dir: String,
    pub db_path: String,
    pub config_path: String,
    pub db_size: u64,
    pub config_size: u64,
    pub temp_size: u64,
    pub total_size: u64,
}

/// 获取存储信息
#[tauri::command]
pub async fn get_storage_info(state: State<'_, AppState>) -> AppResult<StorageInfo> {
    let app_dir = state.app_dir.to_string_lossy().to_string();
    let db_path = state.db_path.to_string_lossy().to_string();
    let config_path = state.config_path.to_string_lossy().to_string();

    let db_size = fs::metadata(&state.db_path).map(|m| m.len()).unwrap_or(0);
    let config_size = fs::metadata(&state.config_path).map(|m| m.len()).unwrap_or(0);

    // 计算临时文件大小
    let temp_dir = state.app_dir.join("temp");
    let temp_size = calculate_dir_size(&temp_dir);

    let total_size = db_size + config_size + temp_size;

    Ok(StorageInfo {
        app_dir,
        db_path,
        config_path,
        db_size,
        config_size,
        temp_size,
        total_size,
    })
}

/// 清理缓存（临时文件）
#[tauri::command]
pub async fn clear_cache(state: State<'_, AppState>) -> AppResult<u64> {
    let temp_dir = state.app_dir.join("temp");
    let cleared_size = calculate_dir_size(&temp_dir);

    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)?;
        fs::create_dir_all(&temp_dir)?;
    }

    Ok(cleared_size)
}

/// 重置数据库（清空所有数据）
#[tauri::command]
pub async fn reset_database() -> AppResult<()> {
    // 清空所有表数据
    database::clear_all_data()
}

/// 重置配置为默认值
#[tauri::command]
pub async fn reset_config() -> AppResult<()> {
    let default_config = AppConfig::default();
    config::update_config(default_config)
}

/// 计算目录大小
fn calculate_dir_size(path: &std::path::Path) -> u64 {
    if !path.exists() {
        return 0;
    }

    let mut size = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                size += fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            } else if path.is_dir() {
                size += calculate_dir_size(&path);
            }
        }
    }
    size
}
