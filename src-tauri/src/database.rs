// 数据库模块

use rusqlite::{Connection, params};
use std::path::Path;
use std::sync::Mutex;
use std::collections::HashMap;
use once_cell::sync::OnceCell;
use tracing::{warn, error, info, debug};
use rayon::prelude::*;
use crate::error::{AppError, AppResult};
use crate::utils::{MusicInfo, Project, Segment, VideoInfo, SegmentStatus};

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

/// 初始化数据库
pub fn init_database(db_path: &Path) -> AppResult<()> {
    let conn = Connection::open(db_path)?;

    // 创建音乐表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS music (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            album TEXT,
            duration REAL NOT NULL,
            file_path TEXT NOT NULL UNIQUE,
            fingerprint BLOB NOT NULL,
            fingerprint_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )",
        [],
    )?;

    // 创建指纹哈希索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_music_hash ON music(fingerprint_hash)",
        [],
    )?;

    // 创建项目表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source_video_path TEXT NOT NULL,
            preview_video_path TEXT,
            video_info TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )",
        [],
    )?;

    // 创建片段表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS segments (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            music_id TEXT,
            start_time REAL NOT NULL,
            end_time REAL NOT NULL,
            confidence REAL DEFAULT 0,
            status TEXT DEFAULT 'detected',
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (music_id) REFERENCES music(id) ON DELETE SET NULL
        )",
        [],
    )?;

    // 创建片段索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_segments_project ON segments(project_id)",
        [],
    )?;

    // 创建 music_id 索引（用于 JOIN 查询）
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_segments_music_id ON segments(music_id)",
        [],
    )?;

    // 创建 start_time 索引（用于排序）
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_segments_start_time ON segments(start_time)",
        [],
    )?;

    DB.set(Mutex::new(conn))
        .map_err(|_| AppError::Database(rusqlite::Error::InvalidQuery))?;

    Ok(())
}

/// 获取数据库连接
fn get_conn() -> AppResult<std::sync::MutexGuard<'static, Connection>> {
    let mutex = DB.get()
        .ok_or_else(|| AppError::Database(rusqlite::Error::InvalidQuery))?;

    match mutex.lock() {
        Ok(guard) => Ok(guard),
        Err(poisoned) => {
            // Mutex 被毒化意味着持有锁的线程发生了 panic
            // 数据库可能处于不一致状态，记录错误并返回失败
            error!(
                "数据库 Mutex 被毒化：持有锁的线程发生 panic，数据库可能处于不一致状态。\
                建议重启应用程序。"
            );
            // 仍然恢复连接以避免应用完全不可用，但记录严重警告
            warn!("尝试恢复毒化的 Mutex，后续操作可能不稳定");
            Ok(poisoned.into_inner())
        }
    }
}

// ==================== 音乐库操作 ====================

/// 插入音乐
pub fn insert_music(music: &MusicInfo, fingerprint: &[u8]) -> AppResult<()> {
    let conn = get_conn()?;
    conn.execute(
        "INSERT OR REPLACE INTO music (id, title, album, duration, file_path, fingerprint, fingerprint_hash, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            music.id,
            music.title,
            music.album,
            music.duration,
            music.file_path,
            fingerprint,
            music.fingerprint_hash,
            music.created_at,
        ],
    )?;
    Ok(())
}

/// 获取所有音乐
pub fn get_all_music() -> AppResult<Vec<MusicInfo>> {
    let conn = get_conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, title, album, duration, file_path, fingerprint_hash, created_at FROM music ORDER BY title COLLATE NOCASE ASC"
    )?;

    let music_iter = stmt.query_map([], |row| {
        Ok(MusicInfo {
            id: row.get(0)?,
            title: row.get(1)?,
            album: row.get(2)?,
            duration: row.get(3)?,
            file_path: row.get(4)?,
            fingerprint_hash: row.get(5)?,
            created_at: row.get(6)?,
            file_exists: false, // 稍后批量检查
        })
    })?;

    let mut music_list = Vec::new();
    for music in music_iter {
        music_list.push(music?);
    }

    // 释放数据库连接后批量检查文件存在性
    drop(stmt);
    drop(conn);

    // 并行检查文件存在性（使用 rayon 提升大量文件时的性能）
    music_list.par_iter_mut().for_each(|music| {
        music.file_exists = Path::new(&music.file_path).exists();
    });

    Ok(music_list)
}

/// 搜索音乐
pub fn search_music(query: &str) -> AppResult<Vec<MusicInfo>> {
    let conn = get_conn()?;
    let pattern = format!("%{}%", query);
    let mut stmt = conn.prepare(
        "SELECT id, title, album, duration, file_path, fingerprint_hash, created_at
         FROM music
         WHERE title LIKE ?1 OR album LIKE ?1
         ORDER BY title COLLATE NOCASE ASC"
    )?;

    let music_iter = stmt.query_map([&pattern], |row| {
        Ok(MusicInfo {
            id: row.get(0)?,
            title: row.get(1)?,
            album: row.get(2)?,
            duration: row.get(3)?,
            file_path: row.get(4)?,
            fingerprint_hash: row.get(5)?,
            created_at: row.get(6)?,
            file_exists: false, // 稍后批量检查
        })
    })?;

    let mut music_list = Vec::new();
    for music in music_iter {
        music_list.push(music?);
    }

    // 释放数据库连接后批量检查文件存在性
    drop(stmt);
    drop(conn);

    // 并行检查文件存在性（使用 rayon 提升大量文件时的性能）
    music_list.par_iter_mut().for_each(|music| {
        music.file_exists = Path::new(&music.file_path).exists();
    });

    Ok(music_list)
}

/// 获取单个音乐信息
pub fn get_music_by_id(id: &str) -> AppResult<Option<MusicInfo>> {
    let conn = get_conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, title, album, duration, file_path, fingerprint_hash, created_at FROM music WHERE id = ?1"
    )?;

    let mut rows = stmt.query([id])?;
    if let Some(row) = rows.next()? {
        let file_path: String = row.get(4)?;
        let file_exists = Path::new(&file_path).exists();

        Ok(Some(MusicInfo {
            id: row.get(0)?,
            title: row.get(1)?,
            album: row.get(2)?,
            duration: row.get(3)?,
            file_path,
            fingerprint_hash: row.get(5)?,
            created_at: row.get(6)?,
            file_exists,
        }))
    } else {
        Ok(None)
    }
}

/// 获取所有音乐指纹
pub fn get_all_fingerprints() -> AppResult<Vec<(String, String, Vec<u8>)>> {
    let conn = get_conn()?;
    let mut stmt = conn.prepare("SELECT id, title, fingerprint FROM music")?;

    let iter = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Vec<u8>>(2)?,
        ))
    })?;

    let mut result = Vec::new();
    for item in iter {
        result.push(item?);
    }

    Ok(result)
}

/// 根据 ID 列表获取指定音乐的指纹
pub fn get_fingerprints_by_ids(ids: &[String]) -> AppResult<Vec<(String, String, Vec<u8>)>> {
    debug!("get_fingerprints_by_ids: 请求 {} 个音乐 ID", ids.len());

    if ids.is_empty() {
        debug!("get_fingerprints_by_ids: ID 列表为空，返回空结果");
        return Ok(Vec::new());
    }

    let conn = get_conn()?;

    // 构建 IN 子句的占位符
    let placeholders: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
    let sql = format!(
        "SELECT id, title, fingerprint FROM music WHERE id IN ({})",
        placeholders.join(", ")
    );

    debug!("get_fingerprints_by_ids: 执行查询，ID 列表: {:?}", ids);

    let mut stmt = conn.prepare(&sql)?;

    // 将 ids 转换为 rusqlite 参数
    let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();

    let iter = stmt.query_map(params.as_slice(), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Vec<u8>>(2)?,
        ))
    })?;

    let mut result = Vec::new();
    for item in iter {
        result.push(item?);
    }

    // 检查是否有 ID 未找到对应的指纹
    if result.len() != ids.len() {
        let found_ids: std::collections::HashSet<_> = result.iter().map(|(id, _, _)| id.clone()).collect();
        let missing_ids: Vec<_> = ids.iter().filter(|id| !found_ids.contains(*id)).collect();
        warn!(
            "get_fingerprints_by_ids: 请求 {} 个，实际获取 {} 个，缺失 ID: {:?}",
            ids.len(),
            result.len(),
            missing_ids
        );
    } else {
        info!(
            "get_fingerprints_by_ids: 成功获取 {} 个音乐指纹",
            result.len()
        );
    }

    Ok(result)
}

/// 删除音乐
pub fn delete_music(id: &str) -> AppResult<()> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM music WHERE id = ?1", [id])?;
    Ok(())
}

/// 检查文件是否已存在
pub fn music_exists_by_path(path: &str) -> AppResult<bool> {
    let conn = get_conn()?;
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM music WHERE file_path = ?1",
        [path],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

// ==================== 项目操作 ====================

/// 检查项目是否已存在（通过视频路径）
pub fn project_exists_by_path(path: &str) -> AppResult<bool> {
    let conn = get_conn()?;
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM projects WHERE source_video_path = ?1",
        [path],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// 插入项目
pub fn insert_project(project: &Project) -> AppResult<()> {
    let conn = get_conn()?;
    let video_info_json = serde_json::to_string(&project.video_info)?;

    conn.execute(
        "INSERT INTO projects (id, name, source_video_path, preview_video_path, video_info, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            project.id,
            project.name,
            project.source_video_path,
            project.preview_video_path,
            video_info_json,
            project.created_at,
            project.updated_at,
        ],
    )?;

    // 插入片段
    for segment in &project.segments {
        insert_segment(segment)?;
    }

    Ok(())
}

/// 更新项目
pub fn update_project(project: &Project) -> AppResult<()> {
    let conn = get_conn()?;
    let video_info_json = serde_json::to_string(&project.video_info)?;

    conn.execute(
        "UPDATE projects SET name = ?2, preview_video_path = ?3, video_info = ?4, updated_at = ?5 WHERE id = ?1",
        params![
            project.id,
            project.name,
            project.preview_video_path,
            video_info_json,
            project.updated_at,
        ],
    )?;

    Ok(())
}

/// 获取所有项目
pub fn get_all_projects() -> AppResult<Vec<Project>> {
    let conn = get_conn()?;

    // 查询 1: 获取所有项目基本信息（不在查询中检查文件存在性）
    let mut stmt = conn.prepare(
        "SELECT id, name, source_video_path, preview_video_path, video_info, created_at, updated_at FROM projects ORDER BY updated_at DESC"
    )?;

    let project_iter = stmt.query_map([], |row| {
        let video_info_json: String = row.get(4)?;
        let video_info: VideoInfo = serde_json::from_str(&video_info_json).unwrap_or_else(|e| {
            // 记录警告日志，便于排查数据损坏问题
            tracing::warn!("项目视频信息 JSON 解析失败: {}，使用默认值", e);
            VideoInfo {
                path: String::new(),
                filename: String::new(),
                duration: 0.0,
                width: 0,
                height: 0,
                fps: 0.0,
                video_codec: String::new(),
                audio_codec: String::new(),
                bitrate: 0,
                size: 0,
                format: String::new(),
            }
        });

        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            source_video_path: row.get(2)?,
            preview_video_path: row.get(3)?,
            video_info,
            segments: Vec::new(),
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            file_exists: false, // 稍后批量检查
        })
    })?;

    let mut projects: Vec<Project> = Vec::new();
    for project in project_iter {
        projects.push(project?);
    }

    // 查询 2: 一次性获取所有片段（解决 N+1 查询问题）
    let mut seg_stmt = conn.prepare(
        "SELECT s.id, s.project_id, s.music_id, m.title,
                s.start_time, s.end_time, s.confidence, s.status
         FROM segments s
         LEFT JOIN music m ON s.music_id = m.id
         ORDER BY s.start_time"
    )?;

    let segment_iter = seg_stmt.query_map([], |row| {
        let status_str: String = row.get(7)?;
        let status = match status_str.as_str() {
            "removed" => SegmentStatus::Removed,
            _ => SegmentStatus::Detected,
        };

        Ok(Segment {
            id: row.get(0)?,
            project_id: row.get(1)?,
            music_id: row.get(2)?,
            music_title: row.get(3)?,
            start_time: row.get(4)?,
            end_time: row.get(5)?,
            confidence: row.get(6)?,
            status,
        })
    })?;

    // 按 project_id 分组片段
    let mut segments_map: HashMap<String, Vec<Segment>> = HashMap::new();
    for segment in segment_iter {
        let seg = segment?;
        segments_map.entry(seg.project_id.clone())
            .or_default()
            .push(seg);
    }

    // 释放数据库连接
    drop(seg_stmt);
    drop(stmt);
    drop(conn);

    // 并行检查文件存在性并分配片段（使用 rayon 提升大量项目时的性能）
    projects.par_iter_mut().for_each(|project| {
        project.file_exists = Path::new(&project.source_video_path).exists();
    });
    for project in &mut projects {
        project.segments = segments_map.remove(&project.id).unwrap_or_default();
    }

    Ok(projects)
}

/// 获取单个项目
pub fn get_project_by_id(id: &str) -> AppResult<Option<Project>> {
    let project_data: Option<(String, String, String, Option<String>, VideoInfo, String, String, bool)>;

    {
        let conn = get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, source_video_path, preview_video_path, video_info, created_at, updated_at FROM projects WHERE id = ?1"
        )?;

        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            let video_info_json: String = row.get(4)?;
            let video_info: VideoInfo = serde_json::from_str(&video_info_json)?;
            let source_video_path: String = row.get(2)?;
            let file_exists = Path::new(&source_video_path).exists();

            project_data = Some((
                row.get(0)?,
                row.get(1)?,
                source_video_path,
                row.get(3)?,
                video_info,
                row.get(5)?,
                row.get(6)?,
                file_exists,
            ));
        } else {
            return Ok(None);
        }
    }

    // 连接已释放，现在可以安全地获取片段
    if let Some((proj_id, name, source_video_path, preview_video_path, video_info, created_at, updated_at, file_exists)) = project_data {
        let segments = get_segments_by_project(&proj_id)?;

        Ok(Some(Project {
            id: proj_id,
            name,
            source_video_path,
            preview_video_path,
            video_info,
            segments,
            created_at,
            updated_at,
            file_exists,
        }))
    } else {
        Ok(None)
    }
}

/// 删除项目
pub fn delete_project(id: &str) -> AppResult<()> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM segments WHERE project_id = ?1", [id])?;
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    Ok(())
}

// ==================== 片段操作 ====================

/// 插入片段
pub fn insert_segment(segment: &Segment) -> AppResult<()> {
    let conn = get_conn()?;
    let status = match segment.status {
        SegmentStatus::Detected => "detected",
        SegmentStatus::Removed => "removed",
    };

    conn.execute(
        "INSERT OR REPLACE INTO segments (id, project_id, music_id, start_time, end_time, confidence, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            segment.id,
            segment.project_id,
            segment.music_id,
            segment.start_time,
            segment.end_time,
            segment.confidence,
            status,
        ],
    )?;
    Ok(())
}

/// 获取项目的所有片段
pub fn get_segments_by_project(project_id: &str) -> AppResult<Vec<Segment>> {
    let conn = get_conn()?;
    // 使用 LEFT JOIN 从 music 表获取标题
    let mut stmt = conn.prepare(
        "SELECT s.id, s.project_id, s.music_id, m.title,
                s.start_time, s.end_time, s.confidence, s.status
         FROM segments s
         LEFT JOIN music m ON s.music_id = m.id
         WHERE s.project_id = ?1 ORDER BY s.start_time"
    )?;

    let segment_iter = stmt.query_map([project_id], |row| {
        let status_str: String = row.get(7)?;
        let status = match status_str.as_str() {
            "removed" => SegmentStatus::Removed,
            _ => SegmentStatus::Detected,
        };

        Ok(Segment {
            id: row.get(0)?,
            project_id: row.get(1)?,
            music_id: row.get(2)?,
            music_title: row.get(3)?,
            start_time: row.get(4)?,
            end_time: row.get(5)?,
            confidence: row.get(6)?,
            status,
        })
    })?;

    let mut segments = Vec::new();
    for segment in segment_iter {
        segments.push(segment?);
    }

    Ok(segments)
}

/// 删除项目的所有片段
pub fn delete_segments_by_project(project_id: &str) -> AppResult<()> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM segments WHERE project_id = ?1", [project_id])?;
    Ok(())
}

/// 批量插入/更新片段（使用事务，只获取一次锁）
pub fn batch_insert_segments(segments: &[Segment]) -> AppResult<()> {
    if segments.is_empty() {
        return Ok(());
    }
    let conn = get_conn()?;
    conn.execute_batch("BEGIN")?;
    for segment in segments {
        let status = match segment.status {
            SegmentStatus::Detected => "detected",
            SegmentStatus::Removed => "removed",
        };
        if let Err(e) = conn.execute(
            "INSERT OR REPLACE INTO segments (id, project_id, music_id, start_time, end_time, confidence, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                segment.id,
                segment.project_id,
                segment.music_id,
                segment.start_time,
                segment.end_time,
                segment.confidence,
                status,
            ],
        ) {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(AppError::Database(e));
        }
    }
    conn.execute_batch("COMMIT")?;
    Ok(())
}

/// 批量更新片段
pub fn batch_update_segments(segments: &[Segment]) -> AppResult<()> {
    batch_insert_segments(segments)
}

/// 清空所有数据（重置数据库）
pub fn clear_all_data() -> AppResult<()> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM segments", [])?;
    conn.execute("DELETE FROM projects", [])?;
    conn.execute("DELETE FROM music", [])?;
    Ok(())
}

/// 清空所有项目和片段
pub fn clear_all_projects() -> AppResult<()> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM segments", [])?;
    conn.execute("DELETE FROM projects", [])?;
    Ok(())
}

/// 清空所有音乐
pub fn clear_all_music() -> AppResult<()> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM music", [])?;
    Ok(())
}
