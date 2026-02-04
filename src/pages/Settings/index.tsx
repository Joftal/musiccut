// 设置页面

import React, { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  Cpu,
  HardDrive,
  Check,
  RefreshCw,
  Trash2,
  Database,
  FolderOpen,
  RotateCcw,
  Zap,
  Star,
  Download,
  Loader2,
  FileText,
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
import { useSystemStore } from '@/stores/systemStore';
import { useModelStore } from '@/stores/modelStore';
import { useToast } from '@/components/ui/Toast';
import { cn, formatSize, getErrorMessage } from '@/utils';
import * as api from '@/services/api';
import type { AppConfig, StorageInfo } from '@/types';

const Settings: React.FC = () => {
  const {
    systemInfo,
    accelerationOptions,
    config,
    loading,
    loadConfig,
    updateConfig,
  } = useSystemStore();
  const {
    models,
    loading: modelsLoading,
    loadAll: loadModels,
    isModelDownloaded,
    isModelDownloading,
    downloadProgress,
    downloadModel,
    setDownloadProgress,
    setDownloadComplete,
    setDownloadError,
  } = useModelStore();
  const { addToast } = useToast();

  const [localConfig, setLocalConfig] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [resettingDb, setResettingDb] = useState(false);
  const [resettingConfig, setResettingConfig] = useState(false);
  const [showResetDbDialog, setShowResetDbDialog] = useState(false);
  const [showResetConfigDialog, setShowResetConfigDialog] = useState(false);

  const loadStorageInfo = async () => {
    setLoadingStorage(true);
    try {
      const info = await api.getStorageInfo();
      setStorageInfo(info);
    } catch (error) {
      console.error('Failed to load storage info:', error);
    } finally {
      setLoadingStorage(false);
    }
  };

  useEffect(() => {
    loadConfig();
    loadStorageInfo();
    loadModels();

    // 监听模型下载进度
    let unlisten: (() => void) | null = null;
    api.onModelDownloadProgress((progress) => {
      if (progress.completed) {
        if (progress.error) {
          setDownloadError(progress.model_id);
          addToast({
            type: 'error',
            title: '下载失败',
            description: progress.error,
          });
        } else {
          setDownloadComplete(progress.model_id);
          addToast({
            type: 'success',
            title: '下载完成',
            description: progress.message,
          });
        }
      } else {
        setDownloadProgress(progress.model_id, progress.progress * 100);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (config) {
      // 修正浮点数精度问题（保留1位小数）
      const fixedConfig = {
        ...config,
        matching: {
          ...config.matching,
          min_confidence: Math.round(config.matching.min_confidence * 10) / 10,
        },
      };
      setLocalConfig(fixedConfig);
    }
  }, [config]);

  const handleSave = async () => {
    if (!localConfig) return;

    // 保存前校验并修正 min_confidence 范围
    let minConf = localConfig.matching.min_confidence;
    if (isNaN(minConf)) minConf = 0.6;
    minConf = Math.max(0, Math.min(1, Math.round(minConf * 10) / 10));

    const validatedConfig = {
      ...localConfig,
      matching: {
        ...localConfig.matching,
        min_confidence: minConf,
      },
    };

    setSaving(true);
    try {
      await updateConfig(validatedConfig);
      setLocalConfig(validatedConfig);
      addToast({
        type: 'success',
        title: '设置已保存',
      });
    } catch (error) {
      addToast({
        type: 'error',
        title: '保存失败',
        description: getErrorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const updateLocalConfig = (path: string, value: unknown) => {
    if (!localConfig) return;

    const keys = path.split('.');
    const newConfig = { ...localConfig };
    let current: Record<string, unknown> = newConfig;

    for (let i = 0; i < keys.length - 1; i++) {
      current[keys[i]] = { ...(current[keys[i]] as Record<string, unknown>) };
      current = current[keys[i]] as Record<string, unknown>;
    }

    current[keys[keys.length - 1]] = value;
    setLocalConfig(newConfig as AppConfig);
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      const clearedSize = await api.clearCache();
      addToast({
        type: 'success',
        title: '缓存已清理',
        description: `已释放 ${formatSize(clearedSize)}`,
      });
      loadStorageInfo();
    } catch (error) {
      addToast({
        type: 'error',
        title: '清理缓存失败',
        description: getErrorMessage(error),
      });
    } finally {
      setClearingCache(false);
    }
  };

  const handleResetDatabase = async () => {
    setResettingDb(true);
    try {
      await api.resetDatabase();
      addToast({
        type: 'success',
        title: '数据库已重置',
        description: '所有项目和音乐库数据已清空',
      });
      setShowResetDbDialog(false);
      loadStorageInfo();
    } catch (error) {
      addToast({
        type: 'error',
        title: '重置数据库失败',
        description: getErrorMessage(error),
      });
    } finally {
      setResettingDb(false);
    }
  };

  const handleResetConfig = async () => {
    setResettingConfig(true);
    try {
      await api.resetConfig();
      await loadConfig();
      addToast({
        type: 'success',
        title: '配置已重置',
        description: '所有设置已恢复为默认值',
      });
      setShowResetConfigDialog(false);
    } catch (error) {
      addToast({
        type: 'error',
        title: '重置配置失败',
        description: getErrorMessage(error),
      });
    } finally {
      setResettingConfig(false);
    }
  };

  // 在配置加载完成前显示 loading 状态，避免页面闪烁
  if (loading || !localConfig) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        {/* 头部 */}
        <header>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
            <SettingsIcon className="w-6 h-6" />
            设置
          </h1>
          <p className="text-[hsl(var(--text-secondary))] mt-1">配置应用程序和处理选项</p>
        </header>

        {/* 系统信息 */}
        <section className="bg-[hsl(var(--card-bg))] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4">系统信息</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-[hsl(var(--secondary))] rounded-lg">
              <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] mb-2">
                <Cpu className="w-4 h-4" />
                <span className="text-sm">CPU</span>
              </div>
              <p
                className="text-[hsl(var(--foreground))] font-medium break-words leading-snug"
                title={systemInfo?.cpu_model}
              >
                {systemInfo?.cpu_model || '-'}
              </p>
              <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                {systemInfo
                  ? `${systemInfo.cpu_cores} 核心 / ${systemInfo.cpu_threads} 线程`
                  : '-'}
              </p>
            </div>

            <div className="p-4 bg-[hsl(var(--secondary))] rounded-lg">
              <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] mb-2">
                <HardDrive className="w-4 h-4" />
                <span className="text-sm">GPU</span>
              </div>
              <p className="text-[hsl(var(--foreground))] font-medium">
                {accelerationOptions?.gpu_available
                  ? accelerationOptions.gpu_name
                  : '不可用'}
              </p>
              {accelerationOptions?.gpu_available && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {accelerationOptions?.onnx_gpu_available && (
                    <span className="inline-block px-2 py-0.5 bg-green-600/20 text-green-500 text-xs rounded">
                      ONNX CUDA
                    </span>
                  )}
                  {!accelerationOptions?.onnx_gpu_available && (
                    <span className="inline-block px-2 py-0.5 bg-yellow-600/20 text-yellow-500 text-xs rounded">
                      仅CPU
                    </span>
                  )}
                </div>
              )}
              {accelerationOptions?.gpu_available && (
                <p className="text-xs text-[hsl(var(--text-muted))] mt-2">
                  {accelerationOptions?.onnx_gpu_available
                    ? 'ONNX 模型可使用 GPU 加速'
                    : '未检测到 GPU 加速支持，将使用 CPU 处理'}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* 匹配设置 */}
        {localConfig && (
          <section className="bg-[hsl(var(--card-bg))] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4">匹配设置</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                  最小置信度
                </label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={localConfig.matching.min_confidence}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      updateLocalConfig('matching.min_confidence', val);
                    }
                  }}
                  onBlur={(e) => {
                    let val = parseFloat(e.target.value);
                    if (isNaN(val)) val = 0.6;
                    val = Math.max(0, Math.min(1, Math.round(val * 10) / 10));
                    updateLocalConfig('matching.min_confidence', val);
                  }}
                />
                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">匹配相似度阈值，低于此值不识别为匹配 (0.0-1.0)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                  最小片段时长 (秒)
                </label>
                <Input
                  type="number"
                  min={1}
                  value={localConfig.matching.min_segment_duration}
                  onChange={(e) =>
                    updateLocalConfig(
                      'matching.min_segment_duration',
                      parseFloat(e.target.value) || 5
                    )
                  }
                />
                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">匹配片段的最短时长，短于此值的片段将被忽略</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                  匹配窗口时长 (秒)
                </label>
                <Input
                  type="number"
                  min={5}
                  value={localConfig.matching.window_size}
                  onChange={(e) =>
                    updateLocalConfig(
                      'matching.window_size',
                      parseFloat(e.target.value) || 15
                    )
                  }
                />
                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">每次分析的音频长度，视频时长需大于此值才能分析</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                  滑动步长 (秒)
                </label>
                <Input
                  type="number"
                  min={1}
                  value={localConfig.matching.hop_size}
                  onChange={(e) =>
                    updateLocalConfig(
                      'matching.hop_size',
                      parseFloat(e.target.value) || 5
                    )
                  }
                />
                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">窗口每次移动的距离，值越小精度越高但速度越慢</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                  最大允许间隙 (秒)
                </label>
                <Input
                  type="number"
                  min={1}
                  value={localConfig.matching.max_gap_duration}
                  onChange={(e) =>
                    updateLocalConfig(
                      'matching.max_gap_duration',
                      parseFloat(e.target.value) || 10
                    )
                  }
                />
                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">同一首歌的匹配间隙超过此值将分割为独立片段</p>
              </div>
            </div>
          </section>
        )}

        {/* 人声分离设置 */}
        {localConfig && (
          <section className="bg-[hsl(var(--card-bg))] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4">人声分离设置</h2>

            <div className="space-y-6">
              {/* 模型管理 */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-[hsl(var(--text-secondary))]">
                    分离模型
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadModels}
                    loading={modelsLoading}
                  >
                    <RefreshCw className="w-4 h-4 mr-1" />
                    刷新
                  </Button>
                </div>

                <div className="space-y-2">
                  {models.map((model) => {
                    const downloaded = isModelDownloaded(model.id);
                    const downloading = isModelDownloading(model.id);
                    const progress = downloadProgress.get(model.id) || 0;
                    const isSelected = localConfig.separation.selected_model_id === model.id;

                    // 判断模型GPU支持状态 (仅支持 ONNX 模型)
                    const canUseGpu = accelerationOptions?.onnx_gpu_available;

                    return (
                      <div
                        key={model.id}
                        onClick={() => updateLocalConfig('separation.selected_model_id', model.id)}
                        className={cn(
                          'p-4 rounded-lg border cursor-pointer transition-all',
                          isSelected
                            ? 'border-primary-500 bg-primary-500/10'
                            : 'border-[hsl(var(--border))] bg-[hsl(var(--secondary))] hover:border-[hsl(var(--text-muted))]'
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[hsl(var(--foreground))]">
                                {model.name}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded bg-[hsl(var(--background))] text-[hsl(var(--text-muted))]">
                                {model.architecture.toUpperCase()}
                              </span>
                              {canUseGpu ? (
                                <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-500">
                                  GPU
                                </span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 rounded bg-gray-500/20 text-gray-400">
                                  CPU
                                </span>
                              )}
                              {isSelected && (
                                <span className="text-xs px-2 py-0.5 rounded bg-primary-500/20 text-primary-500">
                                  当前选择
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
                              {model.description}
                            </p>
                            <div className="flex items-center gap-4 mt-2">
                              <div className="flex items-center gap-1" title="处理速度">
                                <Zap className="w-3 h-3 text-yellow-500" />
                                <div className="flex gap-0.5">
                                  {Array.from({ length: 5 }).map((_, i) => (
                                    <div
                                      key={i}
                                      className={cn(
                                        'w-1.5 h-1.5 rounded-full',
                                        i < model.speed_rating ? 'bg-yellow-500' : 'bg-gray-600'
                                      )}
                                    />
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center gap-1" title="分离质量">
                                <Star className="w-3 h-3 text-blue-500" />
                                <div className="flex gap-0.5">
                                  {Array.from({ length: 5 }).map((_, i) => (
                                    <div
                                      key={i}
                                      className={cn(
                                        'w-1.5 h-1.5 rounded-full',
                                        i < model.quality_rating ? 'bg-blue-500' : 'bg-gray-600'
                                      )}
                                    />
                                  ))}
                                </div>
                              </div>
                              <span className="text-xs text-[hsl(var(--text-muted))]">
                                {model.stems} 轨分离
                              </span>
                            </div>
                          </div>
                          <div className="ml-4 flex flex-col items-end gap-2">
                            {downloaded ? (
                              <span className="flex items-center gap-1 text-xs text-green-500">
                                <Check className="w-4 h-4" />
                                已下载
                              </span>
                            ) : downloading ? (
                              <div className="flex flex-col items-end gap-1">
                                <span className="flex items-center gap-1 text-xs text-blue-500">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  下载中
                                </span>
                                <div className="w-24">
                                  <Progress value={progress} />
                                </div>
                                <span className="text-xs text-[hsl(var(--text-muted))]">
                                  {progress.toFixed(0)}%
                                </span>
                              </div>
                            ) : (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadModel(model.id);
                                }}
                              >
                                <Download className="w-4 h-4 mr-1" />
                                下载
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs text-[hsl(var(--text-muted))] mt-3">
                  点击"下载"按钮预先下载模型。速度评分越高处理越快，质量评分越高分离效果越好。
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 日志设置 */}
        {localConfig && (
          <section className="bg-[hsl(var(--card-bg))] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              日志设置
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-3">
                  日志级别
                </label>
                <div className="flex flex-wrap gap-2">
                  {([
                    { value: 'info', label: '标准', desc: '记录关键操作信息' },
                    { value: 'debug', label: '调试', desc: '记录详细调试信息' },
                    { value: 'trace', label: '追踪', desc: '记录所有执行细节' },
                  ] as const).map((option) => {
                    const isSelected = localConfig.log_level === option.value || (!localConfig.log_level && option.value === 'info');
                    return (
                      <button
                        key={option.value}
                        onClick={() => updateLocalConfig('log_level', option.value)}
                        className={cn(
                          'px-4 py-2 rounded-lg text-left',
                          isSelected
                            ? 'bg-primary-500/10 text-[hsl(var(--foreground))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--secondary))]/80'
                        )}
                        style={{
                          border: isSelected ? '2px solid rgb(2, 132, 199)' : '2px solid transparent',
                        }}
                      >
                        <div className="font-medium">{option.label}</div>
                        <div className="text-xs text-[hsl(var(--text-muted))] mt-0.5">{option.desc}</div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-[hsl(var(--text-muted))] mt-3">
                  更改日志级别需要重启应用后生效。日志文件保存在数据目录的 logs 文件夹中。
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 存储管理 */}
        <section className="bg-[hsl(var(--card-bg))] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">存储管理</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadStorageInfo}
              loading={loadingStorage}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              刷新
            </Button>
          </div>

          {storageInfo && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-[hsl(var(--secondary))] rounded-lg">
                  <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] mb-2">
                    <Database className="w-4 h-4" />
                    <span className="text-sm">数据库</span>
                  </div>
                  <p className="text-[hsl(var(--foreground))] font-medium">
                    {formatSize(storageInfo.db_size)}
                  </p>
                  <p className="text-xs text-[hsl(var(--text-muted))] mt-1 truncate" title={storageInfo.db_path}>
                    {storageInfo.db_path}
                  </p>
                </div>

                <div className="p-4 bg-[hsl(var(--secondary))] rounded-lg">
                  <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] mb-2">
                    <Trash2 className="w-4 h-4" />
                    <span className="text-sm">处理缓存</span>
                  </div>
                  <p className="text-[hsl(var(--foreground))] font-medium">
                    {formatSize(storageInfo.temp_size)}
                  </p>
                </div>
              </div>

              <div className="p-4 bg-[hsl(var(--secondary))] rounded-lg">
                <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] mb-2">
                  <FolderOpen className="w-4 h-4" />
                  <span className="text-sm">数据目录</span>
                </div>
                <p className="text-sm text-[hsl(var(--text-secondary))] truncate" title={storageInfo.app_dir}>
                  {storageInfo.app_dir}
                </p>
                <p className="text-[hsl(var(--foreground))] font-medium mt-1">
                  总计: {formatSize(storageInfo.total_size)}
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  onClick={handleClearCache}
                  loading={clearingCache}
                  disabled={storageInfo.temp_size === 0}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  清理处理缓存
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* 数据管理 */}
        <section className="bg-[hsl(var(--card-bg))] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4">数据管理</h2>
          <p className="text-sm text-[hsl(var(--text-muted))] mb-4">
            以下操作不可撤销，请谨慎操作。
          </p>

          <div className="flex gap-3">
            <Button
              variant="danger"
              onClick={() => setShowResetDbDialog(true)}
            >
              <Database className="w-4 h-4 mr-2" />
              重置数据库
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowResetConfigDialog(true)}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              重置配置
            </Button>
          </div>
        </section>

        {/* 保存按钮 */}
        <div className="flex justify-end">
          <Button variant="primary" onClick={handleSave} loading={saving}>
            保存设置
          </Button>
        </div>
      </div>

      {/* 重置数据库确认对话框 */}
      <Dialog open={showResetDbDialog} onOpenChange={setShowResetDbDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置数据库</DialogTitle>
            <DialogClose />
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-red-500 font-medium">警告：此操作不可撤销！</p>
              </div>
              <p className="text-[hsl(var(--text-secondary))]">
                重置数据库将清空以下所有数据：
              </p>
              <ul className="list-disc list-inside text-[hsl(var(--text-muted))] space-y-1">
                <li>所有项目及其片段信息</li>
                <li>音乐库中的所有音乐和指纹数据</li>
              </ul>
              <p className="text-[hsl(var(--text-secondary))]">
                确定要继续吗？
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowResetDbDialog(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={handleResetDatabase}
              loading={resettingDb}
            >
              确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置配置确认对话框 */}
      <Dialog open={showResetConfigDialog} onOpenChange={setShowResetConfigDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置配置</DialogTitle>
            <DialogClose />
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <p className="text-[hsl(var(--text-secondary))]">
                重置配置将把所有设置恢复为默认值，包括：
              </p>
              <ul className="list-disc list-inside text-[hsl(var(--text-muted))] space-y-1">
                <li>匹配参数设置</li>
                <li>人声分离设置</li>
                <li>日志级别设置</li>
                <li>窗口大小和位置</li>
              </ul>
              <p className="text-[hsl(var(--text-secondary))]">
                确定要继续吗？
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowResetConfigDialog(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={handleResetConfig}
              loading={resettingConfig}
            >
              确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Settings;
