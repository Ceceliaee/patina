import { invoke } from "@tauri-apps/api/core";
import { parseBackupPreview, type BackupPreview } from "./backupRuntimeGateway.ts";

export interface WebDavBackupConfig {
  url: string;
  username: string;
  remoteDir: string;
}

interface RawRemoteBackupEntry {
  id: string;
  fileName: string;
  remotePath: string;
  createdAtMs: number;
  sizeBytes: number;
  appVersion: string;
  formatKind?: "sqlite_snapshot" | "legacy_structured";
  backupVersion: number;
  schemaVersion: number;
  sessionCount: number;
  titleSampleCount: number;
  settingCount: number;
  iconCacheCount: number;
}

interface RawRemoteBackupUploadResult {
  entry: RawRemoteBackupEntry;
  indexUpdated: boolean;
  indexMessage?: string | null;
}

interface RawRemoteBackupDownloadResult {
  path: string;
  preview: unknown;
}

export interface RemoteBackupEntry {
  id: string;
  fileName: string;
  remotePath: string;
  createdAtMs: number;
  sizeBytes: number;
  appVersion: string;
  formatKind: "sqlite_snapshot" | "legacy_structured";
  backupVersion: number;
  schemaVersion: number;
  sessionCount: number;
  titleSampleCount: number;
  settingCount: number;
  iconCacheCount: number;
}

export interface RemoteBackupUploadResult {
  entry: RemoteBackupEntry;
  indexUpdated: boolean;
  indexMessage: string | null;
}

export interface RemoteBackupDownloadResult {
  path: string;
  preview: BackupPreview;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isRawRemoteBackupEntry(value: unknown): value is RawRemoteBackupEntry {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.fileName === "string"
    && typeof value.remotePath === "string"
    && typeof value.createdAtMs === "number"
    && typeof value.sizeBytes === "number"
    && typeof value.appVersion === "string"
    && (value.formatKind === undefined || value.formatKind === "sqlite_snapshot" || value.formatKind === "legacy_structured")
    && typeof value.backupVersion === "number"
    && typeof value.schemaVersion === "number"
    && typeof value.sessionCount === "number"
    && typeof value.titleSampleCount === "number"
    && typeof value.settingCount === "number"
    && typeof value.iconCacheCount === "number";
}

function mapRemoteBackupEntry(raw: RawRemoteBackupEntry): RemoteBackupEntry {
  return {
    id: raw.id,
    fileName: raw.fileName,
    remotePath: raw.remotePath,
    createdAtMs: raw.createdAtMs,
    sizeBytes: raw.sizeBytes,
    appVersion: raw.appVersion,
    formatKind: raw.formatKind ?? "legacy_structured",
    backupVersion: raw.backupVersion,
    schemaVersion: raw.schemaVersion,
    sessionCount: raw.sessionCount,
    titleSampleCount: raw.titleSampleCount,
    settingCount: raw.settingCount,
    iconCacheCount: raw.iconCacheCount,
  };
}

function parseRemoteBackupEntry(value: unknown): RemoteBackupEntry {
  if (!isRawRemoteBackupEntry(value)) {
    throw new Error("Received invalid remote backup entry payload");
  }
  return mapRemoteBackupEntry(value);
}

function parseUploadResult(value: unknown): RemoteBackupUploadResult {
  if (!isRecord(value) || !isRawRemoteBackupEntry(value.entry) || typeof value.indexUpdated !== "boolean") {
    throw new Error("Received invalid remote backup upload payload");
  }
  const raw = value as unknown as RawRemoteBackupUploadResult;
  return {
    entry: mapRemoteBackupEntry(raw.entry),
    indexUpdated: raw.indexUpdated,
    indexMessage: raw.indexMessage ?? null,
  };
}

function parseDownloadResult(value: unknown): RemoteBackupDownloadResult {
  if (!isRecord(value) || typeof value.path !== "string") {
    throw new Error("Received invalid remote backup download payload");
  }
  const raw = value as unknown as RawRemoteBackupDownloadResult;
  return {
    path: raw.path,
    preview: parseBackupPreview(raw.preview),
  };
}

export async function saveWebDavBackupSecret(username: string, password: string): Promise<void> {
  await invoke("cmd_save_webdav_backup_secret", { username, password });
}

export async function deleteWebDavBackupSecret(): Promise<void> {
  await invoke("cmd_delete_webdav_backup_secret");
}

export async function hasWebDavBackupSecret(): Promise<boolean> {
  return invoke<boolean>("cmd_has_webdav_backup_secret");
}

export async function revealWebDavBackupSecret(): Promise<string | null> {
  const result = await invoke<unknown>("cmd_reveal_webdav_backup_secret");
  if (result === null) return null;
  if (typeof result === "string") return result;
  throw new Error("Received invalid WebDAV secret payload");
}

export async function testWebDavBackupTarget(config: WebDavBackupConfig, password?: string): Promise<boolean> {
  const result = await invoke<{ ok?: unknown }>("cmd_test_webdav_backup_target", { config, password });
  return result.ok === true;
}

export async function uploadWebDavBackup(config: WebDavBackupConfig): Promise<RemoteBackupUploadResult> {
  const result = await invoke<unknown>("cmd_upload_webdav_backup", { config });
  return parseUploadResult(result);
}

export async function listWebDavBackups(config: WebDavBackupConfig): Promise<RemoteBackupEntry[]> {
  const result = await invoke<unknown[]>("cmd_list_webdav_backups", { config });
  return result.map(parseRemoteBackupEntry);
}

export async function downloadWebDavBackup(
  config: WebDavBackupConfig,
  id: string,
): Promise<RemoteBackupDownloadResult> {
  const result = await invoke<unknown>("cmd_download_webdav_backup", { config, id });
  return parseDownloadResult(result);
}

export async function deleteRemoteBackupTemp(path: string): Promise<void> {
  await invoke("cmd_delete_remote_backup_temp", { path });
}
