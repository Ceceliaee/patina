import { useCallback, useEffect, useState } from "react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import type { QuietToastTone } from "../../../shared/components/QuietToast";
import { useQuietDialogs } from "../../../shared/hooks/useQuietDialogs";
import { SettingsRuntimeAdapterService } from "../../settings/services/settingsRuntimeAdapterService";
import {
  commitPreparedBackupRestoreFlow,
  prepareBackupRestoreFlow,
  runBackupExportFlow,
  runSettingsCleanupFlow,
} from "../../settings/services/settingsPageActions.ts";
import type { CleanupRange } from "../../settings/types";
import type {
  BackupRestorePreparation,
  BackupRestoreStrategy,
  StorageSnapshot,
} from "../../settings/services/settingsRuntimeAdapterService.ts";
import { useRemoteBackupState } from "../../settings/hooks/useRemoteBackupState.ts";
import { toEbwebviewCachePath } from "../../settings/services/storagePathDisplay.ts";

const buildCleanupOptions = (): Array<{ value: CleanupRange; label: string }> => [
  { value: 180, label: UI_TEXT.settings.cleanupRangeLabels[180] },
  { value: 90, label: UI_TEXT.settings.cleanupRangeLabels[90] },
  { value: 60, label: UI_TEXT.settings.cleanupRangeLabels[60] },
  { value: 30, label: UI_TEXT.settings.cleanupRangeLabels[30] },
  { value: 15, label: UI_TEXT.settings.cleanupRangeLabels[15] },
  { value: 7, label: UI_TEXT.settings.cleanupRangeLabels[7] },
];

let cachedStorageSnapshot: StorageSnapshot | null = null;
let hasCheckedInitialStorageSnapshot = false;
let pendingInitialStorageSnapshot: Promise<StorageSnapshot | null> | null = null;

const loadInitialStorageSnapshotOnce = () => {
  if (cachedStorageSnapshot) {
    return Promise.resolve(cachedStorageSnapshot);
  }
  if (hasCheckedInitialStorageSnapshot) {
    return Promise.resolve(null);
  }
  if (!pendingInitialStorageSnapshot) {
    hasCheckedInitialStorageSnapshot = true;
    pendingInitialStorageSnapshot = SettingsRuntimeAdapterService.getStorageSnapshot()
      .then((snapshot) => {
        cachedStorageSnapshot = snapshot;
        return snapshot;
      })
      .catch((error) => {
        console.error("load initial storage snapshot failed", error);
        return null;
      })
      .finally(() => {
        pendingInitialStorageSnapshot = null;
      });
  }
  return pendingInitialStorageSnapshot;
};

export interface UseStoragePageStateOptions {
  onToast?: (message: string, tone?: QuietToastTone) => void;
}

export function useStoragePageState({ onToast }: UseStoragePageStateOptions = {}) {
  const { confirm, dialogs } = useQuietDialogs();
  const [cleanupRange, setCleanupRange] = useState<CleanupRange>(30);
  const [isCleaning, setIsCleaning] = useState(false);
  const [exportPath, setExportPath] = useState("");
  const [restorePath, setRestorePath] = useState("");
  const [restoreStrategy, setRestoreStrategy] = useState<BackupRestoreStrategy>("merge");
  const [pendingRestorePreparation, setPendingRestorePreparation] = useState<BackupRestorePreparation | null>(null);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [storageSnapshot, setStorageSnapshot] = useState<StorageSnapshot | null>(() => cachedStorageSnapshot);
  const [isStorageBusy, setIsStorageBusy] = useState(false);
  const [loading, setLoading] = useState(() => !cachedStorageSnapshot);
  const cleanupOptions = buildCleanupOptions();

  const notify = useCallback((message: string, tone: QuietToastTone = "info") => {
    onToast?.(message, tone);
  }, [onToast]);

  const remoteBackup = useRemoteBackupState({
    confirm,
    notify,
    restoreBackup: SettingsRuntimeAdapterService.restoreBackup,
    reload: () => window.location.reload(),
  });

  const refreshStorageSnapshot = useCallback(async () => {
    try {
      const nextSnapshot = await SettingsRuntimeAdapterService.getStorageSnapshot();
      cachedStorageSnapshot = nextSnapshot;
      hasCheckedInitialStorageSnapshot = true;
      setStorageSnapshot(nextSnapshot);
      return true;
    } catch (error) {
      console.error("load storage snapshot failed", error);
      return false;
    }
  }, []);

  const handleRefreshStorageSnapshot = useCallback(async () => {
    if (isStorageBusy) return;
    setIsStorageBusy(true);
    try {
      const refreshed = await refreshStorageSnapshot();
      if (!refreshed) {
        notify(UI_TEXT.settings.storage.storageSnapshotRefreshFailed, "warning");
      }
    } finally {
      setIsStorageBusy(false);
    }
  }, [isStorageBusy, notify, refreshStorageSnapshot]);

  useEffect(() => {
    if (storageSnapshot) return;
    if (hasCheckedInitialStorageSnapshot && !pendingInitialStorageSnapshot && !cachedStorageSnapshot) return;
    let cancelled = false;
    setIsStorageBusy(true);
    void loadInitialStorageSnapshotOnce()
      .then((snapshot) => {
        if (!cancelled && snapshot) {
          setStorageSnapshot(snapshot);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsStorageBusy(false);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [storageSnapshot]);

  const handleCleanup = useCallback(async () => {
    const selectedLabel = cleanupOptions.find((option) => option.value === cleanupRange)?.label
      ?? UI_TEXT.settings.confirmRangeFallback;
    await runSettingsCleanupFlow({
      cleanupRange,
      cleanupRangeLabel: selectedLabel,
      confirm,
      clearSessionsByRange: SettingsRuntimeAdapterService.clearSessionsByRange,
      notify,
      reload: () => window.location.reload(),
      onExecutionStart: () => setIsCleaning(true),
      onExecutionEnd: () => setIsCleaning(false),
      reportError: (message, error) => {
        console.error(message, error);
      },
    });
  }, [cleanupOptions, cleanupRange, confirm, notify]);

  const handleExportBackup = useCallback(async () => {
    if (isExportingBackup) return;
    await runBackupExportFlow({
      initialPath: exportPath,
      exportBackupWithPicker: SettingsRuntimeAdapterService.exportBackupWithPicker,
      setExportPath,
      notify,
      onExecutionStart: () => setIsExportingBackup(true),
      onExecutionEnd: () => setIsExportingBackup(false),
      reportError: (message, error) => {
        console.error(message, error);
      },
    });
  }, [exportPath, isExportingBackup, notify]);

  const handlePrepareRestoreBackup = useCallback(async (): Promise<boolean | void> => {
    if (isRestoringBackup) return;
    const preparation = await prepareBackupRestoreFlow({
      initialPath: restorePath,
      prepareBackupRestore: SettingsRuntimeAdapterService.prepareBackupRestore,
      setRestorePath,
      notify,
      onExecutionStart: () => setIsRestoringBackup(true),
      onExecutionEnd: () => setIsRestoringBackup(false),
      reportError: (message, error) => {
        console.error(message, error);
      },
    });
    setPendingRestorePreparation(preparation);
    return Boolean(preparation);
  }, [isRestoringBackup, notify, restorePath]);

  const handleRestoreBackup = useCallback(async (selectedRestoreStrategy: BackupRestoreStrategy = restoreStrategy) => {
    if (isRestoringBackup || !pendingRestorePreparation) return;
    await commitPreparedBackupRestoreFlow({
      preparation: pendingRestorePreparation,
      restoreStrategy: selectedRestoreStrategy,
      confirm,
      restoreBackup: SettingsRuntimeAdapterService.restoreBackup,
      notify,
      reload: () => window.location.reload(),
      onExecutionStart: () => setIsRestoringBackup(true),
      onExecutionEnd: () => setIsRestoringBackup(false),
      reportError: (message, error) => {
        console.error(message, error);
      },
    });
    setPendingRestorePreparation(null);
  }, [confirm, isRestoringBackup, notify, pendingRestorePreparation, restoreStrategy]);

  const handleClearPendingRestoreBackup = useCallback(() => {
    setPendingRestorePreparation(null);
  }, []);

  const handleScheduleWebviewCacheClear = useCallback(async () => {
    if (isStorageBusy) return;
    const storageText = UI_TEXT.settings.storage;

    setIsStorageBusy(true);
    try {
      await SettingsRuntimeAdapterService.scheduleWebviewCacheClear();
      await refreshStorageSnapshot();
      notify(storageText.webviewCacheClearScheduled, "success");
    } catch (error) {
      console.error("schedule webview cache clear failed", error);
      notify(storageText.webviewCacheClearFailed, "warning");
    } finally {
      setIsStorageBusy(false);
    }
  }, [isStorageBusy, notify, refreshStorageSnapshot]);

  const handleChooseDataDirectory = useCallback(async () => {
    if (isStorageBusy) return;
    const storageText = UI_TEXT.settings.storage;

    setIsStorageBusy(true);
    try {
      const selectedPath = await SettingsRuntimeAdapterService.pickStorageDirectory();
      if (!selectedPath) return;

      const preview = await SettingsRuntimeAdapterService.previewStorageMigration(selectedPath);
      const confirmed = await confirm({
        title: storageText.storageDataMigrationConfirmTitle,
        description: storageText.storageDataMigrationConfirmDetail(
          preview.currentDataRoot,
          preview.targetDataRoot,
        ),
        confirmLabel: storageText.storageMigrationConfirmAction,
      });
      if (!confirmed) return;

      await SettingsRuntimeAdapterService.scheduleStorageMigration(selectedPath);
      await refreshStorageSnapshot();
      notify(storageText.storageMigrationScheduled, "success");
    } catch (error) {
      console.error("schedule data directory migration failed", error);
      notify(storageText.storageMigrationFailed, "warning");
    } finally {
      setIsStorageBusy(false);
    }
  }, [confirm, isStorageBusy, notify, refreshStorageSnapshot]);

  const handleChooseCacheDirectory = useCallback(async () => {
    if (isStorageBusy) return;
    const storageText = UI_TEXT.settings.storage;

    setIsStorageBusy(true);
    try {
      const selectedPath = await SettingsRuntimeAdapterService.pickStorageDirectory();
      if (!selectedPath) return;

      const preview = await SettingsRuntimeAdapterService.previewWebviewCacheMigration(selectedPath);
      const confirmed = await confirm({
        title: storageText.storageCacheMigrationConfirmTitle,
        description: storageText.storageCacheMigrationConfirmDetail(
          toEbwebviewCachePath(preview.currentWebviewRoot),
          toEbwebviewCachePath(preview.targetWebviewRoot),
        ),
        confirmLabel: storageText.storageMigrationConfirmAction,
      });
      if (!confirmed) return;

      await SettingsRuntimeAdapterService.scheduleWebviewCacheMigration(selectedPath);
      await refreshStorageSnapshot();
      notify(storageText.storageMigrationScheduled, "success");
    } catch (error) {
      console.error("schedule cache directory migration failed", error);
      notify(storageText.storageMigrationFailed, "warning");
    } finally {
      setIsStorageBusy(false);
    }
  }, [confirm, isStorageBusy, notify, refreshStorageSnapshot]);

  const handleRestoreDefaultDataDirectory = useCallback(async () => {
    if (isStorageBusy || !storageSnapshot?.paths.isCustomDataRoot) return;
    const storageText = UI_TEXT.settings.storage;

    setIsStorageBusy(true);
    try {
      const preview = await SettingsRuntimeAdapterService.previewRestoreDefaultStorageMigration();
      const confirmed = await confirm({
        title: storageText.restoreDefaultPathAction,
        description: storageText.storageRestoreDefaultDataConfirmDetail(
          preview.currentDataRoot,
          preview.targetDataRoot,
        ),
        confirmLabel: storageText.restoreDefaultPathAction,
      });
      if (!confirmed) return;

      await SettingsRuntimeAdapterService.scheduleRestoreDefaultStorageMigration();
      await refreshStorageSnapshot();
      notify(storageText.storageMigrationScheduled, "success");
    } catch (error) {
      console.error("schedule restore default data directory failed", error);
      notify(storageText.storageMigrationFailed, "warning");
    } finally {
      setIsStorageBusy(false);
    }
  }, [confirm, isStorageBusy, notify, refreshStorageSnapshot, storageSnapshot?.paths.isCustomDataRoot]);

  const handleRestoreDefaultCacheDirectory = useCallback(async () => {
    if (isStorageBusy || !storageSnapshot?.paths.isCustomWebviewRoot) return;
    const storageText = UI_TEXT.settings.storage;

    setIsStorageBusy(true);
    try {
      const preview = await SettingsRuntimeAdapterService.previewRestoreDefaultWebviewCacheMigration();
      const confirmed = await confirm({
        title: storageText.restoreDefaultPathAction,
        description: storageText.storageRestoreDefaultCacheConfirmDetail(
          toEbwebviewCachePath(preview.currentWebviewRoot),
          toEbwebviewCachePath(preview.targetWebviewRoot),
        ),
        confirmLabel: storageText.restoreDefaultPathAction,
      });
      if (!confirmed) return;

      await SettingsRuntimeAdapterService.scheduleRestoreDefaultWebviewCacheMigration();
      await refreshStorageSnapshot();
      notify(storageText.storageMigrationScheduled, "success");
    } catch (error) {
      console.error("schedule restore default cache directory failed", error);
      notify(storageText.storageMigrationFailed, "warning");
    } finally {
      setIsStorageBusy(false);
    }
  }, [confirm, isStorageBusy, notify, refreshStorageSnapshot, storageSnapshot?.paths.isCustomWebviewRoot]);

  const handleCancelPendingStorageMigration = useCallback(async () => {
    if (isStorageBusy) return;
    const storageText = UI_TEXT.settings.storage;
    setIsStorageBusy(true);
    try {
      await SettingsRuntimeAdapterService.cancelPendingStorageMigration();
      await refreshStorageSnapshot();
      notify(storageText.storageMigrationCancelled, "info");
    } catch (error) {
      console.error("cancel pending storage migration failed", error);
      notify(storageText.storageMigrationCancelFailed, "warning");
    } finally {
      setIsStorageBusy(false);
    }
  }, [isStorageBusy, notify, refreshStorageSnapshot]);

  const handleOpenStorageDirectory = useCallback(async (path: string) => {
    const storageText = UI_TEXT.settings.storage;
    try {
      await SettingsRuntimeAdapterService.openStorageDirectory(path);
    } catch (error) {
      console.error("open storage directory failed", error);
      notify(storageText.storageOpenDirectoryFailed, "warning");
    }
  }, [notify]);

  return {
    loading,
    cleanupRange,
    cleanupOptions,
    restoreStrategy,
    isCleaning,
    isExportingBackup,
    isRestoringBackup,
    storageSnapshot,
    isStorageBusy,
    remoteBackup,
    dialogs,
    setCleanupRange,
    setRestoreStrategy,
    handleCleanup,
    handleExportBackup,
    handlePrepareRestoreBackup,
    handleRestoreBackup,
    handleClearPendingRestoreBackup,
    handleRefreshStorageSnapshot,
    handleScheduleWebviewCacheClear,
    handleChooseDataDirectory,
    handleChooseCacheDirectory,
    handleRestoreDefaultDataDirectory,
    handleRestoreDefaultCacheDirectory,
    handleCancelPendingStorageMigration,
    handleOpenStorageDirectory,
  };
}
