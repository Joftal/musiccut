// 项目页面

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Folder,
  FolderOpen,
  Film,
  Clock,
  Trash2,
  Play,
  Search,
  AlertTriangle,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/Progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogBody,
  DialogFooter,
} from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { useProjectStore, STAGE_CONFIG } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useToast } from '@/components/ui/Toast';
import { cn, formatDuration, formatDate, getErrorMessage, checkProjectNameLength, getFileNameWithoutExt } from '@/utils';
import * as api from '@/services/api';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { join } from '@tauri-apps/api/path';
import type { Project, VideoInfo } from '@/types';

// 判断视频是否需要转码才能在浏览器中播放
// 与后端 src-tauri/src/video/ffmpeg.rs 中的 BROWSER_SUPPORTED_* 保持一致
const needsTranscode = (info: VideoInfo): boolean => {
  const supportedFormats = ['mp4', 'mov', 'm4v', 'webm', 'ogg', 'ogv'];
  const supportedCodecs = ['h264', 'avc1', 'avc', 'vp8', 'vp9', 'av1', 'av01', 'theora'];

  const formatSupported = supportedFormats.some(f =>
    info.format.toLowerCase().includes(f)
  );
  const codecSupported = supportedCodecs.some(c =>
    info.video_codec.toLowerCase().includes(c)
  );

  return !formatSupported || !codecSupported;
};

// 简化 ffprobe 返回的格式名称（如 "MOV,MP4,M4A,3GP,3G2,MJ2" → "MP4"）
const getDisplayFormat = (format: string): string => {
  const lower = format.toLowerCase();
  // 按优先级匹配常见格式
  if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('mov')) return 'MP4';
  if (lower.includes('matroska') || lower.includes('mkv')) return 'MKV';
  if (lower.includes('webm')) return 'WEBM';
  if (lower.includes('flv')) return 'FLV';
  if (lower.includes('avi')) return 'AVI';
  if (lower.includes('wmv') || lower.includes('asf')) return 'WMV';
  if (lower.includes('ogg') || lower.includes('ogv')) return 'OGG';
  if (lower.includes('ts') || lower.includes('mpegts')) return 'TS';
  // 默认取第一个格式
  return format.split(',')[0].toUpperCase();
};

// 将后端的进度消息转换为国际化消息
const localizeProgressMessage = (message: string, t: (key: string, options?: Record<string, unknown>) => string): string => {
  // 匹配 "处理中: filename" 格式
  const processingMatch = message.match(/^处理中: (.+)$/);
  if (processingMatch) {
    return t('projects.progress.processing', { filename: processingMatch[1] });
  }
  return message;
};

const Projects: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // 使用 selector 分离订阅，避免 projectStatus 变化时触发不必要的重渲染
  const projects = useProjectStore((state) => state.projects);
  const loading = useProjectStore((state) => state.loading);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const projectStatus = useProjectStore((state) => state.projectStatus);
  const initProgressListeners = useProjectStore((state) => state.initProgressListeners);
  const { createProject } = useEditorStore();
  const { addToast } = useToast();

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [videoPath, setVideoPath] = useState('');
  const [creating, setCreating] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [appDir, setAppDir] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, message: '' });
  const [searchInput, setSearchInput] = useState('');
  const [pathWarning, setPathWarning] = useState<string | null>(null);

  // 初始化进度监听器（全局只初始化一次）
  useEffect(() => {
    initProgressListeners();
  }, [initProgressListeners]);

  useEffect(() => {
    loadProjects();
    // 获取应用数据目录
    api.getStorageInfo().then(info => {
      setAppDir(info.app_dir);
    }).catch(console.error);
  }, []);

  // 加载已有缩略图
  useEffect(() => {
    const loadThumbnails = async () => {
      if (projects.length === 0 || !appDir) return;

      const thumbDir = await join(appDir, 'thumbnails');
      const newThumbnails: Record<string, string> = {};

      // 批量收集所有缩略图路径
      for (const project of projects) {
        try {
          const thumbPath = await join(thumbDir, `${project.id}.jpg`);
          newThumbnails[project.id] = convertFileSrc(thumbPath);
        } catch (e) {
          console.error(`Failed to load thumbnail for project ${project.id}:`, e);
        }
      }

      // 一次性更新状态，过滤掉已存在的缩略图
      if (Object.keys(newThumbnails).length > 0) {
        setThumbnails(prev => {
          const toAdd: Record<string, string> = {};
          for (const [id, src] of Object.entries(newThumbnails)) {
            if (!prev[id]) {
              toAdd[id] = src;
            }
          }
          if (Object.keys(toAdd).length === 0) return prev;
          return { ...prev, ...toAdd };
        });
      }
    };

    loadThumbnails();
  }, [projects, appDir]);

  const handleSelectVideo = async () => {
    const path = await api.openFileDialog([
      { name: t('common.videoFile'), extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv'] },
    ]);
    if (path) {
      setVideoPath(path);
      // 检查文件名长度
      const warning = checkProjectNameLength(path);
      setPathWarning(warning);
    }
  };

  const handleCreateProject = async () => {
    if (!videoPath) {
      addToast({
        type: 'error',
        title: t('projects.toast.selectVideo'),
      });
      return;
    }

    setCreating(true);
    try {
      const project = await createProject(videoPath);
      setShowNewDialog(false);
      setVideoPath('');
      setPathWarning(null);
      loadProjects();
      navigate(`/editor/${project.id}`);
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);

      // 检查是否是重复导入的错误
      if (errorMessage.includes('已创建过项目')) {
        addToast({
          type: 'warning',
          title: t('projects.toast.skipExisting'),
        });
      } else {
        addToast({
          type: 'error',
          title: t('projects.toast.createFailed'),
          description: errorMessage,
        });
      }
    } finally {
      setCreating(false);
    }
  };

  const handleOpenProject = (project: Project) => {
    if (!project.file_exists) {
      addToast({
        type: 'error',
        title: t('projects.toast.sourceNotExist'),
        description: t('projects.toast.sourceNotExistDesc'),
      });
      return;
    }
    navigate(`/editor/${project.id}`);
  };

  const handleDeleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTargetId(id);
    setShowDeleteDialog(true);
  };

  const confirmDeleteProject = async () => {
    if (!deleteTargetId) return;

    setDeleting(true);
    try {
      await deleteProject(deleteTargetId);
      addToast({
        type: 'success',
        title: t('projects.toast.deleted'),
      });
      setShowDeleteDialog(false);
      setDeleteTargetId(null);
    } catch (error) {
      addToast({
        type: 'error',
        title: t('projects.toast.deleteFailed'),
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleImportFolder = async () => {
    const folderPath = await api.openFolderDialog();
    if (!folderPath) return;

    setImporting(true);
    setImportProgress({ current: 0, total: 0, message: '' });

    let unlisten: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;

    try {
      // 扫描视频文件
      const videoFiles = await api.scanVideoFiles(folderPath);
      if (videoFiles.length === 0) {
        addToast({ type: 'warning', title: t('projects.toast.noVideoInFolder') });
        return;
      }

      // 检查文件名长度，收集警告
      const longNameFiles = videoFiles.filter(path => checkProjectNameLength(path) !== null);
      if (longNameFiles.length > 0) {
        // 提取文件名用于显示
        const fileNames = longNameFiles.map(path => getFileNameWithoutExt(path));
        const displayNames = fileNames.slice(0, 5).join('\n');
        const moreCount = fileNames.length > 5 ? `\n...${t('projects.toast.longFileNameDesc')}` : '';

        addToast({
          type: 'warning',
          title: t('projects.toast.longFileName', { count: longNameFiles.length }),
          description: `${displayNames}${moreCount}`,
        });
      }

      setImportProgress({ current: 0, total: videoFiles.length, message: t('projects.progress.preparing') });

      // 监听进度
      unlisten = await api.onBatchCreateProgress((progress) => {
        setImportProgress({ current: progress.current, total: progress.total, message: progress.message });
      });

      // 监听完成事件
      unlistenComplete = await api.onBatchCreateComplete((result) => {
        // 构建消息
        let message = '';
        if (result.created > 0) {
          message = t('projects.toast.importSuccess', { created: result.created });
        }
        if (result.skipped > 0) {
          message += message ? `，${t('projects.toast.importSkipped', { skipped: result.skipped })}` : t('projects.toast.importSkipped', { skipped: result.skipped });
        }
        if (result.errors > 0) {
          message += message ? `，${t('projects.toast.importErrors', { errors: result.errors })}` : t('projects.toast.importErrors', { errors: result.errors });
        }

        // 确定 Toast 类型
        let toastType: 'success' | 'warning' | 'error' = 'success';
        if (result.created === 0 && result.errors > 0) {
          toastType = 'error';
        } else if (result.errors > 0 || (result.created === 0 && result.skipped > 0)) {
          toastType = 'warning';
        }

        // 构建错误详情
        const description = result.error_messages && result.error_messages.length > 0
          ? result.error_messages.slice(0, 5).join('\n') + (result.error_messages.length > 5 ? `\n...` : '')
          : undefined;

        addToast({
          type: toastType,
          title: message || t('projects.toast.importComplete'),
          description,
        });
      });

      // 批量创建项目
      await api.batchCreateProjects(videoFiles);

      // 刷新项目列表
      loadProjects();
    } catch (error) {
      addToast({
        type: 'error',
        title: t('projects.toast.importFailed'),
        description: getErrorMessage(error),
      });
    } finally {
      // 无论成功失败都清理监听器
      unlisten?.();
      unlistenComplete?.();
      setImporting(false);
      setImportProgress({ current: 0, total: 0, message: '' });
    }
  };

  // 获取阶段标签的翻译
  const getStageLabel = (stage: string) => {
    return t(`stage.${stage}`);
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <header className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))]">
        <div>
          <h1 className="text-xl font-bold text-[hsl(var(--foreground))]">{t('projects.title')}</h1>
          <p className="text-sm text-[hsl(var(--text-secondary))]">{t('projects.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleImportFolder} disabled={importing}>
            <FolderOpen className="w-4 h-4 mr-2" />
            {t('projects.importFolder')}
          </Button>
          <Button variant="primary" onClick={() => setShowNewDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t('projects.newProject')}
          </Button>
        </div>
      </header>

      {/* 搜索栏 */}
      <div className="p-4 border-b border-[hsl(var(--border))]">
        <div className="flex gap-2">
          <Input
            placeholder={t('projects.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            icon={<Search className="w-4 h-4" />}
            wrapperClassName="flex-1"
          />
          <Button variant="secondary" onClick={() => setSearchInput('')} disabled={!searchInput}>
            {t('common.clear')}
          </Button>
        </div>
      </div>

      {/* 导入进度 */}
      {importing && importProgress.total > 0 && (
        <div className="p-4 bg-[hsl(var(--card-bg))] border-b border-[hsl(var(--border))]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[hsl(var(--text-secondary))]">
              {localizeProgressMessage(importProgress.message, t)}
            </span>
            <span className="text-sm text-[hsl(var(--text-muted))]">
              {importProgress.current} / {importProgress.total}
            </span>
          </div>
          <Progress
            value={importProgress.current}
            max={importProgress.total}
          />
        </div>
      )}

      {/* 项目列表 */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-[hsl(var(--text-muted))]">
            <Folder className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg">{t('projects.emptyTitle')}</p>
            <p className="text-sm mt-1">{t('projects.emptySubtitle')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects
              .filter((project) =>
                searchInput.trim() === '' ||
                project.name.toLowerCase().includes(searchInput.toLowerCase())
              )
              .map((project) => (
              <div
                key={project.id}
                onClick={() => handleOpenProject(project)}
                className={cn(
                  'relative bg-[hsl(var(--card-bg))] border border-[hsl(var(--border))] rounded-xl overflow-hidden',
                  'cursor-pointer hover:border-primary-500/50 transition-all',
                  !project.file_exists && 'opacity-60'
                )}
              >
                {/* 缩略图 */}
                <div className="group aspect-video bg-[hsl(var(--secondary))] flex items-center justify-center relative overflow-hidden">
                  {thumbnails[project.id] ? (
                    <img
                      src={thumbnails[project.id]}
                      alt={project.name}
                      className="w-full h-full object-cover"
                      onError={() => {
                        setThumbnails((prev) => {
                          if (!prev[project.id]) return prev;
                          const { [project.id]: _removed, ...rest } = prev;
                          return rest;
                        });
                      }}
                    />
                  ) : (
                    <Film className="w-12 h-12 text-[hsl(var(--text-muted))]" />
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <Play className="w-12 h-12 text-white" />
                  </div>
                  {/* 文件不存在警告 */}
                  {!project.file_exists && (
                    <div className="absolute top-2 left-2 px-2 py-1 bg-yellow-500/90 text-white text-xs rounded-full flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {t('projects.sourceFileDeleted')}
                    </div>
                  )}
                </div>

                {/* 信息 */}
                <div className="p-3">
                  <h3 className="font-medium text-[hsl(var(--foreground))] truncate">
                    {project.name}
                  </h3>
                  <div className="flex items-center gap-3 mt-2 text-xs text-[hsl(var(--text-muted))]">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDuration(project.video_info.duration)}
                    </span>
                    <span>
                      {project.video_info.width}x{project.video_info.height}
                    </span>
                    <span>
                      {getDisplayFormat(project.video_info.format)}
                    </span>
                    {needsTranscode(project.video_info) && (
                      <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded text-[10px]">
                        {t('projects.needsTranscode')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-[hsl(var(--text-muted))]">
                      {formatDate(project.updated_at)}
                    </span>
                    <div className="flex items-center gap-2">
                      {/* 进度状态 - 4格简化显示 */}
                      {projectStatus[project.id] && projectStatus[project.id].stage !== 'idle' && (
                        <div className="flex items-center gap-1.5 text-xs">
                          {/* 完成状态显示勾选图标 */}
                          {(projectStatus[project.id].stage === 'analyzed' || projectStatus[project.id].stage === 'exported') ? (
                            <>
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={STAGE_CONFIG[projectStatus[project.id].stage].color}>
                                {getStageLabel(projectStatus[project.id].stage)}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className={STAGE_CONFIG[projectStatus[project.id].stage].color}>
                                {getStageLabel(projectStatus[project.id].stage)}
                              </span>
                              {/* 4格进度条（每格25%） */}
                              <div className="flex gap-0.5">
                                {[0, 1, 2, 3].map((i) => (
                                  <div
                                    key={i}
                                    className={cn(
                                      'w-2 h-1.5 rounded-sm transition-colors',
                                      projectStatus[project.id].progress > i / 4
                                        ? 'bg-primary-500'
                                        : 'bg-[hsl(var(--secondary))]'
                                    )}
                                  />
                                ))}
                              </div>
                              <span className="text-[hsl(var(--text-muted))]">
                                {Math.round(projectStatus[project.id].progress * 100)}%
                              </span>
                            </>
                          )}
                        </div>
                      )}
                      <button
                        onClick={(e) => handleDeleteProject(project.id, e)}
                        className="p-1 text-[hsl(var(--text-muted))] hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* 片段数量 */}
                {project.segments.length > 0 && (
                  <div className="absolute top-2 right-2 px-2 py-1 bg-primary-600 text-white text-xs rounded-full">
                    {project.segments.length} {t('projects.segments')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新建项目对话框 */}
      <Dialog open={showNewDialog} onOpenChange={(open) => {
        setShowNewDialog(open);
        if (!open) {
          setVideoPath('');
          setPathWarning(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('projects.dialog.newProjectTitle')}</DialogTitle>
            <DialogClose />
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-1.5">
                {t('projects.dialog.videoFile')}
              </label>
              <div className="flex gap-2">
                <Input
                  placeholder={t('projects.dialog.selectVideo')}
                  value={videoPath}
                  readOnly
                  wrapperClassName="flex-1"
                />
                <Button variant="secondary" onClick={handleSelectVideo}>
                  {t('common.browse')}
                </Button>
              </div>
              {/* 路径长度警告 */}
              {pathWarning && (
                <p className="text-xs text-yellow-500 mt-1.5">{pathWarning}</p>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNewDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateProject}
              loading={creating}
              disabled={!videoPath}
            >
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('projects.dialog.deleteProjectTitle')}</DialogTitle>
            <DialogClose />
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-red-500 font-medium">{t('projects.dialog.deleteWarning')}</p>
              </div>
              <p className="text-[hsl(var(--text-secondary))]">
                {t('projects.dialog.deleteConfirm')}
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={confirmDeleteProject}
              loading={deleting}
            >
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Projects;
