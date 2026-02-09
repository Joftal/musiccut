// 编辑器页面

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { join } from '@tauri-apps/api/path';
import {
  Play,
  Pause,
  Music,
  AudioWaveform,
  Loader2,
  Volume2,
  VolumeX,
  Share2,
  Scissors,
  Eye,
  Pointer,
  Library,
  Plus,
  Pencil,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
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
import { TimeInput } from '@/components/ui/TimeInput';
import { MusicSelector } from '@/components/MusicSelector';
import { useEditorStore } from '@/stores/editorStore';
import { useMusicStore } from '@/stores/musicStore';
import { useSystemStore } from '@/stores/systemStore';
import { useModelStore } from '@/stores/modelStore';
import { useToast } from '@/components/ui/Toast';
import { cn, formatDuration, formatPreciseTime, getErrorMessage, checkExportPathValidity } from '@/utils';
import * as api from '@/services/api';

const getSegmentAccentColors = (index: number) => {
  const hue = Math.round((index * 137.508) % 360);
  return {
    accent: `hsl(${hue} 75% 45%)`,
    border: `hsl(${hue} 70% 40%)`,
    background: `hsl(${hue} 85% 92%)`,
    timeline: `hsla(${hue} 80% 50% / 0.45)`,
  };
};

// 从视频路径生成默认导出路径
const getDefaultExportPaths = (sourceVideoPath: string) => {
  const fullName = sourceVideoPath.split(/[/\\]/).pop() || 'video.mp4';
  const videoName = fullName.replace(/\.[^.]+$/, '');
  const ext = fullName.match(/\.[^.]+$/)?.[0] || '.mp4';
  const sourceDir = sourceVideoPath.split(/[/\\]/).slice(0, -1).join('\\');
  return {
    mergedPath: `${sourceDir}\\${videoName}_merged${ext}`,
    separateDir: sourceDir,
  };
};

const Editor: React.FC = () => {
  const { t } = useTranslation();
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);

  const {
    currentProject,
    segments,
    selectedSegment,
    playbackPosition,
    isPlaying,
    duration,
    processing,
    cancellingProjectId,
    processingMessage,
    processingProgress,
    loadProject,
    setPlaybackPosition,
    setIsPlaying,
    setSelectedSegment,
    removeSegment,
    restoreSegment,
    extractAudio,
    separateVocals,
    matchSegments,
    exportVideo,
    exportVideoSeparately,
    cancelProcessing,
    setProcessingProgress,
    // 自定义剪辑模式
    customClipMode,
    customClipStart,
    customClipEnd,
    customClipSegments,
    customClipEditingId,
    enterCustomClipMode,
    exitCustomClipMode,
    setCustomClipRange,
    addCustomClipSegment,
    updateCustomClipSegment,
    removeCustomClipSegment,
    editCustomClipSegment,
    clearCustomClipEditing,
    // 自定义音乐库选择
    useCustomMusicLibrary,
    selectedMusicIds,
  } = useEditorStore();

  // 只有当取消的项目是当前项目时，才显示取消状态
  const cancelling = cancellingProjectId === currentProject?.id;

  const { musicList, loadMusicLibrary } = useMusicStore();
  const { config, loadConfig, updateConfig } = useSystemStore();
  const {
    models,
    loadAll: loadModels,
    isModelDownloaded,
    hasDownloadedModels,
    getFirstDownloadedModel,
  } = useModelStore();

  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportPath, setExportPath] = useState('');
  const [exportMode, setExportMode] = useState<'merged' | 'separate'>('merged');
  const [isCustomClipExport, setIsCustomClipExport] = useState(false);
  const [showSegmentList, setShowSegmentList] = useState(false);
  const [acceleration, setAcceleration] = useState<string>('gpu');
  const [selectedModelId, setSelectedModelId] = useState<string>('mdx-inst-hq3');
  const [appDir, setAppDir] = useState<string>('');
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);

  // 预览视频生成状态
  const [generatingPreview, setGeneratingPreview] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);

  // 音乐选择器对话框状态
  const [showMusicSelector, setShowMusicSelector] = useState(false);

  // 时间轴 ref，用于计算鼠标位置对应的时间
  const timelineRef = useRef<HTMLDivElement>(null);
  // 片段列表下拉 ref，用于点击外部关闭
  const segmentListRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭片段列表下拉
  useEffect(() => {
    if (!showSegmentList) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (segmentListRef.current && !segmentListRef.current.contains(e.target as Node)) {
        setShowSegmentList(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSegmentList]);

  // 加载项目
  useEffect(() => {
    // 立即重置选中片段，避免显示上一次的选中状态
    setSelectedSegment(null);

    if (projectId) {
      loadProject(projectId).then((project) => {
        // 检查源视频文件是否存在
        if (project && !project.file_exists) {
          addToast({
            type: 'error',
            title: t('editor.toast.sourceNotExist'),
            description: t('editor.toast.sourceNotExistDesc'),
          });
          navigate('/');
        }
      }).catch((error) => {
        addToast({
          type: 'error',
          title: t('editor.toast.loadProjectFailed'),
          description: error.message,
        });
        navigate('/');
      });
    }

    loadMusicLibrary();
    loadModels();
    loadConfig();

    // 获取应用数据目录
    api.getStorageInfo().then(info => {
      setAppDir(info.app_dir);
      console.info('[thumbnail] storage info ready', { appDir: info.app_dir });
    }).catch((error) => {
      console.error('[thumbnail] storage info failed', error);
    });

    // 监听进度事件
    let mounted = true;
    const unlisteners: (() => void)[] = [];

    const setupListeners = async () => {
      const unlisten1 = await api.onSeparationProgress((progress) => {
        if (!mounted) return;
        const currentProjectId = useEditorStore.getState().currentProject?.id;
        if (progress.project_id === currentProjectId) {
          setProcessingProgress(progress.progress);
        }
      });
      if (mounted) {
        unlisteners.push(unlisten1);
      } else {
        unlisten1();
      }

      const unlisten2 = await api.onMatchingProgress((progress) => {
        if (!mounted) return;
        const currentProjectId = useEditorStore.getState().currentProject?.id;
        if (progress.project_id === currentProjectId) {
          setProcessingProgress(progress.progress);
        }
      });
      if (mounted) {
        unlisteners.push(unlisten2);
      } else {
        unlisten2();
      }

      const unlisten3 = await api.onExportProgress((progress) => {
        if (!mounted) return;
        const currentProjectId = useEditorStore.getState().currentProject?.id;
        if (progress.project_id === currentProjectId) {
          setProcessingProgress(progress.progress);
        }
      });
      if (mounted) {
        unlisteners.push(unlisten3);
      } else {
        unlisten3();
      }
    };

    setupListeners().catch((err) => {
      console.error('Failed to setup editor listeners:', err);
    });

    return () => {
      mounted = false;
      unlisteners.forEach((fn) => fn());
      // 组件卸载时暂停视频，避免切换页面后仍有声音
      if (videoRef.current) {
        videoRef.current.pause();
      }
      setIsPlaying(false);
      // 不在这里调用 reset()，避免切换页面时丢失处理进度
      // reset() 应该只在项目真正关闭时调用

      // 退出编辑器时取消正在进行的转码任务（预览视频生成）
      // 只取消预览生成，不影响分析匹配、导出等其他任务
      // 后端会自动删除未完成的转码文件
      if (projectId) {
        api.cancelPreviewGeneration(projectId).catch(() => {
          // 忽略取消错误，可能没有正在进行的任务
        });
      }
    };
  }, [projectId]);

  // 视频加载后生成缩略图
  useEffect(() => {
    const generateThumbnail = async () => {
      if (!currentProject) {
        console.info('[thumbnail] skip: no project');
        return;
      }
      if (!appDir) {
        console.info('[thumbnail] skip: appDir not ready', { projectId: currentProject.id });
        return;
      }
      if (loadedProjectId !== currentProject.id) {
        console.info('[thumbnail] skip: video not loaded', {
          projectId: currentProject.id,
          loadedProjectId,
        });
        return;
      }

      try {
        console.info('[thumbnail] start', {
          projectId: currentProject.id,
          videoPath: currentProject.source_video_path,
          appDir,
        });
        const thumbDir = await join(appDir, 'thumbnails');
        const thumbPath = await join(thumbDir, `${currentProject.id}.jpg`);
        console.info('[thumbnail] paths', { thumbDir, thumbPath });

        // 生成缩略图
        console.info('[thumbnail] generate', {
          videoPath: currentProject.source_video_path,
          thumbPath,
          time: 0,
        });
        await api.getVideoThumbnail(
          currentProject.source_video_path,
          thumbPath,
          0
        );
        console.info('[thumbnail] done', { thumbPath });
      } catch (e) {
        // 缩略图生成失败不影响主流程，静默处理
        console.error('[thumbnail] failed', e);
      }
    };

    generateThumbnail();
  }, [currentProject, appDir, loadedProjectId]);

  // 检测并生成预览视频（用于播放不支持的格式如 FLV）
  useEffect(() => {
    const checkAndGeneratePreview = async () => {
      if (!currentProject || !appDir) return;

      // 如果已有预览视频路径且文件存在，跳过
      if (currentProject.preview_video_path) {
        const previewExists = await api.checkFileExists(currentProject.preview_video_path);
        if (previewExists) {
          console.info('[preview] skip: already has preview', currentProject.preview_video_path);
          return;
        }
        console.info('[preview] preview file missing, will regenerate', currentProject.preview_video_path);
      }

      let unlistenProgress: (() => void) | null = null;

      try {
        // 检测是否需要转码
        const needsPreview = await api.checkNeedsPreview(currentProject.source_video_path);
        if (!needsPreview) {
          console.info('[preview] skip: format supported natively');
          return;
        }

        console.info('[preview] generating preview video for unsupported format');
        setGeneratingPreview(true);
        setPreviewProgress(0);

        // 监听预览生成进度
        unlistenProgress = await api.onPreviewProgress((progress) => {
          if (progress.project_id === currentProject.id) {
            setPreviewProgress(progress.progress);
          }
        });

        // 生成预览视频
        const previewDir = await join(appDir, 'previews');
        const previewPath = await join(previewDir, `${currentProject.id}.mp4`);

        await api.generatePreviewVideo(
          currentProject.source_video_path,
          previewPath,
          currentProject.id
        );

        // 更新项目的预览视频路径
        await api.updateProjectPreview(currentProject.id, previewPath);

        // 重新加载项目以获取更新后的数据
        await loadProject(currentProject.id);

        addToast({
          type: 'success',
          title: t('editor.toast.previewComplete'),
          description: t('editor.toast.previewCompleteDesc'),
        });
      } catch (error) {
        console.error('[preview] failed to generate preview', error);
        addToast({
          type: 'warning',
          title: t('editor.toast.previewFailed'),
          description: t('editor.toast.previewFailedDesc'),
        });
      } finally {
        unlistenProgress?.();
        setGeneratingPreview(false);
        setPreviewProgress(0);
      }
    };

    checkAndGeneratePreview();
  }, [currentProject?.id, appDir]);

  // 从配置中加载选中的模型，优先使用已下载的模型
  useEffect(() => {
    if (models.length === 0) return;

    const configModelId = config?.separation?.selected_model_id;
    const configModelDownloaded = configModelId && isModelDownloaded(configModelId);

    if (configModelDownloaded) {
      // 配置中的模型已下载，使用它
      setSelectedModelId(configModelId);
    } else {
      // 配置中的模型未下载，使用第一个已下载的模型
      const firstDownloaded = getFirstDownloadedModel();
      if (firstDownloaded) {
        setSelectedModelId(firstDownloaded.id);
      }
    }
  }, [config, models]);

  // 视频播放控制 - 依赖 loadedProjectId 确保视频元素加载完成后再绑定事件
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !loadedProjectId) return;

    const handleTimeUpdate = () => {
      setPlaybackPosition(video.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    // 项目切换时重置音量状态和播放位置
    setIsMuted(false);
    setVolume(1);
    video.muted = false;
    video.volume = 1;
    video.currentTime = 0;

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
  }, [loadedProjectId]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
    setIsPlaying(!isPlaying);
  };

  const seekTo = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    setPlaybackPosition(time);
  };

  // 计算鼠标位置对应的时间
  const calculateTimeFromMouseEvent = useCallback((e: React.MouseEvent | MouseEvent): number => {
    const timeline = timelineRef.current;
    if (!timeline || duration <= 0) return 0;
    const rect = timeline.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    return percentage * duration;
  }, [duration]);

  // 时间轴鼠标按下处理
  const handleTimelineMouseDown = useCallback((e: React.MouseEvent) => {
    // 点击跳转（两种模式都支持）
    const time = calculateTimeFromMouseEvent(e);
    seekTo(time);
  }, [calculateTimeFromMouseEvent]);

  // 预览自定义剪辑片段
  const handlePreviewCustomClip = () => {
    if (customClipStart === null || customClipEnd === null) return;
    const start = Math.min(customClipStart, customClipEnd);
    seekTo(start);
    if (!isPlaying) {
      togglePlay();
    }
  };

  // 导出自定义剪辑片段（单片段 - 保留原有逻辑）
  const handleExportCustomClip = async () => {
    if (!currentProject || customClipStart === null || customClipEnd === null) return;

    const start = Math.min(customClipStart, customClipEnd);
    const end = Math.max(customClipStart, customClipEnd);

    if (end - start < 0.1) {
      addToast({
        type: 'warning',
        title: t('editor.toast.rangeTooShort'),
        description: t('editor.toast.rangeTooShortDesc'),
      });
      return;
    }

    // 生成默认导出路径
    const fullName = currentProject.source_video_path.split(/[/\\]/).pop() || 'video.mp4';
    const videoName = fullName.replace(/\.[^.]+$/, '');
    const ext = fullName.match(/\.[^.]+$/)?.[0] || '.mp4';
    const sourceDir = currentProject.source_video_path.split(/[/\\]/).slice(0, -1).join('\\');
    const defaultPath = `${sourceDir}\\${videoName}_clip_${formatDuration(start)}-${formatDuration(end)}${ext}`.replace(/:/g, '-');

    // 直接打开文件选择对话框
    const savePath = await api.saveFileDialog(defaultPath, [
      { name: t('common.videoFile'), extensions: ['mp4'] },
    ]);
    if (!savePath) return;

    // 使用全局处理状态
    const { setProcessing, setProcessingProgress } = useEditorStore.getState();
    setProcessing(true, t('editor.progress.exportingCustomClip'));

    try {
      await api.exportCustomClip(currentProject.id, start, end, savePath);
      addToast({
        type: 'success',
        title: t('editor.toast.exportComplete'),
        description: savePath,
      });
      // 导出成功后退出自定义剪辑模式
      exitCustomClipMode();
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      if (!errorMsg.includes('取消')) {
        addToast({
          type: 'error',
          title: t('editor.toast.exportFailed'),
          description: errorMsg,
        });
      } else {
        addToast({
          type: 'info',
          title: t('editor.toast.cancelled'),
          description: t('editor.toast.customClipExportCancelled', { name: currentProject.name }),
        });
      }
    } finally {
      setProcessing(false);
      setProcessingProgress(0);
      // 重置取消状态（如果是取消导致的结束）
      const { cancellingProjectId } = useEditorStore.getState();
      if (cancellingProjectId === currentProject.id) {
        useEditorStore.setState({ cancellingProjectId: null });
      }
    }
  };

  // 导出自定义剪辑多片段 - 打开导出对话框
  const handleExportCustomClipSegments = () => {
    if (!currentProject || customClipSegments.length === 0) return;
    setIsCustomClipExport(true);
    setExportMode('merged');
    if (currentProject) {
      const { mergedPath } = getDefaultExportPaths(currentProject.source_video_path);
      setExportPath(mergedPath);
    }
    setShowExportDialog(true);
  };

  // 计算自定义剪辑的有效时间范围
  const getCustomClipValidRange = () => {
    if (customClipStart === null || customClipEnd === null) {
      return { start: 0, end: 0, duration: 0, isValid: false };
    }
    const start = Math.min(customClipStart, customClipEnd);
    const end = Math.max(customClipStart, customClipEnd);
    return {
      start,
      end,
      duration: end - start,
      isValid: end - start >= 0.1,
    };
  };

  const handleStartProcessing = async () => {
    if (!currentProject) return;

    // 检查是否有已下载的模型
    if (!hasDownloadedModels()) {
      addToast({
        type: 'error',
        title: t('editor.toast.noModel'),
        description: t('editor.toast.downloadModelFirst'),
      });
      return;
    }

    if (musicList.length === 0) {
      addToast({
        type: 'warning',
        title: t('editor.toast.emptyLibrary'),
        description: t('editor.toast.importMusicFirst'),
      });
      return;
    }

    // 检查视频时长是否满足最小匹配要求
    const windowSize = config?.matching?.window_size || 15;
    if (duration < windowSize) {
      addToast({
        type: 'error',
        title: t('editor.toast.videoDurationShort'),
        description: t('editor.toast.videoDurationShortDesc', { duration: duration.toFixed(1), minDuration: windowSize.toFixed(1) }),
      });
      return;
    }

    // 检查选中的模型是否已下载
    const modelDownloaded = isModelDownloaded(selectedModelId);
    if (!modelDownloaded) {
      // 自动切换到第一个已下载的模型
      const firstDownloaded = getFirstDownloadedModel();
      if (firstDownloaded) {
        setSelectedModelId(firstDownloaded.id);
        addToast({
          type: 'info',
          title: t('editor.toast.modelSwitched'),
          description: t('editor.toast.modelSwitchedDesc', { name: firstDownloaded.name }),
        });
      } else {
        addToast({
          type: 'error',
          title: t('editor.toast.noModel'),
          description: t('editor.toast.downloadModelFirst'),
        });
        return;
      }
    }

    // 更新配置中的模型选择
    if (config && config.separation.selected_model_id !== selectedModelId) {
      const newConfig = {
        ...config,
        separation: {
          ...config.separation,
          selected_model_id: selectedModelId,
        },
      };
      await updateConfig(newConfig);
    }

    // 捕获启动时的项目上下文，确保整个分析链使用同一项目的数据
    const projectId = currentProject.id;
    const projectName = currentProject.name;
    const videoPath = currentProject.source_video_path;

    try {
      // 使用应用临时目录存放中间文件
      const tempDir = appDir ? await join(appDir, 'temp') : '';
      if (!tempDir) {
        throw new Error(t('editor.toast.processingFailed'));
      }

      // 检查缓存状态（失败则回退到完整流程）
      let cacheStatus: { audio_valid: boolean; audio_path: string | null; separation_valid: boolean; vocals_path: string | null; accompaniment_path: string | null } = {
        audio_valid: false, audio_path: null, separation_valid: false, vocals_path: null, accompaniment_path: null,
      };
      try {
        cacheStatus = await api.checkCacheStatus(projectId, videoPath, selectedModelId);
        console.log('[Editor] Cache status:', cacheStatus);
      } catch (e) {
        console.warn('[Editor] Cache check failed, running full pipeline:', e);
      }

      // 1. 提取音频（有缓存则跳过）
      let audioPath: string;
      if (cacheStatus.audio_valid && cacheStatus.audio_path) {
        console.log('[Editor] Skipping audio extraction, using cached:', cacheStatus.audio_path);
        audioPath = cacheStatus.audio_path;
        useEditorStore.getState().setAudioPath(audioPath);
      } else {
        console.log('[Editor] Audio cache miss, running extraction');
        audioPath = await join(tempDir, `${projectId}_audio.wav`);
        await extractAudio(audioPath, projectId, videoPath);
      }

      // 2. 人声分离（有缓存则跳过）
      let accompanimentPath: string;
      if (cacheStatus.separation_valid && cacheStatus.accompaniment_path && cacheStatus.vocals_path) {
        console.log('[Editor] Skipping vocal separation, using cached:', cacheStatus.accompaniment_path);
        accompanimentPath = cacheStatus.accompaniment_path;
        const store = useEditorStore.getState();
        store.setVocalsPath(cacheStatus.vocals_path);
        store.setAccompanimentPath(accompanimentPath);
      } else {
        console.log('[Editor] Separation cache miss, running vocal separation');
        const outputDir = await join(tempDir, `${projectId}_separated`);
        const result = await separateVocals(outputDir, projectId, audioPath, acceleration);
        accompanimentPath = result.accompanimentPath;
      }

      // 3. 匹配片段（始终执行，参数/音乐库可能变化）
      const musicIdsToUse = useCustomMusicLibrary && selectedMusicIds.length > 0
        ? selectedMusicIds
        : undefined;
      console.log(`[Editor] 开始匹配, useCustomMusicLibrary=${useCustomMusicLibrary}, selectedMusicIds.length=${selectedMusicIds.length}, musicIdsToUse:`, musicIdsToUse);
      await matchSegments(projectId, accompanimentPath, undefined, musicIdsToUse);

      // 显示完成提示（包含项目名称）
      const currentState = useEditorStore.getState();
      const segmentCount = currentState.currentProject?.id === projectId
        ? currentState.segments.length
        : (await api.loadProject(projectId)).segments.length;

      addToast({
        type: 'success',
        title: t('editor.toast.processingComplete', { name: projectName }),
        description: t('editor.toast.segmentsDetected', { count: segmentCount }),
      });
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      if (!errorMsg.includes('取消')) {
        addToast({
          type: 'error',
          title: t('editor.toast.processingFailed'),
          description: errorMsg,
        });
      } else {
        addToast({
          type: 'info',
          title: t('editor.toast.cancelled'),
          description: t('editor.toast.analysisCancelled', { name: projectName }),
        });
      }
    }
  };

  const handleExport = async () => {
    if (!currentProject) return;
    let finalPath = exportPath;

    // 自定义剪辑多片段导出
    if (isCustomClipExport) {
      const segmentsData = customClipSegments.map(s => ({
        start_time: s.start_time,
        end_time: s.end_time,
      }));

      const { setProcessing, setProcessingProgress } = useEditorStore.getState();

      if (exportMode === 'merged') {
        if (!finalPath) {
          const path = await api.saveFileDialog(undefined, [
            { name: t('common.videoFile'), extensions: ['mp4'] },
          ]);
          if (!path) return;
          setExportPath(path);
          finalPath = path;
        }
        setShowExportDialog(false);
        setProcessing(true, t('editor.progress.exportingCustomClips'));
        try {
          await api.exportCustomClipsMerged(currentProject.id, segmentsData, finalPath);
          addToast({
            type: 'success',
            title: t('editor.toast.exportComplete'),
            description: finalPath,
          });
        } catch (error) {
          const errorMsg = getErrorMessage(error);
          if (!errorMsg.includes('取消')) {
            addToast({ type: 'error', title: t('editor.toast.exportFailed'), description: errorMsg });
          } else {
            addToast({ type: 'info', title: t('editor.toast.cancelled'), description: t('editor.toast.exportCancelled', { name: currentProject.name }) });
          }
        } finally {
          setProcessing(false);
          setProcessingProgress(0);
          setIsCustomClipExport(false);
          // 重置取消状态（如果是取消导致的结束）
          const { cancellingProjectId } = useEditorStore.getState();
          if (cancellingProjectId === currentProject.id) {
            useEditorStore.setState({ cancellingProjectId: null });
          }
        }
      } else {
        if (!finalPath) {
          const path = await api.openDirectoryDialog();
          if (!path) return;
          setExportPath(path);
          finalPath = path;
        }
        setShowExportDialog(false);
        setProcessing(true, t('editor.progress.exportingCustomClips'));
        try {
          const result = await api.exportCustomClipsSeparately(currentProject.id, segmentsData, finalPath);
          addToast({
            type: 'success',
            title: t('editor.toast.exportComplete'),
            description: t('editor.toast.exportedSegments', { count: result.exported_count, path: finalPath }),
          });
        } catch (error) {
          const errorMsg = getErrorMessage(error);
          if (!errorMsg.includes('取消')) {
            addToast({ type: 'error', title: t('editor.toast.exportFailed'), description: errorMsg });
          } else {
            addToast({ type: 'info', title: t('editor.toast.cancelled'), description: t('editor.toast.exportCancelled', { name: currentProject.name }) });
          }
        } finally {
          setProcessing(false);
          setProcessingProgress(0);
          setIsCustomClipExport(false);
          // 重置取消状态（如果是取消导致的结束）
          const { cancellingProjectId } = useEditorStore.getState();
          if (cancellingProjectId === currentProject.id) {
            useEditorStore.setState({ cancellingProjectId: null });
          }
        }
      }
      return;
    }

    // 正常模式导出
    if (exportMode === 'merged') {
      // 合并导出模式
      if (!finalPath) {
        const path = await api.saveFileDialog(undefined, [
          { name: t('common.videoFile'), extensions: ['mp4'] },
        ]);
        if (!path) return;
        setExportPath(path);
        finalPath = path;
      }

      // 先关闭弹窗，导出任务在后台继续执行
      setShowExportDialog(false);

      const projectName = currentProject?.name || t('common.project');

      try {
        await exportVideo(finalPath);

        addToast({
          type: 'success',
          title: t('editor.toast.exportComplete'),
          description: finalPath,
        });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        if (!errorMsg.includes('取消')) {
          addToast({
            type: 'error',
            title: t('editor.toast.exportFailed'),
            description: errorMsg,
          });
        } else {
          addToast({
            type: 'info',
            title: t('editor.toast.cancelled'),
            description: t('editor.toast.exportCancelled', { name: projectName }),
          });
        }
      }
    } else {
      // 分别导出模式 - 选择输出目录
      if (!finalPath) {
        const path = await api.openDirectoryDialog();
        if (!path) return;
        setExportPath(path);
        finalPath = path;
      }

      // 先关闭弹窗，导出任务在后台继续执行
      setShowExportDialog(false);

      const projectName = currentProject?.name || 'Project';

      try {
        const result = await exportVideoSeparately(finalPath);

        addToast({
          type: 'success',
          title: t('editor.toast.exportComplete'),
          description: t('editor.toast.exportedSegments', { count: result.exportedCount, path: finalPath }),
        });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        if (!errorMsg.includes('取消')) {
          addToast({
            type: 'error',
            title: t('editor.toast.exportFailed'),
            description: errorMsg,
          });
        } else {
          addToast({
            type: 'info',
            title: t('editor.toast.cancelled'),
            description: t('editor.toast.exportCancelled', { name: projectName }),
          });
        }
      }
    }
  };

  if (!currentProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-[hsl(var(--text-muted))]">
          <Music className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p>{t('editor.selectProject')}</p>
          <Button
            variant="primary"
            className="mt-4"
            onClick={() => navigate('/')}
          >
            {t('editor.backToProjects')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[hsl(var(--background))]">
      {/* 顶部工具栏 */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-4">
          <h2
            className="text-lg font-semibold text-[hsl(var(--foreground))] max-w-[500px] truncate"
            title={currentProject.name}
          >
            {currentProject.name}
          </h2>
          <span className="text-sm text-[hsl(var(--text-muted))]">
            {formatDuration(duration)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* 模型状态显示 - 只有一个模型，简化为状态显示 */}
          {hasDownloadedModels() ? (
            <span className="px-3 py-1.5 bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded-lg text-sm text-[hsl(var(--foreground))]">
              MDX-Net Inst HQ3
            </span>
          ) : (
            <span className="px-3 py-1.5 text-sm text-yellow-500">
              {t('editor.downloadModelFirst')}
            </span>
          )}

          {/* 加速模式选择 */}
          <select
            value={acceleration}
            onChange={(e) => setAcceleration(e.target.value)}
            className="px-3 py-1.5 bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded-lg text-sm text-[hsl(var(--foreground))]"
          >
            <option value="gpu">{t('editor.gpuAcceleration')}</option>
            <option value="cpu">{t('editor.cpuOnly')}</option>
          </select>

          {/* 自定义音乐库选择 */}
          <Button
            variant={useCustomMusicLibrary ? 'primary' : 'secondary'}
            onClick={() => setShowMusicSelector(true)}
            disabled={processing}
            title={useCustomMusicLibrary ? t('common.selectedSongsCount', { count: selectedMusicIds.length }) : t('common.selectMatchingMusic')}
          >
            <Library className="w-4 h-4 mr-2" />
            {useCustomMusicLibrary ? t('editor.songsSelected', { count: selectedMusicIds.length }) : t('editor.allMusic')}
          </Button>

          <Button
            variant="primary"
            onClick={handleStartProcessing}
            disabled={processing || !hasDownloadedModels()}
            title={!hasDownloadedModels() ? t('common.downloadModelFirst') : ''}
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('common.processing')}
              </>
            ) : (
              <>
                <AudioWaveform className="w-4 h-4 mr-2" />
                {t('editor.startRecognition')}
              </>
            )}
          </Button>

          {(processing || cancelling) && (
            <Button
              variant="danger"
              onClick={cancelProcessing}
              disabled={cancelling}
            >
              {cancelling ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('common.cancelling')}
                </>
              ) : (
                t('common.cancel')
              )}
            </Button>
          )}

          <Button
            variant={segments.filter(s => s.status !== 'removed').length > 0 ? 'success' : 'secondary'}
            onClick={() => {
              // 为合并导出生成默认文件名
              if (currentProject) {
                const { mergedPath } = getDefaultExportPaths(currentProject.source_video_path);
                setExportPath(mergedPath);
              }
              setExportMode('merged');
              setIsCustomClipExport(false);
              setShowExportDialog(true);
            }}
            disabled={processing || segments.filter(s => s.status !== 'removed').length === 0}
          >
            <Share2 className="w-4 h-4 mr-2" />
            {t('common.export')}
          </Button>
        </div>
      </header>

      {/* 处理进度 */}
      {(processing || cancelling) && (
        <div className="px-4 py-2 bg-[hsl(var(--card-bg))] border-b border-[hsl(var(--border))]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-[hsl(var(--text-secondary))]">
              {cancelling ? t('common.cancelling') : processingMessage}
            </span>
            <span className="text-sm text-[hsl(var(--text-muted))]">
              {(processingProgress * 100).toFixed(1)}%
            </span>
          </div>
          <Progress value={processingProgress * 100} />
        </div>
      )}

      {/* 预览视频生成进度 */}
      {generatingPreview && (
        <div className="px-4 py-2 bg-[hsl(var(--card-bg))] border-b border-[hsl(var(--border))]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-[hsl(var(--text-secondary))]">
              {t('editor.progress.generatingPreview')}
            </span>
            <span className="text-sm text-[hsl(var(--text-muted))]">
              {(previewProgress * 100).toFixed(1)}%
            </span>
          </div>
          <Progress value={previewProgress * 100} />
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* 视频预览 */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 bg-black flex items-center justify-center min-h-0 overflow-hidden">
            <video
              ref={videoRef}
              src={convertFileSrc(currentProject.preview_video_path || currentProject.source_video_path)}
              className="max-w-full max-h-full"
              onLoadedMetadata={(event) => {
                console.info('[thumbnail] video metadata loaded', {
                  projectId: currentProject.id,
                  src: event.currentTarget.currentSrc,
                  duration: event.currentTarget.duration,
                  readyState: event.currentTarget.readyState,
                });
                setLoadedProjectId(currentProject.id);
                // 视频加载完成后重置播放位置
                event.currentTarget.currentTime = 0;
              }}
              onError={(event) => {
                const mediaError = event.currentTarget.error;
                console.error('[thumbnail] video load error', {
                  projectId: currentProject.id,
                  src: event.currentTarget.currentSrc,
                  code: mediaError?.code,
                  message: mediaError?.message,
                });
              }}
            />
          </div>

          {/* 播放控制 */}
          <div className="shrink-0 p-4 bg-[hsl(var(--card-bg))] border-t border-[hsl(var(--border))]">
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlay}
                className="p-3 bg-primary-600 rounded-full text-white hover:bg-primary-700 transition-colors"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5" />
                ) : (
                  <Play className="w-5 h-5" />
                )}
              </button>

              <div className="flex-1 mx-4">
                <input
                  type="range"
                  min={0}
                  max={duration}
                  value={playbackPosition}
                  onChange={(e) => seekTo(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              <span className="text-sm text-[hsl(var(--text-secondary))] font-mono">
                {formatDuration(playbackPosition)} / {formatDuration(duration)}
              </span>

              {/* 音量控制 */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (videoRef.current) {
                      const newMuted = !videoRef.current.muted;
                      videoRef.current.muted = newMuted;
                      setIsMuted(newMuted);
                    }
                  }}
                  className="p-2 text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--foreground))] transition-colors"
                >
                  {isMuted ? (
                    <VolumeX className="w-5 h-5" />
                  ) : (
                    <Volume2 className="w-5 h-5" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={volume}
                  onChange={(e) => {
                    const newVolume = parseFloat(e.target.value);
                    setVolume(newVolume);
                    if (videoRef.current) {
                      videoRef.current.volume = newVolume;
                    }
                  }}
                  className="w-20"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 片段列表 */}
        <aside className="w-80 border-l border-[hsl(var(--border))] flex flex-col">
          <div className="p-3 border-b border-[hsl(var(--border))]">
            <h3 className="font-medium text-[hsl(var(--foreground))]">{t('editor.segments.title')}</h3>
            <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
              {t('editor.segments.count', { count: segments.filter((s) => s.status !== 'removed').length })}
            </p>
          </div>

          <div className="flex-1 overflow-auto">
            {segments.length === 0 ? (
              <div className="p-4 text-center text-[hsl(var(--text-muted))]">
                <p>{t('editor.segments.empty')}</p>
                <p className="text-xs mt-1">{t('editor.segments.emptyHint')}</p>
              </div>
            ) : (
              <div className="p-2 space-y-2">
                {segments.map((segment, index) => {
                  const accentColors = getSegmentAccentColors(index);
                  return (
                    <div
                      key={segment.id}
                      onClick={() => {
                        setSelectedSegment(segment);
                        seekTo(segment.start_time);
                      }}
                      className={cn(
                        'p-3 rounded-lg border cursor-pointer transition-all',
                        selectedSegment?.id === segment.id && 'ring-2 ring-primary-500',
                        segment.status === 'removed' && 'opacity-50'
                      )}
                      style={{
                        backgroundColor: accentColors.background,
                        borderColor: accentColors.border,
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="flex items-center justify-center w-6 h-6 text-[11px] font-semibold text-white rounded-full shrink-0"
                            style={{ backgroundColor: accentColors.accent }}
                            title={`#${index + 1}`}
                          >
                            {index + 1}
                          </span>
                          <span className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
                            {segment.music_title || t('editor.segments.unknownMusic')}
                          </span>
                        </div>
                        <span className="text-xs text-[hsl(var(--text-muted))]">
                          {(segment.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    <div className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      {formatDuration(segment.start_time)} -{' '}
                      {formatDuration(segment.end_time)}
                    </div>
                    <div className="flex items-center gap-1 mt-2">
                      {segment.status !== 'removed' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeSegment(segment.id);
                          }}
                          className="px-2 py-0.5 text-xs text-red-500 hover:bg-red-500/20 rounded"
                        >
                          {t('common.remove')}
                        </button>
                      )}
                      {segment.status === 'removed' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            restoreSegment(segment.id);
                          }}
                          className="px-2 py-0.5 text-xs text-blue-500 hover:bg-blue-500/20 rounded"
                        >
                          {t('common.restore')}
                        </button>
                      )}
                    </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* 时间轴 */}
      <div className="bg-[hsl(var(--card-bg))] border-t border-[hsl(var(--border))] pt-2 px-2 pb-8">
        {/* 模式切换按钮 */}
        <div className="flex items-center gap-2 mb-2 min-h-[36px]">
          <Button
            variant={!customClipMode ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => {
              if (customClipMode) {
                exitCustomClipMode();
                setShowSegmentList(false);
              }
            }}
            disabled={processing}
            title={processing ? '' : ''}
          >
            {t('editor.timeline.normalMode')}
          </Button>
          <Button
            variant={customClipMode ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => {
              if (!customClipMode) {
                enterCustomClipMode();
              }
            }}
            disabled={processing}
            title={processing ? '' : ''}
          >
            <Scissors className="w-4 h-4 mr-1" />
            {t('editor.timeline.customClip')}
          </Button>

          {/* 自定义剪辑模式下的控制面板 */}
          {customClipMode && (
            <>
              <div className="h-4 w-px bg-[hsl(var(--border))] mx-2" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-[hsl(var(--text-muted))]">{t('editor.timeline.start')}:</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const newStart = customClipEnd !== null && playbackPosition > customClipEnd
                      ? customClipEnd
                      : playbackPosition;
                    setCustomClipRange(newStart, customClipEnd);
                  }}
                  title={t('editor.timeline.markStartTime')}
                  className="h-7 px-2"
                >
                  <Pointer className="w-4 h-4" />
                </Button>
                <TimeInput
                  value={customClipStart}
                  onChange={(v) => setCustomClipRange(v, customClipEnd)}
                  min={0}
                  max={customClipEnd ?? duration}
                  className="w-32 h-7 text-xs"
                  fps={currentProject?.video_info.fps}
                />
                <span className="text-xs text-[hsl(var(--text-muted))]">{t('editor.timeline.end')}:</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const newEnd = customClipStart !== null && playbackPosition < customClipStart
                      ? customClipStart
                      : playbackPosition;
                    setCustomClipRange(customClipStart, newEnd);
                  }}
                  title={t('editor.timeline.markEndTime')}
                  className="h-7 px-2"
                >
                  <Pointer className="w-4 h-4" />
                </Button>
                <TimeInput
                  value={customClipEnd}
                  onChange={(v) => setCustomClipRange(customClipStart, v)}
                  min={customClipStart ?? 0}
                  max={duration}
                  className="w-32 h-7 text-xs"
                  fps={currentProject?.video_info.fps}
                />
                {(() => {
                  const { duration: clipDuration, isValid } = getCustomClipValidRange();
                  return (
                    <span className={cn(
                      'text-xs font-mono',
                      isValid ? 'text-[hsl(var(--text-secondary))]' : 'text-[hsl(var(--text-muted))]'
                    )}>
                      {t('editor.timeline.duration')}: {formatPreciseTime(clipDuration)}
                    </span>
                  );
                })()}
              </div>
              <div className="h-4 w-px bg-[hsl(var(--border))] mx-2" />
              <Button
                variant="secondary"
                size="sm"
                onClick={handlePreviewCustomClip}
                disabled={!getCustomClipValidRange().isValid}
                title={t('common.preview')}
              >
                <Eye className="w-4 h-4 mr-1" />
                {t('common.preview')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={addCustomClipSegment}
                disabled={!getCustomClipValidRange().isValid}
              >
                <Plus className="w-4 h-4 mr-1" />
                {t('editor.timeline.addSegment')}
              </Button>
            </>
          )}
        </div>

        {/* 自定义剪辑片段栏 - 固定高度，常驻显示 */}
        {customClipMode && (
          <div className="flex items-center gap-2 h-[36px]">
            <div className="relative" ref={segmentListRef}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowSegmentList(!showSegmentList)}
                className="gap-1"
              >
                <Scissors className="w-4 h-4" />
                {t('editor.timeline.clipSegments', { count: customClipSegments.length })}
                {showSegmentList ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              </Button>
              {/* 向上展开的面板 */}
              {showSegmentList && customClipSegments.length > 0 && (
                <div className="absolute bottom-full left-0 mb-1 z-50 bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg shadow-lg p-2 min-w-[320px] max-h-[240px] overflow-y-auto">
                  {customClipSegments.map((seg, idx) => (
                    <div
                      key={seg.id}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1.5 rounded text-xs',
                        customClipEditingId === seg.id
                          ? 'bg-primary-500/10 text-primary-600'
                          : 'hover:bg-[hsl(var(--accent))] text-[hsl(var(--text-secondary))]'
                      )}
                    >
                      <span className="font-medium w-6">#{idx + 1}</span>
                      <span className="font-mono flex-1">{formatPreciseTime(seg.start_time)} - {formatPreciseTime(seg.end_time)}</span>
                      <button
                        className="p-1 rounded hover:bg-[hsl(var(--secondary))] transition-colors"
                        onClick={() => { editCustomClipSegment(seg.id); setShowSegmentList(false); }}
                        title={t('common.edit')}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        className="p-1 rounded hover:bg-red-100 hover:text-red-600 transition-colors"
                        onClick={() => removeCustomClipSegment(seg.id)}
                        title={t('common.delete')}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* 编辑片段操作 */}
            {customClipEditingId && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => updateCustomClipSegment(customClipEditingId)}
                  disabled={!getCustomClipValidRange().isValid}
                >
                  <Pencil className="w-4 h-4 mr-1" />
                  {t('editor.timeline.updateSegment')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearCustomClipEditing}
                >
                  <X className="w-4 h-4 mr-1" />
                  {t('editor.timeline.cancelEdit')}
                </Button>
              </>
            )}
            {/* 导出按钮 - 常驻 */}
            <Button
              variant="success"
              size="sm"
              onClick={() => {
                if (customClipSegments.length > 0) {
                  handleExportCustomClipSegments();
                } else {
                  handleExportCustomClip();
                }
              }}
              disabled={(customClipSegments.length === 0 && !getCustomClipValidRange().isValid) || processing}
              loading={processing}
            >
              <Share2 className="w-4 h-4 mr-1" />
              {customClipSegments.length > 0
                ? t('editor.timeline.exportSegments', { count: customClipSegments.length })
                : t('common.export')}
            </Button>
          </div>
        )}

        {/* 时间轴轨道 */}
        <div
          ref={timelineRef}
          className="relative h-12 bg-[hsl(var(--secondary))] rounded-lg overflow-hidden cursor-pointer"
          onMouseDown={handleTimelineMouseDown}
        >
          {/* 片段显示（非自定义剪辑模式或作为背景参考） */}
          {duration > 0 && segments.map((segment, index) => {
            const accentColors = getSegmentAccentColors(index);
            return (
              <div
                key={segment.id}
                className={cn(
                  'absolute top-0 h-full border-l border-r group',
                  segment.status === 'removed' && 'opacity-50',
                  !customClipMode && 'cursor-pointer',
                  !customClipMode && selectedSegment?.id === segment.id && 'ring-2 ring-primary-500 ring-inset z-[5]',
                  customClipMode && 'opacity-30 pointer-events-none'
                )}
                style={{
                  left: `${(segment.start_time / duration) * 100}%`,
                  width: `${((segment.end_time - segment.start_time) / duration) * 100}%`,
                  backgroundColor: accentColors.timeline,
                  borderColor: accentColors.border,
                }}
                onClick={(e) => {
                  if (customClipMode) return;
                  e.stopPropagation();
                  // 获取时间轴容器的边界，计算点击位置对应的精确时间
                  const timelineRect = e.currentTarget.parentElement?.getBoundingClientRect();
                  if (!timelineRect) return;
                  const clickX = e.clientX - timelineRect.left;
                  const percentage = clickX / timelineRect.width;
                  const targetTime = percentage * duration;
                  setSelectedSegment(segment);
                  seekTo(targetTime);
                }}
              >
                <span
                  className="absolute left-0.5 top-1/2 -translate-y-1/2 flex items-center justify-center min-w-[16px] h-[16px] px-0.5 text-[9px] font-bold text-white rounded-full shadow-sm"
                  style={{ backgroundColor: accentColors.accent }}
                >
                  {index + 1}
                </span>
              </div>
            );
          })}

          {/* 已提交的自定义剪辑片段 - 蓝色覆盖层 */}
          {customClipMode && duration > 0 && customClipSegments.map((seg, idx) => (
            <div
              key={seg.id}
              className={cn(
                'absolute top-0 h-full z-[5] pointer-events-none',
                customClipEditingId === seg.id
                  ? 'bg-yellow-500/30 border-y-2 border-dashed border-yellow-500'
                  : 'bg-blue-500/30'
              )}
              style={{
                left: `${(seg.start_time / duration) * 100}%`,
                width: `${((seg.end_time - seg.start_time) / duration) * 100}%`,
              }}
            >
              <span className="absolute left-0.5 top-0.5 text-[9px] font-bold text-blue-700 bg-blue-200/80 rounded px-0.5">
                {idx + 1}
              </span>
            </div>
          ))}

          {/* 自定义剪辑草稿选择区域 - 黄色虚线 */}
          {customClipMode && customClipStart !== null && customClipEnd !== null && duration > 0 && (
            <div
              className="absolute top-0 h-full bg-primary-500/25 border-y-2 border-dashed border-primary-400 z-[6] pointer-events-none"
              style={{
                left: `${(Math.min(customClipStart, customClipEnd) / duration) * 100}%`,
                width: `${(Math.abs(customClipEnd - customClipStart) / duration) * 100}%`,
              }}
            />
          )}

          {/* 播放头 */}
          {duration > 0 && (
            <div
              className="absolute top-0 w-0.5 h-full bg-primary-500 z-10 pointer-events-none"
              style={{ left: `min(${(playbackPosition / duration) * 100}%, calc(100% - 2px))` }}
            />
          )}
        </div>

        {/* 自定义剪辑标记 - 在时间轴下方显示三角形，始终保持高度避免窗口抖动 */}
        <div className="relative h-8 mt-1">
          {customClipMode && duration > 0 && (
            <>
              {/* 开始标记 - 绿色三角形向上指 */}
              {customClipStart !== null && (
                <div
                  className="absolute top-0 flex flex-col items-center"
                  style={{
                    left: `${(customClipStart / duration) * 100}%`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  <div
                    className="w-4 h-3 bg-green-500 shrink-0"
                    style={{ clipPath: 'polygon(0% 100%, 50% 0%, 100% 100%)' }}
                  />
                  <span className="text-xs text-green-600 font-medium">{t('editor.timeline.start')}</span>
                </div>
              )}
              {/* 结束标记 - 红色三角形向上指 */}
              {customClipEnd !== null && (
                <div
                  className="absolute top-0 flex flex-col items-center"
                  style={{
                    left: `${(customClipEnd / duration) * 100}%`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  <div
                    className="w-4 h-3 bg-red-500 shrink-0"
                    style={{ clipPath: 'polygon(0% 100%, 50% 0%, 100% 100%)' }}
                  />
                  <span className="text-xs text-red-600 font-medium">{t('editor.timeline.end')}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 导出对话框 */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('editor.dialog.exportTitle')}</DialogTitle>
            <DialogClose />
          </DialogHeader>
          <DialogBody className="space-y-4">
            {/* 导出模式选择 */}
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                {t('editor.dialog.exportMode')}
              </label>
              <div className="flex gap-2">
                <Button
                  variant={exportMode === 'merged' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => {
                    setExportMode('merged');
                    // 为合并导出生成默认文件名
                    if (currentProject) {
                      const { mergedPath } = getDefaultExportPaths(currentProject.source_video_path);
                      setExportPath(mergedPath);
                    }
                  }}
                  className="flex-1"
                >
                  {t('editor.dialog.mergedExport')}
                </Button>
                <Button
                  variant={exportMode === 'separate' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => {
                    setExportMode('separate');
                    // 分别导出只需要选择目录，设置为源视频所在目录
                    if (currentProject) {
                      const { separateDir } = getDefaultExportPaths(currentProject.source_video_path);
                      setExportPath(separateDir);
                    }
                  }}
                  className="flex-1"
                >
                  {t('editor.dialog.separateExport')}
                </Button>
              </div>
              <p className="text-xs text-[hsl(var(--text-muted))] mt-1.5">
                {exportMode === 'merged'
                  ? t('editor.dialog.mergedDesc')
                  : t('editor.dialog.separateDesc')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-1.5">
                {exportMode === 'merged' ? t('editor.dialog.outputPath') : t('editor.dialog.outputDir')}
              </label>
              <div className="flex gap-2">
                <Input
                  value={exportPath}
                  readOnly
                  placeholder={exportMode === 'merged' ? t('editor.dialog.selectSavePath') : t('editor.dialog.selectOutputDir')}
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  onClick={async () => {
                    if (exportMode === 'merged') {
                      const path = await api.saveFileDialog(undefined, [
                        { name: t('common.videoFile'), extensions: ['mp4'] },
                      ]);
                      if (path) setExportPath(path);
                    } else {
                      const path = await api.openDirectoryDialog();
                      if (path) setExportPath(path);
                    }
                  }}
                >
                  {t('common.browse')}
                </Button>
              </div>
              {/* 路径长度警告 */}
              {(() => {
                const { warning } = checkExportPathValidity(exportPath, exportMode);
                return warning ? (
                  <p className="text-xs text-yellow-500 mt-1.5">{warning}</p>
                ) : null;
              })()}
            </div>

            <p className="text-sm text-[hsl(var(--text-muted))]">
              {exportMode === 'merged'
                ? t('editor.dialog.exportHintMerged', { count: isCustomClipExport ? customClipSegments.length : segments.filter(s => s.status !== 'removed').length })
                : t('editor.dialog.exportHintSeparate', { count: isCustomClipExport ? customClipSegments.length : segments.filter(s => s.status !== 'removed').length })}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowExportDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleExport}
              disabled={!exportPath || processing || !checkExportPathValidity(exportPath, exportMode).valid}
              loading={processing}
            >
              {t('common.export')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 音乐选择器对话框 */}
      <MusicSelector
        open={showMusicSelector}
        onOpenChange={setShowMusicSelector}
      />
    </div>
  );
};

export default Editor;
