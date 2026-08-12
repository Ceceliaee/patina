import { AppClassification } from "../../shared/classification/appClassification.ts";

import type { AppSettings } from "../../shared/settings/appSettings.ts";
import type { UiText } from "../../shared/i18n/index.ts";
import type {
  TrackerHealthSnapshot,
  TrackingRuntimeProbeStatus,
  TrackingStatusSnapshot,
  TrackingWindowSnapshot,
} from "../../shared/types/tracking.ts";

type WidgetStatusTone = "tracking" | "tracking-sustained" | "paused" | "idle" | "error";

interface WidgetViewModel {
  statusTone: WidgetStatusTone;
  statusLabel: string;
  appName: string;
  objectIconKey: string | null;
}

const WIDGET_SELF_WINDOW_TITLES = new Set([
  "patina",
  "patina widget",
  "time tracking",
]);

export function isWidgetSelfWindow(activeWindow: TrackingWindowSnapshot | null): boolean {
  if (!activeWindow) {
    return false;
  }

  return activeWindow.exeName.trim().toLowerCase() === "patina.exe"
    && WIDGET_SELF_WINDOW_TITLES.has(activeWindow.title.trim().toLowerCase());
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
    text: UiText["widget"];
  },
): WidgetViewModel {
  const text = options.text;
  return {
    statusTone: options.statusTone,
    statusLabel: options.statusLabel,
    appName: trackableAppName ?? text.currentApp,
    objectIconKey: activeWindow ? AppClassification.resolveCanonicalExecutable(activeWindow.exeName) : null,
  };
}

export function buildWidgetViewModel(
  activeWindow: TrackingWindowSnapshot | null,
  trackingStatus: TrackingStatusSnapshot,
  appSettings: AppSettings,
  trackerHealth: TrackerHealthSnapshot,
  trackingRuntimeProbeStatus: TrackingRuntimeProbeStatus | null = null,
  uiText: UiText,
): WidgetViewModel {
  const text = uiText.widget;
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
      objectIconKey: null,
    };
  }

  if (appSettings.trackingPaused) {
    return {
      statusTone: "paused",
      statusLabel: text.paused,
      appName: hasTrackableForegroundApp ? trackableAppName : text.trackingPaused,
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
      objectIconKey: null,
    };
  }

  if (isSustainedParticipationTracking(trackingStatus, isTrackingForegroundApp)) {
    return buildActiveTrackingViewModel(activeWindow, trackableAppName, {
      statusTone: "tracking-sustained",
      statusLabel: text.sustainedTracking,
      text,
    });
  }

  return buildActiveTrackingViewModel(activeWindow, trackableAppName, {
    statusTone: "tracking",
    statusLabel: text.tracking,
    text,
  });
}
