// 音频指纹模块
//
// 使用 fpcalc (Chromaprint) 提取音频指纹，通过汉明距离比较指纹相似度。
// 用于音乐匹配流程中的滑动窗口片段与音乐库指纹比对。

use crate::error::{AppError, AppResult};
use crate::utils::{resolve_tool_path, hidden_command};
use sha2::{Sha256, Digest};
use tracing::{debug, error};

/// 从音频文件提取指纹
///
/// 调用 fpcalc 以 raw JSON 模式提取 Chromaprint 指纹，返回 (指纹字节数据, 音频时长)。
pub fn extract_fingerprint_from_file(audio_path: &str) -> AppResult<(Vec<u8>, f64)> {
    debug!("[FINGERPRINT] 提取指纹: {}", audio_path);
    let fpcalc_path = resolve_tool_path("fpcalc");
    let output = hidden_command(&fpcalc_path)
        .args(["-raw", "-json", audio_path])
        .output()
        .map_err(|e| AppError::DependencyMissing(format!("fpcalc 执行失败: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!("[FINGERPRINT] fpcalc 错误: {}", stderr);
        return Err(AppError::Fingerprint(format!("fpcalc 错误: {}", stderr)));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| AppError::Fingerprint(format!("解析 fpcalc 输出失败: {}", e)))?;

    let duration = json["duration"]
        .as_f64()
        .ok_or_else(|| AppError::Fingerprint("无法获取音频时长".to_string()))?;

    let fingerprint_array = json["fingerprint"]
        .as_array()
        .ok_or_else(|| AppError::Fingerprint("无法获取指纹数据".to_string()))?;

    // 将指纹数组转换为字节
    let fingerprint_data: Vec<u8> = fingerprint_array
        .iter()
        .filter_map(|v| v.as_i64())
        .flat_map(|v| (v as i32).to_le_bytes())
        .collect();

    debug!("[FINGERPRINT] 提取成功: 时长={:.1}s, 指纹大小={}bytes", duration, fingerprint_data.len());
    Ok((fingerprint_data, duration))
}

/// 计算指纹的 SHA256 哈希值（用于快速去重比对）
pub fn compute_fingerprint_hash(fingerprint: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(fingerprint);
    let result = hasher.finalize();
    hex::encode(result)
}

/// 比较两个指纹的相似度（汉明距离）
///
/// 将指纹字节还原为 i32 数组，逐对异或后统计匹配位数，返回 0.0-1.0 的相似度。
pub fn compare_fingerprints(fp1: &[u8], fp2: &[u8]) -> f64 {
    if fp1.is_empty() || fp2.is_empty() {
        return 0.0;
    }

    // 使用迭代器直接比较，避免中间 Vec 分配
    let iter1 = fp1.chunks_exact(4).map(|chunk| {
        i32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]])
    });

    let iter2 = fp2.chunks_exact(4).map(|chunk| {
        i32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]])
    });

    let mut total_bits = 0u32;
    let mut matching_bits = 0u32;

    // 计算相似度（使用汉明距离）
    for (v1, v2) in iter1.zip(iter2) {
        let xor = v1 ^ v2;
        let diff_bits = xor.count_ones();
        total_bits += 32;
        matching_bits += 32 - diff_bits;
    }

    if total_bits == 0 {
        return 0.0;
    }

    matching_bits as f64 / total_bits as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_hash() {
        let data = vec![1u8, 2, 3, 4, 5];
        let hash = compute_fingerprint_hash(&data);
        assert!(!hash.is_empty());
        assert_eq!(hash.len(), 64); // SHA256 produces 64 hex characters
    }

    #[test]
    fn test_compare_identical() {
        let fp = vec![0u8, 0, 0, 1, 0, 0, 0, 2];
        let similarity = compare_fingerprints(&fp, &fp);
        assert!((similarity - 1.0).abs() < 0.001);
    }
}
