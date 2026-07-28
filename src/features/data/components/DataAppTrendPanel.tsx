import {
  memo,
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import QuietChartTooltip from "../../../shared/components/QuietChartTooltip";
import QuietSearchField from "../../../shared/components/QuietSearchField";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter.tsx";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import {
  formatChartHours,
  formatDuration,
} from "../../history/services/historyFormatting";
import type {
  DataDestinationMode,
  DataDestinationTrendOption,
  DataDestinationTrendSeries,
  DataDestinationTrendSummary,
} from "../services/dataDestinationState.ts";
import type {
  DataAppTrendViewModel,
  DataDestinationTrendChartRow,
} from "../services/dataReadModel.ts";
import type { DataTrendRangeSelection } from "../services/dataTrendRange.ts";
import DataTrendRangeControl from "./DataTrendRangeControl.tsx";

const DATA_TREND_X_AXIS_MIN_TICK_GAP = 24;

interface DataChartDimension {
  width: number;
  height: number;
}

interface DataAppTrendPanelProps {
  destinationMode: DataDestinationMode;
  showDestinationMode: boolean;
  title: string;
  rangeAriaLabel: string;
  selection: DataTrendRangeSelection;
  ready: boolean;
  selectedOptions: DataDestinationTrendOption[];
  trendSeries: DataDestinationTrendSeries[];
  summary: DataDestinationTrendSummary;
  filteredOptions: DataDestinationTrendOption[];
  searchQuery: string;
  hasSearchQuery: boolean;
  searchPlaceholder: string;
  listAriaLabel: string;
  emptyLabel: string;
  noMatchLabel: string;
  totalMetricLabel: string;
  usageMetricLabel: string;
  granularity: "day" | "month";
  chartData: DataDestinationTrendChartRow[];
  heatmapContent: ReactNode;
  chartAxis: DataAppTrendViewModel["chartAxis"];
  peakDay: DataAppTrendViewModel["peakDay"];
  listRef: RefObject<HTMLDivElement | null>;
  chartRef: RefObject<HTMLDivElement | null>;
  initialDimension: DataChartDimension;
  canOpenHistory: boolean;
  errorMessage?: string | null;
  refreshing: boolean;
  refreshFailed: boolean;
  onRetry: () => void;
  onDestinationModeChange: (mode: DataDestinationMode) => void;
  onSelectionChange: (selection: DataTrendRangeSelection) => void;
  onSearchQueryChange: (nextQuery: string) => void;
  onOptionSelect: (key: string, multi: boolean) => void;
  onMouseDownCapture: (event: MouseEvent<HTMLDivElement>) => void;
  onDoubleClickCapture: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseMove: (event: unknown) => void;
  onMouseLeave: () => void;
}

function getOptionInitial(displayName: string) {
  const trimmed = displayName.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function DataAppTrendPanel({
  destinationMode,
  showDestinationMode,
  title,
  rangeAriaLabel,
  selection,
  ready,
  selectedOptions,
  trendSeries,
  summary,
  filteredOptions,
  searchQuery,
  hasSearchQuery,
  searchPlaceholder,
  listAriaLabel,
  emptyLabel,
  noMatchLabel,
  totalMetricLabel,
  usageMetricLabel,
  granularity,
  chartData,
  heatmapContent,
  chartAxis,
  peakDay,
  listRef,
  chartRef,
  initialDimension,
  canOpenHistory,
  errorMessage,
  refreshing,
  refreshFailed,
  onRetry,
  onDestinationModeChange,
  onSelectionChange,
  onSearchQueryChange,
  onOptionSelect,
  onMouseDownCapture,
  onDoubleClickCapture,
  onMouseMove,
  onMouseLeave,
}: DataAppTrendPanelProps) {
  const modeOptions = [
    { value: "app" as const, label: UI_TEXT.data.destinationApp },
    { value: "web" as const, label: UI_TEXT.data.destinationWeb },
  ];
  const [showRefreshingMessage, setShowRefreshingMessage] = useState(false);
  useEffect(() => {
    if (!refreshing) {
      setShowRefreshingMessage(false);
      return;
    }
    const timer = setTimeout(() => setShowRefreshingMessage(true), 240);
    return () => clearTimeout(timer);
  }, [refreshing]);

  return (
    <div className="qp-panel p-5 data-app-panel relative">
      <div className="data-app-panel-header">
        <div className="data-app-panel-heading">
          <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">
            {title}
          </h3>
          <div
            className="data-app-refresh-status"
            role="status"
          >
            {refreshFailed ? (
              <>
                <span>{UI_TEXT.data.webTrendRefreshError}</span>
                <button
                  type="button"
                  className="qp-inline-action qp-inline-action-accent"
                  onClick={onRetry}
                >
                  {UI_TEXT.data.webTrendRetry}
                </button>
              </>
            ) : showRefreshingMessage ? (
              UI_TEXT.data.webTrendUpdating
            ) : null}
          </div>
        </div>
        <div className="data-app-header-actions">
          <div
            className={`data-app-selected-status ${selectedOptions[0] ? "" : "data-app-selected-status-empty"}`}
            aria-label={UI_TEXT.data.selectedObjectCount(selectedOptions.length)}
          >
            {selectedOptions.map((option) => (
              <span
                className="data-app-selected-icon"
                data-selection-key={option.key}
                key={option.key}
                aria-hidden
              >
                {option.iconUrl ? (
                  <img
                    src={option.iconUrl}
                    alt=""
                    draggable={false}
                  />
                ) : (
                  getOptionInitial(option.displayName)
                )}
              </span>
            ))}
          </div>
          {showDestinationMode ? (
            <QuietSegmentedFilter
              value={destinationMode}
              options={modeOptions}
              onChange={onDestinationModeChange}
              ariaLabel={UI_TEXT.data.destinationMode}
              className="data-destination-mode"
            />
          ) : null}
          <DataTrendRangeControl
            ariaLabel={rangeAriaLabel}
            selection={selection}
            onChange={onSelectionChange}
          />
        </div>
      </div>

      {errorMessage ? (
        <div className="data-app-loading data-web-error" role="status">
          <span>{errorMessage}</span>
          <button type="button" className="qp-control" onClick={onRetry}>
            {UI_TEXT.data.webTrendRetry}
          </button>
        </div>
      ) : !ready ? (
        <div className="relative" aria-busy>
          <div
            className="data-app-grid pointer-events-none invisible"
            aria-hidden
          >
            <div className="data-app-sidebar" data-hint="">
              <div className="data-app-search" />
              <div className="data-app-list data-app-trend-list" />
            </div>
            <div className="data-app-chart-column">
              <div className="data-app-metric-strip">
                {Array.from({ length: 4 }, (_, index) => (
                  <div className="data-app-metric" key={index}>
                    <span>-</span>
                    <strong>-</strong>
                  </div>
                ))}
              </div>
              <div
                ref={chartRef}
                className="data-app-chart data-chart-placeholder"
              />
              {heatmapContent}
            </div>
          </div>
        </div>
      ) : filteredOptions.length === 0 && !hasSearchQuery ? (
        <div className="data-app-loading text-[var(--qp-text-tertiary)] text-xs" role="status">
          {emptyLabel}
        </div>
      ) : (
        <div
          className="data-app-grid"
          aria-busy={refreshing}
        >
          <div
            className="data-app-sidebar"
            data-hint={UI_TEXT.data.interactionHint}
          >
            <QuietSearchField
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
            <div
              key={hasSearchQuery ? "searching" : "all"}
              ref={listRef}
              className="data-app-list data-app-trend-list"
              aria-label={listAriaLabel}
              aria-description={UI_TEXT.data.interactionHint}
            >
              {filteredOptions.length === 0 ? (
                <div className="data-app-empty text-[var(--qp-text-tertiary)] text-xs">
                  {noMatchLabel}
                </div>
              ) : filteredOptions.map((option) => {
                const selectedIndex = selectedOptions.findIndex((selected) => selected.key === option.key);
                const isSelected = selectedIndex >= 0;
                const series = selectedIndex >= 0 ? trendSeries[selectedIndex] : null;
                const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
                  if (!event.ctrlKey || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  onOptionSelect(option.key, true);
                };
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={`data-app-option ${isSelected ? "data-app-option-selected" : ""}`}
                    data-destination-key={option.key}
                    style={series ? {
                      "--data-series-color": series.color,
                    } as CSSProperties : undefined}
                    onClick={(event) => onOptionSelect(option.key, event.ctrlKey)}
                    onKeyDown={handleOptionKeyDown}
                    aria-pressed={isSelected}
                    aria-keyshortcuts="Control+Enter Control+Space"
                  >
                    <span className="data-app-option-icon" aria-hidden>
                      {option.iconUrl ? (
                        <img src={option.iconUrl} alt="" draggable={false} />
                      ) : (
                        getOptionInitial(option.displayName)
                      )}
                    </span>
                    <span className="data-app-option-main">
                      <span className="data-app-option-name">{option.displayName}</span>
                      <span className="data-app-option-meta">
                        {Math.round(option.percentage)}% · {option.secondaryText}
                      </span>
                    </span>
                    <span className="data-app-option-duration">
                      {formatDuration(option.totalDuration)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="data-app-chart-column">
            <div className="data-app-metric-strip">
              <div className="data-app-metric">
                <span>{totalMetricLabel}</span>
                <strong>{formatDuration(summary.totalDuration)}</strong>
              </div>
              <div className="data-app-metric">
                <span>{granularity === "month" ? UI_TEXT.data.monthlyAverage : UI_TEXT.data.appTrendAverage}</span>
                <strong>{formatDuration(summary.averageDuration)}</strong>
              </div>
              <div className="data-app-metric">
                <span>{UI_TEXT.data.appTrendActiveDays}</span>
                <strong>{summary.activeDayCount}</strong>
              </div>
              <div className="data-app-metric">
                <span>{UI_TEXT.data.appTrendPeakDay}</span>
                <strong>{peakDay ? formatDuration(peakDay.duration) : "-"}</strong>
              </div>
            </div>
            <div
              ref={chartRef}
              className={`data-app-chart ${canOpenHistory ? "data-chart-openable" : ""}`}
              onMouseDownCapture={onMouseDownCapture}
              onDoubleClickCapture={onDoubleClickCapture}
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                initialDimension={initialDimension}
              >
                <AreaChart
                  data={chartData}
                  margin={{ top: 8, right: 22, left: -18, bottom: 0 }}
                  onMouseMove={onMouseMove}
                  onMouseLeave={onMouseLeave}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--qp-chart-grid)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--qp-text-tertiary)" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={DATA_TREND_X_AXIS_MIN_TICK_GAP}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--qp-text-tertiary)" }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    ticks={chartAxis.ticks}
                    domain={[0, chartAxis.domainMax]}
                    tickFormatter={(value) => formatChartHours(Number(value))}
                  />
                  <QuietChartTooltip
                    formatter={(value, name) => [
                      formatDuration(Number(value) * 3_600_000),
                      String(name || usageMetricLabel),
                    ]}
                  />
                  {trendSeries.map((series) => (
                    <Area
                      key={series.key}
                      type="monotone"
                      dataKey={series.dataKey}
                      name={series.displayName}
                      stroke={series.color}
                      strokeWidth={2}
                      fill={series.color}
                      fillOpacity={0.12}
                      dot={{ fill: series.color, r: 3 }}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {heatmapContent}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(DataAppTrendPanel);
