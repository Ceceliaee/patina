import type { TrackerHealthSnapshot, TrackerHealthStatus } from "../types/tracking.ts";
import {
  compileSessions,
  type CompiledSession,
  type DiagnosableHistorySession,
} from "./sessionReadCompiler.ts";

export interface ReadModelDiagnostics {
  trackerStatus: TrackerHealthStatus;
  lastHeartbeatMs: number | null;
  liveCutoffMs: number;
  suspiciousSessionCount: number;
  suspiciousDuration: number;
  suspiciousAppCount: number;
  hasWarnings: boolean;
}

export function resolveLiveCutoffMs(trackerHealth: TrackerHealthSnapshot, nowMs: number): number {
  if (trackerHealth.status === "healthy") {
    return nowMs;
  }

  return trackerHealth.lastHeartbeatMs ?? 0;
}

export function materializeLiveSessions(
  sessions: DiagnosableHistorySession[],
  trackerHealth: TrackerHealthSnapshot,
  nowMs: number,
): DiagnosableHistorySession[] {
  if (!sessions.some((session) => session.endTime === null)) {
    return sessions;
  }

  const liveCutoffMs = resolveLiveCutoffMs(trackerHealth, nowMs);

  return sessions.map((session) => {
    if (session.endTime !== null) {
      return session;
    }

    return {
      ...session,
      duration: Math.max(0, liveCutoffMs - session.startTime),
      diagnosticCodes: trackerHealth.status === "stale" ? ["tracker_stale_live_session"] : [],
      suspiciousDuration: trackerHealth.status === "stale"
        ? Math.max(0, liveCutoffMs - session.startTime)
        : 0,
    };
  });
}

export function buildReadModelDiagnostics(
  compiledSessions: CompiledSession[],
  trackerHealth: TrackerHealthSnapshot,
  liveCutoffMs: number,
): ReadModelDiagnostics {
  let suspiciousSessionCount = 0;
  let suspiciousDuration = 0;
  const suspiciousApps = new Set<string>();
  for (const session of compiledSessions) {
    if (session.diagnosticCodes.length > 0) {
      suspiciousSessionCount += 1;
    }
    const sessionSuspiciousDuration = Math.max(0, session.suspiciousDuration);
    suspiciousDuration += sessionSuspiciousDuration;
    if (sessionSuspiciousDuration > 0) {
      suspiciousApps.add(session.appKey);
    }
  }
  const suspiciousAppCount = suspiciousApps.size;

  return {
    trackerStatus: trackerHealth.status,
    lastHeartbeatMs: trackerHealth.lastHeartbeatMs,
    liveCutoffMs,
    suspiciousSessionCount,
    suspiciousDuration,
    suspiciousAppCount,
    hasWarnings: trackerHealth.status === "stale" || suspiciousSessionCount > 0,
  };
}

export function compileForRange(
  sessions: DiagnosableHistorySession[],
  range: { startMs: number; endMs: number },
  minSessionSecs: number,
  options: { keepLatestLiveSession?: boolean } = {},
): CompiledSession[] {
  return compileSessions(sessions, {
    startMs: range.startMs,
    endMs: range.endMs,
    minSessionSecs,
    keepLatestLiveSession: options.keepLatestLiveSession,
  });
}
