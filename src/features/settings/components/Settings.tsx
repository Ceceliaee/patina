import { useLocaleText } from "../../../shared/i18n/index.ts";
import { Save, RefreshCw, Settings2, } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import type { SettingsPageProps } from "../types";
import type { AppLanguage } from "../../../shared/settings/appSettings.ts";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import QuietButton from "../../../shared/components/QuietButton";
import SettingsAppearancePanel from "./SettingsAppearancePanel";
import SettingsDataSafetyPanel from "./SettingsDataSafetyPanel";
import SettingsInterfacePanel from "./SettingsInterfacePanel";
import SettingsResidentPanel from "./SettingsResidentPanel";
import SettingsTrackingPanel from "./SettingsTrackingPanel";
import { useSettingsPageState } from "../hooks/useSettingsPageState";
import { useWebActivitySetupState } from "../hooks/useWebActivitySetupState";
import { useSettingsImportState } from "../hooks/useSettingsImportState.ts";
import { prepareSettingsLanguagePreview } from "../services/settingsLanguagePreview.ts";

const SettingsDataExportDialog = lazy(() => import("./SettingsDataExportDialog.tsx"));
const SettingsDataImportDialog = lazy(() => import("./SettingsDataImportDialog.tsx"));

export default function Settings({
  onSettingsChanged,
  onColorSchemeSaved,
  onDirtyChange,
  onToast,
  onRegisterSaveHandler,
  onThemeModePreview,
  onColorSchemePreview,
  onLanguagePreview,
  onPrepareImportCategories,
  onImportedDataChanged,
}: SettingsPageProps) {
  const UI_TEXT = useLocaleText();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [languageSelectionPending, setLanguageSelectionPending] = useState(false);
  const languageSelectionPendingRef = useRef(false);
  const languageSelectionRevisionRef = useRef(0);
  const registerSaveHandler = useCallback((handler: (() => Promise<boolean>) | null) => {
    onRegisterSaveHandler?.(handler
      ? async () => languageSelectionPendingRef.current ? false : handler()
      : null);
  }, [onRegisterSaveHandler]);
  const importState = useSettingsImportState(
    onToast,
    onPrepareImportCategories,
    onImportedDataChanged,
  );
  const {
    dialogs,
    loading,
    loadError,
    retryLoading,
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
    onRegisterSaveHandler: registerSaveHandler,
  });
  const { showWebActivityHelp } = useWebActivitySetupState({
    savedSettings,
    draftSettings,
  });
  const handleLanguageChange = useCallback(async (nextLanguage: AppLanguage) => {
    if (languageSelectionPendingRef.current || draftSettings?.language === nextLanguage) return;
    const revision = ++languageSelectionRevisionRef.current;
    languageSelectionPendingRef.current = true;
    setLanguageSelectionPending(true);
    try {
      const result = await prepareSettingsLanguagePreview(nextLanguage);
      if (revision !== languageSelectionRevisionRef.current) return;
      if (result.ready) {
        handleChange("language", nextLanguage);
        return;
      }
      console.error(`[i18n] failed to prepare settings language ${nextLanguage}`, result.error);
      onToast?.(UI_TEXT.settings.languageLoadFailed, "error");
    } finally {
      if (revision === languageSelectionRevisionRef.current) {
        languageSelectionPendingRef.current = false;
        setLanguageSelectionPending(false);
      }
    }
  }, [draftSettings?.language, handleChange, onToast, UI_TEXT]);

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
    languageSelectionRevisionRef.current += 1;
    languageSelectionPendingRef.current = false;
    onThemeModePreview?.(null);
    onColorSchemePreview?.(null);
    onLanguagePreview?.(null);
  }, [onColorSchemePreview, onLanguagePreview, onThemeModePreview]);

  if (loading || !savedSettings || !draftSettings) {
    return (
      <div className="flex h-full min-w-0 flex-col gap-4 md:gap-5">
        <QuietPageHeader
          icon={<Settings2 size={18} />}
          title={UI_TEXT.settings.title}
          subtitle={UI_TEXT.settings.subtitle}
        />
        <div className="qp-panel flex flex-1 items-center justify-center gap-3 text-[var(--qp-text-tertiary)]">
          <span className="text-sm font-medium">
            {loadError ? UI_TEXT.settings.loadFailed : UI_TEXT.settings.loading}
          </span>
          {loadError ? (
            <QuietButton size="regular" onClick={() => { void retryLoading(); }}>
              {UI_TEXT.settings.retry}
            </QuietButton>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-button-preview flex h-full w-full min-w-0 flex-col gap-4 md:gap-5">
      {dialogs}
      <QuietPageHeader
        icon={<Settings2 size={18} />}
        title={UI_TEXT.settings.title}
        subtitle={UI_TEXT.settings.subtitle}
        rightSlot={(
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <div
              className={`qp-status ${
                saveStatus !== "saving" && hasUnsavedChanges ? "qp-status-danger" : ""
              } flex px-3 py-1.5 rounded-[8px] items-center text-xs font-semibold`}
            >
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
                <span>{UI_TEXT.settings.unsaved}</span>
              )}
              {saveStatus === "idle" && !hasUnsavedChanges && (
                <span className="text-[var(--qp-text-tertiary)]">{UI_TEXT.settings.idle}</span>
              )}
            </div>
            <QuietButton
              size="large"
              onClick={handleCancel}
              disabled={!hasUnsavedChanges || saveStatus === "saving" || languageSelectionPending}
              className="settings-header-button rounded-[8px]"
            >
              {UI_TEXT.settings.cancel}
            </QuietButton>
            <QuietButton
              tone="primary"
              size="large"
              onClick={() => void handleSave()}
              disabled={!hasUnsavedChanges || saveStatus === "saving" || languageSelectionPending}
              busy={saveStatus === "saving"}
              className="settings-header-button rounded-[8px]"
            >
              {saveStatus === "saving" ? UI_TEXT.settings.saving : UI_TEXT.settings.save}
            </QuietButton>
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
            titleRecordingEnabled={draftSettings.titleRecordingEnabled}
            onTitleRecordingEnabledChange={(nextChecked) => handleChange("titleRecordingEnabled", nextChecked)}
          />

          <SettingsAppearancePanel
            themeMode={draftSettings.themeMode}
            onThemeModeChange={(nextThemeMode) => handleChange("themeMode", nextThemeMode)}
            language={draftSettings.language}
            onLanguageChange={(nextLanguage) => { void handleLanguageChange(nextLanguage); }}
            languageDisabled={languageSelectionPending}
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
            onWebActivityEnabledChange={(nextChecked) => handleChange("webActivityEnabled", nextChecked)}
            onPortChange={(nextPort) => handleChange("webActivityPort", nextPort)}
            onWebActivityTokenChange={(nextToken) => handleChange("webActivityToken", nextToken)}
            onRemoteStatusBridgeEnabledChange={(nextChecked) => handleChange("remoteStatusBridgeEnabled", nextChecked)}
            onRemoteStatusBridgeUrlChange={(nextUrl) => handleChange("remoteStatusBridgeUrl", nextUrl)}
            onRemoteStatusBridgeTokenChange={(nextToken) => handleChange("remoteStatusBridgeToken", nextToken)}
          />

          <SettingsDataSafetyPanel
            cleanupRange={cleanupRange}
            cleanupOptions={cleanupOptions}
            restoreStrategy={restoreStrategy}
            isCleaning={isCleaning}
            isExportingBackup={isExportingBackup}
            isRestoringBackup={isRestoringBackup}
            onCleanupRangeChange={setCleanupRange}
            onRestoreStrategyChange={setRestoreStrategy}
            onCleanup={() => { void handleCleanup(); }}
            onExportBackup={() => void handleExportBackup()}
            onOpenDataExport={() => setExportDialogOpen(true)}
            onOpenDataImport={() => void importState.openDialog()}
            isImportBusy={importState.busy}
            onPrepareRestoreBackup={handlePrepareRestoreBackup}
            onRestoreBackup={() => { void handleRestoreBackup(); }}
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
            onOpenStorageDirectory={handleOpenStorageDirectory}
          />
        </div>
      </div>

      {exportDialogOpen ? (
        <Suspense fallback={null}>
          <SettingsDataExportDialog
            open
            onClose={() => setExportDialogOpen(false)}
            onToast={onToast}
          />
        </Suspense>
      ) : null}
      {importState.open ? (
        <Suspense fallback={null}>
          <SettingsDataImportDialog
            open
            view={importState.view}
            busy={importState.busy}
            preview={importState.preview}
            batches={importState.batches}
            onClose={importState.closeDialog}
            onChooseCanonicalCsv={() => void importState.chooseCanonicalCsv()}
            onConfirmImport={() => void importState.confirmImport()}
            onDestructureExternal={() => void importState.destructureExternal()}
            onShowBatches={importState.showBatches}
            onShowActions={importState.showActions}
            onRemoveBatch={(batchId) => void importState.removeBatch(batchId)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
