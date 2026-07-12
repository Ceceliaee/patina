import {
  Save,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import type { SettingsPageProps } from "../types";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import SettingsAppearancePanel from "./SettingsAppearancePanel";
import SettingsDataSafetyPanel from "./SettingsDataSafetyPanel";
import SettingsInterfacePanel from "./SettingsInterfacePanel";
import SettingsDataExportDialog from "./SettingsDataExportDialog.tsx";
import SettingsResidentPanel from "./SettingsResidentPanel";
import SettingsToolsPanel from "./SettingsToolsPanel";
import SettingsTrackingPanel from "./SettingsTrackingPanel";
import { useSettingsPageState } from "../hooks/useSettingsPageState";
import { useWebActivitySetupState } from "../hooks/useWebActivitySetupState";
import { ToolsRuntimeService } from "../../tools/services/toolsRuntimeService.ts";
import type { ToolRuntimeSettings } from "../../../shared/types/tools.ts";

export default function Settings({
  onSettingsChanged,
  onColorSchemeSaved,
  onDirtyChange,
  onToast,
  onRegisterSaveHandler,
  onThemeModePreview,
  onColorSchemePreview,
  onLanguagePreview,
}: SettingsPageProps) {
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const {
    dialogs,
    loading,
    savedSettings,
    draftSettings,
    saveStatus,
    hasUnsavedChanges,
    handleCancel,
    handleSave,
    handleSaveColorScheme,
    handleChange,
    cleanupRange,
    setCleanupRange,
    restoreStrategy,
    setRestoreStrategy,
    isCleaning,
    isExportingBackup,
    isRestoringBackup,
    handleCleanup,
    handleExportBackup,
    handlePrepareRestoreBackup,
    handleRestoreBackup,
    clearPendingRestoreBackup,
    remoteBackup,
    storageSnapshot,
    isStorageBusy,
    handleRefreshStorageSnapshot,
    handleScheduleWebviewCacheClear,
    handleChooseDataDirectory,
    handleChooseCacheDirectory,
    handleRestoreDefaultDataDirectory,
    handleRestoreDefaultCacheDirectory,
    handleCancelPendingStorageMigration,
    handleOpenStorageDirectory,
    idleTimeoutMinutes,
    timelineMergeGapMinutes,
    cleanupOptions,
    idleTimeoutMinutesRange,
    timelineMergeGapMinutesRange,
  } = useSettingsPageState({
    onSettingsChanged,
    onColorSchemeSaved,
    onDirtyChange,
    onToast,
    onRegisterSaveHandler,
  });
  const { showWebActivityHelp } = useWebActivitySetupState({
    savedSettings,
    draftSettings,
  });

  const [toolSettings, setToolSettings] = useState<ToolRuntimeSettings | null>(null);
  const [savedToolSettings, setSavedToolSettings] = useState<ToolRuntimeSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    ToolsRuntimeService.getToolsSnapshot()
      .then((snapshot) => {
        if (cancelled) return;
        setToolSettings(snapshot.settings);
        setSavedToolSettings(snapshot.settings);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const hasToolSettingsUnsavedChanges = (() => {
    if (!toolSettings || !savedToolSettings) return false;
    return (
      toolSettings.reminderSnoozeMinutes !== savedToolSettings.reminderSnoozeMinutes ||
      toolSettings.pomodoroSnoozeMinutes !== savedToolSettings.pomodoroSnoozeMinutes ||
      toolSettings.countdownSnoozeMinutes !== savedToolSettings.countdownSnoozeMinutes
    );
  })();

  const overallHasUnsavedChanges = hasUnsavedChanges || hasToolSettingsUnsavedChanges;

  const handleToolSettingsChange = useCallback((next: Partial<ToolRuntimeSettings>) => {
    setToolSettings((current) => {
      if (!current) return current;
      return { ...current, ...next };
    });
  }, []);

  const saveToolSettings = useCallback(async (): Promise<boolean> => {
    if (!toolSettings || !hasToolSettingsUnsavedChanges) return true;
    try {
      await ToolsRuntimeService.setReminderSnoozeMinutes(toolSettings.reminderSnoozeMinutes);
      await ToolsRuntimeService.setPomodoroSnoozeMinutes(toolSettings.pomodoroSnoozeMinutes);
      const finalSnapshot = await ToolsRuntimeService.setCountdownSnoozeMinutes(toolSettings.countdownSnoozeMinutes);
      setSavedToolSettings(finalSnapshot.settings);
      setToolSettings(finalSnapshot.settings);
      return true;
    } catch {
      return false;
    }
  }, [toolSettings, hasToolSettingsUnsavedChanges]);

  const cancelToolSettings = useCallback(() => {
    if (savedToolSettings) {
      setToolSettings(savedToolSettings);
    }
  }, [savedToolSettings]);

  const handleSaveAll = useCallback(async () => {
    const appSettingsOk = await handleSave();
    const toolSettingsOk = await saveToolSettings();
    return appSettingsOk && toolSettingsOk;
  }, [handleSave, saveToolSettings]);

  const handleCancelAll = useCallback(() => {
    handleCancel();
    cancelToolSettings();
  }, [handleCancel, cancelToolSettings]);
  useEffect(() => {
    if (!draftSettings) return;
    onThemeModePreview?.(draftSettings.themeMode);
    onColorSchemePreview?.({
      light: draftSettings.colorSchemeLight,
      dark: draftSettings.colorSchemeDark,
    });
    onLanguagePreview?.(draftSettings.language);
  }, [draftSettings, onColorSchemePreview, onLanguagePreview, onThemeModePreview]);

  useEffect(() => () => {
    onThemeModePreview?.(null);
    onColorSchemePreview?.(null);
    onLanguagePreview?.(null);
  }, [onColorSchemePreview, onLanguagePreview, onThemeModePreview]);

  if (loading || !savedSettings || !draftSettings) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--qp-text-tertiary)] gap-3">
        <RefreshCw className="animate-spin" size={20} />
        <span className="text-sm font-medium">{UI_TEXT.settings.loading}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-4 md:gap-5">
      {dialogs}
      <QuietPageHeader
        icon={<Settings2 size={18} />}
        title={UI_TEXT.settings.title}
        subtitle={UI_TEXT.settings.subtitle}
        rightSlot={(
          <div className="flex items-center gap-2.5">
            <div
              className={`qp-status ${
                saveStatus !== "saving" && overallHasUnsavedChanges ? "qp-status-danger" : ""
              } flex px-3 py-1.5 rounded-[8px] items-center text-xs font-semibold`}
            >
              {saveStatus === "saving" && (
                <span className="text-[var(--qp-accent-default)] flex items-center gap-2">
                  <RefreshCw size={12} className="animate-spin" />
                  {UI_TEXT.settings.saving}
                </span>
              )}
              {saveStatus === "saved" && !overallHasUnsavedChanges && (
                <span className="text-[var(--qp-success)] flex items-center gap-1.5">
                  <Save size={14} />
                  {UI_TEXT.settings.saved}
                </span>
              )}
              {saveStatus !== "saving" && overallHasUnsavedChanges && (
                <span>{UI_TEXT.settings.unsaved}</span>
              )}
              {saveStatus === "idle" && !overallHasUnsavedChanges && (
                <span className="text-[var(--qp-text-tertiary)]">{UI_TEXT.settings.idle}</span>
              )}
            </div>
            <button
              type="button"
              onClick={handleCancelAll}
              disabled={!overallHasUnsavedChanges || saveStatus === "saving"}
              className="qp-button-secondary rounded-[8px] px-2.5 py-1.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {UI_TEXT.settings.cancel}
            </button>
            <button
              type="button"
              onClick={() => void handleSaveAll()}
              disabled={!overallHasUnsavedChanges || saveStatus === "saving"}
              className="qp-button-primary rounded-[8px] px-2.5 py-1.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveStatus === "saving" ? UI_TEXT.settings.saving : UI_TEXT.settings.save}
            </button>
          </div>
        )}
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
        <div className="grid grid-cols-1 gap-4 md:gap-5">
          <SettingsTrackingPanel
            timelineMergeGapControl={{
              label: UI_TEXT.settings.timelineMergeGapLabel,
              hint: UI_TEXT.settings.timelineMergeGapHint,
              minutes: timelineMergeGapMinutes,
              minMinutes: timelineMergeGapMinutesRange.min,
              maxMinutes: timelineMergeGapMinutesRange.max,
              onMinutesChange: (nextMinutes) => handleChange("timelineMergeGapSecs", nextMinutes * 60),
            }}
            idleTimeoutControl={{
              label: UI_TEXT.settings.idleTimeoutLabel,
              hint: UI_TEXT.settings.idleTimeoutHint,
              minutes: idleTimeoutMinutes,
              minMinutes: idleTimeoutMinutesRange.min,
              maxMinutes: idleTimeoutMinutesRange.max,
              onMinutesChange: (nextMinutes) => handleChange("idleTimeoutSecs", nextMinutes * 60),
            }}
            trackingPaused={draftSettings.trackingPaused}
            onTrackingPausedChange={(nextChecked) => handleChange("trackingPaused", nextChecked)}
          />

          <SettingsAppearancePanel
            themeMode={draftSettings.themeMode}
            onThemeModeChange={(nextThemeMode) => handleChange("themeMode", nextThemeMode)}
            language={draftSettings.language}
            onLanguageChange={(nextLanguage) => handleChange("language", nextLanguage)}
            colorSchemeLight={draftSettings.colorSchemeLight}
            onColorSchemeLightChange={(nextColorScheme) => handleChange("colorSchemeLight", nextColorScheme)}
            colorSchemeDark={draftSettings.colorSchemeDark}
            onColorSchemeDarkChange={(nextColorScheme) => handleChange("colorSchemeDark", nextColorScheme)}
            dynamicEffects={draftSettings.dynamicEffects}
            onDynamicEffectsChange={(nextChecked) => handleChange("dynamicEffects", nextChecked)}
            onConfirmColorSchemeChange={handleSaveColorScheme}
            colorSchemeConfirming={saveStatus === "saving"}
          />

          <SettingsResidentPanel
            minimizeToWidgetChecked={draftSettings.minimizeBehavior === "widget"}
            onMinimizeToWidgetChange={(nextChecked) => {
              handleChange(
                "minimizeBehavior",
                nextChecked ? "widget" : "taskbar",
              );
            }}
            closeToTrayChecked={draftSettings.closeBehavior === "tray"}
            onCloseToTrayChange={(nextChecked) => {
              handleChange(
                "closeBehavior",
                nextChecked ? "tray" : "exit",
              );
            }}
            backgroundOptimizationChecked={draftSettings.backgroundOptimization}
            onBackgroundOptimizationChange={(nextChecked) => {
              handleChange("backgroundOptimization", nextChecked);
            }}
            launchAtLoginChecked={draftSettings.launchAtLogin}
            onLaunchAtLoginChange={(nextChecked) => handleChange("launchAtLogin", nextChecked)}
            startMinimizedChecked={draftSettings.startMinimized}
            startMinimizedDisabled={!draftSettings.launchAtLogin}
            onStartMinimizedChange={(nextChecked) => handleChange("startMinimized", nextChecked)}
          />

          <SettingsInterfacePanel
            webActivityEnabled={draftSettings.webActivityEnabled}
            showWebActivityHelp={showWebActivityHelp}
            port={draftSettings.webActivityPort}
            webActivityToken={draftSettings.webActivityToken}
            remoteStatusBridgeEnabled={draftSettings.remoteStatusBridgeEnabled}
            remoteStatusBridgeUrl={draftSettings.remoteStatusBridgeUrl}
            remoteStatusBridgeToken={draftSettings.remoteStatusBridgeToken}
            remoteStatusBridgeMachineId={draftSettings.remoteStatusBridgeMachineId}
            enableSystemNotifications={draftSettings.enableSystemNotifications}
            enableInAppNotifications={draftSettings.enableInAppNotifications}
            onWebActivityEnabledChange={(nextChecked) => handleChange("webActivityEnabled", nextChecked)}
            onPortChange={(nextPort) => handleChange("webActivityPort", nextPort)}
            onWebActivityTokenChange={(nextToken) => handleChange("webActivityToken", nextToken)}
            onRemoteStatusBridgeEnabledChange={(nextChecked) => handleChange("remoteStatusBridgeEnabled", nextChecked)}
            onRemoteStatusBridgeUrlChange={(nextUrl) => handleChange("remoteStatusBridgeUrl", nextUrl)}
            onRemoteStatusBridgeTokenChange={(nextToken) => handleChange("remoteStatusBridgeToken", nextToken)}
            onEnableSystemNotificationsChange={(nextChecked) => handleChange("enableSystemNotifications", nextChecked)}
            onEnableInAppNotificationsChange={(nextChecked) => handleChange("enableInAppNotifications", nextChecked)}
          />

          {toolSettings && (
            <SettingsToolsPanel
              reminderSnoozeMinutes={toolSettings.reminderSnoozeMinutes}
              pomodoroSnoozeMinutes={toolSettings.pomodoroSnoozeMinutes}
              countdownSnoozeMinutes={toolSettings.countdownSnoozeMinutes}
              onReminderSnoozeMinutesChange={(nextMinutes) => handleToolSettingsChange({ reminderSnoozeMinutes: nextMinutes })}
              onPomodoroSnoozeMinutesChange={(nextMinutes) => handleToolSettingsChange({ pomodoroSnoozeMinutes: nextMinutes })}
              onCountdownSnoozeMinutesChange={(nextMinutes) => handleToolSettingsChange({ countdownSnoozeMinutes: nextMinutes })}
            />
          )}

          <SettingsDataSafetyPanel
            cleanupRange={cleanupRange}
            cleanupOptions={cleanupOptions}
            restoreStrategy={restoreStrategy}
            isCleaning={isCleaning}
            isExportingBackup={isExportingBackup}
            isRestoringBackup={isRestoringBackup}
            onCleanupRangeChange={setCleanupRange}
            onRestoreStrategyChange={setRestoreStrategy}
            onCleanup={handleCleanup}
            onExportBackup={() => void handleExportBackup()}
            onOpenDataExport={() => setExportDialogOpen(true)}
            onPrepareRestoreBackup={handlePrepareRestoreBackup}
            onRestoreBackup={handleRestoreBackup}
            onClearPendingRestoreBackup={clearPendingRestoreBackup}
            remoteBackup={remoteBackup}
            storageSnapshot={storageSnapshot}
            isStorageBusy={isStorageBusy}
            onRefreshStorageSnapshot={handleRefreshStorageSnapshot}
            onScheduleWebviewCacheClear={handleScheduleWebviewCacheClear}
            onChooseDataDirectory={handleChooseDataDirectory}
            onChooseCacheDirectory={handleChooseCacheDirectory}
            onRestoreDefaultDataDirectory={handleRestoreDefaultDataDirectory}
            onRestoreDefaultCacheDirectory={handleRestoreDefaultCacheDirectory}
            onCancelPendingStorageMigration={handleCancelPendingStorageMigration}
            onOpenStorageDirectory={handleOpenStorageDirectory}
          />
        </div>
      </div>

      <SettingsDataExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        onToast={onToast}
      />
    </div>
  );
}
