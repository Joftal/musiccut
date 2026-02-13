// 人物检测核心模块
//
// 调用外部 person-detector 程序（基于 YOLOv11s）对视频逐帧检测人物，
// 将检测到的连续帧合并为时间片段，输出 JSON 结果。
//
// 命令解析优先级：
// 1. 打包版本: exe_dir/person-detector/person-detector.exe
// 2. Resources: exe_dir/resources/person-detector/person-detector.exe
// 3. 开发模式: python python/person-detector/main.py
// 4. 系统 PATH: person-detector

use crate::config::{DetectionConfig, AccelerationMode};
use crate::error::{AppError, AppResult};
use crate::models;
use crate::utils::hidden_command;
use crate::commands::video::register_child_process;
use std::process::Stdio;
use std::io::{BufRead, BufReader};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::path::{Path, PathBuf};
use tracing::{info, error, debug};

/// person-detector 输出的检测结果（对应 JSON 文件结构）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DetectionResult {
    /// 检测到的人物时间片段列表
    pub segments: Vec<PersonSegment>,
    /// 视频总帧数
    pub total_frames: u64,
    /// 实际处理的帧数（按 frame_interval 抽帧）
    pub processed_frames: u64,
    /// 检测到人物的帧数
    pub detection_frames: u64,
}

/// 单个人物时间片段（由连续检测帧合并而成）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PersonSegment {
    pub start_time: f64,
    pub end_time: f64,
    /// 片段内所有检测帧的最大置信度
    pub confidence: f64,
}

/// 进度回调类型：(progress: 0.0-1.0, message)
pub type ProgressCallback = Box<dyn Fn(f32, &str) + Send + Sync>;

/// 执行人物检测
///
/// 启动 person-detector 子进程，通过 stderr 读取进度，等待完成后解析输出 JSON。
/// 支持通过 cancel_flag 中途取消。
pub fn detect_persons(
    video_path: &str,
    output_dir: &str,
    config: &DetectionConfig,
    acceleration: &AccelerationMode,
    progress_callback: Option<ProgressCallback>,
    cancel_flag: Arc<AtomicBool>,
    project_id: &str,
) -> AppResult<DetectionResult> {
    info!("[DETECTOR] === 开始人物检测 ===");
    info!("[DETECTOR] 视频路径: {}", video_path);
    info!("[DETECTOR] 输出目录: {}", output_dir);
    info!("[DETECTOR] 检测配置: 置信度={}, 抽帧间隔={}, 最小片段={}s, 最大间隔={}s",
        config.confidence_threshold, config.frame_interval,
        config.min_segment_duration, config.max_gap_duration);

    // 获取默认检测模型
    let model = models::get_detection_models()
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Detection("没有可用的检测模型".to_string()))?;

    info!("[DETECTOR] 使用模型: {} ({})", model.name, model.filename);

    // 检查视频文件是否存在
    if !Path::new(video_path).exists() {
        return Err(AppError::NotFound(format!("视频文件不存在: {}", video_path)));
    }

    // 确保输出目录存在
    std::fs::create_dir_all(output_dir)?;

    // 检查模型文件
    let model_dir = models::ensure_detection_model_dir(&model)?;
    let model_path = model_dir.join(&model.filename);
    if !model_path.exists() {
        return Err(AppError::Detection(format!(
            "检测模型文件不存在: {}，请先下载模型",
            model_path.display()
        )));
    }

    if let Some(ref cb) = progress_callback {
        cb(0.0, "准备人物检测...");
    }

    // 构建输出 JSON 路径（每个项目独立文件，避免并发冲突）
    let output_json = Path::new(output_dir).join(format!("{}_detection.json", project_id));
    info!("[DETECTOR] 输出 JSON: {}", output_json.display());

    // 确定设备参数
    let device = match acceleration {
        AccelerationMode::Cpu => "cpu",
        AccelerationMode::Gpu => "gpu",
        _ => "auto",
    };

    info!("[DETECTOR] 设备: {}", device);
    let args = vec![
        "--video_path".to_string(), video_path.to_string(),
        "--model_path".to_string(), model_path.to_string_lossy().to_string(),
        "--output_json".to_string(), output_json.to_string_lossy().to_string(),
        "--confidence".to_string(), config.confidence_threshold.to_string(),
        "--frame_interval".to_string(), config.frame_interval.to_string(),
        "--device".to_string(), device.to_string(),
        "--max_gap_duration".to_string(), config.max_gap_duration.to_string(),
        "--min_segment_duration".to_string(), config.min_segment_duration.to_string(),
    ];

    let (program, script_args) = resolve_detector_command();
    info!("[DETECTOR] 程序: {}", program);
    if !script_args.is_empty() {
        info!("[DETECTOR] 脚本参数: {:?}", script_args);
    }
    info!("[DETECTOR] 检测参数: {}", args.join(" "));

    if let Some(ref cb) = progress_callback {
        cb(0.05, "启动 person-detector...");
    }

    // 构建命令
    let mut cmd = hidden_command(&program);
    // 开发模式下先加脚本路径参数，再加检测参数
    cmd.args(&script_args)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    // CPU 模式禁用 GPU
    if device == "cpu" {
        cmd.env("CUDA_VISIBLE_DEVICES", "-1");
    }

    let child = cmd.spawn().map_err(|e| {
        error!("[DETECTOR] 启动 person-detector 失败: {}", e);
        AppError::Detection(format!("启动 person-detector 失败: {}", e))
    })?;

    // 使用 det_ 前缀注册子进程，与人声分离的子进程管理隔离
    let det_key = format!("det_{}", project_id);
    info!("[DETECTOR] 子进程已启动，注册键: {}", det_key);
    let child_handle = register_child_process(&det_key, child);

    // 取出 stderr
    let stderr = {
        let mut child_guard = child_handle.lock().unwrap();
        let child = child_guard.as_mut()
            .ok_or_else(|| AppError::Detection("子进程句柄已被释放".into()))?;
        child.stderr.take()
            .ok_or_else(|| AppError::Detection("无法获取 person-detector 错误输出流".into()))?
    };

    // 设置 stderr 非阻塞模式，以便在轮询循环中同时检查取消标志和进程状态
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        let fd = stderr.as_raw_fd();
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
        let handle = stderr.as_raw_handle() as HANDLE;
        unsafe {
            let mut mode = PIPE_NOWAIT;
            SetNamedPipeHandleState(handle, &mut mode, std::ptr::null_mut(), std::ptr::null_mut());
        }
    }

    let mut reader = BufReader::new(stderr);
    let mut error_output = String::new();
    let mut line_buffer = String::new();

    // 轮询循环：读取 stderr 进度、检查取消标志、等待进程结束
    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            info!("[DETECTOR] 人物检测被取消: project_id={}", project_id);
            if let Ok(mut guard) = child_handle.lock() {
                if let Some(ref mut child) = *guard {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            return Err(AppError::Cancelled);
        }

        let try_wait_result = {
            let mut guard = child_handle.lock().unwrap();
            if let Some(ref mut child) = *guard {
                child.try_wait()
            } else {
                return Err(AppError::Cancelled);
            }
        };

        match try_wait_result {
            Ok(Some(_)) => {
                // 进程已结束，读取剩余输出
                while let Ok(n) = reader.read_line(&mut line_buffer) {
                    if n == 0 { break; }
                    let line = line_buffer.trim_end();
                    if !line.is_empty() {
                        debug!("[DETECTOR] stderr: {}", line);
                        if !error_output.is_empty() { error_output.push('\n'); }
                        error_output.push_str(line);
                        if line.contains('%') {
                            if let Some(progress) = parse_progress(line) {
                                if let Some(ref cb) = progress_callback {
                                    cb(progress, line);
                                }
                            }
                        }
                    }
                    line_buffer.clear();
                }
                break;
            }
            Ok(None) => {
                // 进程仍在运行，尝试读取一行 stderr
                match reader.read_line(&mut line_buffer) {
                    Ok(0) => {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Ok(_) => {
                        let line = line_buffer.trim_end();
                        if !line.is_empty() {
                            debug!("[DETECTOR] stderr: {}", line);
                            if !error_output.is_empty() { error_output.push('\n'); }
                            error_output.push_str(line);
                            if line.contains('%') {
                                if let Some(progress) = parse_progress(line) {
                                    debug!("[DETECTOR] 检测进度: {:.1}%", progress * 100.0);
                                    if let Some(ref cb) = progress_callback {
                                        cb(progress, line);
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
                error!("[DETECTOR] 检查进程状态失败: {}", e);
                if let Ok(mut guard) = child_handle.lock() {
                    if let Some(ref mut child) = *guard {
                        let _ = child.kill();
                    }
                }
                return Err(AppError::Detection(format!("检查进程状态失败: {}", e)));
            }
        }
    }

    // 等待进程结束并获取退出码
    info!("[DETECTOR] 等待 person-detector 进程结束...");
    let status = {
        let mut guard = child_handle.lock().unwrap();
        if let Some(ref mut child) = *guard {
            child.wait()?
        } else {
            return Err(AppError::Cancelled);
        }
    };
    info!("[DETECTOR] person-detector 退出码: {:?}", status.code());

    if !status.success() {
        error!("[DETECTOR] person-detector 处理失败，退出码: {:?}", status.code());
        let error_msg = if error_output.is_empty() {
            "person-detector 处理失败（无详细错误信息）".to_string()
        } else {
            format!("person-detector 处理失败: {}", error_output.chars().take(500).collect::<String>())
        };
        return Err(AppError::Detection(error_msg));
    }

    info!("[DETECTOR] person-detector 处理成功");

    if let Some(ref cb) = progress_callback {
        cb(1.0, "检测完成");
    }

    // 读取并解析输出 JSON
    info!("[DETECTOR] 读取检测结果: {}", output_json.display());
    let json_content = std::fs::read_to_string(&output_json).map_err(|e| {
        AppError::Detection(format!("读取检测结果失败: {}", e))
    })?;

    let result: DetectionResult = serde_json::from_str(&json_content).map_err(|e| {
        AppError::Detection(format!("解析检测结果失败: {}", e))
    })?;

    info!("[DETECTOR] === 检测完成 === {} 个人物片段, 总帧数={}, 处理帧数={}, 检测帧数={}",
        result.segments.len(), result.total_frames, result.processed_frames, result.detection_frames);
    Ok(result)
}

/// 解析进度输出
fn parse_progress(line: &str) -> Option<f32> {
    if let Some(pos) = line.find('%') {
        let start = line[..pos].rfind(|c: char| !c.is_ascii_digit()).map(|i| i + 1).unwrap_or(0);
        if let Ok(percent) = line[start..pos].parse::<f32>() {
            return Some(percent / 100.0);
        }
    }
    None
}

/// 解析 person-detector 命令
/// 返回 (程序路径, 额外参数)
/// - 打包模式: ("person-detector.exe", [])
/// - 开发模式: ("python", ["python/person-detector/main.py"])
/// - 回退: ("person-detector", [])
pub fn resolve_detector_command() -> (String, Vec<String>) {
    use crate::utils::get_exe_dir;

    if let Some(exe_dir) = get_exe_dir() {
        // 检查打包版本: exe目录/person-detector/person-detector.exe
        let bundled_path = exe_dir.join("person-detector").join("person-detector.exe");
        if bundled_path.exists() {
            return (bundled_path.to_string_lossy().to_string(), vec![]);
        }

        // 检查 resources 目录（开发模式 PyInstaller 构建版本）
        let resources_path = exe_dir.join("resources").join("person-detector").join("person-detector.exe");
        if resources_path.exists() {
            return (resources_path.to_string_lossy().to_string(), vec![]);
        }

        // 开发模式: 查找项目根目录下的 Python 脚本
        if let Some(project_root) = find_project_root(&exe_dir) {
            let script_path = project_root.join("python").join("person-detector").join("main.py");
            if script_path.exists() {
                info!("[DETECTOR] 使用开发模式 Python 脚本: {}", script_path.display());
                return (
                    "python".to_string(),
                    vec![script_path.to_string_lossy().to_string()],
                );
            }
        }
    }

    // 回退到系统 PATH
    ("person-detector".to_string(), vec![])
}

/// 查找项目根目录（包含 src-tauri 的目录）
fn find_project_root(exe_dir: &Path) -> Option<PathBuf> {
    exe_dir.ancestors().find(|p| p.join("src-tauri").exists()).map(|p| p.to_path_buf())
}
