import { useLocaleText } from "../../../shared/i18n/index.ts";
import { Save, RefreshCw, Settings2, } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import type { SettingsPageProps } from "../types";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import QuietButton from "../../../shared/components/QuietButton";
import SettingsAppearancePanel from "./SettingsAppearancePanel";
import SettingsDataSafetyPanel from "./SettingsDataSafetyPanel";
import { useSettingsPageState } from "../hooks/useSettingsPageState";
import { useSettingsImportState } from "../hooks/useSettingsImportState.ts";

const SettingsDataExportDialog = lazy(() => import("./SettingsDataExportDialog.tsx"));
const SettingsDataImportDialog = lazy(() => import("./SettingsDataImportDialog.tsx"));

export default function Settings({
  onSettingsChanged,
  onDirtyChange,
  onToast,
  onRegisterSaveHandler,
  onPrepareImportCategories,
  onImportedDataChanged,
}: SettingsPageProps) {
  const UI_TEXT = useLocaleText();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
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
    cleanupOptions,
  } = useSettingsPageState({
    onSettingsChanged,
    onDirtyChange,
    onToast,
    onRegisterSaveHandler,
  });
  if (loading || !savedSettings || !draftSettings) {
    return (
      <div className="flex h-full min-w-0 flex-col gap-4 md:gap-5">
        <QuietPageHeader
          icon={<Settings2 size={18} />}
          title={UI_TEXT.settings.title}
        />
        <div className="qp-panel flex flex-1 items-center justify-center gap-3 text-[var(--qp-text-tertiary)]">
          <span className="qp-text-body qp-weight-medium">
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
        rightSlot={(
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <div
              className={`qp-status ${
                saveStatus !== "saving" && hasUnsavedChanges ? "qp-status-danger" : ""
              } flex px-3 py-1.5 rounded-[8px] items-center qp-text-caption qp-weight-emphasis`}
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
              disabled={!hasUnsavedChanges || saveStatus === "saving"}
              className="settings-header-button rounded-[8px]"
            >
              {UI_TEXT.settings.cancel}
            </QuietButton>
            <QuietButton
              tone="primary"
              size="large"
              onClick={() => void handleSave()}
              disabled={!hasUnsavedChanges || saveStatus === "saving"}
              busy={saveStatus === "saving"}
              className="settings-header-button rounded-[8px]"
            >
              {saveStatus === "saving" ? UI_TEXT.settings.saving : UI_TEXT.settings.save}
            </QuietButton>
          </div>
        )}
      />

      <div className="flex-1 overflow-y-auto qp-scroll-region pr-2">
        <div className="grid grid-cols-1 gap-4 md:gap-5">
          <SettingsAppearancePanel
            dynamicEffects={draftSettings.dynamicEffects}
            onDynamicEffectsChange={(nextChecked) => handleChange("dynamicEffects", nextChecked)}
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
