import { deleteSessionsBefore as deleteSessionsBeforeViaCommand } from "./persistenceWriteRuntimeGateway.ts";
import { invokeWithCommandError } from "./commandError.ts";

interface SettingRow {
  key: string;
  value: string;
}

export async function loadSettingTimestamp(key: string): Promise<number | null> {
  const rows = await loadSettingRows({ key });

  if (rows.length === 0) {
    return null;
  }

  const parsed = Number(rows[0].value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function loadAllSettingRows(): Promise<SettingRow[]> {
  return loadSettingRows();
}

export async function loadSettingRows(filter: { key?: string; keyPrefix?: string } = {}): Promise<SettingRow[]> {
  return invokeWithCommandError("cmd_get_setting_rows", {
    key: filter.key ?? null,
    keyPrefix: filter.keyPrefix ?? null,
  });
}

export async function loadSettingValue(key: string): Promise<string | null> {
  return (await loadSettingRows({ key }))[0]?.value ?? null;
}

export async function deleteSessionsBefore(cutoffTime: number): Promise<void> {
  await deleteSessionsBeforeViaCommand(cutoffTime);
}
