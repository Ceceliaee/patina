import { AppClassification } from "../../shared/classification/appClassification.ts";

import type { AppSettings } from "../../shared/settings/appSettings.ts";
import type { UiText } from "../../shared/i18n/index.ts";
import type {
  TrackerHealthSnapshot,
  TrackingRuntimeProbeStatus,
  TrackingStatusSnapshot,
  TrackingWindowSnapshot,
} from "../../shared/types/tracking.ts";

type MiniStatusTone = "tracking" | "tracking-sustained" | "paused" | "idle" | "error";

interface MiniViewModel {
  statusTone: MiniStatusTone;
  statusLabel: string;
  appName: string;
  objectIconKey: string | null;
}

export function isMiniSelfWindow(activeWindow: TrackingWindowSnapshot | null): boolean {
  return activeWindow?.exeName.trim().toLowerCase() === "patina.exe";
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
    statusTone: MiniStatusTone;
    statusLabel: string;
    text: UiText["miniWindow"];
  },
): MiniViewModel {
  const text = options.text;
  return {
    statusTone: options.statusTone,
    statusLabel: options.statusLabel,
    appName: trackableAppName ?? text.currentApp,
    objectIconKey: activeWindow ? AppClassification.resolveStatisticalApp(activeWindow.exeName) : null,
  };
}

export function buildMiniViewModel(
  activeWindow: TrackingWindowSnapshot | null,
  trackingStatus: TrackingStatusSnapshot,
  appSettings: AppSettings,
  trackerHealth: TrackerHealthSnapshot,
  trackingRuntimeProbeStatus: TrackingRuntimeProbeStatus | null = null,
  uiText: UiText,
): MiniViewModel {
  const text = uiText.miniWindow;
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
