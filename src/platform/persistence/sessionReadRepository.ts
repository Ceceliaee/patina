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

export async function getIconMap(): Promise<Record<string, string>> {
  const db = await getDB();
  const results = await db.select<{ exe_name: string; icon_base64: string }[]>(
    "SELECT exe_name, icon_base64 FROM icon_cache",
  );
  const map: Record<string, string> = {};

  for (const row of results) {
    const rawExe = (row.exe_name ?? "").trim();
    if (!rawExe) continue;

    const normalizedExe = AppClassification.resolveCanonicalExecutable(rawExe);
    const lowerExe = rawExe.toLowerCase();

    map[rawExe] = row.icon_base64;
    map[lowerExe] = row.icon_base64;
    map[normalizedExe] = row.icon_base64;
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

export async function getEarliestSessionStartTime(): Promise<number | null> {
  const db = await getDB();
  const rows = await db.select<{ earliest_start_time: number | null }[]>(
    "SELECT MIN(start_time) AS earliest_start_time FROM sessions",
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
