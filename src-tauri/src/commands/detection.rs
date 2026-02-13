// 人物检测命令
//
// 与人声分离 pipeline 完全独立：
// - 独立的 GPU 信号量 (DETECTION_GPU_SEMAPHORE)
// - 独立的取消标志 (det_{project_id} 前缀)
// - 独立的事件通道 (detection-queued / detection-progress / detection-complete)

use crate::config::{self, AccelerationMode};
use crate::database;
use crate::error::{AppError, AppResult};
use crate::utils::{Segment, SegmentStatus, SegmentType, generate_id};
use crate::detection::detector;
use crate::commands::video::{CancelFlagGuard, get_cancel_flag, reset_cancel_flag, kill_child_processes};
use tauri::Window;
use std::sync::atomic::Ordering;
use tracing::info;

/// 独立的人物检测 GPU 信号量：与人声分离的 GPU_SEMAPHORE 完全隔离，
/// 允许检测和分离任务各自独立排队，互不阻塞
static DETECTION_GPU_SEMAPHORE: once_cell::sync::Lazy<tokio::sync::Semaphore> =
    once_cell::sync::Lazy::new(|| tokio::sync::Semaphore::new(1));

/// 执行人物检测
///
/// 流程：获取 GPU 许可 → 调用 person-detector → 清除旧片段 → 写入新片段 → 发送完成事件
///
/// 事件：
/// - `detection-queued`   — GPU 繁忙时通知前端排队
/// - `detection-progress`  — 检测进度 (progress: 0.0-1.0, message, project_id)
/// - `detection-complete`  — 检测完成统计 (segments_count, total_frames, ...)
#[tauri::command]
pub async fn detect_persons(
    window: Window,
    project_id: String,
    video_path: String,
    output_dir: String,
    acceleration: Option<String>,
) -> AppResult<Vec<Segment>> {
    info!("[DETECTION] === 开始人物检测 === project_id={}", project_id);
    info!("[DETECTION] 视频路径: {}", video_path);
    info!("[DETECTION] 输出目录: {}", output_dir);

    // 使用 det_ 前缀的取消标志，与人声分离完全隔离
    let cancel_flag_id = format!("det_{}", project_id);
    info!("[DETECTION] 取消标志ID: {}", cancel_flag_id);
    let _guard = CancelFlagGuard::new(cancel_flag_id.clone());
    let cancel_flag = reset_cancel_flag(&cancel_flag_id);

    // 独立的 GPU 信号量排队
    let _permit = match DETECTION_GPU_SEMAPHORE.try_acquire() {
        Ok(permit) => {
            info!("[DETECTION] 直接获取检测 GPU 许可: project_id={}", project_id);
            permit
        }
        Err(_) => {
            info!("[DETECTION] 检测 GPU 繁忙，排队等待: project_id={}", project_id);
            let _ = window.emit("detection-queued", serde_json::json!({
                "project_id": project_id,
                "message": "等待其他检测任务完成..."
            }));

            loop {
                tokio::select! {
                    result = DETECTION_GPU_SEMAPHORE.acquire() => {
                        match result {
                            Ok(permit) => {
                                info!("[DETECTION] 排队结束，获取许可: project_id={}", project_id);
                                break permit;
                            }
                            Err(_) => {
                                return Err(AppError::Detection("检测 GPU 信号量异常关闭".to_string()));
                            }
                        }
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => {
                        if cancel_flag.load(Ordering::SeqCst) {
                            info!("[DETECTION] 排队等待中被取消: project_id={}", project_id);
                            return Err(AppError::Cancelled);
                        }
                    }
                }
            }
        }
    };

    let app_config = config::get_config();
    let det_config = &app_config.detection;

    let accel_mode = match acceleration.as_deref() {
        Some("cpu") => AccelerationMode::Cpu,
        Some("gpu") | Some("auto") | Some("hybrid") | _ => AccelerationMode::Gpu,
    };
    info!("[DETECTION] 加速模式: {:?}", accel_mode);
    info!("[DETECTION] 检测配置: 置信度={}, 抽帧间隔={}, 最小片段={}s, 最大间隔={}s",
        det_config.confidence_threshold, det_config.frame_interval,
        det_config.min_segment_duration, det_config.max_gap_duration);

    // 通知前端开始检测
    let _ = window.emit("detection-progress", serde_json::json!({
        "progress": 0.0,
        "message": "开始人物检测...",
        "project_id": project_id
    }));

    // 调用 person-detector 核心检测逻辑
    let window_clone = window.clone();
    let project_id_clone = project_id.clone();
    let result = detector::detect_persons(
        &video_path,
        &output_dir,
        det_config,
        &accel_mode,
        Some(Box::new(move |progress, message| {
            let _ = window_clone.emit("detection-progress", serde_json::json!({
                "progress": progress,
                "message": message,
                "project_id": project_id_clone
            }));
        })),
        cancel_flag,
        &project_id,
    )?;

    // 清除该项目的所有旧片段（音乐匹配 + 人物检测），每次任务输出全新结果
    info!("[DETECTION] 清除所有旧片段: project_id={}", project_id);
    database::delete_segments_by_project(&project_id)?;

    // 将检测结果转换为 Segment 并批量写入数据库
    let segments: Vec<Segment> = result.segments.iter().map(|s| {
        Segment {
            id: generate_id(),
            project_id: project_id.clone(),
            music_id: None,
            music_title: None,
            start_time: s.start_time,
            end_time: s.end_time,
            confidence: s.confidence,
            status: SegmentStatus::Detected,
            segment_type: SegmentType::Person,
        }
    }).collect();

    info!("[DETECTION] 写入 {} 个 person 片段到数据库", segments.len());
    database::batch_insert_detection_segments(&segments, "person")?;

    // 通知前端检测完成
    let _ = window.emit("detection-complete", serde_json::json!({
        "project_id": project_id,
        "segments_count": segments.len(),
        "total_frames": result.total_frames,
        "processed_frames": result.processed_frames,
        "detection_frames": result.detection_frames,
    }));

    info!("[DETECTION] === 人物检测完成 === project_id={}, 片段数={}, 总帧数={}, 处理帧数={}, 检测帧数={}",
        project_id, segments.len(), result.total_frames, result.processed_frames, result.detection_frames);
    Ok(segments)
}

/// 取消人物检测
///
/// 设置取消标志并终止 person-detector 子进程，与人声分离的取消完全隔离
#[tauri::command]
pub async fn cancel_detection(project_id: String) -> AppResult<()> {
    let flag_id = format!("det_{}", project_id);
    info!("[DETECTION] 收到取消请求: project_id={}, flag_id={}", project_id, flag_id);

    let flag = get_cancel_flag(&flag_id);
    flag.store(true, Ordering::SeqCst);

    kill_child_processes(&flag_id);

    info!("[DETECTION] 取消标志已设置，子进程已终止: project_id={}", project_id);
    Ok(())
}
