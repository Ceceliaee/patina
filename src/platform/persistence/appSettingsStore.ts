import { invokeWithCommandError } from "./commandError.ts";
import {
  deleteSessionsBefore,
  loadAllSettingRows,
  loadSettingTimestamp,
} from "./settingsPersistence.ts";
import {
  type AppSettings,
} from "../../shared/settings/appSettings.ts";
import { normalizeSettingsRecord } from "../../shared/settings/appSettingsNormalization.ts";

const TRACKER_LAST_HEARTBEAT_KEY = "__tracker_last_heartbeat_ms";
const TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY = "__tracker_last_successful_sample_ms";
const COMMIT_APP_SETTINGS_COMMAND = "cmd_commit_app_settings";

export type { AppSettings };
export { normalizeSettingsRecord };
export type AppSettingsPatch = Partial<AppSettings>;
type PersistedSettingValue = string | number | boolean;
interface AppSettingMutation {
  key: string;
  value: string;
}

type RawAppSettingsKey =
  | "idle_timeout_secs"
  | "timeline_merge_gap_secs"
  | "refresh_interval_secs"
  | "min_session_secs"
  | "tracking_paused"
  | "title_recording_enabled"
  | "close_behavior"
  | "minimize_behavior"
  | "theme_mode"
  | "language"
  | "hourly_activity_chart_mode"
  | "dynamic_effects"
  | "color_scheme_light"
  | "color_scheme_dark"
  | "launch_at_login"
  | "start_minimized"
  | "background_optimization"
  | "onboarding_completed"
  | "web_activity_enabled"
  | "web_activity_port"
  | "web_activity_token"
  | "remote_status_bridge_enabled"
  | "remote_status_bridge_url"
  | "remote_status_bridge_token"
  | "remote_status_bridge_machine_id";

const APP_SETTINGS_RAW_KEYS: Record<keyof AppSettings, RawAppSettingsKey> = {
  idleTimeoutSecs: "idle_timeout_secs",
  timelineMergeGapSecs: "timeline_merge_gap_secs",
  refreshIntervalSecs: "refresh_interval_secs",
  minSessionSecs: "min_session_secs",
  trackingPaused: "tracking_paused",
  titleRecordingEnabled: "title_recording_enabled",
  closeBehavior: "close_behavior",
  minimizeBehavior: "minimize_behavior",
  themeMode: "theme_mode",
  language: "language",
  hourlyActivityChartMode: "hourly_activity_chart_mode",
  dynamicEffects: "dynamic_effects",
  colorSchemeLight: "color_scheme_light",
  colorSchemeDark: "color_scheme_dark",
  launchAtLogin: "launch_at_login",
  startMinimized: "start_minimized",
  backgroundOptimization: "background_optimization",
  onboardingCompleted: "onboarding_completed",
  webActivityEnabled: "web_activity_enabled",
  webActivityPort: "web_activity_port",
  webActivityToken: "web_activity_token",
  remoteStatusBridgeEnabled: "remote_status_bridge_enabled",
  remoteStatusBridgeUrl: "remote_status_bridge_url",
  remoteStatusBridgeToken: "remote_status_bridge_token",
  remoteStatusBridgeMachineId: "remote_status_bridge_machine_id",
};

function serializeSettingValue(value: PersistedSettingValue) {
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  return String(value);
}

export function buildRawAppSettingsPatch(patch: AppSettingsPatch): Record<string, PersistedSettingValue> {
  const rawPatch: Record<string, PersistedSettingValue> = {};
  const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    rawPatch[APP_SETTINGS_RAW_KEYS[key]] = value;
  }
  return rawPatch;
}

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
  await commitAppSettingMutations(buildAppSettingMutations(buildRawAppSettingsPatch(patch)));
}

export async function clearSessionsBefore(cutoffTime: number): Promise<void> {
  await deleteSessionsBefore(cutoffTime);
}

export async function loadTrackerHealthTimestamp(): Promise<number | null> {
  const lastSampleMs = await loadSettingTimestamp(TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY);
  if (lastSampleMs !== null) {
    return lastSampleMs;
  }

  return loadSettingTimestamp(TRACKER_LAST_HEARTBEAT_KEY);
}

export function buildAppSettingMutations(
  patch: Record<string, PersistedSettingValue>,
): AppSettingMutation[] {
  return Object.entries(patch).map(([key, value]) => ({
    key,
    value: serializeSettingValue(value),
  }));
}

async function commitAppSettingMutations(mutations: readonly AppSettingMutation[]): Promise<void> {
  if (mutations.length === 0) {
    return;
  }

  await invokeWithCommandError(COMMIT_APP_SETTINGS_COMMAND, { mutations });
}
