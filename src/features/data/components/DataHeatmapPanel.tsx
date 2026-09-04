import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { UiText } from "../../../shared/i18n/index.ts";
import { memo, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, } from "react";
import QuietRangeControl from "../../../shared/components/QuietRangeControl.tsx";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter";
import { formatDuration } from "../../history/services/historyFormatting";
import { formatLocalDateKey } from "../../../shared/lib/localDate.ts";
import type { HeatmapSelection, HeatmapWeek } from "../services/dataHeatmapReadModel.ts";
import {
  buildDataHeatmapKeyboardModel,
  isHeatmapNavigationKey,
  resolveDataHeatmapActiveDate,
  resolveDataHeatmapNavigationDate,
} from "../services/dataHeatmapInteraction.ts";
import DataHeatmapTooltip from "./DataHeatmapTooltip.tsx";

export type HeatmapGranularity = "daily" | "weekly";

const HEATMAP_WEEKDAY_COUNT = 7;

interface DataHeatmapPanelProps {
  title?: string;
  compact?: boolean;
  selectedHeatmapView: HeatmapSelection;
  selectedHeatmapViewKey: string;
  rows: HeatmapWeek[];
  granularity: HeatmapGranularity;
  granularityOptions: Array<{ value: HeatmapGranularity; label: string }>;
  canSelectOlderHeatmapView: boolean;
  canSelectNewerHeatmapView: boolean;
  onGranularityChange: (granularity: HeatmapGranularity) => void;
  onSelectAdjacentHeatmapView: (delta: number) => void;
  onOpenHistoryDate?: (dateKey: string) => void;
  loading?: boolean;
  errorMessage: string | null;
  refreshFailed: boolean;
  onRetry: () => void;
}

function formatHeatmapShortDate(dateKey: string, formatter: Intl.DateTimeFormat) {
  return formatter.format(new Date(`${dateKey}T00:00:00`));
}

function buildWeeklyHeatmapCells(rows: HeatmapWeek[], text: UiText["data"], locale: string) {
  const formatter = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const weeklyCells = rows.map((week) => {
    const inRangeCells = week.cells.filter((cell) => !cell.isOutsideYear);
    const visibleCells = inRangeCells.filter((cell) => !cell.isFuture);
    const duration = visibleCells.reduce((total, cell) => total + cell.duration, 0);
    const labelCells = visibleCells.length > 0
      ? visibleCells
      : inRangeCells.length > 0
        ? inRangeCells
        : week.cells;
    const firstCell = labelCells[0];
    const lastCell = labelCells[labelCells.length - 1];
    const dateLabel = firstCell && lastCell
      ? `${formatHeatmapShortDate(firstCell.date, formatter)} - ${formatHeatmapShortDate(lastCell.date, formatter)}`
      : week.key;
    const isOutsideYear = inRangeCells.length === 0;
    const isFuture = !isOutsideYear && visibleCells.length === 0;
    const unavailableSummary = visibleCells
      .find((cell) => cell.availability === "unavailable")
      ?.label.split(" · ").slice(-1)[0];
    const availability = isFuture
      ? "future"
      : duration > 0
        ? "recorded"
        : visibleCells.some((cell) => cell.availability === "unavailable")
          ? "unavailable"
          : visibleCells.some((cell) => cell.availability === "no-activity")
            ? "no-activity"
            : "recorded";
    const summary = availability === "future"
      ? text.notStarted
      : availability === "unavailable"
        ? unavailableSummary ?? text.webNotRecorded
        : availability === "no-activity" && visibleCells.some((cell) => cell.availability === "no-activity")
          ? text.webNoActivity
          : formatDuration(duration);

    return {
      key: week.key,
      duration,
      intensity: 0,
      isFuture,
      isOutsideYear,
      availability,
      label: `${dateLabel} · ${summary}`,
    };
  });
  const maxDuration = Math.max(1, ...weeklyCells.map((cell) => cell.duration));

  return weeklyCells.map((cell) => ({
    ...cell,
    activeRows: cell.duration <= 0 || cell.isFuture || cell.isOutsideYear
      ? 0
      : Math.max(1, Math.ceil((cell.duration / maxDuration) * HEATMAP_WEEKDAY_COUNT)),
    intensity: cell.duration <= 0 || cell.isFuture || cell.isOutsideYear ? 0 : 0.88,
  }));
}

function findHeatmapCell(target: EventTarget | null, container: HTMLElement) {
  if (!(target instanceof Element)) {
    return null;
  }

  const cell = target.closest<HTMLElement>(".data-heatmap-cell");
  return cell && container.contains(cell) ? cell : null;
}

function DataHeatmapPanel({
  title,
  compact = false,
  selectedHeatmapView,
  selectedHeatmapViewKey,
  rows,
  granularity,
  granularityOptions,
  canSelectOlderHeatmapView,
  canSelectNewerHeatmapView,
  onGranularityChange,
  onSelectAdjacentHeatmapView,
  onOpenHistoryDate,
  loading = false,
  errorMessage,
  refreshFailed,
  onRetry,
}: DataHeatmapPanelProps) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const heatmapWeeksRef = useRef<HTMLDivElement | null>(null);
  const activeHeatmapDateRef = useRef<string | null>(null);
  const activeHeatmapDatesByViewRef = useRef(new Map<string, string>());
  const weeklyHeatmapCells = useMemo(
    () => buildWeeklyHeatmapCells(rows, UI_TEXT.data, locale),
    [locale, rows, UI_TEXT],
  );
  const resolvedTitle = title ?? UI_TEXT.data.activityHeatmap;
  const weeklyHeatmapCellsByKey = useMemo(
    () => new Map(weeklyHeatmapCells.map((cell) => [cell.key, cell])),
    [weeklyHeatmapCells],
  );
  const keyboardModel = useMemo(() => buildDataHeatmapKeyboardModel(rows), [rows]);
  const todayDateKey = formatLocalDateKey(new Date());
  const selectedHeatmapViewLabel = selectedHeatmapView === "recent"
    ? UI_TEXT.data.recentYear
    : String(selectedHeatmapView);
  const initialActiveDate = resolveDataHeatmapActiveDate(
    keyboardModel,
    activeHeatmapDatesByViewRef.current.get(selectedHeatmapViewKey) ?? activeHeatmapDateRef.current,
    todayDateKey,
  );

  const rememberActiveDate = useCallback((date: string) => {
    activeHeatmapDateRef.current = date;
    activeHeatmapDatesByViewRef.current.set(selectedHeatmapViewKey, date);
  }, [selectedHeatmapViewKey]);

  const moveHeatmapFocus = useCallback((date: string, shouldFocus: boolean) => {
    const container = heatmapWeeksRef.current;
    if (!container || !keyboardModel.positionsByDate.has(date)) {
      return false;
    }

    const nextCell = container.querySelector<HTMLElement>(`[data-heatmap-date="${date}"]`);
    if (!nextCell) {
      return false;
    }

    const currentTabStop = container.querySelector<HTMLElement>('[data-heatmap-date][tabindex="0"]');
    if (currentTabStop !== nextCell) {
      currentTabStop?.setAttribute("tabindex", "-1");
      nextCell.setAttribute("tabindex", "0");
    }
    rememberActiveDate(date);

    if (shouldFocus && document.activeElement !== nextCell) {
      nextCell.focus({ preventScroll: true });
      nextCell.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    return true;
  }, [keyboardModel, rememberActiveDate]);

  const handleHeatmapFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const container = heatmapWeeksRef.current;
    if (!container) {
      return;
    }

    const cell = findHeatmapCell(event.target, container);
    const date = cell?.dataset.heatmapDate;
    if (date) {
      moveHeatmapFocus(date, false);
    }
  }, [moveHeatmapFocus]);

  const handleHeatmapClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const container = heatmapWeeksRef.current;
    if (!container) {
      return;
    }

    const cell = findHeatmapCell(event.target, container);
    const date = cell?.dataset.heatmapDate;
    if (date) {
      moveHeatmapFocus(date, true);
    }
  }, [moveHeatmapFocus]);

  const handleHeatmapDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const container = heatmapWeeksRef.current;
    if (!container) {
      return;
    }

    const historyDate = findHeatmapCell(event.target, container)?.dataset.historyDate;
    if (historyDate) {
      onOpenHistoryDate?.(historyDate);
    }
  }, [onOpenHistoryDate]);

  const handleHeatmapKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const container = heatmapWeeksRef.current;
    if (!container) {
      return;
    }

    const cell = findHeatmapCell(event.target, container);
    const currentDate = cell?.dataset.heatmapDate;
    if (!cell || !currentDate) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      const historyDate = cell.dataset.historyDate;
      if (historyDate) {
        event.preventDefault();
        onOpenHistoryDate?.(historyDate);
      }
      return;
    }

    if (!isHeatmapNavigationKey(event.key)) {
      return;
    }

    event.preventDefault();
    const nextDate = resolveDataHeatmapNavigationDate(
      keyboardModel,
      currentDate,
      event.key,
      event.ctrlKey,
    );
    if (nextDate) {
      moveHeatmapFocus(nextDate, true);
    }
  }, [keyboardModel, moveHeatmapFocus, onOpenHistoryDate]);

  useEffect(() => {
    if (initialActiveDate) {
      rememberActiveDate(initialActiveDate);
    }
  }, [initialActiveDate, rememberActiveDate]);

  return (
    <div className={`data-heatmap-panel ${compact ? "data-heatmap-panel-compact" : ""}`}>
      <div className="data-heatmap-panel-header">
        <div className="data-heatmap-panel-heading">
          <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{resolvedTitle}</h3>
          {refreshFailed ? (
            <div className="data-heatmap-refresh-status" role="status">
              <span>{UI_TEXT.data.webTrendRefreshError}</span>
              <button
                type="button"
                className="qp-inline-action qp-inline-action-accent"
                onClick={onRetry}
              >
                {UI_TEXT.data.webTrendRetry}
              </button>
            </div>
          ) : null}
        </div>
        <div className="data-heatmap-header-actions">
          <QuietSegmentedFilter
            value={granularity}
            options={granularityOptions}
            onChange={onGranularityChange}
            className="data-heatmap-granularity"
          />
          <QuietRangeControl
            className="data-heatmap-range-control"
            ariaLabel={UI_TEXT.accessibility.data.heatmapRange}
            label={selectedHeatmapViewLabel}
            previousAriaLabel={UI_TEXT.accessibility.data.earlierRange}
            nextAriaLabel={UI_TEXT.accessibility.data.newerRange}
            previousDisabled={!canSelectOlderHeatmapView}
            nextDisabled={!canSelectNewerHeatmapView}
            onPrevious={() => onSelectAdjacentHeatmapView(1)}
            onNext={() => onSelectAdjacentHeatmapView(-1)}
          />
        </div>
      </div>

      {errorMessage ? (
        <div
          className="mt-5 flex min-h-32 flex-col items-center justify-center gap-2 text-sm text-[var(--qp-text-secondary)]"
          role="status"
        >
          <span>{errorMessage}</span>
          <button type="button" className="qp-control" onClick={onRetry}>
            {UI_TEXT.data.webTrendRetry}
          </button>
        </div>
      ) : (
        <div className="data-heatmap data-heatmap-calendar mt-5">
          <div className="data-heatmap-content">
            <div
              className={loading
                ? "data-heatmap-scroll data-heatmap-loading-state qp-scroll-region"
                : "data-heatmap-scroll qp-scroll-region"}
              style={{ "--data-heatmap-week-count": rows.length } as CSSProperties}
            >
            <div className="data-heatmap-months" aria-hidden>
              <span />
              {rows.map((week) => (
                <span key={`${selectedHeatmapViewKey}:${week.key}`}>{week.monthLabel}</span>
              ))}
            </div>
            <div className="data-heatmap-body">
              <div className="data-heatmap-weekdays" aria-hidden>
                {UI_TEXT.date.heatmapWeekdays.map((weekday, index) => (
                  <span key={`${weekday}-${index}`}>{weekday}</span>
                ))}
              </div>
              <div
                ref={heatmapWeeksRef}
                className="data-heatmap-weeks"
                role="grid"
                aria-label={resolvedTitle}
                aria-rowcount={HEATMAP_WEEKDAY_COUNT}
                aria-colcount={rows.length}
                onClick={handleHeatmapClick}
                onDoubleClick={handleHeatmapDoubleClick}
                onFocusCapture={handleHeatmapFocus}
                onKeyDown={handleHeatmapKeyDown}
              >
                {Array.from({ length: HEATMAP_WEEKDAY_COUNT }, (_, weekdayIndex) => (
                  <div
                    key={`${selectedHeatmapViewKey}:weekday:${weekdayIndex}`}
                    className="data-heatmap-row"
                    role="row"
                    aria-rowindex={weekdayIndex + 1}
                  >
                    {rows.map((week, weekIndex) => {
                      const cell = week.cells[weekdayIndex];
                      if (!cell) {
                        return null;
                      }

                      const weeklyCell = weeklyHeatmapCellsByKey.get(week.key);
                      const hideRecentDailyFutureCell = granularity === "daily"
                        && selectedHeatmapView === "recent"
                        && cell.isFuture;
                      if (hideRecentDailyFutureCell) {
                        return (
                          <span
                            key={`${selectedHeatmapViewKey}:${cell.key}`}
                            className="data-heatmap-cell data-heatmap-cell-hidden"
                            aria-hidden
                          />
                        );
                      }

                      const isDailyFutureCell = granularity === "daily" && cell.isFuture;
                      const isUnavailable = isDailyFutureCell || cell.isOutsideYear;
                      const isKeyboardFocusable = !cell.isFuture && !cell.isOutsideYear;
                      const canOpenHistoryDate = !cell.isFuture
                        && !cell.isOutsideYear
                        && cell.availability !== "unavailable"
                        && Boolean(onOpenHistoryDate);
                      const baseTooltipLabel = granularity === "weekly"
                        ? weeklyCell?.label ?? cell.label
                        : cell.label;
                      const tooltipLabel = baseTooltipLabel;
                      const isWeeklyFutureCell = granularity === "weekly"
                        && Boolean(weeklyCell?.isFuture);
                      const tooltipDisabled = granularity === "weekly"
                        ? cell.isOutsideYear || isWeeklyFutureCell
                        : isUnavailable;
                      const isWeeklyFilledCell = granularity === "weekly"
                        && !cell.isOutsideYear
                        && weekdayIndex >= HEATMAP_WEEKDAY_COUNT - (weeklyCell?.activeRows ?? 0);
                      const heatmapIntensity = granularity === "weekly"
                        ? isWeeklyFilledCell ? weeklyCell?.intensity ?? 0 : 0
                        : cell.intensity;
                      return (
                        <span
                          key={`${selectedHeatmapViewKey}:${cell.key}`}
                          role="gridcell"
                          aria-colindex={weekIndex + 1}
                          aria-label={UI_TEXT.accessibility.data.heatmapCell(cell.date, tooltipLabel)}
                          aria-disabled={isKeyboardFocusable ? undefined : true}
                          aria-hidden={cell.isOutsideYear ? true : undefined}
                          aria-keyshortcuts={canOpenHistoryDate ? "Enter Space" : undefined}
                          tabIndex={isKeyboardFocusable ? (cell.date === initialActiveDate ? 0 : -1) : undefined}
                          className={`data-heatmap-cell ${
                            canOpenHistoryDate ? "data-heatmap-cell-openable" : ""
                          } ${
                            isDailyFutureCell || isWeeklyFutureCell ? "data-heatmap-cell-future" : ""
                          } ${cell.isOutsideYear ? "data-heatmap-cell-outside" : ""} ${
                            cell.availability === "unavailable" ? "data-heatmap-cell-unavailable" : ""
                          }`}
                          data-heatmap-tooltip={tooltipDisabled ? undefined : tooltipLabel}
                          data-heatmap-date={isKeyboardFocusable ? cell.date : undefined}
                          data-history-date={canOpenHistoryDate ? cell.date : undefined}
                          style={{ "--heatmap-intensity": heatmapIntensity } as CSSProperties}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        </div>
      )}
      <DataHeatmapTooltip
        containerRef={heatmapWeeksRef}
        granularity={granularity}
        rows={rows}
        selectedHeatmapViewKey={selectedHeatmapViewKey}
      />
    </div>
  );
}

export default memo(DataHeatmapPanel);
