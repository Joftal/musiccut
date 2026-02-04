// 编辑器状态管理

import { create } from 'zustand';
import type { Project, Segment, SegmentStatus } from '@/types';
import * as api from '@/services/api';
import { useProjectStore } from './projectStore';

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

  // 自定义音乐库选择状态
  useCustomMusicLibrary: boolean;
  selectedMusicIds: string[];

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
  setProcessingProgressForProject: (projectId: string, progress: number) => void;

  // 文件路径
  setAudioPath: (path: string | null) => void;
  setVocalsPath: (path: string | null) => void;
  setAccompanimentPath: (path: string | null) => void;

  // 处理操作（接受项目上下文参数，确保多项目并行分析时数据隔离）
  extractAudio: (outputPath: string, projectId: string, videoPath: string) => Promise<string>;
  separateVocals: (outputDir: string, projectId: string, audioPath: string, acceleration?: string) => Promise<{ vocalsPath: string; accompanimentPath: string }>;
  matchSegments: (projectId: string, accompanimentPath: string, minConfidence?: number, musicIds?: string[]) => Promise<void>;
  cutVideo: (outputPath: string, keepMatched: boolean) => Promise<void>;
  exportVideo: (outputPath: string) => Promise<void>;
  exportVideoSeparately: (outputDir: string) => Promise<{ exportedCount: number; outputFiles: string[] }>;
  cancelProcessing: () => Promise<void>;

  // 清除指定项目的缓存状态
  clearProjectState: (projectId: string) => void;

  // 自定义剪辑模式操作
  enterCustomClipMode: () => void;
  exitCustomClipMode: () => void;
  setCustomClipRange: (start: number | null, end: number | null) => void;

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
    });
    set({
      processing: true,
      processingMessage: message,
      projectProcessingStates: states,
    });
  };

  // 辅助函数：完成处理任务
  const finishProcessingTask = (projectId: string, wasCancelled = false) => {
    const isCancellingThisProject = get().cancellingProjectId === projectId;
    const segments = get().segments;

    if (get().currentProject?.id === projectId) {
      set({
        processing: false,
        cancellingProjectId: null,
        processingMessage: wasCancelled || isCancellingThisProject ? '已取消' : '',
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

  // 辅助函数：检查是否可以开始新任务
  const canStartProcessing = () => {
    const { processing, cancellingProjectId, currentProject } = get();
    if (cancellingProjectId && cancellingProjectId === currentProject?.id) {
      throw new Error('正在取消上一个任务，请稍候再试');
    }
    if (processing) {
      throw new Error('已有任务正在执行');
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
  // 自定义音乐库选择初始状态
  useCustomMusicLibrary: false,
  selectedMusicIds: [],

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
      };
      const newStates = new Map(get().projectProcessingStates);
      newStates.set(currentId, currentState);
      set({ projectProcessingStates: newStates });
    }

    const project = await api.loadProject(id);

    // 恢复目标项目的完整处理状态
    const savedState = get().projectProcessingStates.get(id);

    set({
      currentProject: project,
      segments: project.segments,
      duration: project.video_info.duration,
      selectedSegment: null,
      playbackPosition: 0,
      isPlaying: false,
      // 恢复处理状态（从缓存恢复）
      processing: savedState?.processing ?? false,
      processingMessage: savedState?.processingMessage ?? '',
      processingProgress: savedState?.processingProgress ?? 0,
      // 恢复中间文件路径
      audioPath: savedState?.audioPath ?? null,
      vocalsPath: savedState?.vocalsPath ?? null,
      accompanimentPath: savedState?.accompanimentPath ?? null,
      // 恢复自定义音乐库选择状态
      useCustomMusicLibrary: savedState?.useCustomMusicLibrary ?? false,
      selectedMusicIds: savedState?.selectedMusicIds ?? [],
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

  setProcessingProgressForProject: (projectId: string, progress: number) => {
    const currentId = get().currentProject?.id;
    if (currentId === projectId) {
      // 当前项目，直接更新显示
      set({ processingProgress: progress });
    } else {
      // 非当前项目，更新缓存
      const states = new Map(get().projectProcessingStates);
      const state = states.get(projectId);
      if (state) {
        state.processingProgress = progress;
        states.set(projectId, state);
        set({ projectProcessingStates: states });
      }
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
    // 检查是否可以开始新任务
    canStartProcessing();

    // 设置当前项目的处理状态（如果是当前项目）
    if (get().currentProject?.id === projectId) {
      set({ processing: true, processingMessage: '提取音频中...' });
    } else {
      // 更新缓存中的处理状态
      const states = new Map(get().projectProcessingStates);
      const state = states.get(projectId) || createDefaultProcessingState();
      state.processing = true;
      state.processingMessage = '提取音频中...';
      states.set(projectId, state);
      set({ projectProcessingStates: states });
    }

    try {
      await api.extractAudio(videoPath, outputPath, projectId);
      // 检查项目是否是当前项目
      if (get().currentProject?.id === projectId) {
        // 当前项目，直接更新显示
        set({ audioPath: outputPath, processing: false });
      } else {
        // 非当前项目，将结果保存到缓存
        const states = new Map(get().projectProcessingStates);
        const state = states.get(projectId) || createDefaultProcessingState();
        state.audioPath = outputPath;
        state.processing = false;
        state.processingMessage = '';
        state.processingProgress = 0;
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
    // 检查是否可以开始新任务
    canStartProcessing();

    // 设置处理状态
    if (get().currentProject?.id === projectId) {
      set({ processing: true, processingMessage: '人声分离中...' });
    } else {
      const states = new Map(get().projectProcessingStates);
      const state = states.get(projectId) || createDefaultProcessingState();
      state.processing = true;
      state.processingMessage = '人声分离中...';
      states.set(projectId, state);
      set({ projectProcessingStates: states });
    }

    try {
      const result = await api.separateVocals(audioPath, outputDir, acceleration, projectId);
      // 检查项目是否是当前项目
      if (get().currentProject?.id === projectId) {
        // 当前项目，直接更新显示
        set({
          vocalsPath: result.vocals_path,
          accompanimentPath: result.accompaniment_path,
          processing: false,
        });
      } else {
        // 非当前项目，将结果保存到缓存
        const states = new Map(get().projectProcessingStates);
        const state = states.get(projectId) || createDefaultProcessingState();
        state.vocalsPath = result.vocals_path;
        state.accompanimentPath = result.accompaniment_path;
        state.processing = false;
        state.processingMessage = '';
        state.processingProgress = 0;
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

    // 检查是否可以开始新任务
    canStartProcessing();

    // 设置处理状态
    if (get().currentProject?.id === projectId) {
      set({ processing: true, processingMessage: '匹配音频片段中...' });
    } else {
      const states = new Map(get().projectProcessingStates);
      const state = states.get(projectId) || createDefaultProcessingState();
      state.processing = true;
      state.processingMessage = '匹配音频片段中...';
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
        set({ segments, processing: false });
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

  cutVideo: async (outputPath: string, keepMatched: boolean) => {
    const { currentProject, segments } = get();
    if (!currentProject) throw new Error('没有打开的项目');

    // 检查是否可以开始新任务
    canStartProcessing();

    const projectId = currentProject.id;

    // 先保存 segments 到数据库，确保后端使用最新数据
    await api.updateSegments(projectId, segments);

    startProcessingTask(projectId, '剪辑视频中...');

    let wasCancelled = false;
    try {
      await api.cutVideo({
        project_id: projectId,
        output_path: outputPath,
        keep_matched: keepMatched,
      });
    } catch (error) {
      wasCancelled = get().cancellingProjectId === projectId || (error instanceof Error && error.message.includes('取消'));
      throw error;
    } finally {
      finishProcessingTask(projectId, wasCancelled);
      cleanupProjectCache(projectId);
    }
  },

  exportVideo: async (outputPath: string) => {
    const { currentProject, segments } = get();
    if (!currentProject) throw new Error('没有打开的项目');

    // 检查是否可以开始新任务
    canStartProcessing();

    const projectId = currentProject.id;

    // 先保存 segments 到数据库，确保后端使用最新数据
    await api.updateSegments(projectId, segments);

    startProcessingTask(projectId, '导出视频中...');

    let wasCancelled = false;
    try {
      await api.exportVideo(projectId, outputPath);
    } catch (error) {
      wasCancelled = get().cancellingProjectId === projectId || (error instanceof Error && error.message.includes('取消'));
      throw error;
    } finally {
      finishProcessingTask(projectId, wasCancelled);
      cleanupProjectCache(projectId);
    }
  },

  exportVideoSeparately: async (outputDir: string) => {
    const { currentProject, segments } = get();
    if (!currentProject) throw new Error('没有打开的项目');

    // 检查是否可以开始新任务
    canStartProcessing();

    const projectId = currentProject.id;

    // 先保存 segments 到数据库，确保后端使用最新数据
    await api.updateSegments(projectId, segments);

    startProcessingTask(projectId, '导出视频片段中...');

    let wasCancelled = false;
    try {
      const result = await api.exportVideoSeparately(projectId, outputDir);
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
      selectedSegment: null, // 退出片段选择
    });
  },

  exitCustomClipMode: () => {
    set({
      customClipMode: false,
      customClipStart: null,
      customClipEnd: null,
    });
  },

  setCustomClipRange: (start: number | null, end: number | null) => {
    set({
      customClipStart: start,
      customClipEnd: end,
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
      // 重置自定义音乐库选择状态
      useCustomMusicLibrary: false,
      selectedMusicIds: [],
    });
  },
}});
