import { loadAllSettingRows } from "./settingsPersistence.ts";
import { executeWriteBatch, type SqlWriteOperation } from "./sqlite.ts";

export const DEFAULT_WEBDAV_REMOTE_DIR = "/Patina";
const LEGACY_WEBDAV_REMOTE_DIR = "/TimeTracker";

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
  const normalized = withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
  return normalized === LEGACY_WEBDAV_REMOTE_DIR ? DEFAULT_WEBDAV_REMOTE_DIR : normalized;
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
    await executeWriteBatch([upsertSetting(WEBDAV_BACKUP_REMOTE_DIR_KEY, remoteDir)]);
  }

  return {
    url,
    username,
    remoteDir,
    lastBackupAtMs: parseTimestamp(record[WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY]),
  };
}

function upsertSetting(key: string, value: string): SqlWriteOperation {
  return {
    query: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    values: [key, value],
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

  const operations: SqlWriteOperation[] = [
    upsertSetting(WEBDAV_BACKUP_URL_KEY, normalized.url),
    upsertSetting(WEBDAV_BACKUP_USERNAME_KEY, normalized.username),
    upsertSetting(WEBDAV_BACKUP_REMOTE_DIR_KEY, normalized.remoteDir),
  ];

  if (normalized.lastBackupAtMs !== null) {
    operations.push(upsertSetting(WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY, String(normalized.lastBackupAtMs)));
  }

  await executeWriteBatch(operations);
  return normalized;
}

export async function saveRemoteBackupLastBackupAt(timestampMs: number): Promise<void> {
  await executeWriteBatch([
    upsertSetting(WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY, String(timestampMs)),
  ]);
}

export async function clearRemoteBackupConfig(): Promise<void> {
  await executeWriteBatch([
    {
      query: "DELETE FROM settings WHERE key IN (?, ?, ?, ?)",
      values: [
        WEBDAV_BACKUP_URL_KEY,
        WEBDAV_BACKUP_USERNAME_KEY,
        WEBDAV_BACKUP_REMOTE_DIR_KEY,
        WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY,
      ],
    },
  ]);
}

export const remoteBackupSettingsInternals = {
  normalizeRemoteDir,
  parseTimestamp,
};
