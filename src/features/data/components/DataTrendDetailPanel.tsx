import { useMemo, useCallback, useState, useRef } from "react";
import { Search, X, Globe } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import QuietChartTooltip from "../../../shared/components/QuietChartTooltip";
import {
  formatChartHours,
  formatDuration,
} from "../../history/services/historyFormatting";
import {
  buildDataAppTrendViewModelFromAggregate,
  type DataTrendAggregateContext,
} from "../services/dataReadModel.ts";
import {
  buildDataWebTrendViewModel,
  type DataWebTrendViewModel,
} from "../services/dataWebTrendReadModel.ts";
import { filterDataAppOptionsForQuery } from "../services/dataAppSearch.ts";
import { useDistinctChartColors } from "../hooks/useChartColors.ts";
import type { WebActivitySegment, WebDomainOverride } from "../../../shared/types/webActivity.ts";

const DATA_TREND_X_AXIS_MIN_TICK_GAP = 24;

interface DataChartDimension {
  width: number;
  height: number;
}

interface DataTrendDetailPanelProps {
  mode: "app" | "web";
  aggregateContext: DataTrendAggregateContext | null;
  dataIcons: Record<string, string>;
  webSegments: WebActivitySegment[];
  webDomainOverrides: Record<string, WebDomainOverride>;
  webDomainFavicons: Record<string, string>;
  webDomainIconThemeColors: Record<string, string>;
  onClose: () => void;
}

function getAppInitial(appName: string) {
  const trimmed = appName.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function filterWebDomainOptionsForQuery(
  options: DataWebTrendViewModel["domainOptions"],
  query: string,
): DataWebTrendViewModel["domainOptions"] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return options;
  return options.filter((option) => (
    option.label.toLowerCase().includes(trimmed)
    || option.domain.toLowerCase().includes(trimmed)
  ));
}

function DataTrendDetailPanel({
  mode,
  aggregateContext,
  dataIcons,
  webSegments,
  webDomainOverrides,
  webDomainFavicons,
  webDomainIconThemeColors,
  onClose,
}: DataTrendDetailPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAppKey, setSelectedAppKey] = useState<string | null>(null);
  const [selectedDomainKey, setSelectedDomainKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartColors = useDistinctChartColors();

  const [chartDimension] = useState<DataChartDimension>(() => ({
    width: 540,
    height: 180,
  }));

  const appTrendViewModel = useMemo(() => {
    if (mode !== "app" || !aggregateContext) return null;
    return buildDataAppTrendViewModelFromAggregate(aggregateContext, selectedAppKey);
  }, [aggregateContext, mode, selectedAppKey]);

  const webTrendViewModel = useMemo(() => {
    if (mode !== "web" || !aggregateContext) return null;
    return buildDataWebTrendViewModel(
      webSegments,
      aggregateContext.range,
      aggregateContext.range.endMs,
      selectedDomainKey,
      webDomainOverrides,
      webDomainIconThemeColors,
      webDomainFavicons,
    );
  }, [aggregateContext, mode, selectedDomainKey, webSegments, webDomainFavicons, webDomainIconThemeColors, webDomainOverrides]);

  const filteredAppOptions = useMemo(() => {
    if (!appTrendViewModel) return [];
    return filterDataAppOptionsForQuery(appTrendViewModel.appOptions, searchQuery);
  }, [appTrendViewModel, searchQuery]);

  const filteredDomainOptions = useMemo(() => {
    if (!webTrendViewModel) return [];
    return filterWebDomainOptionsForQuery(webTrendViewModel.domainOptions, searchQuery);
  }, [searchQuery, webTrendViewModel]);

  const selectedApp = useMemo(() => {
    if (!appTrendViewModel) return null;
    if (!selectedAppKey) return appTrendViewModel.selectedApp;
    return appTrendViewModel.appOptions.find((app) => app.appKey === selectedAppKey) ?? null;
  }, [appTrendViewModel, selectedAppKey]);

  const selectedDomain = useMemo(() => {
    if (!webTrendViewModel) return null;
    if (!selectedDomainKey) return webTrendViewModel.selectedDomain;
    return webTrendViewModel.domainOptions.find((d) => d.domainKey === selectedDomainKey) ?? null;
  }, [selectedDomainKey, webTrendViewModel]);

  const chartData = useMemo(() => {
    if (mode === "app") {
      if (!selectedApp || !appTrendViewModel) return [];
      return appTrendViewModel.chartData;
    }
    if (!selectedDomain || !webTrendViewModel) return [];
    return webTrendViewModel.chartData;
  }, [appTrendViewModel, mode, selectedApp, selectedDomain, webTrendViewModel]);

  const hasSearchQuery = searchQuery.trim().length > 0;

  const chartAxis = useMemo(() => {
    if (mode === "app") {
      if (!appTrendViewModel) {
        return { domainMax: 3, ticks: [0, 1, 2, 3] };
      }
      return appTrendViewModel.chartAxis;
    }
    if (!webTrendViewModel) {
      return { domainMax: 3, ticks: [0, 1, 2, 3] };
    }
    return webTrendViewModel.chartAxis;
  }, [appTrendViewModel, mode, webTrendViewModel]);

  const peakDay = useMemo(() => {
    if (mode === "app") {
      if (!appTrendViewModel) return null;
      return appTrendViewModel.peakDay;
    }
    if (!webTrendViewModel) return null;
    return webTrendViewModel.peakDay;
  }, [appTrendViewModel, mode, webTrendViewModel]);

  const granularity = useMemo(() => {
    if (mode === "app") return appTrendViewModel?.granularity ?? "day";
    return webTrendViewModel?.granularity ?? "day";
  }, [appTrendViewModel, mode, webTrendViewModel]);

  const hasData = mode === "app"
    ? Boolean(appTrendViewModel && appTrendViewModel.appOptions.length > 0)
    : Boolean(webTrendViewModel && webTrendViewModel.domainOptions.length > 0);

  const isLoading = mode === "app" ? !appTrendViewModel : !webTrendViewModel;

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  }, []);

  const handleAppSelect = useCallback((appKey: string) => {
    setSelectedAppKey(appKey);
  }, []);

  const handleDomainSelect = useCallback((domainKey: string) => {
    setSelectedDomainKey(domainKey);
  }, []);

  const handleChartMouseMove = useCallback(() => {
  }, []);

  const handleChartMouseLeave = useCallback(() => {
  }, []);

  const title = mode === "app" ? UI_TEXT.data.appTrend : UI_TEXT.data.webTrend;
  const accent = mode === "app" ? chartColors.app : chartColors.web;
  const searchPlaceholder = mode === "app"
    ? UI_TEXT.data.appSearchPlaceholder
    : UI_TEXT.data.appSearchPlaceholder;

  const selectedTotalDuration = mode === "app"
    ? selectedApp?.totalDuration ?? 0
    : selectedDomain?.totalDuration ?? 0;
  const selectedAverageDuration = mode === "app"
    ? selectedApp?.averageDuration ?? 0
    : selectedDomain?.averageDuration ?? 0;
  const selectedActiveDayCount = mode === "app"
    ? selectedApp?.activeDayCount ?? 0
    : selectedDomain?.activeDayCount ?? 0;

  return (
    <div className="qp-panel p-5 data-app-panel relative">
      <div className="data-app-panel-header">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">
            {title}
          </h3>
        </div>
        <div className="data-app-header-actions">
          <button
            type="button"
            className="data-trend-expand-toggle"
            onClick={onClose}
            aria-label={UI_TEXT.accessibility.data.closeDetailPanel}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="relative">
          <div className="data-app-grid invisible pointer-events-none select-none" aria-hidden="true">
            <div className="data-app-sidebar">
              <div className="data-app-search" />
              <div className="data-app-list data-app-trend-list" />
            </div>
            <div className="data-app-chart-column">
              <div className="data-app-metric-strip">
                <div className="data-app-metric"><span>-</span><strong>-</strong></div>
                <div className="data-app-metric"><span>-</span><strong>-</strong></div>
                <div className="data-app-metric"><span>-</span><strong>-</strong></div>
                <div className="data-app-metric"><span>-</span><strong>-</strong></div>
              </div>
              <div ref={chartRef} className="data-app-chart data-chart-placeholder" />
            </div>
          </div>
        </div>
      ) : !hasData ? (
        <div className="data-app-loading text-[var(--qp-text-tertiary)] text-xs">
          {UI_TEXT.data.appTrendEmpty}
        </div>
      ) : (
        <div className="data-app-detail-content">
          {mode === "app" ? (
            <>
              <div className="data-app-browser-hint">{UI_TEXT.data.appTrendBrowserHint}</div>
              <div className="data-app-browser-hint">{UI_TEXT.data.trendRoundingHint}</div>
            </>
          ) : (
            <div className="data-app-browser-hint">{UI_TEXT.data.webTrendSourceHint}</div>
          )}
          <div className="data-app-grid">
          <div className="data-app-sidebar">
            <label className="data-app-search">
              <Search size={14} aria-hidden />
              <input
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </label>
            <div
              key={hasSearchQuery ? "searching" : "all"}
              ref={listRef}
              className="data-app-list data-app-trend-list"
              aria-label={UI_TEXT.data.appTrendAppList}
            >
              {mode === "app" ? (
                filteredAppOptions.length === 0 ? (
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
                      onClick={() => handleAppSelect(app.appKey)}
                      aria-pressed={isSelected}
                      style={isSelected ? { borderLeftColor: accent } : undefined}
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
                        <span className="data-app-option-meta">
                          {Math.round(app.percentage)}% · {app.exeName}
                        </span>
                      </span>
                      <span className="data-app-option-duration">
                        {formatDuration(app.totalDuration)}
                      </span>
                    </button>
                  );
                })
              ) : (
                filteredDomainOptions.length === 0 ? (
                  <div className="data-app-empty text-[var(--qp-text-tertiary)] text-xs">
                    {UI_TEXT.data.appTrendNoMatch}
                  </div>
                ) : filteredDomainOptions.map((domain) => {
                  const isSelected = selectedDomain?.domainKey === domain.domainKey;
                  return (
                    <button
                      key={domain.domainKey}
                      type="button"
                      className={`data-app-option ${isSelected ? "data-app-option-selected" : ""}`}
                      onClick={() => handleDomainSelect(domain.domainKey)}
                      aria-pressed={isSelected}
                      style={isSelected ? { borderLeftColor: accent } : undefined}
                    >
                      <span className="data-app-option-icon" aria-hidden>
                        {domain.faviconUrl ? (
                          <img src={domain.faviconUrl} alt="" draggable={false} />
                        ) : (
                          <Globe size={14} />
                        )}
                      </span>
                      <span className="data-app-option-main">
                        <span className="data-app-option-name">{domain.label}</span>
                        <span className="data-app-option-meta">
                          {Math.round(domain.percentage)}% · {domain.domain}
                        </span>
                      </span>
                      <span className="data-app-option-duration">
                        {formatDuration(domain.totalDuration)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="data-app-chart-column">
            <div className="data-app-metric-strip">
              <div className="data-app-metric">
                <span>{UI_TEXT.data.appTrendTotal}</span>
                <strong>{formatDuration(selectedTotalDuration)}</strong>
              </div>
              <div className="data-app-metric">
                <span>{granularity === "month"
                  ? UI_TEXT.data.monthlyAverage
                  : UI_TEXT.data.appTrendAverage}</span>
                <strong>{formatDuration(selectedAverageDuration)}</strong>
              </div>
              <div className="data-app-metric">
                <span>{UI_TEXT.data.appTrendActiveDays}</span>
                <strong>{selectedActiveDayCount}</strong>
              </div>
              <div className="data-app-metric">
                <span>{UI_TEXT.data.appTrendPeakDay}</span>
                <strong>{peakDay ? formatDuration(peakDay.duration) : "-"}</strong>
              </div>
            </div>
            <div
              ref={chartRef}
              className="data-app-chart"
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                initialDimension={chartDimension}
              >
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 18, left: -20, bottom: 0 }}
                  onMouseMove={handleChartMouseMove}
                  onMouseLeave={handleChartMouseLeave}
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
                    stroke={accent}
                    strokeWidth={2}
                    fill={accent}
                    fillOpacity={0.1}
                    dot={{ fill: accent, r: 2.5 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTrendDetailPanel;
