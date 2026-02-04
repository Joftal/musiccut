// MusicCut - 日志管理模块
// 提供异步非阻塞的日志持久化功能

use std::path::Path;
use std::fs;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{
    fmt,
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter,
};
use crate::config::{AppConfig, LogLevel};

/// 日志保留天数
const LOG_RETENTION_DAYS: u64 = 7;

/// 从配置文件读取日志级别
fn read_log_level_from_config(app_data_dir: &Path) -> LogLevel {
    let config_path = app_data_dir.join("config.json");

    if let Ok(content) = fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
            return config.log_level;
        }
    }

    // 默认 info 级别
    LogLevel::default()
}

/// 初始化日志系统
///
/// 返回 WorkerGuard，必须在 main 函数中保持存活，否则异步日志线程会提前退出
pub fn init_logging(app_data_dir: &Path) -> WorkerGuard {
    let log_dir = app_data_dir.join("logs");

    // 确保日志目录存在
    if let Err(e) = fs::create_dir_all(&log_dir) {
        eprintln!("创建日志目录失败: {}", e);
    }

    // 清理旧日志文件
    cleanup_old_logs(&log_dir);

    // 按天轮转日志文件
    let file_appender = RollingFileAppender::new(
        Rotation::DAILY,
        &log_dir,
        "musiccut.log",
    );

    // 异步非阻塞写入 - 日志写入在独立线程，不阻塞主线程
    let (non_blocking_writer, guard) = tracing_appender::non_blocking(file_appender);

    // 从配置文件读取日志级别
    let log_level = read_log_level_from_config(app_data_dir);

    // 配置日志过滤器
    // - 使用配置的日志级别
    // - tao 库只记录 error（减少窗口库噪音）
    // - hyper 库只记录 warn（减少 HTTP 库噪音）
    let filter_string = format!("{},tao=error,hyper=warn,reqwest=warn", log_level.as_str());
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| {
            EnvFilter::new(&filter_string)
        });

    // 文件日志层 - 详细格式，包含所有调试信息
    let file_layer = fmt::layer()
        .with_writer(non_blocking_writer)
        .with_ansi(false)  // 文件不需要 ANSI 颜色码
        .with_file(true)   // 记录源文件
        .with_line_number(true)  // 记录行号
        .with_thread_ids(true)   // 记录线程 ID
        .with_target(true);      // 记录模块路径

    // 控制台日志层 - 仅在 debug 模式下启用
    #[cfg(debug_assertions)]
    {
        let console_layer = fmt::layer()
            .with_writer(std::io::stdout)
            .with_ansi(true)
            .with_file(false)
            .with_line_number(false)
            .with_thread_ids(false)
            .with_target(true);

        tracing_subscriber::registry()
            .with(env_filter)
            .with(file_layer)
            .with(console_layer)
            .init();
    }

    #[cfg(not(debug_assertions))]
    {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(file_layer)
            .init();
    }

    guard
}

/// 清理超过保留期限的旧日志文件
fn cleanup_old_logs(log_dir: &Path) {
    let now = std::time::SystemTime::now();
    let retention_duration = std::time::Duration::from_secs(LOG_RETENTION_DAYS * 24 * 60 * 60);

    let entries = match fs::read_dir(log_dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();

        // 只处理日志文件
        if !path.is_file() {
            continue;
        }

        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name,
            None => continue,
        };

        // 只清理 musiccut.log 相关文件
        if !file_name.starts_with("musiccut.log") {
            continue;
        }

        // 检查文件修改时间
        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let modified = match metadata.modified() {
            Ok(t) => t,
            Err(_) => continue,
        };

        // 删除超过保留期限的文件
        if let Ok(age) = now.duration_since(modified) {
            if age > retention_duration {
                if let Err(e) = fs::remove_file(&path) {
                    eprintln!("删除旧日志文件失败 {:?}: {}", path, e);
                }
            }
        }
    }
}
