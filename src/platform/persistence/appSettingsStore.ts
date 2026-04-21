import {
  clearAllSessionWindowTitles,
  deleteSessionsBefore,
  loadAllSettingRows,
  loadSettingTimestamp,
} from "./settingsPersistence.ts";
import { executeWriteTransaction, type SqlWriteOperation } from "./sqlite.ts";
import {
  normalizeSettingsRecord,
  type AppSettings,
} from "../../shared/settings/appSettings.ts";

const TRACKER_LAST_HEARTBEAT_KEY = "__tracker_last_heartbeat_ms";
const TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY = "__tracker_last_successful_sample_ms";

export type { AppSettings };
export type AppSettingsPatch = Partial<AppSettings>;
type PersistedSettingValue = string | number | boolean;

export async function loadAppSettings(): Promise<AppSettings> {
  const rows = await loadAllSettingRows();
  const record: Record<string, string> = {};
  for (const row of rows) {
    record[row.key] = row.value;
  }
  return normalizeSettingsRecord(record);
}

export async function saveAppSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  await saveAppSettingsPatch({
    [key]: value,
  } as AppSettingsPatch);
}

export async function saveAppSettingsPatch(patch: AppSettingsPatch): Promise<void> {
  await saveSettingEntries(patch);
}

export async function clearSessionsBefore(cutoffTime: number): Promise<void> {
  await deleteSessionsBefore(cutoffTime);
}

export async function clearAllWindowTitles(): Promise<void> {
  await clearAllSessionWindowTitles();
}

export async function loadTrackerHealthTimestamp(): Promise<number | null> {
  const lastSampleMs = await loadSettingTimestamp(TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY);
  if (lastSampleMs !== null) {
    return lastSampleMs;
  }

  return loadSettingTimestamp(TRACKER_LAST_HEARTBEAT_KEY);
}

export async function saveTrackerHeartbeat(timestampMs: number): Promise<void> {
  await saveSettingEntries({
    [TRACKER_LAST_HEARTBEAT_KEY]: timestampMs,
  });
}

async function saveSettingEntries(
  patch: Record<string, PersistedSettingValue>,
): Promise<void> {
  const operations = buildSaveSettingEntryOperations(patch);
  await executeWriteTransaction(operations);
}

export function buildSaveSettingEntryOperations(
  patch: Record<string, PersistedSettingValue>,
): SqlWriteOperation[] {
  const operations: SqlWriteOperation[] = [];
  for (const [key, value] of Object.entries(patch)) {
    operations.push({
      query: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      values: [key, typeof value === "boolean" ? (value ? "1" : "0") : String(value)],
    });
  }
  return operations;
}
