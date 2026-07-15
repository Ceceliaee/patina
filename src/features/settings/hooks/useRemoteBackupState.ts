import { useCallback, useEffect, useState } from "react";
import type { QuietToastTone } from "../../../shared/components/QuietToast";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import {
  deleteWebDavBackupSecret,
  deleteRemoteBackupTemp,
  downloadWebDavBackup,
  hasWebDavBackupSecret,
  listWebDavBackups,
  revealWebDavBackupSecret,
  saveWebDavBackupSecret,
  testWebDavBackupTarget,
  uploadWebDavBackup,
  type RemoteBackupEntry,
  type WebDavBackupConfig,
} from "../../../platform/backup/remoteBackupRuntimeGateway.ts";
import {
  clearRemoteBackupConfig,
  DEFAULT_WEBDAV_REMOTE_DIR,
  loadRemoteBackupConfig,
  saveRemoteBackupConfig,
  saveRemoteBackupLastBackupAt,
  type PersistedRemoteBackupConfig,
} from "../../../platform/persistence/remoteBackupSettingsStore.ts";
import type { BackupRestoreStrategy } from "../services/settingsRuntimeAdapterService.ts";
import {
  buildBackupPreviewSummary,
  localizeBackupRestoreMessage,
} from "../services/settingsRuntimeAdapterService.ts";

type ConfirmFn = (options: {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}) => Promise<boolean>;

type NotifyFn = (message: string, tone?: QuietToastTone) => void;

export { DEFAULT_WEBDAV_REMOTE_DIR };
export type { RemoteBackupEntry };

export interface RemoteBackupFormDraft {
  url: string;
  username: string;
  remoteDir: string;
  password: string;
}

export interface RemoteBackupState {
  config: PersistedRemoteBackupConfig | null;
  hasSecret: boolean;
  loading: boolean;
  configDialogOpen: boolean;
  restoreDialogOpen: boolean;
  entries: RemoteBackupEntry[];
  isTesting: boolean;
  isSaving: boolean;
  isUploading: boolean;
  isListing: boolean;
  isDownloading: boolean;
  connectionStatus: "unknown" | "ok" | "failed";
  openConfigDialog: () => void;
  closeConfigDialog: () => void;
  revealSavedPassword: () => Promise<string | null>;
  saveConfig: (draft: RemoteBackupFormDraft) => Promise<boolean>;
  deleteConfig: () => Promise<void>;
  testConfig: (draft?: RemoteBackupFormDraft) => Promise<boolean>;
  uploadBackup: () => Promise<void>;
  openRestoreDialog: () => Promise<void>;
  closeRestoreDialog: () => void;
  restoreEntry: (entry: RemoteBackupEntry, restoreStrategy: BackupRestoreStrategy) => Promise<void>;
}

interface UseRemoteBackupStateOptions {
  confirm: ConfirmFn;
  notify: NotifyFn;
  restoreBackup: (path: string, restoreStrategy: BackupRestoreStrategy) => Promise<void>;
  reload: () => void;
}

function toRuntimeConfig(config: PersistedRemoteBackupConfig): WebDavBackupConfig {
  return {
    url: config.url,
    username: config.username,
    remoteDir: config.remoteDir,
  };
}

function draftToRuntimeConfig(draft: RemoteBackupFormDraft): WebDavBackupConfig {
  return {
    url: draft.url.trim(),
    username: draft.username.trim(),
    remoteDir: draft.remoteDir.trim() || DEFAULT_WEBDAV_REMOTE_DIR,
  };
}

export function useRemoteBackupState({
  confirm,
  notify,
  restoreBackup,
  reload,
}: UseRemoteBackupStateOptions): RemoteBackupState {
  const [config, setConfig] = useState<PersistedRemoteBackupConfig | null>(null);
  const [hasSecret, setHasSecret] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [entries, setEntries] = useState<RemoteBackupEntry[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isListing, setIsListing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"unknown" | "ok" | "failed">("unknown");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [nextConfig, nextHasSecret] = await Promise.all([
          loadRemoteBackupConfig(),
          hasWebDavBackupSecret(),
        ]);
        if (cancelled) return;
        setConfig(nextConfig);
        setHasSecret(nextHasSecret);
      } catch (error) {
        console.error("load remote backup settings failed", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveConfig = useCallback(async (draft: RemoteBackupFormDraft) => {
    if (isSaving) return false;
    let savedNewSecretForUnsavedConfig = false;
    setIsSaving(true);
    try {
      const runtimeConfig = draftToRuntimeConfig(draft);
      const password = draft.password.trim();
      if (password) {
        await saveWebDavBackupSecret(runtimeConfig.username, password);
        savedNewSecretForUnsavedConfig = !config;
        setHasSecret(true);
      } else if (!config || !hasSecret) {
        notify(UI_TEXT.toast.webDavMissingPassword, "warning");
        return false;
      }
      const saved = await saveRemoteBackupConfig({
        url: runtimeConfig.url,
        username: runtimeConfig.username,
        remoteDir: runtimeConfig.remoteDir,
        lastBackupAtMs: config?.lastBackupAtMs ?? null,
      });
      setConfig(saved);
      setConnectionStatus("unknown");
      setConfigDialogOpen(false);
      notify(UI_TEXT.toast.webDavConfigSaved, "success");
      return true;
    } catch (error) {
      console.error("save WebDAV backup config failed", error);
      if (savedNewSecretForUnsavedConfig) {
        try {
          await deleteWebDavBackupSecret();
          setHasSecret(false);
        } catch (deleteError) {
          console.error("rollback unsaved WebDAV secret failed", deleteError);
        }
      }
      notify(UI_TEXT.toast.webDavConfigSaveFailed, "warning");
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [config, hasSecret, isSaving, notify]);

  const closeConfigDialog = useCallback(() => {
    setConfigDialogOpen(false);
    if (!config && hasSecret) {
      void deleteWebDavBackupSecret()
        .then(() => {
          setHasSecret(false);
        })
        .catch((error) => {
          console.error("delete orphan WebDAV backup secret failed", error);
        });
    }
  }, [config, hasSecret]);

  const revealSavedPassword = useCallback(async () => {
    try {
      return await revealWebDavBackupSecret();
    } catch (error) {
      console.error("reveal WebDAV backup secret failed", error);
      return null;
    }
  }, []);

  const testConfig = useCallback(async (draft?: RemoteBackupFormDraft) => {
    if (isTesting) return false;
    const runtimeConfig = draft ? draftToRuntimeConfig(draft) : config ? toRuntimeConfig(config) : null;
    if (!runtimeConfig) {
      setConfigDialogOpen(true);
      return false;
    }
    const password = draft?.password.trim();
    if (draft && !password && !config) {
      notify(UI_TEXT.toast.webDavMissingPassword, "warning");
      return false;
    }
    setIsTesting(true);
    setConnectionStatus("unknown");
    try {
      const ok = await testWebDavBackupTarget(runtimeConfig, password || undefined);
      setConnectionStatus(ok ? "ok" : "failed");
      notify(ok ? UI_TEXT.toast.webDavTestSuccess : UI_TEXT.toast.webDavTestFailed, ok ? "success" : "warning");
      return ok;
    } catch (error) {
      console.error("test WebDAV backup target failed", error);
      setConnectionStatus("failed");
      notify(UI_TEXT.toast.webDavTestFailed, "warning");
      return false;
    } finally {
      setIsTesting(false);
    }
  }, [config, isTesting, notify]);

  const deleteConfig = useCallback(async () => {
    const accepted = await confirm({
      title: UI_TEXT.settings.webDavDeleteTitle,
      description: UI_TEXT.settings.webDavDeleteDetail,
      confirmLabel: UI_TEXT.settings.webDavDeleteAction,
      danger: true,
    });
    if (!accepted) return;
    try {
      await clearRemoteBackupConfig();
      await deleteWebDavBackupSecret();
      setConfig(null);
      setHasSecret(false);
      setConnectionStatus("unknown");
      setEntries([]);
      notify(UI_TEXT.toast.webDavConfigDeleted, "success");
    } catch (error) {
      console.error("delete WebDAV backup config failed", error);
      notify(UI_TEXT.toast.webDavConfigDeleteFailed, "warning");
    }
  }, [confirm, notify]);

  const uploadBackup = useCallback(async () => {
    if (isUploading) return;
    if (!config || !hasSecret) {
      setConfigDialogOpen(true);
      notify(UI_TEXT.toast.webDavMissingConfig, "warning");
      return;
    }
    setIsUploading(true);
    try {
      const result = await uploadWebDavBackup(toRuntimeConfig(config));
      await saveRemoteBackupLastBackupAt(result.entry.createdAtMs);
      setConfig({ ...config, lastBackupAtMs: result.entry.createdAtMs });
      setConnectionStatus("ok");
      notify(
        result.indexUpdated
          ? UI_TEXT.toast.webDavUploadSuccess(result.entry.fileName)
          : UI_TEXT.toast.webDavUploadIndexWarning(result.entry.fileName),
        result.indexUpdated ? "success" : "warning",
      );
    } catch (error) {
      console.error("upload WebDAV backup failed", error);
      setConnectionStatus("failed");
      notify(UI_TEXT.toast.webDavUploadFailed, "warning");
    } finally {
      setIsUploading(false);
    }
  }, [config, hasSecret, isUploading, notify]);

  const openRestoreDialog = useCallback(async () => {
    if (!config || !hasSecret) {
      setConfigDialogOpen(true);
      notify(UI_TEXT.toast.webDavMissingConfig, "warning");
      return;
    }
    setIsListing(true);
    try {
      const list = await listWebDavBackups(toRuntimeConfig(config));
      setEntries(list);
      setRestoreDialogOpen(true);
      setConnectionStatus("ok");
    } catch (error) {
      console.error("list WebDAV backups failed", error);
      setConnectionStatus("failed");
      notify(UI_TEXT.toast.webDavListFailed, "warning");
    } finally {
      setIsListing(false);
    }
  }, [config, hasSecret, notify]);

  const restoreEntry = useCallback(async (entry: RemoteBackupEntry, restoreStrategy: BackupRestoreStrategy) => {
    if (!config || isDownloading) return;
    setIsDownloading(true);
    let downloadedPath: string | null = null;
    try {
      const download = await downloadWebDavBackup(toRuntimeConfig(config), entry.id);
      downloadedPath = download.path;
      if (!download.preview.restoreSupported) {
        notify(
          UI_TEXT.toast.backupIncompatible(localizeBackupRestoreMessage(download.preview)),
          "warning",
        );
        return;
      }
      const accepted = await confirm({
        title: UI_TEXT.settings.restoreConfirmTitle,
        description: UI_TEXT.settings.restoreConfirmDetail(
          download.path,
          buildBackupPreviewSummary(download.preview),
          UI_TEXT.settings.restoreStrategyOptions[restoreStrategy],
        ),
        confirmLabel: UI_TEXT.settings.backupRestoreAction,
        danger: restoreStrategy === "replace",
      });
      if (!accepted) return;
      await restoreBackup(download.path, restoreStrategy);
      await deleteRemoteBackupTemp(download.path);
      downloadedPath = null;
      notify(
        download.preview.formatKind === "legacy_structured"
          ? UI_TEXT.toast.legacyBackupRestoreSuccess
          : UI_TEXT.toast.backupRestoreSuccess,
        "success",
      );
      reload();
    } catch (error) {
      console.error("restore WebDAV backup failed", error);
      notify(UI_TEXT.toast.webDavDownloadFailed, "warning");
    } finally {
      if (downloadedPath) {
        try {
          await deleteRemoteBackupTemp(downloadedPath);
        } catch (cleanupError) {
          console.error("cleanup WebDAV backup temp failed", cleanupError);
        }
      }
      setIsDownloading(false);
    }
  }, [config, confirm, isDownloading, notify, reload, restoreBackup]);

  return {
    config,
    hasSecret,
    loading,
    configDialogOpen,
    restoreDialogOpen,
    entries,
    isTesting,
    isSaving,
    isUploading,
    isListing,
    isDownloading,
    connectionStatus,
    openConfigDialog: () => setConfigDialogOpen(true),
    closeConfigDialog,
    revealSavedPassword,
    saveConfig,
    deleteConfig,
    testConfig,
    uploadBackup,
    openRestoreDialog,
    closeRestoreDialog: () => setRestoreDialogOpen(false),
    restoreEntry,
  };
}
