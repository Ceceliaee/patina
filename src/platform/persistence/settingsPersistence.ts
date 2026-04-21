import { executeWrite, getDB } from "./sqlite.ts";

export interface SettingRow {
  key: string;
  value: string;
}

export async function upsertSettingValue(key: string, value: string): Promise<void> {
  await executeWrite(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
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
  await executeWrite("DELETE FROM sessions WHERE start_time < ?", [cutoffTime]);
}

export async function clearAllSessionWindowTitles(): Promise<void> {
  await executeWrite(
    "UPDATE sessions SET window_title = '' WHERE COALESCE(window_title, '') <> ''",
  );
}
