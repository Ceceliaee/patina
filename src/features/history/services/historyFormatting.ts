import type { DailySummary } from "../../../shared/types/sessions.ts";
import { getUiLocale, UI_TEXT } from "../../../shared/copy/uiText.ts";

export interface HistoryChartPoint {
  day: string;
  hours: number;
}

export function formatDuration(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const totalMinutes = Math.floor(safeMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (totalMinutes > 0) return `${minutes}m`;
  if (totalSeconds > 0) return `${totalSeconds}s`;
  return "0m";
}

export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString(getUiLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function formatDateLabel(date: Date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return UI_TEXT.date.today;
  if (date.toDateString() === yesterday.toDateString()) return UI_TEXT.date.yesterday;

  return date.toLocaleDateString(getUiLocale(), { month: "short", day: "numeric" });
}

export function buildChartData(weekly: DailySummary[]): HistoryChartPoint[] {
  return weekly.map((item) => ({
    day: item.date.slice(5),
    // Keep raw hour precision so the trend line updates continuously
    // instead of jumping by 0.1h steps.
    hours: Math.max(0, item.totalDuration) / 3600000,
  }));
}

export function formatChartHours(hours: number) {
  return Number.isInteger(hours) ? `${hours}` : hours.toFixed(1);
}

export function buildChartAxis(points: HistoryChartPoint[]) {
  const axisStep = 4;
  const maxHours = Math.max(0, ...points.map((point) => point.hours));
  const domainMax = Math.max(axisStep, Math.ceil(maxHours / axisStep) * axisStep);
  const tickCount = Math.floor(domainMax / axisStep) + 1;

  return {
    domainMax,
    ticks: Array.from({ length: tickCount }, (_, index) => index * axisStep),
  };
}
