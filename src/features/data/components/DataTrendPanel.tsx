import { memo, type MouseEvent, type RefObject } from "react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import NativeTrendChart from "../../../shared/charts/NativeTrendChart.tsx";
import {
  formatChartHours,
  formatDuration,
} from "../../history/services/historyFormatting";
import type { DataTrendRangeSelection } from "../services/dataTrendRange.ts";
import type { DataTrendViewModel } from "../services/dataReadModel.ts";
import DataTrendRangeControl from "./DataTrendRangeControl.tsx";

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
    <div className="data-trend-panel">
      <div className="data-trend-header">
        <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">
          {UI_TEXT.data.activityTrend}
        </h3>
        <div className="data-trend-inline-metrics" aria-label={UI_TEXT.accessibility.data.trendSummary}>
          <div className="data-trend-inline-metric">
            <span>{viewModel?.metricLabels.total ?? UI_TEXT.data.weeklyTotal}</span>
            <strong>{viewModel ? formatDuration(viewModel.totalDuration) : "-"}</strong>
          </div>
          <div className="data-trend-inline-metric">
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
            <NativeTrendChart
              ariaLabel={UI_TEXT.data.activityTrend}
              domainMax={viewModel.chartAxis.domainMax}
              formatValue={(value) => formatDuration(value * 3_600_000)}
              formatYAxisTick={formatChartHours}
              height={initialDimension.height}
              onActivePointChange={onMouseMove}
              onMouseLeave={onMouseLeave}
              rows={viewModel.chartData}
              showAllXAxisTicks={viewModel.granularity === "month"}
              series={[{
                color: "var(--qp-accent-default)",
                dataKey: "hours",
                key: "hours",
                name: UI_TEXT.data.duration,
              }]}
              ticks={viewModel.chartAxis.ticks}
              width={initialDimension.width}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default memo(DataTrendPanel);
