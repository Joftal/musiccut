// 系统状态管理

import { create } from 'zustand';
import type {
  SystemInfo,
  DependencyCheck,
  AccelerationOptions,
  AppConfig,
} from '@/types';
import * as api from '@/services/api';
import { getErrorMessage } from '@/utils';

interface SystemState {
  // 状态
  systemInfo: SystemInfo | null;
  dependencies: DependencyCheck[];
  accelerationOptions: AccelerationOptions | null;
  config: AppConfig | null;
  loading: boolean;
  error: string | null;

  // 操作
  checkDependencies: () => Promise<void>;
  loadConfig: () => Promise<void>;
  updateConfig: (config: AppConfig) => Promise<void>;
  getAccelerationOptions: () => Promise<void>;
}

export const useSystemStore = create<SystemState>((set, _get) => ({
  systemInfo: null,
  dependencies: [],
  accelerationOptions: null,
  config: null,
  loading: false,
  error: null,

  checkDependencies: async () => {
    set({ loading: true, error: null });
    try {
      const [systemInfo, dependencies, accelerationOptions] = await Promise.all([
        api.getSystemInfo(),
        api.checkDependencies(),
        api.getAccelerationOptions(),
      ]);
      set({
        systemInfo,
        dependencies,
        accelerationOptions,
        loading: false,
      });
    } catch (error) {
      set({
        error: getErrorMessage(error, '检查依赖失败'),
        loading: false,
      });
    }
  },

  loadConfig: async () => {
    try {
      const config = await api.getConfig();
      set({ config });
    } catch (error) {
      set({
        error: getErrorMessage(error, '加载配置失败'),
      });
    }
  },

  updateConfig: async (config: AppConfig) => {
    try {
      await api.updateConfig(config);
      set({ config });
    } catch (error) {
      set({
        error: getErrorMessage(error, '更新配置失败'),
      });
      throw error;
    }
  },

  getAccelerationOptions: async () => {
    try {
      const accelerationOptions = await api.getAccelerationOptions();
      set({ accelerationOptions });
    } catch (error) {
      set({
        error: getErrorMessage(error, '获取加速选项失败'),
      });
    }
  },
}));
