import { invokeWithCommandError } from "./commandError.ts";
import { loadSettingValue } from "./settingsPersistence.ts";
import { getBrowserLocalStorage } from "../browser/browserStorageGateway.ts";
import { parseActivityTimelineMode, type ActivityTimelineMode } from "../../shared/settings/activityDisplaySettings.ts";

const KEY = "history_timeline_mode";
const LEGACY_KEY = "patina:history-timeline-mode";

export async function loadActivityTimelineMode(): Promise<ActivityTimelineMode> {
  return parseActivityTimelineMode(await loadSettingValue(KEY));
}

export async function migrateActivityTimelineMode(): Promise<ActivityTimelineMode> {
  const storage = getBrowserLocalStorage();
  const existing = await loadSettingValue(KEY);
  if (existing !== null) {
    try { storage?.removeItem(LEGACY_KEY); } catch { /* The canonical value already owns this preference. */ }
    return parseActivityTimelineMode(existing);
  }
  let legacy: string | null = null;
  try { legacy = storage?.getItem(LEGACY_KEY) ?? null; } catch { /* The canonical store remains available. */ }
  const result = await invokeWithCommandError<unknown>("cmd_migrate_history_timeline_mode", {
    legacyMode: parseActivityTimelineMode(legacy),
  });
  if (typeof result !== "string" || !["app", "category", "web"].includes(result)) throw new Error("Invalid timeline preference");
  try { storage?.removeItem(LEGACY_KEY); } catch { /* A later migration is insert-only. */ }
  return parseActivityTimelineMode(result);
}

export async function saveActivityTimelineMode(mode: ActivityTimelineMode): Promise<void> {
  await invokeWithCommandError("cmd_commit_app_settings", { mutations: [{ key: KEY, value: mode }] });
}
