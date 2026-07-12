import { invoke } from "@tauri-apps/api/core";

export interface StoragePathSnapshot {
  installDir: string;
  dataRoot: string;
  databasePath: string;
  backupDir: string;
  remoteBackupTempDir: string;
  webviewRoot: string;
  isCustomDataRoot: boolean;
  isCustomWebviewRoot: boolean;
}

export interface StorageSizeSnapshot {
  installDirSizeBytes: number;
  dataSizeBytes: number;
  backupDirSizeBytes: number;
}

export interface WebviewCacheEntrySnapshot {
  label: string;
  path: string;
  sizeBytes: number;
}

export interface WebviewCacheSnapshot {
  webviewRoot: string;
  ebwebviewPath: string;
  totalSizeBytes: number;
  reclaimableSizeBytes: number;
  lastTrimAtMs: number | null;
  entries: WebviewCacheEntrySnapshot[];
}

export interface StorageMaintenanceSnapshot {
  lastError: string | null;
}

export interface StorageSnapshot {
  paths: StoragePathSnapshot;
  sizes: StorageSizeSnapshot;
  webviewCache: WebviewCacheSnapshot;
  maintenance: StorageMaintenanceSnapshot;
}

export interface StorageMigrationPreview {
  currentDataRoot: string;
  targetDataRoot: string;
  currentWebviewRoot: string;
  targetWebviewRoot: string;
  databaseSizeBytes: number;
  backupDirSizeBytes: number;
  webviewCacheReclaimableBytes: number;
  requiresRestart: boolean;
}

export async function getStorageSnapshot(): Promise<StorageSnapshot> {
  return invoke<StorageSnapshot>("cmd_get_storage_snapshot");
}

export async function pickStorageDirectory(): Promise<string | null> {
  return invoke<string | null>("cmd_pick_storage_directory");
}

export async function previewStorageMigration(targetDataRoot: string): Promise<StorageMigrationPreview> {
  return invoke<StorageMigrationPreview>("cmd_preview_storage_migration", { targetDataRoot });
}

export async function previewWebviewCacheMigration(targetWebviewRoot: string): Promise<StorageMigrationPreview> {
  return invoke<StorageMigrationPreview>("cmd_preview_webview_cache_migration", { targetWebviewRoot });
}

export async function previewRestoreDefaultStorageMigration(): Promise<StorageMigrationPreview> {
  return invoke<StorageMigrationPreview>("cmd_preview_restore_default_storage_migration");
}

export async function previewRestoreDefaultWebviewCacheMigration(): Promise<StorageMigrationPreview> {
  return invoke<StorageMigrationPreview>("cmd_preview_restore_default_webview_cache_migration");
}

export async function restartAndApplyStorageMigration(targetDataRoot: string): Promise<void> {
  await invoke("cmd_restart_and_apply_storage_migration", { targetDataRoot });
}

export async function restartAndApplyWebviewCacheMigration(targetWebviewRoot: string): Promise<void> {
  await invoke("cmd_restart_and_apply_webview_cache_migration", { targetWebviewRoot });
}

export async function restartAndApplyRestoreDefaultStorageMigration(): Promise<void> {
  await invoke("cmd_restart_and_apply_restore_default_storage_migration");
}

export async function restartAndApplyRestoreDefaultWebviewCacheMigration(): Promise<void> {
  await invoke("cmd_restart_and_apply_restore_default_webview_cache_migration");
}

export async function restartAndClearWebviewCache(): Promise<void> {
  await invoke("cmd_restart_and_clear_webview_cache");
}

export async function openStorageDirectory(path: string): Promise<void> {
  await invoke("cmd_open_storage_directory", { path });
}
