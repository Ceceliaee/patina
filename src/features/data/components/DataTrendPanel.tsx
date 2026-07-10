import { memo, type MouseEvent, type RefObject } from "react";
import { CalendarDays, Clock3 } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import QuietChartTooltip from "../../../shared/components/QuietChartTooltip";
import {
  formatChartHours,
  formatDuration,
} from "../../history/services/historyFormatting";
import type { DataTrendRangeSelection } from "../services/dataTrendRange.ts";
import type { DataTrendViewModel } from "../services/dataReadModel.ts";
import DataTrendRangeControl from "./DataTrendRangeControl.tsx";

const DATA_TREND_X_AXIS_MIN_TICK_GAP = 24;

interface DataChartDimension {
  width: number;
  height: number;
}

interface DataTrendPanelProps {
  selection: DataTrendRangeSelection;
  viewModel: DataTrendViewModel | null;
  chartRef: RefObject<HTMLDivElement | null>;
  initialDimension: DataChartDimension;
  canOpenHistory: boolean;
  onSelectionChange: (selection: DataTrendRangeSelection) => void;
  onMouseDownCapture: (event: MouseEvent<HTMLDivElement>) => void;
  onDoubleClickCapture: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseMove: (event: unknown) => void;
  onMouseLeave: () => void;
}

function DataTrendPanel({
  selection,
  viewModel,
  chartRef,
  initialDimension,
  canOpenHistory,
  onSelectionChange,
  onMouseDownCapture,
  onDoubleClickCapture,
  onMouseMove,
  onMouseLeave,
}: DataTrendPanelProps) {
  return (
    <div className="qp-panel p-5 data-trend-panel">
      <div className="data-trend-header">
        <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">
          {UI_TEXT.data.activityTrend}
        </h3>
        <div className="data-trend-inline-metrics" aria-label={UI_TEXT.accessibility.data.trendSummary}>
          <div className="data-trend-inline-metric">
            <Clock3 size={13} aria-hidden />
            <span>{viewModel?.metricLabels.total ?? UI_TEXT.data.weeklyTotal}</span>
            <strong>{viewModel ? formatDuration(viewModel.totalDuration) : "-"}</strong>
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
      <div className="pt-4">
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
                  formatter={(value) => [
                    formatDuration(Number(value) * 3600000),
                    UI_TEXT.data.duration,
                  ]}
                />
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
              </AreaChart>
            </ResponsiveContainer>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default memo(DataTrendPanel);
