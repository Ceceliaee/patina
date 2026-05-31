import {
  loadAppSettings,
  loadTrackerHealthTimestamp,
  saveAppSetting,
  type AppSettings,
} from "../../platform/persistence/appSettingsStore.ts";
import type { HourlyActivityChartMode } from "../../shared/settings/appSettings.ts";
import {
  onAppSettingsChanged,
  type AppSettingsChangedPayload,
} from "../../platform/runtime/appSettingsEventGateway.ts";

export type { AppSettings };

export async function loadCurrentAppSettings(): Promise<AppSettings> {
  return loadAppSettings();
}

export async function subscribeAppSettingsChanged(
  handler: (payload: AppSettingsChangedPayload) => void | Promise<void>,
): Promise<() => void> {
  return onAppSettingsChanged(handler);
}

export async function loadLatestTrackingPauseSetting(): Promise<boolean> {
  const settings = await loadCurrentAppSettings();
  return settings.trackingPaused;
}

export async function loadTrackerHealthTimestampMs(): Promise<number | null> {
  return loadTrackerHealthTimestamp();
}

export async function saveMinSessionSecsSetting(nextValue: number): Promise<void> {
  await saveAppSetting("minSessionSecs", nextValue);
}

export async function saveHourlyActivityChartModeSetting(
  nextValue: HourlyActivityChartMode,
): Promise<void> {
  await saveAppSetting("hourlyActivityChartMode", nextValue);
}
