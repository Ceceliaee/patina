import { useRef, useState, type ReactNode } from "react";
import {
  BrushCleaning,
  Database,
  FolderPen,
  FileArchive,
  FileDown,
  FileUp,
  FolderOpen,
  CircleAlert,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import QuietBadge from "../../../shared/components/QuietBadge";
import QuietSubpanel from "../../../shared/components/QuietSubpanel";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietButton from "../../../shared/components/QuietButton";
import QuietIconAction from "../../../shared/components/QuietIconAction";
import QuietTooltip from "../../../shared/components/QuietTooltip";
import type { CleanupRange } from "../types";
import type { BackupRestoreStrategy } from "../services/settingsRuntimeAdapterService.ts";
import type { StorageSnapshot } from "../services/settingsRuntimeAdapterService.ts";
import type { RemoteBackupEntry, RemoteBackupState } from "../hooks/useRemoteBackupState.ts";
import SettingsRemoteBackupPanel from "./SettingsRemoteBackupPanel";
import QuietStepperSlider from "../../../shared/components/QuietStepperSlider.tsx";
import SettingsPanelHeader from "./SettingsPanelHeader";
import { toEbwebviewCachePath } from "../services/storagePathDisplay.ts";

type CleanupOption = { value: CleanupRange; label: string };

type SettingsDataSafetyPanelProps = {
  cleanupRange: CleanupRange;
  cleanupOptions: CleanupOption[];
  restoreStrategy: BackupRestoreStrategy;
  isCleaning: boolean;
  isExportingBackup: boolean;
  isRestoringBackup: boolean;
  onCleanupRangeChange: (value: CleanupRange) => void;
  onRestoreStrategyChange: (value: BackupRestoreStrategy) => void;
  onCleanup: () => void;
  onExportBackup: () => void;
  onPrepareRestoreBackup: () => Promise<boolean | void>;
  onRestoreBackup: (restoreStrategy: BackupRestoreStrategy) => void;
  onClearPendingRestoreBackup: () => void;
  onOpenDataExport: () => void;
  onOpenDataImport: () => void;
  isImportBusy: boolean;
  remoteBackup: RemoteBackupState;
  storageSnapshot: StorageSnapshot | null;
  isStorageBusy: boolean;
  onRefreshStorageSnapshot: () => Promise<void> | void;
  onScheduleWebviewCacheClear: () => Promise<void> | void;
  onChooseDataDirectory: () => Promise<void> | void;
  onChooseCacheDirectory: () => Promise<void> | void;
  onRestoreDefaultDataDirectory: () => Promise<void> | void;
  onRestoreDefaultCacheDirectory: () => Promise<void> | void;
  onOpenStorageDirectory: (path: string) => Promise<void> | void;
};

function formatDirectorySize(bytes: number): string {
  return `${Math.max(0, Math.round(bytes / 1048576))} MB`;
}

function StoragePathRow({
  title,
  meta,
  onOpen,
  onChangePath,
  onRestoreDefault,
  extraActions,
  changeDisabled,
  restoreDisabled,
}: {
  title: string;
  meta?: string;
  onOpen: () => void;
  onChangePath?: () => void;
  onRestoreDefault?: () => void;
  extraActions?: ReactNode;
  changeDisabled?: boolean;
  restoreDisabled?: boolean;
}) {
  const storageText = UI_TEXT.settings.storage;
  return (
    <div className="settings-storage-path-row">
      <div className="min-w-0">
        <div className="settings-storage-path-heading">
          <p>{title}</p>
          {meta ? <span>{meta}</span> : null}
        </div>
      </div>
      <div className="settings-storage-path-actions">
        {extraActions}
        <QuietIconAction
          icon={<FolderOpen size={14} />}
          title={storageText.openDirectoryAction}
          onClick={onOpen}
        />
        {onChangePath ? (
          <QuietIconAction
            icon={<FolderPen size={14} />}
            title={storageText.changePathAction}
            disabled={changeDisabled}
            onClick={onChangePath}
          />
        ) : null}
        {onRestoreDefault ? (
          <QuietIconAction
            icon={<RotateCcw size={14} />}
            title={storageText.restoreDefaultPathAction}
            disabled={restoreDisabled}
            onClick={onRestoreDefault}
          />
        ) : null}
      </div>
    </div>
  );
}

type StoragePathPlaceholderAction = {
  icon: ReactNode;
  title: string;
};

function StoragePathPlaceholderRow({
  title,
  actions,
}: {
  title: string;
  actions: StoragePathPlaceholderAction[];
}) {
  return (
    <div className="settings-storage-path-row settings-storage-path-row-placeholder">
      <div className="min-w-0">
        <div className="settings-storage-path-heading">
          <p>{title}</p>
          <span className="settings-storage-path-placeholder-meta" aria-hidden="true" />
        </div>
      </div>
      <div className="settings-storage-path-actions">
        {actions.map((action, index) => (
          <QuietIconAction
            key={`${action.title}-${index}`}
            icon={action.icon}
            title={action.title}
            disabled
            showTooltip={false}
          />
        ))}
      </div>
    </div>
  );
}

export default function SettingsDataSafetyPanel({
  cleanupRange,
  cleanupOptions,
  restoreStrategy,
  isCleaning,
  isExportingBackup,
  isRestoringBackup,
  onCleanupRangeChange,
  onRestoreStrategyChange,
  onCleanup,
  onExportBackup,
  onPrepareRestoreBackup,
  onRestoreBackup,
  onClearPendingRestoreBackup,
  onOpenDataExport,
  onOpenDataImport,
  isImportBusy,
  remoteBackup,
  storageSnapshot,
  isStorageBusy,
  onRefreshStorageSnapshot,
  onScheduleWebviewCacheClear,
  onChooseDataDirectory,
  onChooseCacheDirectory,
  onRestoreDefaultDataDirectory,
  onRestoreDefaultCacheDirectory,
  onOpenStorageDirectory,
}: SettingsDataSafetyPanelProps) {
  const cacheClearCancelRef = useRef<HTMLButtonElement>(null);
  const localBackupRef = useRef<HTMLButtonElement>(null);
  const localRestoreRef = useRef<HTMLButtonElement>(null);
  const selectedRestoreStrategyRef = useRef<HTMLButtonElement>(null);
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false);
  const [restoreStrategySource, setRestoreStrategySource] = useState<"local" | "remote">("local");
  const [pendingRemoteRestoreEntry, setPendingRemoteRestoreEntry] = useState<RemoteBackupEntry | null>(null);
  const [backupTargetDialogOpen, setBackupTargetDialogOpen] = useState(false);
  const [restoreSourceDialogOpen, setRestoreSourceDialogOpen] = useState(false);
  const [cacheClearDialogOpen, setCacheClearDialogOpen] = useState(false);
  const [historyCleanupDialogOpen, setHistoryCleanupDialogOpen] = useState(false);
  const hasRemoteBackupTarget = Boolean(remoteBackup.config && remoteBackup.hasSecret);
  const restoreStrategyOptions: Array<{ value: BackupRestoreStrategy; label: string; tooltip: string }> = [
    {
      value: "merge",
      label: UI_TEXT.settings.restoreStrategyOptions.merge,
      tooltip: UI_TEXT.settings.restoreStrategyOptionHints.merge,
    },
    {
      value: "replace",
      label: UI_TEXT.settings.restoreStrategyOptions.replace,
      tooltip: UI_TEXT.settings.restoreStrategyOptionHints.replace,
    },
  ];
  const busy = isExportingBackup
    || isRestoringBackup
    || isStorageBusy
    || remoteBackup.isUploading
    || remoteBackup.isListing
    || remoteBackup.isDownloading
    || isImportBusy;
  const webviewCache = storageSnapshot?.webviewCache;
  const webviewCachePath = webviewCache?.ebwebviewPath
    ?? (storageSnapshot ? toEbwebviewCachePath(storageSnapshot.paths.webviewRoot) : "");
  const storageText = UI_TEXT.settings.storage;
  const installRootSizeText = formatDirectorySize(storageSnapshot?.sizes.installDirSizeBytes ?? 0);
  const dataRootSizeText = formatDirectorySize(storageSnapshot?.sizes.dataSizeBytes ?? 0);
  const cacheRootSizeText = formatDirectorySize(webviewCache?.totalSizeBytes ?? 0);
  const isCustomDataRoot = Boolean(storageSnapshot?.paths.isCustomDataRoot);
  const isCustomWebviewRoot = Boolean(storageSnapshot?.paths.isCustomWebviewRoot);
  const cleanupSliderOptions = [...cleanupOptions].sort((left, right) => left.value - right.value);
  const cleanupRangeIndex = Math.max(
    0,
    cleanupSliderOptions.findIndex((option) => option.value === cleanupRange),
  );
  const selectedCleanupOption = cleanupSliderOptions[cleanupRangeIndex] ?? cleanupOptions[0];
  const updateCleanupRangeIndex = (nextIndex: number) => {
    const nextOption = cleanupSliderOptions[nextIndex];
    if (nextOption) {
      onCleanupRangeChange(nextOption.value);
    }
  };

  const handleBackupAction = () => {
    if (hasRemoteBackupTarget) {
      setBackupTargetDialogOpen(true);
      return;
    }
    onExportBackup();
  };

  const handleRestoreAction = () => {
    if (hasRemoteBackupTarget) {
      setRestoreSourceDialogOpen(true);
      return;
    }
    void prepareLocalRestore();
  };

  const prepareLocalRestore = async () => {
    setRestoreStrategySource("local");
    setPendingRemoteRestoreEntry(null);
    const prepared = await onPrepareRestoreBackup();
    if (prepared) {
      setStrategyDialogOpen(true);
    }
  };

  const openRemoteRestoreList = async () => {
    setRestoreStrategySource("remote");
    setPendingRemoteRestoreEntry(null);
    await remoteBackup.openRestoreDialog();
  };

  const handleRemoteRestoreEntrySelected = (entry: RemoteBackupEntry) => {
    remoteBackup.closeRestoreDialog();
    setRestoreStrategySource("remote");
    setPendingRemoteRestoreEntry(entry);
    setStrategyDialogOpen(true);
  };

  const confirmRestoreStrategy = () => {
    setStrategyDialogOpen(false);
    if (restoreStrategySource === "remote") {
      if (pendingRemoteRestoreEntry) {
        void remoteBackup.restoreEntry(pendingRemoteRestoreEntry, restoreStrategy);
      }
      setPendingRemoteRestoreEntry(null);
      return;
    }
    onRestoreBackup(restoreStrategy);
  };

  const closeStrategyDialog = () => {
    setStrategyDialogOpen(false);
    setPendingRemoteRestoreEntry(null);
    onClearPendingRestoreBackup();
  };

  const restartAndClearWebviewCacheFromDialog = () => {
    setCacheClearDialogOpen(false);
    void onScheduleWebviewCacheClear();
  };

  const cleanupHistoryFromDialog = () => {
    setHistoryCleanupDialogOpen(false);
    onCleanup();
  };


  return (
    <>
      <section className="qp-panel p-5 md:p-6">
        <SettingsPanelHeader
          icon={<Database size={16} className="text-[var(--qp-accent-default)]" />}
          title={UI_TEXT.settings.dataSafetyTitle}
          className="mb-5"
        />

        <div className="space-y-5">
          <QuietSubpanel>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--qp-text-primary)]">
                <span>{UI_TEXT.settings.dataExportTitle}</span>
                <QuietBadge variant="beta">{UI_TEXT.settings.betaLabel}</QuietBadge>
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--qp-text-secondary)]">
                {UI_TEXT.settings.dataExportHint}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <QuietActionRow>
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <FileUp size={14} className="text-[var(--qp-text-tertiary)]" />
                      <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.dataExportAction}</p>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">{UI_TEXT.settings.dataExportActionHint}</p>
                  </div>
                  <QuietButton size="regular" onClick={onOpenDataExport} disabled={busy}>
                    {UI_TEXT.settings.dataExportAction}
                  </QuietButton>
                </div>
              </QuietActionRow>
              <QuietActionRow>
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <FileDown size={14} className="text-[var(--qp-text-tertiary)]" />
                      <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.dataImportAction}</p>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">{UI_TEXT.settings.dataImportActionHint}</p>
                  </div>
                  <QuietButton size="regular" onClick={onOpenDataImport} disabled={busy}>
                    {UI_TEXT.settings.dataImportAction}
                  </QuietButton>
                </div>
              </QuietActionRow>
            </div>
          </QuietSubpanel>

          <QuietSubpanel>
            <div>
              <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.backupRestoreTitle}</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--qp-text-secondary)]">
                {UI_TEXT.settings.backupRestoreHint}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <QuietActionRow>
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <FileArchive size={14} className="text-[var(--qp-text-tertiary)]" />
                      <p className="text-sm font-semibold text-[var(--qp-text-primary)]">
                        {UI_TEXT.settings.backupExportTitle}
                      </p>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">
                      {UI_TEXT.settings.backupExportHint}
                    </p>
                  </div>
                  <QuietButton
                    size="regular"
                    onClick={handleBackupAction}
                    disabled={busy}
                    busy={isExportingBackup || remoteBackup.isUploading}
                    className="shrink-0 rounded-[8px] text-[var(--qp-text-secondary)]"
                  >
                    {isExportingBackup || remoteBackup.isUploading ? UI_TEXT.settings.backupExporting : UI_TEXT.settings.backupExportAction}
                  </QuietButton>
                </div>
              </QuietActionRow>

              <QuietActionRow>
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <RotateCcw size={14} className="text-[var(--qp-text-tertiary)]" />
                      <p className="text-sm font-semibold text-[var(--qp-text-primary)]">
                        {UI_TEXT.settings.backupRestoreActionTitle}
                      </p>
                      <QuietTooltip
                        label={UI_TEXT.settings.backupRestoreActionHelp}
                        placement="top"
                        tooltipClassName="settings-restore-help-tooltip"
                      >
                        <button
                          type="button"
                          className="settings-restore-help"
                          aria-label={UI_TEXT.settings.backupRestoreActionHelp}
                        >
                          <CircleAlert size={13} aria-hidden="true" />
                        </button>
                      </QuietTooltip>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">
                      {UI_TEXT.settings.backupRestoreActionHint}
                    </p>
                  </div>
                  <QuietButton
                    size="regular"
                    onClick={handleRestoreAction}
                    disabled={busy}
                    busy={isRestoringBackup || remoteBackup.isListing || remoteBackup.isDownloading}
                    className="shrink-0 rounded-[8px] text-[var(--qp-text-secondary)]"
                  >
                    {isRestoringBackup || remoteBackup.isListing || remoteBackup.isDownloading ? UI_TEXT.settings.backupRestoring : UI_TEXT.settings.backupRestoreAction}
                  </QuietButton>
                </div>
              </QuietActionRow>
            </div>

            <SettingsRemoteBackupPanel
              remoteBackup={remoteBackup}
              onRestoreEntrySelected={handleRemoteRestoreEntrySelected}
            />
          </QuietSubpanel>

          <QuietSubpanel className="settings-local-paths-panel">
            <div className="settings-local-paths-header">
              <div className="settings-local-paths-copy">
                <p className="settings-local-paths-title">
                  <span>{storageText.storageDirectoryTitle}</span>
                  <QuietBadge variant="beta">{storageText.storageDirectoryBetaLabel}</QuietBadge>
                </p>
                <p className="mt-1 text-sm leading-relaxed text-[var(--qp-text-secondary)]">{storageText.storageDirectorySummary}</p>
              </div>
              <div className="settings-local-paths-actions">
                <QuietIconAction
                  icon={<RefreshCw size={14} className={isStorageBusy ? "animate-spin" : undefined} />}
                  title={storageText.storageSnapshotRefreshAction}
                  disabled={busy}
                  onClick={() => void onRefreshStorageSnapshot()}
                />
              </div>
            </div>

            <div className="settings-storage-path-list" aria-busy={isStorageBusy}>
              {storageSnapshot ? (
                <>
                  <StoragePathRow
                    title={storageText.installDirectoryLabel}
                    meta={installRootSizeText}
                    onOpen={() => void onOpenStorageDirectory(storageSnapshot.paths.installDir)}
                  />
                  <StoragePathRow
                    title={storageText.webviewCacheDirectoryLabel}
                    meta={cacheRootSizeText}
                    extraActions={(
                      <QuietIconAction
                        icon={<BrushCleaning size={14} />}
                        title={storageText.webviewCacheClearTitle}
                        disabled={busy}
                        onClick={() => setCacheClearDialogOpen(true)}
                      />
                    )}
                    onChangePath={!isCustomWebviewRoot ? () => void onChooseCacheDirectory() : undefined}
                    onRestoreDefault={isCustomWebviewRoot ? () => void onRestoreDefaultCacheDirectory() : undefined}
                    changeDisabled={busy}
                    restoreDisabled={busy}
                    onOpen={() => void onOpenStorageDirectory(webviewCachePath)}
                  />
                  <StoragePathRow
                    title={storageText.dataDirectoryLabel}
                    meta={dataRootSizeText}
                    extraActions={(
                      <QuietIconAction
                        icon={<Trash2 size={14} />}
                        title={UI_TEXT.settings.cleanupTitle}
                        tone="danger"
                        disabled={busy || isCleaning}
                        onClick={() => setHistoryCleanupDialogOpen(true)}
                      />
                    )}
                    onChangePath={!isCustomDataRoot ? () => void onChooseDataDirectory() : undefined}
                    onRestoreDefault={isCustomDataRoot ? () => void onRestoreDefaultDataDirectory() : undefined}
                    changeDisabled={busy}
                    restoreDisabled={busy}
                    onOpen={() => void onOpenStorageDirectory(storageSnapshot.paths.dataRoot)}
                  />
                </>
              ) : (
                <>
                  <StoragePathPlaceholderRow
                    title={storageText.installDirectoryLabel}
                    actions={[
                      { icon: <FolderOpen size={14} />, title: storageText.openDirectoryAction },
                    ]}
                  />
                  <StoragePathPlaceholderRow
                    title={storageText.webviewCacheDirectoryLabel}
                    actions={[
                      { icon: <BrushCleaning size={14} />, title: storageText.webviewCacheClearTitle },
                      { icon: <FolderOpen size={14} />, title: storageText.openDirectoryAction },
                      { icon: <FolderPen size={14} />, title: storageText.changePathAction },
                    ]}
                  />
                  <StoragePathPlaceholderRow
                    title={storageText.dataDirectoryLabel}
                    actions={[
                      { icon: <Trash2 size={14} />, title: UI_TEXT.settings.cleanupTitle },
                      { icon: <FolderOpen size={14} />, title: storageText.openDirectoryAction },
                      { icon: <FolderPen size={14} />, title: storageText.changePathAction },
                    ]}
                  />
                </>
              )}
            </div>

          </QuietSubpanel>
        </div>
      </section>

      <QuietDialog
        open={historyCleanupDialogOpen}
        title={UI_TEXT.settings.cleanupTitle}
        description={UI_TEXT.settings.cleanupHint}
        onClose={() => setHistoryCleanupDialogOpen(false)}
        closeOnBackdrop={!isCleaning}
        surfaceClassName="settings-history-cleanup-dialog"
        actions={(
          <>
            <QuietButton
              size="large"
              onClick={() => setHistoryCleanupDialogOpen(false)}
              disabled={isCleaning}
            >
              {UI_TEXT.common.cancel}
            </QuietButton>
            <QuietButton
              tone="danger"
              size="large"
              onClick={cleanupHistoryFromDialog}
              disabled={isCleaning}
            >
              {isCleaning ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {isCleaning ? UI_TEXT.settings.cleanupRunning : UI_TEXT.settings.cleanupNow}
            </QuietButton>
          </>
        )}
      >
        <div className="settings-history-cleanup-range">
          <span>{UI_TEXT.settings.cleanupRangeLabel}</span>
          <QuietStepperSlider
            ariaLabel={UI_TEXT.settings.cleanupRangeLabel}
            value={cleanupRangeIndex}
            min={0}
            max={Math.max(0, cleanupSliderOptions.length - 1)}
            displayValue={selectedCleanupOption?.label ?? UI_TEXT.settings.cleanupRangeLabels[cleanupRange]}
            decreaseAriaLabel={UI_TEXT.settings.decreaseCleanupRange}
            increaseAriaLabel={UI_TEXT.settings.increaseCleanupRange}
            className="settings-history-cleanup-slider"
            onChange={updateCleanupRangeIndex}
          />
        </div>
      </QuietDialog>

      <QuietDialog
        open={cacheClearDialogOpen}
        title={storageText.webviewCacheClearConfirmTitle}
        description={storageText.webviewCacheClearConfirmDetail}
        onClose={() => setCacheClearDialogOpen(false)}
        closeOnBackdrop={!busy}
        initialFocusRef={cacheClearCancelRef}
        actions={(
          <>
            <QuietButton
              ref={cacheClearCancelRef}
              size="large"
              onClick={() => setCacheClearDialogOpen(false)}
              disabled={busy}
              className="rounded-[8px]"
            >
              {UI_TEXT.common.cancel}
            </QuietButton>
            <QuietButton
              tone="primary"
              size="large"
              onClick={restartAndClearWebviewCacheFromDialog}
              disabled={busy}
              className="rounded-[8px]"
            >
              {storageText.restartAndApplyAction}
            </QuietButton>
          </>
        )}
      />

      <QuietDialog
        open={backupTargetDialogOpen}
        title={UI_TEXT.settings.backupTargetTitle}
        description={UI_TEXT.settings.backupTargetHint}
        onClose={() => setBackupTargetDialogOpen(false)}
        closeOnBackdrop={!busy}
        initialFocusRef={localBackupRef}
        surfaceClassName="settings-data-action-dialog"
        headerAside={(
          <div className="settings-dialog-header-actions">
            <button
              type="button"
              className="qp-dialog-close-button"
              aria-label={UI_TEXT.common.close}
              disabled={busy}
              onClick={() => setBackupTargetDialogOpen(false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <QuietActionRow className="settings-dialog-action-card">
            <button
              ref={localBackupRef}
              type="button"
              onClick={() => {
                setBackupTargetDialogOpen(false);
                onExportBackup();
              }}
              disabled={busy}
              className="settings-dialog-action-trigger"
            >
              <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.backupTargetLocalTitle}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">{UI_TEXT.settings.backupTargetLocalHint}</p>
            </button>
          </QuietActionRow>
          <QuietActionRow className="settings-dialog-action-card">
            <button
              type="button"
              onClick={() => {
                setBackupTargetDialogOpen(false);
                void remoteBackup.uploadBackup();
              }}
              disabled={busy}
              className="settings-dialog-action-trigger"
            >
              <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.backupTargetRemoteTitle}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">{UI_TEXT.settings.backupTargetRemoteHint}</p>
            </button>
          </QuietActionRow>
        </div>
      </QuietDialog>

      <QuietDialog
        open={restoreSourceDialogOpen}
        title={UI_TEXT.settings.restoreSourceTitle}
        description={UI_TEXT.settings.restoreSourceHint}
        onClose={() => setRestoreSourceDialogOpen(false)}
        closeOnBackdrop={!busy}
        initialFocusRef={localRestoreRef}
        surfaceClassName="settings-data-action-dialog"
        headerAside={(
          <div className="settings-dialog-header-actions">
            <button
              type="button"
              className="qp-dialog-close-button"
              aria-label={UI_TEXT.common.close}
              disabled={busy}
              onClick={() => setRestoreSourceDialogOpen(false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <QuietActionRow className="settings-dialog-action-card">
            <button
              ref={localRestoreRef}
              type="button"
              onClick={() => {
                setRestoreSourceDialogOpen(false);
                void prepareLocalRestore();
              }}
              disabled={busy}
              className="settings-dialog-action-trigger"
            >
              <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.restoreSourceLocalTitle}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">{UI_TEXT.settings.restoreSourceLocalHint}</p>
            </button>
          </QuietActionRow>
          <QuietActionRow className="settings-dialog-action-card">
            <button
              type="button"
              onClick={() => {
                setRestoreSourceDialogOpen(false);
                void openRemoteRestoreList();
              }}
              disabled={busy}
              className="settings-dialog-action-trigger"
            >
              <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.restoreSourceRemoteTitle}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">{UI_TEXT.settings.restoreSourceRemoteHint}</p>
            </button>
          </QuietActionRow>
        </div>
      </QuietDialog>

      <QuietDialog
        open={strategyDialogOpen}
        title={UI_TEXT.settings.restoreStrategyLabel}
        description={UI_TEXT.settings.restoreStrategyHint}
        onClose={closeStrategyDialog}
        closeOnBackdrop={!isRestoringBackup}
        initialFocusRef={selectedRestoreStrategyRef}
        actions={(
          <>
            <QuietButton
              size="large"
              onClick={closeStrategyDialog}
              disabled={isRestoringBackup}
              className="rounded-[8px]"
            >
              {UI_TEXT.common.cancel}
            </QuietButton>
            <QuietButton
              tone="primary"
              size="large"
              onClick={() => {
                confirmRestoreStrategy();
              }}
              disabled={busy}
              busy={isRestoringBackup || remoteBackup.isListing}
              className="rounded-[8px]"
            >
              {isRestoringBackup || remoteBackup.isListing ? UI_TEXT.settings.backupRestoring : UI_TEXT.settings.backupRestoreAction}
            </QuietButton>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <QuietSegmentedFilter
            value={restoreStrategy}
            options={restoreStrategyOptions}
            onChange={onRestoreStrategyChange}
            selectedOptionRef={selectedRestoreStrategyRef}
            className="self-start"
          />
        </div>
      </QuietDialog>
    </>
  );
}
