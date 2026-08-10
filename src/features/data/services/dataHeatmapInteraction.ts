import type { HeatmapWeek } from "./dataHeatmapReadModel.ts";

type HeatmapNavigationKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End";

interface HeatmapCellPosition {
  weekIndex: number;
  weekdayIndex: number;
}

interface DataHeatmapKeyboardModel {
  datesByPosition: ReadonlyArray<ReadonlyArray<string | null>>;
  datesInOrder: readonly string[];
  positionsByDate: ReadonlyMap<string, HeatmapCellPosition>;
}

const HEATMAP_NAVIGATION_KEYS = new Set<HeatmapNavigationKey>([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

export function isHeatmapNavigationKey(key: string): key is HeatmapNavigationKey {
  return HEATMAP_NAVIGATION_KEYS.has(key as HeatmapNavigationKey);
}

export function buildDataHeatmapKeyboardModel(rows: readonly HeatmapWeek[]): DataHeatmapKeyboardModel {
  const positionsByDate = new Map<string, HeatmapCellPosition>();
  const datesInOrder: string[] = [];
  const datesByPosition = rows.map((week, weekIndex) => week.cells.map((cell, weekdayIndex) => {
    if (cell.isFuture || cell.isOutsideYear) {
      return null;
    }

    positionsByDate.set(cell.date, { weekIndex, weekdayIndex });
    datesInOrder.push(cell.date);
    return cell.date;
  }));

  return {
    datesByPosition,
    datesInOrder,
    positionsByDate,
  };
}

export function resolveDataHeatmapActiveDate(
  model: DataHeatmapKeyboardModel,
  preferredDate?: string | null,
  todayDate?: string | null,
): string | null {
  if (preferredDate && model.positionsByDate.has(preferredDate)) {
    return preferredDate;
  }

  if (todayDate && model.positionsByDate.has(todayDate)) {
    return todayDate;
  }

  return model.datesInOrder[model.datesInOrder.length - 1] ?? null;
}

function findDateInWeek(
  model: DataHeatmapKeyboardModel,
  weekIndex: number,
  startWeekdayIndex: number,
  delta: -1 | 1,
) {
  const week = model.datesByPosition[weekIndex];
  if (!week) {
    return null;
  }

  for (
    let weekdayIndex = startWeekdayIndex + delta;
    weekdayIndex >= 0 && weekdayIndex < week.length;
    weekdayIndex += delta
  ) {
    const date = week[weekdayIndex];
    if (date) {
      return date;
    }
  }

  return null;
}

function findDateAcrossWeeks(
  model: DataHeatmapKeyboardModel,
  startWeekIndex: number,
  weekdayIndex: number,
  delta: -1 | 1,
) {
  for (
    let weekIndex = startWeekIndex + delta;
    weekIndex >= 0 && weekIndex < model.datesByPosition.length;
    weekIndex += delta
  ) {
    const date = model.datesByPosition[weekIndex]?.[weekdayIndex];
    if (date) {
      return date;
    }
  }

  return null;
}

function findEdgeDate(
  model: DataHeatmapKeyboardModel,
  weekdayIndex: number,
  fromEnd: boolean,
) {
  const delta = fromEnd ? -1 : 1;
  for (
    let weekIndex = fromEnd ? model.datesByPosition.length - 1 : 0;
    weekIndex >= 0 && weekIndex < model.datesByPosition.length;
    weekIndex += delta
  ) {
    const date = model.datesByPosition[weekIndex]?.[weekdayIndex];
    if (date) {
      return date;
    }
  }

  return null;
}

export function resolveDataHeatmapNavigationDate(
  model: DataHeatmapKeyboardModel,
  currentDate: string,
  key: HeatmapNavigationKey,
  ctrlKey = false,
): string | null {
  const position = model.positionsByDate.get(currentDate);
  if (!position) {
    return null;
  }

  if (ctrlKey && key === "Home") {
    return model.datesInOrder[0] ?? null;
  }
  if (ctrlKey && key === "End") {
    return model.datesInOrder[model.datesInOrder.length - 1] ?? null;
  }

  switch (key) {
    case "ArrowUp":
      return findDateInWeek(model, position.weekIndex, position.weekdayIndex, -1);
    case "ArrowDown":
      return findDateInWeek(model, position.weekIndex, position.weekdayIndex, 1);
    case "ArrowLeft":
      return findDateAcrossWeeks(model, position.weekIndex, position.weekdayIndex, -1);
    case "ArrowRight":
      return findDateAcrossWeeks(model, position.weekIndex, position.weekdayIndex, 1);
    case "Home":
      return findEdgeDate(model, position.weekdayIndex, false);
    case "End":
      return findEdgeDate(model, position.weekdayIndex, true);
    default:
      return null;
  }
}
