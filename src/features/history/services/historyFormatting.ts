import type { DailySummary } from "../../../shared/types/sessions.ts";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { Locale, UiText } from "../../../shared/i18n/index.ts";
import { formatDuration } from "../../../shared/lib/durationFormatting.ts";

export interface HistoryChartPoint {
  day: string;
  hours: number;
}

export interface HistoryCategoryDistributionSource {
  exeName: string;
  appName: string;
  duration: number;
}

export interface HistoryCategoryDistributionItem {
  key: string;
  label: string;
  duration: number;
  percentage: number;
  color: string;
  category: AppCategory;
  kind: "category";
}

export function buildHistoryCategoryDistribution(
  apps: HistoryCategoryDistributionSource[],
  resolveCategory: (app: HistoryCategoryDistributionSource) => {
    category: AppCategory;
    label: string;
    color: string;
  },
): HistoryCategoryDistributionItem[] {
  const summaries = new Map<AppCategory, Omit<HistoryCategoryDistributionItem, "key" | "percentage">>();
  let totalDuration = 0;

  for (const app of apps) {
    const duration = Math.max(0, app.duration);
    if (duration <= 0) continue;

    const resolved = resolveCategory(app);
    const current = summaries.get(resolved.category);
    totalDuration += duration;

    if (current) {
      current.duration += duration;
      continue;
    }

    summaries.set(resolved.category, {
      ...resolved,
      duration,
      kind: "category",
    });
  }

  return Array.from(summaries.entries())
    .map(([category, summary]) => ({
      ...summary,
      key: category,
      percentage: totalDuration > 0 ? (summary.duration / totalDuration) * 100 : 0,
    }))
    .sort((left, right) => right.duration - left.duration || left.label.localeCompare(right.label));
}

export { formatDuration };

export function formatTime(ts: number, locale: Locale) {
  return new Date(ts).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function formatDateLabel(date: Date, uiText: UiText, locale: Locale) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return uiText.date.today;
  if (date.toDateString() === yesterday.toDateString()) return uiText.date.yesterday;

  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
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
