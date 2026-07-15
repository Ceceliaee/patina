import { memo, useCallback, useMemo, useState, type MouseEvent, type RefObject } from "react";
import { CalendarDays, Clock3, Plus, Minus, ChevronRight, X } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import QuietChartTooltip from "../../../shared/components/QuietChartTooltip";
import {
  formatChartHours,
  formatDuration,
} from "../../history/services/historyFormatting";
import type { DataTrendRangeSelection } from "../services/dataTrendRange.ts";
import { type DataTrendViewModel, type DataTrendAggregateContext } from "../services/dataReadModel.ts";
import { useDistinctChartColors } from "../hooks/useChartColors.ts";
import DataTrendRangeControl from "./DataTrendRangeControl.tsx";
import DataTrendDetailPanel from "./DataTrendDetailPanel.tsx";
import type { WebActivitySegment, WebDomainOverride } from "../../../shared/types/webActivity.ts";

const DATA_TREND_X_AXIS_MIN_TICK_GAP = 24;

interface DataChartDimension {
  width: number;
  height: number;
}

interface DataTrendPanelProps {
  selection: DataTrendRangeSelection;
  viewModel: DataTrendViewModel | null;
  aggregateContext: DataTrendAggregateContext | null;
  dataIcons: Record<string, string>;
  webSegments: WebActivitySegment[];
  webDomainOverrides: Record<string, WebDomainOverride>;
  webDomainFavicons: Record<string, string>;
  webDomainIconThemeColors: Record<string, string>;
  chartRef: RefObject<HTMLDivElement | null>;
  initialDimension: DataChartDimension;
  canOpenHistory: boolean;
  onSelectionChange: (selection: DataTrendRangeSelection) => void;
  onMouseDownCapture: (event: MouseEvent<HTMLDivElement>) => void;
  onDoubleClickCapture: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseMove: (event: unknown) => void;
  onMouseLeave: () => void;
}

const COLLAPSED_AVG_LABEL = { total: null, app: null, web: null };

interface ExpandedMetricLabels {
  total: string | null;
  app: string | null;
  web: string | null;
}

function buildExpandedMetricLabels(
  viewModel: DataTrendViewModel,
  aggregateContext: DataTrendAggregateContext | null,
  webSegments: WebActivitySegment[],
): ExpandedMetricLabels {
  const total = formatDuration(viewModel.totalDuration);

  let app: string | null = null;
  if (viewModel.totalAppDuration != null) {
    app = formatDuration(viewModel.totalAppDuration);
  }

  let web: string | null = null;
  if (aggregateContext && webSegments.length > 0) {
    const { startMs, endMs } = aggregateContext.range;
    const nowMs = Date.now();
    const webMs = webSegments.reduce((sum, seg) => {
      const start = Math.max(startMs, seg.startTime);
      const end = Math.min(endMs, seg.endTime ?? nowMs);
      return sum + Math.max(0, end - start);
    }, 0);
    web = formatDuration(webMs);
  }

  return { total, app, web };
}

function buildExpandedAvgLabels(
  viewModel: DataTrendViewModel,
  aggregateContext: DataTrendAggregateContext | null,
  webSegments: WebActivitySegment[],
): ExpandedMetricLabels {
  const total = formatDuration(viewModel.averageDuration);

  let app: string | null = null;
  if (viewModel.averageAppDuration != null) {
    app = formatDuration(viewModel.averageAppDuration);
  }

  let web: string | null = null;
  if (aggregateContext && webSegments.length > 0) {
    const { startMs, endMs } = aggregateContext.range;
    const nowMs = Date.now();
    const webMs = webSegments.reduce((sum, seg) => {
      const start = Math.max(startMs, seg.startTime);
      const end = Math.min(endMs, seg.endTime ?? nowMs);
      return sum + Math.max(0, end - start);
    }, 0);
    web = formatDuration(Math.round(webMs / viewModel.averageDivisor));
  }

  return { total, app, web };
}

function DataTrendPanel({
  selection,
  viewModel,
  aggregateContext,
  dataIcons,
  webSegments,
  webDomainOverrides,
  webDomainFavicons,
  webDomainIconThemeColors,
  chartRef,
  initialDimension,
  canOpenHistory,
  onSelectionChange,
  onMouseDownCapture,
  onDoubleClickCapture,
  onMouseMove,
  onMouseLeave,
}: DataTrendPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTotalVisible, setIsTotalVisible] = useState(true);
  const [isAppVisible, setIsAppVisible] = useState(true);
  const [isWebVisible, setIsWebVisible] = useState(true);
  const [detailPanelMode, setDetailPanelMode] = useState<"app" | "web" | null>(null);
  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);
  const toggleTotal = useCallback(() => {
    setIsTotalVisible((prev) => !prev);
  }, []);
  const toggleApp = useCallback(() => {
    setIsAppVisible((prev) => !prev);
  }, []);
  const toggleWeb = useCallback(() => {
    setIsWebVisible((prev) => !prev);
  }, []);
  const handleOpenDetail = useCallback(() => {
    if (isAppVisible && !isWebVisible) {
      setDetailPanelMode("app");
    } else if (!isAppVisible && isWebVisible) {
      setDetailPanelMode("web");
    }
  }, [isAppVisible, isWebVisible]);
  const handleCloseDetail = useCallback(() => {
    setDetailPanelMode(null);
  }, []);
  const chartColors = useDistinctChartColors();

  const expandedTotals = useMemo(
    () => viewModel ? buildExpandedMetricLabels(viewModel, aggregateContext, webSegments) : COLLAPSED_AVG_LABEL,
    [viewModel, aggregateContext, webSegments],
  );
  const expandedAverages = useMemo(
    () => viewModel ? buildExpandedAvgLabels(viewModel, aggregateContext, webSegments) : COLLAPSED_AVG_LABEL,
    [viewModel, aggregateContext, webSegments],
  );

  const tooltipValueFormatter = useCallback((value: number | string, name: string) => {
    const hours = Number(value);
    const label = name === "app" || name === "appHours"
      ? UI_TEXT.data.appTime
      : name === "web" || name === "webHours"
        ? UI_TEXT.data.webTime
        : UI_TEXT.data.duration;
    return [formatDuration(hours * 3600000), label] as const;
  }, []);

  const showDetailArrow = viewModel && aggregateContext && (isAppVisible !== isWebVisible);

  return (
    <div className="qp-panel p-5 data-trend-panel">
      <div className="data-trend-header">
        <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm data-trend-header-title">
          {UI_TEXT.data.activityTrend}
          <button
            type="button"
            className="data-trend-expand-toggle"
            onClick={toggleExpanded}
            aria-label={isExpanded ? UI_TEXT.accessibility.data.collapseAppWeb : UI_TEXT.accessibility.data.expandAppWeb}
          >
            {isExpanded ? <Minus size={12} /> : <Plus size={12} />}
          </button>
        </h3>
        <div className="data-trend-inline-metrics" aria-label={UI_TEXT.accessibility.data.trendSummary}>
          <div className="data-trend-inline-metric">
            <Clock3 size={13} aria-hidden />
            <span>{viewModel?.metricLabels.total ?? UI_TEXT.data.weeklyTotal}</span>
            <strong className={isTotalVisible ? "" : "data-trend-dimmed"}>
              {viewModel ? formatDuration(viewModel.totalDuration) : "-"}
            </strong>
            <button
              type="button"
              className="data-trend-curve-toggle"
              onClick={toggleTotal}
              aria-label={isTotalVisible ? UI_TEXT.accessibility.data.hideTrendCurve(UI_TEXT.data.duration) : UI_TEXT.accessibility.data.showTrendCurve(UI_TEXT.data.duration)}
            >
              {isTotalVisible ? <X size={10} /> : <Plus size={10} />}
            </button>
          </div>
          <div className="data-trend-inline-metric">
            <CalendarDays size={13} aria-hidden />
            <span>{viewModel?.metricLabels.average ?? UI_TEXT.data.dailyAverage}</span>
            <strong>{viewModel ? formatDuration(viewModel.averageDuration) : "-"}</strong>
          </div>
        </div>
        <DataTrendRangeControl
          ariaLabel={UI_TEXT.accessibility.data.trendRange}
          selection={selection}
          onChange={onSelectionChange}
        />
      </div>
      {isExpanded && viewModel ? (
        <div className="data-trend-expanded-metrics">
          <div className="data-trend-inline-metric">
            <span>{UI_TEXT.data.appTime}</span>
            <strong className={isAppVisible ? "" : "data-trend-dimmed"}>{expandedTotals.app ?? "-"}</strong>
            <span className="data-trend-avg-label">{UI_TEXT.data.dailyAverage}</span>
            <strong className={`data-trend-avg-value${isAppVisible ? "" : " data-trend-dimmed"}`}>
              {expandedAverages.app ?? "-"}
            </strong>
            <button
              type="button"
              className="data-trend-curve-toggle"
              onClick={toggleApp}
              aria-label={isAppVisible ? UI_TEXT.accessibility.data.hideTrendCurve(UI_TEXT.data.appTime) : UI_TEXT.accessibility.data.showTrendCurve(UI_TEXT.data.appTime)}
            >
              {isAppVisible ? <X size={10} /> : <Plus size={10} />}
            </button>
          </div>
          <div className="data-trend-inline-metric">
            <span>{UI_TEXT.data.webTime}</span>
            <strong className={isWebVisible ? "" : "data-trend-dimmed"}>{expandedTotals.web ?? "-"}</strong>
            <span className="data-trend-avg-label">{UI_TEXT.data.dailyAverage}</span>
            <strong className={`data-trend-avg-value${isWebVisible ? "" : " data-trend-dimmed"}`}>
              {expandedAverages.web ?? "-"}
            </strong>
            <button
              type="button"
              className="data-trend-curve-toggle"
              onClick={toggleWeb}
              aria-label={isWebVisible ? UI_TEXT.accessibility.data.hideTrendCurve(UI_TEXT.data.webTime) : UI_TEXT.accessibility.data.showTrendCurve(UI_TEXT.data.webTime)}
            >
              {isWebVisible ? <X size={10} /> : <Plus size={10} />}
            </button>
          </div>
        </div>
      ) : null}
      <div className={`${isExpanded ? "pt-3" : "pt-4"} data-trend-chart-wrapper`}>
        <div
          ref={chartRef}
          className={`data-trend-chart ${
            viewModel
              ? canOpenHistory ? "data-chart-openable" : ""
              : "data-chart-placeholder flex items-center justify-center text-[var(--qp-text-tertiary)] text-xs"
          }`}
          onMouseDownCapture={viewModel ? onMouseDownCapture : undefined}
          onDoubleClickCapture={viewModel ? onDoubleClickCapture : undefined}
          aria-hidden={viewModel ? undefined : true}
        >
          {viewModel ? (
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={initialDimension}
            >
              <AreaChart
                data={viewModel.chartData}
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
                  ticks={viewModel.chartAxis.ticks}
                  domain={[0, viewModel.chartAxis.domainMax]}
                  tickFormatter={(value) => formatChartHours(Number(value))}
                />
                <QuietChartTooltip
                  formatter={tooltipValueFormatter}
                  filterZeroValues
                />
                {isTotalVisible ? (
                  <Area
                    type="monotone"
                    dataKey="hours"
                    stroke="var(--qp-accent-default)"
                    strokeWidth={2}
                    fill="var(--qp-accent-default)"
                    fillOpacity={0.12}
                    dot={{ fill: "var(--qp-accent-default)", r: 3 }}
                    isAnimationActive={false}
                  />
                ) : null}
                {isExpanded && isAppVisible ? (
                  <Area
                    type="monotone"
                    dataKey="appHours"
                    name="app"
                    stroke={chartColors.app}
                    strokeWidth={1.5}
                    fill={chartColors.app}
                    fillOpacity={0.06}
                    dot={false}
                    isAnimationActive={false}
                  />
                ) : null}
                {isExpanded && isWebVisible ? (
                  <Area
                    type="monotone"
                    dataKey="webHours"
                    name="web"
                    stroke={chartColors.web}
                    strokeWidth={1.5}
                    fill={chartColors.web}
                    fillOpacity={0.06}
                    dot={false}
                    isAnimationActive={false}
                  />
                ) : null}
              </AreaChart>
            </ResponsiveContainer>
          ) : null}
        </div>
        {(showDetailArrow || detailPanelMode) ? (
          <button
            type="button"
            className={`data-trend-detail-arrow ${detailPanelMode ? "data-trend-detail-arrow-active" : ""}`}
            onClick={detailPanelMode ? handleCloseDetail : handleOpenDetail}
            aria-label={detailPanelMode ? UI_TEXT.accessibility.data.collapseAppWeb : UI_TEXT.data.openDetailPanel}
          >
            {detailPanelMode ? <X size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : null}
      </div>
      {detailPanelMode && aggregateContext ? (
        <div className="data-trend-detail-panel-wrapper">
          <DataTrendDetailPanel
            mode={detailPanelMode}
            aggregateContext={aggregateContext}
            dataIcons={dataIcons}
            webSegments={webSegments}
            webDomainOverrides={webDomainOverrides}
            webDomainFavicons={webDomainFavicons}
            webDomainIconThemeColors={webDomainIconThemeColors}
            onClose={handleCloseDetail}
          />
        </div>
      ) : null}
    </div>
  );
}

export default memo(DataTrendPanel);
