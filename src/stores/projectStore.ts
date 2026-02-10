// 项目状态管理

import { create } from 'zustand';
import type { Project } from '@/types';
import * as api from '@/services/api';
import { useEditorStore } from './editorStore';
import { getErrorMessage } from '@/utils';

// 项目进度阶段
type ProjectStage =
  | 'idle'           // 空闲
  | 'extracting'     // 提取音频
  | 'queued'         // 排队等待分离
  | 'separating'     // 人声分离
  | 'matching'       // 音频匹配
  | 'exporting'      // 视频导出
  | 'analyzed'       // 分析完成（常驻）
  | 'exported';      // 导出完成

// 项目状态
interface ProjectStatus {
  stage: ProjectStage;
  progress: number;  // 0-1
}

interface ProjectState {
  // 状态
  projects: Project[];
  loading: boolean;
  error: string | null;
  // 项目进度状态（全局持久化）
  projectStatus: Record<string, ProjectStatus>;

  // 操作
  loadProjects: () => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  clearError: () => void;
  // 进度状态操作
  removeProjectStatus: (projectId: string) => void;
  restoreProjectStatus: (projectId: string, hasSegments: boolean) => void;
  initProgressListeners: () => () => void;
}

// 缓冲区：存储高频事件，不触发渲染（模块级别，不会因组件卸载而丢失）
const statusBuffer: Record<string, ProjectStatus> = {};
// 完成状态：分析/导出完成后常驻显示
const completedStatus: Record<string, ProjectStage> = {};
// 定时器 ID
let flushTimer: ReturnType<typeof setInterval> | null = null;
// 事件监听器清理函数
let unlisteners: (() => void)[] = [];
// 上次状态的 JSON 字符串（用于浅比较，避免无变化时触发更新）
let lastStatusJson = '';
// 引用计数：跟踪有多少调用者正在使用监听器
let listenerRefCount = 0;

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loading: false,
  error: null,
  projectStatus: {},

  loadProjects: async () => {
    set({ loading: true, error: null });
    try {
      console.log('Loading projects...');
      const projects = await api.getProjects();
      console.log('Projects loaded:', projects);
      // 按项目名称排序
      const sortedProjects = (projects || []).sort((a, b) =>
        a.name.localeCompare(b.name, 'zh-CN')
      );
      set({ projects: sortedProjects, loading: false });
    } catch (error) {
      console.error('Failed to load projects:', error);
      set({
        error: getErrorMessage(error, 'Failed to load projects'),
        loading: false,
        projects: [],
      });
    }
  },

  deleteProject: async (id: string) => {
    try {
      await api.deleteProject(id);
      const projects = get().projects.filter((p) => p.id !== id);
      set({ projects });

      // 如果删除的是当前编辑器中的项目，重置编辑器状态
      const editorStore = useEditorStore.getState();
      if (editorStore.currentProject?.id === id) {
        editorStore.reset();
      }
      // 清除该项目的处理状态缓存
      editorStore.clearProjectState(id);
      // 清除进度状态
      get().removeProjectStatus(id);
    } catch (error) {
      set({
        error: getErrorMessage(error, 'Failed to delete project'),
      });
      throw error;
    }
  },

  clearError: () => {
    set({ error: null });
  },

  removeProjectStatus: (projectId: string) => {
    set((state) => {
      const { [projectId]: _, ...rest } = state.projectStatus;
      return { projectStatus: rest };
    });
    // 同时清除缓冲区和完成状态
    delete statusBuffer[projectId];
    delete completedStatus[projectId];
  },

  restoreProjectStatus: (projectId: string, hasSegments: boolean) => {
    // 清除进行中的状态
    delete statusBuffer[projectId];

    if (hasSegments) {
      // 如果项目已有分析结果，恢复到"已分析"状态
      completedStatus[projectId] = 'analyzed';
      set((state) => ({
        projectStatus: {
          ...state.projectStatus,
          [projectId]: { stage: 'analyzed', progress: 1 },
        },
      }));
    } else {
      // 如果没有分析结果，清除所有状态
      delete completedStatus[projectId];
      set((state) => {
        const { [projectId]: _, ...rest } = state.projectStatus;
        return { projectStatus: rest };
      });
    }
  },

  initProgressListeners: () => {
    // 增加引用计数
    listenerRefCount++;

    // 如果已经初始化过，返回清理函数（会减少引用计数）
    if (flushTimer !== null) {
      return () => {
        listenerRefCount--;
        // 最后一个调用者卸载时才真正清理
        if (listenerRefCount === 0) {
          if (flushTimer !== null) {
            clearInterval(flushTimer);
            flushTimer = null;
          }
          unlisteners.forEach((fn) => fn());
          unlisteners = [];
        }
      };
    }

    // 批量更新状态的函数
    const flushStatusBuffer = () => {
      const merged: Record<string, ProjectStatus> = {};

      // 先添加完成状态
      for (const [id, stage] of Object.entries(completedStatus)) {
        merged[id] = { stage, progress: 1 };
      }

      // 进行中的状态覆盖完成状态
      for (const [id, status] of Object.entries(statusBuffer)) {
        if (status.stage !== 'idle') {
          merged[id] = status;
        }
      }

      // 浅比较：只在状态真正变化时才更新
      const newJson = JSON.stringify(merged);
      if (newJson !== lastStatusJson) {
        lastStatusJson = newJson;
        set({ projectStatus: merged });
      }
    };

    // 定时批量更新（500ms 一次）
    flushTimer = setInterval(flushStatusBuffer, 500);

    // 监听所有进度事件（使用 async/await 确保正确清理）
    const setupListeners = async () => {
      // 提取进度
      const unlisten1 = await api.onExtractProgress((progress) => {
        if (progress.project_id) {
          if (progress.progress >= 1) {
            // 完成时删除，避免内存泄漏
            delete statusBuffer[progress.project_id];
          } else {
            // 取整到1%，减少无意义更新
            statusBuffer[progress.project_id] = {
              stage: 'extracting',
              progress: Math.round(progress.progress * 100) / 100
            };
          }
        }
      });
      unlisteners.push(unlisten1);

      // 分离排队
      const unlistenQueued = await api.onSeparationQueued((data) => {
        if (data.project_id) {
          statusBuffer[data.project_id] = {
            stage: 'queued',
            progress: 0,
          };
        }
      });
      unlisteners.push(unlistenQueued);

      // 分离进度
      const unlisten2 = await api.onSeparationProgress((progress) => {
        if (progress.project_id) {
          if (progress.progress >= 1) {
            delete statusBuffer[progress.project_id];
          } else {
            statusBuffer[progress.project_id] = {
              stage: 'separating',
              progress: Math.round(progress.progress * 100) / 100
            };
          }
        }
      });
      unlisteners.push(unlisten2);

      // 匹配进度
      const unlisten3 = await api.onMatchingProgress((progress) => {
        if (progress.project_id) {
          if (progress.progress >= 1) {
            // 匹配完成，设置常驻状态
            delete statusBuffer[progress.project_id];
            completedStatus[progress.project_id] = 'analyzed';
            flushStatusBuffer();
            // 重新加载项目列表，更新 segments 数据
            get().loadProjects();
          } else {
            statusBuffer[progress.project_id] = {
              stage: 'matching',
              progress: Math.round(progress.progress * 100) / 100
            };
          }
        }
      });
      unlisteners.push(unlisten3);

      // 导出进度
      const unlisten4 = await api.onExportProgress((progress) => {
        if (progress.project_id) {
          if (progress.progress >= 1) {
            // 导出完成，设置常驻状态
            delete statusBuffer[progress.project_id];
            completedStatus[progress.project_id] = 'exported';
            flushStatusBuffer();
          } else {
            statusBuffer[progress.project_id] = {
              stage: 'exporting',
              progress: Math.round(progress.progress * 100) / 100
            };
          }
        }
      });
      unlisteners.push(unlisten4);
    };

    setupListeners().catch((err) => {
      console.error('Failed to setup project listeners:', err);
    });

    // 返回清理函数
    return () => {
      listenerRefCount--;
      // 最后一个调用者卸载时才真正清理
      if (listenerRefCount === 0) {
        if (flushTimer !== null) {
          clearInterval(flushTimer);
          flushTimer = null;
        }
        unlisteners.forEach((fn) => fn());
        unlisteners = [];
      }
    };
  },
}));

// 阶段显示配置（导出供组件使用）
export const STAGE_CONFIG: Record<ProjectStage, { color: string }> = {
  idle: { color: '' },
  extracting: { color: 'text-primary-500' },
  queued: { color: 'text-yellow-500' },
  separating: { color: 'text-primary-500' },
  matching: { color: 'text-primary-500' },
  exporting: { color: 'text-primary-500' },
  analyzed: { color: 'text-green-500' },
  exported: { color: 'text-green-500' },
};

export type { ProjectStage, ProjectStatus };
