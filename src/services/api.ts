// Tauri API 调用封装

import { invoke } from '@tauri-apps/api/tauri';
import { open, save } from '@tauri-apps/api/dialog';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { exists } from '@tauri-apps/api/fs';
import i18n from '@/i18n';
import type {
  MusicInfo,
  VideoInfo,
  Project,
  Segment,
  SystemInfo,
  GpuInfo,
  MatchResult,
  DependencyCheck,
  AccelerationOptions,
  AppConfig,
  SeparationResult,
  CacheStatus,
  CutParams,
  ProgressInfo,
  ImportProgress,
  StorageInfo,
  ModelInfo,
  ModelStatus,
  ModelDownloadProgress,
} from '@/types';

// ==================== 系统 API ====================

/** 获取系统信息（OS、CPU、内存等） */
export async function getSystemInfo(): Promise<SystemInfo> {
  return invoke('get_system_info');
}

/** 获取 GPU 信息 */
export async function getGpuInfo(): Promise<GpuInfo> {
  return invoke('get_gpu_info');
}

/** 检查外部依赖（FFmpeg、fpcalc 等）是否可用 */
export async function checkDependencies(): Promise<DependencyCheck[]> {
  return invoke('check_dependencies');
}

// ==================== 配置 API ====================

/** 获取应用配置 */
export async function getConfig(): Promise<AppConfig> {
  return invoke('get_config');
}

/** 更新应用配置 */
export async function updateConfig(config: AppConfig): Promise<void> {
  return invoke('update_config', { newConfig: config });
}

/** 获取可用的加速选项（CPU / GPU） */
export async function getAccelerationOptions(): Promise<AccelerationOptions> {
  return invoke('get_acceleration_options');
}

/** 获取存储空间信息（缓存大小等） */
export async function getStorageInfo(): Promise<StorageInfo> {
  return invoke('get_storage_info');
}

/** 清理缓存文件，返回释放的字节数 */
export async function clearCache(): Promise<number> {
  return invoke('clear_cache');
}

/** 重置数据库（清空所有数据） */
export async function resetDatabase(): Promise<void> {
  return invoke('reset_database');
}

/** 重置配置为默认值 */
export async function resetConfig(): Promise<void> {
  return invoke('reset_config');
}

// ==================== 音乐库 API ====================

/** 导入文件夹中的所有音频文件到音乐库 */
export async function importMusicFolder(path: string): Promise<MusicInfo[]> {
  return invoke('import_music_folder', { path });
}

/** 导入指定音频文件到音乐库 */
export async function importMusicFiles(paths: string[]): Promise<MusicInfo[]> {
  return invoke('import_music_files', { paths });
}

/** 获取音乐库中所有音乐 */
export async function getMusicLibrary(): Promise<MusicInfo[]> {
  return invoke('get_music_library');
}

/** 删除指定音乐 */
export async function deleteMusic(id: string): Promise<void> {
  return invoke('delete_music', { id });
}

/** 删除音乐库中所有音乐 */
export async function deleteAllMusic(): Promise<void> {
  return invoke('delete_all_music');
}

/** 按关键词搜索音乐 */
export async function searchMusic(query: string): Promise<MusicInfo[]> {
  return invoke('search_music', { query });
}

/** 获取指定音乐详情 */
export async function getMusicInfo(id: string): Promise<MusicInfo | null> {
  return invoke('get_music_info', { id });
}

// ==================== 指纹 API ====================

/** 提取单个音频文件的指纹 */
export async function extractFingerprint(audioPath: string): Promise<string> {
  return invoke('extract_fingerprint', { audioPath });
}

/** 匹配音频指纹，返回匹配结果列表 */
export async function matchFingerprint(
  audioPath: string,
  minConfidence?: number
): Promise<MatchResult[]> {
  return invoke('match_fingerprint', { audioPath, minConfidence });
}

/** 批量提取音频指纹 */
export async function batchExtractFingerprints(paths: string[]): Promise<string[]> {
  return invoke('batch_extract_fingerprints', { paths });
}

// ==================== 视频 API ====================

/** 分析视频文件，获取视频元信息 */
export async function analyzeVideo(path: string): Promise<VideoInfo> {
  return invoke('analyze_video', { path });
}

/** 检查项目的缓存状态（音频提取、人声分离是否已完成） */
export async function checkCacheStatus(
  projectId: string,
  videoPath: string,
  modelId: string,
): Promise<CacheStatus> {
  return invoke('check_cache_status', { projectId, videoPath, modelId });
}

/** 从视频中提取音频轨道 */
export async function extractAudio(
  videoPath: string,
  outputPath: string,
  projectId?: string
): Promise<string> {
  return invoke('extract_audio', { videoPath, outputPath, projectId });
}

/** 人声/伴奏分离（GPU 信号量排队） */
export async function separateVocals(
  audioPath: string,
  outputDir: string,
  acceleration?: string,
  projectId?: string
): Promise<SeparationResult> {
  return invoke('separate_vocals', { audioPath, outputDir, acceleration, projectId });
}

/** 匹配视频中的音乐片段 */
export async function matchVideoSegments(
  accompanimentPath: string,
  projectId: string,
  minConfidence?: number,
  musicIds?: string[]
): Promise<Segment[]> {
  return invoke('match_video_segments', {
    accompanimentPath,
    projectId,
    minConfidence,
    musicIds,
  });
}

/** 剪切视频（按片段参数） */
export async function cutVideo(params: CutParams): Promise<string> {
  return invoke('cut_video', { params: { ...params, force_reencode: params.force_reencode ?? false } });
}

/** 合并导出视频（所有检测片段合并为一个文件） */
export async function exportVideo(projectId: string, outputPath: string, forceReencode?: boolean): Promise<string> {
  return invoke('export_video', { projectId, outputPath, forceReencode: forceReencode ?? false });
}

/** 分别导出视频片段到指定目录 */
export async function exportVideoSeparately(
  projectId: string,
  outputDir: string,
  forceReencode?: boolean,
): Promise<{ exported_count: number; output_files: string[] }> {
  return invoke('export_video_separately', { projectId, outputDir, forceReencode: forceReencode ?? false });
}

/** 导出自定义时间范围的视频片段 */
export async function exportCustomClip(
  projectId: string,
  startTime: number,
  endTime: number,
  outputPath: string,
  forceReencode?: boolean
): Promise<string> {
  return invoke('export_custom_clip', { projectId, startTime, endTime, outputPath, forceReencode: forceReencode ?? false });
}

/** 合并导出多个自定义片段为一个文件 */
export async function exportCustomClipsMerged(
  projectId: string,
  segments: Array<{ start_time: number; end_time: number }>,
  outputPath: string,
  forceReencode?: boolean
): Promise<string> {
  return invoke('export_custom_clips_merged', { projectId, segments, outputPath, forceReencode: forceReencode ?? false });
}

/** 分别导出多个自定义片段到目录 */
export async function exportCustomClipsSeparately(
  projectId: string,
  segments: Array<{ start_time: number; end_time: number }>,
  outputDir: string,
  forceReencode?: boolean
): Promise<{ exported_count: number; output_files: string[] }> {
  return invoke('export_custom_clips_separately', { projectId, segments, outputDir, forceReencode: forceReencode ?? false });
}

/** 获取视频缩略图（自动缓存） */
export async function getVideoThumbnail(
  videoPath: string,
  outputPath: string,
  time?: number
): Promise<string> {
  return invoke('get_video_thumbnail', { videoPath, outputPath, time });
}

/** 取消正在进行的处理任务 */
export async function cancelProcessing(projectId?: string): Promise<void> {
  return invoke('cancel_processing', { projectId });
}

/** 取消预览视频生成 */
export async function cancelPreviewGeneration(projectId?: string): Promise<void> {
  return invoke('cancel_preview_generation', { projectId });
}

/** 检查视频是否需要生成预览（分辨率过高时需要） */
export async function checkNeedsPreview(videoPath: string): Promise<boolean> {
  return invoke('check_needs_preview', { videoPath });
}

/** 生成低分辨率预览视频 */
export async function generatePreviewVideo(
  sourcePath: string,
  outputPath: string,
  projectId?: string
): Promise<string> {
  return invoke('generate_preview_video', { sourcePath, outputPath, projectId });
}

/** 监听预览生成进度 */
export function onPreviewProgress(
  callback: (progress: ProgressInfo) => void
): Promise<UnlistenFn> {
  return listen('preview-progress', (event) => {
    callback(event.payload as ProgressInfo);
  });
}

/** 监听预览生成完成 */
export function onPreviewComplete(
  callback: (result: { output_path: string; project_id?: string }) => void
): Promise<UnlistenFn> {
  return listen('preview-complete', (event) => {
    callback(event.payload as { output_path: string; project_id?: string });
  });
}

// ==================== 项目 API ====================

/** 创建新项目（自动分析视频信息） */
export async function createProject(
  videoPath: string
): Promise<Project> {
  return invoke('create_project', { videoPath });
}

/** 保存项目（更新片段等信息） */
export async function saveProject(project: Project): Promise<void> {
  return invoke('save_project', { project });
}

/** 加载指定项目 */
export async function loadProject(id: string): Promise<Project> {
  return invoke('load_project', { id });
}

/** 获取所有项目列表 */
export async function getProjects(): Promise<Project[]> {
  return invoke('get_projects');
}

/** 删除指定项目及其片段 */
export async function deleteProject(id: string): Promise<void> {
  return invoke('delete_project', { id });
}

/** 删除所有项目 */
export async function deleteAllProjects(): Promise<void> {
  return invoke('delete_all_projects');
}

/** 更新项目的片段列表 */
export async function updateSegments(
  projectId: string,
  segments: Segment[]
): Promise<void> {
  return invoke('update_segments', { projectId, segments });
}

/** 更新项目预览视频路径 */
export async function updateProjectPreview(
  projectId: string,
  previewPath: string
): Promise<void> {
  return invoke('update_project_preview', { projectId, previewPath });
}

/** 扫描文件夹中的视频文件 */
export async function scanVideoFiles(folderPath: string): Promise<string[]> {
  return invoke('scan_video_files', { folderPath });
}

/** 批量创建项目 */
export async function batchCreateProjects(videoPaths: string[]): Promise<Project[]> {
  return invoke('batch_create_projects', { videoPaths });
}

/** 监听批量创建进度 */
export function onBatchCreateProgress(
  callback: (progress: { current: number; total: number; message: string }) => void
): Promise<UnlistenFn> {
  return listen('batch-create-progress', (event) => {
    callback(event.payload as { current: number; total: number; message: string });
  });
}

/** 监听批量创建完成 */
export function onBatchCreateComplete(
  callback: (result: { created: number; skipped: number; errors: number; error_messages: string[]; total: number }) => void
): Promise<UnlistenFn> {
  return listen('batch-create-complete', (event) => {
    callback(event.payload as { created: number; skipped: number; errors: number; error_messages: string[]; total: number });
  });
}

// ==================== 模型 API ====================

/** 获取所有可用模型列表 */
export async function getAvailableModels(): Promise<ModelInfo[]> {
  return invoke('get_available_models');
}

/** 获取所有模型的下载状态 */
export async function getModelsStatus(): Promise<ModelStatus[]> {
  return invoke('get_models_status');
}

/** 检查指定模型是否已下载 */
export async function checkModelDownloaded(modelId: string): Promise<boolean> {
  return invoke('check_model_downloaded', { modelId });
}

/** 获取指定模型详情 */
export async function getModelInfo(modelId: string): Promise<ModelInfo | null> {
  return invoke('get_model_info', { modelId });
}

/** 下载指定模型 */
export async function downloadModel(modelId: string): Promise<void> {
  return invoke('download_model', { modelId });
}

/** 监听模型下载进度 */
export function onModelDownloadProgress(
  callback: (progress: ModelDownloadProgress) => void
): Promise<UnlistenFn> {
  return listen('model-download-progress', (event) => {
    callback(event.payload as ModelDownloadProgress);
  });
}

// ==================== 对话框 API ====================

/** 打开文件夹选择对话框 */
export async function openFolderDialog(): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
    title: i18n.t('common.selectFolder'),
  });
  return result as string | null;
}

/** 打开单文件选择对话框 */
export async function openFileDialog(
  filters?: { name: string; extensions: string[] }[]
): Promise<string | null> {
  const result = await open({
    multiple: false,
    filters,
    title: i18n.t('common.selectFile'),
  });
  return result as string | null;
}

/** 打开多文件选择对话框 */
export async function openFilesDialog(
  filters?: { name: string; extensions: string[] }[]
): Promise<string[] | null> {
  const result = await open({
    multiple: true,
    filters,
    title: i18n.t('common.selectFile'),
  });
  return result as string[] | null;
}

/** 打开文件保存对话框 */
export async function saveFileDialog(
  defaultPath?: string,
  filters?: { name: string; extensions: string[] }[]
): Promise<string | null> {
  const result = await save({
    defaultPath,
    filters,
    title: i18n.t('common.saveFile'),
  });
  return result;
}

// ==================== 文件系统 API ====================

/** 检查文件是否存在 */
export async function checkFileExists(path: string): Promise<boolean> {
  return exists(path);
}

// ==================== 事件监听 ====================

/** 监听音乐导入进度 */
export function onImportProgress(
  callback: (progress: ImportProgress) => void
): Promise<UnlistenFn> {
  return listen('import-progress', (event) => {
    callback(event.payload as ImportProgress);
  });
}

/** 监听音乐导入完成 */
export function onImportComplete(
  callback: (result: { imported: number; skipped: number; errors: number }) => void
): Promise<UnlistenFn> {
  return listen('import-complete', (event) => {
    callback(event.payload as { imported: number; skipped: number; errors: number });
  });
}

/** 监听音频提取进度 */
export function onExtractProgress(
  callback: (progress: ProgressInfo) => void
): Promise<UnlistenFn> {
  return listen('extract-progress', (event) => {
    callback(event.payload as ProgressInfo);
  });
}

/** 监听人声分离进度 */
export function onSeparationProgress(
  callback: (progress: ProgressInfo) => void
): Promise<UnlistenFn> {
  return listen('separation-progress', (event) => {
    callback(event.payload as ProgressInfo);
  });
}

/** 监听人声分离排队通知 */
export function onSeparationQueued(
  callback: (data: { project_id: string; message: string }) => void
): Promise<UnlistenFn> {
  return listen('separation-queued', (event) => {
    callback(event.payload as { project_id: string; message: string });
  });
}

/** 监听人声分离完成 */
export function onSeparationComplete(
  callback: (result: SeparationResult) => void
): Promise<UnlistenFn> {
  return listen('separation-complete', (event) => {
    callback(event.payload as SeparationResult);
  });
}

/** 监听指纹匹配进度 */
export function onMatchingProgress(
  callback: (progress: ProgressInfo & { segments_found?: number }) => void
): Promise<UnlistenFn> {
  return listen('matching-progress', (event) => {
    callback(event.payload as ProgressInfo & { segments_found?: number });
  });
}

/** 监听指纹匹配完成 */
export function onMatchingComplete(
  callback: (result: { segments: number }) => void
): Promise<UnlistenFn> {
  return listen('matching-complete', (event) => {
    callback(event.payload as { segments: number });
  });
}

/** 监听视频剪切进度 */
export function onCutProgress(
  callback: (progress: ProgressInfo) => void
): Promise<UnlistenFn> {
  return listen('cut-progress', (event) => {
    callback(event.payload as ProgressInfo);
  });
}

/** 监听视频剪切完成 */
export function onCutComplete(
  callback: (result: { output_path: string }) => void
): Promise<UnlistenFn> {
  return listen('cut-complete', (event) => {
    callback(event.payload as { output_path: string });
  });
}

/** 监听视频导出进度 */
export function onExportProgress(
  callback: (progress: ProgressInfo) => void
): Promise<UnlistenFn> {
  return listen('export-progress', (event) => {
    callback(event.payload as ProgressInfo);
  });
}

/** 监听视频导出完成 */
export function onExportComplete(
  callback: (result: { output_path: string }) => void
): Promise<UnlistenFn> {
  return listen('export-complete', (event) => {
    callback(event.payload as { output_path: string });
  });
}

// ==================== 人物检测 API ====================

/** 检测视频中的人物片段（GPU 信号量排队） */
export async function detectPersons(
  projectId: string,
  videoPath: string,
  outputDir: string,
  acceleration?: string
): Promise<Segment[]> {
  return invoke('detect_persons', { projectId, videoPath, outputDir, acceleration });
}

/** 取消人物检测任务 */
export async function cancelDetection(projectId: string): Promise<void> {
  return invoke('cancel_detection', { projectId });
}

/** 监听人物检测排队通知 */
export function onDetectionQueued(
  callback: (data: { project_id: string; message: string }) => void
): Promise<UnlistenFn> {
  return listen('detection-queued', (event) => {
    callback(event.payload as { project_id: string; message: string });
  });
}

/** 监听人物检测进度 */
export function onDetectionProgress(
  callback: (progress: ProgressInfo) => void
): Promise<UnlistenFn> {
  return listen('detection-progress', (event) => {
    callback(event.payload as ProgressInfo);
  });
}

/** 监听人物检测完成 */
export function onDetectionComplete(
  callback: (result: { project_id: string; segments_count: number; total_frames: number; processed_frames: number; detection_frames: number }) => void
): Promise<UnlistenFn> {
  return listen('detection-complete', (event) => {
    callback(event.payload as { project_id: string; segments_count: number; total_frames: number; processed_frames: number; detection_frames: number });
  });
}
