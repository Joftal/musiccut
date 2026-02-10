// 项目命令

use crate::database;
use crate::error::{AppError, AppResult};
use crate::utils::{AppState, Project, Segment, generate_id};
use crate::video::ffmpeg;
use chrono::Local;
use tauri::{State, Window};
use tracing::{info, error};
use std::path::Path;

/// 创建项目
#[tauri::command]
pub async fn create_project(
    video_path: String,
) -> AppResult<Project> {
    // 检查项目是否已存在
    if database::project_exists_by_path(&video_path)? {
        return Err(AppError::InvalidArgument(format!("该视频已创建过项目: {}", video_path)));
    }

    // 从文件路径提取项目名称
    let name = Path::new(&video_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("未命名项目")
        .to_string();

    // 获取视频信息
    let video_info = ffmpeg::get_video_info(&video_path)?;

    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let project = Project {
        id: generate_id(),
        name,
        source_video_path: video_path,
        preview_video_path: None,
        video_info,
        segments: Vec::new(),
        created_at: now.clone(),
        updated_at: now,
        file_exists: true,
    };

    database::insert_project(&project)?;

    Ok(project)
}

/// 保存项目
#[tauri::command]
pub async fn save_project(project: Project) -> AppResult<()> {
    let mut updated_project = project;
    updated_project.updated_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    database::update_project(&updated_project)?;

    // 更新片段
    database::delete_segments_by_project(&updated_project.id)?;
    for segment in &updated_project.segments {
        database::insert_segment(segment)?;
    }

    Ok(())
}

/// 加载项目
#[tauri::command]
pub async fn load_project(id: String) -> AppResult<Project> {
    database::get_project_by_id(&id)?
        .ok_or_else(|| AppError::NotFound(format!("项目不存在: {}", id)))
}

/// 获取所有项目
#[tauri::command]
pub async fn get_projects() -> AppResult<Vec<Project>> {
    database::get_all_projects()
}

/// 清理项目关联的文件（缩略图、预览视频、音频处理文件）
fn cleanup_project_files(id: &str, app_dir: &std::path::Path) {
    // 删除缩略图文件
    let thumbnail_path = app_dir.join("thumbnails").join(format!("{}.jpg", id));
    if thumbnail_path.exists() {
        if let Err(e) = std::fs::remove_file(&thumbnail_path) {
            info!("删除缩略图失败: {:?}, 错误: {}", thumbnail_path, e);
        }
    }

    // 删除预览视频文件
    let preview_path = app_dir.join("previews").join(format!("{}.mp4", id));
    if preview_path.exists() {
        if let Err(e) = std::fs::remove_file(&preview_path) {
            info!("删除预览视频失败: {:?}, 错误: {}", preview_path, e);
        }
    }

    // 删除音频处理文件
    let temp_dir = app_dir.join("temp");

    let audio_path = temp_dir.join(format!("{}_audio.wav", id));
    if audio_path.exists() {
        if let Err(e) = std::fs::remove_file(&audio_path) {
            info!("删除音频文件失败: {:?}, 错误: {}", audio_path, e);
        }
    }

    // 删除人声分离目录（包含人声和伴奏文件）
    let separated_dir = temp_dir.join(format!("{}_separated", id));
    if separated_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&separated_dir) {
            info!("删除分离目录失败: {:?}, 错误: {}", separated_dir, e);
        }
    }
}

/// 删除项目
#[tauri::command]
pub async fn delete_project(id: String, state: State<'_, AppState>) -> AppResult<()> {
    // 清理取消标志，避免内存泄漏
    super::video::remove_cancel_flag(&id);

    // 清理关联文件
    cleanup_project_files(&id, &state.app_dir);

    // 删除数据库记录
    database::delete_project(&id)
}

/// 删除所有项目
#[tauri::command]
pub async fn delete_all_projects(state: State<'_, AppState>) -> AppResult<()> {
    // 获取所有项目 ID，用于清理文件
    let projects = database::get_all_projects()?;

    for project in &projects {
        super::video::remove_cancel_flag(&project.id);
        cleanup_project_files(&project.id, &state.app_dir);
    }

    info!("删除所有项目: {} 个", projects.len());

    // 一次性清空数据库
    database::clear_all_projects()
}

/// 更新片段
#[tauri::command]
pub async fn update_segments(
    project_id: String,
    segments: Vec<Segment>,
) -> AppResult<()> {
    // 验证项目存在
    database::get_project_by_id(&project_id)?
        .ok_or_else(|| AppError::NotFound(format!("项目不存在: {}", project_id)))?;

    // 删除旧片段并插入新片段
    database::delete_segments_by_project(&project_id)?;
    database::batch_update_segments(&segments)?;

    // 更新项目时间
    if let Some(mut project) = database::get_project_by_id(&project_id)? {
        project.updated_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        database::update_project(&project)?;
    }

    Ok(())
}

/// 更新项目预览视频路径
#[tauri::command]
pub async fn update_project_preview(
    project_id: String,
    preview_path: String,
) -> AppResult<()> {
    let mut project = database::get_project_by_id(&project_id)?
        .ok_or_else(|| AppError::NotFound(format!("项目不存在: {}", project_id)))?;

    project.preview_video_path = Some(preview_path);
    project.updated_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    database::update_project(&project)?;

    info!("已更新项目预览视频路径: project_id={}", project_id);
    Ok(())
}

/// 扫描文件夹中的视频文件
#[tauri::command]
pub async fn scan_video_files(folder_path: String) -> AppResult<Vec<String>> {
    let video_extensions = ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm"];
    let mut video_files = Vec::new();

    let path = Path::new(&folder_path);
    if !path.is_dir() {
        return Err(AppError::NotFound("文件夹不存在".to_string()));
    }

    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let file_path = entry.path();
        if file_path.is_file() {
            if let Some(ext) = file_path.extension() {
                if video_extensions.contains(&ext.to_str().unwrap_or("").to_lowercase().as_str()) {
                    video_files.push(file_path.to_string_lossy().to_string());
                }
            }
        }
    }

    // 按文件名排序
    video_files.sort();
    info!("扫描到 {} 个视频文件", video_files.len());
    Ok(video_files)
}

/// 批量创建项目
#[tauri::command]
pub async fn batch_create_projects(
    window: Window,
    video_paths: Vec<String>,
    state: State<'_, AppState>,
) -> AppResult<Vec<Project>> {
    let total = video_paths.len();
    let mut projects = Vec::new();
    let mut skipped = 0;
    let mut errors: Vec<String> = Vec::new();

    info!("开始批量创建 {} 个项目", total);

    for (index, video_path) in video_paths.iter().enumerate() {
        // 获取文件名用于进度显示
        let file_name = Path::new(&video_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("未知文件")
            .to_string();

        // 检查项目是否已存在
        match database::project_exists_by_path(video_path) {
            Ok(true) => {
                skipped += 1;
                info!("跳过已存在的项目: {}", video_path);
                let _ = window.emit("batch-create-progress", serde_json::json!({
                    "current": index + 1,
                    "total": total,
                    "message": format!("跳过(已存在): {}", file_name)
                }));
                continue;
            }
            Err(e) => {
                let msg = format!("{}: 检查失败 - {}", file_name, e);
                errors.push(msg);
                error!("检查项目是否存在失败: {}, 跳过: {}", e, video_path);
                continue;
            }
            _ => {}
        }

        // 发送进度事件
        let _ = window.emit("batch-create-progress", serde_json::json!({
            "current": index + 1,
            "total": total,
            "message": format!("处理中: {}", file_name)
        }));

        // 从文件名提取项目名称
        let name = Path::new(&video_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("未命名项目")
            .to_string();

        // 获取视频信息
        let video_info = match ffmpeg::get_video_info(&video_path) {
            Ok(info) => info,
            Err(e) => {
                let msg = format!("{}: 获取视频信息失败 - {}", file_name, e);
                errors.push(msg);
                error!("获取视频信息失败: {}, 跳过: {}", e, video_path);
                continue;
            }
        };

        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let project = Project {
            id: generate_id(),
            name,
            source_video_path: video_path.clone(),
            preview_video_path: None,
            video_info,
            segments: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
            file_exists: true,
        };

        // 插入数据库
        if let Err(e) = database::insert_project(&project) {
            let msg = format!("{}: 保存失败 - {}", file_name, e);
            errors.push(msg);
            error!("插入项目失败: {}, 跳过: {}", e, video_path);
            continue;
        }

        // 生成缩略图
        let thumb_path = state.app_dir.join("thumbnails").join(format!("{}.jpg", project.id));
        if let Err(e) = ffmpeg::extract_thumbnail(&video_path, thumb_path.to_str().unwrap(), 0.0) {
            error!("生成缩略图失败: {}, 项目: {}", e, project.name);
            // 缩略图失败不影响项目创建
        }

        projects.push(project);
    }

    let _ = window.emit("batch-create-complete", serde_json::json!({
        "created": projects.len(),
        "skipped": skipped,
        "errors": errors.len(),
        "error_messages": errors,
        "total": total
    }));

    info!("批量创建完成: 创建 {}, 跳过 {}, 失败 {}, 总计 {}", projects.len(), skipped, errors.len(), total);
    Ok(projects)
}
