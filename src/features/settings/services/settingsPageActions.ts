import { UI_TEXT } from "../../../shared/copy/index.ts";
import type { QuietToastTone } from "../../../shared/types/toast";
import type { CleanupRange } from "../types.ts";
import type { BackupRestorePreparation, BackupRestoreStrategy } from "./settingsRuntimeAdapterService.ts";

interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
}

type ConfirmAction = (options: ConfirmOptions) => Promise<boolean>;
type NotifyAction = (message: string, tone?: QuietToastTone) => void;
type BusyHook = () => void;
type ErrorReporter = (message: string, error: unknown) => void;

type CleanupFlowOptions = {
  cleanupRange: CleanupRange;
  cleanupRangeLabel: string;
  confirm: ConfirmAction;
  clearSessionsByRange: (range: CleanupRange) => Promise<void>;
  notify: NotifyAction;
  reload: () => void;
  onExecutionStart?: BusyHook;
  onExecutionEnd?: BusyHook;
  reportError?: ErrorReporter;
};

type BackupExportFlowOptions = {
  initialPath?: string;
  exportBackupWithPicker: (initialPath?: string) => Promise<string | null>;
  setExportPath: (path: string) => void;
  notify: NotifyAction;
  onExecutionStart?: BusyHook;
  onExecutionEnd?: BusyHook;
  reportError?: ErrorReporter;
};

type BackupRestoreFlowOptions = {
  initialPath?: string;
  restoreStrategy: BackupRestoreStrategy;
  prepareBackupRestore: (initialPath?: string) => Promise<BackupRestorePreparation | null>;
  setRestorePath: (path: string) => void;
  confirm: ConfirmAction;
  restoreBackup: (
    path: string,
    restoreStrategy: BackupRestoreStrategy,
    hash: string,
  ) => Promise<void>;
  notify: NotifyAction;
  reload: () => void;
  onExecutionStart?: BusyHook;
  onExecutionEnd?: BusyHook;
  reportError?: ErrorReporter;
};

type BackupRestorePrepareFlowOptions = {
  initialPath?: string;
  prepareBackupRestore: (initialPath?: string) => Promise<BackupRestorePreparation | null>;
  setRestorePath: (path: string) => void;
  notify: NotifyAction;
  onExecutionStart?: BusyHook;
  onExecutionEnd?: BusyHook;
  reportError?: ErrorReporter;
};

type BackupRestoreCommitFlowOptions = {
  preparation: BackupRestorePreparation;
  restoreStrategy: BackupRestoreStrategy;
  confirm: ConfirmAction;
  restoreBackup: (
    path: string,
    restoreStrategy: BackupRestoreStrategy,
    hash: string,
  ) => Promise<void>;
  notify: NotifyAction;
  reload: () => void;
  onExecutionStart?: BusyHook;
  onExecutionEnd?: BusyHook;
  reportError?: ErrorReporter;
};

function normalizeOptionalPath(path: string | undefined): string | undefined {
  const trimmed = path?.trim();
  return trimmed ? trimmed : undefined;
}

export async function runSettingsCleanupFlow(options: CleanupFlowOptions): Promise<boolean> {
  const confirmed = await options.confirm({
    title: UI_TEXT.settings.cleanupConfirmTitle,
    description: UI_TEXT.settings.cleanupConfirmDetail(options.cleanupRangeLabel),
    confirmLabel: UI_TEXT.dialog.confirmDanger,
    danger: true,
  });
  if (!confirmed) {
    return false;
  }

  options.onExecutionStart?.();
  try {
    await options.clearSessionsByRange(options.cleanupRange);
    options.notify(UI_TEXT.toast.cleanupSuccess, "success");
    options.reload();
    return true;
  } catch (error) {
    options.reportError?.("cleanup failed", error);
    options.notify(UI_TEXT.toast.cleanupFailed, "error");
    return false;
  } finally {
    options.onExecutionEnd?.();
  }
}

export async function runBackupExportFlow(options: BackupExportFlowOptions): Promise<string | null> {
  options.onExecutionStart?.();
  try {
    const exportedPath = await options.exportBackupWithPicker(normalizeOptionalPath(options.initialPath));
    if (!exportedPath) {
      return null;
    }

    options.setExportPath(exportedPath);
    options.notify(UI_TEXT.toast.backupExportSuccess(exportedPath), "success");
    return exportedPath;
  } catch (error) {
    options.reportError?.("export backup failed", error);
    options.notify(UI_TEXT.toast.backupExportFailed, "error");
    return null;
  } finally {
    options.onExecutionEnd?.();
  }
}

export async function runBackupRestoreFlow(options: BackupRestoreFlowOptions): Promise<boolean> {
  const preparation = await prepareBackupRestoreFlow({
    initialPath: options.initialPath,
    prepareBackupRestore: options.prepareBackupRestore,
    setRestorePath: options.setRestorePath,
    notify: options.notify,
    reportError: options.reportError,
  });
  if (!preparation) {
    return false;
  }

  return commitPreparedBackupRestoreFlow({
    ...options,
    preparation,
  });
}

export async function prepareBackupRestoreFlow(
  options: BackupRestorePrepareFlowOptions,
): Promise<BackupRestorePreparation | null> {
  options.onExecutionStart?.();
  try {
    const preparation = await options.prepareBackupRestore(normalizeOptionalPath(options.initialPath));
    if (!preparation) {
      return null;
    }

    options.setRestorePath(preparation.path);
    if (!preparation.compatible) {
      options.notify(UI_TEXT.toast.backupIncompatible(preparation.incompatibilityMessage), "warning");
      return null;
    }

    return preparation;
  } catch (error) {
    options.reportError?.("prepare backup restore failed", error);
    options.notify(UI_TEXT.toast.backupPreviewFailed, "error");
    return null;
  } finally {
    options.onExecutionEnd?.();
  }
}

export async function commitPreparedBackupRestoreFlow(options: BackupRestoreCommitFlowOptions): Promise<boolean> {
  const confirmed = await options.confirm({
    title: UI_TEXT.settings.restoreConfirmTitle,
    description: UI_TEXT.settings.restoreConfirmDetail(
      options.preparation.path,
      options.preparation.previewSummary,
      UI_TEXT.settings.restoreStrategyOptions[options.restoreStrategy],
    ),
    confirmLabel: UI_TEXT.dialog.confirmDanger,
    danger: true,
  });
  if (!confirmed) {
    return false;
  }

  options.onExecutionStart?.();
  try {
    await options.restoreBackup(
      options.preparation.path,
      options.restoreStrategy,
      options.preparation.preview.hash,
    );
    options.notify(
      options.preparation.preview.formatKind === "legacy_structured"
        ? UI_TEXT.toast.legacyBackupRestoreSuccess
        : UI_TEXT.toast.backupRestoreSuccess,
      "success",
    );
    options.reload();
    return true;
  } catch (error) {
    options.reportError?.("restore backup failed", error);
    options.notify(UI_TEXT.toast.backupRestoreFailed, "error");
    return false;
  } finally {
    options.onExecutionEnd?.();
  }
}
