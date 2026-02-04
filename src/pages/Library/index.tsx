// 音乐库页面

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Music,
  FolderOpen,
  Plus,
  Search,
  Trash2,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Progress } from '@/components/ui/Progress';
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
import { useToast } from '@/components/ui/Toast';
import { formatDuration, formatDate, getErrorMessage } from '@/utils';
import * as api from '@/services/api';

const Library: React.FC = () => {
  const { t } = useTranslation();
  const {
    musicList,
    loading,
    importing,
    importProgress,
    loadMusicLibrary,
    importFolder,
    importFiles,
    deleteMusic,
    searchMusic,
    setImportProgress,
  } = useMusicStore();
  const { addToast } = useToast();

  const [searchInput, setSearchInput] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadMusicLibrary();

    // 监听导入进度
    let unlisten: (() => void) | undefined;
    api.onImportProgress((progress) => {
      setImportProgress(progress);
    }).then((fn) => {
      unlisten = fn;
    }).catch((err) => {
      console.error('Failed to setup import progress listener:', err);
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const handleImportFolder = async () => {
    const path = await api.openFolderDialog();
    if (path) {
      // 监听完成事件
      const unlistenComplete = await api.onImportComplete((result) => {
        let message = t('library.toast.importSuccess', { imported: result.imported });
        if (result.skipped > 0) {
          message += `，${t('library.toast.importSkipped', { skipped: result.skipped })}`;
        }
        if (result.errors > 0) {
          message += `，${t('library.toast.importErrors', { errors: result.errors })}`;
        }
        addToast({
          type: result.imported > 0 ? 'success' : (result.skipped > 0 ? 'warning' : 'error'),
          title: message,
        });
        unlistenComplete();
      });

      try {
        const count = await importFolder(path);
        if (count === 0) {
          // 如果没有导入任何文件，检查是否是因为文件夹为空
          // 完成事件会处理跳过的情况
        }
      } catch (error) {
        unlistenComplete();
        addToast({
          type: 'error',
          title: t('library.toast.importFailed'),
          description: getErrorMessage(error),
        });
      }
    }
  };

  const handleImportFiles = async () => {
    const paths = await api.openFilesDialog([
      { name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg'] },
    ]);
    if (paths && paths.length > 0) {
      // 监听完成事件
      const unlistenComplete = await api.onImportComplete((result) => {
        let message = t('library.toast.importSuccess', { imported: result.imported });
        if (result.skipped > 0) {
          message += `，${t('library.toast.importSkipped', { skipped: result.skipped })}`;
        }
        addToast({
          type: result.imported > 0 ? 'success' : 'warning',
          title: message,
        });
        unlistenComplete();
      });

      try {
        await importFiles(paths);
      } catch (error) {
        unlistenComplete();
        addToast({
          type: 'error',
          title: t('library.toast.importFailed'),
          description: getErrorMessage(error),
        });
      }
    }
  };

  const handleSearch = () => {
    searchMusic(searchInput);
  };

  const handleDelete = (id: string) => {
    setDeleteTargetId(id);
    setShowDeleteDialog(true);
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;

    setDeleting(true);
    try {
      await deleteMusic(deleteTargetId);
      addToast({
        type: 'success',
        title: t('library.toast.deleted'),
      });
      setShowDeleteDialog(false);
      setDeleteTargetId(null);
    } catch (error) {
      addToast({
        type: 'error',
        title: t('library.toast.deleteFailed'),
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <header className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))]">
        <div>
          <h1 className="text-xl font-bold text-[hsl(var(--foreground))]">{t('library.title')}</h1>
          <p className="text-sm text-[hsl(var(--text-secondary))]">
            {t('library.subtitle', { count: musicList.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleImportFolder}>
            <FolderOpen className="w-4 h-4 mr-2" />
            {t('library.importFolder')}
          </Button>
          <Button variant="primary" onClick={handleImportFiles}>
            <Plus className="w-4 h-4 mr-2" />
            {t('library.importFiles')}
          </Button>
        </div>
      </header>

      {/* 搜索栏 */}
      <div className="p-4 border-b border-[hsl(var(--border))]">
        <div className="flex gap-2">
          <Input
            placeholder={t('library.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            icon={<Search className="w-4 h-4" />}
            wrapperClassName="flex-1"
          />
          <Button variant="secondary" onClick={handleSearch}>
            {t('common.search')}
          </Button>
        </div>
      </div>

      {/* 导入进度 */}
      {importing && importProgress && (
        <div className="p-4 bg-[hsl(var(--card-bg))] border-b border-[hsl(var(--border))]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[hsl(var(--text-secondary))]">
              {importProgress.message}
            </span>
            <span className="text-sm text-[hsl(var(--text-muted))]">
              {importProgress.current} / {importProgress.total}
            </span>
          </div>
          <Progress
            value={importProgress.current}
            max={importProgress.total}
          />
        </div>
      )}

      {/* 音乐列表 */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full" />
          </div>
        ) : musicList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-[hsl(var(--text-muted))]">
            <Music className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg">{t('library.emptyTitle')}</p>
            <p className="text-sm mt-1">{t('library.emptySubtitle')}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-[hsl(var(--card-bg))] sticky top-0">
              <tr className="text-left text-sm text-[hsl(var(--text-muted))]">
                <th className="px-4 py-3 font-medium">{t('library.table.index')}</th>
                <th className="px-4 py-3 font-medium">{t('library.table.title')}</th>
                <th className="px-4 py-3 font-medium">{t('library.table.duration')}</th>
                <th className="px-4 py-3 font-medium">{t('library.table.addedTime')}</th>
                <th className="px-4 py-3 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody>
              {musicList.map((music, index) => (
                <tr
                  key={music.id}
                  className={`border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--card-hover))] transition-colors ${!music.file_exists ? 'opacity-60' : ''}`}
                >
                  <td className="px-4 py-3 text-[hsl(var(--text-muted))]">{index + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[hsl(var(--secondary))] rounded-lg flex items-center justify-center">
                        <Music className="w-5 h-5 text-[hsl(var(--text-muted))]" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[hsl(var(--foreground))] font-medium truncate max-w-xs">
                          {music.title}
                        </span>
                        {!music.file_exists && (
                          <span className="flex items-center gap-1 text-xs text-yellow-500">
                            <AlertTriangle className="w-3 h-3" />
                            {t('library.sourceDeleted')}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--text-secondary))]">
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {formatDuration(music.duration)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--text-muted))] text-sm">
                    {formatDate(music.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(music.id)}
                      className="p-2 text-[hsl(var(--text-muted))] hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 删除确认对话框 */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('library.dialog.deleteMusicTitle')}</DialogTitle>
            <DialogClose />
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-red-500 font-medium">{t('library.dialog.deleteWarning')}</p>
              </div>
              <p className="text-[hsl(var(--text-secondary))]">
                {t('library.dialog.deleteConfirm')}
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={confirmDelete}
              loading={deleting}
            >
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Library;
