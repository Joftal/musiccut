// 主题状态管理

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',

      setTheme: (theme: Theme) => {
        set({ theme });
        applyTheme(theme);
      },

      toggleTheme: () => {
        const newTheme = get().theme === 'dark' ? 'light' : 'dark';
        set({ theme: newTheme });
        applyTheme(newTheme);
      },
    }),
    {
      name: 'musiccut-theme',
      onRehydrateStorage: () => (state) => {
        // 恢复存储后应用主题
        if (state) {
          applyTheme(state.theme);
        }
      },
    }
  )
);

// 应用主题到 DOM
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'light') {
    root.classList.add('light');
    root.classList.remove('dark');
  } else {
    root.classList.remove('light');
    root.classList.add('dark');
  }
}

// 初始化主题 (在应用启动时调用)
export function initTheme() {
  const stored = localStorage.getItem('musiccut-theme');
  if (stored) {
    try {
      const { state } = JSON.parse(stored);
      applyTheme(state.theme || 'light');
    } catch {
      applyTheme('light');
    }
  } else {
    applyTheme('light');
  }
}
