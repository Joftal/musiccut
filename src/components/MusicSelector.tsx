// 音乐选择器组件 - 用于自定义音乐库匹配

import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Music, Check, AlertTriangle } from 'lucide-react';
import { cn } from '@/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogBody,
  DialogFooter,
} from '@/components/ui/Dialog';
import { useMusicStore } from '@/stores/musicStore';
import { useEditorStore } from '@/stores/editorStore';
import type { MusicInfo } from '@/types';

interface MusicSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const MusicSelector: React.FC<MusicSelectorProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const { musicList, loading, loadMusicLibrary } = useMusicStore();
  const {
    selectedMusicIds,
    setSelectedMusicIds,
    setUseCustomMusicLibrary,
  } = useEditorStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>([]);

  // 打开对话框时加载音乐列表并同步选中状态
  useEffect(() => {
    if (open) {
      loadMusicLibrary();
      setLocalSelectedIds(selectedMusicIds);
    }
  }, [open, loadMusicLibrary, selectedMusicIds]);

  // 过滤掉已被删除的音乐 ID（边界情况：用户选择后在音乐库页面删除了音乐）
  const validLocalSelectedIds = useMemo(() => {
    const musicIdSet = new Set(musicList.map((m) => m.id));
    return localSelectedIds.filter((id) => musicIdSet.has(id));
  }, [localSelectedIds, musicList]);

  // 计算已选但已被删除的音乐数量
  const deletedCount = localSelectedIds.length - validLocalSelectedIds.length;

  // 过滤音乐列表
  const filteredMusicList = useMemo(() => {
    if (!searchQuery.trim()) {
      return musicList;
    }
    const query = searchQuery.toLowerCase();
    return musicList.filter(
      (music) =>
        music.title.toLowerCase().includes(query) ||
        (music.album && music.album.toLowerCase().includes(query))
    );
  }, [musicList, searchQuery]);

  // 切换单个音乐选中状态
  const toggleMusic = (id: string) => {
    setLocalSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // 全选
  const selectAll = () => {
    setLocalSelectedIds(filteredMusicList.map((m) => m.id));
  };

  // 清除选择
  const clearSelection = () => {
    setLocalSelectedIds([]);
  };

  // 确认选择（只保存仍然存在的音乐 ID）
  const handleConfirm = () => {
    console.log(`[MusicSelector] 确认选择: ${validLocalSelectedIds.length} 首音乐`, validLocalSelectedIds);
    if (deletedCount > 0) {
      console.log(`[MusicSelector] 已过滤 ${deletedCount} 首已删除的音乐`);
    }
    setSelectedMusicIds(validLocalSelectedIds);
    setUseCustomMusicLibrary(validLocalSelectedIds.length > 0);
    onOpenChange(false);
  };

  // 取消
  const handleCancel = () => {
    onOpenChange(false);
  };

  // 格式化时长
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{t('musicSelector.title')}</DialogTitle>
          <DialogClose />
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {/* 搜索框 */}
          <Input
            placeholder={t('musicSelector.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            icon={<Search className="w-4 h-4" />}
          />

          {/* 操作按钮 */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-[hsl(var(--text-muted))]">
              {t('musicSelector.selected', { count: validLocalSelectedIds.length })} / {musicList.length}
              {deletedCount > 0 && (
                <span className="text-yellow-500 ml-2">
                  ({t('musicSelector.deletedCount', { count: deletedCount })})
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll}>
                {t('musicSelector.selectAll')}
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                {t('musicSelector.deselectAll')}
              </Button>
            </div>
          </div>

          {/* 音乐列表 */}
          <div className="flex-1 overflow-y-auto max-h-[400px] border border-[hsl(var(--border))] rounded-lg">
            {loading ? (
              <div className="flex items-center justify-center h-32 text-[hsl(var(--text-muted))]">
                {t('common.loading')}
              </div>
            ) : filteredMusicList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-[hsl(var(--text-muted))]">
                <Music className="w-8 h-8 mb-2 opacity-50" />
                {t('musicSelector.emptyLibrary')}
              </div>
            ) : (
              <div className="divide-y divide-[hsl(var(--border))]">
                {filteredMusicList.map((music) => (
                  <MusicItem
                    key={music.id}
                    music={music}
                    selected={localSelectedIds.includes(music.id)}
                    onToggle={() => toggleMusic(music.id)}
                    formatDuration={formatDuration}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 提示信息 */}
          <p className="text-xs text-[hsl(var(--text-muted))]">
            {t('musicSelector.useFullLibrary')}
          </p>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleConfirm}>
            {t('musicSelector.useSelected')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// 音乐列表项组件
interface MusicItemProps {
  music: MusicInfo;
  selected: boolean;
  onToggle: () => void;
  formatDuration: (seconds: number) => string;
}

const MusicItem: React.FC<MusicItemProps> = ({
  music,
  selected,
  onToggle,
  formatDuration,
}) => {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
        'hover:bg-[hsl(var(--secondary))]',
        selected && 'bg-primary-500/10'
      )}
      onClick={onToggle}
    >
      {/* 选中状态 */}
      <div
        className={cn(
          'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
          selected
            ? 'bg-primary-600 border-primary-600'
            : 'border-[hsl(var(--border))]'
        )}
      >
        {selected && <Check className="w-3 h-3 text-white" />}
      </div>

      {/* 音乐图标 */}
      <div className="w-8 h-8 rounded bg-[hsl(var(--secondary))] flex items-center justify-center flex-shrink-0">
        <Music className="w-4 h-4 text-[hsl(var(--text-muted))]" />
      </div>

      {/* 音乐信息 */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
          {music.title}
        </div>
        {music.album && (
          <div className="text-xs text-[hsl(var(--text-muted))] truncate">
            {music.album}
          </div>
        )}
      </div>

      {/* 时长 */}
      <div className="text-xs text-[hsl(var(--text-muted))] flex-shrink-0">
        {formatDuration(music.duration)}
      </div>

      {/* 文件状态 */}
      {!music.file_exists && (
        <div
          className="text-xs text-yellow-500 flex-shrink-0"
          title="Source file deleted"
        >
          <AlertTriangle className="w-4 h-4" />
        </div>
      )}
    </div>
  );
};

export default MusicSelector;
