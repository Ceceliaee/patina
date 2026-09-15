import { getDB } from "./sqlite.ts";
import { AppClassification } from "../../shared/classification/appClassification.ts";
import { resolveAppIconKeys, resolveExecutableIconKeys } from "../../shared/classification/appIconIdentity.ts";
import type { HistorySession, TitleSampleDetail } from "../../shared/types/sessions.ts";
import {
  resolveNativeSessionPrecedence,
  type TimeRecordOrigin,
} from "./nativeSessionPrecedence.ts";
import { loadActivityAggregateRange } from "./activityReadModelGateway.ts";

interface RawHistorySessionRow {
  id: number;
  origin: Exclude<TimeRecordOrigin, "import_bucket">;
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

export interface AggregateSessionRecord {
  appName: string;
  exeName: string;
  startTime: number;
  endTime: number;
}

const ICON_QUERY_BATCH_SIZE = 900;
const IMPORTED_SESSION_ID_BASE = -8_000_000_000_000_000;

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

function addIconAliasesToMap(map: Record<string, string>, exeName: string, iconBase64: string, resolveKeys = resolveAppIconKeys): void {
  for (const key of resolveKeys(exeName)) {
    map[key] = iconBase64;
  }
}

function addIconRowToMap(map: Record<string, string>, row: RawIconCacheRow, resolveKeys = resolveAppIconKeys): void {
  const rawExe = (row.exe_name ?? "").trim();
  if (!rawExe || !row.icon_base64) return;

  addIconAliasesToMap(map, rawExe, row.icon_base64, resolveKeys);
}

function readIconFromMap(map: Record<string, string>, exeName: string, resolveKeys = resolveAppIconKeys): string | null {
  for (const key of resolveKeys(exeName)) {
    const icon = map[key];
    if (icon) return icon;
  }

  return null;
}

export async function getIconsForExecutables(exeNames: string[], identity: "statistical" | "executable" = "statistical"): Promise<Record<string, string>> {
  const resolveKeys = identity === "executable" ? resolveExecutableIconKeys : resolveAppIconKeys;
  const lookupKeys = Array.from(new Set(
    exeNames.flatMap((exeName) => resolveKeys(exeName)),
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
      addIconRowToMap(map, row, resolveKeys);
    }
  }

  for (const exeName of exeNames) {
    const icon = readIconFromMap(map, exeName, resolveKeys);
    if (icon) {
      addIconAliasesToMap(map, exeName, icon, resolveKeys);
    }
  }

  return map;
}

export async function getSessionsInRange(startMs: number, endMs: number): Promise<HistorySession[]> {
  const db = await getDB();
  const now = Date.now();
  const rows = await db.select<RawHistorySessionRow[]>(
    `SELECT id, origin, app_name, exe_name, window_title, start_time, end_time,
            duration, continuity_group_start_time
     FROM (
       SELECT id, 'native' AS origin, app_name, exe_name, window_title, start_time, end_time,
              COALESCE(duration, MAX(0, ? - start_time)) AS duration,
              continuity_group_start_time
       FROM sessions
       WHERE start_time < ? AND (end_time > ? OR (end_time IS NULL AND ? > ?))
       UNION ALL
       SELECT id, 'import_exact' AS origin, app_name, exe_name, window_title, start_time, end_time,
              duration, start_time AS continuity_group_start_time
       FROM import_exact_sessions
       WHERE start_time < ? AND end_time > ?
     )
     ORDER BY start_time ASC`,
    [now, endMs, startMs, now, startMs, endMs, startMs],
  );

  const effectiveRows = resolveEffectiveHistoryRows(rows, now);
  if (effectiveRows.length === 0) {
    return [];
  }

  const samplesBySessionId = new Map<number, TitleSampleDetail[]>();
  const sessionIds = Array.from(new Set(
    effectiveRows.filter((row) => row.origin === "native").map((row) => row.id),
  ));
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

  return effectiveRows.map((row) => mapRawHistorySession(row, samplesBySessionId.get(row.id) ?? []));
}

export async function getSessionsInRangeWithoutTitleSamples(startMs: number, endMs: number): Promise<HistorySession[]> {
  const db = await getDB();
  const now = Date.now();
  const rows = await db.select<RawHistorySessionRow[]>(
    `SELECT id, origin, app_name, exe_name, window_title, start_time, end_time,
            duration, continuity_group_start_time
     FROM (
       SELECT id, 'native' AS origin, app_name, exe_name, window_title, start_time, end_time,
              COALESCE(duration, MAX(0, ? - start_time)) AS duration,
              continuity_group_start_time
       FROM sessions
       WHERE start_time < ? AND (end_time > ? OR (end_time IS NULL AND ? > ?))
       UNION ALL
       SELECT id, 'import_exact' AS origin, app_name, exe_name, window_title, start_time, end_time,
              duration, start_time AS continuity_group_start_time
       FROM import_exact_sessions
       WHERE start_time < ? AND end_time > ?
     )
     ORDER BY start_time ASC`,
    [now, endMs, startMs, now, startMs, endMs, startMs],
  );

  return resolveEffectiveHistoryRows(rows, now).map((row) => mapRawHistorySession(row));
}

function resolveEffectiveHistoryRows(
  rows: RawHistorySessionRow[],
  now: number,
): RawHistorySessionRow[] {
  const effective = resolveNativeSessionPrecedence(rows.map((row, index) => ({
    key: `${row.origin}:${row.id}:${index}`,
    origin: row.origin,
    startTime: row.start_time,
    endTime: row.end_time ?? now,
    value: row,
  })));
  let importedIndex = 0;
  return effective.map((range) => {
    const row = range.value!;
    if (row.origin === "native") return row;
    const id = IMPORTED_SESSION_ID_BASE + importedIndex;
    importedIndex += 1;
    return {
      ...row,
      id,
      start_time: range.startTime,
      end_time: range.endTime,
      duration: range.endTime - range.startTime,
      continuity_group_start_time: range.startTime,
    };
  });
}

export async function getSessionSummariesInRangeByLocalDay(
  startMs: number,
  endMs: number,
): Promise<AggregateSessionRecord[]> {
  if (endMs <= startMs) return [];
  const boundaries = [startMs];
  const cursor = new Date(startMs);
  cursor.setHours(24, 0, 0, 0);
  while (cursor.getTime() < endMs) {
    boundaries.push(cursor.getTime());
    cursor.setHours(24, 0, 0, 0);
  }
  boundaries.push(endMs);
  const response = await loadActivityAggregateRange(startMs, endMs, boundaries);
  return response.records.filter((row) => AppClassification.shouldTrackProcess(row.exeName, {
    appName: row.appName,
  }));
}

export async function getSessionSummariesInRangeByLocalMonth(
  startMs: number,
  endMs: number,
): Promise<AggregateSessionRecord[]> {
  if (endMs <= startMs) return [];
  const boundaries = [startMs];
  const start = new Date(startMs);
  let cursor = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  while (cursor.getTime() < endMs) {
    boundaries.push(cursor.getTime());
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  boundaries.push(endMs);
  const response = await loadActivityAggregateRange(startMs, endMs, boundaries);
  return response.records.filter((row) => AppClassification.shouldTrackProcess(row.exeName, {
    appName: row.appName,
  }));
}

export async function getEarliestSessionStartTime(): Promise<number | null> {
  const db = await getDB();
  const rows = await db.select<{ earliest_start_time: number | null }[]>(
    `SELECT MIN(start_time) AS earliest_start_time
     FROM (
       SELECT start_time FROM sessions
       UNION ALL
       SELECT start_time FROM import_exact_sessions
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
