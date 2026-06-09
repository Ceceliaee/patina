import { AppClassification } from "../../shared/classification/appClassification.ts";
import { UI_TEXT } from "../../shared/copy/uiText.ts";
import type { AppSettings } from "../../shared/settings/appSettings.ts";
import type {
  TrackerHealthSnapshot,
  TrackingRuntimeProbeStatus,
  TrackingStatusSnapshot,
  TrackingWindowSnapshot,
} from "../../shared/types/tracking.ts";

export type WidgetStatusTone = "tracking" | "tracking-sustained" | "paused" | "idle" | "error";

export interface WidgetViewModel {
  statusTone: WidgetStatusTone;
  statusLabel: string;
  appName: string;
  helperText: string;
  pauseActionLabel: string;
  showObjectSlot: boolean;
  objectIconKey: string | null;
}

const WIDGET_SELF_EXECUTABLES = new Set([
  "patina.exe",
  "patina",
  "time-tracker.exe",
  "time-tracker",
  "time_tracker.exe",
  "time_tracker",
  "timetracker.exe",
  "timetracker",
  "time tracker.exe",
  "time tracker",
]);

const WIDGET_SELF_WINDOW_TITLES = new Set([
  "Patina Widget",
  "Time Tracker Widget",
  "Time Tracking",
]);

export function isWidgetSelfWindow(activeWindow: TrackingWindowSnapshot | null): boolean {
  if (!activeWindow) {
    return false;
  }

  const normalizedExeName = AppClassification.normalizeExecutable(activeWindow.exeName);
  if (WIDGET_SELF_EXECUTABLES.has(normalizedExeName)) {
    return true;
  }

  return WIDGET_SELF_WINDOW_TITLES.has(activeWindow.title.trim());
}

function resolveTrackableAppName(activeWindow: TrackingWindowSnapshot | null): string | null {
  const exeName = activeWindow?.exeName?.trim();
  if (!exeName || !AppClassification.shouldTrackApp(exeName)) {
    return null;
  }

  return AppClassification.mapApp(exeName).name;
}

function isSustainedParticipationTracking(
  trackingStatus: TrackingStatusSnapshot,
  isTrackingForegroundApp: boolean,
) {
  return isTrackingForegroundApp && trackingStatus.sustainedParticipationActive;
}

function isHardDegradedProbeStatus(status: TrackingRuntimeProbeStatus | null | undefined) {
  return status === "hard-degraded-fallback" || status === "hard-degraded-inactive";
}

function buildActiveTrackingViewModel(
  activeWindow: TrackingWindowSnapshot | null,
  trackableAppName: string | null,
  options: {
    statusTone: WidgetStatusTone;
    statusLabel: string;
    helperText: string;
  },
): WidgetViewModel {
  const text = UI_TEXT.widget;
  return {
    statusTone: options.statusTone,
    statusLabel: options.statusLabel,
    appName: trackableAppName ?? text.currentApp,
    helperText: options.helperText,
    pauseActionLabel: text.pause,
    showObjectSlot: true,
    objectIconKey: activeWindow ? AppClassification.resolveCanonicalExecutable(activeWindow.exeName) : null,
  };
}

export function buildWidgetViewModel(
  activeWindow: TrackingWindowSnapshot | null,
  trackingStatus: TrackingStatusSnapshot,
  appSettings: AppSettings,
  trackerHealth: TrackerHealthSnapshot,
  trackingRuntimeProbeStatus: TrackingRuntimeProbeStatus | null = null,
): WidgetViewModel {
  const text = UI_TEXT.widget;
  const trackableAppName = resolveTrackableAppName(activeWindow);
  const hasTrackableForegroundApp = trackableAppName !== null;
  const isSustainedParticipationActive = trackingStatus.sustainedParticipationActive;
  const isTrackingForegroundApp = Boolean(
    activeWindow
    && (!activeWindow.isAfk || isSustainedParticipationActive)
    && hasTrackableForegroundApp
    && trackingStatus.isTrackingActive,
  );

  if (trackerHealth.status !== "healthy" || isHardDegradedProbeStatus(trackingRuntimeProbeStatus)) {
    return {
      statusTone: "error",
      statusLabel: text.error,
      appName: hasTrackableForegroundApp ? trackableAppName : text.trackingService,
      helperText: text.trackingNotSynced,
      pauseActionLabel: appSettings.trackingPaused ? text.resume : text.pause,
      showObjectSlot: false,
      objectIconKey: null,
    };
  }

  if (appSettings.trackingPaused) {
    return {
      statusTone: "paused",
      statusLabel: text.paused,
      appName: hasTrackableForegroundApp ? trackableAppName : text.trackingPaused,
      helperText: text.clickToResume,
      pauseActionLabel: text.resume,
      showObjectSlot: false,
      objectIconKey: null,
    };
  }

  if (!isTrackingForegroundApp) {
    return {
      statusTone: "idle",
      statusLabel: text.idle,
      appName: activeWindow?.isAfk
        ? text.currentlyIdle
        : hasTrackableForegroundApp
          ? trackableAppName
          : text.currentAppNotTracked,
      helperText: activeWindow?.isAfk
        ? text.noTrackableActivity
        : hasTrackableForegroundApp
          ? text.noTrackableActivity
          : text.windowExcluded,
      pauseActionLabel: text.pause,
      showObjectSlot: false,
      objectIconKey: null,
    };
  }

  if (isSustainedParticipationTracking(trackingStatus, isTrackingForegroundApp)) {
    return buildActiveTrackingViewModel(activeWindow, trackableAppName, {
      statusTone: "tracking-sustained",
      statusLabel: text.sustainedTracking,
      helperText: text.currentSustainedRecording,
    });
  }

  return buildActiveTrackingViewModel(activeWindow, trackableAppName, {
    statusTone: "tracking",
    statusLabel: text.tracking,
    helperText: text.currentActivityRecording,
  });
}
