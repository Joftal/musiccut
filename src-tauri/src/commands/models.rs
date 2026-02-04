// 模型管理命令

use crate::models::{self, ModelInfo, ModelStatus};
use crate::error::{AppResult, AppError};
use crate::utils::hidden_command;
use std::process::Stdio;
use std::io::{BufRead, BufReader};
use tauri::Manager;
use serde::Serialize;
use tracing::{info, error, debug};

/// 模型下载进度事件
#[derive(Clone, Serialize)]
pub struct ModelDownloadProgress {
    pub model_id: String,
    pub progress: f32,
    pub message: String,
    pub completed: bool,
    pub error: Option<String>,
}

/// 获取所有可用模型列表
#[tauri::command]
pub async fn get_available_models() -> AppResult<Vec<ModelInfo>> {
    Ok(models::get_available_models())
}

/// 获取所有模型状态
#[tauri::command]
pub async fn get_models_status() -> AppResult<Vec<ModelStatus>> {
    Ok(models::get_all_models_status())
}

/// 检查单个模型是否已下载
#[tauri::command]
pub async fn check_model_downloaded(model_id: String) -> AppResult<bool> {
    let model = models::get_model_by_id(&model_id);
    match model {
        Some(m) => {
            let status = models::check_model_downloaded(&m);
            Ok(status.downloaded)
        }
        None => Ok(false),
    }
}

/// 根据 ID 获取模型信息
#[tauri::command]
pub async fn get_model_info(model_id: String) -> AppResult<Option<ModelInfo>> {
    Ok(models::get_model_by_id(&model_id))
}

/// 下载模型
/// 通过运行 audio-separator 触发模型下载
#[tauri::command]
pub async fn download_model(
    app_handle: tauri::AppHandle,
    model_id: String,
) -> AppResult<()> {
    let model = models::get_model_by_id(&model_id)
        .ok_or_else(|| AppError::NotFound(format!("模型不存在: {}", model_id)))?;

    let model_dir = models::ensure_model_dir(&model)?;
    info!("开始下载模型: {} ({})", model.name, model.filename);
    info!(
        "模型信息: id={}, 架构={:?}, 目标目录={}",
        model.id,
        model.architecture,
        model_dir.to_string_lossy()
    );

    // 发送开始事件
    let _ = app_handle.emit_all("model-download-progress", ModelDownloadProgress {
        model_id: model_id.clone(),
        progress: 0.0,
        message: "准备下载模型...".to_string(),
        completed: false,
        error: None,
    });

    // 创建临时目录和静音音频文件
    let temp_dir = std::env::temp_dir().join("musiccut_model_download");
    std::fs::create_dir_all(&temp_dir)?;

    let temp_audio = temp_dir.join("silence.wav");
    let temp_output = temp_dir.join("output");
    std::fs::create_dir_all(&temp_output)?;
    info!(
        "临时目录: {}, 临时音频: {}, 临时输出: {}",
        temp_dir.to_string_lossy(),
        temp_audio.to_string_lossy(),
        temp_output.to_string_lossy()
    );

    // 使用 ffmpeg 创建 1 秒静音音频
    let ffmpeg_result = hidden_command("ffmpeg")
        .args([
            "-y",
            "-f", "lavfi",
            "-i", "anullsrc=r=44100:cl=stereo",
            "-t", "1",
            temp_audio.to_string_lossy().as_ref(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if ffmpeg_result.is_err() || !ffmpeg_result.unwrap().success() {
        error!("创建临时音频文件失败");
        let _ = app_handle.emit_all("model-download-progress", ModelDownloadProgress {
            model_id: model_id.clone(),
            progress: 0.0,
            message: "创建临时文件失败".to_string(),
            completed: true,
            error: Some("无法创建临时音频文件，请确保 ffmpeg 已安装".to_string()),
        });
        return Err(AppError::FFmpeg("创建临时音频文件失败".to_string()));
    }

    // 构建 audio-separator 命令
    let mut args = vec![
        temp_audio.to_string_lossy().to_string(),
        "--model_filename".to_string(),
        model.filename.clone(),
        "--output_dir".to_string(),
        temp_output.to_string_lossy().to_string(),
    ];

    // 所有模型都使用 --model_file_dir 参数，按模型 ID 独立目录存放
    args.push("--model_file_dir".to_string());
    args.push(model_dir.to_string_lossy().to_string());

    info!("执行命令: audio-separator {}", args.join(" "));
    info!("模型下载源: 由 audio-separator 内部决定，若其输出包含 URL 将记录到日志");

    let _ = app_handle.emit_all("model-download-progress", ModelDownloadProgress {
        model_id: model_id.clone(),
        progress: 0.1,
        message: "正在下载模型...".to_string(),
        completed: false,
        error: None,
    });

    // 构建命令
    let mut cmd = hidden_command("audio-separator");
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        error!("启动 audio-separator 失败: {}", e);
        AppError::VocalSeparation(format!("启动 audio-separator 失败: {}", e))
    })?;

    // 读取 stderr 解析进度
    let stderr = child.stderr.take().unwrap();
    let reader = BufReader::new(stderr);

    let app_handle_clone = app_handle.clone();
    let model_id_clone = model_id.clone();

    for line in reader.lines() {
        if let Ok(line) = line {
            debug!("audio-separator: {}", line);

            if line.contains("http://") || line.contains("https://") {
                info!("检测到下载地址: {}", line);
            }

            if line.contains("Downloading") || line.contains("downloading") {
                info!("下载中: {}", line);
                let _ = app_handle_clone.emit_all("model-download-progress", ModelDownloadProgress {
                    model_id: model_id_clone.clone(),
                    progress: 0.3,
                    message: "正在下载模型文件...".to_string(),
                    completed: false,
                    error: None,
                });
            }

            if line.contains('%') {
                if let Some(pos) = line.find('%') {
                    let start = line[..pos]
                        .rfind(|c: char| !c.is_ascii_digit())
                        .map(|i| i + 1)
                        .unwrap_or(0);
                    if let Ok(percent) = line[start..pos].parse::<f32>() {
                        info!("下载进度: {:.0}% {}", percent, line);
                        // 下载占 10%-90%，处理占 90%-100%
                        let progress = 0.1 + (percent / 100.0) * 0.8;
                        let _ = app_handle_clone.emit_all("model-download-progress", ModelDownloadProgress {
                            model_id: model_id_clone.clone(),
                            progress,
                            message: format!("处理中... {:.0}%", percent),
                            completed: false,
                            error: None,
                        });
                    }
                }
            }
        }
    }

    let status = child.wait()?;

    // 清理临时文件
    let _ = std::fs::remove_dir_all(&temp_dir);

    if status.success() {
        let status = models::check_model_downloaded(&model);
        info!(
            "模型下载完成: {} (下载状态: {}, 位置: {:?})",
            model.name,
            status.downloaded,
            status.local_path
        );
        let _ = app_handle.emit_all("model-download-progress", ModelDownloadProgress {
            model_id: model_id.clone(),
            progress: 1.0,
            message: "下载完成".to_string(),
            completed: true,
            error: None,
        });
        Ok(())
    } else {
        error!("模型下载失败，退出码: {:?}", status.code());
        let _ = app_handle.emit_all("model-download-progress", ModelDownloadProgress {
            model_id: model_id.clone(),
            progress: 0.0,
            message: "下载失败".to_string(),
            completed: true,
            error: Some("模型下载失败，请检查网络连接".to_string()),
        });
        Err(AppError::VocalSeparation("模型下载失败".to_string()))
    }
}
