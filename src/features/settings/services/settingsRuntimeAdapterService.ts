import {
  clearSessionsBefore,
  saveAppSettingsPatch,
  saveAppSetting,
  type AppSettings,
  type AppSettingsPatch,
} from "../../../platform/persistence/appSettingsStore.ts";
import {
  exportBackup,
  pickBackupFile,
  pickBackupSaveFile,
  previewBackup,
  restoreBackup,
  type BackupRestoreStrategy,
  type BackupPreview,
} from "../../../platform/backup/backupRuntimeGateway.ts";
import { copyTextToClipboard } from "../../../platform/desktop/clipboardGateway.ts";
import { openExternalUrl } from "../../../platform/desktop/externalUrlGateway.ts";
import {
  getStorageSnapshot,
  openStorageDirectory,
  pickStorageDirectory,
  previewRestoreDefaultStorageMigration,
  previewRestoreDefaultWebviewCacheMigration,
  previewStorageMigration,
  previewWebviewCacheMigration,
  restartAndApplyRestoreDefaultWebviewCacheMigration,
  restartAndApplyRestoreDefaultStorageMigration,
  restartAndApplyStorageMigration,
  restartAndApplyWebviewCacheMigration,
  restartAndClearWebviewCache,
  type StorageMigrationPreview,
  type StorageSnapshot,
} from "../../../platform/storage/storageRuntimeGateway.ts";
import {
  emitAppSettingsChanged,
  onAppSettingsChanged,
} from "../../../platform/runtime/appSettingsEventGateway.ts";
import { setAfkThreshold } from "../../../platform/runtime/trackingRuntimeGateway.ts";
import {
  getWebActivityBridgeSnapshot,
  type WebActivityBridgeSnapshot,
} from "../../../platform/runtime/webActivityBridgeGateway.ts";
import { getUiLocale, UI_TEXT } from "../../../shared/copy/index.ts";
import type { CleanupRange } from "../types.ts";
import {
  buildSessionCleanupPlan,
  clearSessionsByRangeWithDeps,
} from "./sessionCleanupPolicy.ts";

export type { BackupPreview, BackupRestoreStrategy } from "../../../platform/backup/backupRuntimeGateway.ts";
export type { StorageMigrationPreview, StorageSnapshot } from "../../../platform/storage/storageRuntimeGateway.ts";
export type { WebActivityBridgeSnapshot } from "../../../platform/runtime/webActivityBridgeGateway.ts";

export interface BackupRestorePreparation {
  path: string;
  preview: BackupPreview;
  previewSummary: string;
  compatible: boolean;
  incompatibilityMessage?: string;
}

type SettingsPatch = Partial<AppSettings>;
export interface SettingsCommitResult {
  persisted: boolean;
  runtimeSync: "synced" | "failed" | "not-needed";
  runtimeSyncErrors: string[];
}

interface SettingsCommitDeps {
  persistPatch: (patch: SettingsPatch) => Promise<void>;
  syncTimelineMergeGap: (seconds: number) => Promise<void>;
  notifySettingsChanged: (patch: SettingsPatch) => Promise<void>;
}
type ExportBackupDeps = {
  pickBackupSaveFile: (initialPath?: string) => Promise<string | null>;
  exportBackup: (path: string) => Promise<string>;
};
type PrepareBackupRestoreDeps = {
  pickBackupFile: (initialPath?: string) => Promise<string | null>;
  previewBackup: (path: string) => Promise<BackupPreview>;
};

const RELEASE_NOTES_URL = "https://github.com/Ceceliaee/patina/releases";
const REPOSITORY_URL = "https://github.com/Ceceliaee/patina";
const FEEDBACK_URL = "https://github.com/Ceceliaee/patina/issues/new/choose";
const KOFI_SUPPORT_URL = "https://ko-fi.com/ceceliaee";
export const WEB_ACTIVITY_STORE_LINKS = [
  {
    kind: "chrome",
    href: "https://chromewebstore.google.com/detail/patina-web-sync/gimdckblhckibmeklhemgccabmbnoemd",
  },
  {
    kind: "firefox",
    href: "https://addons.mozilla.org/firefox/addon/patina-web-sync/",
  },
  {
    kind: "edge",
    href: "https://microsoftedge.microsoft.com/addons/detail/gogmlpjhbfjghilmpcciedplifdiibai",
  },
] as const;
const WEB_ACTIVITY_RELEASES_URL = "https://github.com/Ceceliaee/patina-web-sync/releases/latest";
const WEB_ACTIVITY_HELP_LINKS = new Set([
  WEB_ACTIVITY_RELEASES_URL,
  ...WEB_ACTIVITY_STORE_LINKS.map((link) => link.href),
]);

export function buildBackupPreviewSummary(preview: BackupPreview): string {
  const exportedAt = new Date(preview.exportedAtMs).toLocaleString(getUiLocale());
  const restoreMessage = localizeBackupRestoreMessage(preview);
  const lines = [
    UI_TEXT.backup.formatLabel(preview.formatKind),
    UI_TEXT.backup.exportedAt(exportedAt),
    UI_TEXT.backup.appVersion(preview.appVersion),
    UI_TEXT.backup.restoreSafety(restoreMessage),
    UI_TEXT.backup.itemCounts(preview.sessionCount, preview.settingCount, preview.iconCacheCount),
  ];
  if (preview.importBatchCount > 0
      || preview.importExactSessionCount > 0
      || preview.importTimeBucketCount > 0) {
    lines.push(UI_TEXT.backup.importItemCounts(
      preview.importBatchCount,
      preview.importExactSessionCount,
      preview.importTimeBucketCount,
    ));
  } else if (preview.formatKind === "legacy_structured") {
    lines.push(UI_TEXT.backup.legacyExternalDataNotice);
  }
  return lines.join("\n");
}

export function localizeBackupRestoreMessage(preview: BackupPreview): string {
  return UI_TEXT.backup.restoreMessage(
    preview.restoreMessageKey,
    preview.restoreMessageArgs,
    preview.restoreMessage,
  );
}

const exportBackupDeps: ExportBackupDeps = {
  pickBackupSaveFile,
  exportBackup,
};

const prepareBackupRestoreDeps: PrepareBackupRestoreDeps = {
  pickBackupFile,
  previewBackup,
};

const defaultSettingsCommitDeps: SettingsCommitDeps = {
  persistPatch: saveAppSettingsPatch,
  syncTimelineMergeGap: setAfkThreshold,
  notifySettingsChanged: emitAppSettingsChanged,
};

export async function exportBackupWithPickerWithDeps(
  initialPath: string | undefined,
  deps: ExportBackupDeps,
): Promise<string | null> {
  const selectedPath = await deps.pickBackupSaveFile(initialPath);
  if (!selectedPath) {
    return null;
  }

  return deps.exportBackup(selectedPath);
}

export async function prepareBackupRestoreWithDeps(
  initialPath: string | undefined,
  deps: PrepareBackupRestoreDeps,
): Promise<BackupRestorePreparation | null> {
  const selectedPath = await deps.pickBackupFile(initialPath);
  if (!selectedPath) {
    return null;
  }

  const preview = await deps.previewBackup(selectedPath);
  if (!preview.restoreSupported) {
    return {
      path: selectedPath,
      preview,
      previewSummary: "",
      compatible: false,
      incompatibilityMessage: localizeBackupRestoreMessage(preview),
    };
  }

  return {
    path: selectedPath,
    preview,
    previewSummary: buildBackupPreviewSummary(preview),
    compatible: true,
  };
}

export class SettingsRuntimeAdapterService {
  static async subscribeSettingsChanged(handler: () => void | Promise<void>): Promise<() => void> {
    return onAppSettingsChanged(handler);
  }

  static async updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    await saveAppSetting(key, value);

    if (key === "timelineMergeGapSecs") {
      await setAfkThreshold(value as number);
    }
  }

  static async clearSessionsByRange(range: CleanupRange, nowMs: number = Date.now()): Promise<void> {
    const cleanupPlan = buildSessionCleanupPlan(range, nowMs);
    await clearSessionsByRangeWithDeps(cleanupPlan.range, cleanupPlan.nowMs, {
      clearSessionsBefore,
    });
  }

  static async exportBackupWithPicker(initialPath?: string): Promise<string | null> {
    return exportBackupWithPickerWithDeps(initialPath, exportBackupDeps);
  }

  static async prepareBackupRestore(initialPath?: string): Promise<BackupRestorePreparation | null> {
    return prepareBackupRestoreWithDeps(initialPath, prepareBackupRestoreDeps);
  }

  static restoreBackup(
    path: string,
    restoreStrategy: BackupRestoreStrategy,
    hash: string,
  ): Promise<void> {
    return restoreBackup(path, restoreStrategy, hash);
  }

  static async openReleaseNotes(): Promise<void> {
    await openExternalUrl(RELEASE_NOTES_URL);
  }

  static async openRepository(): Promise<void> {
    await openExternalUrl(REPOSITORY_URL);
  }

  static async openFeedback(): Promise<void> {
    await openExternalUrl(FEEDBACK_URL);
  }

  static async openKofiSupport(): Promise<void> {
    await openExternalUrl(KOFI_SUPPORT_URL);
  }

  static async openWebActivityHelpLink(url: string): Promise<void> {
    if (!WEB_ACTIVITY_HELP_LINKS.has(url)) {
      throw new Error("Unsupported web activity help link");
    }

    await openExternalUrl(url);
  }

  static async copyWebActivityHelpValue(value: string): Promise<void> {
    await copyTextToClipboard(value);
  }

  static async getStorageSnapshot(): Promise<StorageSnapshot> {
    return getStorageSnapshot();
  }

  static async pickStorageDirectory(): Promise<string | null> {
    return pickStorageDirectory();
  }

  static async previewStorageMigration(path: string): Promise<StorageMigrationPreview> {
    return previewStorageMigration(path);
  }

  static async previewWebviewCacheMigration(path: string): Promise<StorageMigrationPreview> {
    return previewWebviewCacheMigration(path);
  }

  static async previewRestoreDefaultStorageMigration(): Promise<StorageMigrationPreview> {
    return previewRestoreDefaultStorageMigration();
  }

  static async previewRestoreDefaultWebviewCacheMigration(): Promise<StorageMigrationPreview> {
    return previewRestoreDefaultWebviewCacheMigration();
  }

  static async restartAndApplyStorageMigration(path: string): Promise<void> {
    await restartAndApplyStorageMigration(path);
  }

  static async restartAndApplyWebviewCacheMigration(path: string): Promise<void> {
    await restartAndApplyWebviewCacheMigration(path);
  }

  static async restartAndApplyRestoreDefaultStorageMigration(): Promise<void> {
    await restartAndApplyRestoreDefaultStorageMigration();
  }

  static async restartAndApplyRestoreDefaultWebviewCacheMigration(): Promise<void> {
    await restartAndApplyRestoreDefaultWebviewCacheMigration();
  }

  static async restartAndClearWebviewCache(): Promise<void> {
    await restartAndClearWebviewCache();
  }

  static async openStorageDirectory(path: string): Promise<void> {
    await openStorageDirectory(path);
  }

  static async getWebActivityBridgeSnapshot(): Promise<WebActivityBridgeSnapshot> {
    return getWebActivityBridgeSnapshot();
  }

  static buildSettingsPatch(
    saved: AppSettings,
    draft: AppSettings,
  ): SettingsPatch {
    const patch: SettingsPatch = {};
    const patchRecord = patch as Record<keyof AppSettings, AppSettings[keyof AppSettings]>;
    const keys = Object.keys(saved) as Array<keyof AppSettings>;
    for (const key of keys) {
      if (saved[key] !== draft[key]) {
        patchRecord[key] = draft[key];
      }
    }
    return patch;
  }

  static async commitSettingsPatch(patch: SettingsPatch): Promise<SettingsCommitResult> {
    return commitSettingsPatchWithDeps(patch, defaultSettingsCommitDeps);
  }
}

export async function commitSettingsPatchWithDeps(
  patch: SettingsPatch,
  deps: SettingsCommitDeps,
): Promise<SettingsCommitResult> {
  const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
  if (entries.length === 0) {
    return {
      persisted: true,
      runtimeSync: "not-needed",
      runtimeSyncErrors: [],
    };
  }

  await deps.persistPatch(patch as AppSettingsPatch);

  const runtimeSyncErrors: string[] = [];
  try {
    await deps.notifySettingsChanged(patch);
  } catch (error) {
    runtimeSyncErrors.push(error instanceof Error ? error.message : String(error));
  }

  const timelineMergeGapSecs = patch.timelineMergeGapSecs;
  const needsRuntimeSync = typeof timelineMergeGapSecs === "number";
  if (needsRuntimeSync) {
    try {
      await deps.syncTimelineMergeGap(timelineMergeGapSecs);
    } catch (error) {
      runtimeSyncErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    persisted: true,
    runtimeSync: runtimeSyncErrors.length > 0
        ? "failed"
        : needsRuntimeSync
          ? "synced"
          : "not-needed",
    runtimeSyncErrors,
  };
}
