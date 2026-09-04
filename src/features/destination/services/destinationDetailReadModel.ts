import {
  getHistoryByDate,
} from "../../../platform/persistence/sessionReadRepository.ts";
import {
  getWebActivitySegmentsInRange,
} from "../../../platform/persistence/webActivityRepository.ts";
import type { HistorySession } from "../../../shared/types/sessions.ts";
import type { TrackerHealthStatus } from "../../../shared/types/tracking.ts";
import type { WebActivitySegment } from "../../../shared/types/webActivity.ts";
import {
  addLocalDays,
  parseLocalDateKey,
} from "../../../shared/lib/localDate.ts";
import {
  compileWebActivitySegments,
  mergeWebActivityTimelineItemsByDomain,
} from "../../../shared/lib/webActivityTimelineCompiler.ts";
import { materializeLiveSessions } from "../../../shared/lib/readModelCore.ts";
import {
  buildTimelineSessions,
  compileSessions,
} from "../../../shared/lib/sessionReadCompiler.ts";
import type { DestinationDetailTarget } from "../types.ts";

export interface DestinationDetailRecord {
  id: string;
  activityId: string;
  sourceActivityIds?: string[];
  startTime: number;
  endTime: number;
  duration: number;
  startRatio: number;
  endRatio: number;
  title: string | null;
  secondaryText: string | null;
  url: string | null;
  current: boolean;
  intervals?: Array<{ startTime: number; endTime: number }>;
}

export interface DestinationDetailActivity {
  id: string;
  activityCount?: number;
  startTime: number;
  endTime: number;
  duration: number;
  current: boolean;
  records: DestinationDetailRecord[];
  detailRecords?: DestinationDetailRecord[];
}

export type DestinationDetailTitleRecord = DestinationDetailRecord & {
  title: string;
};

export interface DestinationDetailDayViewModel {
  dateKey: string;
  dayStartMs: number;
  dayEndMs: number;
  records: DestinationDetailRecord[];
  activities: DestinationDetailActivity[];
  totalDuration: number;
  firstStartTime: number | null;
  lastEndTime: number | null;
}

interface DestinationDetailDayDependencies {
  getAppSessions: (date: Date) => Promise<HistorySession[]>;
  getWebSegments: (startMs: number, endMs: number) => Promise<WebActivitySegment[]>;
}

interface UnpositionedDetailRecord {
  id: string;
  activityId: string;
  sourceActivityIds: string[];
  startTime: number;
  endTime: number;
  title: string | null;
  secondaryText: string | null;
  url: string | null;
  current: boolean;
  sourceKey?: string;
}

interface WebDetailActivityCandidate {
  id: string;
  normalizedDomain: string;
  startTime: number;
  endTime: number;
  duration: number;
  current: boolean;
  records: UnpositionedDetailRecord[];
}

const defaultDayDependencies: DestinationDetailDayDependencies = {
  getAppSessions: getHistoryByDate,
  getWebSegments: getWebActivitySegmentsInRange,
};

function cleanOptionalText(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function normalizeIdentityKey(value: string) {
  return value.trim().toLowerCase();
}

function resolveDayBounds(dateKey: string, nowMs: number) {
  const start = parseLocalDateKey(dateKey);
  if (!start) return null;
  const requestedEnd = addLocalDays(start, 1).getTime();
  return {
    startMs: start.getTime(),
    endMs: Math.min(requestedEnd, nowMs),
    requestedEndMs: requestedEnd,
  };
}

function clipRecord(
  record: UnpositionedDetailRecord,
  startMs: number,
  endMs: number,
): UnpositionedDetailRecord | null {
  const clippedStart = Math.max(record.startTime, startMs);
  const clippedEnd = Math.min(record.endTime, endMs);
  return clippedEnd > clippedStart
    ? { ...record, startTime: clippedStart, endTime: clippedEnd }
    : null;
}

function canMergeDetailRecords(
  previous: UnpositionedDetailRecord,
  current: UnpositionedDetailRecord,
) {
  return previous.title === current.title
    && previous.activityId === current.activityId
    && previous.secondaryText === current.secondaryText
    && previous.url === current.url
    && previous.sourceKey === current.sourceKey
    && current.startTime === previous.endTime;
}

function normalizeDetailRecords(
  records: readonly UnpositionedDetailRecord[],
  dayStartMs: number,
  clipEndMs: number,
  dayEndMs: number,
): DestinationDetailRecord[] {
  const sorted = records
    .map((record) => clipRecord(record, dayStartMs, clipEndMs))
    .filter((record): record is UnpositionedDetailRecord => Boolean(record))
    .sort((left, right) => (
      left.startTime - right.startTime
      || left.endTime - right.endTime
      || left.id.localeCompare(right.id)
    ));
  const nonOverlapping: UnpositionedDetailRecord[] = [];

  for (const record of sorted) {
    const previous = nonOverlapping[nonOverlapping.length - 1];
    const clipped = { ...record };

    if (previous && canMergeDetailRecords(previous, clipped)) {
      previous.endTime = Math.max(previous.endTime, clipped.endTime);
      previous.current = previous.current || clipped.current;
      previous.sourceActivityIds = Array.from(new Set([
        ...previous.sourceActivityIds,
        ...clipped.sourceActivityIds,
      ]));
      continue;
    }
    nonOverlapping.push(clipped);
  }

  const dayDuration = Math.max(1, dayEndMs - dayStartMs);
  return nonOverlapping.map((record) => ({
    ...record,
    duration: record.endTime - record.startTime,
    startRatio: (record.startTime - dayStartMs) / dayDuration,
    endRatio: (record.endTime - dayStartMs) / dayDuration,
  }));
}

function buildDetailActivities(
  records: readonly DestinationDetailRecord[],
): DestinationDetailActivity[] {
  const activities = new Map<string, DestinationDetailActivity>();
  const activitySourceIds = new Map<string, Set<string>>();

  for (const record of records) {
    const sourceIds = record.sourceActivityIds ?? [record.id];
    const current = activities.get(record.activityId);
    if (current) {
      const currentSourceIds = activitySourceIds.get(record.activityId)!;
      sourceIds.forEach((sourceId) => currentSourceIds.add(sourceId));
      current.startTime = Math.min(current.startTime, record.startTime);
      current.endTime = Math.max(current.endTime, record.endTime);
      current.duration += record.duration;
      current.current = current.current || record.current;
      current.activityCount = currentSourceIds.size;
      current.records.push(record);
      continue;
    }

    const sourceIdSet = new Set(sourceIds);
    activitySourceIds.set(record.activityId, sourceIdSet);
    activities.set(record.activityId, {
      id: record.activityId,
      activityCount: sourceIdSet.size,
      startTime: record.startTime,
      endTime: record.endTime,
      duration: record.duration,
      current: record.current,
      records: [record],
    });
  }

  return Array.from(activities.values()).sort((left, right) => (
    left.startTime - right.startTime
    || left.endTime - right.endTime
    || left.id.localeCompare(right.id)
  ));
}

function resolveMaterializedSessionEnd(session: HistorySession) {
  if (session.endTime !== null) return session.endTime;
  return session.startTime + Math.max(0, session.duration ?? 0);
}

interface AppDetailActivityMembership {
  activityId: string;
  sourceActivityIds: string[];
}

function buildAppDetailActivityMemberships(
  sessions: readonly HistorySession[],
  target: DestinationDetailTarget,
  dayStartMs: number,
  clipEndMs: number,
  mergeThresholdSecs: number,
) {
  const identityKeys = new Set(target.identityKeys.map(normalizeIdentityKey));
  const compiled = compileSessions([...sessions], {
    startMs: dayStartMs,
    endMs: clipEndMs,
    minSessionSecs: 0,
  });
  const detailActivities = buildTimelineSessions(
    compiled.filter((session) => identityKeys.has(normalizeIdentityKey(session.appKey))),
    mergeThresholdSecs,
  );
  const memberships = new Map<string, AppDetailActivityMembership>();

  for (const activity of detailActivities) {
    const sourceActivityIds = activity.sourceIds.map((sourceId) => `app:${sourceId}`);
    const activityId = `app:${activity.appKey}:${activity.startTime}:${activity.sourceIds.join(",")}`;
    const membership = { activityId, sourceActivityIds };
    for (const sourceId of activity.sourceIds) {
      memberships.set(String(sourceId), membership);
    }
  }

  return memberships;
}

function buildAppDetailRecords(
  sessions: readonly HistorySession[],
  target: DestinationDetailTarget,
  dayStartMs: number,
  clipEndMs: number,
  dayEndMs: number,
  mergeThresholdSecs: number,
) {
  const memberships = buildAppDetailActivityMemberships(
    sessions,
    target,
    dayStartMs,
    clipEndMs,
    mergeThresholdSecs,
  );
  const records: UnpositionedDetailRecord[] = [];

  for (const session of sessions) {
    const membership = memberships.get(String(session.id));
    if (!membership) continue;
    const sessionEnd = resolveMaterializedSessionEnd(session);
    const { activityId, sourceActivityIds } = membership;

    const compiledSession = compileSessions([session], {
      startMs: dayStartMs, endMs: clipEndMs, minSessionSecs: 0,
    })[0];
    const sessionTitles = compiledSession?.titleSampleDetails ?? [];
    const samples = sessionTitles
      .map((sample, index) => ({
        ...sample,
        index,
        startTime: Math.max(session.startTime, sample.startTime),
        endTime: Math.min(
          sessionEnd,
          sample.endTime ?? sessionEnd,
        ),
      }))
      .filter((sample) => sample.endTime > sample.startTime)
      .sort((left, right) => (
        left.startTime - right.startTime
        || left.endTime - right.endTime
        || left.index - right.index
      ));
    if (samples.length === 0) {
      records.push({
        id: `app:${session.id}`,
        activityId,
        sourceActivityIds,
        startTime: session.startTime,
        endTime: sessionEnd,
        title: cleanOptionalText(compiledSession?.displayTitle),
        secondaryText: null,
        url: null,
        current: session.endTime === null,
      });
      continue;
    }

    let cursor = session.startTime;
    for (const sample of samples) {
      if (sample.startTime > cursor) {
        records.push({
          id: `app:${session.id}:gap:${cursor}`,
          activityId,
          sourceActivityIds,
          startTime: cursor,
          endTime: sample.startTime,
          title: null,
          secondaryText: null,
          url: null,
          current: false,
        });
      }

      const sampleStartTime = Math.max(cursor, sample.startTime);
      if (sample.endTime <= sampleStartTime) continue;
      records.push({
        id: `app:${session.id}:sample:${sample.index}`,
        activityId,
        sourceActivityIds,
        startTime: sampleStartTime,
        endTime: sample.endTime,
        title: cleanOptionalText(sample.title),
        secondaryText: null,
        url: null,
        current: session.endTime === null && sample.endTime >= sessionEnd,
      });
      cursor = Math.max(cursor, sample.endTime);
    }

    if (cursor < sessionEnd) {
      records.push({
        id: `app:${session.id}:gap:${cursor}`,
        activityId,
        sourceActivityIds,
        startTime: cursor,
        endTime: sessionEnd,
        title: null,
        secondaryText: null,
        url: null,
        current: session.endTime === null,
      });
    }
  }

  return normalizeDetailRecords(
    records,
    dayStartMs,
    clipEndMs,
    dayEndMs,
  );
}

function buildWebDetailRecords(
  segments: readonly WebActivitySegment[],
  target: DestinationDetailTarget,
  dayStartMs: number,
  clipEndMs: number,
  dayEndMs: number,
  nowMs: number,
  mergeThresholdSecs: number,
) {
  const normalizedDomain = normalizeIdentityKey(target.key);
  const candidates = compileWebActivitySegments(segments, dayStartMs, clipEndMs, nowMs)
    .filter(segment => segment.normalizedDomain === normalizedDomain)
    .flatMap<WebDetailActivityCandidate>((segment) => {
    const record = clipRecord({
      id: `web:${segment.id}`,
      activityId: `web:${segment.id}`,
      sourceActivityIds: segment.sourceIds.map(id => `web:${id}`),
      sourceKey: JSON.stringify([segment.browserClientId, segment.browserKind, segment.browserExeName]),
      startTime: segment.startTime,
      endTime: segment.endTime,
      title: cleanOptionalText(segment.title),
      secondaryText: cleanOptionalText(segment.url),
      url: cleanOptionalText(segment.url),
      current: segment.isLive,
    }, dayStartMs, clipEndMs);
    if (!record) return [];

    return [{
      id: `web:${segment.id}`,
      normalizedDomain: normalizeIdentityKey(segment.normalizedDomain),
      startTime: record.startTime,
      endTime: record.endTime,
      duration: record.endTime - record.startTime,
      current: record.current,
      records: [record],
    }];
  });
  const merged = mergeWebActivityTimelineItemsByDomain(
    candidates,
    mergeThresholdSecs,
    (current, next) => ({
      ...current,
      id: `${current.id}_${next.id}`,
      startTime: Math.min(current.startTime, next.startTime),
      endTime: Math.max(current.endTime, next.endTime),
      duration: current.duration + next.duration,
      current: current.current || next.current,
      records: [...current.records, ...next.records],
    }),
  );
  const records = merged
    .flatMap((candidate) => candidate.records.map((record) => ({
      ...record,
      activityId: candidate.id,
    })));

  return normalizeDetailRecords(records, dayStartMs, clipEndMs, dayEndMs);
}

function buildDayViewModel(
  dateKey: string,
  dayStartMs: number,
  dayEndMs: number,
  records: DestinationDetailRecord[],
): DestinationDetailDayViewModel {
  const activities = buildDetailActivities(records).map(activity => ({
    ...activity,
    detailRecords: groupTitleRecords(activity.records).filter(record => record.title),
  }));
  return {
    dateKey,
    dayStartMs,
    dayEndMs,
    records,
    activities,
    totalDuration: records.reduce((total, record) => total + record.duration, 0),
    firstStartTime: records[0]?.startTime ?? null,
    lastEndTime: records.reduce<number | null>((end, record) => Math.max(end ?? record.endTime, record.endTime), null),
  };
}

function groupTitleRecords(records: readonly DestinationDetailRecord[]) {
  const groups: DestinationDetailRecord[] = [];
  for (const record of records) {
    const intervals = record.intervals ?? [{ startTime: record.startTime, endTime: record.endTime }];
    const previous = groups[groups.length - 1];
    if (previous && previous.title === record.title
      && previous.secondaryText === record.secondaryText && previous.url === record.url) {
      previous.startTime = Math.min(previous.startTime, record.startTime);
      previous.endTime = Math.max(previous.endTime, record.endTime);
      previous.duration += record.duration;
      previous.intervals!.push(...intervals);
      previous.current ||= record.current;
      previous.sourceActivityIds = Array.from(new Set([
        ...(previous.sourceActivityIds ?? [previous.id]),
        ...(record.sourceActivityIds ?? [record.id]),
      ]));
    } else {
      groups.push({ ...record, intervals: [...intervals] });
    }
  }
  return groups;
}

export function getDestinationDetailTitleRecords(
  activity: DestinationDetailActivity,
): DestinationDetailTitleRecord[] {
  return (activity.detailRecords ?? activity.records)
    .filter((record): record is DestinationDetailTitleRecord => Boolean(record.title));
}

export async function loadDestinationDetailDay(
  target: DestinationDetailTarget,
  dateKey: string,
  nowMs: number = Date.now(),
  mergeThresholdSecs: number = 0,
  dependencies: DestinationDetailDayDependencies = defaultDayDependencies,
  trackerStatus: TrackerHealthStatus = "healthy",
  lastHeartbeatMs: number | null = null,
): Promise<DestinationDetailDayViewModel> {
  const bounds = resolveDayBounds(dateKey, nowMs);
  if (!bounds) {
    throw new Error(`Invalid local date key: ${dateKey}`);
  }

  if (target.mode === "app") {
    const sessions = materializeLiveSessions(
      await dependencies.getAppSessions(new Date(bounds.startMs)),
      { status: trackerStatus, lastHeartbeatMs },
      nowMs,
    );
    const detail = buildAppDetailRecords(
      sessions,
      target,
      bounds.startMs,
      bounds.endMs,
      bounds.requestedEndMs,
      mergeThresholdSecs,
    );
    return buildDayViewModel(
      dateKey,
      bounds.startMs,
      bounds.requestedEndMs,
      detail,
    );
  }

  const segments = await dependencies.getWebSegments(bounds.startMs, bounds.endMs);
  return buildDayViewModel(
    dateKey,
    bounds.startMs,
    bounds.requestedEndMs,
    buildWebDetailRecords(
      segments,
      target,
      bounds.startMs,
      bounds.endMs,
      bounds.requestedEndMs,
      nowMs,
      mergeThresholdSecs,
    ),
  );
}
