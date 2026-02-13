// 模型管理命令

use crate::models::{self, ModelInfo, ModelStatus};
use crate::error::{AppResult, AppError};
use crate::utils::hidden_command;
use std::process::Stdio;
use std::io::{BufRead, BufReader, Read as _};
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

/// 获取所有可用模型列表（包括分离模型和检测模型）
#[tauri::command]
pub async fn get_available_models() -> AppResult<Vec<ModelInfo>> {
    let mut all = models::get_available_models();
    all.extend(models::get_detection_models());
    Ok(all)
}

/// 获取所有模型状态（包括分离模型和检测模型）
#[tauri::command]
pub async fn get_models_status() -> AppResult<Vec<ModelStatus>> {
    let mut all = models::get_all_models_status();
    all.extend(models::get_all_detection_models_status());
    Ok(all)
}

/// 检查单个模型是否已下载
#[tauri::command]
pub async fn check_model_downloaded(model_id: String) -> AppResult<bool> {
    // 先查分离模型，再查检测模型
    if let Some(m) = models::get_model_by_id(&model_id) {
        return Ok(models::check_model_downloaded(&m).downloaded);
    }
    if let Some(m) = models::get_detection_model_by_id(&model_id) {
        return Ok(models::check_detection_model_downloaded(&m).downloaded);
    }
    Ok(false)
}

/// 根据 ID 获取模型信息
#[tauri::command]
pub async fn get_model_info(model_id: String) -> AppResult<Option<ModelInfo>> {
    if let Some(m) = models::get_model_by_id(&model_id) {
        return Ok(Some(m));
    }
    Ok(models::get_detection_model_by_id(&model_id))
}

/// 下载模型
/// 分离模型通过 audio-separator 触发下载，检测模型通过 HTTP 直接下载
#[tauri::command]
pub async fn download_model(
    app_handle: tauri::AppHandle,
    model_id: String,
) -> AppResult<()> {
    // 先查检测模型
    if let Some(model) = models::get_detection_model_by_id(&model_id) {
        return download_detection_model(app_handle, model_id, model).await;
    }

    // 否则按分离模型处理
    let model = models::get_model_by_id(&model_id)
        .ok_or_else(|| AppError::NotFound(format!("模型不存在: {}", model_id)))?;

    download_separation_model(app_handle, model_id, model).await
}

/// 下载检测模型（YOLO）- 通过 HTTP 直接下载 .pt 文件
async fn download_detection_model(
    app_handle: tauri::AppHandle,
    model_id: String,
    model: ModelInfo,
) -> AppResult<()> {
    let model_dir = models::ensure_detection_model_dir(&model)?;
    let model_path = model_dir.join(&model.filename);

    info!("开始下载检测模型: {} ({})", model.name, model.filename);
    info!("目标路径: {}", model_path.display());

    let _ = app_handle.emit_all("model-download-progress", ModelDownloadProgress {
        model_id: model_id.clone(),
        progress: 0.0,
        message: "准备下载检测模型...".to_string(),
        completed: false,
        error: None,
    });

    // YOLO 模型下载 URL (GitHub releases)
    let download_url = format!(
        "https://github.com/ultralytics/assets/releases/download/v8.3.0/{}",
        model.filename
    );
    info!("下载地址: {}", download_url);

    let _ = app_handle.emit_all("model-download-progress", ModelDownloadProgress {
        model_id: model_id.clone(),
        progress: 0.1,
        message: "正在下载检测模型...".to_string(),
        completed: false,
        error: None,
    });

    // 在阻塞线程中执行 HTTP 下载
    let model_id_clone = model_id.clone();
    let app_handle_clone = app_handle.clone();
    let result = tokio::task::spawn_blocking(move || {
        let response = ureq::get(&download_url)
            .call()
            .map_err(|e| AppError::Detection(format!("下载检测模型失败: {}", e)))?;

        let content_length = response.header("Content-Length")
            .and_then(|s| s.parse::<u64>().ok());

        // 写入临时文件，完成后重命名
        let temp_path = model_path.with_extension("pt.tmp");
        let mut file = std::fs::File::create(&temp_path)
            .map_err(|e| AppError::Detection(format!("创建文件失败: {}", e)))?;

        let mut reader = response.into_reader();
        let mut downloaded: u64 = 0;
        let mut buf = [0u8; 65536];
        let mut last_progress: f32 = 0.1;

        loop {
            let n = reader.read(&mut buf)
                .map_err(|e| AppError::Detection(format!("读取数据失败: {}", e)))?;
            if n == 0 { break; }

            std::io::Write::write_all(&mut file, &buf[..n])
                .map_err(|e| AppError::Detection(format!("写入文件失败: {}", e)))?;

            downloaded += n as u64;

            if let Some(total) = content_length {
                let progress = 0.1 + (downloaded as f32 / total as f32) * 0.85;
                // 每 5% 更新一次进度
                if progress - last_progress >= 0.05 {
                    last_progress = progress;
                    let _ = app_handle_clone.emit_all("model-download-progress", ModelDownloadProgress {
                        model_id: model_id_clone.clone(),
                        progress,
                        message: format!("下载中... {:.0}%", progress * 100.0),
                        completed: false,
                        error: None,
                    });
                }
            }
        }

        drop(file);

        // 重命名临时文件
        std::fs::rename(&temp_path, &model_path)
            .map_err(|e| AppError::Detection(format!("重命名文件失败: {}", e)))?;

        info!("检测模型下载完成: {}", model_path.display());
        Ok::<(), AppError>(())
    }).await.map_err(|e| AppError::Detection(format!("下载任务失败: {}", e)))?;

    match result {
        Ok(()) => {
            let _ = app_handle.emit_all("model-download-progress", ModelDownloadProgress {
                model_id: model_id.clone(),
                progress: 1.0,
                message: "下载完成".to_string(),
                completed: true,
                error: None,
            });
            Ok(())
        }
        Err(e) => {
            error!("检测模型下载失败: {}", e);
            let _ = app_handle.emit_all("model-download-progress", ModelDownloadProgress {
                model_id: model_id.clone(),
                progress: 0.0,
                message: "下载失败".to_string(),
                completed: true,
                error: Some(format!("{}", e)),
            });
            Err(e)
        }
    }
}

/// 下载分离模型 - 通过 audio-separator 触发下载
async fn download_separation_model(
    app_handle: tauri::AppHandle,
    model_id: String,
    model: ModelInfo,
) -> AppResult<()> {

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
