import { useEffect, useMemo, useState, type MouseEvent } from "react";
import QuietChartTooltip, {
  type QuietChartTooltipItem,
} from "../components/QuietChartTooltip.tsx";

interface NativeTrendChartRow {
  label: string;
}

interface NativeTrendChartSeries {
  color: string;
  dataKey: string;
  key: string;
  name: string;
}

interface Props {
  ariaLabel: string;
  domainMax: number;
  formatValue: (value: number, series: NativeTrendChartSeries) => string;
  formatYAxisTick: (value: number) => string;
  height: number;
  onActivePointChange?: (event: unknown) => void;
  onPointActivate?: (event: unknown) => void;
  onMouseLeave?: () => void;
  rows: readonly NativeTrendChartRow[];
  showAllXAxisTicks?: boolean;
  series: readonly NativeTrendChartSeries[];
  ticks: readonly number[];
  width: number;
}

interface ChartPoint {
  value: number;
  x: number;
  y: number;
}

const CHART_MARGIN = {
  bottom: 26,
  left: 44,
  right: 22,
  top: 8,
} as const;
const X_TICK_MIN_WIDTH = 64;
const TOOLTIP_EDGE_INSET = 8;
const TOOLTIP_POINT_GAP = 12;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getPointX(index: number, count: number, left: number, width: number) {
  if (count <= 1) return left + width / 2;
  return left + width * index / (count - 1);
}

function buildSmoothLinePath(points: readonly ChartPoint[]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const midpoint = (previous.x + current.x) / 2;
    path += ` C ${midpoint} ${previous.y}, ${midpoint} ${current.y}, ${current.x} ${current.y}`;
  }
  return path;
}

function selectXAxisTickIndices(count: number, plotWidth: number) {
  if (count <= 0) return [];
  if (count === 1) return [0];

  const visibleCount = Math.max(2, Math.min(count, Math.floor(plotWidth / X_TICK_MIN_WIDTH) + 1));
  const indices = new Set<number>([0, count - 1]);
  for (let index = 1; index < visibleCount - 1; index += 1) {
    indices.add(Math.round(index * (count - 1) / (visibleCount - 1)));
  }
  return Array.from(indices).sort((left, right) => left - right);
}

export default function NativeTrendChart({
  ariaLabel,
  domainMax,
  formatValue,
  formatYAxisTick,
  height,
  onActivePointChange,
  onPointActivate,
  onMouseLeave,
  rows,
  showAllXAxisTicks = false,
  series,
  ticks,
  width,
}: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const plotLeft = CHART_MARGIN.left;
  const plotTop = CHART_MARGIN.top;
  const plotWidth = Math.max(1, safeWidth - CHART_MARGIN.left - CHART_MARGIN.right);
  const plotHeight = Math.max(1, safeHeight - CHART_MARGIN.top - CHART_MARGIN.bottom);
  const plotBottom = plotTop + plotHeight;
  const safeDomainMax = Math.max(1, domainMax);
  const xTickIndices = useMemo(
    () => showAllXAxisTicks
      ? Array.from({ length: rows.length }, (_, index) => index)
      : selectXAxisTickIndices(rows.length, plotWidth),
    [plotWidth, rows.length, showAllXAxisTicks],
  );
  const seriesPoints = useMemo(() => series.map((item) => ({
    series: item,
    points: rows.map((row, index) => {
      const rawValue = Number((row as unknown as Record<string, unknown>)[item.dataKey]);
      const value = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
      return {
        value,
        x: getPointX(index, rows.length, plotLeft, plotWidth),
        y: plotBottom - Math.min(safeDomainMax, value) / safeDomainMax * plotHeight,
      };
    }),
  })), [plotBottom, plotHeight, plotLeft, plotWidth, rows, safeDomainMax, series]);

  useEffect(() => {
    if (activeIndex !== null && activeIndex >= rows.length) {
      setActiveIndex(null);
    }
  }, [activeIndex, rows.length]);

  const activatePoint = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setActiveIndex(index);
    onActivePointChange?.({
      activeIndex: index,
      activeLabel: row.label,
      activePayload: [{ payload: row }],
    });
  };
  const commitPoint = (index: number) => {
    const row = rows[index];
    if (!row) return;
    activatePoint(index);
    onPointActivate?.({
      activeIndex: index,
      activeLabel: row.label,
      activePayload: [{ payload: row }],
    });
  };
  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = clamp(event.clientX - rect.left, plotLeft, plotLeft + plotWidth);
    const index = rows.length === 1
      ? 0
      : Math.round((localX - plotLeft) / plotWidth * (rows.length - 1));
    activatePoint(clamp(index, 0, rows.length - 1));
  };
  const handleMouseLeave = () => {
    setActiveIndex(null);
    onMouseLeave?.();
  };
  const activeRow = activeIndex === null ? undefined : rows[activeIndex];
  const activeX = activeIndex === null
    ? 0
    : getPointX(activeIndex, rows.length, plotLeft, plotWidth);
  const tooltipItems: QuietChartTooltipItem[] = activeRow
    ? series.map((item) => {
      const rawValue = Number(
        (activeRow as unknown as Record<string, unknown>)[item.dataKey],
      );
      const value = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
      return {
        color: item.color,
        key: item.key,
        name: item.name,
        value: formatValue(value, item),
      };
    })
    : [];
  const tooltipOnRight = activeX <= safeWidth / 2;
  const tooltipLeft = clamp(
    activeX + (tooltipOnRight ? TOOLTIP_POINT_GAP : -TOOLTIP_POINT_GAP),
    TOOLTIP_EDGE_INSET,
    Math.max(TOOLTIP_EDGE_INSET, safeWidth - TOOLTIP_EDGE_INSET),
  );

  return (
    <div
      aria-label={ariaLabel}
      className="relative h-full w-full"
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      role={onPointActivate ? "group" : "img"}
    >
      <svg
        aria-hidden="true"
        className="block h-full w-full overflow-visible"
        viewBox={`0 0 ${safeWidth} ${safeHeight}`}
      >
        {ticks.map((tick) => {
          const y = plotBottom - Math.min(safeDomainMax, Math.max(0, tick)) / safeDomainMax * plotHeight;
          return (
            <g key={tick}>
              <line
                stroke="var(--qp-chart-grid)"
                strokeDasharray="3 3"
                x1={plotLeft}
                x2={plotLeft + plotWidth}
                y1={y}
                y2={y}
              />
              <text
                fill="var(--qp-text-tertiary)"
                fontSize="11"
                textAnchor="end"
                x={plotLeft - 8}
                y={y + 4}
              >
                {formatYAxisTick(tick)}
              </text>
            </g>
          );
        })}
        {xTickIndices.map((index) => {
          const row = rows[index];
          const x = getPointX(index, rows.length, plotLeft, plotWidth);
          return (
            <g className="qp-native-trend-x-tick" key={`${row.label}-${index}`}>
              <line
                stroke="var(--qp-chart-grid)"
                strokeDasharray="3 3"
                x1={x}
                x2={x}
                y1={plotTop}
                y2={plotBottom}
              />
              <text
                fill="var(--qp-text-tertiary)"
                fontSize="11"
                textAnchor={index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"}
                x={x}
                y={plotBottom + 19}
              >
                {row.label}
              </text>
            </g>
          );
        })}
        {seriesPoints.map(({ points, series: item }) => {
          const linePath = buildSmoothLinePath(points);
          const areaPath = points.length > 0
            ? `${linePath} L ${points[points.length - 1].x} ${plotBottom} L ${points[0].x} ${plotBottom} Z`
            : "";
          return (
            <g key={item.key}>
              <path d={areaPath} fill={item.color} fillOpacity="0.12" />
              <path
                className="qp-native-trend-line"
                d={linePath}
                fill="none"
                stroke={item.color}
                strokeWidth="2"
              />
              {points.map((point, index) => (
                <circle
                  key={`${item.key}-${index}`}
                  className="qp-native-trend-dot"
                  cx={point.x}
                  cy={point.y}
                  fill={item.color}
                  r="3"
                />
              ))}
            </g>
          );
        })}
        {activeIndex !== null ? (
          <line
            className="qp-native-trend-cursor"
            stroke="var(--qp-border-strong)"
            x1={activeX}
            x2={activeX}
            y1={plotTop}
            y2={plotBottom}
          />
        ) : null}
        {rows.map((row, index) => {
          const x = getPointX(index, rows.length, plotLeft, plotWidth);
          const hitWidth = rows.length <= 1 ? plotWidth : plotWidth / (rows.length - 1);
          return (
            <rect
              key={`hit-${row.label}-${index}`}
              aria-label={row.label}
              aria-keyshortcuts={onPointActivate ? "Enter Space" : undefined}
              className="qp-native-trend-hit"
              fill="transparent"
              height={plotHeight}
              onBlur={() => setActiveIndex((current) => current === index ? null : current)}
              onClick={onPointActivate ? () => commitPoint(index) : undefined}
              onFocus={() => activatePoint(index)}
              onKeyDown={onPointActivate ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                commitPoint(index);
              } : undefined}
              role={onPointActivate ? "button" : "img"}
              tabIndex={0}
              width={hitWidth}
              x={clamp(x - hitWidth / 2, plotLeft, plotLeft + plotWidth - hitWidth)}
              y={plotTop}
            />
          );
        })}
      </svg>
      {activeRow ? (
        <QuietChartTooltip
          items={tooltipItems}
          label={activeRow.label}
          style={{
            left: `${tooltipLeft}px`,
            position: "absolute",
            top: "8px",
            transform: tooltipOnRight ? undefined : "translateX(-100%)",
            zIndex: 10,
          }}
        />
      ) : null}
    </div>
  );
}
