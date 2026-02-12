// 设置页面

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings as SettingsIcon,
  Cpu,
  HardDrive,
  Check,

  Trash2,
  Database,
  FolderOpen,
  RotateCcw,
  Download,
  Loader2,
  FileText,
  ChevronDown,
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
  const { t } = useTranslation();
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
  const [showMatchingSettings, setShowMatchingSettings] = useState(false);
  const [showDetectionSettings, setShowDetectionSettings] = useState(false);

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
            title: t('settings.toast.downloadFailed'),
            description: progress.error,
          });
        } else {
          setDownloadComplete(progress.model_id);
          addToast({
            type: 'success',
            title: t('settings.toast.downloadComplete'),
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
        // 确保 detection 配置存在
        detection: {
          ...config.detection,
          confidence_threshold: Math.round(config.detection.confidence_threshold * 10) / 10,
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
        title: t('settings.toast.saved'),
      });
    } catch (error) {
      addToast({
        type: 'error',
        title: t('settings.toast.saveFailed'),
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
        title: t('settings.toast.cacheCleared'),
        description: t('settings.toast.cacheClearedDesc', { size: formatSize(clearedSize) }),
      });
      loadStorageInfo();
    } catch (error) {
      addToast({
        type: 'error',
        title: t('settings.toast.clearCacheFailed'),
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
        title: t('settings.toast.dbReset'),
        description: t('settings.toast.dbResetDesc'),
      });
      setShowResetDbDialog(false);
      loadStorageInfo();
    } catch (error) {
      addToast({
        type: 'error',
        title: t('settings.toast.dbResetFailed'),
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
        title: t('settings.toast.configReset'),
        description: t('settings.toast.configResetDesc'),
      });
      setShowResetConfigDialog(false);
    } catch (error) {
      addToast({
        type: 'error',
        title: t('settings.toast.configResetFailed'),
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
            {t('settings.title')}
          </h1>
          <p className="text-[hsl(var(--text-secondary))] mt-1">{t('settings.subtitle')}</p>
        </header>

        {/* 系统信息 */}
        <section className="bg-[hsl(var(--card-bg))] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4">{t('settings.systemInfo.title')}</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-[hsl(var(--secondary))] rounded-lg">
              <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] mb-2">
                <Cpu className="w-4 h-4" />
                <span className="text-sm">{t('settings.systemInfo.cpu')}</span>
              </div>
              <p
                className="text-[hsl(var(--foreground))] font-medium break-words leading-snug"
                title={systemInfo?.cpu_model}
              >
                {systemInfo?.cpu_model || '-'}
              </p>
              <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                {systemInfo
                  ? `${systemInfo.cpu_cores} ${t('common.cores')} / ${systemInfo.cpu_threads} ${t('common.threads')}`
                  : '-'}
              </p>
            </div>

            <div className="p-4 bg-[hsl(var(--secondary))] rounded-lg">
              <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] mb-2">
                <HardDrive className="w-4 h-4" />
                <span className="text-sm">{t('settings.systemInfo.gpu')}</span>
              </div>
              <p className="text-[hsl(var(--foreground))] font-medium">
                {accelerationOptions?.gpu_available
                  ? accelerationOptions.gpu_name
                  : t('common.unavailable')}
              </p>
              {accelerationOptions?.gpu_available && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {accelerationOptions?.onnx_gpu_available && (
                    <span className="inline-block px-2 py-0.5 bg-green-600/20 text-green-500 text-xs rounded">
                      {t('settings.systemInfo.onnxCuda')}
                    </span>
                  )}
                  {!accelerationOptions?.onnx_gpu_available && (
                    <span className="inline-block px-2 py-0.5 bg-yellow-600/20 text-yellow-500 text-xs rounded">
                      {t('settings.systemInfo.cpuOnlyTag')}
                    </span>
                  )}
                </div>
              )}
              {accelerationOptions?.gpu_available && (
                <p className="text-xs text-[hsl(var(--text-muted))] mt-2">
                  {accelerationOptions?.onnx_gpu_available
                    ? t('settings.systemInfo.onnxGpuAvailable')
                    : t('settings.systemInfo.onnxGpuUnavailable')}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* 人声分离设置 */}
        {localConfig && (
          <section className="bg-[hsl(var(--card-bg))] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4">{t('settings.separation.title')}</h2>

            <div className="space-y-6">
              {/* 模型管理 */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-[hsl(var(--text-secondary))]">
                    {t('settings.separation.model')}
                  </label>
                </div>

                <div className="space-y-2">
                  {models.filter((m) => m.architecture === 'mdxnet').map((model) => {
                    const downloaded = isModelDownloaded(model.id);
                    const downloading = isModelDownloading(model.id);
                    const progress = downloadProgress.get(model.id) || 0;

                    // 判断模型GPU支持状态 (仅支持 ONNX 模型)
                    const canUseGpu = accelerationOptions?.onnx_gpu_available;

                    return (
                      <div
                        key={model.id}
                        className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] transition-all"
                      >
                        <div
                          className="p-4 cursor-pointer"
                          onClick={() => setShowMatchingSettings(!showMatchingSettings)}
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
                              </div>
                              <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
                                {model.id === 'mdx-inst-hq3' ? t('model.mdxInstHq3.description') : model.description}
                              </p>
                            </div>
                            <div className="ml-4 flex flex-col items-end gap-2">
                              {downloaded ? (
                                <span className="flex items-center gap-1 text-xs text-green-500">
                                  <Check className="w-4 h-4" />
                                  {t('settings.separation.downloaded')}
                                </span>
                              ) : downloading ? (
                                <div className="flex flex-col items-end gap-1">
                                  <span className="flex items-center gap-1 text-xs text-blue-500">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    {t('settings.separation.downloading')}
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
                                  {t('common.download')}
                                </Button>
                              )}
                              <ChevronDown
                                className={`w-4 h-4 text-[hsl(var(--text-muted))] transition-transform ${showMatchingSettings ? 'rotate-180' : ''}`}
                              />
                            </div>
                          </div>
                        </div>

                        {showMatchingSettings && (
                          <div className="px-4 pb-4 border-t border-[hsl(var(--border))]">
                            <div className="flex items-center justify-between mt-3 mb-3">
                              <h3 className="text-sm font-medium text-[hsl(var(--text-secondary))]">
                                {t('settings.matching.title')}
                              </h3>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                                  {t('settings.matching.minConfidence')}
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
                                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">{t('settings.matching.minConfidenceDesc')}</p>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                                  {t('settings.matching.minSegmentDuration')}
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
                                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">{t('settings.matching.minSegmentDurationDesc')}</p>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                                  {t('settings.matching.windowSize')}
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
                                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">{t('settings.matching.windowSizeDesc')}</p>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                                  {t('settings.matching.hopSize')}
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
                                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">{t('settings.matching.hopSizeDesc')}</p>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                                  {t('settings.matching.maxGapDuration')}
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
                                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">{t('settings.matching.maxGapDurationDesc')}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs text-[hsl(var(--text-muted))] mt-3">
                  {t('settings.separation.modelHint')}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 人物检测设置 */}
        {localConfig && (
          <section className="bg-[hsl(var(--card-bg))] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4">{t('settings.detection.title')}</h2>

            <div className="space-y-6">
              {/* 检测模型管理 */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-[hsl(var(--text-secondary))]">
                    {t('settings.detection.model')}
                  </label>
                </div>

                <div className="space-y-2">
                  {models.filter((m) => m.architecture === 'yolo').map((model) => {
                    const downloaded = isModelDownloaded(model.id);
                    const downloading = isModelDownloading(model.id);
                    const progress = downloadProgress.get(model.id) || 0;
                    const canUseGpu = accelerationOptions?.onnx_gpu_available;

                    return (
                      <div
                        key={model.id}
                        className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] transition-all"
                      >
                        <div
                          className="p-4 cursor-pointer"
                          onClick={() => setShowDetectionSettings(!showDetectionSettings)}
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
                              </div>
                              <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
                                {t(`model.${model.id}.description`, model.description)}
                              </p>
                            </div>
                            <div className="ml-4 flex flex-col items-end gap-2">
                              {downloaded ? (
                                <span className="flex items-center gap-1 text-xs text-green-500">
                                  <Check className="w-4 h-4" />
                                  {t('settings.separation.downloaded')}
                                </span>
                              ) : downloading ? (
                                <div className="flex flex-col items-end gap-1">
                                  <span className="flex items-center gap-1 text-xs text-blue-500">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    {t('settings.separation.downloading')}
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
                                  {t('common.download')}
                                </Button>
                              )}
                              <ChevronDown
                                className={`w-4 h-4 text-[hsl(var(--text-muted))] transition-transform ${showDetectionSettings ? 'rotate-180' : ''}`}
                              />
                            </div>
                          </div>
                        </div>

                        {showDetectionSettings && (
                          <div className="px-4 pb-4 border-t border-[hsl(var(--border))]">
                            <div className="mt-3 mb-3">
                              <h3 className="text-sm font-medium text-[hsl(var(--text-secondary))]">
                                {t('settings.detection.title')}
                              </h3>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                                  {t('settings.detection.confidenceThreshold')}
                                </label>
                                <Input
                                  type="number"
                                  min={0.1}
                                  max={1}
                                  step={0.1}
                                  value={localConfig.detection.confidence_threshold}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    if (!isNaN(val)) {
                                      updateLocalConfig('detection.confidence_threshold', Math.round(val * 10) / 10);
                                    }
                                  }}
                                  onBlur={(e) => {
                                    let val = parseFloat(e.target.value);
                                    if (isNaN(val)) val = 0.5;
                                    val = Math.max(0.1, Math.min(1, Math.round(val * 10) / 10));
                                    updateLocalConfig('detection.confidence_threshold', val);
                                  }}
                                />
                                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">{t('settings.detection.confidenceThresholdDesc')}</p>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                                  {t('settings.detection.frameInterval')}
                                </label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={30}
                                  step={1}
                                  value={localConfig.detection.frame_interval}
                                  onChange={(e) =>
                                    updateLocalConfig(
                                      'detection.frame_interval',
                                      parseInt(e.target.value) || 5
                                    )
                                  }
                                />
                                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">{t('settings.detection.frameIntervalDesc')}</p>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                                  {t('settings.detection.minSegmentDuration')}
                                </label>
                                <Input
                                  type="number"
                                  min={0.5}
                                  max={10}
                                  step={0.5}
                                  value={localConfig.detection.min_segment_duration}
                                  onChange={(e) =>
                                    updateLocalConfig(
                                      'detection.min_segment_duration',
                                      parseFloat(e.target.value) || 1.0
                                    )
                                  }
                                />
                                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">{t('settings.detection.minSegmentDurationDesc')}</p>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-2">
                                  {t('settings.detection.maxGapDuration')}
                                </label>
                                <Input
                                  type="number"
                                  min={0.5}
                                  max={10}
                                  step={0.5}
                                  value={localConfig.detection.max_gap_duration}
                                  onChange={(e) =>
                                    updateLocalConfig(
                                      'detection.max_gap_duration',
                                      parseFloat(e.target.value) || 2.0
                                    )
                                  }
                                />
                                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">{t('settings.detection.maxGapDurationDesc')}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs text-[hsl(var(--text-muted))] mt-3">
                  {t('settings.detection.modelHint')}
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
              {t('settings.log.title')}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-3">
                  {t('settings.log.level')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {([
                    { value: 'info', label: t('settings.log.info'), desc: t('settings.log.infoDesc') },
                    { value: 'debug', label: t('settings.log.debug'), desc: t('settings.log.debugDesc') },
                    { value: 'trace', label: t('settings.log.trace'), desc: t('settings.log.traceDesc') },
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
                  {t('settings.log.hint')}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 存储管理 */}
        <section className="bg-[hsl(var(--card-bg))] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">{t('settings.storage.title')}</h2>
          </div>

          {storageInfo && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-[hsl(var(--secondary))] rounded-lg">
                  <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] mb-2">
                    <Database className="w-4 h-4" />
                    <span className="text-sm">{t('settings.storage.database')}</span>
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
                    <span className="text-sm">{t('settings.storage.cache')}</span>
                  </div>
                  <p className="text-[hsl(var(--foreground))] font-medium">
                    {formatSize(storageInfo.temp_size)}
                  </p>
                </div>
              </div>

              <div className="p-4 bg-[hsl(var(--secondary))] rounded-lg">
                <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] mb-2">
                  <FolderOpen className="w-4 h-4" />
                  <span className="text-sm">{t('settings.storage.dataDir')}</span>
                </div>
                <p className="text-sm text-[hsl(var(--text-secondary))] truncate" title={storageInfo.app_dir}>
                  {storageInfo.app_dir}
                </p>
                <p className="text-[hsl(var(--foreground))] font-medium mt-1">
                  {t('settings.storage.total')}: {formatSize(storageInfo.total_size)}
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
                  {t('settings.storage.clearCache')}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* 数据管理 */}
        <section className="bg-[hsl(var(--card-bg))] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4">{t('settings.data.title')}</h2>
          <p className="text-sm text-[hsl(var(--text-muted))] mb-4">
            {t('settings.data.hint')}
          </p>

          <div className="flex gap-3">
            <Button
              variant="danger"
              onClick={() => setShowResetDbDialog(true)}
            >
              <Database className="w-4 h-4 mr-2" />
              {t('settings.data.resetDatabase')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowResetConfigDialog(true)}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              {t('settings.data.resetConfig')}
            </Button>
          </div>
        </section>

        {/* 保存按钮 */}
        <div className="flex justify-end">
          <Button variant="primary" onClick={handleSave} loading={saving}>
            {t('settings.saveSettings')}
          </Button>
        </div>
      </div>

      {/* 重置数据库确认对话框 */}
      <Dialog open={showResetDbDialog} onOpenChange={setShowResetDbDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.dialog.resetDbTitle')}</DialogTitle>
            <DialogClose />
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-red-500 font-medium">{t('settings.dialog.resetDbWarning')}</p>
              </div>
              <p className="text-[hsl(var(--text-secondary))]">
                {t('settings.dialog.resetDbDesc')}
              </p>
              <ul className="list-disc list-inside text-[hsl(var(--text-muted))] space-y-1">
                <li>{t('settings.dialog.resetDbItem1')}</li>
                <li>{t('settings.dialog.resetDbItem2')}</li>
              </ul>
              <p className="text-[hsl(var(--text-secondary))]">
                {t('settings.dialog.resetDbConfirm')}
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowResetDbDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={handleResetDatabase}
              loading={resettingDb}
            >
              {t('settings.dialog.confirmReset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置配置确认对话框 */}
      <Dialog open={showResetConfigDialog} onOpenChange={setShowResetConfigDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.dialog.resetConfigTitle')}</DialogTitle>
            <DialogClose />
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <p className="text-[hsl(var(--text-secondary))]">
                {t('settings.dialog.resetConfigDesc')}
              </p>
              <ul className="list-disc list-inside text-[hsl(var(--text-muted))] space-y-1">
                <li>{t('settings.dialog.resetConfigItem1')}</li>
                <li>{t('settings.dialog.resetConfigItem2')}</li>
                <li>{t('settings.dialog.resetConfigItem3')}</li>
                <li>{t('settings.dialog.resetConfigItem4')}</li>
              </ul>
              <p className="text-[hsl(var(--text-secondary))]">
                {t('settings.dialog.resetDbConfirm')}
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowResetConfigDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleResetConfig}
              loading={resettingConfig}
            >
              {t('settings.dialog.confirmReset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Settings;
