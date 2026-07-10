import { memo, type MouseEvent, type RefObject } from "react";
import { Search } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import QuietChartTooltip from "../../../shared/components/QuietChartTooltip";
import {
  formatChartHours,
  formatDuration,
} from "../../history/services/historyFormatting";
import type { DataTrendRangeSelection } from "../services/dataTrendRange.ts";
import type { DataAppOption, DataAppTrendPoint, DataAppTrendViewModel } from "../services/dataReadModel.ts";
import DataTrendRangeControl from "./DataTrendRangeControl.tsx";

const DATA_TREND_X_AXIS_MIN_TICK_GAP = 24;

interface DataChartDimension {
  width: number;
  height: number;
}

interface DataAppTrendPanelProps {
  selection: DataTrendRangeSelection;
  viewModel: DataAppTrendViewModel | null;
  selectedApp: DataAppOption | null | undefined;
  filteredAppOptions: DataAppOption[];
  appSearchQuery: string;
  hasAppSearchQuery: boolean;
  chartData: DataAppTrendPoint[];
  chartAxis: DataAppTrendViewModel["chartAxis"];
  peakDay: DataAppTrendViewModel["peakDay"];
  dataIcons: Record<string, string>;
  appListRef: RefObject<HTMLDivElement | null>;
  chartRef: RefObject<HTMLDivElement | null>;
  initialDimension: DataChartDimension;
  canOpenHistory: boolean;
  onSelectionChange: (selection: DataTrendRangeSelection) => void;
  onSearchQueryChange: (nextQuery: string) => void;
  onAppSelect: (appKey: string) => void;
  onMouseDownCapture: (event: MouseEvent<HTMLDivElement>) => void;
  onDoubleClickCapture: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseMove: (event: unknown) => void;
  onMouseLeave: () => void;
}

function getAppInitial(appName: string) {
  const trimmed = appName.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function DataAppTrendPanel({
  selection,
  viewModel,
  selectedApp,
  filteredAppOptions,
  appSearchQuery,
  hasAppSearchQuery,
  chartData,
  chartAxis,
  peakDay,
  dataIcons,
  appListRef,
  chartRef,
  initialDimension,
  canOpenHistory,
  onSelectionChange,
  onSearchQueryChange,
  onAppSelect,
  onMouseDownCapture,
  onDoubleClickCapture,
  onMouseMove,
  onMouseLeave,
}: DataAppTrendPanelProps) {
  return (
    <div className="qp-panel p-5 data-app-panel relative">
      <div className="data-app-panel-header">
        <div>
          <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">
            {UI_TEXT.data.appTrend}
          </h3>
        </div>
        <div className="data-app-header-actions">
          <div className={`data-app-selected-status ${selectedApp ? "" : "data-app-selected-status-empty"}`}>
            {selectedApp && dataIcons[selectedApp.exeName] ? (
              <img
                src={dataIcons[selectedApp.exeName]}
                alt=""
                draggable={false}
              />
            ) : selectedApp ? (
              getAppInitial(selectedApp.appName)
            ) : (
              ""
            )}
          </div>
          <DataTrendRangeControl
            ariaLabel={UI_TEXT.accessibility.data.appTrendRange}
            selection={selection}
            onChange={onSelectionChange}
          />
        </div>
      </div>

      {!viewModel ? (
        <div className="relative">
          <div className="data-app-grid invisible pointer-events-none select-none" aria-hidden="true">
            <div className="data-app-sidebar">
              <div className="data-app-search" />
              <div className="data-app-list data-app-trend-list" />
            </div>
            <div className="data-app-chart-column">
              <div className="data-app-metric-strip">
                <div className="data-app-metric">
                  <span>-</span>
                  <strong>-</strong>
                </div>
                <div className="data-app-metric">
                  <span>-</span>
                  <strong>-</strong>
                </div>
                <div className="data-app-metric">
                  <span>-</span>
                  <strong>-</strong>
                </div>
                <div className="data-app-metric">
                  <span>-</span>
                  <strong>-</strong>
                </div>
              </div>
              <div
                ref={chartRef}
                className="data-app-chart data-chart-placeholder"
              />
            </div>
          </div>
        </div>
      ) : viewModel.appOptions.length === 0 ? (
        <div className="data-app-loading text-[var(--qp-text-tertiary)] text-xs">
          {UI_TEXT.data.appTrendEmpty}
        </div>
      ) : (
        <div className="data-app-grid">
          <div className="data-app-sidebar">
            <label className="data-app-search">
              <Search size={14} aria-hidden />
              <input
                value={appSearchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                placeholder={UI_TEXT.data.appSearchPlaceholder}
                aria-label={UI_TEXT.data.appSearchPlaceholder}
              />
            </label>
            <div
              key={hasAppSearchQuery ? "searching" : "all"}
              ref={appListRef}
              className="data-app-list data-app-trend-list"
              aria-label={UI_TEXT.data.appTrendAppList}
            >
              {filteredAppOptions.length === 0 ? (
                <div className="data-app-empty text-[var(--qp-text-tertiary)] text-xs">
                  {UI_TEXT.data.appTrendNoMatch}
                </div>
              ) : filteredAppOptions.map((app) => {
                const isSelected = selectedApp?.appKey === app.appKey;
                return (
                  <button
                    key={app.appKey}
                    type="button"
                    className={`data-app-option ${isSelected ? "data-app-option-selected" : ""}`}
                    onClick={() => onAppSelect(app.appKey)}
                    aria-pressed={isSelected}
                  >
                    <span className="data-app-option-icon" aria-hidden>
                      {dataIcons[app.exeName] ? (
                        <img src={dataIcons[app.exeName]} alt="" draggable={false} />
                      ) : (
                        getAppInitial(app.appName)
                      )}
                    </span>
                    <span className="data-app-option-main">
                      <span className="data-app-option-name">{app.appName}</span>
                      <span className="data-app-option-meta">{Math.round(app.percentage)}% · {app.exeName}</span>
                    </span>
                    <span className="data-app-option-duration">
                      {formatDuration(app.totalDuration)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="data-app-chart-column">
            <div className="data-app-metric-strip">
              <div className="data-app-metric">
                <span>{UI_TEXT.data.appTrendTotal}</span>
                <strong>{formatDuration(selectedApp?.totalDuration ?? 0)}</strong>
              </div>
              <div className="data-app-metric">
                <span>{viewModel.granularity === "month" ? UI_TEXT.data.monthlyAverage : UI_TEXT.data.appTrendAverage}</span>
                <strong>{formatDuration(selectedApp?.averageDuration ?? 0)}</strong>
              </div>
              <div className="data-app-metric">
                <span>{UI_TEXT.data.appTrendActiveDays}</span>
                <strong>{selectedApp?.activeDayCount ?? 0}</strong>
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
                  margin={{ top: 10, right: 18, left: -20, bottom: 0 }}
                  onMouseMove={onMouseMove}
                  onMouseLeave={onMouseLeave}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--qp-border-subtle)" strokeOpacity={0.58} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "var(--qp-text-tertiary)" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={DATA_TREND_X_AXIS_MIN_TICK_GAP}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--qp-text-tertiary)" }}
                    axisLine={false}
                    tickLine={false}
                    ticks={chartAxis.ticks}
                    domain={[0, chartAxis.domainMax]}
                    tickFormatter={(value) => formatChartHours(Number(value))}
                  />
                  <QuietChartTooltip
                    formatter={(value) => [
                      formatDuration(Number(value) * 3600000),
                      UI_TEXT.data.appTrendUsage,
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="hours"
                    stroke="var(--qp-accent-default)"
                    strokeWidth={2}
                    fill="var(--qp-accent-default)"
                    fillOpacity={0.1}
                    dot={{ fill: "var(--qp-accent-default)", r: 2.5 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(DataAppTrendPanel);
