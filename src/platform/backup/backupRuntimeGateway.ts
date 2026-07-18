import { invoke } from "@tauri-apps/api/core";

interface RawBackupPreview {
  hash: string;
  format_kind?: "sqlite_snapshot" | "legacy_structured";
  version: number;
  exported_at_ms: number;
  schema_version: number;
  app_version: string;
  restore_supported: boolean;
  restore_message_key?: string;
  restore_message_args?: string[];
  restore_message: string;
  session_count: number;
  title_sample_count: number;
  import_batch_count?: number;
  import_exact_session_count?: number;
  import_time_bucket_count?: number;
  setting_count: number;
  icon_cache_count: number;
  tool_reminder_count?: number;
  tool_timer_count?: number;
  tool_timer_lap_count?: number;
  tool_pomodoro_run_count?: number;
  tool_daily_stats_count?: number;
  tool_software_reminder_rule_count?: number;
}

export interface BackupPreview {
  hash: string;
  formatKind: "sqlite_snapshot" | "legacy_structured";
  version: number;
  exportedAtMs: number;
  schemaVersion: number;
  appVersion: string;
  restoreSupported: boolean;
  restoreMessageKey: string | null;
  restoreMessageArgs: string[];
  restoreMessage: string;
  sessionCount: number;
  titleSampleCount: number;
  importBatchCount: number;
  importExactSessionCount: number;
  importTimeBucketCount: number;
  settingCount: number;
  iconCacheCount: number;
  toolReminderCount: number;
  toolTimerCount: number;
  toolTimerLapCount: number;
  toolPomodoroRunCount: number;
  toolDailyStatsCount: number;
  toolSoftwareReminderRuleCount: number;
}

export type BackupRestoreStrategy = "replace" | "merge";

function isRawBackupPreview(value: unknown): value is RawBackupPreview {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (record.format_kind === undefined
      || record.format_kind === "sqlite_snapshot"
      || record.format_kind === "legacy_structured")
    && typeof record.version === "number"
    && typeof record.exported_at_ms === "number"
    && typeof record.schema_version === "number"
    && typeof record.app_version === "string"
    && typeof record.restore_supported === "boolean"
    && typeof record.restore_message === "string"
    && typeof record.session_count === "number"
    && typeof record.title_sample_count === "number"
    && (record.import_batch_count === undefined || typeof record.import_batch_count === "number")
    && (record.import_exact_session_count === undefined || typeof record.import_exact_session_count === "number")
    && (record.import_time_bucket_count === undefined || typeof record.import_time_bucket_count === "number")
    && typeof record.setting_count === "number"
    && typeof record.icon_cache_count === "number"
    && (record.tool_reminder_count === undefined || typeof record.tool_reminder_count === "number")
    && (record.tool_timer_count === undefined || typeof record.tool_timer_count === "number")
    && (record.tool_timer_lap_count === undefined || typeof record.tool_timer_lap_count === "number")
    && (record.tool_pomodoro_run_count === undefined || typeof record.tool_pomodoro_run_count === "number")
    && (record.tool_daily_stats_count === undefined || typeof record.tool_daily_stats_count === "number")
    && (record.tool_software_reminder_rule_count === undefined || typeof record.tool_software_reminder_rule_count === "number");
}

function mapRawBackupPreview(raw: RawBackupPreview): BackupPreview {
  return {
    hash: raw.hash,
    formatKind: raw.format_kind ?? "legacy_structured",
    version: raw.version,
    exportedAtMs: raw.exported_at_ms,
    schemaVersion: raw.schema_version,
    appVersion: raw.app_version,
    restoreSupported: raw.restore_supported,
    restoreMessageKey: raw.restore_message_key ?? null,
    restoreMessageArgs: raw.restore_message_args ?? [],
    restoreMessage: raw.restore_message,
    sessionCount: raw.session_count,
    titleSampleCount: raw.title_sample_count,
    importBatchCount: raw.import_batch_count ?? 0,
    importExactSessionCount: raw.import_exact_session_count ?? 0,
    importTimeBucketCount: raw.import_time_bucket_count ?? 0,
    settingCount: raw.setting_count,
    iconCacheCount: raw.icon_cache_count,
    toolReminderCount: raw.tool_reminder_count ?? 0,
    toolTimerCount: raw.tool_timer_count ?? 0,
    toolTimerLapCount: raw.tool_timer_lap_count ?? 0,
    toolPomodoroRunCount: raw.tool_pomodoro_run_count ?? 0,
    toolDailyStatsCount: raw.tool_daily_stats_count ?? 0,
    toolSoftwareReminderRuleCount: raw.tool_software_reminder_rule_count ?? 0,
  };
}

export function parseBackupPreview(value: unknown): BackupPreview {
  if (!isRawBackupPreview(value)) {
    throw new Error("Received invalid backup preview payload");
  }
  return mapRawBackupPreview(value);
}

export async function exportBackup(path?: string): Promise<string> {
  return invoke<string>("cmd_export_backup", { backupPath: path ?? null });
}

export function restoreBackup(
  path: string,
  restoreStrategy: BackupRestoreStrategy,
  hash: string,
): Promise<void> {
  return invoke("cmd_restore_backup", { backupPath: path, restoreStrategy, hash });
}

export async function previewBackup(path: string): Promise<BackupPreview> {
  const payload = await invoke<unknown>("cmd_preview_backup", { backupPath: path });
  return parseBackupPreview(payload);
}

export async function pickBackupSaveFile(initialPath?: string): Promise<string | null> {
  return invoke<string | null>("cmd_pick_backup_save_file", { initialPath: initialPath ?? null });
}

export async function pickBackupFile(initialPath?: string): Promise<string | null> {
  return invoke<string | null>("cmd_pick_backup_file", { initialPath: initialPath ?? null });
}

export async function pickTaiFile(initialPath?: string): Promise<string | null> {
  return invoke<string | null>("cmd_pick_tai_file", { initialPath: initialPath ?? null });
}

export type TaiImportReport = {
  sessionsCreated: number;
  // DB-authoritative count actually written by the Merge (0 on re-import).
  sessionsInserted: number;
  categoriesCreated: number;
  categoriesReused: number;
  rowsSkipped: number;
};

export type TaiParsePreview = {
  sessionsCreated: number;
  titleSamplesCreated: number;
  categoriesCreated: number;
  categoriesReused: number;
  rowsSkipped: number;
};

export type TaiOverlapMode = "skip" | "coexist";

export type TaiImportOptions = {
  importCategories: boolean;
  overlapMode: TaiOverlapMode;
};

export async function parseTaiFile(filePath: string): Promise<TaiParsePreview> {
  return invoke<TaiParsePreview>("cmd_parse_tai_file", { filePath });
}

export async function importTaiFile(
  filePath: string,
  options: TaiImportOptions,
): Promise<TaiImportReport> {
  return invoke<TaiImportReport>("cmd_import_tai_file", { filePath, options });
}
