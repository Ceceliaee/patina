import { invokeWithCommandError } from "./commandError.ts";
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
  const linksRevision = AppClassification.getAppLinksRevision();
  const resolveKeys = identity === "executable" ? resolveExecutableIconKeys : resolveAppIconKeys;
  const lookupKeys = Array.from(new Set(
    exeNames.flatMap((exeName) => resolveKeys(exeName)),
  ));
  const map: Record<string, string> = {};

  if (lookupKeys.length === 0) {
    return map;
  }

  for (let index = 0; index < lookupKeys.length; index += ICON_QUERY_BATCH_SIZE) {
    const batchKeys = lookupKeys.slice(index, index + ICON_QUERY_BATCH_SIZE);
    const rows = await invokeWithCommandError<RawIconCacheRow[]>(
      "cmd_get_executable_icon_rows", { exeNames: batchKeys },
    );

    // Rows were selected for the previous identities. Mapping them through a
    // newer association could overwrite a parent's icon with a child's row.
    if (identity === "statistical" && linksRevision !== AppClassification.getAppLinksRevision()) {
      return getIconsForExecutables(exeNames, identity);
    }

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
  return loadHistoryRange(startMs, endMs, true);
}

export async function getSessionsInRangeWithoutTitleSamples(startMs: number, endMs: number): Promise<HistorySession[]> {
  return loadHistoryRange(startMs, endMs, false);
}

async function loadHistoryRange(startMs: number, endMs: number, includeTitleSamples: boolean): Promise<HistorySession[]> {
  const now = Date.now();
  const result = await invokeWithCommandError<{
    sessions: RawHistorySessionRow[];
    titleSamples: RawTitleSampleRow[];
  }>("cmd_get_history_range_rows", { startMs, endMs, nowMs: now, includeTitleSamples });
  const samplesBySessionId = new Map<number, TitleSampleDetail[]>();
  for (const sample of result.titleSamples) {
    const samples = samplesBySessionId.get(sample.session_id) ?? [];
    samples.push(mapRawTitleSample(sample));
    samplesBySessionId.set(sample.session_id, samples);
  }
  return resolveEffectiveHistoryRows(result.sessions, now).map((row) =>
    mapRawHistorySession(row, samplesBySessionId.get(row.id) ?? []));
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

export async function getEarliestSessionStartTime(): Promise<number | null> {
  return invokeWithCommandError("cmd_get_earliest_activity_start_time");
}

export async function getHistoryByDate(date: Date): Promise<HistorySession[]> {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(24, 0, 0, 0);
  return getSessionsInRange(start.getTime(), end.getTime());
}
