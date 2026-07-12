import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { CompiledSession } from "../../../shared/lib/sessionReadCompiler.ts";
import { buildTimelineSessions, type TimelineSession } from "../../../shared/lib/sessionReadCompiler.ts";
import { startOfLocalDay } from "../../../shared/lib/localDate.ts";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface HistoryAppTimelineSegment {
  id: string;
  sourceSessionId: number;
  startTime: number;
  endTime: number;
  duration: number;
  startRatio: number;
  widthRatio: number;
  displayTitle: string;
  titleSamples: string[];
}

export interface HistoryAppTimelineAppItem {
  exeName: string;
  appName: string;
  category: AppCategory;
  categoryLabel: string;
  totalDuration: number;
  percentage: number;
  color: string;
  segments: HistoryAppTimelineSegment[];
}

export interface HistoryAppTimelineAxisTick {
  label: string;
  ratio: number;
}

export interface HistoryAppTimelineViewModel {
  appItems: HistoryAppTimelineAppItem[];
  axisTicks: HistoryAppTimelineAxisTick[];
  dayStartMs: number;
  dayEndMs: number;
  viewportStartMs: number;
  viewportEndMs: number;
  zoomLevel: number;
  totalActiveDuration: number;
}

interface BuildHistoryAppTimelineParams {
  sessions: CompiledSession[];
  selectedDate: Date;
  nowMs: number;
  mergeThresholdSecs?: number;
  minSegmentWidthRatio?: number;
  iconThemeColors?: Record<string, string>;
  zoomLevel?: number;
  viewportStartRatio?: number;
}

const MIN_ZOOM_LEVEL = 1;
const MAX_ZOOM_LEVEL = 6;

function getZoomStepHours(zoomLevel: number): number {
  if (zoomLevel <= 1) return 6;
  if (zoomLevel <= 2) return 3;
  if (zoomLevel <= 3) return 2;
  if (zoomLevel <= 4) return 1;
  if (zoomLevel <= 5) return 0.5;
  return 0.25;
}

function getViewportDurationMs(zoomLevel: number): number {
  const hours = 24 / Math.pow(2, zoomLevel - 1);
  return Math.max(hours, 1) * HOUR_MS;
}

function getFullDayRange(date: Date) {
  const dayStart = startOfLocalDay(date);
  return {
    dayStartMs: dayStart.getTime(),
    dayEndMs: dayStart.getTime() + DAY_MS,
  };
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function buildAxisTicks(
  viewportStartMs: number,
  viewportEndMs: number,
  zoomLevel: number,
  dayEndMs: number,
): HistoryAppTimelineAxisTick[] {
  const ticks: HistoryAppTimelineAxisTick[] = [];
  const viewportDuration = Math.max(1, viewportEndMs - viewportStartMs);
  const stepHours = getZoomStepHours(zoomLevel);
  const stepMs = stepHours * HOUR_MS;

  for (let tickMs = viewportStartMs; tickMs < viewportEndMs; tickMs += stepMs) {
    const ratio = clampRatio((tickMs - viewportStartMs) / viewportDuration);
    const date = new Date(tickMs);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    let label: string;
    if (tickMs === dayEndMs) {
      label = "24:00";
    } else if (stepHours >= 1) {
      label = `${String(hours).padStart(2, "0")}:00`;
    } else {
      label = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
    ticks.push({ label, ratio });
  }

  const lastTick = ticks[ticks.length - 1];
  if (!lastTick || lastTick.ratio < 1) {
    const endLabel = viewportEndMs === dayEndMs
      ? "24:00"
      : (() => {
          const date = new Date(viewportEndMs);
          const hours = date.getHours();
          const minutes = date.getMinutes();
          return stepHours >= 1
            ? `${String(hours).padStart(2, "0")}:00`
            : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
        })();
    ticks.push({ label: endLabel, ratio: 1 });
  }

  return ticks;
}

function resolveAppColor(
  exeName: string,
  appName: string,
  iconThemeColors: Record<string, string> | undefined,
): string {
  const overrideColor = AppClassification.getUserOverride(exeName)?.color;
  const mapped = AppClassification.mapApp(exeName, { appName });
  return overrideColor
    ?? iconThemeColors?.[exeName]
    ?? mapped.color;
}

function timelineSessionToSegment(
  session: TimelineSession,
  viewportStartMs: number,
  viewportDuration: number,
  minWidthRatio: number = 0,
): HistoryAppTimelineSegment {
  const endTime = session.endTime ?? (session.startTime + (session.duration ?? 0));
  const startRatio = clampRatio((session.startTime - viewportStartMs) / viewportDuration);
  const endRatio = clampRatio((endTime - viewportStartMs) / viewportDuration);
  let widthRatio = clampRatio(endRatio - startRatio);

  if (widthRatio > 0 && widthRatio < minWidthRatio) {
    widthRatio = minWidthRatio;
  }

  return {
    id: String(session.id),
    sourceSessionId: session.id,
    startTime: session.startTime,
    endTime,
    duration: Math.max(0, session.duration ?? 0),
    startRatio,
    widthRatio,
    displayTitle: session.displayTitle ?? "",
    titleSamples: session.titleSamples ?? [],
  };
}

export function buildHistoryAppTimelineViewModel(params: BuildHistoryAppTimelineParams): HistoryAppTimelineViewModel {
  const {
    sessions,
    selectedDate,
    mergeThresholdSecs = 30,
    minSegmentWidthRatio = 0.002,
    iconThemeColors,
    zoomLevel: rawZoomLevel = 1,
    viewportStartRatio = 0,
  } = params;

  const zoomLevel = Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, rawZoomLevel));
  const { dayStartMs, dayEndMs } = getFullDayRange(selectedDate);
  const dayDuration = dayEndMs - dayStartMs;

  const viewportDuration = getViewportDurationMs(zoomLevel);
  const maxStart = dayDuration - viewportDuration;
  const viewportStartMs = dayStartMs + Math.max(0, Math.min(maxStart, viewportStartRatio * dayDuration));
  const viewportEndMs = Math.min(dayEndMs, viewportStartMs + viewportDuration);

  const timelineSessions = buildTimelineSessions(sessions, mergeThresholdSecs);

  const visibleSessions = timelineSessions.filter((session) => {
    const endTime = session.endTime ?? (session.startTime + (session.duration ?? 0));
    return endTime > viewportStartMs && session.startTime < viewportEndMs;
  });

  const appMap = new Map<string, {
    exeName: string;
    appName: string;
    category: AppCategory;
    categoryLabel: string;
    totalDuration: number;
    visibleDuration: number;
    segments: HistoryAppTimelineSegment[];
  }>();

  let totalActiveDuration = 0;
  const appTotalDuration = new Map<string, number>();

  for (const session of timelineSessions) {
    const exeName = session.appKey;
    const duration = session.duration ?? 0;
    if (duration <= 0) continue;
    totalActiveDuration += duration;
    appTotalDuration.set(exeName, (appTotalDuration.get(exeName) ?? 0) + duration);
  }

  for (const session of visibleSessions) {
    const exeName = session.appKey;
    const duration = session.duration ?? 0;
    if (duration <= 0) continue;

    const existing = appMap.get(exeName);
    const segment = timelineSessionToSegment(session, viewportStartMs, viewportDuration, minSegmentWidthRatio);

    if (existing) {
      existing.visibleDuration += duration;
      existing.segments.push(segment);
    } else {
      const mapped = AppClassification.mapApp(exeName, { appName: session.displayName });
      appMap.set(exeName, {
        exeName,
        appName: session.displayName || mapped.name,
        category: mapped.category,
        categoryLabel: AppClassification.getCategoryLabel(mapped.category),
        totalDuration: appTotalDuration.get(exeName) ?? 0,
        visibleDuration: duration,
        segments: [segment],
      });
    }
  }

  const appItems: HistoryAppTimelineAppItem[] = Array.from(appMap.values())
    .sort((a, b) => b.totalDuration - a.totalDuration || a.appName.localeCompare(b.appName))
    .map((item) => ({
      ...item,
      percentage: totalActiveDuration > 0 ? (item.totalDuration / totalActiveDuration) * 100 : 0,
      color: resolveAppColor(item.exeName, item.appName, iconThemeColors),
      segments: item.segments.sort((a, b) => a.startTime - b.startTime),
    }));

  const axisTicks = buildAxisTicks(viewportStartMs, viewportEndMs, zoomLevel, dayEndMs);

  return {
    appItems,
    axisTicks,
    dayStartMs,
    dayEndMs,
    viewportStartMs,
    viewportEndMs,
    zoomLevel,
    totalActiveDuration,
  };
}
