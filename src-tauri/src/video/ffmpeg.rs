// FFmpeg 封装模块

use crate::error::{AppError, AppResult};
use crate::utils::{VideoInfo, Segment, SegmentStatus, resolve_tool_path, hidden_command};
use tracing::{error, info};
use std::process::Stdio;
use std::io::{BufRead, BufReader, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::path::Path;
use std::fs;
use regex::Regex;
use rayon::prelude::*;

// 静态正则表达式，避免重复编译
lazy_static::lazy_static! {
    static ref TIME_REGEX: Regex = Regex::new(r"out_time_ms=(\d+)").unwrap();
    // 缓存检测到的硬件编码器
    static ref HW_ENCODER_CACHE: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
}

/// 检测可用的 FFmpeg 硬件编码器
/// 优先级: NVENC (NVIDIA) > AMF (AMD) > QSV (Intel) > 软件编码
fn detect_hw_encoder() -> Option<String> {
    HW_ENCODER_CACHE.get_or_init(|| {
        let ffmpeg_path = resolve_tool_path("ffmpeg");

        // 按优先级检测硬件编码器
        let encoders = [
            ("h264_nvenc", "-init_hw_device", "cuda"),      // NVIDIA
            ("h264_amf", "-init_hw_device", "d3d11va"),     // AMD
            ("h264_qsv", "-init_hw_device", "qsv"),         // Intel
        ];

        for (encoder, hw_flag, hw_device) in encoders {
            // 尝试用该编码器编码一帧测试
            let result = hidden_command(&ffmpeg_path)
                .args([
                    "-f", "lavfi",
                    "-i", "nullsrc=s=256x256:d=0.1",
                    hw_flag, &format!("{}=hw", hw_device),
                    "-c:v", encoder,
                    "-frames:v", "1",
                    "-f", "null",
                    "-",
                ])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();

            if let Ok(status) = result {
                if status.success() {
                    info!("[FFMPEG] 检测到硬件编码器: {}", encoder);
                    return Some(encoder.to_string());
                }
            }
        }

        info!("[FFMPEG] 未检测到硬件编码器，将使用软件编码");
        None
    }).clone()
}

/// 进度回调类型
pub type ProgressCallback = Box<dyn Fn(f32) + Send + Sync>;

/// 浏览器原生支持的视频编解码器
const BROWSER_SUPPORTED_VIDEO_CODECS: &[&str] = &[
    "h264", "avc1", "avc",  // H.264/AVC
    "vp8",                   // VP8
    "vp9",                   // VP9
    "av1",                   // AV1
    "theora",                // Theora (OGG)
];

/// 浏览器原生支持的容器格式
const BROWSER_SUPPORTED_FORMATS: &[&str] = &[
    "mp4", "mov", "m4v",     // MP4 容器
    "webm",                   // WebM 容器
    "ogg", "ogv",            // OGG 容器
];

/// 检测视频是否需要转码预览
/// 返回 true 表示需要生成预览文件，false 表示可以直接播放
pub fn needs_preview_transcode(video_info: &VideoInfo) -> bool {
    let format = video_info.format.to_lowercase();
    let video_codec = video_info.video_codec.to_lowercase();

    // 检查容器格式是否支持
    let format_supported = BROWSER_SUPPORTED_FORMATS.iter()
        .any(|f| format.contains(f));

    // 检查视频编解码器是否支持
    let codec_supported = BROWSER_SUPPORTED_VIDEO_CODECS.iter()
        .any(|c| video_codec.contains(c));

    // 如果格式或编解码器不支持，则需要转码
    let needs_transcode = !format_supported || !codec_supported;

    if needs_transcode {
        info!(
            "[FFMPEG] 视频需要转码预览: format={}, codec={}, format_supported={}, codec_supported={}",
            format, video_codec, format_supported, codec_supported
        );
    }

    needs_transcode
}

/// 生成预览视频（低质量，用于播放不支持的格式）
/// 保持原始时长，转码为浏览器支持的 H.264/AAC MP4 格式
pub fn generate_preview_video(
    input_path: &str,
    output_path: &str,
    progress_callback: Option<ProgressCallback>,
    cancel_flag: Arc<AtomicBool>,
    project_id: &str,
) -> AppResult<()> {
    info!("[FFMPEG] 开始生成预览视频");
    info!("[FFMPEG] 输入: {}", input_path);
    info!("[FFMPEG] 输出: {}", output_path);

    // 获取视频信息用于进度计算
    let video_info = get_video_info(input_path)?;
    let total_duration = video_info.duration;

    // 确保输出目录存在
    if let Some(parent) = Path::new(output_path).parent() {
        fs::create_dir_all(parent)?;
    }

    let ffmpeg_path = resolve_tool_path("ffmpeg");

    // 检测硬件编码器
    let hw_encoder = detect_hw_encoder();

    // 构建编码参数
    // 硬件编码器速度快很多，软件编码使用 ultrafast 预设
    let mut args = vec![
        "-progress".to_string(), "pipe:1".to_string(),
        "-i".to_string(), input_path.to_string(),
        // 缩放到 720p 以加快转码速度（预览不需要原始分辨率）
        "-vf".to_string(), "scale=-2:720".to_string(),
    ];

    if let Some(ref encoder) = hw_encoder {
        // 硬件编码
        args.extend([
            "-c:v".to_string(), encoder.clone(),
        ]);
        // NVENC/AMF/QSV 使用不同的质量参数
        if encoder.contains("nvenc") {
            args.extend([
                "-preset".to_string(), "p1".to_string(),  // 最快预设
                "-rc".to_string(), "vbr".to_string(),
                "-cq".to_string(), "32".to_string(),      // 较低质量，加快速度
            ]);
        } else if encoder.contains("amf") {
            args.extend([
                "-quality".to_string(), "speed".to_string(),
                "-rc".to_string(), "vbr_latency".to_string(),
                "-qp_i".to_string(), "32".to_string(),
                "-qp_p".to_string(), "32".to_string(),
            ]);
        } else if encoder.contains("qsv") {
            args.extend([
                "-preset".to_string(), "veryfast".to_string(),
                "-global_quality".to_string(), "32".to_string(),
            ]);
        }
        info!("[FFMPEG] 使用硬件编码器: {}", encoder);
    } else {
        // 软件编码 - 使用 ultrafast 预设
        args.extend([
            "-c:v".to_string(), "libx264".to_string(),
            "-preset".to_string(), "ultrafast".to_string(),
            "-crf".to_string(), "28".to_string(),
            "-threads".to_string(), "0".to_string(),
        ]);
        info!("[FFMPEG] 使用软件编码器: libx264 ultrafast");
    }

    // 音频和输出参数
    args.extend([
        "-c:a".to_string(), "aac".to_string(),
        "-b:a".to_string(), "128k".to_string(),
        "-movflags".to_string(), "+faststart".to_string(),
        "-y".to_string(),
        output_path.to_string(),
    ]);

    // 使用 spawn 启动进程，以便支持取消和进度报告
    let child = hidden_command(&ffmpeg_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::FFmpeg(format!("ffmpeg 执行失败: {}", e)))?;

    // 注册子进程句柄，支持即时取消
    let child_handle = crate::commands::video::register_child_process(project_id, child);

    // 取出 stdout 后释放锁
    let stdout = {
        let mut guard = child_handle.lock().unwrap();
        let child = guard.as_mut()
            .ok_or_else(|| AppError::FFmpeg("子进程句柄已被释放".into()))?;
        child.stdout.take()
            .ok_or_else(|| AppError::FFmpeg("无法获取 FFmpeg 输出流".into()))?
    };

    // 设置非阻塞模式
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::HANDLE;
        use windows_sys::Win32::System::Pipes::SetNamedPipeHandleState;
        use windows_sys::Win32::System::Pipes::PIPE_NOWAIT;
        let handle = stdout.as_raw_handle() as HANDLE;
        unsafe {
            let mut mode = PIPE_NOWAIT;
            SetNamedPipeHandleState(handle, &mut mode, std::ptr::null_mut(), std::ptr::null_mut());
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        let fd = stdout.as_raw_fd();
        unsafe {
            let flags = libc::fcntl(fd, libc::F_GETFL);
            libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
        }
    }

    let mut reader = BufReader::new(stdout);
    let mut line_buffer = String::new();

    loop {
        // 检查取消标志
        if cancel_flag.load(Ordering::SeqCst) {
            // 进程已被 kill_child_processes 终止，只需等待回收
            if let Ok(mut guard) = child_handle.lock() {
                if let Some(ref mut child) = *guard {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            // 清理未完成的输出文件
            let _ = fs::remove_file(output_path);
            info!("[FFMPEG] 预览视频生成被取消: project_id={}", project_id);
            return Err(AppError::Cancelled);
        }

        // 检查进程是否结束（短暂获取锁）
        let try_wait_result = {
            let mut guard = child_handle.lock().unwrap();
            if let Some(ref mut child) = *guard {
                child.try_wait()
            } else {
                info!("[FFMPEG] 预览视频生成被取消（进程已终止）: project_id={}", project_id);
                return Err(AppError::Cancelled);
            }
        };

        match try_wait_result {
            Ok(Some(status)) => {
                if status.success() {
                    info!("[FFMPEG] 预览视频生成完成: {}", output_path);
                    if let Some(ref cb) = progress_callback {
                        cb(1.0);
                    }
                    return Ok(());
                } else {
                    // 清理失败的输出文件
                    let _ = fs::remove_file(output_path);
                    return Err(AppError::FFmpeg("预览视频生成失败".to_string()));
                }
            }
            Ok(None) => {
                // 进程仍在运行，尝试读取进度
                match reader.read_line(&mut line_buffer) {
                    Ok(0) => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Ok(_) => {
                        if let Some(caps) = TIME_REGEX.captures(&line_buffer) {
                            if let Some(time_ms) = caps.get(1) {
                                if let Ok(ms) = time_ms.as_str().parse::<f64>() {
                                    let current_time = ms / 1_000_000.0;
                                    let progress = (current_time / total_duration).min(1.0);
                                    if let Some(ref cb) = progress_callback {
                                        cb(progress as f32);
                                    }
                                }
                            }
                        }
                        line_buffer.clear();
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                }
            }
            Err(e) => {
                if let Ok(mut guard) = child_handle.lock() {
                    if let Some(ref mut child) = *guard {
                        let _ = child.kill();
                    }
                }
                // 清理失败的输出文件
                let _ = fs::remove_file(output_path);
                return Err(AppError::FFmpeg(format!("检查进程状态失败: {}", e)));
            }
        }
    }
}

/// 重编码导出单个片段
/// 确保第一帧是关键帧，播放时不会卡顿
/// cancel_flags: 支持多个取消标志，任一为 true 则取消
fn encode_segment(
    input_path: &str,
    output_path: &str,
    start: f64,
    end: f64,
    cancel_flags: &[&AtomicBool],
    project_id: &str,
) -> AppResult<()> {
    info!(
        "[FFMPEG] 重编码片段 {:.2}s - {:.2}s",
        start, end
    );

    // 检查任一取消标志
    let is_cancelled = || cancel_flags.iter().any(|f| f.load(Ordering::SeqCst));

    if is_cancelled() {
        return Err(AppError::Cancelled);
    }

    let ffmpeg_path = resolve_tool_path("ffmpeg");

    // 判断输出格式，决定是否添加 movflags
    let is_mp4 = output_path.to_lowercase().ends_with(".mp4")
        || output_path.to_lowercase().ends_with(".m4v")
        || output_path.to_lowercase().ends_with(".mov");

    let mut args = vec![
        "-v".to_string(), "warning".to_string(),  // 只输出警告和错误，减少 stderr 输出量，避免管道缓冲区阻塞
        "-ss".to_string(), start.to_string(),
        "-i".to_string(), input_path.to_string(),
        "-t".to_string(), (end - start).to_string(),
        "-c:v".to_string(), "libx264".to_string(),
        "-preset".to_string(), "veryfast".to_string(),  // 速度优化：veryfast 比 fast 快 2 倍，画质相同
        "-crf".to_string(), "18".to_string(),
        "-threads".to_string(), "0".to_string(),  // 自动使用所有 CPU 核心
        "-force_key_frames".to_string(), "expr:eq(n,0)".to_string(),  // 强制第一帧为关键帧
        "-c:a".to_string(), "aac".to_string(),
        "-b:a".to_string(), "192k".to_string(),
        "-avoid_negative_ts".to_string(), "make_zero".to_string(),
    ];

    // MP4 格式添加 faststart，确保 moov atom 在文件开头，支持快速播放
    if is_mp4 {
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
    }

    args.push("-y".to_string());
    args.push(output_path.to_string());

    // 使用 spawn 启动进程，以便支持取消
    let child = hidden_command(&ffmpeg_path)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::FFmpeg(format!("ffmpeg 执行失败: {}", e)))?;

    // 注册子进程句柄，支持即时取消
    let child_handle = crate::commands::video::register_child_process(project_id, child);

    // 轮询检查进程状态和取消标志
    loop {
        // 检查任一取消标志
        if is_cancelled() {
            if let Ok(mut guard) = child_handle.lock() {
                if let Some(ref mut child) = *guard {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            // 清理未完成的输出文件
            let _ = fs::remove_file(output_path);
            info!("[FFMPEG] 片段重编码被取消: {:.2}s - {:.2}s, project_id={}", start, end, project_id);
            return Err(AppError::Cancelled);
        }

        // 检查进程是否完成（短暂获取锁）
        let try_wait_result = {
            let mut guard = child_handle.lock().unwrap();
            if let Some(ref mut child) = *guard {
                child.try_wait()
            } else {
                info!("[FFMPEG] 片段重编码被取消（进程已终止）: {:.2}s - {:.2}s, project_id={}", start, end, project_id);
                return Err(AppError::Cancelled);
            }
        };

        match try_wait_result {
            Ok(Some(status)) => {
                if status.success() {
                    info!(
                        "[FFMPEG] 片段重编码完成 {:.2}s - {:.2}s -> {}",
                        start, end, output_path
                    );
                    return Ok(());
                } else {
                    let stderr = {
                        let mut guard = child_handle.lock().unwrap();
                        if let Some(ref mut child) = *guard {
                            child.stderr.take()
                                .map(|s| {
                                    let reader = BufReader::new(s);
                                    reader.lines()
                                        .filter_map(|l| l.ok())
                                        .collect::<Vec<_>>()
                                        .join("\n")
                                })
                                .unwrap_or_default()
                        } else {
                            String::new()
                        }
                    };
                    return Err(AppError::FFmpeg(format!("重编码失败: {}", stderr)));
                }
            }
            Ok(None) => {
                // 进程仍在运行，等待一小段时间后再检查
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => {
                return Err(AppError::FFmpeg(format!("检查进程状态失败: {}", e)));
            }
        }
    }
}

/// 获取视频信息
pub fn get_video_info(video_path: &str) -> AppResult<VideoInfo> {
    let ffprobe_path = resolve_tool_path("ffprobe");
    let output = hidden_command(&ffprobe_path)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            video_path,
        ])
        .output()
        .map_err(|e| AppError::FFmpeg(format!("ffprobe 执行失败: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::FFmpeg(format!("ffprobe 错误: {}", stderr)));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| AppError::FFmpeg(format!("解析 ffprobe 输出失败: {}", e)))?;

    // 解析视频流
    let streams = json["streams"].as_array()
        .ok_or_else(|| AppError::FFmpeg("无法获取流信息".to_string()))?;

    let mut width = 0u32;
    let mut height = 0u32;
    let mut fps = 0.0f64;
    let mut video_codec = String::new();
    let mut audio_codec = String::new();

    for stream in streams {
        let codec_type = stream["codec_type"].as_str().unwrap_or("");

        if codec_type == "video" && video_codec.is_empty() {
            width = stream["width"].as_u64().unwrap_or(0) as u32;
            height = stream["height"].as_u64().unwrap_or(0) as u32;
            video_codec = stream["codec_name"].as_str().unwrap_or("").to_string();

            // 解析帧率
            if let Some(fps_str) = stream["r_frame_rate"].as_str() {
                fps = parse_frame_rate(fps_str);
            }
        } else if codec_type == "audio" && audio_codec.is_empty() {
            audio_codec = stream["codec_name"].as_str().unwrap_or("").to_string();
        }
    }

    // 解析格式信息
    let format = &json["format"];
    let duration = format["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    let bitrate = format["bit_rate"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    let size = format["size"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    let format_name = format["format_name"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let filename = Path::new(video_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(VideoInfo {
        path: video_path.to_string(),
        filename,
        duration,
        width,
        height,
        fps,
        video_codec,
        audio_codec,
        bitrate,
        size,
        format: format_name,
    })
}

/// 解析帧率字符串
fn parse_frame_rate(fps_str: &str) -> f64 {
    let parts: Vec<&str> = fps_str.split('/').collect();
    if parts.len() == 2 {
        let num: f64 = parts[0].parse().unwrap_or(0.0);
        let den: f64 = parts[1].parse().unwrap_or(1.0);
        if den > 0.0 {
            return num / den;
        }
    }
    fps_str.parse().unwrap_or(0.0)
}

/// 获取音频时长
pub fn get_audio_duration(audio_path: &str) -> AppResult<f64> {
    let ffprobe_path = resolve_tool_path("ffprobe");
    let output = hidden_command(&ffprobe_path)
        .args([
            "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            audio_path,
        ])
        .output()
        .map_err(|e| AppError::FFmpeg(format!("ffprobe 执行失败: {}", e)))?;

    if !output.status.success() {
        return Err(AppError::FFmpeg("ffprobe 获取时长失败".to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .trim()
        .parse::<f64>()
        .map_err(|_| AppError::FFmpeg("解析音频时长失败".to_string()))
}

/// 提取音频轨道
pub fn extract_audio_track(
    video_path: &str,
    output_path: &str,
    progress_callback: Option<ProgressCallback>,
) -> AppResult<()> {
    // 获取视频时长用于计算进度
    let video_info = get_video_info(video_path)?;
    let total_duration = video_info.duration;

    let args = vec![
        "-i".to_string(),
        video_path.to_string(),
        "-vn".to_string(),
        "-acodec".to_string(),
        "pcm_s16le".to_string(),
        "-ar".to_string(),
        "44100".to_string(),
        "-ac".to_string(),
        "2".to_string(),
        "-y".to_string(),
        output_path.to_string(),
    ];

    run_ffmpeg_with_progress(&args, total_duration, progress_callback)
}

/// 提取音频片段
pub fn extract_audio_segment(
    audio_path: &str,
    output_path: &str,
    start_time: f64,
    duration: f64,
) -> AppResult<()> {
    let ffmpeg_path = resolve_tool_path("ffmpeg");
    let output = hidden_command(&ffmpeg_path)
        .args([
            "-i", audio_path,
            "-ss", &start_time.to_string(),
            "-t", &duration.to_string(),
            "-acodec", "pcm_s16le",
            "-ar", "44100",
            "-ac", "2",
            "-y",
            output_path,
        ])
        .output()
        .map_err(|e| AppError::FFmpeg(format!("ffmpeg 执行失败: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::FFmpeg(format!("提取音频片段失败: {}", stderr)));
    }

    Ok(())
}

/// 提取视频缩略图
pub fn extract_thumbnail(
    video_path: &str,
    output_path: &str,
    timestamp: f64,
) -> AppResult<()> {
    info!(
        "ffmpeg thumbnail start: video_path={}, output_path={}, timestamp={}",
        video_path, output_path, timestamp
    );
    let ffmpeg_path = resolve_tool_path("ffmpeg");
    let output = hidden_command(&ffmpeg_path)
        .args([
            "-ss", &timestamp.to_string(),
            "-i", video_path,
            "-vframes", "1",
            "-q:v", "2",
            "-y",
            output_path,
        ])
        .output()
        .map_err(|e| AppError::FFmpeg(format!("ffmpeg 执行失败: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!("ffmpeg thumbnail failed: {}", stderr);
        return Err(AppError::FFmpeg(format!("提取缩略图失败: {}", stderr)));
    }

    info!("ffmpeg thumbnail done: output_path={}", output_path);
    Ok(())
}

/// 剪辑视频片段（重编码模式：分段导出后合并）
pub fn cut_video_segments(
    input_path: &str,
    output_path: &str,
    segments: &[Segment],
    keep_matched: bool,
    progress_callback: Option<ProgressCallback>,
    cancel_flag: Arc<AtomicBool>,
    project_id: &str,
) -> AppResult<()> {
    let video_info = get_video_info(input_path)?;
    let total_duration = video_info.duration;

    // 计算需要保留的时间段
    let keep_segments = if keep_matched {
        // 保留匹配的片段（使用公共函数筛选、排序）
        let valid_segments = filter_valid_segments(segments, total_duration);
        // 合并重叠片段
        merge_overlapping_segments(&valid_segments)
    } else {
        // 移除匹配的片段，保留其他部分
        calculate_inverse_segments(segments, total_duration)
    };

    log_segment_filter_stats(segments, keep_segments.len());

    if keep_segments.is_empty() {
        return Err(AppError::Video("没有需要保留的片段".to_string()));
    }

    // 使用重编码分段合并
    reencode_concat_segments(input_path, output_path, &keep_segments, progress_callback, cancel_flag, project_id)
}

/// 计算反向片段（移除匹配片段后的剩余部分）
fn calculate_inverse_segments(segments: &[Segment], total_duration: f64) -> Vec<(f64, f64)> {
    let mut matched: Vec<(f64, f64)> = segments
        .iter()
        .filter(|s| s.status != SegmentStatus::Removed)
        .map(|s| (s.start_time, s.end_time))
        .collect();

    // 按开始时间排序（使用 unwrap_or 避免 NaN 导致 panic）
    matched.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    // 合并重叠片段
    let merged = merge_overlapping_segments(&matched);

    // 计算反向片段
    let mut inverse = Vec::new();
    let mut current = 0.0;

    for (start, end) in merged {
        if current < start {
            inverse.push((current, start));
        }
        current = end;
    }

    if current < total_duration {
        inverse.push((current, total_duration));
    }

    inverse
}

/// 合并重叠片段
fn merge_overlapping_segments(segments: &[(f64, f64)]) -> Vec<(f64, f64)> {
    if segments.is_empty() {
        return Vec::new();
    }

    let mut merged = vec![segments[0]];

    for &(start, end) in &segments[1..] {
        // merged 至少有一个元素，使用 if let 更安全
        if let Some(last) = merged.last_mut() {
            if start <= last.1 {
                last.1 = last.1.max(end);
            } else {
                merged.push((start, end));
            }
        }
    }

    merged
}

/// 筛选有效片段（公共函数，避免代码重复）
/// 1. 过滤已移除的片段
/// 2. 修正时间范围（确保在视频时长内）
/// 3. 过滤无效片段（start >= end）
/// 4. 按开始时间排序
fn filter_valid_segments(segments: &[Segment], total_duration: f64) -> Vec<(f64, f64)> {
    filter_valid_segments_with_ref(segments, total_duration)
        .into_iter()
        .map(|(start, end, _)| (start, end))
        .collect()
}

/// 筛选有效片段（保留原始 Segment 引用，用于分别导出）
fn filter_valid_segments_with_ref<'a>(
    segments: &'a [Segment],
    total_duration: f64,
) -> Vec<(f64, f64, &'a Segment)> {
    let mut valid_segments: Vec<(f64, f64, &'a Segment)> = segments
        .iter()
        .filter(|s| s.status != SegmentStatus::Removed)
        .map(|s| {
            let start = s.start_time.max(0.0);
            let end = s.end_time.min(total_duration);
            (start, end, s)
        })
        .filter(|(start, end, _)| start < end)
        .collect();

    // 按开始时间排序
    valid_segments.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    valid_segments
}

/// 记录片段筛选日志（公共函数，避免代码重复）
fn log_segment_filter_stats(segments: &[Segment], valid_count: usize) {
    let filtered_count = segments.iter().filter(|s| s.status != SegmentStatus::Removed).count();
    info!(
        "[FFMPEG] 片段筛选: 总计 {} 个，未移除 {} 个，有效 {} 个",
        segments.len(),
        filtered_count,
        valid_count
    );
}

/// 重编码分段合并（解决关键帧对齐问题）
/// 1. 每个片段重编码导出（确保第一帧是关键帧）
/// 2. 使用 concat demuxer 合并
fn reencode_concat_segments(
    input_path: &str,
    output_path: &str,
    segments: &[(f64, f64)],
    progress_callback: Option<ProgressCallback>,
    cancel_flag: Arc<AtomicBool>,
    project_id: &str,
) -> AppResult<()> {
    info!("[FFMPEG] 开始重编码分段合并，共 {} 个片段", segments.len());

    // 创建临时目录
    let temp_dir = tempfile::tempdir()?;
    let temp_path = temp_dir.path();

    let total_segments = segments.len();
    let mut segment_files: Vec<String> = Vec::new();

    // 步骤1：重编码导出每个片段
    for (i, (start, end)) in segments.iter().enumerate() {
        if cancel_flag.load(Ordering::SeqCst) {
            info!("[FFMPEG] 重编码分段合并被取消（片段导出阶段）");
            return Err(AppError::Cancelled);
        }

        let segment_file = temp_path.join(format!("segment_{:04}.ts", i));
        let segment_path = segment_file.to_string_lossy().to_string();

        info!("[FFMPEG] 重编码导出片段 {}/{}: {:.2}s - {:.2}s", i + 1, total_segments, start, end);

        // 重编码导出片段
        encode_segment(input_path, &segment_path, *start, *end, &[&cancel_flag], project_id)?;

        segment_files.push(segment_path);

        // 更新进度（导出阶段占 95%，合并很快直接到 100%）
        if let Some(ref cb) = progress_callback {
            cb(((i + 1) as f32 / total_segments as f32) * 0.95);
        }
    }

    if cancel_flag.load(Ordering::SeqCst) {
        info!("[FFMPEG] 重编码分段合并被取消（合并前）");
        return Err(AppError::Cancelled);
    }

    // 步骤2：创建 concat 列表文件
    let concat_list_path = temp_path.join("concat_list.txt");
    let mut concat_file = fs::File::create(&concat_list_path)?;

    for segment_path in &segment_files {
        // 使用正斜杠并转义单引号
        let escaped_path = segment_path.replace('\\', "/").replace('\'', "'\\''");
        writeln!(concat_file, "file '{}'", escaped_path)?;
    }
    concat_file.flush()?;

    info!("[FFMPEG] 开始合并 {} 个片段到: {}", segment_files.len(), output_path);

    // 步骤3：使用 concat demuxer 合并（支持取消）
    let ffmpeg_path = resolve_tool_path("ffmpeg");
    let concat_list_str = concat_list_path.to_string_lossy().to_string();
    let merge_start_time = std::time::Instant::now();

    let mut child = hidden_command(&ffmpeg_path)
        .args([
            "-f", "concat",
            "-safe", "0",
            "-i", &concat_list_str,
            "-c", "copy",
            "-y",
            output_path,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::FFmpeg(format!("ffmpeg 合并启动失败: {}", e)))?;

    // 轮询检查进程状态和取消标志
    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            // 清理未完成的输出文件
            let _ = fs::remove_file(output_path);
            info!("[FFMPEG] 重编码分段合并被取消（合并阶段）");
            return Err(AppError::Cancelled);
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    break;
                } else {
                    let stderr = child.stderr.take()
                        .map(|s| {
                            let reader = BufReader::new(s);
                            reader.lines()
                                .filter_map(|l| l.ok())
                                .collect::<Vec<_>>()
                                .join("\n")
                        })
                        .unwrap_or_default();
                    error!("[FFMPEG] 合并失败: {}", stderr);
                    // 清理失败的输出文件
                    let _ = fs::remove_file(output_path);
                    return Err(AppError::FFmpeg(format!("合并失败: {}", stderr)));
                }
            }
            Ok(None) => {
                // 进程仍在运行，等待一小段时间后再检查
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => {
                // 清理失败的输出文件
                let _ = fs::remove_file(output_path);
                return Err(AppError::FFmpeg(format!("检查合并进程状态失败: {}", e)));
            }
        }
    }

    // 完成
    if let Some(ref cb) = progress_callback {
        cb(1.0);
    }

    let merge_elapsed = merge_start_time.elapsed();
    info!(
        "[FFMPEG] 重编码合并完成: {}，合并耗时: {:.2}s",
        output_path,
        merge_elapsed.as_secs_f64()
    );
    Ok(())
}

/// 导出视频（重编码模式）
pub fn export_video(
    input_path: &str,
    output_path: &str,
    segments: &[Segment],
    progress_callback: Option<ProgressCallback>,
    cancel_flag: Arc<AtomicBool>,
    project_id: &str,
) -> AppResult<()> {
    // 检查取消标志
    if cancel_flag.load(Ordering::SeqCst) {
        info!("[FFMPEG] 导出视频被取消（启动前）");
        return Err(AppError::Cancelled);
    }

    info!("[FFMPEG] 开始导出视频（合并模式）");
    info!("[FFMPEG] 输入: {}", input_path);
    info!("[FFMPEG] 输出: {}", output_path);

    // 获取视频信息用于验证
    let video_info = get_video_info(input_path)?;
    let total_duration = video_info.duration;

    // 使用公共函数筛选有效片段（已排序）
    let keep_segments = filter_valid_segments(segments, total_duration);

    log_segment_filter_stats(segments, keep_segments.len());

    if keep_segments.is_empty() {
        return Err(AppError::Video("没有可导出的片段".to_string()));
    }

    // 合并重叠片段，避免重复内容
    let merged_segments = merge_overlapping_segments(&keep_segments);
    if merged_segments.len() < keep_segments.len() {
        info!(
            "[FFMPEG] 合并重叠片段: {} -> {} 个",
            keep_segments.len(),
            merged_segments.len()
        );
    }

    // 确保输出目录存在
    if let Some(parent) = Path::new(output_path).parent() {
        fs::create_dir_all(parent)?;
    }

    // 使用重编码分段合并
    let result = reencode_concat_segments(input_path, output_path, &merged_segments, progress_callback, cancel_flag, project_id);

    if result.is_ok() {
        info!("[FFMPEG] 导出视频完成: {}", output_path);
    }

    result
}

/// 分别导出视频片段（每个片段单独导出为独立文件，重编码模式，并行处理）
pub fn export_video_separately(
    input_path: &str,
    output_dir: &str,
    segments: &[Segment],
    progress_callback: Option<ProgressCallback>,
    cancel_flag: Arc<AtomicBool>,
    project_id: &str,
) -> AppResult<Vec<String>> {
    // 检查取消标志
    if cancel_flag.load(Ordering::SeqCst) {
        info!("[FFMPEG] 分别导出被取消（启动前）");
        return Err(AppError::Cancelled);
    }

    // 内部取消标志，用于任务失败时通知其他并行任务停止，不影响外部传入的 cancel_flag
    let internal_cancel = Arc::new(AtomicBool::new(false));

    // 获取视频信息用于验证
    let video_info = get_video_info(input_path)?;
    let total_duration = video_info.duration;

    // 使用公共函数筛选有效片段（已排序）
    // 注意：分段导出不合并重叠片段，每个片段单独导出
    let export_segments = filter_valid_segments_with_ref(segments, total_duration);

    log_segment_filter_stats(segments, export_segments.len());

    if export_segments.is_empty() {
        return Err(AppError::Video("没有可导出的片段".to_string()));
    }

    let total_segments = export_segments.len();

    // 根据 CPU 核心数决定并行度（每个 ffmpeg 进程使用多线程，所以并行数不宜过多）
    let num_cpus = num_cpus::get();
    let parallel_count = (num_cpus / 2).max(1).min(4);  // 最多 4 个并行任务

    info!(
        "[FFMPEG] 开始并行导出 {} 个片段（重编码模式，{} 个并行任务，{} 核 CPU）",
        total_segments, parallel_count, num_cpus
    );

    // 确保输出目录存在
    fs::create_dir_all(output_dir)?;

    // 获取源视频文件名（不含扩展名）和扩展名
    let source_stem = Path::new(input_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    // 对源文件名进行安全处理
    let safe_source_name: String = source_stem
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    // 限制源文件名长度
    let safe_source_name: String = safe_source_name.chars().take(30).collect();

    let source_ext = Path::new(input_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp4");

    // 进度计数器
    let completed_count = Arc::new(AtomicUsize::new(0));
    // 使用 Mutex 保护最大进度值，确保进度单调递增
    let max_progress = Arc::new(Mutex::new(0.0f32));

    // 将秒数转换为 mm分ss秒 格式
    let format_time = |seconds: f64| -> String {
        let total_secs = seconds as u32;
        let mins = total_secs / 60;
        let secs = total_secs % 60;
        format!("{:02}m{:02}s", mins, secs)
    };

    // 预先生成所有输出路径（保持顺序），使用已修正的时间范围
    // 添加序号前缀防止文件名冲突
    let tasks: Vec<(usize, f64, f64, String)> = export_segments
        .iter()
        .enumerate()
        .map(|(i, (start_time, end_time, segment))| {
            // 处理空字符串和 None 的情况
            let music_name = segment.music_title
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("未知音乐");
            let safe_music_name: String = music_name
                .chars()
                .map(|c| match c {
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
                    _ => c,
                })
                .collect();
            // 限制文件名长度（Windows 限制 255 字符，预留扩展名和路径空间）
            let safe_music_name: String = safe_music_name.chars().take(50).collect();
            // 文件名格式：源文件名_序号_音乐名_开始时间_结束时间.扩展名
            let output_filename = format!(
                "{}_{:03}_{}_{}_{}.{}",
                safe_source_name,
                i + 1,
                safe_music_name,
                format_time(*start_time),
                format_time(*end_time),
                source_ext
            );
            let output_path = Path::new(output_dir).join(&output_filename);
            (i, *start_time, *end_time, output_path.to_string_lossy().to_string())
        })
        .collect();

    // 配置 rayon 线程池
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(parallel_count)
        .build()
        .map_err(|e| AppError::Video(format!("创建线程池失败: {}", e)))?;

    // 并行导出
    let max_progress_clone = Arc::clone(&max_progress);
    let results: Vec<Result<String, AppError>> = pool.install(|| {
        tasks
            .par_iter()
            .map(|(i, start_time, end_time, output_path_str)| {
                // 检查取消标志（包括用户取消和其他任务失败导致的内部取消）
                if cancel_flag.load(Ordering::SeqCst) {
                    // 用户取消，同步设置内部取消标志
                    internal_cancel.store(true, Ordering::SeqCst);
                }
                if internal_cancel.load(Ordering::SeqCst) {
                    info!("[FFMPEG] 片段 {} 导出被取消", i + 1);
                    return Err(AppError::Cancelled);
                }

                info!(
                    "[FFMPEG] 重编码导出片段 {}/{}: {:.2}s - {:.2}s",
                    i + 1,
                    total_segments,
                    start_time,
                    end_time
                );

                // 重编码导出单个片段（使用修正后的时间范围，同时传入用户取消标志和内部取消标志）
                match encode_segment(input_path, output_path_str, *start_time, *end_time, &[&cancel_flag, &internal_cancel], project_id) {
                    Ok(()) => {
                        // 更新进度（确保单调递增）
                        let completed = completed_count.fetch_add(1, Ordering::SeqCst) + 1;
                        if let Some(ref cb) = progress_callback {
                            let new_progress = completed as f32 / total_segments as f32;
                            let mut max_prog = max_progress_clone.lock().unwrap();
                            if new_progress > *max_prog {
                                *max_prog = new_progress;
                                cb(new_progress);
                            }
                        }
                        Ok(output_path_str.clone())
                    }
                    Err(e) => {
                        // 导出失败，设置内部取消标志通知其他任务停止（不影响外部 cancel_flag）
                        error!(
                            "[FFMPEG] 片段 {} ({:.2}s - {:.2}s) 导出失败: {}",
                            i + 1, start_time, end_time, e
                        );
                        internal_cancel.store(true, Ordering::SeqCst);
                        Err(e)
                    }
                }
            })
            .collect()
    });

    // 收集结果，检查错误（记录所有错误到日志，返回第一个非取消错误）
    let mut output_files: Vec<String> = Vec::with_capacity(total_segments);
    let mut first_error: Option<AppError> = None;
    let mut error_count = 0;
    for result in results {
        match result {
            Ok(path) => output_files.push(path),
            Err(AppError::Cancelled) => {
                // 取消错误优先级较低，只在没有其他错误时使用
                if first_error.is_none() {
                    first_error = Some(AppError::Cancelled);
                }
            }
            Err(e) => {
                error_count += 1;
                // 记录所有错误到日志
                error!("[FFMPEG] 导出错误 #{}: {}", error_count, e);
                // 非取消错误优先级较高，保留第一个
                if first_error.is_none() || matches!(first_error, Some(AppError::Cancelled)) {
                    first_error = Some(e);
                }
            }
        }
    }

    // 如果有多个错误，记录汇总信息
    if error_count > 1 {
        error!("[FFMPEG] 共有 {} 个片段导出失败", error_count);
    }

    // 如果有错误，清理已成功的文件后返回错误
    if let Some(e) = first_error {
        // 清理已导出的文件，保持状态一致（要么全成功，要么全失败）
        if !output_files.is_empty() {
            info!("[FFMPEG] 导出失败，清理 {} 个已导出的文件", output_files.len());
            for path in &output_files {
                if let Err(remove_err) = fs::remove_file(path) {
                    error!("[FFMPEG] 清理文件失败 {}: {}", path, remove_err);
                }
            }
        }
        return Err(e);
    }

    info!("[FFMPEG] 并行导出完成，共 {} 个文件", output_files.len());
    Ok(output_files)
}

/// 导出自定义剪辑片段（指定时间范围）
pub fn export_custom_segment(
    input_path: &str,
    output_path: &str,
    start_time: f64,
    end_time: f64,
    progress_callback: Option<ProgressCallback>,
    cancel_flag: Arc<AtomicBool>,
    project_id: &str,
) -> AppResult<()> {
    // 检查取消标志
    if cancel_flag.load(Ordering::SeqCst) {
        info!("[FFMPEG] 自定义剪辑导出被取消（启动前）");
        return Err(AppError::Cancelled);
    }

    let duration = end_time - start_time;
    info!(
        "[FFMPEG] 开始导出自定义剪辑: {:.3}s - {:.3}s (时长: {:.3}s)",
        start_time, end_time, duration
    );

    // 确保输出目录存在
    if let Some(parent) = Path::new(output_path).parent() {
        fs::create_dir_all(parent)?;
    }

    let ffmpeg_path = resolve_tool_path("ffmpeg");

    // 判断输出格式，决定是否添加 movflags
    let is_mp4 = output_path.to_lowercase().ends_with(".mp4")
        || output_path.to_lowercase().ends_with(".m4v")
        || output_path.to_lowercase().ends_with(".mov");

    let mut args = vec![
        "-progress".to_string(), "pipe:1".to_string(),
        "-ss".to_string(), start_time.to_string(),
        "-i".to_string(), input_path.to_string(),
        "-t".to_string(), duration.to_string(),
        "-c:v".to_string(), "libx264".to_string(),
        "-preset".to_string(), "veryfast".to_string(),
        "-crf".to_string(), "18".to_string(),
        "-threads".to_string(), "0".to_string(),
        "-force_key_frames".to_string(), "expr:eq(n,0)".to_string(),
        "-c:a".to_string(), "aac".to_string(),
        "-b:a".to_string(), "192k".to_string(),
        "-avoid_negative_ts".to_string(), "make_zero".to_string(),
    ];

    // MP4 格式添加 faststart
    if is_mp4 {
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
    }

    args.push("-y".to_string());
    args.push(output_path.to_string());

    // 使用 spawn 启动进程，以便支持取消和进度报告
    let child = hidden_command(&ffmpeg_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::FFmpeg(format!("ffmpeg 执行失败: {}", e)))?;

    // 注册子进程句柄，支持即时取消
    let child_handle = crate::commands::video::register_child_process(project_id, child);

    // 取出 stdout 后释放锁
    let stdout = {
        let mut guard = child_handle.lock().unwrap();
        let child = guard.as_mut()
            .ok_or_else(|| AppError::FFmpeg("子进程句柄已被释放".into()))?;
        child.stdout.take()
            .ok_or_else(|| AppError::FFmpeg("无法获取 FFmpeg 输出流".into()))?
    };

    // 设置非阻塞模式
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::HANDLE;
        use windows_sys::Win32::System::Pipes::SetNamedPipeHandleState;
        use windows_sys::Win32::System::Pipes::PIPE_NOWAIT;
        let handle = stdout.as_raw_handle() as HANDLE;
        unsafe {
            let mut mode = PIPE_NOWAIT;
            SetNamedPipeHandleState(handle, &mut mode, std::ptr::null_mut(), std::ptr::null_mut());
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        let fd = stdout.as_raw_fd();
        unsafe {
            let flags = libc::fcntl(fd, libc::F_GETFL);
            libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
        }
    }

    let mut reader = BufReader::new(stdout);
    let mut line_buffer = String::new();

    loop {
        // 检查取消标志
        if cancel_flag.load(Ordering::SeqCst) {
            if let Ok(mut guard) = child_handle.lock() {
                if let Some(ref mut child) = *guard {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            // 清理未完成的输出文件
            let _ = fs::remove_file(output_path);
            info!("[FFMPEG] 自定义剪辑导出被取消");
            return Err(AppError::Cancelled);
        }

        // 检查进程是否完成（短暂获取锁）
        let try_wait_result = {
            let mut guard = child_handle.lock().unwrap();
            if let Some(ref mut child) = *guard {
                child.try_wait()
            } else {
                return Err(AppError::Cancelled);
            }
        };

        match try_wait_result {
            Ok(Some(status)) => {
                if status.success() {
                    info!("[FFMPEG] 自定义剪辑导出完成: {}", output_path);
                    if let Some(ref cb) = progress_callback {
                        cb(1.0);
                    }
                    return Ok(());
                } else {
                    // 清理失败的输出文件
                    let _ = fs::remove_file(output_path);
                    return Err(AppError::FFmpeg("自定义剪辑导出失败".to_string()));
                }
            }
            Ok(None) => {
                // 进程仍在运行，尝试读取进度
                match reader.read_line(&mut line_buffer) {
                    Ok(0) => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Ok(_) => {
                        if let Some(caps) = TIME_REGEX.captures(&line_buffer) {
                            if let Some(time_ms) = caps.get(1) {
                                if let Ok(ms) = time_ms.as_str().parse::<f64>() {
                                    let current_time = ms / 1_000_000.0;
                                    let progress = (current_time / duration).min(1.0);
                                    if let Some(ref cb) = progress_callback {
                                        cb(progress as f32);
                                    }
                                }
                            }
                        }
                        line_buffer.clear();
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                }
            }
            Err(e) => {
                if let Ok(mut guard) = child_handle.lock() {
                    if let Some(ref mut child) = *guard {
                        let _ = child.kill();
                    }
                }
                // 清理失败的输出文件
                let _ = fs::remove_file(output_path);
                return Err(AppError::FFmpeg(format!("检查进程状态失败: {}", e)));
            }
        }
    }
}

/// 运行 FFmpeg 并报告进度
fn run_ffmpeg_with_progress(
    args: &[String],
    total_duration: f64,
    progress_callback: Option<ProgressCallback>,
) -> AppResult<()> {
    run_ffmpeg_with_progress_and_cancel(
        args,
        total_duration,
        progress_callback,
        Arc::new(AtomicBool::new(false)),
    )
}

/// 运行 FFmpeg 并报告进度（支持取消）
fn run_ffmpeg_with_progress_and_cancel(
    args: &[String],
    total_duration: f64,
    progress_callback: Option<ProgressCallback>,
    cancel_flag: Arc<AtomicBool>,
) -> AppResult<()> {
    let mut cmd_args = vec!["-progress".to_string(), "pipe:1".to_string()];
    cmd_args.extend(args.iter().cloned());

    let ffmpeg_path = resolve_tool_path("ffmpeg");
    let mut child = hidden_command(&ffmpeg_path)
        .args(&cmd_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::FFmpeg(format!("ffmpeg 启动失败: {}", e)))?;

    let stdout = child.stdout.take()
        .ok_or_else(|| AppError::FFmpeg("无法获取 FFmpeg 输出流".into()))?;

    // 设置非阻塞模式
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        let fd = stdout.as_raw_fd();
        unsafe {
            let flags = libc::fcntl(fd, libc::F_GETFL);
            libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::HANDLE;
        use windows_sys::Win32::System::Pipes::SetNamedPipeHandleState;
        use windows_sys::Win32::System::Pipes::PIPE_NOWAIT;
        let handle = stdout.as_raw_handle() as HANDLE;
        unsafe {
            let mut mode = PIPE_NOWAIT;
            SetNamedPipeHandleState(handle, &mut mode, std::ptr::null_mut(), std::ptr::null_mut());
        }
    }

    let mut reader = BufReader::new(stdout);
    let mut line_buffer = String::new();

    loop {
        // 检查取消标志
        if cancel_flag.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::Cancelled);
        }

        // 检查进程是否结束
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err(AppError::FFmpeg("FFmpeg 处理失败".to_string()));
                }
                break;
            }
            Ok(None) => {
                // 进程仍在运行，尝试读取输出
                match reader.read_line(&mut line_buffer) {
                    Ok(0) => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Ok(_) => {
                        if let Some(caps) = TIME_REGEX.captures(&line_buffer) {
                            if let Some(time_ms) = caps.get(1) {
                                if let Ok(ms) = time_ms.as_str().parse::<f64>() {
                                    let current_time = ms / 1_000_000.0;
                                    let progress = (current_time / total_duration).min(1.0);
                                    if let Some(ref cb) = progress_callback {
                                        cb(progress as f32);
                                    }
                                }
                            }
                        }
                        line_buffer.clear();
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                }
            }
            Err(e) => {
                let _ = child.kill();
                return Err(AppError::FFmpeg(format!("检查进程状态失败: {}", e)));
            }
        }
    }

    if let Some(ref cb) = progress_callback {
        cb(1.0);
    }

    Ok(())
}
