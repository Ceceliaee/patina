import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { AggregateSessionRecord } from "../../../platform/persistence/sessionReadRepository.ts";
import { resolveStatisticalDataAppKey } from "./dataHeatmapReadModel.ts";

export interface DataSessionIdentity {
  appKey: string;
  displayName: string;
  displayNameRank: number;
}

function resolveDataDisplayName(session: AggregateSessionRecord, appKey: string) {
  const overrideDisplayName = AppClassification.getUserOverride(appKey)?.displayName?.trim();
  if (overrideDisplayName) return overrideDisplayName;
  if (appKey !== AppClassification.normalizeExecutable(session.exeName)) {
    return AppClassification.mapApp(appKey).name;
  }
  return session.appName.trim() || AppClassification.mapApp(appKey).name;
}

function resolveDataDisplayNameRank(session: AggregateSessionRecord, appKey: string) {
  const isCanonicalExecutable = AppClassification.normalizeExecutable(session.exeName) === appKey;
  return AppClassification.getUserOverride(appKey)?.displayName?.trim()
    ? 3 : (isCanonicalExecutable ? (session.appName.trim() ? 2 : 1) : 0);
}

// Create per synchronous aggregation: later queries must observe changed filters and links.
export function createDataSessionIdentityResolver(includeAppBuckets: boolean) {
  const identities = new Map<string, DataSessionIdentity | null>();
  return (session: AggregateSessionRecord): DataSessionIdentity | null => {
    const identityKey = session.exeName.length + session.appName.length <= 1024
      ? `${session.exeName.length}:${session.exeName}${session.appName}` : null;
    let identity = identityKey === null ? undefined : identities.get(identityKey);
    if (identity === undefined) {
      const appKey = resolveStatisticalDataAppKey(session);
      identity = appKey ? {
        appKey,
        displayName: includeAppBuckets ? resolveDataDisplayName(session, appKey) : "",
        displayNameRank: includeAppBuckets ? resolveDataDisplayNameRank(session, appKey) : 0,
      } : null;
      if (identityKey !== null && identities.size < 128) identities.set(identityKey, identity);
    }
    return identity;
  };
}
