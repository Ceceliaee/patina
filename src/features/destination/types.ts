import type { TrackerHealthSnapshot } from "../../shared/types/tracking.ts";

export type DestinationDetailMode = "app" | "web";

export interface DestinationDetailTarget {
  mode: DestinationDetailMode;
  key: string;
  identityKeys: string[];
  displayName: string;
  secondaryText: string;
  iconUrl: string | null;
  color: string;
}

export interface DestinationDetailOpenRequest {
  target: DestinationDetailTarget;
  initialDateKey: string;
}

export interface DestinationDetailRuntimeContext {
  refreshKey: number;
  mappingVersion: number;
  mergeThresholdSecs: number;
  trackerHealth: TrackerHealthSnapshot;
}

function normalizeIdentityKey(value: string) {
  return value.trim().toLowerCase();
}

export function createDestinationDetailTarget(
  target: DestinationDetailTarget,
): DestinationDetailTarget {
  const key = normalizeIdentityKey(target.key);
  const identityKeys = Array.from(new Set(
    (target.identityKeys.length > 0 ? target.identityKeys : [target.key])
      .map(normalizeIdentityKey)
      .filter(Boolean),
  ));
  return {
    ...target,
    key,
    identityKeys: identityKeys.length > 0 ? identityKeys : [key],
    displayName: target.displayName.trim() || target.key,
    secondaryText: target.secondaryText.trim() || target.key,
  };
}
