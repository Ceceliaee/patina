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

export function buildMiniViewModel(
  activeWindow: TrackingWindowSnapshot | null,
  trackingStatus: TrackingStatusSnapshot,
  appSettings: AppSettings,
  trackerHealth: TrackerHealthSnapshot,
  trackingRuntimeProbeStatus: TrackingRuntimeProbeStatus | null = null,
  uiText: UiText,
): MiniViewModel {
  const text = uiText.miniWindow;
  const exeName = activeWindow?.exeName.trim();
  const hasTrackableForegroundApp = Boolean(exeName && AppClassification.shouldTrackApp(exeName));
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
    };
  }

  if (appSettings.trackingPaused) {
    return {
      statusTone: "paused",
      statusLabel: text.paused,
    };
  }

  if (!isTrackingForegroundApp) {
    return {
      statusTone: "idle",
      statusLabel: text.idle,
    };
  }

  if (isSustainedParticipationTracking(trackingStatus, isTrackingForegroundApp)) {
    return {
      statusTone: "tracking-sustained",
      statusLabel: text.sustainedTracking,
    };
  }

  return {
    statusTone: "tracking",
    statusLabel: text.tracking,
  };
}
