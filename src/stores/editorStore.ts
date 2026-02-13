// 编辑器状态管理

import { create } from 'zustand';
import type { Project, Segment, SegmentStatus, CustomClipSegment } from '@/types';
import * as api from '@/services/api';
import { useProjectStore } from './projectStore';
import i18n from '@/i18n';

// 每个项目独立的处理状态（包含中间文件路径和处理进度）
interface ProjectProcessingState {
  audioPath: string | null;
  vocalsPath: string | null;
  accompanimentPath: string | null;
  processing: boolean;
  processingMessage: string;
  processingProgress: number;
  // 自定义音乐库选择状态
  useCustomMusicLibrary: boolean;
  selectedMusicIds: string[];
  // 人物检测状态
  detectionProcessing: boolean;
  detectionProgress: number;
  detectionMessage: string;
}

// 创建默认的项目处理状态
const createDefaultProcessingState = (overrides?: Partial<ProjectProcessingState>): ProjectProcessingState => ({
  audioPath: null,
  vocalsPath: null,
  accompanimentPath: null,
  processing: false,
  processingMessage: '',
  processingProgress: 0,
  useCustomMusicLibrary: false,
  selectedMusicIds: [],
  detectionProcessing: false,
  detectionProgress: 0,
  detectionMessage: '',
  ...overrides,
});

interface EditorState {
  // 状态
  currentProject: Project | null;
  segments: Segment[];
  selectedSegment: Segment | null;
  playbackPosition: number;
  isPlaying: boolean;
  duration: number;
  processing: boolean;
  cancellingProjectId: string | null; // 正在取消的项目ID，防止快速重启任务时的竞态条件，同时确保取消状态只影响对应项目
  cancellingDetectionProjectId: string | null; // 正在取消检测的项目ID
  processingMessage: string;
  processingProgress: number;

  // 临时文件路径
  audioPath: string | null;
  vocalsPath: string | null;
  accompanimentPath: string | null;

  // 每个项目的处理状态缓存
  projectProcessingStates: Map<string, ProjectProcessingState>;

  // 自定义剪辑模式状态
  customClipMode: boolean;
  customClipStart: number | null;
  customClipEnd: number | null;
  customClipSegments: CustomClipSegment[];
  customClipEditingId: string | null;

  // 自定义音乐库选择状态
  useCustomMusicLibrary: boolean;
  selectedMusicIds: string[];

  // 人物检测状态（独立于人声分离）
  detectionProcessing: boolean;
  detectionProgress: number;
  detectionMessage: string;

  // 操作
  loadProject: (id: string) => Promise<Project>;
  createProject: (videoPath: string) => Promise<Project>;
  saveProject: () => Promise<void>;
  setCurrentProject: (project: Project | null) => void;

  // 片段操作
  setSegments: (segments: Segment[]) => void;
  addSegment: (segment: Segment) => void;
  updateSegment: (segment: Segment) => void;
  deleteSegment: (id: string) => void;
  setSelectedSegment: (segment: Segment | null) => void;
  removeSegment: (id: string) => Promise<void>;
  restoreSegment: (id: string) => Promise<void>;

  // 播放控制
  setPlaybackPosition: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setDuration: (duration: number) => void;

  // 处理状态
  setProcessing: (processing: boolean, message?: string) => void;
  setProcessingProgress: (progress: number) => void;
  setProcessingProgressForProject: (projectId: string, progress: number, message?: string) => void;

  // 文件路径
  setAudioPath: (path: string | null) => void;
  setVocalsPath: (path: string | null) => void;
  setAccompanimentPath: (path: string | null) => void;

  // 处理操作（接受项目上下文参数，确保多项目并行分析时数据隔离）
  extractAudio: (outputPath: string, projectId: string, videoPath: string) => Promise<string>;
  separateVocals: (outputDir: string, projectId: string, audioPath: string, acceleration?: string) => Promise<{ vocalsPath: string; accompanimentPath: string }>;
  matchSegments: (projectId: string, accompanimentPath: string, minConfidence?: number, musicIds?: string[]) => Promise<void>;
  cutVideo: (outputPath: string, keepMatched: boolean, forceReencode?: boolean) => Promise<void>;
  exportVideo: (outputPath: string, forceReencode?: boolean) => Promise<void>;
  exportVideoSeparately: (outputDir: string, forceReencode?: boolean) => Promise<{ exportedCount: number; outputFiles: string[] }>;
  cancelProcessing: () => Promise<void>;

  // 人物检测操作（独立于人声分离 pipeline）
  detectPersons: (projectId: string, videoPath: string, outputDir: string, acceleration?: string) => Promise<void>;
  cancelDetection: (projectId: string) => Promise<void>;

  // 清除指定项目的缓存状态
  clearProjectState: (projectId: string) => void;

  // 自定义剪辑模式操作
  enterCustomClipMode: () => void;
  exitCustomClipMode: () => void;
  setCustomClipRange: (start: number | null, end: number | null) => void;
  addCustomClipSegment: () => void;
  updateCustomClipSegment: (id: string) => void;
  removeCustomClipSegment: (id: string) => void;
  editCustomClipSegment: (id: string) => void;
  clearCustomClipEditing: () => void;

  // 自定义音乐库选择操作
  setUseCustomMusicLibrary: (use: boolean) => void;
  setSelectedMusicIds: (ids: string[]) => void;
  toggleMusicSelection: (id: string) => void;
  clearMusicSelection: () => void;

  // 重置
  reset: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => {
  // 辅助函数：开始处理任务
  const startProcessingTask = (projectId: string, message: string) => {
    const states = new Map(get().projectProcessingStates);
    states.set(projectId, {
      audioPath: get().audioPath,
      vocalsPath: get().vocalsPath,
      accompanimentPath: get().accompanimentPath,
      processing: true,
      processingMessage: message,
      processingProgress: 0,
      useCustomMusicLibrary: get().useCustomMusicLibrary,
      selectedMusicIds: get().selectedMusicIds,
      detectionProcessing: get().detectionProcessing,
      detectionProgress: get().detectionProgress,
      detectionMessage: get().detectionMessage,
    });
    // 只有当前项目才更新全局显示状态
    if (get().currentProject?.id === projectId) {
      set({
        processing: true,
        processingMessage: message,
        projectProcessingStates: states,
      });
    } else {
      set({ projectProcessingStates: states });
    }
  };

  // 辅助函数：完成处理任务
  const finishProcessingTask = (projectId: string, wasCancelled = false) => {
    const isCancellingThisProject = get().cancellingProjectId === projectId;
    const segments = get().segments;

    if (get().currentProject?.id === projectId) {
      set({
        processing: false,
        cancellingProjectId: null,
        processingMessage: wasCancelled || isCancellingThisProject ? 'common.cancelled' : '',
      });
    } else {
      const states = new Map(get().projectProcessingStates);
      const state = states.get(projectId);
      if (state) {
        state.processing = false;
        state.processingMessage = '';
        state.processingProgress = 0;
        states.set(projectId, state);
        set({ projectProcessingStates: states, cancellingProjectId: null });
      } else {
        set({ cancellingProjectId: null });
      }
    }

    // 如果是取消操作，恢复项目列表页面的状态显示
    if ((wasCancelled || isCancellingThisProject) && projectId) {
      const hasSegments = segments.length > 0;
      useProjectStore.getState().restoreProjectStatus(projectId, hasSegments);
    }
  };

  // 辅助函数：清理项目缓存状态，避免内存泄漏
  const cleanupProjectCache = (projectId: string) => {
    const states = new Map(get().projectProcessingStates);
    states.delete(projectId);
    set({ projectProcessingStates: states });
  };

  // 辅助函数：检查指定项目是否可以开始新任务
  const canStartProcessing = (projectId: string) => {
    const { cancellingProjectId, currentProject, projectProcessingStates } = get();
    // 该项目正在取消中，不允许启动
    if (cancellingProjectId === projectId) {
      throw new Error(i18n.t('common.cancellingTask'));
    }
    // 检查该项目是否已有任务在执行（pipeline 或检测）
    if (currentProject?.id === projectId && (get().processing || get().detectionProcessing)) {
      throw new Error(i18n.t('common.taskRunning'));
    }
    const cachedState = projectProcessingStates.get(projectId);
    if (cachedState?.processing || cachedState?.detectionProcessing) {
      throw new Error(i18n.t('common.taskRunning'));
    }
    return true;
  };

  return {
  currentProject: null,
  segments: [],
  selectedSegment: null,
  playbackPosition: 0,
  isPlaying: false,
  duration: 0,
  processing: false,
  cancellingProjectId: null,
  cancellingDetectionProjectId: null,
  processingMessage: '',
  processingProgress: 0,
  audioPath: null,
  vocalsPath: null,
  accompanimentPath: null,
  projectProcessingStates: new Map(),
  // 自定义剪辑模式初始状态
  customClipMode: false,
  customClipStart: null,
  customClipEnd: null,
  customClipSegments: [],
  customClipEditingId: null,
  // 自定义音乐库选择初始状态
  useCustomMusicLibrary: false,
  selectedMusicIds: [],
  // 人物检测初始状态
  detectionProcessing: false,
  detectionProgress: 0,
  detectionMessage: '',

  loadProject: async (id: string) => {
    const currentId = get().currentProject?.id;

    // 立即重置播放状态、选中片段和自定义剪辑状态，避免异步加载期间显示旧的状态
    set({
      playbackPosition: 0,
      isPlaying: false,
      selectedSegment: null,
      // 切换项目时清除自定义剪辑状态（不缓存）
      customClipMode: false,
      customClipStart: null,
      customClipEnd: null,
      customClipSegments: [],
      customClipEditingId: null,
    });

    // 如果是同一个项目，只更新 segments，不重置处理状态
    if (currentId === id) {
      const project = await api.loadProject(id);
      set({
        currentProject: project,
        segments: project.segments,
        duration: project.video_info.duration,
        // 保持其他状态不变（processing、processingProgress 等）
      });
      return project;
    }

    // 保存当前项目的完整处理状态（包括进度）
    if (currentId) {
      const currentState: ProjectProcessingState = {
        audioPath: get().audioPath,
        vocalsPath: get().vocalsPath,
        accompanimentPath: get().accompanimentPath,
        processing: get().processing,
        processingMessage: get().processingMessage,
        processingProgress: get().processingProgress,
        useCustomMusicLibrary: get().useCustomMusicLibrary,
        selectedMusicIds: get().selectedMusicIds,
        detectionProcessing: get().detectionProcessing,
        detectionProgress: get().detectionProgress,
        detectionMessage: get().detectionMessage,
      };
      const newStates = new Map(get().projectProcessingStates);
      newStates.set(currentId, currentState);
      set({ projectProcessingStates: newStates });
    }

    const project = await api.loadProject(id);

    // 恢复目标项目的完整处理状态
    const savedState = get().projectProcessingStates.get(id);

    // 恢复后删除该项目的缓存条目（已成为当前项目，状态由全局字段管理）
    const cleanedStates = new Map(get().projectProcessingStates);
    cleanedStates.delete(id);

    // 确定最终的处理状态
    // 优先使用 projectProcessingStates 缓存（由 editorStore 的 pipeline 函数维护）
    // 缓存缺失时（如任务在后台完成后被清理），回退到 projectStore.projectStatus
    // （projectStore 的全局监听器始终活跃，即使 Editor 组件卸载期间也能接收后端事件）
    let restoredProcessing = savedState?.processing ?? false;
    let restoredMessage = savedState?.processingMessage ?? '';
    let restoredProgress = savedState?.processingProgress ?? 0;
    let restoredDetectionProcessing = savedState?.detectionProcessing ?? false;
    let restoredDetectionMessage = savedState?.detectionMessage ?? '';
    let restoredDetectionProgress = savedState?.detectionProgress ?? 0;

    if (!savedState) {
      // 缓存不存在（可能被 matchSegments 完成后清理，或从未创建）
      // 从 projectStore 获取实时状态作为兜底
      const projectStatus = useProjectStore.getState().projectStatus[id];
      const isActiveInProjectStore = projectStatus &&
        projectStatus.stage !== 'idle' &&
        projectStatus.stage !== 'analyzed' &&
        projectStatus.stage !== 'exported' &&
        projectStatus.progress < 1;

      if (isActiveInProjectStore) {
        const stageMessageMap: Record<string, string> = {
          extracting: 'editor.progress.extractingAudio',
          separating: 'editor.progress.separatingVocals',
          matching: 'editor.progress.matchingSegments',
          detecting: 'editor.progress.detectingPersons',
          exporting: 'common.exportingVideo',
          queued: 'editor.progress.separationQueued',
        };

        if (projectStatus.stage === 'detecting') {
          // 检测任务恢复到 detectionProcessing
          restoredDetectionProcessing = true;
          restoredDetectionProgress = projectStatus.progress;
          restoredDetectionMessage = stageMessageMap[projectStatus.stage] || '';
        } else {
          // pipeline 任务恢复到 processing
          restoredProcessing = true;
          restoredProgress = projectStatus.progress;
          restoredMessage = stageMessageMap[projectStatus.stage] || '';
        }
      }
    }

    set({
      currentProject: project,
      segments: project.segments,
      duration: project.video_info.duration,
      selectedSegment: null,
      playbackPosition: 0,
      isPlaying: false,
      // 恢复处理状态
      processing: restoredProcessing,
      processingMessage: restoredMessage,
      processingProgress: restoredProgress,
      // 恢复中间文件路径
      audioPath: savedState?.audioPath ?? null,
      vocalsPath: savedState?.vocalsPath ?? null,
      accompanimentPath: savedState?.accompanimentPath ?? null,
      // 恢复自定义音乐库选择状态
      useCustomMusicLibrary: savedState?.useCustomMusicLibrary ?? false,
      selectedMusicIds: savedState?.selectedMusicIds ?? [],
      // 恢复人物检测状态
      detectionProcessing: restoredDetectionProcessing,
      detectionProgress: restoredDetectionProgress,
      detectionMessage: restoredDetectionMessage,
      // 清理已恢复的缓存条目
      projectProcessingStates: cleanedStates,
    });

    return project;
  },

  createProject: async (videoPath: string) => {
    const currentId = get().currentProject?.id;

    // 保存当前项目的完整处理状态
    if (currentId) {
      const currentState: ProjectProcessingState = {
        audioPath: get().audioPath,
        vocalsPath: get().vocalsPath,
        accompanimentPath: get().accompanimentPath,
        processing: get().processing,
        processingMessage: get().processingMessage,
        processingProgress: get().processingProgress,
        useCustomMusicLibrary: get().useCustomMusicLibrary,
        selectedMusicIds: get().selectedMusicIds,
        detectionProcessing: get().detectionProcessing,
        detectionProgress: get().detectionProgress,
        detectionMessage: get().detectionMessage,
      };
      const newStates = new Map(get().projectProcessingStates);
      newStates.set(currentId, currentState);
      set({ projectProcessingStates: newStates });
    }

    const project = await api.createProject(videoPath);
    set({
      currentProject: project,
      segments: [],
      duration: project.video_info.duration,
      selectedSegment: null,
      playbackPosition: 0,
      isPlaying: false,
      // 新项目重置处理状态
      processing: false,
      processingMessage: '',
      processingProgress: 0,
      audioPath: null,
      vocalsPath: null,
      accompanimentPath: null,
      // 新项目重置自定义音乐库选择状态
      useCustomMusicLibrary: false,
      selectedMusicIds: [],
      // 新项目重置人物检测状态
      detectionProcessing: false,
      detectionProgress: 0,
      detectionMessage: '',
    });
    return project;
  },

  saveProject: async () => {
    const { currentProject, segments } = get();
    if (!currentProject) return;

    const updatedProject = {
      ...currentProject,
      segments,
      updated_at: new Date().toISOString(),
    };

    await api.saveProject(updatedProject);
    set({ currentProject: updatedProject });
  },

  setCurrentProject: (project: Project | null) => {
    set({
      currentProject: project,
      segments: project?.segments || [],
      duration: project?.video_info.duration || 0,
    });
  },

  setSegments: (segments: Segment[]) => {
    set({ segments });
  },

  addSegment: (segment: Segment) => {
    const segments = [...get().segments, segment];
    segments.sort((a, b) => a.start_time - b.start_time);
    set({ segments });
  },

  updateSegment: (segment: Segment) => {
    const segments = get().segments.map((s) =>
      s.id === segment.id ? segment : s
    );
    set({ segments });
  },

  deleteSegment: (id: string) => {
    const segments = get().segments.filter((s) => s.id !== id);
    const selectedSegment = get().selectedSegment;
    set({
      segments,
      selectedSegment: selectedSegment?.id === id ? null : selectedSegment,
    });
  },

  setSelectedSegment: (segment: Segment | null) => {
    set({ selectedSegment: segment });
  },

  removeSegment: async (id: string) => {
    const segments = get().segments.map((s) =>
      s.id === id ? { ...s, status: 'removed' as SegmentStatus } : s
    );
    set({ segments });
    // 同步到数据库
    const projectId = get().currentProject?.id;
    if (projectId) {
      await api.updateSegments(projectId, segments);
    }
  },

  restoreSegment: async (id: string) => {
    const segments = get().segments.map((s) =>
      s.id === id ? { ...s, status: 'detected' as SegmentStatus } : s
    );
    set({ segments });
    // 同步到数据库
    const projectId = get().currentProject?.id;
    if (projectId) {
      await api.updateSegments(projectId, segments);
    }
  },

  setPlaybackPosition: (time: number) => {
    set({ playbackPosition: time });
  },

  setIsPlaying: (playing: boolean) => {
    set({ isPlaying: playing });
  },

  setDuration: (duration: number) => {
    set({ duration });
  },

  setProcessing: (processing: boolean, message?: string) => {
    set({
      processing,
      processingMessage: message || '',
      processingProgress: processing ? 0 : get().processingProgress,
    });
  },

  setProcessingProgress: (progress: number) => {
    set({ processingProgress: progress });
  },

  setProcessingProgressForProject: (projectId: string, progress: number, message?: string) => {
    const currentId = get().currentProject?.id;
    if (currentId === projectId) {
      // 当前项目，直接更新显示
      if (message !== undefined) {
        set({ processingProgress: progress, processingMessage: message });
      } else {
        set({ processingProgress: progress });
      }
    } else {
      // 非当前项目，更新缓存（如果缓存条目不存在则创建，避免丢失进度）
      const states = new Map(get().projectProcessingStates);
      const state = states.get(projectId) || createDefaultProcessingState({ processing: true });
      state.processingProgress = progress;
      if (message !== undefined) {
        state.processingMessage = message;
      }
      states.set(projectId, state);
      set({ projectProcessingStates: states });
    }
  },

  setAudioPath: (path: string | null) => {
    set({ audioPath: path });
  },

  setVocalsPath: (path: string | null) => {
    set({ vocalsPath: path });
  },

  setAccompanimentPath: (path: string | null) => {
    set({ accompanimentPath: path });
  },

  extractAudio: async (outputPath: string, projectId: string, videoPath: string) => {
    // 注意：不再调用 canStartProcessing，由 handleStartProcessing 在 pipeline 入口统一检查

    // 设置当前项目的处理状态（如果是当前项目）
    if (get().currentProject?.id === projectId) {
      set({ processing: true, processingMessage: 'editor.progress.extractingAudio' });
    } else {
      // 更新缓存中的处理状态
      const states = new Map(get().projectProcessingStates);
      const state = states.get(projectId) || createDefaultProcessingState();
      state.processing = true;
      state.processingMessage = 'editor.progress.extractingAudio';
      states.set(projectId, state);
      set({ projectProcessingStates: states });
    }

    try {
      await api.extractAudio(videoPath, outputPath, projectId);
      // 检查项目是否是当前项目
      if (get().currentProject?.id === projectId) {
        // 当前项目，更新路径（不重置 processing，由 pipeline 最后一步负责）
        set({ audioPath: outputPath });
      } else {
        // 非当前项目，将结果保存到缓存（不重置 processing，pipeline 继续）
        const states = new Map(get().projectProcessingStates);
        const state = states.get(projectId) || createDefaultProcessingState();
        state.audioPath = outputPath;
        states.set(projectId, state);
        set({ projectProcessingStates: states });
      }
      return outputPath;
    } catch (error) {
      const wasCancelled = get().cancellingProjectId === projectId || (error instanceof Error && error.message.includes('取消'));
      finishProcessingTask(projectId, wasCancelled);
      throw error;
    }
  },

  separateVocals: async (outputDir: string, projectId: string, audioPath: string, acceleration?: string) => {
    // 注意：不再调用 canStartProcessing，由 handleStartProcessing 在 pipeline 入口统一检查，
    // 且前序步骤完成后 processing 保持为 true，canStartProcessing 会误判

    // 设置处理状态
    if (get().currentProject?.id === projectId) {
      set({ processing: true, processingMessage: 'editor.progress.separatingVocals' });
    } else {
      const states = new Map(get().projectProcessingStates);
      const state = states.get(projectId) || createDefaultProcessingState();
      state.processing = true;
      state.processingMessage = 'editor.progress.separatingVocals';
      states.set(projectId, state);
      set({ projectProcessingStates: states });
    }

    try {
      const result = await api.separateVocals(audioPath, outputDir, acceleration, projectId);
      // 检查项目是否是当前项目
      if (get().currentProject?.id === projectId) {
        // 当前项目，更新路径（不重置 processing，由 pipeline 最后一步负责）
        set({
          vocalsPath: result.vocals_path,
          accompanimentPath: result.accompaniment_path,
        });
      } else {
        // 非当前项目，将结果保存到缓存（不重置 processing，pipeline 继续）
        const states = new Map(get().projectProcessingStates);
        const state = states.get(projectId) || createDefaultProcessingState();
        state.vocalsPath = result.vocals_path;
        state.accompanimentPath = result.accompaniment_path;
        states.set(projectId, state);
        set({ projectProcessingStates: states });
      }
      return {
        vocalsPath: result.vocals_path,
        accompanimentPath: result.accompaniment_path,
      };
    } catch (error) {
      const wasCancelled = get().cancellingProjectId === projectId || (error instanceof Error && error.message.includes('取消'));
      finishProcessingTask(projectId, wasCancelled);
      throw error;
    }
  },

  matchSegments: async (projectId: string, accompanimentPath: string, minConfidence?: number, musicIds?: string[]) => {
    // 日志记录
    if (musicIds && musicIds.length > 0) {
      console.log(`[matchSegments] 使用自定义音乐库: ${musicIds.length} 首, ID 列表:`, musicIds);
    } else {
      console.log('[matchSegments] 使用全部音乐库');
    }

    // 注意：不再调用 canStartProcessing，由 handleStartProcessing 在 pipeline 入口统一检查，
    // 且前序步骤完成后 processing 保持为 true，canStartProcessing 会误判

    // 设置处理状态
    if (get().currentProject?.id === projectId) {
      set({ processing: true, processingMessage: 'editor.progress.matchingSegments' });
    } else {
      const states = new Map(get().projectProcessingStates);
      const state = states.get(projectId) || createDefaultProcessingState();
      state.processing = true;
      state.processingMessage = 'editor.progress.matchingSegments';
      states.set(projectId, state);
      set({ projectProcessingStates: states });
    }

    try {
      const segments = await api.matchVideoSegments(
        accompanimentPath,
        projectId,
        minConfidence,
        musicIds
      );
      // 检查项目是否是当前项目
      if (get().currentProject?.id === projectId) {
        // 当前项目，直接更新显示
        set({ segments, processing: false, processingMessage: '', processingProgress: 0 });
      } else {
        // 非当前项目，将结果保存到后端
        // 这样当用户切换回该项目时，loadProject 会加载这些 segments
        const project = await api.loadProject(projectId);
        const updatedProject = {
          ...project,
          segments,
          updated_at: new Date().toISOString(),
        };
        await api.saveProject(updatedProject);

        // 结果已持久化到数据库，清理缓存（避免内存泄漏）
        const states = new Map(get().projectProcessingStates);
        states.delete(projectId);
        set({ projectProcessingStates: states });
      }
    } catch (error) {
      const wasCancelled = get().cancellingProjectId === projectId || (error instanceof Error && error.message.includes('取消'));
      finishProcessingTask(projectId, wasCancelled);
      cleanupProjectCache(projectId);
      throw error;
    }
  },

  cutVideo: async (outputPath: string, keepMatched: boolean, forceReencode?: boolean) => {
    const { currentProject, segments } = get();
    if (!currentProject) throw new Error(i18n.t('common.noProjectOpen'));

    const projectId = currentProject.id;

    // 检查是否可以开始新任务
    canStartProcessing(projectId);

    // 先保存 segments 到数据库，确保后端使用最新数据
    await api.updateSegments(projectId, segments);

    startProcessingTask(projectId, 'common.cuttingVideo');

    let wasCancelled = false;
    try {
      await api.cutVideo({
        project_id: projectId,
        output_path: outputPath,
        keep_matched: keepMatched,
        force_reencode: forceReencode,
      });
    } catch (error) {
      wasCancelled = get().cancellingProjectId === projectId || (error instanceof Error && error.message.includes('取消'));
      throw error;
    } finally {
      finishProcessingTask(projectId, wasCancelled);
      cleanupProjectCache(projectId);
    }
  },

  exportVideo: async (outputPath: string, forceReencode?: boolean) => {
    const { currentProject, segments } = get();
    if (!currentProject) throw new Error(i18n.t('common.noProjectOpen'));

    const projectId = currentProject.id;

    // 详细记录前端传给后端的片段信息，用于排查导出内容与时间轴不一致的问题
    const detected = segments.filter(s => s.status !== 'removed');
    const removed = segments.filter(s => s.status === 'removed');
    const musicSegs = segments.filter(s => s.segment_type === 'music');
    const personSegs = segments.filter(s => s.segment_type === 'person');
    const totalDuration = detected.reduce((sum, s) => sum + (s.end_time - s.start_time), 0);
    console.log(`[exportVideo] 前端片段统计: 总计=${segments.length}, detected=${detected.length}, removed=${removed.length}, music=${musicSegs.length}, person=${personSegs.length}, detected总时长=${totalDuration.toFixed(2)}s`);
    segments.forEach((s, i) => {
      console.log(`[exportVideo]   片段[${i}]: id=${s.id}, ${s.start_time.toFixed(2)}s - ${s.end_time.toFixed(2)}s (时长 ${(s.end_time - s.start_time).toFixed(2)}s), status=${s.status}, type=${s.segment_type}`);
    });

    // 检查是否可以开始新任务
    canStartProcessing(projectId);

    // 先保存 segments 到数据库，确保后端使用最新数据
    console.log(`[exportVideo] 同步 ${segments.length} 个片段到数据库...`);
    await api.updateSegments(projectId, segments);
    console.log(`[exportVideo] 片段同步完成，开始导出...`);

    startProcessingTask(projectId, 'common.exportingVideo');

    let wasCancelled = false;
    try {
      await api.exportVideo(projectId, outputPath, forceReencode);
    } catch (error) {
      wasCancelled = get().cancellingProjectId === projectId || (error instanceof Error && error.message.includes('取消'));
      throw error;
    } finally {
      finishProcessingTask(projectId, wasCancelled);
      cleanupProjectCache(projectId);
    }
  },

  exportVideoSeparately: async (outputDir: string, forceReencode?: boolean) => {
    const { currentProject, segments } = get();
    if (!currentProject) throw new Error(i18n.t('common.noProjectOpen'));

    const projectId = currentProject.id;

    // 详细记录前端传给后端的片段信息
    const detected = segments.filter(s => s.status !== 'removed');
    const removed = segments.filter(s => s.status === 'removed');
    const musicSegs = segments.filter(s => s.segment_type === 'music');
    const personSegs = segments.filter(s => s.segment_type === 'person');
    const totalDuration = detected.reduce((sum, s) => sum + (s.end_time - s.start_time), 0);
    console.log(`[exportVideoSeparately] 前端片段统计: 总计=${segments.length}, detected=${detected.length}, removed=${removed.length}, music=${musicSegs.length}, person=${personSegs.length}, detected总时长=${totalDuration.toFixed(2)}s`);
    segments.forEach((s, i) => {
      console.log(`[exportVideoSeparately]   片段[${i}]: id=${s.id}, ${s.start_time.toFixed(2)}s - ${s.end_time.toFixed(2)}s (时长 ${(s.end_time - s.start_time).toFixed(2)}s), status=${s.status}, type=${s.segment_type}`);
    });

    // 检查是否可以开始新任务
    canStartProcessing(projectId);

    // 先保存 segments 到数据库，确保后端使用最新数据
    console.log(`[exportVideoSeparately] 同步 ${segments.length} 个片段到数据库...`);
    await api.updateSegments(projectId, segments);
    console.log(`[exportVideoSeparately] 片段同步完成，开始导出...`);

    startProcessingTask(projectId, 'common.exportingSegments');

    let wasCancelled = false;
    try {
      const result = await api.exportVideoSeparately(projectId, outputDir, forceReencode);
      return {
        exportedCount: result.exported_count,
        outputFiles: result.output_files,
      };
    } catch (error) {
      wasCancelled = get().cancellingProjectId === projectId || (error instanceof Error && error.message.includes('取消'));
      throw error;
    } finally {
      finishProcessingTask(projectId, wasCancelled);
      cleanupProjectCache(projectId);
    }
  },

  cancelProcessing: async () => {
    const projectId = get().currentProject?.id;

    // 设置取消中状态，记录正在取消的项目ID
    // 注意：不在这里重置 cancellingProjectId，而是由正在运行的处理任务在结束时重置
    set({ cancellingProjectId: projectId || null });

    try {
      await api.cancelProcessing(projectId);
    } catch (error) {
      // 如果取消 API 调用失败，重置 cancellingProjectId 状态
      set({ cancellingProjectId: null });
      throw error;
    }
    // 成功发送取消请求后，等待处理任务结束时重置状态
  },

  // 人物检测（独立于人声分离 pipeline）
  detectPersons: async (projectId: string, videoPath: string, outputDir: string, acceleration?: string) => {
    // 检查是否已有任务在运行（检测或 pipeline）
    const { currentProject, projectProcessingStates, cancellingProjectId, cancellingDetectionProjectId } = get();
    if (cancellingProjectId === projectId || cancellingDetectionProjectId === projectId) {
      throw new Error(i18n.t('common.cancellingTask'));
    }
    if (currentProject?.id === projectId && (get().detectionProcessing || get().processing)) {
      throw new Error(i18n.t('common.taskRunning'));
    }
    const cachedState = projectProcessingStates.get(projectId);
    if (cachedState?.detectionProcessing || cachedState?.processing) {
      throw new Error(i18n.t('common.taskRunning'));
    }

    // 设置检测处理状态
    if (get().currentProject?.id === projectId) {
      set({
        detectionProcessing: true,
        detectionProgress: 0,
        detectionMessage: 'editor.progress.detectingPersons',
      });
    } else {
      const states = new Map(get().projectProcessingStates);
      const state = states.get(projectId) || createDefaultProcessingState();
      state.detectionProcessing = true;
      state.detectionProgress = 0;
      state.detectionMessage = 'editor.progress.detectingPersons';
      states.set(projectId, state);
      set({ projectProcessingStates: states });
    }

    try {
      const segments = await api.detectPersons(projectId, videoPath, outputDir, acceleration);
      if (get().currentProject?.id === projectId) {
        // 用检测结果替换所有片段
        set({
          segments,
          detectionProcessing: false,
          detectionProgress: 1,
          detectionMessage: '',
          cancellingDetectionProjectId: null,
        });
      } else {
        // 非当前项目，重新加载并保存
        const project = await api.loadProject(projectId);
        const updatedProject = { ...project, segments, updated_at: new Date().toISOString() };
        await api.saveProject(updatedProject);

        const states = new Map(get().projectProcessingStates);
        const state = states.get(projectId);
        if (state) {
          state.detectionProcessing = false;
          state.detectionProgress = 1;
          state.detectionMessage = '';
          states.set(projectId, state);
          set({ projectProcessingStates: states, cancellingDetectionProjectId: null });
        }
      }
    } catch (error) {
      const isCancellingThis = get().cancellingDetectionProjectId === projectId;
      const wasCancelled = isCancellingThis || (error instanceof Error && error.message.includes('取消')) || (typeof error === 'string' && error.includes('取消'));
      if (get().currentProject?.id === projectId) {
        set({
          detectionProcessing: false,
          detectionProgress: 0,
          detectionMessage: wasCancelled ? 'common.cancelled' : '',
          cancellingDetectionProjectId: null,
        });
      } else {
        const states = new Map(get().projectProcessingStates);
        const state = states.get(projectId);
        if (state) {
          state.detectionProcessing = false;
          state.detectionProgress = 0;
          state.detectionMessage = '';
          states.set(projectId, state);
          set({ projectProcessingStates: states, cancellingDetectionProjectId: null });
        } else {
          set({ cancellingDetectionProjectId: null });
        }
      }
      if (wasCancelled && projectId) {
        const hasSegments = get().segments.length > 0;
        useProjectStore.getState().restoreProjectStatus(projectId, hasSegments);
      }
      throw error;
    }
  },

  cancelDetection: async (projectId: string) => {
    set({ cancellingDetectionProjectId: projectId });
    try {
      await api.cancelDetection(projectId);
    } catch (error) {
      set({ cancellingDetectionProjectId: null });
      throw error;
    }
  },

  clearProjectState: (projectId: string) => {
    const states = new Map(get().projectProcessingStates);
    if (states.has(projectId)) {
      states.delete(projectId);
      set({ projectProcessingStates: states });
    }
  },

  // 自定义剪辑模式操作
  enterCustomClipMode: () => {
    set({
      customClipMode: true,
      customClipStart: null,
      customClipEnd: null,
      customClipSegments: [],
      customClipEditingId: null,
      selectedSegment: null, // 退出片段选择
    });
  },

  exitCustomClipMode: () => {
    set({
      customClipMode: false,
      customClipStart: null,
      customClipEnd: null,
      customClipSegments: [],
      customClipEditingId: null,
    });
  },

  setCustomClipRange: (start: number | null, end: number | null) => {
    set({
      customClipStart: start,
      customClipEnd: end,
    });
  },

  addCustomClipSegment: () => {
    const { customClipStart, customClipEnd, customClipSegments } = get();
    if (customClipStart === null || customClipEnd === null) return;
    const start = Math.min(customClipStart, customClipEnd);
    const end = Math.max(customClipStart, customClipEnd);
    if (end - start < 0.1) return;
    const newSegment: CustomClipSegment = {
      id: crypto.randomUUID(),
      start_time: start,
      end_time: end,
    };
    const updated = [...customClipSegments, newSegment].sort((a, b) => a.start_time - b.start_time);
    set({
      customClipSegments: updated,
      customClipStart: null,
      customClipEnd: null,
      customClipEditingId: null,
    });
  },

  updateCustomClipSegment: (id: string) => {
    const { customClipStart, customClipEnd, customClipSegments } = get();
    if (customClipStart === null || customClipEnd === null) return;
    const start = Math.min(customClipStart, customClipEnd);
    const end = Math.max(customClipStart, customClipEnd);
    if (end - start < 0.1) return;
    const updated = customClipSegments
      .map((seg) => seg.id === id ? { ...seg, start_time: start, end_time: end } : seg)
      .sort((a, b) => a.start_time - b.start_time);
    set({
      customClipSegments: updated,
      customClipStart: null,
      customClipEnd: null,
      customClipEditingId: null,
    });
  },

  removeCustomClipSegment: (id: string) => {
    const { customClipSegments, customClipEditingId } = get();
    const updated = customClipSegments.filter((seg) => seg.id !== id);
    const resetEditing = customClipEditingId === id;
    set({
      customClipSegments: updated,
      ...(resetEditing ? { customClipEditingId: null, customClipStart: null, customClipEnd: null } : {}),
    });
  },

  editCustomClipSegment: (id: string) => {
    const seg = get().customClipSegments.find((s) => s.id === id);
    if (!seg) return;
    set({
      customClipEditingId: id,
      customClipStart: seg.start_time,
      customClipEnd: seg.end_time,
    });
  },

  clearCustomClipEditing: () => {
    set({
      customClipEditingId: null,
      customClipStart: null,
      customClipEnd: null,
    });
  },

  // 自定义音乐库选择操作
  setUseCustomMusicLibrary: (use: boolean) => {
    set({ useCustomMusicLibrary: use });
  },

  setSelectedMusicIds: (ids: string[]) => {
    set({ selectedMusicIds: ids });
  },

  toggleMusicSelection: (id: string) => {
    const currentIds = get().selectedMusicIds;
    if (currentIds.includes(id)) {
      set({ selectedMusicIds: currentIds.filter((i) => i !== id) });
    } else {
      set({ selectedMusicIds: [...currentIds, id] });
    }
  },

  clearMusicSelection: () => {
    set({ selectedMusicIds: [], useCustomMusicLibrary: false });
  },

  reset: () => {
    set({
      currentProject: null,
      segments: [],
      selectedSegment: null,
      playbackPosition: 0,
      isPlaying: false,
      duration: 0,
      processing: false,
      cancellingProjectId: null,
      cancellingDetectionProjectId: null,
      processingMessage: '',
      processingProgress: 0,
      audioPath: null,
      vocalsPath: null,
      accompanimentPath: null,
      projectProcessingStates: new Map(),
      // 重置自定义剪辑状态
      customClipMode: false,
      customClipStart: null,
      customClipEnd: null,
      customClipSegments: [],
      customClipEditingId: null,
      // 重置自定义音乐库选择状态
      useCustomMusicLibrary: false,
      selectedMusicIds: [],
      // 重置人物检测状态
      detectionProcessing: false,
      detectionProgress: 0,
      detectionMessage: '',
    });
  },
}});
