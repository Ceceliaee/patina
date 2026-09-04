import {
  DEFAULT_SETTINGS,
  type AppLanguage,
  type AppSettings,
  type CloseBehavior,
  type ColorScheme,
  type HourlyActivityChartMode,
  type MinimizeBehavior,
  type ThemeMode,
} from "./appSettings.ts";
import { SUPPORTED_LOCALES } from "../i18n/generated/contract.ts";

const IDLE_TIMEOUT_SECONDS_RANGE = { min: 300, max: 1800, step: 60 } as const;
const TIMELINE_MERGE_GAP_SECONDS_RANGE = { min: 60, max: 300, step: 60 } as const;
const REFRESH_INTERVAL_OPTIONS = [1, 3];
const MIN_SESSION_SECONDS_RANGE = { min: 0, max: 600, step: 60 } as const;
const WEB_ACTIVITY_PORT_RANGE = { min: 1024, max: 65535 } as const;

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

function normalizeWebActivityToken(value: string | undefined) {
  return value?.trim() ?? DEFAULT_SETTINGS.webActivityToken;
}

function normalizeRemoteStatusBridgeToken(value: string | undefined) {
  return value?.trim() ?? DEFAULT_SETTINGS.remoteStatusBridgeToken;
}

function normalizeRemoteStatusBridgeUrl(value: string | undefined) {
  return value?.trim() ?? DEFAULT_SETTINGS.remoteStatusBridgeUrl;
}

function normalizeRemoteStatusBridgeMachineId(value: string | undefined) {
  return value?.trim() ?? DEFAULT_SETTINGS.remoteStatusBridgeMachineId;
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
  const normalized = value.trim();
  return SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === normalized.toLowerCase()) ?? DEFAULT_SETTINGS.language;
}

function normalizeHourlyActivityChartMode(value: string | undefined): HourlyActivityChartMode {
  if (value === undefined) return DEFAULT_SETTINGS.hourlyActivityChartMode;
  return value.trim().toLowerCase() === "category" ? "category" : "total";
}

function normalizeColorScheme(value: string | undefined, allowedSchemes: ReadonlySet<string>): ColorScheme {
  if (value === undefined) return "default";
  const normalized = value.trim().toLowerCase();
  if (allowedSchemes.has(normalized)) return normalized as ColorScheme;
  return "default";
}

interface WidgetBootstrapSettingsInput {
  trackingPaused: string | null;
  themeMode: string | null;
  language: string | null;
  colorSchemeLight: string | null;
  colorSchemeDark: string | null;
}

export function normalizeWidgetBootstrapSettings(
  settings: WidgetBootstrapSettingsInput,
): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    trackingPaused: parseBooleanSetting(
      settings.trackingPaused ?? undefined,
      DEFAULT_SETTINGS.trackingPaused,
    ),
    themeMode: normalizeThemeMode(settings.themeMode ?? undefined),
    language: normalizeLanguage(settings.language ?? undefined),
    colorSchemeLight: normalizeColorScheme(
      settings.colorSchemeLight ?? undefined,
      LIGHT_COLOR_SCHEMES,
    ),
    colorSchemeDark: normalizeColorScheme(
      settings.colorSchemeDark ?? undefined,
      DARK_COLOR_SCHEMES,
    ),
  };
}

export function normalizeSettingsRecord(
  record: Record<string, string | undefined>,
): AppSettings {
  const webActivityToken = normalizeWebActivityToken(record.web_activity_token);
  const remoteStatusBridgeToken = normalizeRemoteStatusBridgeToken(
    record.remote_status_bridge_token,
  );
  const remoteStatusBridgeUrl = normalizeRemoteStatusBridgeUrl(
    record.remote_status_bridge_url,
  );
  const remoteStatusBridgeMachineId = normalizeRemoteStatusBridgeMachineId(
    record.remote_status_bridge_machine_id,
  );

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
    titleRecordingEnabled: parseBooleanSetting(
      record.title_recording_enabled,
      DEFAULT_SETTINGS.titleRecordingEnabled,
    ),
    closeBehavior: normalizeCloseBehavior(record.close_behavior),
    minimizeBehavior: normalizeMinimizeBehavior(record.minimize_behavior),
    themeMode: normalizeThemeMode(record.theme_mode),
    language: normalizeLanguage(record.language),
    hourlyActivityChartMode: normalizeHourlyActivityChartMode(record.hourly_activity_chart_mode),
    dynamicEffects: parseBooleanSetting(record.dynamic_effects, DEFAULT_SETTINGS.dynamicEffects),
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
    backgroundOptimization: parseBooleanSetting(
      record.background_optimization,
      DEFAULT_SETTINGS.backgroundOptimization,
    ),
    onboardingCompleted: parseBooleanSetting(
      record.onboarding_completed,
      DEFAULT_SETTINGS.onboardingCompleted,
    ),
    webActivityEnabled: parseBooleanSetting(
      record.web_activity_enabled,
      DEFAULT_SETTINGS.webActivityEnabled,
    ) && webActivityToken.length > 0,
    webActivityPort: normalizeIntegerRangeValue(
      record.web_activity_port,
      DEFAULT_SETTINGS.webActivityPort,
      WEB_ACTIVITY_PORT_RANGE,
    ),
    webActivityToken,
    remoteStatusBridgeEnabled: parseBooleanSetting(
      record.remote_status_bridge_enabled,
      DEFAULT_SETTINGS.remoteStatusBridgeEnabled,
    ),
    remoteStatusBridgeUrl,
    remoteStatusBridgeToken,
    remoteStatusBridgeMachineId,
  };
}
