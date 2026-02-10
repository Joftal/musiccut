// 音乐库命令

use crate::database;
use crate::error::{AppError, AppResult};
use crate::utils::{MusicInfo, generate_id};
use crate::audio::fingerprint;
use std::path::Path;
use walkdir::WalkDir;
use tauri::Window;
use chrono::Local;

/// 支持的音频格式
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "m4a", "aac", "ogg", "wma"];

/// 导入音乐文件夹
#[tauri::command]
pub async fn import_music_folder(
    window: Window,
    path: String,
) -> AppResult<Vec<MusicInfo>> {
    let folder_path = Path::new(&path);
    if !folder_path.exists() {
        return Err(AppError::NotFound(format!("文件夹不存在: {}", path)));
    }

    // 收集所有音频文件
    let audio_files: Vec<String> = WalkDir::new(folder_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            if let Some(ext) = e.path().extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                AUDIO_EXTENSIONS.contains(&ext_lower.as_str())
            } else {
                false
            }
        })
        .map(|e| e.path().to_string_lossy().to_string())
        .collect();

    let total = audio_files.len();
    if total == 0 {
        return Ok(Vec::new());
    }

    // 发送进度事件
    let _ = window.emit("import-progress", serde_json::json!({
        "current": 0,
        "total": total,
        "message": format!("发现 {} 个音频文件", total)
    }));

    // 顺序处理音频文件（避免并行访问数据库导致死锁）
    let mut imported = Vec::new();
    let mut skipped = 0;
    let mut errors = Vec::new();

    for (index, file_path) in audio_files.iter().enumerate() {
        let file_name = Path::new(file_path).file_name().unwrap_or_default().to_string_lossy();

        // 检查是否已存在
        match database::music_exists_by_path(file_path) {
            Ok(true) => {
                skipped += 1;
                let _ = window.emit("import-progress", serde_json::json!({
                    "current": index + 1,
                    "total": total,
                    "message": format!("跳过(已存在): {}", file_name)
                }));
                continue;
            }
            Err(e) => {
                tracing::warn!("检查文件是否存在失败 {}: {}", file_path, e);
                errors.push(format!("{}: {}", file_name, e));
                continue;
            }
            _ => {}
        }

        // 发送进度
        let _ = window.emit("import-progress", serde_json::json!({
            "current": index + 1,
            "total": total,
            "message": format!("处理中: {}", file_name)
        }));

        match process_audio_file(file_path) {
            Ok(music) => imported.push(music),
            Err(e) => {
                tracing::warn!("导入音乐失败 {}: {}", file_path, e);
                errors.push(format!("{}: {}", file_name, e));
            }
        }
    }

    // 发送完成事件
    let _ = window.emit("import-complete", serde_json::json!({
        "imported": imported.len(),
        "skipped": skipped,
        "errors": errors.len(),
        "error_messages": errors
    }));

    Ok(imported)
}

/// 导入音乐文件
#[tauri::command]
pub async fn import_music_files(
    window: Window,
    paths: Vec<String>,
) -> AppResult<Vec<MusicInfo>> {
    let total = paths.len();
    if total == 0 {
        return Ok(Vec::new());
    }

    let mut imported = Vec::new();
    let mut skipped = 0;

    for (index, file_path) in paths.iter().enumerate() {
        let file_name = Path::new(file_path).file_name().unwrap_or_default().to_string_lossy();

        // 检查是否已存在
        match database::music_exists_by_path(file_path) {
            Ok(true) => {
                skipped += 1;
                let _ = window.emit("import-progress", serde_json::json!({
                    "current": index + 1,
                    "total": total,
                    "message": format!("跳过(已存在): {}", file_name)
                }));
                continue;
            }
            Err(e) => {
                tracing::warn!("检查文件是否存在失败 {}: {}", file_path, e);
                continue;
            }
            _ => {}
        }

        let _ = window.emit("import-progress", serde_json::json!({
            "current": index + 1,
            "total": total,
            "message": format!("处理中: {}", file_name)
        }));

        match process_audio_file(file_path) {
            Ok(music) => imported.push(music),
            Err(e) => {
                tracing::warn!("导入音乐失败 {}: {}", file_path, e);
            }
        }
    }

    // 发送完成事件
    let _ = window.emit("import-complete", serde_json::json!({
        "imported": imported.len(),
        "skipped": skipped,
        "total": total
    }));

    Ok(imported)
}

/// 处理单个音频文件
fn process_audio_file(file_path: &str) -> AppResult<MusicInfo> {
    // 提取指纹
    let (fingerprint_data, duration) = fingerprint::extract_fingerprint_from_file(file_path)?;
    let fingerprint_hash = fingerprint::compute_fingerprint_hash(&fingerprint_data);

    // 获取文件名作为标题
    let path = Path::new(file_path);
    let title = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "未知".to_string());

    let music = MusicInfo {
        id: generate_id(),
        title,
        album: None,
        duration,
        file_path: file_path.to_string(),
        fingerprint_hash,
        created_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        file_exists: true,
    };

    // 保存到数据库
    database::insert_music(&music, &fingerprint_data)?;

    Ok(music)
}

/// 获取音乐库
#[tauri::command]
pub async fn get_music_library() -> AppResult<Vec<MusicInfo>> {
    database::get_all_music()
}

/// 删除音乐
#[tauri::command]
pub async fn delete_music(id: String) -> AppResult<()> {
    database::delete_music(&id)
}

/// 删除所有音乐
#[tauri::command]
pub async fn delete_all_music() -> AppResult<()> {
    database::clear_all_music()
}

/// 搜索音乐
#[tauri::command]
pub async fn search_music(query: String) -> AppResult<Vec<MusicInfo>> {
    if query.is_empty() {
        return database::get_all_music();
    }
    database::search_music(&query)
}

/// 获取音乐信息
#[tauri::command]
pub async fn get_music_info(id: String) -> AppResult<Option<MusicInfo>> {
    database::get_music_by_id(&id)
}
