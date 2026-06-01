import { invoke } from "@tauri-apps/api/core";
import {
  clearAllSessionWindowTitles,
  deleteSessionsBefore,
  loadAllSettingRows,
  loadSettingTimestamp,
} from "./settingsPersistence.ts";
import { executeWriteBatch, type SqlWriteOperation } from "./sqlite.ts";
import {
  DEFAULT_SETTINGS,
  type AppLanguage,
  type AppSettings,
  type CloseBehavior,
  type ColorScheme,
  type HourlyActivityChartMode,
  type MinimizeBehavior,
  type ThemeMode,
} from "../../shared/settings/appSettings.ts";

const TRACKER_LAST_HEARTBEAT_KEY = "__tracker_last_heartbeat_ms";
const TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY = "__tracker_last_successful_sample_ms";
const COMMIT_APP_SETTINGS_COMMAND = "cmd_commit_app_settings";

export type { AppSettings };
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
  | "close_behavior"
  | "minimize_behavior"
  | "theme_mode"
  | "language"
  | "hourly_activity_chart_mode"
  | "color_scheme_light"
  | "color_scheme_dark"
  | "launch_at_login"
  | "start_minimized"
  | "onboarding_completed"
  | "local_api_enabled"
  | "local_api_port"
  | "local_api_token";

const APP_SETTINGS_RAW_KEYS: Record<keyof AppSettings, RawAppSettingsKey> = {
  idleTimeoutSecs: "idle_timeout_secs",
  timelineMergeGapSecs: "timeline_merge_gap_secs",
  refreshIntervalSecs: "refresh_interval_secs",
  minSessionSecs: "min_session_secs",
  trackingPaused: "tracking_paused",
  closeBehavior: "close_behavior",
  minimizeBehavior: "minimize_behavior",
  themeMode: "theme_mode",
  language: "language",
  hourlyActivityChartMode: "hourly_activity_chart_mode",
  colorSchemeLight: "color_scheme_light",
  colorSchemeDark: "color_scheme_dark",
  launchAtLogin: "launch_at_login",
  startMinimized: "start_minimized",
  onboardingCompleted: "onboarding_completed",
  localApiEnabled: "local_api_enabled",
  localApiPort: "local_api_port",
  localApiToken: "local_api_token",
};

const IDLE_TIMEOUT_SECONDS_RANGE = { min: 300, max: 1800, step: 60 } as const;
const TIMELINE_MERGE_GAP_SECONDS_RANGE = { min: 60, max: 300, step: 60 } as const;
const REFRESH_INTERVAL_OPTIONS = [1, 3];
const MIN_SESSION_SECONDS_RANGE = { min: 60, max: 600, step: 60 } as const;
const LOCAL_API_PORT_RANGE = { min: 1024, max: 65535 } as const;
function parseNumberSetting(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeOptionValue(value: string | undefined, fallback: number, allowedValues: number[]) {
  const parsed = parseNumberSetting(value, fallback);
  return allowedValues.includes(parsed) ? parsed : fallback;
}

function normalizeRangeStepValue(
  value: string | undefined,
  fallback: number,
  range: { min: number; max: number; step: number },
) {
  const parsed = parseNumberSetting(value, fallback);
  const clamped = Math.min(range.max, Math.max(range.min, parsed));
  return Math.round(clamped / range.step) * range.step;
}

function normalizeIntegerRangeValue(
  value: string | undefined,
  fallback: number,
  range: { min: number; max: number },
) {
  const parsed = parseNumberSetting(value, fallback);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < range.min || parsed > range.max) return fallback;
  return parsed;
}

function normalizeLocalApiToken(value: string | undefined) {
  return value?.trim() ?? DEFAULT_SETTINGS.localApiToken;
}

function parseBooleanSetting(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeCloseBehavior(value: string | undefined): CloseBehavior {
  if (value === undefined) return DEFAULT_SETTINGS.closeBehavior;
  return value.trim().toLowerCase() === "tray" ? "tray" : "exit";
}

function normalizeMinimizeBehavior(value: string | undefined): MinimizeBehavior {
  if (value === undefined) return DEFAULT_SETTINGS.minimizeBehavior;
  const normalized = value.trim().toLowerCase();
  if (normalized === "widget" || normalized === "taskbar") return normalized;
  return DEFAULT_SETTINGS.minimizeBehavior;
}

function normalizeThemeMode(value: string | undefined): ThemeMode {
  if (value === undefined) return DEFAULT_SETTINGS.themeMode;
  const normalized = value.trim().toLowerCase();
  return normalized === "dark" || normalized === "system" ? normalized : "light";
}

function normalizeLanguage(value: string | undefined): AppLanguage {
  if (value === undefined) return DEFAULT_SETTINGS.language;
  const normalized = value.trim().toLowerCase();
  return normalized === "en-us" ? "en-US" : "zh-CN";
}

function normalizeHourlyActivityChartMode(value: string | undefined): HourlyActivityChartMode {
  if (value === undefined) return DEFAULT_SETTINGS.hourlyActivityChartMode;
  return value.trim().toLowerCase() === "category" ? "category" : "total";
}

const LIGHT_COLOR_SCHEMES = new Set<string>([
  "default",
  "absolutely",
  "catppuccin",
  "everforest",
  "github",
  "gruvbox",
  "linear",
  "notion",
  "one",
  "proof",
  "raycast",
  "rose-pine",
  "solarized",
  "vercel",
  "vscode-plus",
  "xcode",
]);

const DARK_COLOR_SCHEMES = new Set<string>([
  "default",
  "absolutely",
  "ayu",
  "catppuccin",
  "dracula",
  "everforest",
  "github",
  "gruvbox",
  "linear",
  "lobster",
  "material",
  "matrix",
  "monokai",
  "night-owl",
  "nord",
  "notion",
  "one",
  "oscurange",
  "raycast",
  "rose-pine",
  "sentry",
  "solarized",
  "temple",
  "tokyo-night",
  "vercel",
  "vscode-plus",
  "xcode",
]);

function normalizeColorScheme(value: string | undefined, allowedSchemes: ReadonlySet<string>): ColorScheme {
  if (value === undefined) return "default";
  const normalized = value.trim().toLowerCase();
  if (allowedSchemes.has(normalized)) return normalized as ColorScheme;
  return "default";
}

function serializeSettingValue(value: PersistedSettingValue) {
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  return String(value);
}

export function normalizeSettingsRecord(record: Record<string, string | undefined>): AppSettings {
  const localApiToken = normalizeLocalApiToken(record.local_api_token);

  return {
    idleTimeoutSecs: normalizeRangeStepValue(
      record.idle_timeout_secs,
      DEFAULT_SETTINGS.idleTimeoutSecs,
      IDLE_TIMEOUT_SECONDS_RANGE,
    ),
    timelineMergeGapSecs: normalizeRangeStepValue(
      record.timeline_merge_gap_secs,
      DEFAULT_SETTINGS.timelineMergeGapSecs,
      TIMELINE_MERGE_GAP_SECONDS_RANGE,
    ),
    refreshIntervalSecs: normalizeOptionValue(
      record.refresh_interval_secs,
      DEFAULT_SETTINGS.refreshIntervalSecs,
      REFRESH_INTERVAL_OPTIONS,
    ),
    minSessionSecs: normalizeRangeStepValue(
      record.min_session_secs,
      DEFAULT_SETTINGS.minSessionSecs,
      MIN_SESSION_SECONDS_RANGE,
    ),
    trackingPaused: parseBooleanSetting(record.tracking_paused, DEFAULT_SETTINGS.trackingPaused),
    closeBehavior: normalizeCloseBehavior(record.close_behavior),
    minimizeBehavior: normalizeMinimizeBehavior(record.minimize_behavior),
    themeMode: normalizeThemeMode(record.theme_mode),
    language: normalizeLanguage(record.language),
    hourlyActivityChartMode: normalizeHourlyActivityChartMode(record.hourly_activity_chart_mode),
    colorSchemeLight: normalizeColorScheme(
      record.color_scheme_light ?? DEFAULT_SETTINGS.colorSchemeLight,
      LIGHT_COLOR_SCHEMES,
    ),
    colorSchemeDark: normalizeColorScheme(
      record.color_scheme_dark ?? DEFAULT_SETTINGS.colorSchemeDark,
      DARK_COLOR_SCHEMES,
    ),
    launchAtLogin: parseBooleanSetting(record.launch_at_login, DEFAULT_SETTINGS.launchAtLogin),
    startMinimized: parseBooleanSetting(record.start_minimized, DEFAULT_SETTINGS.startMinimized),
    onboardingCompleted: parseBooleanSetting(
      record.onboarding_completed,
      DEFAULT_SETTINGS.onboardingCompleted,
    ),
    localApiEnabled: parseBooleanSetting(record.local_api_enabled, DEFAULT_SETTINGS.localApiEnabled)
      && localApiToken.length > 0,
    localApiPort: normalizeIntegerRangeValue(
      record.local_api_port,
      DEFAULT_SETTINGS.localApiPort,
      LOCAL_API_PORT_RANGE,
    ),
    localApiToken,
  };
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
  await executeWriteBatch(operations);
}

function stringifyInvokeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isCommitAppSettingsCommandUnavailable(error: unknown): boolean {
  const message = stringifyInvokeError(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes(COMMIT_APP_SETTINGS_COMMAND)
    && (
      normalized.includes("not found")
      || normalized.includes("unknown")
      || normalized.includes("unhandled")
      || normalized.includes("not registered")
    )
  ) || (
    normalized.includes("command")
    && normalized.includes("not found")
  );
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

  try {
    await invoke(COMMIT_APP_SETTINGS_COMMAND, { mutations });
  } catch (error) {
    if (!isCommitAppSettingsCommandUnavailable(error)) {
      throw error;
    }

    const fallbackPatch = Object.fromEntries(
      mutations.map((mutation) => [mutation.key, mutation.value]),
    );
    await saveSettingEntries(fallbackPatch);
  }
}

export function buildSaveSettingEntryOperations(
  patch: Record<string, PersistedSettingValue>,
): SqlWriteOperation[] {
  const operations: SqlWriteOperation[] = [];
  for (const [key, value] of Object.entries(patch)) {
    operations.push({
      query: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      values: [key, serializeSettingValue(value)],
    });
  }
  return operations;
}
