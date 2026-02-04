// 语言状态管理

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '@/i18n';

export type Language = 'zh' | 'en';

interface LanguageState {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set, get) => ({
      language: (i18n.language?.startsWith('zh') ? 'zh' : 'en') as Language,

      setLanguage: (language: Language) => {
        set({ language });
        i18n.changeLanguage(language);
      },

      toggleLanguage: () => {
        const newLanguage = get().language === 'zh' ? 'en' : 'zh';
        set({ language: newLanguage });
        i18n.changeLanguage(newLanguage);
      },
    }),
    {
      name: 'musiccut-language',
      onRehydrateStorage: () => (state) => {
        // 恢复存储后应用语言
        if (state) {
          i18n.changeLanguage(state.language);
        }
      },
    }
  )
);
