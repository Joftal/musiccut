// 音乐库状态管理

import { create } from 'zustand';
import type { MusicInfo, ImportProgress } from '@/types';
import * as api from '@/services/api';
import { getErrorMessage } from '@/utils';

interface MusicState {
  // 状态
  musicList: MusicInfo[];
  selectedMusic: MusicInfo | null;
  loading: boolean;
  importing: boolean;
  importProgress: ImportProgress | null;
  searchQuery: string;
  error: string | null;

  // 操作
  loadMusicLibrary: () => Promise<void>;
  importFolder: (path: string) => Promise<number>;
  importFiles: (paths: string[]) => Promise<void>;
  deleteMusic: (id: string) => Promise<void>;
  searchMusic: (query: string) => Promise<void>;
  setSelectedMusic: (music: MusicInfo | null) => void;
  setImportProgress: (progress: ImportProgress | null) => void;
  clearError: () => void;
}

export const useMusicStore = create<MusicState>((set, get) => ({
  musicList: [],
  selectedMusic: null,
  loading: false,
  importing: false,
  importProgress: null,
  searchQuery: '',
  error: null,

  loadMusicLibrary: async () => {
    set({ loading: true, error: null });
    try {
      const musicList = await api.getMusicLibrary();
      set({ musicList, loading: false });
    } catch (error) {
      set({
        error: getErrorMessage(error, 'Failed to load music library'),
        loading: false,
      });
    }
  },

  importFolder: async (path: string) => {
    set({ importing: true, error: null, importProgress: null });
    try {
      const imported = await api.importMusicFolder(path);
      // 重新加载列表以保持排序一致
      const musicList = await api.getMusicLibrary();
      set({
        musicList,
        importing: false,
        importProgress: null,
      });
      return imported.length;
    } catch (error) {
      set({
        error: getErrorMessage(error, 'Import failed'),
        importing: false,
        importProgress: null,
      });
      throw error;
    }
  },

  importFiles: async (paths: string[]) => {
    set({ importing: true, error: null, importProgress: null });
    try {
      await api.importMusicFiles(paths);
      // 重新加载列表以保持排序一致
      const musicList = await api.getMusicLibrary();
      set({
        musicList,
        importing: false,
        importProgress: null,
      });
    } catch (error) {
      set({
        error: getErrorMessage(error, 'Import failed'),
        importing: false,
        importProgress: null,
      });
    }
  },

  deleteMusic: async (id: string) => {
    try {
      await api.deleteMusic(id);
      const musicList = get().musicList.filter((m) => m.id !== id);
      const selectedMusic = get().selectedMusic;
      set({
        musicList,
        selectedMusic: selectedMusic?.id === id ? null : selectedMusic,
      });
    } catch (error) {
      set({
        error: getErrorMessage(error, 'Delete failed'),
      });
    }
  },

  searchMusic: async (query: string) => {
    set({ searchQuery: query, loading: true });
    try {
      const musicList = await api.searchMusic(query);
      set({ musicList, loading: false });
    } catch (error) {
      set({
        error: getErrorMessage(error, 'Search failed'),
        loading: false,
      });
    }
  },

  setSelectedMusic: (music: MusicInfo | null) => {
    set({ selectedMusic: music });
  },

  setImportProgress: (progress: ImportProgress | null) => {
    set({ importProgress: progress });
  },

  clearError: () => {
    set({ error: null });
  },
}));
