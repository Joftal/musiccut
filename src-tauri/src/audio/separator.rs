// 人声分离模块 - 使用 audio-separator

use crate::config::{SeparationConfig, AccelerationMode, GpuType};
use crate::error::{AppError, AppResult};
use crate::utils::{SeparationResult, hidden_command};
use crate::models;
use crate::video::ffmpeg::get_audio_duration;
use std::process::Stdio;
use std::io::{BufRead, BufReader};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::path::Path;
use tracing::{info, error, debug};

/// 进度回调类型
pub type ProgressCallback = Box<dyn Fn(f32, &str) + Send + Sync>;

/// GPU 能力信息
#[derive(Clone)]
pub struct GpuCapabilities {
    pub onnx_gpu_available: bool,
}

/// 人声分离
pub fn separate_vocals(
    audio_path: &str,
    output_dir: &str,
    config: &SeparationConfig,
    gpu_type: &GpuType,
    acceleration: &AccelerationMode,
    gpu_caps: &GpuCapabilities,
    progress_callback: Option<ProgressCallback>,
    cancel_flag: Arc<AtomicBool>,
    project_id: &str,
) -> AppResult<SeparationResult> {
    info!("=== 开始人声分离 (audio-separator) ===");
    info!("音频路径: {}", audio_path);
    info!("输出目录: {}", output_dir);

    // 获取当前选择的模型信息
    let model = models::get_model_by_id(&config.selected_model_id)
        .or_else(|| {
            info!("未找到模型 {}，尝试使用默认模型", config.selected_model_id);
            models::get_available_models().into_iter().next()
        })
        .ok_or_else(|| AppError::Config("没有可用的分离模型，请先下载模型".to_string()))?;

    info!("使用模型: {} ({})", model.name, model.filename);
    info!("模型架构: {:?}", model.architecture);
    info!("GPU 类型: {:?}", gpu_type);
    info!("加速模式: {:?}", acceleration);
    info!("GPU 能力: ONNX_GPU={}", gpu_caps.onnx_gpu_available);

    // 检查音频文件是否存在
    if !Path::new(audio_path).exists() {
        error!("音频文件不存在: {}", audio_path);
        return Err(AppError::NotFound(format!("音频文件不存在: {}", audio_path)));
    }
    info!("音频文件存在: {}", audio_path);

    // 确保输出目录存在
    std::fs::create_dir_all(output_dir)?;
    info!("输出目录已创建: {}", output_dir);

    // audio-separator 会自动检测并使用可用的设备 (GPU 优先，否则 CPU)
    info!("audio-separator 将自动选择最佳设备");

    if let Some(ref cb) = progress_callback {
        cb(0.0, "准备分离音频...");
    }

    // 构建 audio-separator 命令
    // 不使用 --single_stem，同时输出人声和伴奏
    let mut args = vec![
        audio_path.to_string(),
        "--model_filename".to_string(),
        model.filename.clone(),
        "--output_dir".to_string(),
        output_dir.to_string(),
        "--output_format".to_string(),
        config.output_format.clone(),
    ];

    // 添加模型缓存目录参数（按模型 ID 独立目录存放）
    let model_dir = models::ensure_model_dir(&model)?;
    args.push("--model_file_dir".to_string());
    args.push(model_dir.to_string_lossy().to_string());

    // 根据加速模式决定是否使用 GPU
    let use_gpu = match acceleration {
        AccelerationMode::Cpu => false,
        _ => true,  // Gpu, Auto, Hybrid 都尝试使用 GPU
    };

    // GPU 模式：ONNX 模型自动检测并使用最佳 GPU 加速
    if use_gpu {
        // ONNX 模型：audio-separator 自动检测并使用最佳 GPU 加速
        // 不需要手动指定参数
        info!("ONNX 模型将自动使用 GPU 加速（如果可用）");
    } else {
        info!("强制使用 CPU 模式");
    }

    info!("audio-separator 命令: audio-separator {}", args.join(" "));

    if let Some(ref cb) = progress_callback {
        cb(0.05, "启动 audio-separator...");
    }

    // 执行 audio-separator
    info!("正在启动 audio-separator 进程...");

    // 获取 audio-separator 路径（优先使用打包版本）
    let separator_path = resolve_separator_path();
    info!("audio-separator 路径: {}", separator_path);

    // 构建命令
    let mut cmd = hidden_command(&separator_path);
    cmd.args(&args)
        .stdout(Stdio::null())  // 将 stdout 重定向到 null，避免管道阻塞
        .stderr(Stdio::piped());

    // 如果强制 CPU 模式，设置环境变量禁用 GPU
    // 注意：CUDA_VISIBLE_DEVICES="-1" 才能真正禁用 GPU，空字符串无效
    if !use_gpu {
        cmd.env("CUDA_VISIBLE_DEVICES", "-1");
        info!("已设置 CUDA_VISIBLE_DEVICES=\"-1\" 禁用 GPU");
    }

    let child = cmd.spawn()
        .map_err(|e| {
            error!("启动 audio-separator 失败: {}", e);
            AppError::VocalSeparation(format!("启动 audio-separator 失败: {}", e))
        })?;
    info!("audio-separator 进程已启动");

    // 注册子进程句柄，支持即时取消（直接 kill）
    let child_handle = crate::commands::video::register_child_process(project_id, child);

    // 取出 stderr 后释放锁，让 kill_child_processes 可以随时获取锁来终止进程
    let stderr = {
        let mut child_guard = child_handle.lock().unwrap();
        let child = child_guard.as_mut()
            .ok_or_else(|| AppError::VocalSeparation("子进程句柄已被释放".into()))?;
        child.stderr.take()
            .ok_or_else(|| AppError::VocalSeparation("无法获取 audio-separator 错误输出流".into()))?
    };

    // 设置非阻塞模式
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        let fd = stderr.as_raw_fd();
        // SAFETY: 调用 POSIX fcntl 设置文件描述符为非阻塞模式
        // - fd 是从有效的 stderr 句柄获取的有效文件描述符
        // - F_GETFL/F_SETFL 是标准的 fcntl 操作，不会导致内存安全问题
        // - 即使 fcntl 失败，最坏情况是进度输出不够实时，不影响核心功能
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
        // SAFETY: 调用 Windows API SetNamedPipeHandleState 设置管道为非阻塞模式
        // - handle 是从有效的 stderr 句柄获取的有效 Windows 句柄
        // - PIPE_NOWAIT 是有效的管道模式标志
        // - 即使调用失败，最坏情况是进度输出不够实时，不影响核心功能
        unsafe {
            let mut mode = PIPE_NOWAIT;
            SetNamedPipeHandleState(handle, &mut mode, std::ptr::null_mut(), std::ptr::null_mut());
        }
    }

    let mut reader = BufReader::new(stderr);
    let mut error_output = String::new();
    let mut line_buffer = String::new();

    loop {
        // 检查取消标志
        if cancel_flag.load(Ordering::SeqCst) {
            info!("[SEPARATOR] 人声分离被取消: project_id={}", project_id);
            // 进程已被 kill_child_processes 终止，只需等待回收
            if let Ok(mut guard) = child_handle.lock() {
                if let Some(ref mut child) = *guard {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            return Err(AppError::Cancelled);
        }

        // 检查进程是否结束（需要短暂获取锁）
        let try_wait_result = {
            let mut guard = child_handle.lock().unwrap();
            if let Some(ref mut child) = *guard {
                child.try_wait()
            } else {
                // 进程句柄已被清理（可能被 kill 了）
                return Err(AppError::Cancelled);
            }
        };

        match try_wait_result {
            Ok(Some(_)) => {
                // 进程已结束，读取剩余输出后退出循环
                while let Ok(n) = reader.read_line(&mut line_buffer) {
                    if n == 0 { break; }
                    let line = line_buffer.trim_end();
                    if !line.is_empty() {
                        debug!("audio-separator stderr: {}", line);
                        if !error_output.is_empty() {
                            error_output.push('\n');
                        }
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
                // 进程仍在运行，尝试读取输出
                match reader.read_line(&mut line_buffer) {
                    Ok(0) => {
                        // 没有数据可读，等待后重试
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Ok(_) => {
                        let line = line_buffer.trim_end();
                        if !line.is_empty() {
                            debug!("audio-separator stderr: {}", line);
                            if !error_output.is_empty() {
                                error_output.push('\n');
                            }
                            error_output.push_str(line);
                            if line.contains('%') {
                                if let Some(progress) = parse_progress(line) {
                                    debug!("分离进度: {:.1}%", progress * 100.0);
                                    if let Some(ref cb) = progress_callback {
                                        cb(progress, line);
                                    }
                                }
                            }
                        }
                        line_buffer.clear();
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        // 非阻塞模式下没有数据，等待后重试
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(_) => {
                        // 其他错误，等待后重试
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                }
            }
            Err(e) => {
                error!("检查进程状态失败: {}", e);
                if let Ok(mut guard) = child_handle.lock() {
                    if let Some(ref mut child) = *guard {
                        let _ = child.kill();
                    }
                }
                return Err(AppError::VocalSeparation(format!("检查进程状态失败: {}", e)));
            }
        }
    }

    info!("等待 audio-separator 进程结束...");
    let status = {
        let mut guard = child_handle.lock().unwrap();
        if let Some(ref mut child) = *guard {
            child.wait()?
        } else {
            return Err(AppError::Cancelled);
        }
    };
    info!("audio-separator 进程退出码: {:?}", status.code());

    if !status.success() {
        error!("audio-separator 处理失败，退出码: {:?}", status.code());
        error!("audio-separator 错误输出: {}", error_output);
        let error_msg = if error_output.is_empty() {
            "audio-separator 处理失败（无详细错误信息）".to_string()
        } else {
            format!("audio-separator 处理失败: {}", error_output.chars().take(500).collect::<String>())
        };
        return Err(AppError::VocalSeparation(error_msg));
    }

    info!("audio-separator 处理成功");

    if let Some(ref cb) = progress_callback {
        cb(1.0, "分离完成");
    }

    // 查找输出文件
    // audio-separator 输出格式: {filename}_(Vocals).{ext} 和 {filename}_(Instrumental).{ext}
    let audio_filename = Path::new(audio_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();

    let output_ext = &config.output_format;

    // 尝试多种可能的文件名格式
    // 不同模型输出的文件名格式不同
    // audio-separator 输出格式: {filename}_(Stem)_{model_name}.{ext}
    let model_name_without_ext = model.filename
        .replace(".onnx", "")
        .replace(".ckpt", "")
        .replace(".yaml", "");

    let mut possible_vocals_names = vec![
        // 标准格式: filename_(Vocals)_modelname.ext
        format!("{}_(Vocals)_{}.{}", audio_filename, model_name_without_ext, output_ext),
        // 简单格式
        format!("{}_(Vocals).{}", audio_filename, output_ext),
        format!("{}_Vocals.{}", audio_filename, output_ext),
    ];

    let mut possible_instrumental_names = vec![
        // 标准格式: filename_(Instrumental)_modelname.ext
        format!("{}_(Instrumental)_{}.{}", audio_filename, model_name_without_ext, output_ext),
        // 简单格式
        format!("{}_(Instrumental).{}", audio_filename, output_ext),
        format!("{}_Instrumental.{}", audio_filename, output_ext),
    ];

    // 添加旧版本兼容的文件名格式
    possible_vocals_names.push(format!("{}_(Vocals)_UVR-MDX-NET-Inst_HQ_3.{}", audio_filename, output_ext));
    possible_instrumental_names.push(format!("{}_(Instrumental)_UVR-MDX-NET-Inst_HQ_3.{}", audio_filename, output_ext));

    // 列出输出目录中的文件
    let mut found_files: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(output_dir) {
        for entry in entries.flatten() {
            let filename = entry.file_name().to_string_lossy().to_string();
            found_files.push(filename);
        }
    }
    info!("输出目录中的文件: {:?}", found_files);

    // 查找人声文件
    let vocals_path = possible_vocals_names.iter()
        .map(|name| Path::new(output_dir).join(name))
        .find(|path| path.exists())
        .or_else(|| {
            // 如果预定义的名称都不存在，尝试模糊匹配
            found_files.iter()
                .find(|f| f.contains(&audio_filename.to_string()) &&
                         (f.to_lowercase().contains("vocal") || f.to_lowercase().contains("voice")))
                .map(|f| Path::new(output_dir).join(f))
        });

    // 查找伴奏文件
    let accompaniment_path = possible_instrumental_names.iter()
        .map(|name| Path::new(output_dir).join(name))
        .find(|path| path.exists())
        .or_else(|| {
            // 如果预定义的名称都不存在，尝试模糊匹配
            found_files.iter()
                .find(|f| f.contains(&audio_filename.to_string()) &&
                         (f.to_lowercase().contains("instrument") ||
                          f.to_lowercase().contains("no_vocal") ||
                          f.to_lowercase().contains("no vocal")))
                .map(|f| Path::new(output_dir).join(f))
        });

    let vocals_path = match vocals_path {
        Some(p) => p,
        None => {
            error!("人声文件不存在，已搜索的文件名: {:?}", possible_vocals_names);
            error!("目录中的文件: {:?}", found_files);
            return Err(AppError::VocalSeparation(format!(
                "人声文件不存在，目录中的文件: {:?}",
                found_files
            )));
        }
    };
    info!("人声文件已生成: {}", vocals_path.display());

    let accompaniment_path = accompaniment_path
        .unwrap_or_else(|| Path::new(output_dir).join(format!("{}_(Instrumental).{}", audio_filename, output_ext)));
    info!("伴奏文件路径: {}", accompaniment_path.display());

    // 获取音频时长
    let duration = get_audio_duration(&vocals_path.to_string_lossy())?;

    Ok(SeparationResult {
        vocals_path: vocals_path.to_string_lossy().to_string(),
        accompaniment_path: accompaniment_path.to_string_lossy().to_string(),
        duration,
    })
}

/// 解析进度输出
fn parse_progress(line: &str) -> Option<f32> {
    // 进度输出格式类似: "100%|██████████| 100/100 [00:10<00:00, 10.00it/s]"
    if let Some(pos) = line.find('%') {
        let start = line[..pos].rfind(|c: char| !c.is_ascii_digit()).map(|i| i + 1).unwrap_or(0);
        if let Ok(percent) = line[start..pos].parse::<f32>() {
            return Some(percent / 100.0);
        }
    }
    None
}

/// 解析 audio-separator 路径
/// 优先使用打包版本，否则使用系统 PATH 中的版本
fn resolve_separator_path() -> String {
    use crate::utils::get_exe_dir;

    if let Some(exe_dir) = get_exe_dir() {
        // 检查打包版本：exe目录/audio-separator/audio-separator.exe
        let bundled_path = exe_dir.join("audio-separator").join("audio-separator.exe");
        if bundled_path.exists() {
            return bundled_path.to_string_lossy().to_string();
        }

        // 检查 resources 目录（开发模式）
        let resources_path = exe_dir.join("resources").join("audio-separator").join("audio-separator.exe");
        if resources_path.exists() {
            return resources_path.to_string_lossy().to_string();
        }
    }

    // 回退到系统 PATH
    "audio-separator".to_string()
}
