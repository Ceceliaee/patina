import type { AppStat } from "../types/app";
import type { DailySummary, HistorySession, TitleSampleDetail } from "../types/sessions";
import { AppClassification } from "../classification/appClassification.ts";
import { cleanWindowTitle } from "./windowTitleCleaner.ts";

const DIRECT_MERGE_GAP_MS = 5_000;

export type SessionDiagnosticCode = "tracker_stale_live_session";

export interface DiagnosableHistorySession extends HistorySession {
  diagnosticCodes?: SessionDiagnosticCode[];
  suspiciousDuration?: number;
}

export interface SessionRange {
  startMs: number;
  endMs: number;
}

export interface CompileSessionsOptions extends SessionRange {
  minSessionSecs: number;
  keepLatestLiveSession?: boolean;
}

export interface CompiledSession extends HistorySession {
  // Stable grouping key for stats and timeline merges.
  appKey: string;
  continuityGroupStartTime: number;
  mergedCount: number;
  // User-facing display name produced by normalization rules.
  displayName: string;
  displayTitle: string;
  titleSamples: string[];
  titleSampleDetails: Array<TitleSampleDetail & { endTime: number }>;
  sourceIds: number[];
  diagnosticCodes: SessionDiagnosticCode[];
  suspiciousDuration: number;
  isLive: boolean;
}

export type TimelineSession = CompiledSession;

export interface NormalizedAppSummaryItem {
  exeName: string;
  appName: string;
  duration: number;
  suspiciousDuration: number;
  percentage: number;
}

function getSessionRawEndTime(session: HistorySession) {
  const duration = Math.max(0, session.duration ?? 0);
  return session.endTime ?? (session.startTime + duration);
}

function normalizeTitle(title: string, displayName: string) {
  const normalized = title.trim();
  if (!normalized) return "";
  return normalized.toLowerCase() === displayName.trim().toLowerCase() ? "" : normalized;
}

function mergeTitleSampleDetails(
  current: Array<TitleSampleDetail & { endTime: number }>,
  incoming: Array<TitleSampleDetail & { endTime: number }>,
) {
  const merged = current.map((sample) => ({ ...sample }));

  for (const sample of incoming) {
    const title = sample.title.trim();
    if (!title) continue;

    const previous = merged[merged.length - 1];
    if (
      previous
      && previous.title === title
    ) {
      previous.endTime = Math.max(previous.endTime, sample.endTime);
      continue;
    }

    merged.push({ ...sample, title });
  }

  return merged;
}

function titleSamplesFromDetails(titleSampleDetails: TitleSampleDetail[]) {
  return titleSampleDetails.map((sample) => sample.title);
}

function summarizeTitleSamples(titleSamples: string[]) {
  if (titleSamples.length === 0) return "";
  if (titleSamples.length === 1) return titleSamples[0];
  return `${titleSamples[0]} +${titleSamples.length - 1}`;
}

function mergeDiagnosticCodes(
  current: SessionDiagnosticCode[],
  incoming: SessionDiagnosticCode[],
) {
  return Array.from(new Set([...current, ...incoming]));
}

function shouldTrackInReadModel(session: HistorySession) {
  const exeName = session.exeName;
  const canonicalExe = AppClassification.resolveCanonicalExecutable(exeName);
  return AppClassification.shouldTrackProcess(exeName, {
    appName: session.appName,
    windowTitle: session.windowTitle,
  }) && AppClassification.shouldTrackApp(canonicalExe);
}

function resolveCompiledDisplayName(
  session: DiagnosableHistorySession,
  appKey: string,
) {
  const overrideDisplayName = AppClassification.getUserOverride(appKey)?.displayName?.trim();
  if (overrideDisplayName) {
    return overrideDisplayName;
  }

  const canonicalName = AppClassification.resolveCanonicalDisplayName(appKey);
  if (canonicalName) {
    return canonicalName;
  }

  const rawExeKey = AppClassification.normalizeExecutable(session.exeName);

  if (appKey !== rawExeKey) {
    // For alias executables (installer/updater/tray variants), prefer the
    // canonical app identity over raw product metadata from the alias process.
    return AppClassification.mapApp(appKey).name;
  }

  const mapped = AppClassification.mapApp(appKey, { appName: session.appName });
  const appName = session.appName.trim();
  if (appName) {
    return appName;
  }

  return mapped.name;
}

function resolveStatsExeName(session: CompiledSession) {
  const rawExeKey = AppClassification.normalizeExecutable(session.exeName);
  // Keep original exeName only when it already matches the canonical key.
  // Otherwise persist the canonical executable as the stats identity.
  return session.appKey === rawExeKey ? session.exeName : session.appKey;
}

function containsCjkCharacters(value: string) {
  return /[\u3400-\u9fff]/.test(value);
}

function scoreDisplayNameForStats(name: string) {
  const normalized = name.trim();
  if (!normalized) return 0;

  const lower = normalized.toLowerCase();
  if (lower.includes("tray") || lower.includes("widget")) return 1;
  if (containsCjkCharacters(normalized)) return 4;
  if (lower.includes("_") || lower.includes("-")) return 2;
  return 3;
}

function pickPreferredAppName(current: string, next: string) {
  const currentScore = scoreDisplayNameForStats(current);
  const nextScore = scoreDisplayNameForStats(next);
  return nextScore > currentScore ? next : current;
}

function prepareSession(
  session: DiagnosableHistorySession,
): CompiledSession {
  const rawEndTime = Math.max(session.startTime, getSessionRawEndTime(session));
  const appKey = AppClassification.resolveCanonicalExecutable(session.exeName);
  const displayName = resolveCompiledDisplayName(session, appKey);
  const cleanedTitle = cleanWindowTitle(session.windowTitle, session.exeName);
  const normalizedTitle = normalizeTitle(cleanedTitle, displayName);
  const rawTitleSamples = session.titleSampleDetails ?? [];
  const titleSampleDetails = rawTitleSamples
    .map((sample) => {
      const cleanedSampleTitle = cleanWindowTitle(sample.title, session.exeName);
      const title = normalizeTitle(cleanedSampleTitle, displayName);
      const startTime = Math.max(session.startTime, sample.startTime);
      const sampleEndTime = sample.endTime ?? rawEndTime;
      const endTime = Math.min(rawEndTime, Math.max(startTime, sampleEndTime));
      return { title, startTime, endTime };
    })
    .filter((sample) => sample.title && sample.endTime > sample.startTime)
    .sort((a, b) => a.startTime - b.startTime);
  const normalizedTitleSampleDetails = mergeTitleSampleDetails([], titleSampleDetails);
  const fallbackTitleSampleDetails = normalizedTitle ? [{
    title: normalizedTitle,
    startTime: session.startTime,
    endTime: rawEndTime,
  }] : [];

  return {
    ...session,
    endTime: rawEndTime,
    duration: rawEndTime - session.startTime,
    continuityGroupStartTime:
      session.continuityGroupStartTime ?? session.startTime,
    appKey,
    mergedCount: 1,
    displayName,
    displayTitle: normalizedTitle,
    titleSamples: titleSamplesFromDetails(
      normalizedTitleSampleDetails.length > 0
        ? normalizedTitleSampleDetails
        : fallbackTitleSampleDetails,
    ),
    titleSampleDetails: normalizedTitleSampleDetails.length > 0
      ? normalizedTitleSampleDetails
      : fallbackTitleSampleDetails,
    sourceIds: [session.id],
    diagnosticCodes: [...(session.diagnosticCodes ?? [])],
    suspiciousDuration: Math.max(0, session.suspiciousDuration ?? 0),
    isLive: session.endTime === null,
  };
}

function clipCompiledSession(
  session: CompiledSession,
  rangeStartMs: number,
  rangeEndMs: number,
): CompiledSession | null {
  const clippedStart = Math.max(session.startTime, rangeStartMs);
  const clippedEnd = Math.min(session.endTime ?? session.startTime, rangeEndMs);

  if (clippedEnd <= clippedStart) {
    return null;
  }

  const titleSampleDetails = session.titleSampleDetails
    .map((sample) => ({
      ...sample,
      startTime: Math.max(sample.startTime, clippedStart),
      endTime: Math.min(sample.endTime, clippedEnd),
    }))
    .filter((sample) => sample.endTime > sample.startTime);

  return {
    ...session,
    startTime: clippedStart,
    endTime: clippedEnd,
    duration: clippedEnd - clippedStart,
    titleSampleDetails,
    titleSamples: titleSamplesFromDetails(titleSampleDetails),
    suspiciousDuration: Math.min(Math.max(0, session.suspiciousDuration), clippedEnd - clippedStart),
  };
}

function finalizeCompiledSession(session: CompiledSession): CompiledSession {
  const titleSamples = titleSamplesFromDetails(session.titleSampleDetails);
  const displayTitle = summarizeTitleSamples(titleSamples);

  return {
    ...session,
    titleSamples,
    windowTitle: displayTitle,
    displayTitle,
  };
}

function buildCompiledSessionBase(
  sessions: DiagnosableHistorySession[],
  minSessionSecs: number,
  keepLatestLiveSession: boolean = false,
): CompiledSession[] {
  const directMergeGapMs = minSessionSecs > 0 ? DIRECT_MERGE_GAP_MS : 0;
  const prepared = sessions
    .filter((session) => shouldTrackInReadModel(session))
    .map((session) => prepareSession(session))
    .sort((a, b) => a.startTime - b.startTime);

  const merged = prepared.reduce<CompiledSession[]>((acc, session) => {
    const previous = acc[acc.length - 1];
    if (!previous) {
      acc.push({ ...session });
      return acc;
    }

    const previousEnd = previous.endTime ?? previous.startTime;
    const gap = session.startTime - previousEnd;
    const sameApp = previous.appKey === session.appKey;

    if (sameApp && gap >= 0 && gap <= directMergeGapMs) {
      previous.endTime = Math.max(previousEnd, session.endTime ?? session.startTime);
      previous.duration = (previous.endTime ?? previousEnd) - previous.startTime;
      previous.continuityGroupStartTime = Math.min(
        previous.continuityGroupStartTime,
        session.continuityGroupStartTime,
      );
      previous.mergedCount += session.mergedCount;
      previous.titleSampleDetails = mergeTitleSampleDetails(
        previous.titleSampleDetails,
        session.titleSampleDetails,
      );
      previous.titleSamples = titleSamplesFromDetails(previous.titleSampleDetails);
      previous.sourceIds = [...previous.sourceIds, ...session.sourceIds];
      previous.diagnosticCodes = mergeDiagnosticCodes(previous.diagnosticCodes, session.diagnosticCodes);
      previous.suspiciousDuration += session.suspiciousDuration;
      previous.isLive = previous.isLive || session.isLive;
      return acc;
    }

    acc.push({ ...session });
    return acc;
  }, []);

  const minDurationMs = Math.max(0, minSessionSecs) * 1000;
  const latestLiveSession = merged.reduce<CompiledSession | null>((latest, session) => {
    if (!session.isLive) {
      return latest;
    }

    if (!latest) {
      return session;
    }

    const latestEnd = latest.endTime ?? latest.startTime;
    const sessionEnd = session.endTime ?? session.startTime;
    return sessionEnd >= latestEnd ? session : latest;
  }, null);

  return merged
    .filter((session) => (
      (session.duration ?? 0) >= minDurationMs
      || (keepLatestLiveSession && latestLiveSession === session)
    ))
    .map(finalizeCompiledSession);
}

function getClippedDuration(
  session: CompiledSession,
  rangeStartMs: number,
  rangeEndMs: number,
) {
  const clippedStart = Math.max(session.startTime, rangeStartMs);
  const clippedEnd = Math.min(session.endTime ?? session.startTime, rangeEndMs);
  return Math.max(0, clippedEnd - clippedStart);
}

function formatDateKey(timestampMs: number) {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getDayRange(date: Date, nowMs: number = Date.now()): SessionRange {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    startMs: start.getTime(),
    endMs: Math.min(end.getTime(), nowMs),
  };
}

export function getRollingDayRanges(dayCount: number, nowMs: number = Date.now()): SessionRange[] {
  const ranges: SessionRange[] = [];
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);

  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(day.getDate() - offset);
    ranges.push(getDayRange(day, nowMs));
  }

  return ranges;
}

export function compileSessions(
  sessions: DiagnosableHistorySession[],
  options: CompileSessionsOptions,
): CompiledSession[] {
  return buildCompiledSessionBase(sessions, options.minSessionSecs, options.keepLatestLiveSession)
    .map((session) => clipCompiledSession(session, options.startMs, options.endMs))
    .filter((session): session is CompiledSession => Boolean(session));
}

export function buildNormalizedAppStats(sessions: CompiledSession[]): AppStat[] {
  const totals = new Map<string, {
    appName: string;
    exeName: string;
    totalDuration: number;
    suspiciousDuration: number;
  }>();

  for (const session of sessions) {
    const duration = Math.max(0, session.duration ?? 0);
    const suspiciousDuration = Math.max(0, session.suspiciousDuration);
    const existing = totals.get(session.appKey);

    if (existing) {
      existing.totalDuration += duration;
      existing.suspiciousDuration += suspiciousDuration;
      existing.appName = pickPreferredAppName(existing.appName, session.displayName);
      continue;
    }

    totals.set(session.appKey, {
      appName: session.displayName,
      exeName: resolveStatsExeName(session),
      totalDuration: duration,
      suspiciousDuration: suspiciousDuration,
    });
  }

  return Array.from(totals.values()).sort((a, b) => b.totalDuration - a.totalDuration);
}

export function buildAppSummary(
  stats: AppStat[],
): NormalizedAppSummaryItem[] {
  const totalDayDuration = stats.reduce((sum, item) => sum + item.totalDuration, 0);

  return stats.map((item) => ({
    exeName: item.exeName,
    appName: item.appName,
    duration: item.totalDuration,
    suspiciousDuration: item.suspiciousDuration,
    percentage: totalDayDuration > 0 ? (item.totalDuration / totalDayDuration) * 100 : 0,
  }));
}

export function buildTimelineSessions(
  sessions: CompiledSession[],
  mergeThresholdSecs: number = 180,
): TimelineSession[] {
  if (sessions.length === 0) return [];

  const mergeThresholdMs = Math.max(0, mergeThresholdSecs) * 1000;
  const result: TimelineSession[] = [];
  let i = 0;

  while (i < sessions.length) {
    const current: TimelineSession = {
      ...sessions[i],
      titleSamples: [...sessions[i].titleSamples],
      titleSampleDetails: sessions[i].titleSampleDetails.map((sample) => ({ ...sample })),
    };
    let j = i + 1;

    while (j < sessions.length) {
      const nextCandidate = sessions[j];
      const prevSession = sessions[j - 1];
      const prevEnd = prevSession.endTime ?? prevSession.startTime;
      const gapToNext = nextCandidate.startTime - prevEnd;

      if (gapToNext > mergeThresholdMs) {
        break;
      }

      if (nextCandidate.appKey === current.appKey) {
        const currentEnd = current.endTime ?? current.startTime;
        const gapFromCurrent = nextCandidate.startTime - currentEnd;
        const sharesContinuityGroup =
          current.continuityGroupStartTime ===
          nextCandidate.continuityGroupStartTime;

        if (sharesContinuityGroup || gapFromCurrent <= mergeThresholdMs) {
          current.endTime = Math.max(currentEnd, nextCandidate.endTime ?? nextCandidate.startTime);
          current.duration = Math.max(0, current.duration ?? 0) + Math.max(0, nextCandidate.duration ?? 0);
          current.continuityGroupStartTime = Math.min(
            current.continuityGroupStartTime,
            nextCandidate.continuityGroupStartTime,
          );
          current.mergedCount += nextCandidate.mergedCount;
          current.titleSampleDetails = mergeTitleSampleDetails(
            current.titleSampleDetails,
            nextCandidate.titleSampleDetails,
          );
          current.titleSamples = titleSamplesFromDetails(current.titleSampleDetails);
          current.sourceIds = [...current.sourceIds, ...nextCandidate.sourceIds];
          current.diagnosticCodes = mergeDiagnosticCodes(current.diagnosticCodes, nextCandidate.diagnosticCodes);
          current.suspiciousDuration += nextCandidate.suspiciousDuration;
          current.isLive = current.isLive || nextCandidate.isLive;
          current.displayTitle = summarizeTitleSamples(current.titleSamples);
          current.windowTitle = current.displayTitle;
          i = j;
          j += 1;
          continue;
        }

        break;
      }

      j += 1;
    }

    result.push(current);
    i += 1;
  }

  return result;
}

export function buildDailySummaries(
  sessions: HistorySession[],
  dayRanges: SessionRange[],
  minSessionSecs: number,
): DailySummary[] {
  const compiled = buildCompiledSessionBase(sessions, minSessionSecs, false);

  return dayRanges.map((range) => {
    return {
      date: formatDateKey(range.startMs),
      totalDuration: compiled.reduce(
        (sum, session) => sum + getClippedDuration(session, range.startMs, range.endMs),
        0,
      ),
    };
  });
}
