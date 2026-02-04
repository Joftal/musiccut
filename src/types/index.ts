// 类型定义

// 加速模式
export type AccelerationMode = 'cpu' | 'gpu' | 'hybrid' | 'auto';

// GPU 类型
export type GpuType = 'nvidia' | 'amd' | 'intel' | 'none';

// 日志级别
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

// 任务状态
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// 片段状态
export type SegmentStatus = 'detected' | 'removed';

// 音乐信息
export interface MusicInfo {
  id: string;
  title: string;
  album?: string;
  duration: number;
  file_path: string;
  fingerprint_hash: string;
  created_at: string;
  /** 源文件是否存在 */
  file_exists: boolean;
}

// 视频信息
export interface VideoInfo {
  path: string;
  filename: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  video_codec: string;
  audio_codec: string;
  bitrate: number;
  size: number;
  format: string;
}

// 片段
export interface Segment {
  id: string;
  project_id: string;
  music_id?: string;
  music_title?: string;
  start_time: number;
  end_time: number;
  confidence: number;
  status: SegmentStatus;
}

// 项目
export interface Project {
  id: string;
  name: string;
  source_video_path: string;
  /** 预览视频路径（用于播放不支持的格式，如 FLV） */
  preview_video_path?: string;
  video_info: VideoInfo;
  segments: Segment[];
  created_at: string;
  updated_at: string;
  /** 源视频文件是否存在 */
  file_exists: boolean;
}

// 匹配结果
export interface MatchResult {
  music_id: string;
  music_title: string;
  confidence: number;
  start_time: number;
  end_time: number;
}

// 分离结果
export interface SeparationResult {
  vocals_path: string;
  accompaniment_path: string;
  duration: number;
}

// 剪辑参数
export interface CutParams {
  project_id: string;
  output_path: string;
  keep_matched: boolean;
}

// GPU 信息
export interface GpuInfo {
  available: boolean;
  name: string;
  gpu_type: string;
  memory: number;
  onnx_gpu_available: boolean;
}

// 系统信息
export interface SystemInfo {
  os: string;
  cpu_model: string;
  cpu_cores: number;
  cpu_threads: number;
  memory: number;
  gpu: GpuInfo;
  ffmpeg_version?: string;
  fpcalc_available: boolean;
  python_available: boolean;
}

// 依赖检查
export interface DependencyCheck {
  name: string;
  available: boolean;
  version?: string;
  path?: string;
  message: string;
}

// 加速选项
export interface AccelerationOptions {
  cpu_available: boolean;
  cpu_threads: number;
  gpu_available: boolean;
  gpu_name: string;
  gpu_type: string;
  onnx_gpu_available: boolean;
  recommended: string;
}

// 分离配置
export interface SeparationConfig {
  selected_model_id: string;
  output_format: string;
}

// 模型架构类型 (仅支持 MDX-Net)
export type ModelArchitecture = 'mdxnet';

// 模型信息
export interface ModelInfo {
  id: string;
  name: string;
  architecture: ModelArchitecture;
  filename: string;
  description: string;
  stems: number;
  speed_rating: number;
  quality_rating: number;
  file_size: number;
}

// 模型状态
export interface ModelStatus {
  model_id: string;
  downloaded: boolean;
  local_path?: string;
}

// 模型下载进度
export interface ModelDownloadProgress {
  model_id: string;
  progress: number;
  message: string;
  completed: boolean;
  error?: string;
}

// 匹配配置
export interface MatchConfig {
  min_confidence: number;
  min_segment_duration: number;
  window_size: number;
  hop_size: number;
  max_gap_duration: number;
}

// 窗口状态
export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

// 应用配置
export interface AppConfig {
  detected_gpu: GpuType;
  separation: SeparationConfig;
  matching: MatchConfig;
  window_state?: WindowState;
  log_level?: LogLevel;
}

// 进度信息
export interface ProgressInfo {
  progress: number;
  message: string;
  status?: TaskStatus;
  project_id?: string;
}

// 导入进度
export interface ImportProgress {
  current: number;
  total: number;
  message: string;
}

// 存储信息
export interface StorageInfo {
  app_dir: string;
  db_path: string;
  config_path: string;
  db_size: number;
  config_size: number;
  temp_size: number;
  total_size: number;
}

// Toast 类型
export type ToastType = 'success' | 'error' | 'warning' | 'info';

// Toast 消息
export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
}
