import { useState, type ReactNode } from "react";
import {
  BrushCleaning,
  FolderPen,
  FileArchive,
  FolderOpen,
  MessageCircleWarning,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import QuietDangerAction from "../../../shared/components/QuietDangerAction";
import QuietSubpanel from "../../../shared/components/QuietSubpanel";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietIconAction from "../../../shared/components/QuietIconAction";
import type { CleanupRange } from "../../settings/types";
import type { BackupRestoreStrategy } from "../../settings/services/settingsRuntimeAdapterService.ts";
import type { StorageSnapshot } from "../../settings/services/settingsRuntimeAdapterService.ts";
import type { RemoteBackupEntry, RemoteBackupState } from "../../settings/hooks/useRemoteBackupState.ts";
import SettingsRemoteBackupPanel from "../../settings/components/SettingsRemoteBackupPanel";
import SettingsStepperSlider from "../../settings/components/SettingsStepperSlider";
import { toEbwebviewCachePath } from "../../settings/services/storagePathDisplay.ts";

type CleanupOption = { value: CleanupRange; label: string };

type StorageToolPanelProps = {
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
  remoteBackup: RemoteBackupState;
  storageSnapshot: StorageSnapshot | null;
  isStorageBusy: boolean;
  onRefreshStorageSnapshot: () => Promise<void> | void;
  onScheduleWebviewCacheClear: () => Promise<void> | void;
  onChooseDataDirectory: () => Promise<void> | void;
  onChooseCacheDirectory: () => Promise<void> | void;
  onRestoreDefaultDataDirectory: () => Promise<void> | void;
  onRestoreDefaultCacheDirectory: () => Promise<void> | void;
  onCancelPendingStorageMigration: () => Promise<void> | void;
  onOpenStorageDirectory: (path: string) => Promise<void> | void;
};

function formatDirectorySize(bytes: number): string {
  return `${Math.max(0, Math.round(bytes / 1048576))} MB`;
}

function normalizeStoragePathKey(path: string): string {
  return path.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

function sameStoragePath(left: string, right: string): boolean {
  return normalizeStoragePathKey(left) === normalizeStoragePathKey(right);
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

export default function StorageToolPanel({
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
  remoteBackup,
  storageSnapshot,
  isStorageBusy,
  onRefreshStorageSnapshot,
  onScheduleWebviewCacheClear,
  onChooseDataDirectory,
  onChooseCacheDirectory,
  onRestoreDefaultDataDirectory,
  onRestoreDefaultCacheDirectory,
  onCancelPendingStorageMigration,
  onOpenStorageDirectory,
}: StorageToolPanelProps) {
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false);
  const [restoreStrategySource, setRestoreStrategySource] = useState<"local" | "remote">("local");
  const [pendingRemoteRestoreEntry, setPendingRemoteRestoreEntry] = useState<RemoteBackupEntry | null>(null);
  const [backupTargetDialogOpen, setBackupTargetDialogOpen] = useState(false);
  const [restoreSourceDialogOpen, setRestoreSourceDialogOpen] = useState(false);
  const [cacheClearDialogOpen, setCacheClearDialogOpen] = useState(false);
  const [historyCleanupDialogOpen, setHistoryCleanupDialogOpen] = useState(false);
  const [migrationStatusDialogOpen, setMigrationStatusDialogOpen] = useState(false);
  const hasRemoteBackupTarget = Boolean(remoteBackup.config && remoteBackup.hasSecret);
  const restoreStrategyOptions: Array<{ value: BackupRestoreStrategy; label: string }> = [
    { value: "merge", label: UI_TEXT.settings.restoreStrategyOptions.merge },
    { value: "replace", label: UI_TEXT.settings.restoreStrategyOptions.replace },
  ];
  const busy = isExportingBackup
    || isRestoringBackup
    || isStorageBusy
    || remoteBackup.isUploading
    || remoteBackup.isListing
    || remoteBackup.isDownloading;
  const webviewCache = storageSnapshot?.webviewCache;
  const webviewCachePath = webviewCache?.ebwebviewPath
    ?? (storageSnapshot ? toEbwebviewCachePath(storageSnapshot.paths.webviewRoot) : "");
  const storageText = UI_TEXT.settings.storage;
  const installRootSizeText = formatDirectorySize(storageSnapshot?.sizes.installDirSizeBytes ?? 0);
  const dataRootSizeText = formatDirectorySize(storageSnapshot?.sizes.dataSizeBytes ?? 0);
  const cacheRootSizeText = formatDirectorySize(webviewCache?.totalSizeBytes ?? 0);
  const isCustomDataRoot = Boolean(storageSnapshot?.paths.isCustomDataRoot);
  const isCustomWebviewRoot = Boolean(storageSnapshot?.paths.isCustomWebviewRoot);
  const pendingMigration = storageSnapshot?.pendingMigration ?? null;
  const pendingTargetDataRoot = pendingMigration && !sameStoragePath(
    pendingMigration.sourceDataRoot,
    pendingMigration.targetDataRoot,
  )
    ? pendingMigration.targetDataRoot
    : null;
  const pendingTargetWebviewRoot = pendingMigration && storageSnapshot && !sameStoragePath(
    storageSnapshot.paths.webviewRoot,
    pendingMigration.targetWebviewRoot,
  )
    ? toEbwebviewCachePath(pendingMigration.targetWebviewRoot)
    : null;
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

  const scheduleWebviewCacheClearFromDialog = () => {
    setCacheClearDialogOpen(false);
    void onScheduleWebviewCacheClear();
  };

  const cleanupHistoryFromDialog = () => {
    setHistoryCleanupDialogOpen(false);
    onCleanup();
  };

  const cancelPendingStorageMigrationFromDialog = () => {
    setMigrationStatusDialogOpen(false);
    void onCancelPendingStorageMigration();
  };

  return (
    <>
      <div className="space-y-5">
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
                <button
                  type="button"
                  onClick={handleBackupAction}
                  disabled={busy}
                  className="qp-button-secondary h-8 shrink-0 rounded-[8px] px-3 text-xs font-semibold text-[var(--qp-text-secondary)] disabled:opacity-50"
                >
                  {isExportingBackup || remoteBackup.isUploading ? UI_TEXT.settings.backupExporting : UI_TEXT.settings.backupExportAction}
                </button>
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
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">
                    {UI_TEXT.settings.backupRestoreActionHint}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRestoreAction}
                  disabled={busy}
                  className="qp-button-secondary h-8 shrink-0 rounded-[8px] px-3 text-xs font-semibold text-[var(--qp-text-secondary)] disabled:opacity-50"
                >
                  {isRestoringBackup || remoteBackup.isListing || remoteBackup.isDownloading ? UI_TEXT.settings.backupRestoring : UI_TEXT.settings.backupRestoreAction}
                </button>
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
                <span className="settings-local-paths-beta">{storageText.storageDirectoryBetaLabel}</span>
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--qp-text-secondary)]">{storageText.storageDirectorySummary}</p>
            </div>
            {pendingMigration ? (
              <div className="settings-local-paths-actions">
                <QuietIconAction
                  icon={<MessageCircleWarning size={14} />}
                  title={storageText.storageMigrationPendingTitle}
                  pressed={migrationStatusDialogOpen}
                  className="settings-local-paths-message-action"
                  onClick={() => setMigrationStatusDialogOpen(true)}
                />
              </div>
            ) : null}
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
                      title={webviewCache?.pendingClear ? storageText.webviewCacheClearPending : storageText.webviewCacheClearTitle}
                      disabled={busy || webviewCache?.pendingClear}
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

      <QuietDialog
        open={migrationStatusDialogOpen && Boolean(pendingMigration)}
        title={storageText.storageMigrationPendingTitle}
        description={storageText.storageMigrationPendingHint(
          pendingTargetDataRoot,
          pendingTargetWebviewRoot,
        )}
        onClose={() => setMigrationStatusDialogOpen(false)}
        closeOnBackdrop={!busy}
        actions={(
          <>
            <button
              type="button"
              onClick={() => setMigrationStatusDialogOpen(false)}
              disabled={busy}
              className="qp-button-secondary h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold leading-none disabled:opacity-50"
            >
              {UI_TEXT.common.close}
            </button>
            <button
              type="button"
              onClick={cancelPendingStorageMigrationFromDialog}
              disabled={busy}
              className="qp-button-secondary h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold leading-none text-[var(--qp-text-secondary)] disabled:opacity-50"
            >
              {storageText.storageMigrationCancelAction}
            </button>
          </>
        )}
      />

      <QuietDialog
        open={historyCleanupDialogOpen}
        title={UI_TEXT.settings.cleanupTitle}
        description={UI_TEXT.settings.cleanupHint}
        onClose={() => setHistoryCleanupDialogOpen(false)}
        closeOnBackdrop={!isCleaning}
        surfaceClassName="settings-history-cleanup-dialog"
        actions={(
          <>
            <button
              type="button"
              onClick={() => setHistoryCleanupDialogOpen(false)}
              disabled={isCleaning}
              className="qp-button-secondary h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold leading-none disabled:opacity-50"
            >
              {UI_TEXT.common.cancel}
            </button>
            <QuietDangerAction
              onClick={cleanupHistoryFromDialog}
              disabled={isCleaning}
              leadingIcon={isCleaning ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
              className="h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold leading-none"
            >
              {isCleaning ? UI_TEXT.settings.cleanupRunning : UI_TEXT.settings.cleanupNow}
            </QuietDangerAction>
          </>
        )}
      >
        <div className="settings-history-cleanup-range">
          <span>{UI_TEXT.settings.cleanupRangeLabel}</span>
          <SettingsStepperSlider
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
        actions={(
          <>
            <button
              type="button"
              onClick={() => setCacheClearDialogOpen(false)}
              disabled={busy}
              className="qp-button-secondary h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold leading-none disabled:opacity-50"
            >
              {UI_TEXT.common.cancel}
            </button>
            <button
              type="button"
              onClick={scheduleWebviewCacheClearFromDialog}
              disabled={busy || webviewCache?.pendingClear}
              className="qp-button-primary h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold leading-none disabled:opacity-50"
            >
              {storageText.webviewCacheClearAction}
            </button>
          </>
        )}
      />

      <QuietDialog
        open={backupTargetDialogOpen}
        title={UI_TEXT.settings.backupTargetTitle}
        description={UI_TEXT.settings.backupTargetHint}
        onClose={() => setBackupTargetDialogOpen(false)}
        closeOnBackdrop={!busy}
        actions={(
          <button
            type="button"
            onClick={() => setBackupTargetDialogOpen(false)}
            disabled={busy}
            className="qp-button-secondary h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold leading-none disabled:opacity-50"
          >
            {UI_TEXT.common.cancel}
          </button>
        )}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <QuietActionRow>
            <button
              type="button"
              onClick={() => {
                setBackupTargetDialogOpen(false);
                onExportBackup();
              }}
              disabled={busy}
              className="block w-full border-0 bg-transparent p-0 text-left disabled:opacity-50"
            >
              <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.backupTargetLocalTitle}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">{UI_TEXT.settings.backupTargetLocalHint}</p>
            </button>
          </QuietActionRow>
          <QuietActionRow>
            <button
              type="button"
              onClick={() => {
                setBackupTargetDialogOpen(false);
                void remoteBackup.uploadBackup();
              }}
              disabled={busy}
              className="block w-full border-0 bg-transparent p-0 text-left disabled:opacity-50"
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
        actions={(
          <button
            type="button"
            onClick={() => setRestoreSourceDialogOpen(false)}
            disabled={busy}
            className="qp-button-secondary h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold leading-none disabled:opacity-50"
          >
            {UI_TEXT.common.cancel}
          </button>
        )}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <QuietActionRow>
            <button
              type="button"
              onClick={() => {
                setRestoreSourceDialogOpen(false);
                void prepareLocalRestore();
              }}
              disabled={busy}
              className="block w-full border-0 bg-transparent p-0 text-left disabled:opacity-50"
            >
              <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.restoreSourceLocalTitle}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">{UI_TEXT.settings.restoreSourceLocalHint}</p>
            </button>
          </QuietActionRow>
          <QuietActionRow>
            <button
              type="button"
              onClick={() => {
                setRestoreSourceDialogOpen(false);
                void openRemoteRestoreList();
              }}
              disabled={busy}
              className="block w-full border-0 bg-transparent p-0 text-left disabled:opacity-50"
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
        actions={(
          <>
            <button
              type="button"
              onClick={closeStrategyDialog}
              disabled={isRestoringBackup}
              className="qp-button-secondary h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold leading-none disabled:opacity-50"
            >
              {UI_TEXT.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                confirmRestoreStrategy();
              }}
              disabled={busy}
              className="qp-button-primary h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold leading-none disabled:opacity-50"
            >
              {isRestoringBackup || remoteBackup.isListing ? UI_TEXT.settings.backupRestoring : UI_TEXT.settings.backupRestoreAction}
            </button>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <QuietSegmentedFilter
            value={restoreStrategy}
            options={restoreStrategyOptions}
            onChange={onRestoreStrategyChange}
            className="self-start"
          />
        </div>
      </QuietDialog>
    </>
  );
}
