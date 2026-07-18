import { getDB } from "./sqlite.ts";
import { AppClassification } from "../../shared/classification/appClassification.ts";
import type { HistorySession, TitleSampleDetail } from "../../shared/types/sessions.ts";

interface RawHistorySessionRow {
  id: number;
  app_name: string;
  exe_name: string;
  window_title: string;
  start_time: number;
  end_time: number | null;
  duration: number | null;
  continuity_group_start_time: number | null;
}

interface RawTitleSampleRow {
  session_id: number;
  title: string;
  start_time: number;
  end_time: number | null;
}

interface RawIconCacheRow {
  exe_name: string;
  icon_base64: string;
}

export interface RawAggregateSessionCandidateRow {
  app_name: string;
  exe_name: string;
  window_title: string;
  start_time: number;
  effective_end_time: number;
}

export interface AggregateSessionRecord {
  appName: string;
  exeName: string;
  startTime: number;
  endTime: number;
}

const ICON_QUERY_BATCH_SIZE = 900;

function mapRawTitleSample(row: RawTitleSampleRow): TitleSampleDetail {
  return {
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time,
  };
}

function mapRawHistorySession(
  row: RawHistorySessionRow,
  titleSampleDetails: TitleSampleDetail[] = [],
): HistorySession {
  return {
    id: row.id,
    appName: row.app_name,
    exeName: row.exe_name,
    windowTitle: row.window_title,
    startTime: row.start_time,
    endTime: row.end_time,
    duration: row.duration,
    continuityGroupStartTime: row.continuity_group_start_time,
    titleSampleDetails,
  };
}

export function mapRawAggregateSessionCandidates(
  rows: RawAggregateSessionCandidateRow[],
): AggregateSessionRecord[] {
  return rows
    .filter((row) => AppClassification.shouldTrackProcess(row.exe_name, {
      appName: row.app_name,
      windowTitle: row.window_title,
    }))
    .map((row) => ({
      appName: row.app_name,
      exeName: row.exe_name,
      startTime: row.start_time,
      endTime: Math.max(row.start_time, row.effective_end_time),
    }));
}

function collectIconLookupKeys(exeName: string): string[] {
  const rawExe = exeName.trim();
  if (!rawExe) return [];

  const lowerExe = rawExe.toLowerCase();
  const normalizedExe = AppClassification.normalizeExecutable(rawExe);
  const canonicalExe = AppClassification.resolveCanonicalExecutable(rawExe);

  return Array.from(new Set([
    rawExe,
    lowerExe,
    normalizedExe,
    canonicalExe,
  ].filter(Boolean)));
}

function addIconAliasesToMap(map: Record<string, string>, exeName: string, iconBase64: string): void {
  for (const key of collectIconLookupKeys(exeName)) {
    map[key] = iconBase64;
  }
}

function addIconRowToMap(map: Record<string, string>, row: RawIconCacheRow): void {
  const rawExe = (row.exe_name ?? "").trim();
  if (!rawExe || !row.icon_base64) return;

  addIconAliasesToMap(map, rawExe, row.icon_base64);
}

function readIconFromMap(map: Record<string, string>, exeName: string): string | null {
  for (const key of collectIconLookupKeys(exeName)) {
    const icon = map[key];
    if (icon) return icon;
  }

  return null;
}

export async function getIconMap(): Promise<Record<string, string>> {
  const db = await getDB();
  const results = await db.select<RawIconCacheRow[]>(
    "SELECT exe_name, icon_base64 FROM icon_cache",
  );
  const map: Record<string, string> = {};

  for (const row of results) {
    addIconRowToMap(map, row);
  }

  return map;
}

export async function getIconsForExecutables(exeNames: string[]): Promise<Record<string, string>> {
  const lookupKeys = Array.from(new Set(
    exeNames.flatMap((exeName) => collectIconLookupKeys(exeName)),
  ));
  const map: Record<string, string> = {};

  if (lookupKeys.length === 0) {
    return map;
  }

  const db = await getDB();
  for (let index = 0; index < lookupKeys.length; index += ICON_QUERY_BATCH_SIZE) {
    const batchKeys = lookupKeys.slice(index, index + ICON_QUERY_BATCH_SIZE);
    const caseInsensitiveBatchKeys = batchKeys.map((key) => key.toLowerCase());
    const placeholders = batchKeys.map(() => "?").join(", ");
    const rows = await db.select<RawIconCacheRow[]>(
      `SELECT exe_name, icon_base64 FROM icon_cache WHERE LOWER(exe_name) IN (${placeholders})`,
      caseInsensitiveBatchKeys,
    );

    for (const row of rows) {
      addIconRowToMap(map, row);
    }
  }

  for (const exeName of exeNames) {
    const icon = readIconFromMap(map, exeName);
    if (icon) {
      addIconAliasesToMap(map, exeName, icon);
    }
  }

  return map;
}

export async function getSessionsInRange(startMs: number, endMs: number): Promise<HistorySession[]> {
  const db = await getDB();
  const now = Date.now();
  const rows = await db.select<RawHistorySessionRow[]>(
    "SELECT id, app_name, exe_name, window_title, start_time, end_time, COALESCE(duration, MAX(0, ? - start_time)) as duration, continuity_group_start_time FROM sessions WHERE start_time < ? AND COALESCE(end_time, ?) > ? ORDER BY start_time ASC",
    [now, endMs, now, startMs],
  );

  if (rows.length === 0) {
    return [];
  }

  const samplesBySessionId = new Map<number, TitleSampleDetail[]>();
  const sessionIds = rows.map((row) => row.id);
  const batchSize = 900;
  for (let index = 0; index < sessionIds.length; index += batchSize) {
    const batchIds = sessionIds.slice(index, index + batchSize);
    const placeholders = batchIds.map(() => "?").join(", ");
    const sampleRows = await db.select<RawTitleSampleRow[]>(
      `SELECT session_id, title, start_time, end_time
       FROM session_title_samples
       WHERE session_id IN (${placeholders})
         AND start_time < ?
         AND COALESCE(end_time, ?) > ?
       ORDER BY session_id ASC, start_time ASC, id ASC`,
      [...batchIds, endMs, now, startMs],
    );

    for (const sampleRow of sampleRows) {
      const samples = samplesBySessionId.get(sampleRow.session_id) ?? [];
      samples.push(mapRawTitleSample(sampleRow));
      samplesBySessionId.set(sampleRow.session_id, samples);
    }
  }

  return rows.map((row) => mapRawHistorySession(row, samplesBySessionId.get(row.id) ?? []));
}

export async function getSessionsInRangeWithoutTitleSamples(startMs: number, endMs: number): Promise<HistorySession[]> {
  const db = await getDB();
  const now = Date.now();
  const rows = await db.select<RawHistorySessionRow[]>(
    "SELECT id, app_name, exe_name, window_title, start_time, end_time, COALESCE(duration, MAX(0, ? - start_time)) as duration, continuity_group_start_time FROM sessions WHERE start_time < ? AND COALESCE(end_time, ?) > ? ORDER BY start_time ASC",
    [now, endMs, now, startMs],
  );

  return rows.map((row) => mapRawHistorySession(row));
}

export async function getSessionSummariesInRange(startMs: number, endMs: number): Promise<AggregateSessionRecord[]> {
  const db = await getDB();
  const now = Date.now();
  const rows = await db.select<RawAggregateSessionCandidateRow[]>(
    `SELECT app_name, exe_name, window_title, start_time, effective_end_time
     FROM (
       SELECT app_name, exe_name, window_title, start_time,
              COALESCE(end_time, ?) AS effective_end_time
       FROM sessions
       WHERE start_time < ? AND COALESCE(end_time, ?) > ?
       UNION ALL
       SELECT COALESCE(NULLIF(app_name, ''), exe_name) AS app_name,
              exe_name,
              '' AS window_title,
              bucket_start_time AS start_time,
              bucket_start_time + duration AS effective_end_time
       FROM import_time_buckets
       WHERE bucket_start_time < ? AND bucket_start_time + duration > ?
     )
     ORDER BY start_time ASC`,
    [now, endMs, now, startMs, endMs, startMs],
  );
  return mapRawAggregateSessionCandidates(rows);
}

export async function getImportedTimeBucketsInRange(
  startMs: number,
  endMs: number,
): Promise<AggregateSessionRecord[]> {
  const db = await getDB();
  const rows = await db.select<RawAggregateSessionCandidateRow[]>(
    `SELECT COALESCE(NULLIF(app_name, ''), exe_name) AS app_name,
            exe_name,
            '' AS window_title,
            bucket_start_time AS start_time,
            bucket_start_time + duration AS effective_end_time
     FROM import_time_buckets
     WHERE bucket_start_time < ? AND bucket_start_time + duration > ?
     ORDER BY bucket_start_time ASC`,
    [endMs, startMs],
  );
  return mapRawAggregateSessionCandidates(rows);
}

export function getImportedTimeBucketsByDate(date: Date): Promise<AggregateSessionRecord[]> {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(24, 0, 0, 0);
  return getImportedTimeBucketsInRange(start.getTime(), end.getTime());
}

export async function getEarliestSessionStartTime(): Promise<number | null> {
  const db = await getDB();
  const rows = await db.select<{ earliest_start_time: number | null }[]>(
    `SELECT MIN(start_time) AS earliest_start_time
     FROM (
       SELECT start_time FROM sessions
       UNION ALL
       SELECT bucket_start_time AS start_time FROM import_time_buckets
     )`,
  );
  return rows[0]?.earliest_start_time ?? null;
}

export async function getHistoryByDate(date: Date): Promise<HistorySession[]> {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(24, 0, 0, 0);
  return getSessionsInRange(start.getTime(), end.getTime());
}
