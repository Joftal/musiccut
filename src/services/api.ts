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

export async function getSystemInfo(): Promise<SystemInfo> {
  return invoke('get_system_info');
}

export async function getGpuInfo() {
  return invoke('get_gpu_info');
}

export async function checkDependencies(): Promise<DependencyCheck[]> {
  return invoke('check_dependencies');
}

// ==================== 配置 API ====================

export async function getConfig(): Promise<AppConfig> {
  return invoke('get_config');
}

export async function updateConfig(config: AppConfig): Promise<void> {
  return invoke('update_config', { newConfig: config });
}

export async function getAccelerationOptions(): Promise<AccelerationOptions> {
  return invoke('get_acceleration_options');
}

export async function getStorageInfo(): Promise<StorageInfo> {
  return invoke('get_storage_info');
}

export async function clearCache(): Promise<number> {
  return invoke('clear_cache');
}

export async function resetDatabase(): Promise<void> {
  return invoke('reset_database');
}

export async function resetConfig(): Promise<void> {
  return invoke('reset_config');
}

// ==================== 音乐库 API ====================

export async function importMusicFolder(path: string): Promise<MusicInfo[]> {
  return invoke('import_music_folder', { path });
}

export async function importMusicFiles(paths: string[]): Promise<MusicInfo[]> {
  return invoke('import_music_files', { paths });
}

export async function getMusicLibrary(): Promise<MusicInfo[]> {
  return invoke('get_music_library');
}

export async function deleteMusic(id: string): Promise<void> {
  return invoke('delete_music', { id });
}

export async function searchMusic(query: string): Promise<MusicInfo[]> {
  return invoke('search_music', { query });
}

export async function getMusicInfo(id: string): Promise<MusicInfo | null> {
  return invoke('get_music_info', { id });
}

// ==================== 指纹 API ====================

export async function extractFingerprint(audioPath: string): Promise<string> {
  return invoke('extract_fingerprint', { audioPath });
}

export async function matchFingerprint(
  audioPath: string,
  minConfidence?: number
) {
  return invoke('match_fingerprint', { audioPath, minConfidence });
}

// ==================== 视频 API ====================

export async function analyzeVideo(path: string): Promise<VideoInfo> {
  return invoke('analyze_video', { path });
}

export async function checkCacheStatus(
  projectId: string,
  videoPath: string,
  modelId: string,
): Promise<CacheStatus> {
  return invoke('check_cache_status', { projectId, videoPath, modelId });
}

export async function extractAudio(
  videoPath: string,
  outputPath: string,
  projectId?: string
): Promise<string> {
  return invoke('extract_audio', { videoPath, outputPath, projectId });
}

export async function separateVocals(
  audioPath: string,
  outputDir: string,
  acceleration?: string,
  projectId?: string
): Promise<SeparationResult> {
  return invoke('separate_vocals', { audioPath, outputDir, acceleration, projectId });
}

export interface MatchOptions {
  accompanimentPath: string;
  projectId: string;
  minConfidence?: number;
  musicIds?: string[];
}

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

export async function cutVideo(params: CutParams): Promise<string> {
  return invoke('cut_video', { params });
}

export async function exportVideo(projectId: string, outputPath: string): Promise<string> {
  return invoke('export_video', { projectId, outputPath });
}

export async function exportVideoSeparately(
  projectId: string,
  outputDir: string
): Promise<{ exported_count: number; output_files: string[] }> {
  return invoke('export_video_separately', { projectId, outputDir });
}

export async function exportCustomClip(
  projectId: string,
  startTime: number,
  endTime: number,
  outputPath: string
): Promise<string> {
  return invoke('export_custom_clip', { projectId, startTime, endTime, outputPath });
}

export async function exportCustomClipsMerged(
  projectId: string,
  segments: Array<{ start_time: number; end_time: number }>,
  outputPath: string
): Promise<string> {
  return invoke('export_custom_clips_merged', { projectId, segments, outputPath });
}

export async function exportCustomClipsSeparately(
  projectId: string,
  segments: Array<{ start_time: number; end_time: number }>,
  outputDir: string
): Promise<{ exported_count: number; output_files: string[] }> {
  return invoke('export_custom_clips_separately', { projectId, segments, outputDir });
}

export async function getVideoThumbnail(
  videoPath: string,
  outputPath: string,
  time?: number
): Promise<string> {
  return invoke('get_video_thumbnail', { videoPath, outputPath, time });
}

export async function cancelProcessing(projectId?: string): Promise<void> {
  return invoke('cancel_processing', { projectId });
}

export async function cancelPreviewGeneration(projectId?: string): Promise<void> {
  return invoke('cancel_preview_generation', { projectId });
}

export async function checkNeedsPreview(videoPath: string): Promise<boolean> {
  return invoke('check_needs_preview', { videoPath });
}

export async function generatePreviewVideo(
  sourcePath: string,
  outputPath: string,
  projectId?: string
): Promise<string> {
  return invoke('generate_preview_video', { sourcePath, outputPath, projectId });
}

export function onPreviewProgress(
  callback: (progress: ProgressInfo) => void
): Promise<UnlistenFn> {
  return listen('preview-progress', (event) => {
    callback(event.payload as ProgressInfo);
  });
}

export function onPreviewComplete(
  callback: (result: { output_path: string; project_id?: string }) => void
): Promise<UnlistenFn> {
  return listen('preview-complete', (event) => {
    callback(event.payload as { output_path: string; project_id?: string });
  });
}

// ==================== 项目 API ====================

export async function createProject(
  videoPath: string
): Promise<Project> {
  return invoke('create_project', { videoPath });
}

export async function saveProject(project: Project): Promise<void> {
  return invoke('save_project', { project });
}

export async function loadProject(id: string): Promise<Project> {
  return invoke('load_project', { id });
}

export async function getProjects(): Promise<Project[]> {
  return invoke('get_projects');
}

export async function deleteProject(id: string): Promise<void> {
  return invoke('delete_project', { id });
}

export async function updateSegments(
  projectId: string,
  segments: Segment[]
): Promise<void> {
  return invoke('update_segments', { projectId, segments });
}

export async function updateProjectPreview(
  projectId: string,
  previewPath: string
): Promise<void> {
  return invoke('update_project_preview', { projectId, previewPath });
}

// 扫描文件夹中的视频文件
export async function scanVideoFiles(folderPath: string): Promise<string[]> {
  return invoke('scan_video_files', { folderPath });
}

// 批量创建项目
export async function batchCreateProjects(videoPaths: string[]): Promise<Project[]> {
  return invoke('batch_create_projects', { videoPaths });
}

// 批量创建进度监听
export function onBatchCreateProgress(
  callback: (progress: { current: number; total: number; message: string }) => void
): Promise<UnlistenFn> {
  return listen('batch-create-progress', (event) => {
    callback(event.payload as { current: number; total: number; message: string });
  });
}

// 批量创建完成监听
export function onBatchCreateComplete(
  callback: (result: { created: number; skipped: number; errors: number; error_messages: string[]; total: number }) => void
): Promise<UnlistenFn> {
  return listen('batch-create-complete', (event) => {
    callback(event.payload as { created: number; skipped: number; errors: number; error_messages: string[]; total: number });
  });
}

// ==================== 模型 API ====================

export async function getAvailableModels(): Promise<ModelInfo[]> {
  return invoke('get_available_models');
}

export async function getModelsStatus(): Promise<ModelStatus[]> {
  return invoke('get_models_status');
}

export async function checkModelDownloaded(modelId: string): Promise<boolean> {
  return invoke('check_model_downloaded', { modelId });
}

export async function getModelInfo(modelId: string): Promise<ModelInfo | null> {
  return invoke('get_model_info', { modelId });
}

export async function downloadModel(modelId: string): Promise<void> {
  return invoke('download_model', { modelId });
}

export function onModelDownloadProgress(
  callback: (progress: ModelDownloadProgress) => void
): Promise<UnlistenFn> {
  return listen('model-download-progress', (event) => {
    callback(event.payload as ModelDownloadProgress);
  });
}

// ==================== 对话框 API ====================

export async function openFolderDialog(): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
    title: i18n.t('common.selectFolder'),
  });
  return result as string | null;
}

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

export async function openDirectoryDialog(): Promise<string | null> {
  const result = await open({
    directory: true,
    title: i18n.t('common.selectDirectory'),
  });
  return result as string | null;
}

// ==================== 文件系统 API ====================

export async function checkFileExists(path: string): Promise<boolean> {
  return exists(path);
}

// ==================== 事件监听 ====================

export function onImportProgress(
  callback: (progress: ImportProgress) => void
): Promise<UnlistenFn> {
  return listen('import-progress', (event) => {
    callback(event.payload as ImportProgress);
  });
}

export function onImportComplete(
  callback: (result: { imported: number; skipped: number; errors: number }) => void
): Promise<UnlistenFn> {
  return listen('import-complete', (event) => {
    callback(event.payload as { imported: number; skipped: number; errors: number });
  });
}

export function onExtractProgress(
  callback: (progress: ProgressInfo) => void
): Promise<UnlistenFn> {
  return listen('extract-progress', (event) => {
    callback(event.payload as ProgressInfo);
  });
}

export function onSeparationProgress(
  callback: (progress: ProgressInfo) => void
): Promise<UnlistenFn> {
  return listen('separation-progress', (event) => {
    callback(event.payload as ProgressInfo);
  });
}

export function onSeparationComplete(
  callback: (result: SeparationResult) => void
): Promise<UnlistenFn> {
  return listen('separation-complete', (event) => {
    callback(event.payload as SeparationResult);
  });
}

export function onMatchingProgress(
  callback: (progress: ProgressInfo & { segments_found?: number }) => void
): Promise<UnlistenFn> {
  return listen('matching-progress', (event) => {
    callback(event.payload as ProgressInfo & { segments_found?: number });
  });
}

export function onMatchingComplete(
  callback: (result: { segments: number }) => void
): Promise<UnlistenFn> {
  return listen('matching-complete', (event) => {
    callback(event.payload as { segments: number });
  });
}

export function onCutProgress(
  callback: (progress: ProgressInfo) => void
): Promise<UnlistenFn> {
  return listen('cut-progress', (event) => {
    callback(event.payload as ProgressInfo);
  });
}

export function onCutComplete(
  callback: (result: { output_path: string }) => void
): Promise<UnlistenFn> {
  return listen('cut-complete', (event) => {
    callback(event.payload as { output_path: string });
  });
}

export function onExportProgress(
  callback: (progress: ProgressInfo) => void
): Promise<UnlistenFn> {
  return listen('export-progress', (event) => {
    callback(event.payload as ProgressInfo);
  });
}

export function onExportComplete(
  callback: (result: { output_path: string }) => void
): Promise<UnlistenFn> {
  return listen('export-complete', (event) => {
    callback(event.payload as { output_path: string });
  });
}
