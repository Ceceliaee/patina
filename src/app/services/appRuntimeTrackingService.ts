import type {
  CurrentTrackingSnapshot,
  TrackingDataChangedPayload,
  TrackingWindowSnapshot,
} from "../../shared/types/tracking";
import {
  getCurrentTrackingSnapshot,
  onActiveWindowChanged,
  onTrackingDataChanged,
} from "../../platform/runtime/trackingRuntimeGateway";

export async function loadCurrentTrackingSnapshot(): Promise<CurrentTrackingSnapshot | null> {
  return getCurrentTrackingSnapshot();
}

export async function subscribeActiveWindowChanged(
  handler: (window: TrackingWindowSnapshot) => void | Promise<void>,
): Promise<() => void> {
  return onActiveWindowChanged(handler);
}

export async function subscribeTrackingDataChanged(
  handler: (payload: TrackingDataChangedPayload) => void | Promise<void>,
): Promise<() => void> {
  return onTrackingDataChanged(handler);
}
