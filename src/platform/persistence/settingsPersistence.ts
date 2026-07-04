import {
  clearAllSessionWindowTitles as clearAllSessionWindowTitlesViaCommand,
  deleteSessionsBefore as deleteSessionsBeforeViaCommand,
} from "./persistenceWriteRuntimeGateway.ts";
import { getDB } from "./sqlite.ts";

export interface SettingRow {
  key: string;
  value: string;
}

export async function loadSettingTimestamp(key: string): Promise<number | null> {
  const db = await getDB();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ? LIMIT 1",
    [key],
  );

  if (rows.length === 0) {
    return null;
  }

  const parsed = Number(rows[0].value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function loadAllSettingRows(): Promise<SettingRow[]> {
  const db = await getDB();
  return db.select<SettingRow[]>("SELECT key, value FROM settings");
}

export async function deleteSessionsBefore(cutoffTime: number): Promise<void> {
  await deleteSessionsBeforeViaCommand(cutoffTime);
}

export async function clearAllSessionWindowTitles(): Promise<void> {
  await clearAllSessionWindowTitlesViaCommand();
}
