import {
  memo,
  type CSSProperties,
  useMemo,
  useRef,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter";
import { formatDuration } from "../../history/services/historyFormatting";
import type { HeatmapSelection, HeatmapWeek } from "../services/dataReadModel.ts";
import DataHeatmapTooltip from "./DataHeatmapTooltip.tsx";

export type HeatmapGranularity = "daily" | "weekly";

const HEATMAP_WEEKDAY_COUNT = 7;

interface DataHeatmapPanelProps {
  selectedHeatmapView: HeatmapSelection;
  selectedHeatmapViewKey: string;
  selectedHeatmapViewLabel: string;
  rows: HeatmapWeek[];
  granularity: HeatmapGranularity;
  granularityOptions: Array<{ value: HeatmapGranularity; label: string }>;
  canSelectOlderHeatmapView: boolean;
  canSelectNewerHeatmapView: boolean;
  onGranularityChange: (granularity: HeatmapGranularity) => void;
  onSelectAdjacentHeatmapView: (delta: number) => void;
  onOpenHistoryDate?: (dateKey: string) => void;
  loading?: boolean;
}

function formatHeatmapShortDate(dateKey: string) {
  return dateKey.slice(5).replace("-", "/");
}

function buildWeeklyHeatmapCells(rows: HeatmapWeek[]) {
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
      ? `${formatHeatmapShortDate(firstCell.date)} - ${formatHeatmapShortDate(lastCell.date)}`
      : week.key;
    const isOutsideYear = inRangeCells.length === 0;
    const isFuture = !isOutsideYear && visibleCells.length === 0;

    return {
      key: week.key,
      duration,
      intensity: 0,
      isFuture,
      isOutsideYear,
      label: `${dateLabel} · ${isFuture ? UI_TEXT.data.notStarted : formatDuration(duration)}`,
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

function DataHeatmapPanel({
  selectedHeatmapView,
  selectedHeatmapViewKey,
  selectedHeatmapViewLabel,
  rows,
  granularity,
  granularityOptions,
  canSelectOlderHeatmapView,
  canSelectNewerHeatmapView,
  onGranularityChange,
  onSelectAdjacentHeatmapView,
  onOpenHistoryDate,
  loading = false,
}: DataHeatmapPanelProps) {
  const heatmapWeeksRef = useRef<HTMLDivElement | null>(null);
  const weeklyHeatmapCells = useMemo(() => buildWeeklyHeatmapCells(rows), [rows]);
  const weeklyHeatmapCellsByKey = useMemo(
    () => new Map(weeklyHeatmapCells.map((cell) => [cell.key, cell])),
    [weeklyHeatmapCells],
  );

  return (
    <div className="qp-panel p-5 data-heatmap-panel">
      <div className="data-heatmap-panel-header">
        <div>
          <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{UI_TEXT.data.activityHeatmap}</h3>
          <p className="mt-1 text-[11px] text-[var(--qp-text-tertiary)]">
            {selectedHeatmapViewLabel} · {UI_TEXT.data.activityHeatmapHint}
          </p>
        </div>
        <div className="data-heatmap-header-actions">
          <QuietSegmentedFilter
            value={granularity}
            options={granularityOptions}
            onChange={onGranularityChange}
            className="data-heatmap-granularity"
          />
          <div className="data-heatmap-range-control" aria-label={UI_TEXT.accessibility.data.heatmapRange}>
            <button
              type="button"
              onClick={() => onSelectAdjacentHeatmapView(1)}
              disabled={!canSelectOlderHeatmapView}
              className="qp-control data-heatmap-range-arrow"
              aria-label={UI_TEXT.accessibility.data.earlierRange}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              className="qp-status data-heatmap-range-label"
              disabled
            >
              {selectedHeatmapViewLabel}
            </button>
            <button
              type="button"
              onClick={() => onSelectAdjacentHeatmapView(-1)}
              disabled={!canSelectNewerHeatmapView}
              className="qp-control data-heatmap-range-arrow"
              aria-label={UI_TEXT.accessibility.data.newerRange}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="data-heatmap data-heatmap-calendar mt-5">
        <div className="data-heatmap-content">
          <div
            className={loading ? "data-heatmap-scroll data-heatmap-loading-state" : "data-heatmap-scroll"}
            style={{ "--data-heatmap-week-count": rows.length } as CSSProperties}
          >
            <div className="data-heatmap-months" aria-hidden>
              <span />
              {rows.map((week) => (
                <span key={`${selectedHeatmapViewKey}:${week.key}`}>{week.monthLabel}</span>
              ))}
            </div>
            <div className="data-heatmap-body" aria-label={UI_TEXT.data.activityHeatmap}>
              <div className="data-heatmap-weekdays" aria-hidden>
                {UI_TEXT.date.heatmapWeekdays.map((weekday, index) => (
                  <span key={`${weekday}-${index}`}>{weekday}</span>
                ))}
              </div>
              <div
                ref={heatmapWeeksRef}
                className="data-heatmap-weeks"
              >
                {rows.map((week) => {
                  const weeklyCell = weeklyHeatmapCellsByKey.get(week.key);
                  return (
                    <div key={`${selectedHeatmapViewKey}:${week.key}`} className="data-heatmap-week">
                      {week.cells.map((cell, cellIndex) => {
                        const hideRecentDailyFutureCell = granularity === "daily"
                          && selectedHeatmapView === "recent"
                          && cell.isFuture;
                        if (hideRecentDailyFutureCell) {
                          return null;
                        }

                        const isDailyFutureCell = granularity === "daily" && cell.isFuture;
                        const isUnavailable = isDailyFutureCell || cell.isOutsideYear;
                        const canOpenHistoryDate = !cell.isFuture && !cell.isOutsideYear && Boolean(onOpenHistoryDate);
                        const tooltipLabel = granularity === "weekly"
                          ? weeklyCell?.label ?? cell.label
                          : cell.label;
                        const isWeeklyFutureCell = granularity === "weekly"
                          && Boolean(weeklyCell?.isFuture);
                        const tooltipDisabled = granularity === "weekly"
                          ? cell.isOutsideYear || isWeeklyFutureCell
                          : isUnavailable;
                        const isWeeklyFilledCell = granularity === "weekly"
                          && !cell.isOutsideYear
                          && cellIndex >= HEATMAP_WEEKDAY_COUNT - (weeklyCell?.activeRows ?? 0);
                        const heatmapIntensity = granularity === "weekly"
                          ? isWeeklyFilledCell ? weeklyCell?.intensity ?? 0 : 0
                          : cell.intensity;
                        return (
                          <span
                            key={`${selectedHeatmapViewKey}:${cell.key}`}
                            className={`data-heatmap-cell ${
                              canOpenHistoryDate ? "data-heatmap-cell-openable" : ""
                            } ${
                              isDailyFutureCell || isWeeklyFutureCell ? "data-heatmap-cell-future" : ""
                            } ${cell.isOutsideYear ? "data-heatmap-cell-outside" : ""}`}
                            onDoubleClick={() => {
                              if (canOpenHistoryDate) {
                                onOpenHistoryDate?.(cell.date);
                              }
                            }}
                            data-heatmap-tooltip={tooltipDisabled ? undefined : tooltipLabel}
                            data-history-date={canOpenHistoryDate ? cell.date : undefined}
                            style={{ "--heatmap-intensity": heatmapIntensity } as CSSProperties}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
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
