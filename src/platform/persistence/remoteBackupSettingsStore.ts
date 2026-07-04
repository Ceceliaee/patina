import { loadAllSettingRows } from "./settingsPersistence.ts";
import {
  clearRemoteBackupSettings as clearRemoteBackupSettingsViaCommand,
  saveRemoteBackupLastBackupAt as saveRemoteBackupLastBackupAtViaCommand,
  saveRemoteBackupRemoteDir,
  saveRemoteBackupSettings,
} from "./persistenceWriteRuntimeGateway.ts";

export const DEFAULT_WEBDAV_REMOTE_DIR = "/Patina";

const WEBDAV_BACKUP_URL_KEY = "webdav_backup_url";
const WEBDAV_BACKUP_USERNAME_KEY = "webdav_backup_username";
const WEBDAV_BACKUP_REMOTE_DIR_KEY = "webdav_backup_remote_dir";
const WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY = "webdav_backup_last_backup_at_ms";

export interface PersistedRemoteBackupConfig {
  url: string;
  username: string;
  remoteDir: string;
  lastBackupAtMs: number | null;
}

export interface RemoteBackupConfigPatch {
  url: string;
  username: string;
  remoteDir?: string;
  lastBackupAtMs?: number | null;
}

function normalizeRemoteDir(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_WEBDAV_REMOTE_DIR;
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

function parseTimestamp(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function loadRemoteBackupConfig(): Promise<PersistedRemoteBackupConfig | null> {
  const rows = await loadAllSettingRows();
  const record: Record<string, string> = {};
  for (const row of rows) {
    record[row.key] = row.value;
  }

  const url = record[WEBDAV_BACKUP_URL_KEY]?.trim() ?? "";
  const username = record[WEBDAV_BACKUP_USERNAME_KEY]?.trim() ?? "";
  if (!url || !username) {
    return null;
  }

  const remoteDir = normalizeRemoteDir(record[WEBDAV_BACKUP_REMOTE_DIR_KEY]);
  if (record[WEBDAV_BACKUP_REMOTE_DIR_KEY] !== remoteDir) {
    await saveRemoteBackupRemoteDir(remoteDir);
  }

  return {
    url,
    username,
    remoteDir,
    lastBackupAtMs: parseTimestamp(record[WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY]),
  };
}

export async function saveRemoteBackupConfig(config: RemoteBackupConfigPatch): Promise<PersistedRemoteBackupConfig> {
  const normalized: PersistedRemoteBackupConfig = {
    url: config.url.trim(),
    username: config.username.trim(),
    remoteDir: normalizeRemoteDir(config.remoteDir),
    lastBackupAtMs: config.lastBackupAtMs ?? null,
  };

  if (!normalized.url) {
    throw new Error("WebDAV URL cannot be empty");
  }
  if (!normalized.username) {
    throw new Error("WebDAV username cannot be empty");
  }

  await saveRemoteBackupSettings(normalized);
  return normalized;
}

export async function saveRemoteBackupLastBackupAt(timestampMs: number): Promise<void> {
  await saveRemoteBackupLastBackupAtViaCommand(timestampMs);
}

export async function clearRemoteBackupConfig(): Promise<void> {
  await clearRemoteBackupSettingsViaCommand();
}

export const remoteBackupSettingsInternals = {
  normalizeRemoteDir,
  parseTimestamp,
};
