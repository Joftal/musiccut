// 系统命令

use crate::error::AppResult;
use crate::utils::{SystemInfo, GpuInfo, DependencyCheck, resolve_tool_path, hidden_command};

/// 获取系统信息
#[tauri::command]
pub async fn get_system_info() -> AppResult<SystemInfo> {
    let (cpu_model, cpu_cores, cpu_threads) = get_cpu_info();
    let gpu = detect_gpu().await?;
    let ffmpeg_version = get_ffmpeg_version().await;
    let fpcalc_available = check_fpcalc().await;
    let python_available = check_python().await;

    Ok(SystemInfo {
        os: std::env::consts::OS.to_string(),
        cpu_model,
        cpu_cores,
        cpu_threads,
        memory: get_system_memory(),
        gpu,
        ffmpeg_version,
        fpcalc_available,
        python_available,
    })
}

/// 获取 GPU 信息
#[tauri::command]
pub async fn get_gpu_info() -> AppResult<GpuInfo> {
    detect_gpu().await
}

/// 检查依赖
#[tauri::command]
pub async fn check_dependencies() -> AppResult<Vec<DependencyCheck>> {
    let mut checks = Vec::new();

    // 检查 FFmpeg
    let ffmpeg = check_ffmpeg_dependency().await;
    checks.push(ffmpeg);

    // 检查 FFprobe
    let ffprobe = check_ffprobe_dependency().await;
    checks.push(ffprobe);

    // 检查 fpcalc (Chromaprint)
    let fpcalc = check_fpcalc_dependency().await;
    checks.push(fpcalc);

    // 检查 Python
    let python = check_python_dependency().await;
    checks.push(python);

    // 检查 CUDA
    let cuda = check_cuda_dependency().await;
    checks.push(cuda);

    Ok(checks)
}

/// 检测 GPU
async fn detect_gpu() -> AppResult<GpuInfo> {
    // 导入 GPU 能力检测
    use crate::commands::video::detect_gpu_capabilities;
    let gpu_caps = detect_gpu_capabilities();

    // 尝试检测 NVIDIA GPU
    if let Ok(output) = hidden_command("nvidia-smi")
        .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let parts: Vec<&str> = stdout.trim().split(", ").collect();
            if parts.len() >= 2 {
                let name = parts[0].to_string();
                let memory: u64 = parts[1].parse().unwrap_or(0) * 1024 * 1024; // MB to bytes

                return Ok(GpuInfo {
                    available: true,
                    name,
                    gpu_type: "nvidia".to_string(),
                    memory,
                    onnx_gpu_available: gpu_caps.onnx_gpu_available,
                });
            }
        }
    }

    // 尝试检测 AMD GPU (Windows)
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command("wmic")
            .args(["path", "win32_VideoController", "get", "name"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.to_lowercase().contains("amd") || stdout.to_lowercase().contains("radeon") {
                return Ok(GpuInfo {
                    available: true,
                    name: "AMD GPU".to_string(),
                    gpu_type: "amd".to_string(),
                    memory: 0,
                    onnx_gpu_available: gpu_caps.onnx_gpu_available,
                });
            }
            if stdout.to_lowercase().contains("intel") {
                return Ok(GpuInfo {
                    available: true,
                    name: "Intel GPU".to_string(),
                    gpu_type: "intel".to_string(),
                    memory: 0,
                    onnx_gpu_available: gpu_caps.onnx_gpu_available,
                });
            }
        }
    }

    Ok(GpuInfo {
        available: false,
        name: "None".to_string(),
        gpu_type: "none".to_string(),
        memory: 0,
        onnx_gpu_available: false,
    })
}

/// 获取 CUDA 版本
async fn get_cuda_version() -> Option<String> {
    if let Ok(output) = hidden_command("nvcc").args(["--version"]).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // 解析版本号
            for line in stdout.lines() {
                if line.contains("release") {
                    if let Some(version) = line.split("release").nth(1) {
                        let version = version.trim().split(',').next().unwrap_or("").trim();
                        return Some(version.to_string());
                    }
                }
            }
        }
    }

    // 尝试从 nvidia-smi 获取
    if let Ok(output) = hidden_command("nvidia-smi").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().find(|l| l.contains("CUDA Version")) {
                if let Some(version) = line.split("CUDA Version:").nth(1) {
                    return Some(version.trim().split_whitespace().next().unwrap_or("").to_string());
                }
            }
        }
    }

    None
}

/// 获取系统内存
fn get_system_memory() -> u64 {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command("wmic")
            .args(["computersystem", "get", "totalphysicalmemory"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if let Ok(mem) = line.trim().parse::<u64>() {
                    return mem;
                }
            }
        }
    }
    0
}

/// 获取 FFmpeg 版本
async fn get_ffmpeg_version() -> Option<String> {
    let ffmpeg_path = resolve_tool_path("ffmpeg");
    if let Ok(output) = hidden_command(&ffmpeg_path).args(["-version"]).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().next() {
                return Some(line.to_string());
            }
        }
    }
    None
}

/// 检查 fpcalc
async fn check_fpcalc() -> bool {
    let fpcalc_path = resolve_tool_path("fpcalc");
    hidden_command(&fpcalc_path)
        .args(["-version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 检查 Python
async fn check_python() -> bool {
    hidden_command("python")
        .args(["--version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 检查 FFmpeg 依赖
async fn check_ffmpeg_dependency() -> DependencyCheck {
    let ffmpeg_path = resolve_tool_path("ffmpeg");
    if let Ok(output) = hidden_command(&ffmpeg_path).args(["-version"]).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let version = stdout.lines().next().map(|s| s.to_string());
            return DependencyCheck {
                name: "FFmpeg".to_string(),
                available: true,
                version,
                path: Some(ffmpeg_path),
                message: "FFmpeg 已安装".to_string(),
            };
        }
    }
    DependencyCheck {
        name: "FFmpeg".to_string(),
        available: false,
        version: None,
        path: None,
        message: "FFmpeg 未安装，请安装 FFmpeg 并添加到 PATH".to_string(),
    }
}

/// 检查 FFprobe 依赖
async fn check_ffprobe_dependency() -> DependencyCheck {
    let ffprobe_path = resolve_tool_path("ffprobe");
    if let Ok(output) = hidden_command(&ffprobe_path).args(["-version"]).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let version = stdout.lines().next().map(|s| s.to_string());
            return DependencyCheck {
                name: "FFprobe".to_string(),
                available: true,
                version,
                path: Some(ffprobe_path),
                message: "FFprobe 已安装".to_string(),
            };
        }
    }
    DependencyCheck {
        name: "FFprobe".to_string(),
        available: false,
        version: None,
        path: None,
        message: "FFprobe 未安装，请安装 FFmpeg 并添加到 PATH".to_string(),
    }
}

/// 检查 fpcalc 依赖
async fn check_fpcalc_dependency() -> DependencyCheck {
    let fpcalc_path = resolve_tool_path("fpcalc");
    if let Ok(output) = hidden_command(&fpcalc_path).args(["-version"]).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let version = Some(stdout.trim().to_string());
            return DependencyCheck {
                name: "Chromaprint (fpcalc)".to_string(),
                available: true,
                version,
                path: Some(fpcalc_path),
                message: "Chromaprint 已安装".to_string(),
            };
        }
    }
    DependencyCheck {
        name: "Chromaprint (fpcalc)".to_string(),
        available: false,
        version: None,
        path: None,
        message: "Chromaprint 未安装，请从 https://acoustid.org/chromaprint 下载".to_string(),
    }
}

/// 检查 Python 依赖
async fn check_python_dependency() -> DependencyCheck {
    if let Ok(output) = hidden_command("python").args(["--version"]).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let version = Some(stdout.trim().to_string());
            return DependencyCheck {
                name: "Python".to_string(),
                available: true,
                version,
                path: Some("python".to_string()),
                message: "Python 已安装".to_string(),
            };
        }
    }
    DependencyCheck {
        name: "Python".to_string(),
        available: false,
        version: None,
        path: None,
        message: "Python 未安装，请安装 Python 3.10+".to_string(),
    }
}

/// 获取 CPU 信息
fn get_cpu_info() -> (String, usize, usize) {
    let mut cpu_model = "Unknown".to_string();
    let mut cpu_threads = num_cpus::get();
    let mut cpu_cores = num_cpus::get_physical();

    if cpu_cores == 0 {
        cpu_cores = cpu_threads;
    }

    #[cfg(target_os = "windows")]
    {
        if let Some((model, cores, threads)) = get_cpu_info_windows() {
            if !model.is_empty() {
                cpu_model = model;
            }
            if cores > 0 {
                cpu_cores = cores;
            }
            if threads > 0 {
                cpu_threads = threads;
            }
        }
    }

    (cpu_model, cpu_cores, cpu_threads)
}

#[cfg(target_os = "windows")]
fn get_cpu_info_windows() -> Option<(String, usize, usize)> {
    let output = hidden_command("wmic")
        .args([
            "cpu",
            "get",
            "Name,NumberOfCores,NumberOfLogicalProcessors",
            "/format:list",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut name: Option<String> = None;
    let mut cores: Option<usize> = None;
    let mut threads: Option<usize> = None;

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let (key, value) = match line.split_once('=') {
            Some(pair) => pair,
            None => continue,
        };

        let value = value.trim();
        match key {
            "Name" => {
                if !value.is_empty() {
                    name = Some(value.to_string());
                }
            }
            "NumberOfCores" => {
                cores = value.parse::<usize>().ok();
            }
            "NumberOfLogicalProcessors" => {
                threads = value.parse::<usize>().ok();
            }
            _ => {}
        }
    }

    if name.is_none() && cores.is_none() && threads.is_none() {
        return None;
    }

    Some((
        name.unwrap_or_else(|| "Unknown".to_string()),
        cores.unwrap_or(0),
        threads.unwrap_or(0),
    ))
}

/// 检查 CUDA 依赖
async fn check_cuda_dependency() -> DependencyCheck {
    if let Some(version) = get_cuda_version().await {
        return DependencyCheck {
            name: "CUDA".to_string(),
            available: true,
            version: Some(version),
            path: None,
            message: "CUDA 已安装，GPU 加速可用".to_string(),
        };
    }
    DependencyCheck {
        name: "CUDA".to_string(),
        available: false,
        version: None,
        path: None,
        message: "CUDA 未安装，GPU 加速不可用".to_string(),
    }
}
