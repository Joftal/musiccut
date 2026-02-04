// 工具函数

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${secs
    .toString()
    .padStart(2, '0')}`;
}

export function formatSize(bytes: number): string {
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;

  if (bytes >= GB) {
    return `${(bytes / GB).toFixed(2)} GB`;
  } else if (bytes >= MB) {
    return `${(bytes / MB).toFixed(2)} MB`;
  } else if (bytes >= KB) {
    return `${(bytes / KB).toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 格式化时间为精确格式 HH:MM:SS.mmm
 * @param seconds 秒数（支持小数）
 * @returns 格式化字符串
 */
export function formatPreciseTime(seconds: number): string {
  if (seconds < 0) seconds = 0;

  // 先转换为毫秒整数，避免浮点数精度问题
  let totalMs = Math.round(seconds * 1000);

  const ms = totalMs % 1000;
  totalMs = Math.floor(totalMs / 1000);

  const secs = totalMs % 60;
  totalMs = Math.floor(totalMs / 60);

  const minutes = totalMs % 60;
  const hours = Math.floor(totalMs / 60);

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString().padStart(2, '0')}:${secs
    .toString().padStart(2, '0')}.${ms
    .toString().padStart(3, '0')}`;
}

/**
 * 解析精确时间格式为秒数
 * 支持格式：HH:MM:SS.mmm, MM:SS.mmm, SS.mmm, HH:MM:SS, MM:SS, SS
 * @param timeStr 时间字符串
 * @returns 秒数，解析失败返回 null
 */
export function parsePreciseTime(timeStr: string): number | null {
  const trimmed = timeStr.trim();
  if (!trimmed) return null;

  // HH:MM:SS.mmm 或 HH:MM:SS
  const fullMatch = trimmed.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (fullMatch) {
    const hours = parseInt(fullMatch[1], 10);
    const minutes = parseInt(fullMatch[2], 10);
    const secs = parseInt(fullMatch[3], 10);
    const ms = fullMatch[4] ? parseInt(fullMatch[4].padEnd(3, '0'), 10) : 0;
    if (minutes >= 60 || secs >= 60) return null;
    return hours * 3600 + minutes * 60 + secs + ms / 1000;
  }

  // MM:SS.mmm 或 MM:SS
  const shortMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (shortMatch) {
    const minutes = parseInt(shortMatch[1], 10);
    const secs = parseInt(shortMatch[2], 10);
    const ms = shortMatch[3] ? parseInt(shortMatch[3].padEnd(3, '0'), 10) : 0;
    if (secs >= 60) return null;
    return minutes * 60 + secs + ms / 1000;
  }

  // SS.mmm 或 SS
  const secsMatch = trimmed.match(/^(\d+)(?:\.(\d{1,3}))?$/);
  if (secsMatch) {
    const secs = parseInt(secsMatch[1], 10);
    const ms = secsMatch[2] ? parseInt(secsMatch[2].padEnd(3, '0'), 10) : 0;
    return secs + ms / 1000;
  }

  return null;
}

/**
 * 根据帧率将时间对齐到最近的帧边界
 * @param seconds 秒数
 * @param fps 帧率
 * @returns 对齐后的秒数
 */
export function snapToFrame(seconds: number, fps: number): number {
  if (fps <= 0) return seconds;
  const frameDuration = 1 / fps;
  const frameIndex = Math.round(seconds / frameDuration);
  return frameIndex * frameDuration;
}

/**
 * 计算时间对应的帧号
 */
export function timeToFrame(seconds: number, fps: number): number {
  if (fps <= 0) return 0;
  return Math.floor(seconds * fps);
}

/**
 * 计算帧号对应的时间
 */
export function frameToTime(frame: number, fps: number): number {
  if (fps <= 0) return 0;
  return frame / fps;
}

export function generateId(): string {
  // 使用 crypto API 生成更安全的随机 ID
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // 降级方案
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

/**
 * 从未知错误对象中提取错误消息
 * @param error 未知类型的错误对象
 * @param fallback 默认错误消息
 * @returns 错误消息字符串
 */
export function getErrorMessage(error: unknown, fallback: string = '未知错误'): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return fallback;
}

/**
 * 从路径中提取文件名（不含扩展名）
 */
export function getFileNameWithoutExt(path: string): string {
  const fileName = path.split(/[/\\]/).pop() || '';
  return fileName.replace(/\.[^.]+$/, '');
}

// Windows 路径长度限制
export const MAX_PATH_LENGTH = 260;
// 分别导出时文件名最大长度（源文件名30 + 序号4 + 音乐名51 + 时间15 + 扩展名5 + 分隔符）
export const MAX_SEPARATE_FILENAME_LENGTH = 110;

/**
 * 检查导出路径是否有效
 */
export function checkExportPathValidity(
  path: string,
  mode: 'merged' | 'separate'
): { valid: boolean; warning: string | null } {
  if (!path) {
    return { valid: false, warning: null };
  }

  if (mode === 'merged') {
    // 合并导出：检查完整路径长度
    if (path.length >= MAX_PATH_LENGTH) {
      return {
        valid: false,
        warning: `名称或路径过长（${path.length}/${MAX_PATH_LENGTH}字符），请选择更短的路径或重命名文件`,
      };
    }
  } else {
    // 分别导出：检查目录路径 + 预估文件名长度
    const maxAllowedDirLength = MAX_PATH_LENGTH - MAX_SEPARATE_FILENAME_LENGTH;
    if (path.length >= maxAllowedDirLength) {
      return {
        valid: false,
        warning: `名称或路径过长（${path.length}/${maxAllowedDirLength}字符），生成的文件名可能超出系统限制，请选择更短的路径或重命名文件`,
      };
    }
  }

  return { valid: true, warning: null };
}

/**
 * 检查项目名称（视频文件名）是否过长，可能导致导出时路径超限
 * @param videoPath 视频文件完整路径
 * @returns 警告信息，如果没有问题则返回 null
 */
export function checkProjectNameLength(videoPath: string): string | null {
  if (!videoPath) return null;

  const nameWithoutExt = getFileNameWithoutExt(videoPath);

  // 项目名称会用于生成导出文件名
  // 分段导出时：源文件名30 + 序号4 + 音乐名51 + 时间15 + 扩展名5 + 分隔符 = 110
  // 如果项目名称本身就很长，加上常见的导出路径，很容易超过260字符限制
  // 这里设置一个合理的警告阈值：项目名称超过50字符时警告
  const PROJECT_NAME_WARNING_THRESHOLD = 50;

  if (nameWithoutExt.length > PROJECT_NAME_WARNING_THRESHOLD) {
    return `文件名较长（${nameWithoutExt.length}字符），导出时可能因路径过长而失败，建议重命名后再导入`;
  }

  return null;
}
