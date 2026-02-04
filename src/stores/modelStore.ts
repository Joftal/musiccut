// 模型状态管理

import { create } from 'zustand';
import type { ModelInfo, ModelStatus } from '@/types';
import * as api from '@/services/api';
import { getErrorMessage } from '@/utils';

interface ModelState {
  // 状态
  models: ModelInfo[];
  modelStatuses: ModelStatus[];
  loading: boolean;
  error: string | null;

  // 下载状态
  downloadingModels: Set<string>;
  downloadProgress: Map<string, number>;

  // 操作
  loadModels: () => Promise<void>;
  loadModelStatuses: () => Promise<void>;
  loadAll: () => Promise<void>;
  downloadModel: (modelId: string) => Promise<void>;
  setDownloadProgress: (modelId: string, progress: number) => void;
  setDownloadComplete: (modelId: string) => void;
  setDownloadError: (modelId: string) => void;

  // 查询
  getModelById: (modelId: string) => ModelInfo | undefined;
  isModelDownloaded: (modelId: string) => boolean;
  isModelDownloading: (modelId: string) => boolean;
  getDownloadedModels: () => ModelInfo[];
  hasDownloadedModels: () => boolean;
  getFirstDownloadedModel: () => ModelInfo | undefined;
}

export const useModelStore = create<ModelState>((set, get) => ({
  models: [],
  modelStatuses: [],
  loading: false,
  error: null,
  downloadingModels: new Set(),
  downloadProgress: new Map(),

  loadModels: async () => {
    try {
      const models = await api.getAvailableModels();
      set({ models });
    } catch (error) {
      set({
        error: getErrorMessage(error, '加载模型列表失败'),
      });
    }
  },

  loadModelStatuses: async () => {
    try {
      const modelStatuses = await api.getModelsStatus();
      set({ modelStatuses });
    } catch (error) {
      set({
        error: getErrorMessage(error, '加载模型状态失败'),
      });
    }
  },

  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const [models, modelStatuses] = await Promise.all([
        api.getAvailableModels(),
        api.getModelsStatus(),
      ]);
      set({ models, modelStatuses, loading: false });
    } catch (error) {
      set({
        error: getErrorMessage(error, '加载模型信息失败'),
        loading: false,
      });
    }
  },

  downloadModel: async (modelId: string) => {
    const { downloadingModels, downloadProgress } = get();

    // 已在下载中
    if (downloadingModels.has(modelId)) {
      return;
    }

    // 添加到下载中
    const newDownloading = new Set(downloadingModels);
    newDownloading.add(modelId);
    const newProgress = new Map(downloadProgress);
    newProgress.set(modelId, 0);
    set({ downloadingModels: newDownloading, downloadProgress: newProgress });

    try {
      await api.downloadModel(modelId);
      // 下载完成后刷新状态
      await get().loadModelStatuses();
    } catch (error) {
      // 清理下载状态
      get().setDownloadError(modelId);
      set({
        error: getErrorMessage(error, '下载模型失败'),
      });
    }
  },

  setDownloadProgress: (modelId: string, progress: number) => {
    const { downloadProgress } = get();
    const newProgress = new Map(downloadProgress);
    newProgress.set(modelId, progress);
    set({ downloadProgress: newProgress });
  },

  setDownloadComplete: (modelId: string) => {
    const { downloadingModels, downloadProgress } = get();
    const newDownloading = new Set(downloadingModels);
    newDownloading.delete(modelId);
    const newProgress = new Map(downloadProgress);
    newProgress.delete(modelId);
    set({ downloadingModels: newDownloading, downloadProgress: newProgress });
    // 刷新模型状态
    get().loadModelStatuses();
  },

  setDownloadError: (modelId: string) => {
    const { downloadingModels, downloadProgress } = get();
    const newDownloading = new Set(downloadingModels);
    newDownloading.delete(modelId);
    const newProgress = new Map(downloadProgress);
    newProgress.delete(modelId);
    set({ downloadingModels: newDownloading, downloadProgress: newProgress });
  },

  getModelById: (modelId: string) => {
    return get().models.find((m) => m.id === modelId);
  },

  isModelDownloaded: (modelId: string) => {
    const status = get().modelStatuses.find((s) => s.model_id === modelId);
    return status?.downloaded ?? false;
  },

  isModelDownloading: (modelId: string) => {
    return get().downloadingModels.has(modelId);
  },

  getDownloadedModels: () => {
    const { models, modelStatuses } = get();
    const downloadedIds = new Set(
      modelStatuses.filter((s) => s.downloaded).map((s) => s.model_id)
    );
    return models.filter((m) => downloadedIds.has(m.id));
  },

  hasDownloadedModels: () => {
    return get().modelStatuses.some((s) => s.downloaded);
  },

  getFirstDownloadedModel: () => {
    const { models, modelStatuses } = get();
    const downloadedIds = new Set(
      modelStatuses.filter((s) => s.downloaded).map((s) => s.model_id)
    );
    return models.find((m) => downloadedIds.has(m.id));
  },
}));
