// 指纹命令

use crate::database;
use crate::error::AppResult;
use crate::utils::MatchResult;
use crate::audio::fingerprint;
use tauri::Window;
use rayon::prelude::*;

/// 提取指纹
#[tauri::command]
pub async fn extract_fingerprint(audio_path: String) -> AppResult<String> {
    let (fingerprint_data, _duration) = fingerprint::extract_fingerprint_from_file(&audio_path)?;
    let hash = fingerprint::compute_fingerprint_hash(&fingerprint_data);
    Ok(hash)
}

/// 匹配指纹
#[tauri::command]
pub async fn match_fingerprint(
    audio_path: String,
    min_confidence: Option<f64>,
) -> AppResult<Vec<MatchResult>> {
    let min_conf = min_confidence.unwrap_or(0.6);

    // 提取待匹配音频的指纹
    let (query_fingerprint, _duration) = fingerprint::extract_fingerprint_from_file(&audio_path)?;

    // 获取所有音乐指纹
    let library = database::get_all_fingerprints()?;

    if library.is_empty() {
        return Ok(Vec::new());
    }

    // 并行匹配
    let results: Vec<MatchResult> = library
        .par_iter()
        .filter_map(|(music_id, music_title, music_fingerprint)| {
            let confidence = fingerprint::compare_fingerprints(&query_fingerprint, music_fingerprint);

            if confidence >= min_conf {
                Some(MatchResult {
                    music_id: music_id.clone(),
                    music_title: music_title.clone(),
                    confidence,
                    start_time: 0.0,
                    end_time: 0.0,
                })
            } else {
                None
            }
        })
        .collect();

    // 按置信度排序
    let mut sorted_results = results;
    sorted_results.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(sorted_results)
}

/// 批量提取指纹
#[tauri::command]
pub async fn batch_extract_fingerprints(
    window: Window,
    paths: Vec<String>,
) -> AppResult<Vec<String>> {
    let total = paths.len();

    let results: Vec<AppResult<String>> = paths
        .par_iter()
        .enumerate()
        .map(|(index, path)| {
            let result = fingerprint::extract_fingerprint_from_file(path)
                .map(|(data, _)| fingerprint::compute_fingerprint_hash(&data));

            let _ = window.emit("fingerprint-progress", serde_json::json!({
                "current": index + 1,
                "total": total
            }));

            result
        })
        .collect();

    let hashes: Vec<String> = results
        .into_iter()
        .filter_map(|r| r.ok())
        .collect();

    Ok(hashes)
}
