import { invokeWithCommandError } from "./commandError.ts";
import { saveRemoteBackupLastBackupAt as saveTimestamp } from "./persistenceWriteRuntimeGateway.ts";

export const DEFAULT_WEBDAV_REMOTE_DIR = "/Patina";

export interface PersistedRemoteBackupConfig {
  url: string;
  username: string;
  remoteDir: string;
  lastBackupAtMs: number | null;
}

export interface RemoteBackupConfigSnapshot {
  config: PersistedRemoteBackupConfig | null;
  hasSecret: boolean;
  operationId: string | null;
  cleanupPending: boolean;
  runtimeRefreshPending: boolean;
}

export interface RemoteBackupConfigPatch {
  url: string;
  username: string;
  remoteDir: string;
  passwordUpdate: { kind: "keep" } | { kind: "replace"; password: string };
}

export async function loadRemoteBackupConfigSnapshot(): Promise<RemoteBackupConfigSnapshot> {
  return invokeWithCommandError("cmd_get_remote_backup_config_snapshot");
}

export async function saveRemoteBackupConfig(patch: RemoteBackupConfigPatch): Promise<RemoteBackupConfigSnapshot> {
  const operationId = crypto.randomUUID();
  try {
    return await invokeWithCommandError("cmd_save_remote_backup_settings", { patch: { ...patch, operationId } });
  } catch (error) {
    // A lost IPC response is not evidence that the commit failed.
    const state = await loadRemoteBackupConfigSnapshot().catch(() => null);
    if (state?.operationId === operationId) return state;
    throw error;
  }
}

export async function saveRemoteBackupLastBackupAt(timestampMs: number): Promise<void> {
  await saveTimestamp(timestampMs);
}

export async function clearRemoteBackupConfig(): Promise<RemoteBackupConfigSnapshot> {
  try {
    return await invokeWithCommandError("cmd_clear_remote_backup_settings");
  } catch (error) {
    const state = await loadRemoteBackupConfigSnapshot().catch(() => null);
    if (state && state.config === null && !state.hasSecret) return state;
    throw error;
  }
}
