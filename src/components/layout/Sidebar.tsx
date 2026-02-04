// 侧边栏组件

import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  FolderOpen,
  Music,
  Film,
  Settings,
  Cpu,
  HardDrive,
  Sun,
  Moon,
} from 'lucide-react';
import { cn } from '@/utils';
import { useSystemStore } from '@/stores/systemStore';
import { useThemeStore } from '@/stores/themeStore';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon, label }) => {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
          'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--nav-hover))]',
          isActive && 'bg-[hsl(var(--nav-active-bg))] text-[hsl(var(--nav-active-text))] hover:bg-[hsl(var(--nav-active-bg))]'
        )
      }
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </NavLink>
  );
};

export const Sidebar: React.FC = () => {
  const { accelerationOptions, systemInfo } = useSystemStore();
  const { theme, toggleTheme } = useThemeStore();

  return (
    <aside className="w-56 h-full bg-[hsl(var(--sidebar-bg))] border-r border-[hsl(var(--sidebar-border))] flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-[hsl(var(--sidebar-border))]">
        <div className="flex items-center gap-2">
          <img src="/app-icon.png" alt="MusicCut" className="w-8 h-8 rounded-lg" />
          <div>
            <h1 className="text-lg font-bold text-[hsl(var(--text-primary))]">MusicCut</h1>
            <p className="text-xs text-[hsl(var(--text-muted))]">音频指纹剪辑</p>
          </div>
        </div>
      </div>

      {/* 导航 */}
      <nav className="flex-1 p-3 space-y-1">
        <NavItem to="/" icon={<FolderOpen className="w-5 h-5" />} label="项目" />
        <NavItem
          to="/library"
          icon={<Music className="w-5 h-5" />}
          label="音乐库"
        />
        <NavItem
          to="/editor"
          icon={<Film className="w-5 h-5" />}
          label="编辑器"
        />
        <NavItem
          to="/settings"
          icon={<Settings className="w-5 h-5" />}
          label="设置"
        />
      </nav>

      {/* 主题切换 */}
      <div className="px-3 pb-2">
        <button
          onClick={toggleTheme}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
            'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--nav-hover))]'
          )}
        >
          {theme === 'dark' ? (
            <Moon className="w-5 h-5" />
          ) : (
            <Sun className="w-5 h-5" />
          )}
          <span className="text-sm font-medium">
            {theme === 'dark' ? '深色模式' : '明亮模式'}
          </span>
        </button>
      </div>

      {/* 系统状态 */}
      <div className="p-3 border-t border-[hsl(var(--sidebar-border))]">
        <div className="p-3 bg-[hsl(var(--card-bg))] rounded-lg space-y-2">
          <div className="flex items-start gap-2 text-xs">
            <Cpu className="w-4 h-4 text-[hsl(var(--text-muted))]" />
            <span className="text-[hsl(var(--text-muted))]">CPU:</span>
            <span
              className="min-w-0 flex-1 break-words text-[hsl(var(--text-secondary))] leading-snug"
              title={
                systemInfo
                  ? `${systemInfo.cpu_cores} 核心 / ${systemInfo.cpu_threads} 线程`
                  : accelerationOptions?.cpu_threads
                    ? `${accelerationOptions.cpu_threads} 线程`
                    : '-'
              }
            >
              {systemInfo
                ? `${systemInfo.cpu_cores} 核心 / ${systemInfo.cpu_threads} 线程`
                : accelerationOptions?.cpu_threads
                  ? `${accelerationOptions.cpu_threads} 线程`
                  : '-'}
            </span>
          </div>
          <div className="flex items-start gap-2 text-xs">
            <HardDrive className="w-4 h-4 text-[hsl(var(--text-muted))]" />
            <span className="text-[hsl(var(--text-muted))]">GPU:</span>
            <span
              className={cn(
                'min-w-0 flex-1 break-words leading-snug',
                accelerationOptions?.gpu_available
                  ? 'text-green-500'
                  : 'text-[hsl(var(--text-muted))]'
              )}
              title={
                accelerationOptions?.gpu_available
                  ? accelerationOptions.gpu_name
                  : '不可用'
              }
            >
              {accelerationOptions?.gpu_available
                ? accelerationOptions.gpu_name
                : '不可用'}
            </span>
          </div>
          {accelerationOptions?.onnx_gpu_available && (
            <div className="flex items-center gap-2 text-xs">
              <span className="px-1.5 py-0.5 bg-green-600/20 text-green-500 rounded text-xs">
                GPU
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
