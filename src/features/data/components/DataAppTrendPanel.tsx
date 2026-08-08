import { useLocaleText } from "../../../shared/i18n/index.ts";
import { memo, useLayoutEffect, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref, type RefObject, } from "react";
import NativeTrendChart from "../../../shared/charts/NativeTrendChart.tsx";
import QuietSearchField from "../../../shared/components/QuietSearchField";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter.tsx";

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
import QuickClassificationStatus from "../../classification/components/QuickClassificationStatus.tsx";
import type { QuickClassificationAnchor } from "../../classification/types.ts";

interface DataChartDimension {
  width: number;
  height: number;
}

interface DataAppTrendPanelProps {
  onContentCommitted?: () => void;
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
  chartRef: Ref<HTMLDivElement>;
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
  onOptionIntentStart: (
    option: DataDestinationTrendOption,
    returnFocusTo?: HTMLElement | null,
  ) => void;
  onOptionOpenDetails: (option: DataDestinationTrendOption) => void;
  activeQuickClassificationTargetKey?: string | null;
  onQuickClassificationPreload?: () => void;
  onQuickClassificationOpen?: (
    option: DataDestinationTrendOption,
    anchor: QuickClassificationAnchor,
    trigger: HTMLButtonElement,
  ) => void;
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
  onContentCommitted,
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
  onOptionIntentStart,
  onOptionOpenDetails,
  activeQuickClassificationTargetKey,
  onQuickClassificationPreload,
  onQuickClassificationOpen,
  onMouseDownCapture,
  onDoubleClickCapture,
  onMouseMove,
  onMouseLeave,
}: DataAppTrendPanelProps) {
  const UI_TEXT = useLocaleText();
  const detailCopy = UI_TEXT.destinationDetail;
  const modeOptions = [
    { value: "app" as const, label: UI_TEXT.data.destinationApp },
    { value: "web" as const, label: UI_TEXT.data.destinationWeb },
  ];
  useLayoutEffect(() => {
    onContentCommitted?.();
  }, [onContentCommitted]);

  return (
    <div className="qp-panel p-5 data-app-panel relative">
      <div className="data-app-panel-header">
        <div className="data-app-panel-heading">
          <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">
            {title}
          </h3>
          {showDestinationMode ? (
            <QuietSegmentedFilter
              value={destinationMode}
              options={modeOptions}
              onChange={onDestinationModeChange}
              ariaLabel={UI_TEXT.data.destinationMode}
              className="data-destination-mode"
            />
          ) : null}
          {selectedOptions.length > 0 ? (
            <div
              className="data-app-selected-status"
              aria-label={UI_TEXT.data.selectedObjectCount(selectedOptions.length)}
            >
              {selectedOptions.map((option) => (
                <button
                  type="button"
                  className="data-app-selected-icon"
                  data-destination-detail-trigger
                  data-selection-key={option.key}
                  key={option.key}
                  aria-label={detailCopy.open(option.displayName)}
                  aria-keyshortcuts={option.exeName || option.normalizedDomain ? "Enter Shift+F10" : "Enter"}
                  aria-haspopup={option.exeName || option.normalizedDomain ? "menu" : undefined}
                  aria-expanded={option.exeName || option.normalizedDomain
                    ? activeQuickClassificationTargetKey === (option.exeName
                      ? `app:${option.exeName}`
                      : `web:${option.normalizedDomain}`)
                    : undefined}
                  onPointerEnter={option.exeName || option.normalizedDomain ? onQuickClassificationPreload : undefined}
                  onFocus={option.exeName || option.normalizedDomain ? onQuickClassificationPreload : undefined}
                  onMouseDown={(event) => {
                    if (event.button === 0 && event.detail === 1) {
                      onOptionIntentStart(option, event.currentTarget);
                    }
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOptionOpenDetails(option);
                  }}
                  onContextMenu={option.exeName || option.normalizedDomain ? (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onQuickClassificationOpen?.(
                      option,
                      { clientX: event.clientX, clientY: event.clientY },
                      event.currentTarget,
                    );
                  } : undefined}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onOptionIntentStart(option, event.currentTarget);
                      onOptionOpenDetails(option);
                      return;
                    }
                    if (
                      (option.exeName || option.normalizedDomain)
                      && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
                    ) {
                      event.preventDefault();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      onQuickClassificationOpen?.(
                        option,
                        {
                          clientX: bounds.left + bounds.width / 2,
                          clientY: bounds.top + bounds.height / 2,
                        },
                        event.currentTarget,
                      );
                    }
                  }}
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
                </button>
              ))}
            </div>
          ) : null}
          {refreshFailed ? (
            <div
              className="data-app-refresh-status"
              role="status"
            >
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
        <div className="data-app-header-actions">
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
                  if (
                    (option.exeName || option.normalizedDomain)
                    && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
                  ) {
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    onQuickClassificationOpen?.(
                      option,
                      {
                        clientX: bounds.left + bounds.width / 2,
                        clientY: bounds.top + bounds.height / 2,
                      },
                      event.currentTarget,
                    );
                    return;
                  }
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onOptionIntentStart(option, event.currentTarget);
                  if (event.ctrlKey) {
                    onOptionSelect(option.key, true);
                  } else if (event.key === "Enter") {
                    onOptionOpenDetails(option);
                  } else {
                    onOptionSelect(option.key, false);
                  }
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
                    onMouseDown={(event) => {
                      const target = event.target as HTMLElement;
                      if (
                        event.button === 0
                        &&
                        event.detail === 1
                        && target.closest("[data-destination-detail-trigger]")
                      ) {
                        onOptionIntentStart(option, event.currentTarget);
                      }
                    }}
                    onClick={(event) => onOptionSelect(option.key, event.ctrlKey)}
                    onDoubleClick={(event) => {
                      const target = event.target as HTMLElement;
                      if (!target.closest("[data-destination-detail-trigger]")) return;
                      event.preventDefault();
                      event.stopPropagation();
                      onOptionOpenDetails(option);
                    }}
                    onContextMenu={option.exeName || option.normalizedDomain ? (event) => {
                      const target = event.target as HTMLElement;
                      if (!target.closest("[data-destination-detail-trigger]")) return;
                      event.preventDefault();
                      event.stopPropagation();
                      onQuickClassificationOpen?.(
                        option,
                        { clientX: event.clientX, clientY: event.clientY },
                        event.currentTarget,
                      );
                    } : undefined}
                    onPointerEnter={option.exeName || option.normalizedDomain ? onQuickClassificationPreload : undefined}
                    onFocus={option.exeName || option.normalizedDomain ? onQuickClassificationPreload : undefined}
                    onKeyDown={handleOptionKeyDown}
                    aria-pressed={isSelected}
                    aria-keyshortcuts={option.exeName || option.normalizedDomain
                      ? "Enter Space Control+Enter Control+Space Shift+F10"
                      : "Enter Space Control+Enter Control+Space"}
                    aria-haspopup={option.exeName || option.normalizedDomain ? "menu" : undefined}
                    aria-expanded={option.exeName || option.normalizedDomain
                      ? activeQuickClassificationTargetKey === (option.exeName
                        ? `app:${option.exeName}`
                        : `web:${option.normalizedDomain}`)
                      : undefined}
                    aria-description={UI_TEXT.data.interactionHint}
                  >
                    <span
                      className="data-app-option-icon"
                      data-destination-detail-trigger
                      aria-hidden
                    >
                      {option.iconUrl ? (
                        <img src={option.iconUrl} alt="" draggable={false} />
                      ) : (
                        getOptionInitial(option.displayName)
                      )}
                    </span>
                    <span className="data-app-option-main">
                      <span className="data-app-option-name-row">
                        <span className="data-app-option-name">{option.displayName}</span>
                        <QuickClassificationStatus
                          unclassified={Boolean((option.exeName || option.normalizedDomain) && option.unclassified)}
                        />
                      </span>
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
              <NativeTrendChart
                ariaLabel={title}
                domainMax={chartAxis.domainMax}
                formatValue={(value) => formatDuration(value * 3_600_000)}
                formatYAxisTick={formatChartHours}
                height={initialDimension.height}
                onActivePointChange={onMouseMove}
                onMouseLeave={onMouseLeave}
                rows={chartData}
                showAllXAxisTicks={granularity === "month"}
                series={trendSeries.map((series) => ({
                  color: series.color,
                  dataKey: series.dataKey,
                  key: series.key,
                  name: series.displayName || usageMetricLabel,
                }))}
                ticks={chartAxis.ticks}
                width={initialDimension.width}
              />
            </div>
            {heatmapContent}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(DataAppTrendPanel);
