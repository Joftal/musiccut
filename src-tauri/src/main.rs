// MusicCut - 音频指纹视频剪辑工具
// 主入口文件

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod audio;
mod video;
mod database;
mod config;
mod error;
mod utils;
mod models;
mod logging;
mod detection;

use tauri::{Manager, WindowEvent, PhysicalSize, PhysicalPosition};
use tracing::{info, warn, error};
use std::path::PathBuf;

/// 获取应用数据目录（项目目录下的 data 文件夹）
fn get_app_data_dir() -> PathBuf {
    // 优先使用可执行文件所在目录
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // 开发模式下，exe 在 target/debug 目录，需要回到项目根目录
            let data_dir = if exe_dir.ends_with("target\\debug") || exe_dir.ends_with("target/debug") {
                exe_dir
                    .parent()
                    .and_then(|p| p.parent())
                    .map(|p| p.join("data"))
                    .unwrap_or_else(|| exe_dir.join("data"))
            } else if exe_dir.ends_with("target\\release") || exe_dir.ends_with("target/release") {
                exe_dir
                    .parent()
                    .and_then(|p| p.parent())
                    .map(|p| p.join("data"))
                    .unwrap_or_else(|| exe_dir.join("data"))
            } else {
                // 生产环境，数据目录在 exe 同级
                exe_dir.join("data")
            };
            return data_dir;
        }
    }

    // 回退到当前工作目录
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("data")
}

fn main() {
    // 获取应用数据目录用于日志
    let app_dir = get_app_data_dir();

    // 初始化日志系统 - guard 必须保持存活，否则异步日志线程会退出
    let _log_guard = logging::init_logging(&app_dir);

    info!("MusicCut 启动中...");

    tauri::Builder::default()
        .setup(|app| {
            // 使用项目目录下的 data 文件夹
            let app_dir = get_app_data_dir();

            info!("数据目录: {:?}", app_dir);

            if let Err(e) = std::fs::create_dir_all(&app_dir) {
                warn!("创建应用数据目录失败: {}", e);
            }
            let _ = models::ensure_models_root_dir();
            if let Some(models_dir) = app
                .path_resolver()
                .resource_dir()
                .map(|dir| dir.join("models").join("audio-separator"))
                .filter(|dir| dir.exists())
            {
                info!("使用内置模型目录: {:?}", models_dir);
                models::set_models_cache_dir(models_dir);
            }

            let db_path = app_dir.join("musiccut.db");
            if let Err(e) = database::init_database(&db_path) {
                error!("数据库初始化失败: {}", e);
                return Err(format!("数据库初始化失败: {}\n\n请检查磁盘空间和写入权限。", e).into());
            }

            // 初始化配置
            let config_path = app_dir.join("config.json");
            if let Err(e) = config::init_config(&config_path) {
                error!("配置初始化失败: {}", e);
                return Err(format!("配置初始化失败: {}\n\n请检查磁盘空间和写入权限。", e).into());
            }

            // 恢复窗口状态
            let saved_config = config::get_config();
            let window_state = &saved_config.window_state;

            if let Some(window) = app.get_window("main") {
                // 恢复窗口大小
                let _ = window.set_size(PhysicalSize::new(window_state.width, window_state.height));

                // 恢复窗口位置（如果有保存的位置）
                if let (Some(x), Some(y)) = (window_state.x, window_state.y) {
                    let _ = window.set_position(PhysicalPosition::new(x, y));
                } else {
                    // 没有保存的位置则居中
                    let _ = window.center();
                }

                // 恢复最大化状态
                if window_state.maximized {
                    let _ = window.maximize();
                }

                // 窗口状态恢复完成后再显示窗口，避免闪烁
                let _ = window.show();
            }

            // 创建临时文件目录
            let temp_dir = app_dir.join("temp");
            if let Err(e) = std::fs::create_dir_all(&temp_dir) {
                warn!("创建临时目录失败: {}", e);
            }

            // 创建缩略图目录
            let thumbnails_dir = app_dir.join("thumbnails");
            if let Err(e) = std::fs::create_dir_all(&thumbnails_dir) {
                warn!("创建缩略图目录失败: {}", e);
            }

            // 创建预览视频目录
            let previews_dir = app_dir.join("previews");
            if let Err(e) = std::fs::create_dir_all(&previews_dir) {
                warn!("创建预览视频目录失败: {}", e);
            }

            info!("MusicCut 初始化完成");

            // 异步预检测 GPU 能力，避免首次使用时阻塞
            commands::video::preload_gpu_capabilities();

            // 存储路径到状态
            app.manage(utils::AppState {
                db_path,
                config_path,
                app_dir,
            });

            Ok(())
        })
        .on_window_event(|event| {
            if let WindowEvent::CloseRequested { .. } = event.event() {
                // 窗口关闭前保存窗口状态
                let window = event.window();

                if let (Ok(size), Ok(position), Ok(maximized)) = (
                    window.outer_size(),
                    window.outer_position(),
                    window.is_maximized()
                ) {
                    let current_config = config::get_config();
                    let mut window_state = current_config.window_state;

                    // 如果窗口最大化，保存最大化状态但不更新尺寸
                    // 这样恢复时可以先设置正常尺寸再最大化
                    if !maximized {
                        window_state.width = size.width;
                        window_state.height = size.height;
                        window_state.x = Some(position.x);
                        window_state.y = Some(position.y);
                    }
                    window_state.maximized = maximized;

                    let _ = config::update_window_state(window_state);
                    info!("窗口状态已保存");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // 系统命令
            commands::system::get_system_info,
            commands::system::get_gpu_info,
            commands::system::check_dependencies,

            // 配置命令
            commands::config::get_config,
            commands::config::update_config,
            commands::config::get_acceleration_options,
            commands::config::get_storage_info,
            commands::config::clear_cache,
            commands::config::reset_database,
            commands::config::reset_config,

            // 音乐库命令
            commands::library::import_music_folder,
            commands::library::import_music_files,
            commands::library::get_music_library,
            commands::library::delete_music,
            commands::library::delete_all_music,
            commands::library::search_music,
            commands::library::get_music_info,

            // 指纹命令
            commands::fingerprint::extract_fingerprint,
            commands::fingerprint::match_fingerprint,
            commands::fingerprint::batch_extract_fingerprints,

            // 视频命令
            commands::video::analyze_video,
            commands::video::check_cache_status,
            commands::video::extract_audio,
            commands::video::separate_vocals,
            commands::video::match_video_segments,
            commands::video::cut_video,
            commands::video::export_video,
            commands::video::export_video_separately,
            commands::video::export_custom_clip,
            commands::video::export_custom_clips_merged,
            commands::video::export_custom_clips_separately,
            commands::video::get_video_thumbnail,
            commands::video::cancel_processing,
            commands::video::cancel_preview_generation,
            commands::video::check_needs_preview,
            commands::video::generate_preview_video,

            // 项目命令
            commands::project::create_project,
            commands::project::save_project,
            commands::project::load_project,
            commands::project::get_projects,
            commands::project::delete_project,
            commands::project::delete_all_projects,
            commands::project::update_segments,
            commands::project::update_project_preview,
            commands::project::scan_video_files,
            commands::project::batch_create_projects,

            // 模型命令
            commands::models::get_available_models,
            commands::models::get_models_status,
            commands::models::check_model_downloaded,
            commands::models::get_model_info,
            commands::models::download_model,

            // 人物检测命令
            commands::detection::detect_persons,
            commands::detection::cancel_detection,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            error!("运行 Tauri 应用时出错: {}", e);
            // 在 Windows 上显示错误消息框
            #[cfg(target_os = "windows")]
            {
                use std::ptr::null_mut;
                use std::ffi::CString;
                let msg = CString::new(format!("应用启动失败: {}", e)).unwrap_or_default();
                let title = CString::new("MusicCut 错误").unwrap_or_default();
                // SAFETY: 调用 Windows API MessageBoxA 显示错误对话框
                // - hwnd 为 null 表示无父窗口
                // - msg 和 title 是有效的 CString，在函数调用期间保持有效
                // - 0x10 (MB_ICONERROR) 是有效的消息框类型标志
                // 这是标准的 Windows API FFI 调用，不会导致内存安全问题
                unsafe {
                    extern "system" {
                        fn MessageBoxA(hwnd: *mut std::ffi::c_void, text: *const i8, caption: *const i8, utype: u32) -> i32;
                    }
                    MessageBoxA(null_mut(), msg.as_ptr(), title.as_ptr(), 0x10);
                }
            }
            std::process::exit(1);
        });
}
