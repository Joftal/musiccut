// 视频命令

use crate::config::{self, AccelerationMode};
use crate::database;
use crate::error::{AppError, AppResult};
use crate::utils::{VideoInfo, Segment, SegmentStatus, SeparationResult, CutParams, generate_id, hidden_command};
use crate::video::ffmpeg;
use crate::audio::{separator, fingerprint};
use crate::audio::separator::GpuCapabilities;
use tauri::{Window, State};
use crate::utils::AppState;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::process::Child;
use tracing::{info, error};
use rayon::prelude::*;

// 按项目 ID 管理的取消标志，支持多个并发操作互不干扰
lazy_static::lazy_static! {
    static ref CANCEL_FLAGS: Mutex<HashMap<String, Arc<AtomicBool>>> = Mutex::new(HashMap::new());
    // 按项目 ID 管理的子进程句柄，支持即时取消（直接 kill 进程）
    static ref CHILD_PROCESSES: Mutex<HashMap<String, Vec<Arc<Mutex<Option<Child>>>>>> = Mutex::new(HashMap::new());
}

// GPU 能力缓存（整个应用生命周期只检测一次）
static GPU_CAPS_CACHE: std::sync::OnceLock<GpuCapabilities> = std::sync::OnceLock::new();

/// RAII 守卫：作用域结束时自动清理取消标志，防止内存泄漏
struct CancelFlagGuard {
    project_id: String,
}

impl CancelFlagGuard {
    fn new(project_id: String) -> Self {
        Self { project_id }
    }
}

impl Drop for CancelFlagGuard {
    fn drop(&mut self) {
        remove_cancel_flag(&self.project_id);
        clear_child_processes(&self.project_id);
    }
}

/// 获取或创建项目的取消标志
fn get_cancel_flag(project_id: &str) -> Arc<AtomicBool> {
    let mut flags = CANCEL_FLAGS.lock()
        .unwrap_or_else(|poisoned| {
            tracing::warn!("取消标志 Mutex 被毒化，尝试恢复");
            poisoned.into_inner()
        });
    flags
        .entry(project_id.to_string())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone()
}

/// 重置项目的取消标志（开始新操作时调用）
fn reset_cancel_flag(project_id: &str) -> Arc<AtomicBool> {
    let mut flags = CANCEL_FLAGS.lock()
        .unwrap_or_else(|poisoned| {
            tracing::warn!("取消标志 Mutex 被毒化，尝试恢复");
            poisoned.into_inner()
        });
    let flag = flags
        .entry(project_id.to_string())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)));
    flag.store(false, Ordering::SeqCst);
    flag.clone()
}

/// 清理项目的取消标志（项目删除或操作完成后可选调用）
pub fn remove_cancel_flag(project_id: &str) {
    let mut flags = CANCEL_FLAGS.lock()
        .unwrap_or_else(|poisoned| {
            tracing::warn!("取消标志 Mutex 被毒化，尝试恢复");
            poisoned.into_inner()
        });
    flags.remove(project_id);
}

/// 注册子进程到项目（用于即时取消）
pub fn register_child_process(project_id: &str, child: Child) -> Arc<Mutex<Option<Child>>> {
    let handle = Arc::new(Mutex::new(Some(child)));
    let mut processes = CHILD_PROCESSES.lock()
        .unwrap_or_else(|poisoned| {
            tracing::warn!("子进程 Mutex 被毒化，尝试恢复");
            poisoned.into_inner()
        });
    processes.entry(project_id.to_string())
        .or_insert_with(Vec::new)
        .push(handle.clone());
    handle
}

/// 清理项目的所有子进程句柄
pub fn clear_child_processes(project_id: &str) {
    let mut processes = CHILD_PROCESSES.lock()
        .unwrap_or_else(|poisoned| {
            tracing::warn!("子进程 Mutex 被毒化，尝试恢复");
            poisoned.into_inner()
        });
    processes.remove(project_id);
}

/// kill 项目的所有子进程
fn kill_child_processes(project_id: &str) {
    let processes = CHILD_PROCESSES.lock()
        .unwrap_or_else(|poisoned| {
            tracing::warn!("子进程 Mutex 被毒化，尝试恢复");
            poisoned.into_inner()
        });
    if let Some(handles) = processes.get(project_id) {
        for handle in handles {
            if let Ok(mut guard) = handle.lock() {
                if let Some(ref mut child) = *guard {
                    info!("正在终止子进程: project_id={}", project_id);
                    let _ = child.kill();
                }
            }
        }
    }
}

/// 分析视频
#[tauri::command]
pub async fn analyze_video(path: String) -> AppResult<VideoInfo> {
    let video_path = Path::new(&path);
    if !video_path.exists() {
        return Err(AppError::NotFound(format!("视频文件不存在: {}", path)));
    }

    ffmpeg::get_video_info(&path)
}

/// 缓存状态
#[derive(Debug, Clone, serde::Serialize)]
pub struct CacheStatus {
    pub audio_valid: bool,
    pub audio_path: Option<String>,
    pub separation_valid: bool,
    pub vocals_path: Option<String>,
    pub accompaniment_path: Option<String>,
}

/// 检查项目的中间处理文件缓存是否有效
/// 允许前端跳过耗时的音频提取和人声分离步骤
#[tauri::command]
pub async fn check_cache_status(
    project_id: String,
    video_path: String,
    model_id: String,
    state: State<'_, AppState>,
) -> AppResult<CacheStatus> {
    info!("=== 检查缓存状态 === project_id={}, video_path={}, model_id={}", project_id, video_path, model_id);

    let temp_dir = state.app_dir.join("temp");

    // 1. 检查音频提取缓存
    let audio_file = temp_dir.join(format!("{}_audio.wav", project_id));
    let video_file = Path::new(&video_path);

    let audio_valid = if !audio_file.exists() {
        info!("音频缓存未命中: 文件不存在 {}", audio_file.display());
        false
    } else if !audio_file.metadata().map(|m| m.len() > 0).unwrap_or(false) {
        info!("音频缓存未命中: 文件为空 {}", audio_file.display());
        false
    } else if !video_file.exists() {
        info!("音频缓存未命中: 源视频不存在 {}", video_path);
        false
    } else {
        let audio_mtime = audio_file.metadata().and_then(|m| m.modified()).ok();
        let video_mtime = video_file.metadata().and_then(|m| m.modified()).ok();
        match (audio_mtime, video_mtime) {
            (Some(a), Some(v)) if a >= v => true,
            (Some(_), Some(_)) => {
                info!("音频缓存未命中: 源视频更新于音频文件之后");
                false
            }
            _ => {
                info!("音频缓存未命中: 无法获取文件修改时间");
                false
            }
        }
    };

    info!("音频缓存有效: {}, 路径: {}", audio_valid, audio_file.display());

    // 2. 检查人声分离缓存（仅在音频缓存有效时才有意义）
    let separated_dir = temp_dir.join(format!("{}_separated", project_id));
    let mut separation_valid = false;
    let mut vocals_path_result: Option<String> = None;
    let mut accompaniment_path_result: Option<String> = None;

    if audio_valid && separated_dir.exists() {
        let audio_filename = format!("{}_audio", project_id);
        let sep_config = config::get_config();
        let output_ext = &sep_config.separation.output_format;

        if let Some(model) = crate::models::get_model_by_id(&model_id) {
            let model_name = model.filename
                .replace(".onnx", "")
                .replace(".ckpt", "")
                .replace(".yaml", "");

            // 与 separator.rs 中相同的文件名搜索模式
            let possible_instrumental = vec![
                format!("{}_(Instrumental)_{}.{}", audio_filename, model_name, output_ext),
                format!("{}_(Instrumental).{}", audio_filename, output_ext),
                format!("{}_Instrumental.{}", audio_filename, output_ext),
            ];
            let possible_vocals = vec![
                format!("{}_(Vocals)_{}.{}", audio_filename, model_name, output_ext),
                format!("{}_(Vocals).{}", audio_filename, output_ext),
                format!("{}_Vocals.{}", audio_filename, output_ext),
            ];

            // 查找伴奏文件
            let find_file = |patterns: &[String]| -> Option<std::path::PathBuf> {
                patterns.iter()
                    .map(|name| separated_dir.join(name))
                    .find(|p| p.exists() && p.metadata().map(|m| m.len() > 0).unwrap_or(false))
            };

            let found_acc = find_file(&possible_instrumental).or_else(|| {
                // 模糊匹配
                std::fs::read_dir(&separated_dir).ok().and_then(|entries| {
                    entries.flatten().find_map(|entry| {
                        let fname = entry.file_name().to_string_lossy().to_string();
                        if fname.contains(&audio_filename)
                            && (fname.to_lowercase().contains("instrument")
                                || fname.to_lowercase().contains("no_vocal"))
                        {
                            let p = separated_dir.join(&fname);
                            if p.metadata().map(|m| m.len() > 0).unwrap_or(false) {
                                return Some(p);
                            }
                        }
                        None
                    })
                })
            });

            let found_voc = find_file(&possible_vocals).or_else(|| {
                std::fs::read_dir(&separated_dir).ok().and_then(|entries| {
                    entries.flatten().find_map(|entry| {
                        let fname = entry.file_name().to_string_lossy().to_string();
                        if fname.contains(&audio_filename)
                            && (fname.to_lowercase().contains("vocal")
                                || fname.to_lowercase().contains("voice"))
                        {
                            let p = separated_dir.join(&fname);
                            if p.metadata().map(|m| m.len() > 0).unwrap_or(false) {
                                return Some(p);
                            }
                        }
                        None
                    })
                })
            });

            if let (Some(acc), Some(voc)) = (&found_acc, &found_voc) {
                info!("找到分离文件: 伴奏={}, 人声={}", acc.display(), voc.display());
                // 分离文件修改时间必须 ≥ 音频文件修改时间
                let acc_mtime = acc.metadata().and_then(|m| m.modified()).ok();
                let audio_mtime = audio_file.metadata().and_then(|m| m.modified()).ok();
                match (acc_mtime, audio_mtime) {
                    (Some(a), Some(au)) if a >= au => {
                        separation_valid = true;
                        accompaniment_path_result = Some(acc.to_string_lossy().to_string());
                        vocals_path_result = Some(voc.to_string_lossy().to_string());
                    }
                    (Some(_), Some(_)) => {
                        info!("分离缓存未命中: 音频文件更新于分离文件之后");
                    }
                    _ => {
                        info!("分离缓存未命中: 无法获取文件修改时间");
                    }
                }
            } else {
                info!("分离缓存未命中: 未找到匹配的分离文件 (伴奏={}, 人声={})",
                    found_acc.is_some(), found_voc.is_some());
            }
        } else {
            info!("模型 {} 未找到，无法验证分离缓存", model_id);
        }
    }

    info!("分离缓存有效: {}", separation_valid);

    Ok(CacheStatus {
        audio_valid,
        audio_path: if audio_valid { Some(audio_file.to_string_lossy().to_string()) } else { None },
        separation_valid,
        vocals_path: vocals_path_result,
        accompaniment_path: accompaniment_path_result,
    })
}

/// 提取音频
#[tauri::command]
pub async fn extract_audio(
    window: Window,
    video_path: String,
    output_path: String,
    project_id: Option<String>,
) -> AppResult<String> {
    info!("=== 开始提取音频 ===");
    info!("视频路径: {}", video_path);
    info!("输出路径: {}", output_path);

    // 检查视频文件是否存在
    if !Path::new(&video_path).exists() {
        error!("视频文件不存在: {}", video_path);
        return Err(AppError::NotFound(format!("视频文件不存在: {}", video_path)));
    }

    let project_id_clone = project_id.clone();
    let _ = window.emit("extract-progress", serde_json::json!({
        "progress": 0.0,
        "message": "开始提取音频...",
        "project_id": project_id
    }));

    ffmpeg::extract_audio_track(
        &video_path,
        &output_path,
        Some(Box::new(move |progress| {
            let _ = window.emit("extract-progress", serde_json::json!({
                "progress": progress,
                "message": format!("提取中: {:.1}%", progress * 100.0),
                "project_id": project_id_clone
            }));
        })),
    )?;

    info!("音频提取完成: {}", output_path);
    Ok(output_path)
}

/// 人声分离
#[tauri::command]
pub async fn separate_vocals(
    window: Window,
    audio_path: String,
    output_dir: String,
    acceleration: Option<String>,
    project_id: Option<String>,
) -> AppResult<SeparationResult> {
    info!("=== 开始人声分离命令 ===");
    info!("音频路径: {}", audio_path);
    info!("输出目录: {}", output_dir);
    info!("加速选项: {:?}", acceleration);

    // 获取项目取消标志，如果没有 project_id 则使用默认标识
    let cancel_flag_id = project_id.clone().unwrap_or_else(|| "default".to_string());
    let _guard = CancelFlagGuard::new(cancel_flag_id.clone());
    let cancel_flag = reset_cancel_flag(&cancel_flag_id);

    let config = config::get_config();

    // 确定加速模式（默认 GPU）
    let accel_mode = match acceleration.as_deref() {
        Some("cpu") => AccelerationMode::Cpu,
        Some("gpu") | Some("auto") | Some("hybrid") | _ => AccelerationMode::Gpu,
    };

    // 检测 GPU 能力
    let gpu_caps = detect_gpu_capabilities();
    info!("GPU 能力检测: ONNX_GPU={}", gpu_caps.onnx_gpu_available);

    let _ = window.emit("separation-progress", serde_json::json!({
        "progress": 0.0,
        "message": "开始人声分离...",
        "acceleration": format!("{:?}", accel_mode),
        "project_id": project_id
    }));

    let window_clone = window.clone();
    let project_id_clone = project_id.clone();
    let result = separator::separate_vocals(
        &audio_path,
        &output_dir,
        &config.separation,
        &config.detected_gpu,
        &accel_mode,
        &gpu_caps,
        Some(Box::new(move |progress, message| {
            let _ = window_clone.emit("separation-progress", serde_json::json!({
                "progress": progress,
                "message": message,
                "project_id": project_id_clone
            }));
        })),
        cancel_flag,
        &cancel_flag_id,
    )?;

    let _ = window.emit("separation-complete", serde_json::json!({
        "vocals_path": result.vocals_path,
        "accompaniment_path": result.accompaniment_path,
        "project_id": project_id
    }));

    Ok(result)
}

/// 匹配视频片段
#[tauri::command]
pub async fn match_video_segments(
    window: Window,
    accompaniment_path: String,
    project_id: String,
    min_confidence: Option<f64>,
    music_ids: Option<Vec<String>>,
) -> AppResult<Vec<Segment>> {
    let _guard = CancelFlagGuard::new(project_id.clone());
    let cancel_flag = reset_cancel_flag(&project_id);

    let config = config::get_config();
    let min_conf = min_confidence.unwrap_or(config.matching.min_confidence as f64);
    let window_size = config.matching.window_size as f64;
    let hop_size = config.matching.hop_size as f64;
    let min_duration = config.matching.min_segment_duration as f64;
    let max_gap_duration = config.matching.max_gap_duration as f64;

    // 验证参数，防止除零错误
    if hop_size <= 0.0 {
        return Err(AppError::Config("滑动步长必须大于0".to_string()));
    }
    if window_size <= 0.0 {
        return Err(AppError::Config("窗口大小必须大于0".to_string()));
    }

    let _ = window.emit("matching-progress", serde_json::json!({
        "progress": 0.0,
        "message": "开始匹配音频片段...",
        "project_id": project_id
    }));

    // 获取音频时长
    let audio_info = ffmpeg::get_audio_duration(&accompaniment_path)?;
    let total_duration = audio_info;

    // 边界检查：视频时长必须大于窗口大小才能进行匹配
    if total_duration < window_size {
        let msg = format!(
            "视频时长 ({:.1}s) 小于最小匹配时长 ({:.1}s)，无法进行识别",
            total_duration, window_size
        );
        info!("{}", msg);
        return Err(AppError::InvalidArgument(msg));
    }

    // 获取音乐库指纹（支持自定义音乐列表）
    let library = match &music_ids {
        Some(ids) if !ids.is_empty() => {
            info!("使用自定义音乐库: {} 首音乐, ID 列表: {:?}", ids.len(), ids);
            database::get_fingerprints_by_ids(ids)?
        }
        _ => {
            info!("使用全部音乐库");
            database::get_all_fingerprints()?
        }
    };
    info!("音乐库加载完成: 共 {} 首音乐", library.len());
    if library.is_empty() {
        return Err(AppError::NotFound("音乐库为空，请先导入音乐".to_string()));
    }

    // 清除该项目的旧匹配结果，避免重复匹配时结果累加
    database::delete_segments_by_project(&project_id)?;

    let temp_dir = tempfile::tempdir()?;
    let total_windows = ((total_duration - window_size) / hop_size).ceil() as usize + 1;

    // 生成所有窗口时间点
    let window_times: Vec<(usize, f64)> = (0..total_windows)
        .map(|i| (i, i as f64 * hop_size))
        .filter(|(_, t)| *t + window_size <= total_duration)
        .collect();

    let actual_windows = window_times.len();
    info!("开始并行匹配: {} 个窗口", actual_windows);

    // 进度计数器
    let processed_count = Arc::new(AtomicUsize::new(0));
    let window_for_progress = window.clone();
    let project_id_for_progress = project_id.clone();

    // 并行处理每个窗口（限制线程数，预留 CPU 给 tokio 和 UI 响应）
    let library_arc = Arc::new(library);
    let temp_path = temp_dir.path().to_path_buf();
    let accompaniment_path_arc = Arc::new(accompaniment_path.clone());

    let num_threads = num_cpus::get().saturating_sub(2).max(1);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(num_threads)
        .build()
        .map_err(|e| AppError::Config(format!("创建线程池失败: {}", e)))?;

    let window_results: Vec<Option<(usize, String, String, f64)>> = pool.install(|| {
        window_times
        .par_iter()
        .map(|(window_index, current_time)| {
            // 检查取消标志
            if cancel_flag.load(Ordering::SeqCst) {
                return None;
            }

            // 提取窗口音频
            let window_path = temp_path.join(format!("window_{}.wav", window_index));
            if ffmpeg::extract_audio_segment(
                &accompaniment_path_arc,
                window_path.to_str().unwrap(),
                *current_time,
                window_size,
            ).is_err() {
                return None;
            }

            // 提取指纹并匹配
            let result = if let Ok((fp_data, _)) = fingerprint::extract_fingerprint_from_file(window_path.to_str().unwrap()) {
                // 并行遍历音乐库，找到最佳匹配
                let best_match = library_arc.par_iter()
                    .map(|(music_id, music_title, music_fp)| {
                        let confidence = fingerprint::compare_fingerprints(&fp_data, music_fp);
                        (music_id, music_title, confidence)
                    })
                    .filter(|(_, _, conf)| *conf >= min_conf)
                    .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|(id, title, conf)| (id.clone(), title.clone(), conf));

                best_match.map(|(id, title, conf)| (*window_index, id, title, conf))
            } else {
                None
            };

            // 清理临时文件
            let _ = std::fs::remove_file(&window_path);

            // 更新进度
            let count = processed_count.fetch_add(1, Ordering::SeqCst) + 1;
            if count % 10 == 0 || count == actual_windows {
                let progress = count as f64 / actual_windows as f64;
                let _ = window_for_progress.emit("matching-progress", serde_json::json!({
                    "progress": progress,
                    "message": format!("匹配中: {:.1}%", progress * 100.0),
                    "project_id": project_id_for_progress
                }));
            }

            result
        })
        .collect()
    });

    // 检查是否被取消
    if cancel_flag.load(Ordering::SeqCst) {
        return Err(AppError::Cancelled);
    }

    // 按窗口索引排序结果
    let mut sorted_results: Vec<(usize, String, String, f64)> = window_results
        .into_iter()
        .flatten()
        .collect();
    sorted_results.sort_by_key(|(idx, _, _, _)| *idx);

    // 顺序合并为片段
    let mut segments: Vec<Segment> = Vec::new();
    // (music_id, title, start_time, confidence, last_window_index)
    let mut current_match: Option<(String, String, f64, f64, usize)> = None;

    for (window_index, music_id, music_title, confidence) in sorted_results {
        let current_time = window_index as f64 * hop_size;

        match &current_match {
            None => {
                // 开始新的匹配片段
                current_match = Some((music_id, music_title, current_time, confidence, window_index));
            }
            Some((curr_id, curr_title, start, conf, last_idx)) if curr_id == &music_id => {
                // 检查时间连续性：计算与上一个匹配窗口的实际间隙
                // 间隙 = 当前窗口开始时间 - 上一个窗口结束时间
                let last_end_time = *last_idx as f64 * hop_size + window_size;
                let gap = current_time - last_end_time;

                if gap <= max_gap_duration {
                    // 间隙在允许范围内（包括重叠的情况，gap <= 0），继续合并当前片段
                    current_match = Some((curr_id.clone(), curr_title.clone(), *start, confidence.max(*conf), window_index));
                } else {
                    // 间隙过大，结束当前片段，开始新片段
                    let end_time = *last_idx as f64 * hop_size + window_size;
                    if end_time - start >= min_duration {
                        segments.push(Segment {
                            id: generate_id(),
                            project_id: project_id.clone(),
                            music_id: Some(curr_id.clone()),
                            music_title: Some(curr_title.clone()),
                            start_time: *start,
                            end_time: end_time.min(total_duration),
                            confidence: *conf,
                            status: SegmentStatus::Detected,
                        });
                    }
                    // 开始新的匹配片段
                    current_match = Some((music_id, music_title, current_time, confidence, window_index));
                }
            }
            Some((curr_id, curr_title, start, conf, last_idx)) => {
                // 不同歌曲，结束当前匹配片段
                let end_time = *last_idx as f64 * hop_size + window_size;
                if end_time - start >= min_duration {
                    segments.push(Segment {
                        id: generate_id(),
                        project_id: project_id.clone(),
                        music_id: Some(curr_id.clone()),
                        music_title: Some(curr_title.clone()),
                        start_time: *start,
                        end_time: end_time.min(total_duration),
                        confidence: *conf,
                        status: SegmentStatus::Detected,
                    });
                }
                // 开始新的匹配
                current_match = Some((music_id, music_title, current_time, confidence, window_index));
            }
        }
    }

    // 处理最后一个匹配片段
    if let Some((music_id, music_title, start, conf, last_idx)) = current_match {
        let end_time = last_idx as f64 * hop_size + window_size;
        if end_time - start >= min_duration {
            segments.push(Segment {
                id: generate_id(),
                project_id: project_id.clone(),
                music_id: Some(music_id),
                music_title: Some(music_title),
                start_time: start,
                end_time: end_time.min(total_duration),
                confidence: conf,
                status: SegmentStatus::Detected,
            });
        }
    }

    // 保存片段到数据库（事务批量插入，只获取一次锁）
    database::batch_insert_segments(&segments)?;

    // 发送完成进度（确保前端收到 100%）
    let _ = window.emit("matching-progress", serde_json::json!({
        "progress": 1.0,
        "message": "匹配完成",
        "segments_found": segments.len(),
        "project_id": project_id
    }));

    let _ = window.emit("matching-complete", serde_json::json!({
        "segments": segments.len(),
        "project_id": project_id
    }));

    Ok(segments)
}

/// 剪辑视频（重编码模式）
#[tauri::command]
pub async fn cut_video(
    window: Window,
    params: CutParams,
) -> AppResult<String> {
    let _guard = CancelFlagGuard::new(params.project_id.clone());
    let cancel_flag = reset_cancel_flag(&params.project_id);

    let project = database::get_project_by_id(&params.project_id)?
        .ok_or_else(|| AppError::NotFound("项目不存在".to_string()))?;

    info!("=== 开始剪辑视频（重编码模式）===");
    info!("[CUT] 项目ID: {}", params.project_id);
    info!("[CUT] 源视频: {}", project.source_video_path);
    info!("[CUT] 输出路径: {}", params.output_path);
    info!("[CUT] 保留匹配片段: {}", params.keep_matched);

    let _ = window.emit("cut-progress", serde_json::json!({
        "progress": 0.0,
        "message": "开始剪辑视频...",
        "project_id": params.project_id
    }));

    let window_clone = window.clone();
    let project_id_clone = params.project_id.clone();
    ffmpeg::cut_video_segments(
        &project.source_video_path,
        &params.output_path,
        &project.segments,
        params.keep_matched,
        Some(Box::new(move |progress| {
            let _ = window_clone.emit("cut-progress", serde_json::json!({
                "progress": progress,
                "message": format!("剪辑中: {:.1}%", progress * 100.0),
                "project_id": project_id_clone
            }));
        })),
        cancel_flag,
        &params.project_id,
    )?;

    info!("[CUT] 剪辑完成: {}", params.output_path);

    let _ = window.emit("cut-complete", serde_json::json!({
        "output_path": params.output_path,
        "project_id": params.project_id
    }));

    Ok(params.output_path)
}

/// 导出视频（重编码模式）
#[tauri::command]
pub async fn export_video(
    window: Window,
    project_id: String,
    output_path: String,
) -> AppResult<String> {
    let _guard = CancelFlagGuard::new(project_id.clone());
    let cancel_flag = reset_cancel_flag(&project_id);

    let project = database::get_project_by_id(&project_id)?
        .ok_or_else(|| AppError::NotFound("项目不存在".to_string()))?;

    // 检查源视频文件是否存在
    if !Path::new(&project.source_video_path).exists() {
        error!("[EXPORT] 源视频文件不存在: {}", project.source_video_path);
        return Err(AppError::NotFound(format!("源视频文件不存在: {}", project.source_video_path)));
    }

    info!("=== 开始导出视频（重编码模式）===");
    info!("[EXPORT] 项目ID: {}", project_id);
    info!("[EXPORT] 源视频: {}", project.source_video_path);
    info!("[EXPORT] 输出路径: {}", output_path);

    let _ = window.emit("export-progress", serde_json::json!({
        "progress": 0.0,
        "message": "开始导出视频...",
        "project_id": project_id
    }));

    let window_clone = window.clone();
    let project_id_clone = project_id.clone();
    if let Err(e) = ffmpeg::export_video(
        &project.source_video_path,
        &output_path,
        &project.segments,
        Some(Box::new(move |progress| {
            let _ = window_clone.emit("export-progress", serde_json::json!({
                "progress": progress,
                "message": format!("导出中: {:.1}%", progress * 100.0),
                "project_id": project_id_clone
            }));
        })),
        cancel_flag,
        &project_id,
    ) {
        error!("[EXPORT] 导出失败: {}", e);
        return Err(e);
    }

    info!("[EXPORT] 导出完成: {}", output_path);

    let _ = window.emit("export-complete", serde_json::json!({
        "output_path": output_path,
        "project_id": project_id
    }));

    Ok(output_path)
}

/// 分别导出视频片段（每个片段单独导出）
#[tauri::command]
pub async fn export_video_separately(
    window: Window,
    project_id: String,
    output_dir: String,
) -> AppResult<serde_json::Value> {
    let _guard = CancelFlagGuard::new(project_id.clone());
    let cancel_flag = reset_cancel_flag(&project_id);

    let project = database::get_project_by_id(&project_id)?
        .ok_or_else(|| AppError::NotFound("项目不存在".to_string()))?;

    // 检查源视频文件是否存在
    if !Path::new(&project.source_video_path).exists() {
        error!("[EXPORT_SEP] 源视频文件不存在: {}", project.source_video_path);
        return Err(AppError::NotFound(format!("源视频文件不存在: {}", project.source_video_path)));
    }

    info!("=== 开始分别导出视频片段 ===");
    info!("[EXPORT_SEP] 项目ID: {}", project_id);
    info!("[EXPORT_SEP] 源视频: {}", project.source_video_path);
    info!("[EXPORT_SEP] 输出目录: {}", output_dir);

    let _ = window.emit("export-progress", serde_json::json!({
        "progress": 0.0,
        "message": "开始分别导出视频片段...",
        "project_id": project_id
    }));

    let window_clone = window.clone();
    let project_id_clone = project_id.clone();
    let output_files = match ffmpeg::export_video_separately(
        &project.source_video_path,
        &output_dir,
        &project.segments,
        Some(Box::new(move |progress| {
            let _ = window_clone.emit("export-progress", serde_json::json!({
                "progress": progress,
                "message": format!("导出中: {:.1}%", progress * 100.0),
                "project_id": project_id_clone
            }));
        })),
        cancel_flag,
        &project_id,
    ) {
        Ok(files) => files,
        Err(e) => {
            error!("[EXPORT_SEP] 导出失败: {}", e);
            return Err(e);
        }
    };

    info!("[EXPORT_SEP] 导出完成，共 {} 个文件", output_files.len());

    let _ = window.emit("export-complete", serde_json::json!({
        "output_dir": output_dir,
        "exported_count": output_files.len(),
        "project_id": project_id
    }));

    Ok(serde_json::json!({
        "exported_count": output_files.len(),
        "output_files": output_files
    }))
}

/// 导出自定义剪辑片段
#[tauri::command]
pub async fn export_custom_clip(
    window: Window,
    project_id: String,
    start_time: f64,
    end_time: f64,
    output_path: String,
) -> AppResult<String> {
    let _guard = CancelFlagGuard::new(project_id.clone());
    let cancel_flag = reset_cancel_flag(&project_id);

    let project = database::get_project_by_id(&project_id)?
        .ok_or_else(|| AppError::NotFound("项目不存在".to_string()))?;

    // 检查源视频文件是否存在
    if !Path::new(&project.source_video_path).exists() {
        error!("[EXPORT_CUSTOM] 源视频文件不存在: {}", project.source_video_path);
        return Err(AppError::NotFound(format!("源视频文件不存在: {}", project.source_video_path)));
    }

    // 验证时间范围
    if start_time < 0.0 {
        return Err(AppError::InvalidArgument("开始时间不能为负数".to_string()));
    }
    if end_time <= start_time {
        return Err(AppError::InvalidArgument("结束时间必须大于开始时间".to_string()));
    }

    let duration = end_time - start_time;
    info!("=== 开始导出自定义剪辑片段 ===");
    info!("[EXPORT_CUSTOM] 项目ID: {}", project_id);
    info!("[EXPORT_CUSTOM] 源视频: {}", project.source_video_path);
    info!("[EXPORT_CUSTOM] 时间范围: {:.3}s - {:.3}s (时长: {:.3}s)", start_time, end_time, duration);
    info!("[EXPORT_CUSTOM] 输出路径: {}", output_path);

    let _ = window.emit("export-progress", serde_json::json!({
        "progress": 0.0,
        "message": "开始导出自定义剪辑...",
        "project_id": project_id
    }));

    let window_clone = window.clone();
    let project_id_clone = project_id.clone();

    // 使用 ffmpeg 导出指定时间范围的视频
    if let Err(e) = ffmpeg::export_custom_segment(
        &project.source_video_path,
        &output_path,
        start_time,
        end_time,
        Some(Box::new(move |progress| {
            let _ = window_clone.emit("export-progress", serde_json::json!({
                "progress": progress,
                "message": format!("导出中: {:.1}%", progress * 100.0),
                "project_id": project_id_clone
            }));
        })),
        cancel_flag,
        &project_id,
    ) {
        error!("[EXPORT_CUSTOM] 导出失败: {}", e);
        return Err(e);
    }

    info!("[EXPORT_CUSTOM] 导出完成: {}", output_path);

    let _ = window.emit("export-complete", serde_json::json!({
        "output_path": output_path,
        "project_id": project_id
    }));

    Ok(output_path)
}

/// 自定义剪辑时间范围（前端传入）
#[derive(Debug, Clone, serde::Deserialize)]
pub struct CustomClipRange {
    pub start_time: f64,
    pub end_time: f64,
}

/// 合并导出多个自定义剪辑片段
#[tauri::command]
pub async fn export_custom_clips_merged(
    window: Window,
    project_id: String,
    segments: Vec<CustomClipRange>,
    output_path: String,
) -> AppResult<String> {
    let _guard = CancelFlagGuard::new(project_id.clone());
    let cancel_flag = reset_cancel_flag(&project_id);

    let project = database::get_project_by_id(&project_id)?
        .ok_or_else(|| AppError::NotFound("项目不存在".to_string()))?;

    if !Path::new(&project.source_video_path).exists() {
        error!("[EXPORT_CUSTOM_MERGED] 源视频文件不存在: {}", project.source_video_path);
        return Err(AppError::NotFound(format!("源视频文件不存在: {}", project.source_video_path)));
    }

    if segments.is_empty() {
        return Err(AppError::InvalidArgument("没有剪辑片段".to_string()));
    }

    // 验证并转换片段
    let mut time_ranges: Vec<(f64, f64)> = Vec::with_capacity(segments.len());
    for (i, seg) in segments.iter().enumerate() {
        if seg.start_time < 0.0 {
            return Err(AppError::InvalidArgument(format!("片段 {} 开始时间不能为负数", i + 1)));
        }
        if seg.end_time <= seg.start_time {
            return Err(AppError::InvalidArgument(format!("片段 {} 结束时间必须大于开始时间", i + 1)));
        }
        time_ranges.push((seg.start_time, seg.end_time));
    }

    // 按开始时间排序
    time_ranges.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    // 合并重叠片段
    let merged = ffmpeg::merge_overlapping_segments(&time_ranges);

    info!("=== 开始合并导出自定义剪辑片段 ===");
    info!("[EXPORT_CUSTOM_MERGED] 项目ID: {}", project_id);
    info!("[EXPORT_CUSTOM_MERGED] 源视频: {}", project.source_video_path);
    info!("[EXPORT_CUSTOM_MERGED] 片段数: {} (合并后: {})", segments.len(), merged.len());
    info!("[EXPORT_CUSTOM_MERGED] 输出路径: {}", output_path);

    let _ = window.emit("export-progress", serde_json::json!({
        "progress": 0.0,
        "message": "开始合并导出自定义剪辑...",
        "project_id": project_id
    }));

    // 确保输出目录存在
    if let Some(parent) = Path::new(&output_path).parent() {
        std::fs::create_dir_all(parent)?;
    }

    let window_clone = window.clone();
    let project_id_clone = project_id.clone();

    if let Err(e) = ffmpeg::smart_concat_segments(
        &project.source_video_path,
        &output_path,
        &merged,
        Some(Box::new(move |progress| {
            let _ = window_clone.emit("export-progress", serde_json::json!({
                "progress": progress,
                "message": format!("导出中: {:.1}%", progress * 100.0),
                "project_id": project_id_clone
            }));
        })),
        cancel_flag,
        &project_id,
        true,
    ) {
        error!("[EXPORT_CUSTOM_MERGED] 导出失败: {}", e);
        return Err(e);
    }

    info!("[EXPORT_CUSTOM_MERGED] 导出完成: {}", output_path);

    let _ = window.emit("export-complete", serde_json::json!({
        "output_path": output_path,
        "project_id": project_id
    }));

    Ok(output_path)
}

/// 分别导出多个自定义剪辑片段
#[tauri::command]
pub async fn export_custom_clips_separately(
    window: Window,
    project_id: String,
    segments: Vec<CustomClipRange>,
    output_dir: String,
) -> AppResult<serde_json::Value> {
    let _guard = CancelFlagGuard::new(project_id.clone());
    let cancel_flag = reset_cancel_flag(&project_id);
    let internal_cancel = Arc::new(AtomicBool::new(false));

    let project = database::get_project_by_id(&project_id)?
        .ok_or_else(|| AppError::NotFound("项目不存在".to_string()))?;

    if !Path::new(&project.source_video_path).exists() {
        error!("[EXPORT_CUSTOM_SEP] 源视频文件不存在: {}", project.source_video_path);
        return Err(AppError::NotFound(format!("源视频文件不存在: {}", project.source_video_path)));
    }

    if segments.is_empty() {
        return Err(AppError::InvalidArgument("没有剪辑片段".to_string()));
    }

    // 验证片段
    for (i, seg) in segments.iter().enumerate() {
        if seg.start_time < 0.0 {
            return Err(AppError::InvalidArgument(format!("片段 {} 开始时间不能为负数", i + 1)));
        }
        if seg.end_time <= seg.start_time {
            return Err(AppError::InvalidArgument(format!("片段 {} 结束时间必须大于开始时间", i + 1)));
        }
    }

    let total_segments = segments.len();

    info!("=== 开始分别导出自定义剪辑片段 ===");
    info!("[EXPORT_CUSTOM_SEP] 项目ID: {}", project_id);
    info!("[EXPORT_CUSTOM_SEP] 源视频: {}", project.source_video_path);
    info!("[EXPORT_CUSTOM_SEP] 片段数: {}", total_segments);
    info!("[EXPORT_CUSTOM_SEP] 输出目录: {}", output_dir);

    let _ = window.emit("export-progress", serde_json::json!({
        "progress": 0.0,
        "message": "开始分别导出自定义剪辑片段...",
        "project_id": project_id
    }));

    std::fs::create_dir_all(&output_dir)?;

    // 获取源视频文件名
    let source_stem = Path::new(&project.source_video_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let safe_source_name: String = source_stem
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect::<String>()
        .chars()
        .take(30)
        .collect();
    let source_ext = Path::new(&project.source_video_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp4");

    let format_time = |seconds: f64| -> String {
        let total_secs = seconds as u32;
        let mins = total_secs / 60;
        let secs = total_secs % 60;
        format!("{:02}m{:02}s", mins, secs)
    };

    // 生成任务列表
    let tasks: Vec<(usize, f64, f64, String)> = segments
        .iter()
        .enumerate()
        .map(|(i, seg)| {
            let output_filename = format!(
                "{}_clip_{:03}_{}_{}.{}",
                safe_source_name,
                i + 1,
                format_time(seg.start_time),
                format_time(seg.end_time),
                source_ext
            );
            let output_path = Path::new(&output_dir).join(&output_filename);
            (i, seg.start_time, seg.end_time, output_path.to_string_lossy().to_string())
        })
        .collect();

    // 并行导出
    let num_cpus = num_cpus::get();
    let parallel_count = (num_cpus).max(1).min(8);
    let completed_count = Arc::new(AtomicUsize::new(0));
    let max_progress = Arc::new(Mutex::new(0.0f32));

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(parallel_count)
        .build()
        .map_err(|e| AppError::Video(format!("创建线程池失败: {}", e)))?;

    let window_clone = window.clone();
    let project_id_clone = project_id.clone();
    let max_progress_clone = Arc::clone(&max_progress);

    let results: Vec<Result<String, AppError>> = pool.install(|| {
        tasks
            .par_iter()
            .map(|(i, start_time, end_time, output_path_str)| {
                if cancel_flag.load(Ordering::SeqCst) {
                    internal_cancel.store(true, Ordering::SeqCst);
                }
                if internal_cancel.load(Ordering::SeqCst) {
                    return Err(AppError::Cancelled);
                }

                info!(
                    "[EXPORT_CUSTOM_SEP] 导出片段 {}/{}: {:.2}s - {:.2}s",
                    i + 1, total_segments, start_time, end_time
                );

                match ffmpeg::smart_cut_segment(
                    &project.source_video_path,
                    output_path_str,
                    *start_time,
                    *end_time,
                    &[&cancel_flag, &internal_cancel],
                    &project_id_clone,
                    true,
                ) {
                    Ok(()) => {
                        let completed = completed_count.fetch_add(1, Ordering::SeqCst) + 1;
                        let new_progress = completed as f32 / total_segments as f32;
                        let mut max_prog = max_progress_clone.lock().unwrap();
                        if new_progress > *max_prog {
                            *max_prog = new_progress;
                            let _ = window_clone.emit("export-progress", serde_json::json!({
                                "progress": new_progress,
                                "message": format!("导出中: {}/{}", completed, total_segments),
                                "project_id": project_id_clone
                            }));
                        }
                        Ok(output_path_str.clone())
                    }
                    Err(e) => {
                        error!(
                            "[EXPORT_CUSTOM_SEP] 片段 {} ({:.2}s - {:.2}s) 导出失败: {}",
                            i + 1, start_time, end_time, e
                        );
                        internal_cancel.store(true, Ordering::SeqCst);
                        Err(e)
                    }
                }
            })
            .collect()
    });

    // 收集结果
    let mut output_files: Vec<String> = Vec::with_capacity(total_segments);
    let mut first_error: Option<AppError> = None;
    for result in results {
        match result {
            Ok(path) => output_files.push(path),
            Err(AppError::Cancelled) => {
                if first_error.is_none() {
                    first_error = Some(AppError::Cancelled);
                }
            }
            Err(e) => {
                if first_error.is_none() || matches!(first_error, Some(AppError::Cancelled)) {
                    first_error = Some(e);
                }
            }
        }
    }

    if let Some(e) = first_error {
        if !output_files.is_empty() {
            info!("[EXPORT_CUSTOM_SEP] 导出失败，清理 {} 个已导出的文件", output_files.len());
            for path in &output_files {
                let _ = std::fs::remove_file(path);
            }
        }
        return Err(e);
    }

    info!("[EXPORT_CUSTOM_SEP] 导出完成，共 {} 个文件", output_files.len());

    let _ = window.emit("export-complete", serde_json::json!({
        "output_dir": output_dir,
        "exported_count": output_files.len(),
        "project_id": project_id
    }));

    Ok(serde_json::json!({
        "exported_count": output_files.len(),
        "output_files": output_files
    }))
}
#[tauri::command]
pub async fn get_video_thumbnail(
    video_path: String,
    output_path: String,
    time: Option<f64>,
) -> AppResult<String> {
    info!(
        "thumbnail request: video_path={}, output_path={}, time={:?}",
        video_path, output_path, time
    );

    // 检查缩略图是否已存在，如果存在则直接返回
    let output_file = Path::new(&output_path);
    if output_file.exists() {
        info!("thumbnail already exists, skipping generation: {}", output_path);
        return Ok(output_path);
    }

    let timestamp = time.unwrap_or(0.0);
    info!("thumbnail timestamp resolved: {}", timestamp);
    if !Path::new(&video_path).exists() {
        info!("thumbnail video missing: {}", video_path);
    }
    if let Some(parent) = output_file.parent() {
        info!(
            "thumbnail output dir: {:?}, exists={}",
            parent,
            parent.exists()
        );
    }

    if let Err(e) = ffmpeg::extract_thumbnail(&video_path, &output_path, timestamp) {
        error!("thumbnail failed: {}", e);
        return Err(e);
    }
    info!("thumbnail generated: {}", output_path);
    Ok(output_path)
}

/// 检测视频是否需要转码预览
#[tauri::command]
pub async fn check_needs_preview(video_path: String) -> AppResult<bool> {
    info!("检测视频是否需要预览转码: {}", video_path);

    if !Path::new(&video_path).exists() {
        return Err(AppError::NotFound(format!("视频文件不存在: {}", video_path)));
    }

    let video_info = ffmpeg::get_video_info(&video_path)?;
    let needs_preview = ffmpeg::needs_preview_transcode(&video_info);

    info!(
        "视频格式检测结果: format={}, codec={}, needs_preview={}",
        video_info.format, video_info.video_codec, needs_preview
    );

    Ok(needs_preview)
}

/// 生成预览视频
#[tauri::command]
pub async fn generate_preview_video(
    window: Window,
    source_path: String,
    output_path: String,
    project_id: Option<String>,
) -> AppResult<String> {
    info!("=== 开始生成预览视频 ===");
    info!("源视频: {}", source_path);
    info!("输出路径: {}", output_path);

    if !Path::new(&source_path).exists() {
        return Err(AppError::NotFound(format!("源视频文件不存在: {}", source_path)));
    }

    // 如果预览文件已存在，直接返回
    if Path::new(&output_path).exists() {
        info!("预览视频已存在，跳过生成: {}", output_path);
        return Ok(output_path);
    }

    // 获取预览任务专用的取消标志（使用 preview_ 前缀区分）
    let cancel_flag_id = format!("preview_{}", project_id.clone().unwrap_or_else(|| "default".to_string()));
    let _guard = CancelFlagGuard::new(cancel_flag_id.clone());
    let cancel_flag = reset_cancel_flag(&cancel_flag_id);

    let _ = window.emit("preview-progress", serde_json::json!({
        "progress": 0.0,
        "message": "开始生成预览视频...",
        "project_id": project_id
    }));

    let window_clone = window.clone();
    let project_id_clone = project_id.clone();

    ffmpeg::generate_preview_video(
        &source_path,
        &output_path,
        Some(Box::new(move |progress| {
            let _ = window_clone.emit("preview-progress", serde_json::json!({
                "progress": progress,
                "message": format!("生成预览: {:.1}%", progress * 100.0),
                "project_id": project_id_clone
            }));
        })),
        cancel_flag,
        &cancel_flag_id,
    )?;

    let _ = window.emit("preview-complete", serde_json::json!({
        "output_path": output_path,
        "project_id": project_id
    }));

    info!("预览视频生成完成: {}", output_path);
    Ok(output_path)
}

/// 取消处理（指定项目）
#[tauri::command]
pub async fn cancel_processing(project_id: Option<String>) -> AppResult<()> {
    let flag_id = project_id.unwrap_or_else(|| "default".to_string());

    // 1. 设置取消标志（保留，用于非进程检查点）
    let flag = get_cancel_flag(&flag_id);
    flag.store(true, Ordering::SeqCst);

    // 2. 立即 kill 所有子进程，实现即时取消
    kill_child_processes(&flag_id);

    info!("取消处理请求: project_id={}, 已终止所有子进程", flag_id);
    Ok(())
}

/// 取消预览视频生成（仅取消预览任务，不影响其他处理任务）
#[tauri::command]
pub async fn cancel_preview_generation(project_id: Option<String>) -> AppResult<()> {
    let flag_id = format!("preview_{}", project_id.unwrap_or_else(|| "default".to_string()));

    // 1. 设置取消标志
    let flag = get_cancel_flag(&flag_id);
    flag.store(true, Ordering::SeqCst);

    // 2. 立即 kill 预览生成的子进程
    kill_child_processes(&flag_id);

    info!("取消预览生成请求: flag_id={}, 已终止预览生成进程", flag_id);
    Ok(())
}

/// 检测 GPU 能力（使用缓存，整个应用生命周期只检测一次）
pub fn detect_gpu_capabilities() -> GpuCapabilities {
    GPU_CAPS_CACHE.get_or_init(|| {
        info!("首次检测 GPU 能力...");
        let onnx_gpu_available = check_onnx_gpu();
        info!("GPU 能力检测完成: ONNX_GPU={}", onnx_gpu_available);
        GpuCapabilities {
            onnx_gpu_available,
        }
    }).clone()
}

/// 异步预检测 GPU 能力（应用启动时调用，避免阻塞用户操作）
pub fn preload_gpu_capabilities() {
    std::thread::spawn(|| {
        detect_gpu_capabilities();
    });
}

/// 检测 ONNX Runtime GPU 是否可用
/// 通过打包的 audio-separator 检测，不依赖系统 Python 环境
fn check_onnx_gpu() -> bool {
    let separator_path = separator::resolve_separator_path();
    info!("使用 audio-separator 检测 GPU: {}", separator_path);

    // 传递 --model_file_dir 到系统临时目录，避免 audio-separator 在默认路径
    // (/tmp/audio-separator-models/) 创建空文件夹
    let temp_dir = std::env::temp_dir();
    let output = hidden_command(&separator_path)
        .args(["-e", "--model_file_dir", &temp_dir.to_string_lossy()])
        .output();

    match output {
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // audio-separator -e 在 stderr 输出环境信息
            // 检查是否包含 GPU 加速相关的关键字
            let has_cuda = stderr.contains("CUDAExecutionProvider");
            let has_dml = stderr.contains("DmlExecutionProvider");
            let has_tensorrt = stderr.contains("TensorrtExecutionProvider");
            let result = has_cuda || has_dml || has_tensorrt;
            info!("audio-separator GPU 检测: CUDA={}, DML={}, TensorRT={}", has_cuda, has_dml, has_tensorrt);
            result
        }
        Err(e) => {
            info!("audio-separator 检测失败，回退到系统 Python 检测: {}", e);
            // 回退：尝试系统 Python（兼容开发环境）
            check_onnx_gpu_via_python()
        }
    }
}

/// 通过系统 Python 检测 ONNX Runtime GPU（开发环境回退方案）
fn check_onnx_gpu_via_python() -> bool {
    let output = hidden_command("python")
        .args([
            "-c",
            r#"
import onnxruntime as ort
providers = ort.get_available_providers()
has_gpu = 'CUDAExecutionProvider' in providers or 'TensorrtExecutionProvider' in providers or 'DmlExecutionProvider' in providers
print('onnx_gpu_ok' if has_gpu else 'onnx_gpu_no')
"#,
        ])
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.lines().any(|line| line.trim() == "onnx_gpu_ok")
        }
        _ => false,
    }
}
