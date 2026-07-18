import type { HistorySession } from "../../../shared/types/sessions.ts";
import type { AggregateSessionRecord } from "../../../platform/persistence/sessionReadRepository.ts";
import type {
  WebActivitySegment,
  WebDomainOverride,
} from "../../../shared/types/webActivity.ts";
import {
  clearHistoryBootstrapSnapshotPayload,
  loadHistoryBootstrapSnapshotPayload,
  saveHistoryBootstrapSnapshotPayload,
} from "../../../platform/persistence/historyBootstrapSnapshotStore.ts";
import { createSerializedJobRunner } from "../../../platform/persistence/sqliteTransactions.ts";
import type { HistorySnapshot } from "./historyReadModel.ts";

const HISTORY_BOOTSTRAP_SNAPSHOT_VERSION = 1;
const HISTORY_BOOTSTRAP_SNAPSHOT_MAX_BYTES = 256 * 1024;

export interface HistoryBootstrapIdentity {
  dateKey: string;
  mappingVersion: number;
  webActivityEnabled: boolean;
}

export interface HistoryBootstrapSnapshot {
  version: typeof HISTORY_BOOTSTRAP_SNAPSHOT_VERSION;
  createdAtMs: number;
  identity: HistoryBootstrapIdentity;
  snapshot: HistorySnapshot;
}

interface HistoryBootstrapSnapshotDeps {
  clearPayload: () => Promise<void>;
  loadPayload: () => Promise<string | null>;
  savePayload: (payload: string) => Promise<void>;
  warn: (message: string, error: unknown) => void;
}

interface SaveHistoryBootstrapSnapshotOptions {
  minSaveIntervalMs?: number;
  nowMs?: number;
}

const defaultDeps: HistoryBootstrapSnapshotDeps = {
  clearPayload: clearHistoryBootstrapSnapshotPayload,
  loadPayload: loadHistoryBootstrapSnapshotPayload,
  savePayload: saveHistoryBootstrapSnapshotPayload,
  warn: console.warn,
};

let cachedSnapshot: HistoryBootstrapSnapshot | null = null;
let lastSaveAtMs = 0;
let lastSavedIdentity: HistoryBootstrapIdentity | null = null;
let cacheMutationVersion = 0;
const runSerializedHistoryBootstrapWrite = createSerializedJobRunner();

function getPayloadByteLength(payload: string): number {
  return new TextEncoder().encode(payload).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isHistoryBootstrapIdentity(value: unknown): value is HistoryBootstrapIdentity {
  if (!isRecord(value)) return false;
  return (
    typeof value.dateKey === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value.dateKey)
    && isFiniteNumber(value.mappingVersion)
    && typeof value.webActivityEnabled === "boolean"
  );
}

function isHistorySession(value: unknown): value is HistorySession {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.id)
    && typeof value.appName === "string"
    && typeof value.exeName === "string"
    && typeof value.windowTitle === "string"
    && isFiniteNumber(value.startTime)
    && isNullableFiniteNumber(value.endTime)
    && isNullableFiniteNumber(value.duration)
    && isNullableFiniteNumber(value.continuityGroupStartTime)
    && Array.isArray(value.titleSampleDetails)
    && value.titleSampleDetails.length === 0
  );
}

function isAggregateSessionRecord(value: unknown): value is AggregateSessionRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.appName === "string"
    && typeof value.exeName === "string"
    && isFiniteNumber(value.startTime)
    && isFiniteNumber(value.endTime)
    && value.endTime >= value.startTime
  );
}

function isWebActivitySegment(value: unknown): value is WebActivitySegment {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.id)
    && typeof value.browserClientId === "string"
    && typeof value.browserKind === "string"
    && typeof value.browserExeName === "string"
    && typeof value.domain === "string"
    && typeof value.normalizedDomain === "string"
    && value.url === null
    && value.title === null
    && value.faviconUrl === null
    && isFiniteNumber(value.startTime)
    && isNullableFiniteNumber(value.endTime)
    && isNullableFiniteNumber(value.duration)
  );
}

function isWebDomainOverride(value: unknown): value is WebDomainOverride {
  if (!isRecord(value)) return false;
  return (
    (value.category === undefined || typeof value.category === "string")
    && (value.displayName === undefined || typeof value.displayName === "string")
    && (value.color === undefined || typeof value.color === "string")
    && (value.enabled === undefined || typeof value.enabled === "boolean")
    && (value.captureTitle === undefined || typeof value.captureTitle === "boolean")
    && (value.updatedAt === undefined || isFiniteNumber(value.updatedAt))
  );
}

function isHistorySnapshot(value: unknown): value is HistorySnapshot {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.fetchedAtMs)
    && isRecord(value.icons)
    && Object.keys(value.icons).length === 0
    && Array.isArray(value.daySessions)
    && value.daySessions.every(isHistorySession)
    && Array.isArray(value.weeklySessions)
    && value.weeklySessions.every(isHistorySession)
    && (value.dayAggregateSessions === undefined || (
      Array.isArray(value.dayAggregateSessions)
      && value.dayAggregateSessions.every(isAggregateSessionRecord)
    ))
    && (value.weeklyAggregateSessions === undefined || (
      Array.isArray(value.weeklyAggregateSessions)
      && value.weeklyAggregateSessions.every(isAggregateSessionRecord)
    ))
    && Array.isArray(value.dayWebSegments)
    && value.dayWebSegments.every(isWebActivitySegment)
    && isRecord(value.webDomainFavicons)
    && Object.keys(value.webDomainFavicons).length === 0
    && isRecord(value.webDomainOverrides)
    && Object.values(value.webDomainOverrides).every(isWebDomainOverride)
  );
}

function isHistoryBootstrapSnapshot(value: unknown): value is HistoryBootstrapSnapshot {
  if (!isRecord(value)) return false;
  return (
    value.version === HISTORY_BOOTSTRAP_SNAPSHOT_VERSION
    && isFiniteNumber(value.createdAtMs)
    && isHistoryBootstrapIdentity(value.identity)
    && isHistorySnapshot(value.snapshot)
  );
}

function sanitizeHistorySession(session: HistorySession): HistorySession {
  return {
    id: session.id,
    appName: session.appName,
    exeName: session.exeName,
    windowTitle: "",
    startTime: session.startTime,
    endTime: session.endTime,
    duration: session.duration,
    continuityGroupStartTime: session.continuityGroupStartTime,
    titleSampleDetails: [],
  };
}

function sanitizeWebActivitySegment(segment: WebActivitySegment): WebActivitySegment {
  return {
    id: segment.id,
    browserClientId: "",
    browserKind: "",
    browserExeName: "",
    domain: segment.domain,
    normalizedDomain: segment.normalizedDomain,
    url: null,
    title: null,
    faviconUrl: null,
    startTime: segment.startTime,
    endTime: segment.endTime,
    duration: segment.duration,
  };
}

function sanitizeWebDomainOverride(override: WebDomainOverride): WebDomainOverride {
  return {
    ...(override.category === undefined ? {} : { category: override.category }),
    ...(override.displayName === undefined ? {} : { displayName: override.displayName }),
    ...(override.color === undefined ? {} : { color: override.color }),
    ...(override.enabled === undefined ? {} : { enabled: override.enabled }),
    ...(override.captureTitle === undefined ? {} : { captureTitle: override.captureTitle }),
    ...(override.updatedAt === undefined ? {} : { updatedAt: override.updatedAt }),
  };
}

function buildHistoryBootstrapSnapshot(
  snapshot: HistorySnapshot,
  identity: HistoryBootstrapIdentity,
  createdAtMs: number,
): HistoryBootstrapSnapshot {
  return {
    version: HISTORY_BOOTSTRAP_SNAPSHOT_VERSION,
    createdAtMs,
    identity: { ...identity },
    snapshot: {
      fetchedAtMs: snapshot.fetchedAtMs,
      icons: {},
      daySessions: snapshot.daySessions.map(sanitizeHistorySession),
      weeklySessions: [],
      dayAggregateSessions: (snapshot.dayAggregateSessions ?? []).map((record) => ({ ...record })),
      weeklyAggregateSessions: [],
      dayWebSegments: identity.webActivityEnabled
        ? snapshot.dayWebSegments.map(sanitizeWebActivitySegment)
        : [],
      webDomainFavicons: {},
      webDomainOverrides: identity.webActivityEnabled
        ? Object.fromEntries(
          Object.entries(snapshot.webDomainOverrides).map(([domain, override]) => [
            domain,
            sanitizeWebDomainOverride(override),
          ]),
        )
        : {},
    },
  };
}

function identitiesMatch(
  left: HistoryBootstrapIdentity,
  right: HistoryBootstrapIdentity,
): boolean {
  return (
    left.dateKey === right.dateKey
    && left.mappingVersion === right.mappingVersion
    && left.webActivityEnabled === right.webActivityEnabled
  );
}

export function getCachedHistoryBootstrapSnapshot(
  identity: HistoryBootstrapIdentity,
): HistoryBootstrapSnapshot | null {
  return cachedSnapshot && identitiesMatch(cachedSnapshot.identity, identity)
    ? cachedSnapshot
    : null;
}

export async function loadPersistedHistoryBootstrapSnapshot(
  deps: Partial<HistoryBootstrapSnapshotDeps> = {},
): Promise<HistoryBootstrapSnapshot | null> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const loadStartedAtMutationVersion = cacheMutationVersion;

  try {
    const payload = await resolvedDeps.loadPayload();
    if (cacheMutationVersion !== loadStartedAtMutationVersion) {
      return cachedSnapshot;
    }
    if (!payload) {
      cacheMutationVersion += 1;
      cachedSnapshot = null;
      lastSaveAtMs = 0;
      lastSavedIdentity = null;
      return null;
    }
    const payloadBytes = getPayloadByteLength(payload);
    if (payloadBytes > HISTORY_BOOTSTRAP_SNAPSHOT_MAX_BYTES) {
      throw new Error(`${payloadBytes} bytes exceeds the History bootstrap size budget`);
    }

    const parsed: unknown = JSON.parse(payload);
    if (!isHistoryBootstrapSnapshot(parsed)) {
      throw new Error("History bootstrap payload failed validation");
    }

    cacheMutationVersion += 1;
    cachedSnapshot = parsed;
    lastSaveAtMs = parsed.createdAtMs;
    lastSavedIdentity = { ...parsed.identity };
    return parsed;
  } catch (error) {
    if (cacheMutationVersion !== loadStartedAtMutationVersion) {
      return cachedSnapshot;
    }
    cacheMutationVersion += 1;
    cachedSnapshot = null;
    lastSaveAtMs = 0;
    lastSavedIdentity = null;
    resolvedDeps.warn("Failed to load History bootstrap snapshot", error);
    return null;
  }
}

export async function saveHistoryBootstrapSnapshot(
  snapshot: HistorySnapshot,
  identity: HistoryBootstrapIdentity,
  options: SaveHistoryBootstrapSnapshotOptions = {},
  deps: Partial<HistoryBootstrapSnapshotDeps> = {},
): Promise<boolean> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const nowMs = options.nowMs ?? Date.now();
  const minSaveIntervalMs = options.minSaveIntervalMs ?? 5 * 60 * 1000;
  const bootstrapSnapshot = buildHistoryBootstrapSnapshot(snapshot, identity, nowMs);
  const payload = JSON.stringify(bootstrapSnapshot);
  const payloadBytes = getPayloadByteLength(payload);

  if (payloadBytes > HISTORY_BOOTSTRAP_SNAPSHOT_MAX_BYTES) {
    resolvedDeps.warn(
      "Skipped History bootstrap snapshot because it exceeded the size budget",
      new Error(`${payloadBytes} bytes`),
    );
    return false;
  }

  cacheMutationVersion += 1;
  const saveMutationVersion = cacheMutationVersion;
  cachedSnapshot = bootstrapSnapshot;
  const elapsedSinceLastSaveMs = nowMs - lastSaveAtMs;
  if (
    lastSavedIdentity
    && identitiesMatch(lastSavedIdentity, identity)
    && elapsedSinceLastSaveMs >= 0
    && elapsedSinceLastSaveMs < minSaveIntervalMs
  ) {
    return false;
  }

  try {
    await runSerializedHistoryBootstrapWrite(() => resolvedDeps.savePayload(payload));
    if (cacheMutationVersion === saveMutationVersion) {
      lastSaveAtMs = nowMs;
      lastSavedIdentity = { ...identity };
    }
    return true;
  } catch (error) {
    resolvedDeps.warn("Failed to save History bootstrap snapshot", error);
    return false;
  }
}

export async function clearHistoryBootstrapSnapshot(
  deps: Partial<HistoryBootstrapSnapshotDeps> = {},
): Promise<void> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  cacheMutationVersion += 1;
  cachedSnapshot = null;
  lastSaveAtMs = 0;
  lastSavedIdentity = null;

  try {
    await runSerializedHistoryBootstrapWrite(resolvedDeps.clearPayload);
  } catch (error) {
    resolvedDeps.warn("Failed to clear History bootstrap snapshot", error);
  }
}

export function getHistoryBootstrapSnapshotStats() {
  return {
    entries: cachedSnapshot ? 1 : 0,
    limit: 1,
    maxBytes: HISTORY_BOOTSTRAP_SNAPSHOT_MAX_BYTES,
  };
}

export function resetHistoryBootstrapSnapshotForTests(): void {
  cacheMutationVersion += 1;
  cachedSnapshot = null;
  lastSaveAtMs = 0;
  lastSavedIdentity = null;
}
