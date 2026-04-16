import { useCallback, useEffect, useRef, useState } from "react";
import {
  Trash2,
  Clock,
  Save,
  RefreshCw,
  Settings2,
  Monitor,
  Database,
  Info,
  Minus,
  Plus,
} from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/uiText";
import { DEFAULT_SETTINGS, type AppSettings } from "../../../shared/settings/appSettings";
import { SettingsRuntimeAdapterService } from "../services/settingsRuntimeAdapterService";
import type { SettingsPageProps, CleanupRange } from "../types";
import type { ToastTone } from "../../../shared/components/ToastStack";
import { useQuietDialogs } from "../../../shared/hooks/useQuietDialogs";
import QuietSelect from "../../../shared/components/QuietSelect";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import QuietDangerAction from "../../../shared/components/QuietDangerAction";
import QuietSubpanel from "../../../shared/components/QuietSubpanel";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import UpdateStatusPanel from "../../update/components/UpdateStatusPanel";
import { getSettingsBootstrapCache, setSettingsBootstrapCache } from "../services/settingsBootstrapCache";

const CLEANUP_OPTIONS: Array<{ value: CleanupRange; label: string }> = [
  { value: 180, label: UI_TEXT.settings.cleanupRangeLabels[180] },
  { value: 90, label: UI_TEXT.settings.cleanupRangeLabels[90] },
  { value: 60, label: UI_TEXT.settings.cleanupRangeLabels[60] },
  { value: 30, label: UI_TEXT.settings.cleanupRangeLabels[30] },
  { value: 15, label: UI_TEXT.settings.cleanupRangeLabels[15] },
  { value: 7, label: UI_TEXT.settings.cleanupRangeLabels[7] },
];

const MINIMIZE_BEHAVIOR_DEFAULT = DEFAULT_SETTINGS.minimize_behavior;
const MINIMIZE_BEHAVIOR_ALTERNATE: AppSettings["minimize_behavior"] =
  MINIMIZE_BEHAVIOR_DEFAULT === "taskbar" ? "tray" : "taskbar";
const CLOSE_BEHAVIOR_DEFAULT = DEFAULT_SETTINGS.close_behavior;
const CLOSE_BEHAVIOR_ALTERNATE: AppSettings["close_behavior"] =
  CLOSE_BEHAVIOR_DEFAULT === "tray" ? "exit" : "tray";
const IDLE_TIMEOUT_MINUTES_RANGE = { min: 1, max: 30 } as const;
const TIMELINE_MERGE_GAP_MINUTES_RANGE = { min: 1, max: 5 } as const;
const MIN_SESSION_MINUTES_RANGE = { min: 1, max: 10 } as const;
const clampMinute = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const secondsToMinute = (seconds: number, min: number, max: number) =>
  clampMinute(Math.round(seconds / 60), min, max);

type MinuteStepperSliderProps = {
  ariaLabel: string;
  minutes: number;
  minMinutes: number;
  maxMinutes: number;
  onMinutesChange: (nextMinutes: number) => void;
};

function MinuteStepperSlider({
  ariaLabel,
  minutes,
  minMinutes,
  maxMinutes,
  onMinutesChange,
}: MinuteStepperSliderProps) {
  const canDecrease = minutes > minMinutes;
  const canIncrease = minutes < maxMinutes;
  const updateMinutes = (nextMinutes: number) => onMinutesChange(clampMinute(nextMinutes, minMinutes, maxMinutes));
  const sliderProgress = ((minutes - minMinutes) / (maxMinutes - minMinutes)) * 100;

  return (
    <div className="flex w-full max-w-[224px] items-center gap-2.5 md:justify-self-end">
      <div className="contents">
        <button
          type="button"
          onClick={() => updateMinutes(minutes - 1)}
          disabled={!canDecrease}
          aria-label={`${ariaLabel}减少 1 分钟`}
          className="qp-button-secondary order-1 inline-flex h-6 w-6 items-center justify-center rounded-[6px] p-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Minus size={11} />
        </button>

        <input
          type="range"
          min={minMinutes}
          max={maxMinutes}
          step={1}
          value={minutes}
          onChange={(event) => updateMinutes(Number(event.target.value))}
          aria-label={ariaLabel}
          style={{
            backgroundImage: `linear-gradient(to right, var(--qp-text-tertiary) 0%, var(--qp-text-tertiary) ${sliderProgress}%, var(--qp-track-muted) ${sliderProgress}%, var(--qp-track-muted) 100%)`,
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "100% 3px",
          }}
          className="order-2 h-5 min-w-[80px] flex-1 cursor-pointer appearance-none rounded-full [&::-webkit-slider-runnable-track]:h-[3px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-5.5px] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-[var(--qp-bg-panel)] [&::-webkit-slider-thumb]:bg-[var(--qp-text-tertiary)] [&::-moz-range-track]:h-[3px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-[var(--qp-bg-panel)] [&::-moz-range-thumb]:bg-[var(--qp-text-tertiary)]"
        />

        <button
          type="button"
          onClick={() => updateMinutes(minutes + 1)}
          disabled={!canIncrease}
          aria-label={`${ariaLabel}增加 1 分钟`}
          className="qp-button-secondary order-4 inline-flex h-6 w-6 items-center justify-center rounded-[6px] p-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={11} />
        </button>
      </div>
      <p className="order-3 min-w-[48px] text-center text-xs font-medium tabular-nums text-[var(--qp-text-secondary)]">
        {minutes} 分钟
      </p>
    </div>
  );
}

export default function Settings({
  onSettingsChanged,
  onCheckForUpdates,
  onOpenUpdateDialog,
  updateSnapshot,
  updateChecking,
  updateInstalling,
  onDirtyChange,
  onToast,
  onRegisterSaveHandler,
}: SettingsPageProps) {
  const { confirm, dialogs } = useQuietDialogs();
  const initialBootstrap = getSettingsBootstrapCache();
  const initialBootstrapRef = useRef(initialBootstrap);
  const [savedSettings, setSavedSettings] = useState<AppSettings | null>(
    () => (initialBootstrap ? { ...initialBootstrap.settings } : null),
  );
  const [draftSettings, setDraftSettings] = useState<AppSettings | null>(
    () => (initialBootstrap ? { ...initialBootstrap.settings } : null),
  );
  const [loading, setLoading] = useState(() => !initialBootstrap);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [cleanupRange, setCleanupRange] = useState<CleanupRange>(30);
  const [isCleaning, setIsCleaning] = useState(false);
  const [exportPath, setExportPath] = useState("");
  const [restorePath, setRestorePath] = useState("");
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [appVersion, setAppVersion] = useState(() => initialBootstrap?.appVersion ?? "-");
  const hasUnsavedChangesRef = useRef(false);

  const notify = (message: string, tone: ToastTone = "info") => {
    onToast?.(message, tone);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const hadCacheAtStart = Boolean(initialBootstrapRef.current);
      if (!hadCacheAtStart) {
        setLoading(true);
      }
      try {
        const bootstrap = await SettingsRuntimeAdapterService.loadBootstrap();
        setSettingsBootstrapCache({
          settings: { ...bootstrap.settings },
          appVersion: bootstrap.appVersion,
        });
        if (cancelled) return;
        if (!hasUnsavedChangesRef.current) {
          setSavedSettings({ ...bootstrap.settings });
          setDraftSettings({ ...bootstrap.settings });
        }
        setAppVersion(bootstrap.appVersion);
      } catch (error) {
        console.error("load settings bootstrap failed", error);
      } finally {
        if (!cancelled && !hadCacheAtStart) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasUnsavedChanges = (() => {
    if (!savedSettings || !draftSettings) {
      return false;
    }
    const keys = Object.keys(savedSettings) as Array<keyof AppSettings>;
    return keys.some((key) => savedSettings[key] !== draftSettings[key]);
  })();

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => () => {
    onDirtyChange?.(false);
  }, [onDirtyChange]);

  const handleChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraftSettings((current) => {
      if (!current) return current;
      const nextDraft = { ...current, [key]: value } as AppSettings;
      if (key === "launch_at_login" && value === false) {
        nextDraft.start_minimized = false;
      }
      return nextDraft;
    });
  };

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!savedSettings || !draftSettings) return false;
    if (!hasUnsavedChanges) return true;
    if (saveStatus === "saving") return false;
    setSaveStatus("saving");
    try {
      const patch = SettingsRuntimeAdapterService.buildSettingsPatch(savedSettings, draftSettings);
      await SettingsRuntimeAdapterService.commitSettingsPatch(patch);
      setSavedSettings(draftSettings);
      setSettingsBootstrapCache({
        settings: { ...draftSettings },
        appVersion,
      });
      onSettingsChanged(draftSettings);
      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus("idle"), 1800);
      notify(UI_TEXT.settings.saved, "success");
      return true;
    } catch (error) {
      console.error("save settings failed", error);
      setSaveStatus("idle");
      notify(UI_TEXT.settings.saveFailed, "warning");
      return false;
    }
  }, [draftSettings, hasUnsavedChanges, notify, onSettingsChanged, saveStatus, savedSettings]);

  useEffect(() => {
    onRegisterSaveHandler?.(handleSave);
    return () => {
      onRegisterSaveHandler?.(null);
    };
  }, [handleSave, onRegisterSaveHandler]);

  const handleCancel = () => {
    if (!savedSettings || !hasUnsavedChanges) return;
    setDraftSettings(savedSettings);
    setSaveStatus("idle");
    notify(UI_TEXT.settings.cancelled, "info");
  };

  const handleCleanup = async () => {
    const selectedLabel = CLEANUP_OPTIONS.find((option) => option.value === cleanupRange)?.label
      ?? UI_TEXT.settings.confirmRangeFallback;
    const confirmed = await confirm({
      title: UI_TEXT.settings.cleanupConfirmTitle,
      description: UI_TEXT.settings.cleanupConfirmDetail(selectedLabel),
      confirmLabel: UI_TEXT.dialog.confirmDanger,
      danger: true,
    });
    if (!confirmed) return;

    setIsCleaning(true);
    try {
      await SettingsRuntimeAdapterService.clearSessionsByRange(cleanupRange);
      notify("历史数据已清理。", "success");
      window.location.reload();
    } catch (error) {
      console.error("cleanup failed", error);
      notify("历史数据清理失败，请稍后重试。", "warning");
    } finally {
      setIsCleaning(false);
    }
  };

  const handleExportBackup = async () => {
    if (isExportingBackup) return;

    setIsExportingBackup(true);

    try {
      const exportedPath = await SettingsRuntimeAdapterService.exportBackupWithPicker(exportPath.trim() || undefined);
      if (!exportedPath) return;
      setExportPath(exportedPath);
      notify(`备份导出成功：${exportedPath}`, "success");
    } catch (error) {
      console.error("export backup failed", error);
      notify("备份导出失败，请检查路径后重试。", "warning");
    } finally {
      setIsExportingBackup(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (isRestoringBackup) return;

    let preparation: Awaited<ReturnType<typeof SettingsRuntimeAdapterService.prepareBackupRestore>> = null;
    try {
      preparation = await SettingsRuntimeAdapterService.prepareBackupRestore(restorePath.trim() || undefined);
      if (!preparation) return;
      setRestorePath(preparation.path);
      if (!preparation.compatible) {
        notify(`备份不兼容：${preparation.incompatibilityMessage ?? "未知原因"}`, "warning");
        return;
      }
    } catch (error) {
      console.error("prepare backup restore failed", error);
      notify("备份文件预览失败，无法确认覆盖范围。", "warning");
      return;
    }
    if (!preparation || !preparation.compatible) return;

    const confirmed = await confirm({
      title: UI_TEXT.settings.restoreConfirmTitle,
      description: UI_TEXT.settings.restoreConfirmDetail(preparation.path, preparation.previewSummary),
      confirmLabel: UI_TEXT.dialog.confirmDanger,
      danger: true,
    });
    if (!confirmed) return;

    setIsRestoringBackup(true);
    try {
      await SettingsRuntimeAdapterService.restoreBackup(preparation.path);
      notify("备份恢复成功，正在刷新界面。", "success");
      window.location.reload();
    } catch (error) {
      console.error("restore backup failed", error);
      notify("备份恢复失败，已自动回滚，不会破坏当前数据。", "warning");
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const handleOpenReleaseNotes = async () => {
    try {
      await SettingsRuntimeAdapterService.openReleaseNotes();
    } catch (error) {
      console.error("open release notes failed", error);
      notify("无法打开更新说明链接。", "warning");
    }
  };

  const handleOpenFeedback = async () => {
    try {
      await SettingsRuntimeAdapterService.openFeedback();
    } catch (error) {
      console.error("open feedback link failed", error);
      notify("无法打开反馈链接。", "warning");
    }
  };

  if (loading || !savedSettings || !draftSettings) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--qp-text-tertiary)] gap-3">
        <RefreshCw className="animate-spin" size={20} />
        <span className="text-sm font-medium">{UI_TEXT.settings.loading}</span>
      </div>
    );
  }

  const idleTimeoutMinutes = secondsToMinute(
    draftSettings.idle_timeout_secs,
    IDLE_TIMEOUT_MINUTES_RANGE.min,
    IDLE_TIMEOUT_MINUTES_RANGE.max,
  );
  const timelineMergeGapMinutes = secondsToMinute(
    draftSettings.timeline_merge_gap_secs,
    TIMELINE_MERGE_GAP_MINUTES_RANGE.min,
    TIMELINE_MERGE_GAP_MINUTES_RANGE.max,
  );
  const minSessionMinutes = secondsToMinute(
    draftSettings.min_session_secs,
    MIN_SESSION_MINUTES_RANGE.min,
    MIN_SESSION_MINUTES_RANGE.max,
  );
  const effectiveUpdateSnapshot = updateSnapshot ?? {
    current_version: appVersion,
    status: "idle",
    latest_version: null,
    release_notes: null,
    release_date: null,
    error_message: null,
  };

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-4 md:gap-5">
      {dialogs}
      <QuietPageHeader
        icon={<Settings2 size={18} />}
        title={UI_TEXT.settings.title}
        subtitle={UI_TEXT.settings.subtitle}
        rightSlot={(
          <div className="flex items-center gap-2.5">
            <div className="qp-status flex px-3 py-1.5 rounded-[8px] items-center text-xs font-semibold">
              {saveStatus === "saving" && (
                <span className="text-[var(--qp-accent-default)] flex items-center gap-2">
                  <RefreshCw size={12} className="animate-spin" />
                  {UI_TEXT.settings.saving}
                </span>
              )}
              {saveStatus === "saved" && !hasUnsavedChanges && (
                <span className="text-[var(--qp-success)] flex items-center gap-1.5">
                  <Save size={14} />
                  {UI_TEXT.settings.saved}
                </span>
              )}
              {saveStatus !== "saving" && hasUnsavedChanges && (
                <span className="text-[var(--qp-warning)]">{UI_TEXT.settings.unsaved}</span>
              )}
              {saveStatus === "idle" && !hasUnsavedChanges && (
                <span className="text-[var(--qp-text-tertiary)]">{UI_TEXT.settings.idle}</span>
              )}
            </div>
            <button
              type="button"
              onClick={handleCancel}
              disabled={!hasUnsavedChanges || saveStatus === "saving"}
              className="qp-button-secondary rounded-[8px] px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {UI_TEXT.settings.cancel}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!hasUnsavedChanges || saveStatus === "saving"}
              className="qp-button-primary rounded-[8px] px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveStatus === "saving" ? UI_TEXT.settings.saving : UI_TEXT.settings.save}
            </button>
          </div>
        )}
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
        <div className="grid grid-cols-1 gap-4 md:gap-5">
          <section className="qp-panel min-h-[240px] p-5 md:p-6">
            <div className="flex items-center gap-2.5 pb-2 border-b border-[var(--qp-border-subtle)]">
              <Clock size={16} className="text-[var(--qp-accent-default)]" />
              <h2 className="text-sm font-semibold text-[var(--qp-text-primary)]">追踪</h2>
            </div>

            <div className="mt-5 space-y-5">
              <div>
                <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">{UI_TEXT.settings.idleTimeoutLabel}</label>
                <div className="mt-2 grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,260px)] md:gap-4">
                  <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">{UI_TEXT.settings.idleTimeoutHint}</p>
                  <MinuteStepperSlider
                    ariaLabel={UI_TEXT.settings.idleTimeoutLabel}
                    minutes={idleTimeoutMinutes}
                    minMinutes={IDLE_TIMEOUT_MINUTES_RANGE.min}
                    maxMinutes={IDLE_TIMEOUT_MINUTES_RANGE.max}
                    onMinutesChange={(nextMinutes) => handleChange("idle_timeout_secs", nextMinutes * 60)}
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">{UI_TEXT.settings.timelineMergeGapLabel}</label>
                <div className="mt-2 grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,260px)] md:gap-4">
                  <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">{UI_TEXT.settings.timelineMergeGapHint}</p>
                  <MinuteStepperSlider
                    ariaLabel={UI_TEXT.settings.timelineMergeGapLabel}
                    minutes={timelineMergeGapMinutes}
                    minMinutes={TIMELINE_MERGE_GAP_MINUTES_RANGE.min}
                    maxMinutes={TIMELINE_MERGE_GAP_MINUTES_RANGE.max}
                    onMinutesChange={(nextMinutes) => handleChange("timeline_merge_gap_secs", nextMinutes * 60)}
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">{UI_TEXT.settings.minSessionLabel}</label>
                <div className="mt-2 grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,260px)] md:gap-4">
                  <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">{UI_TEXT.settings.minSessionHint}</p>
                  <MinuteStepperSlider
                    ariaLabel={UI_TEXT.settings.minSessionLabel}
                    minutes={minSessionMinutes}
                    minMinutes={MIN_SESSION_MINUTES_RANGE.min}
                    maxMinutes={MIN_SESSION_MINUTES_RANGE.max}
                    onMinutesChange={(nextMinutes) => handleChange("min_session_secs", nextMinutes * 60)}
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">暂停追踪</label>
                <div className="mt-2 flex items-start justify-between gap-4">
                  <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">
                    暂停后不再写入新记录，恢复后继续计时。
                  </p>
                  <QuietSwitch
                    checked={draftSettings.tracking_paused}
                    onChange={(nextChecked) => handleChange("tracking_paused", nextChecked)}
                    ariaLabel="切换暂停追踪"
                    tone="warning"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="qp-panel min-h-[220px] p-5 md:p-6">
            <div className="flex items-center gap-2.5 pb-2 border-b border-[var(--qp-border-subtle)]">
              <Monitor size={16} className="text-[var(--qp-accent-default)]" />
              <h2 className="text-sm font-semibold text-[var(--qp-text-primary)]">常驻</h2>
            </div>

            <div className="mt-5 space-y-5">
              <div>
                <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">最小化到托盘</label>
                <div className="mt-2 flex items-start justify-between gap-4">
                  <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">
                    点最小化后，将窗口收进系统托盘。
                  </p>
                  <QuietSwitch
                    checked={draftSettings.minimize_behavior !== MINIMIZE_BEHAVIOR_DEFAULT}
                    onChange={(nextChecked) => {
                      handleChange(
                        "minimize_behavior",
                        nextChecked ? MINIMIZE_BEHAVIOR_ALTERNATE : MINIMIZE_BEHAVIOR_DEFAULT,
                      );
                    }}
                    ariaLabel="切换最小化到托盘"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">关闭到托盘</label>
                <div className="mt-2 flex items-start justify-between gap-4">
                  <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">
                    点关闭后，隐藏窗口并继续后台运行。
                  </p>
                  <QuietSwitch
                    checked={draftSettings.close_behavior !== CLOSE_BEHAVIOR_DEFAULT}
                    onChange={(nextChecked) => {
                      handleChange(
                        "close_behavior",
                        nextChecked ? CLOSE_BEHAVIOR_ALTERNATE : CLOSE_BEHAVIOR_DEFAULT,
                      );
                    }}
                    ariaLabel="切换关闭到托盘"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">开机自启动</label>
                <div className="mt-2 flex items-start justify-between gap-4">
                  <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">
                    开启后，系统登录时自动启动应用。
                  </p>
                  <QuietSwitch
                    checked={draftSettings.launch_at_login}
                    onChange={(nextChecked) => handleChange("launch_at_login", nextChecked)}
                    ariaLabel="切换开机自启动"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">启动时最小化</label>
                <div className="mt-2 flex items-start justify-between gap-4">
                  <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">
                    仅对自启动生效：启动后直接进托盘。
                  </p>
                  <QuietSwitch
                    checked={draftSettings.start_minimized}
                    disabled={!draftSettings.launch_at_login}
                    onChange={(nextChecked) => handleChange("start_minimized", nextChecked)}
                    ariaLabel="切换启动时最小化"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="qp-panel p-5 md:p-6">
            <div className="flex items-center gap-2.5 pb-2 border-b border-[var(--qp-border-subtle)] mb-5">
              <Database size={16} className="text-[var(--qp-danger)]" />
              <h2 className="text-sm font-semibold text-[var(--qp-text-primary)]">数据安全</h2>
            </div>

            <div className="space-y-5">
              <QuietSubpanel>
                <p className="text-sm font-semibold text-[var(--qp-text-primary)]">备份与恢复</p>
                <p className="mt-1 text-sm text-[var(--qp-text-secondary)]">
                  包含会话数据、设置项和图标缓存。恢复会覆盖当前数据。
                </p>

                <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <QuietActionRow className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[var(--qp-text-primary)]">导出</p>
                      <p className="mt-0.5 text-xs text-[var(--qp-text-tertiary)]">生成当前数据快照</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleExportBackup()}
                      disabled={isExportingBackup || isRestoringBackup}
                      className="qp-button-secondary rounded-[8px] px-3 py-2 text-xs font-semibold text-[var(--qp-text-secondary)] disabled:opacity-50"
                    >
                      {isExportingBackup ? "导出中..." : "导出"}
                    </button>
                  </QuietActionRow>

                  <QuietActionRow className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[var(--qp-text-primary)]">恢复</p>
                      <p className="mt-0.5 text-xs text-[var(--qp-text-tertiary)]">从备份文件回滚数据</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRestoreBackup()}
                      disabled={isExportingBackup || isRestoringBackup}
                      className="qp-button-secondary rounded-[8px] px-3 py-2 text-xs font-semibold text-[var(--qp-text-secondary)] disabled:opacity-50"
                    >
                      {isRestoringBackup ? "恢复中..." : "恢复"}
                    </button>
                  </QuietActionRow>
                </div>
              </QuietSubpanel>

              <QuietSubpanel tone="danger">
                <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.cleanupTitle}</p>
                <p className="mt-1 text-sm text-[var(--qp-text-secondary)]">{UI_TEXT.settings.cleanupHint}</p>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <QuietSelect
                    value={cleanupRange}
                    onChange={(value) => setCleanupRange(value as CleanupRange)}
                    className="w-[128px]"
                    options={CLEANUP_OPTIONS}
                  />

                  <QuietDangerAction
                    onClick={handleCleanup}
                    disabled={isCleaning}
                    leadingIcon={isCleaning ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  >
                    {isCleaning ? UI_TEXT.settings.cleanupRunning : UI_TEXT.settings.cleanupNow}
                  </QuietDangerAction>
                </div>
              </QuietSubpanel>
            </div>
          </section>

          <section className="qp-panel p-5 md:p-6">
            <div className="flex items-center gap-2.5 pb-2 border-b border-[var(--qp-border-subtle)] mb-5">
              <Info size={16} className="text-[var(--qp-accent-default)]" />
              <h2 className="text-sm font-semibold text-[var(--qp-text-primary)]">关于</h2>
            </div>

            <QuietSubpanel>
              <p className="text-sm font-semibold text-[var(--qp-text-primary)]">应用信息</p>
              <p className="mt-1 text-sm text-[var(--qp-text-secondary)]">
                当前版本：v{appVersion}
              </p>
              <p className="mt-0.5 text-xs text-[var(--qp-text-tertiary)]">
                查看最新发布说明，或提交使用反馈。
              </p>
              <div className="mt-4">
                <UpdateStatusPanel
                  snapshot={effectiveUpdateSnapshot}
                  checking={updateChecking ?? false}
                  installing={updateInstalling ?? false}
                  onCheckUpdates={() => {
                    if (!onCheckForUpdates) return;
                    void onCheckForUpdates();
                  }}
                  onOpenConfirmDialog={() => onOpenUpdateDialog?.()}
                  onOpenReleaseNotes={() => {
                    void handleOpenReleaseNotes();
                  }}
                  onOpenFeedback={() => {
                    void handleOpenFeedback();
                  }}
                />
              </div>
            </QuietSubpanel>
          </section>
        </div>
      </div>
    </div>
  );
}
