import { useLayoutEffect, useMemo, useRef, useState } from "react";
import QuietChartTooltip from "../components/QuietChartTooltip.tsx";
import { UI_TEXT } from "../copy/index.ts";
import type {
  HourlyActivityPoint,
  HourlyCategoryActivity,
  HourlyCategoryActivityPoint,
  HourlyCategoryActivitySegment,
} from "../lib/hourlyActivityCompiler.ts";
import {
  limitHourlyCategoryActivity,
} from "../lib/hourlyActivityCompiler.ts";
import type { HourlyActivityChartMode } from "../settings/appSettings.ts";

interface Props {
  mode: HourlyActivityChartMode;
  hourlyActivity: HourlyActivityPoint[];
  hourlyCategoryActivity: HourlyCategoryActivity;
  margin: {
    top: number;
    right: number;
    left: number;
    bottom: number;
  };
  padding: {
    left: number;
    right: number;
  };
}

interface ChartSize {
  height: number;
  width: number;
}

const COMPACT_CATEGORY_LIMIT = 4;
const EXPANDED_CATEGORY_LIMIT = 6;
const EXPANDED_CATEGORY_WIDTH = 400;
const X_AXIS_HEIGHT = 30;
const BAR_WIDTH = 8;
const MAX_MINUTES_PER_HOUR = 60;

function getPointSegments(point: HourlyCategoryActivityPoint) {
  return Object.keys(point.segmentDetails)
    .sort((left, right) => {
      const leftIndex = Number(left.replace(/\D/g, ""));
      const rightIndex = Number(right.replace(/\D/g, ""));
      return leftIndex - rightIndex;
    })
    .map((dataKey) => ({
      dataKey,
      segment: point.segmentDetails[dataKey],
    }))
    .filter((item): item is { dataKey: string; segment: HourlyCategoryActivitySegment } =>
      item.segment !== undefined && item.segment.minutes > 0
    );
}

function formatHourlyChartAriaLabel(
  point: HourlyActivityPoint | HourlyCategoryActivityPoint,
  categoryMode: boolean,
) {
  if (!categoryMode) {
    return `${point.hour} · ${UI_TEXT.hourlyActivityChart.activeMinutes} ${Math.round(point.minutes)}m`;
  }

  const categoryPoint = point as HourlyCategoryActivityPoint;
  const details = getPointSegments(categoryPoint)
    .slice()
    .reverse()
    .map(({ segment }) => `${segment.name} ${Math.round(segment.minutes)}m`)
    .join(" · ");
  const total = `${point.hour} · ${UI_TEXT.hourlyActivityChart.activeMinutes} ${Math.round(point.minutes)}m`;
  return details ? `${total} · ${details}` : total;
}

export default function HourlyActivityChart({
  mode,
  hourlyActivity,
  hourlyCategoryActivity,
  margin,
  padding,
}: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ChartSize>({ height: 0, width: 0 });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const categoryMode = mode === "category";
  const visibleCategoryLimit = size.width >= EXPANDED_CATEGORY_WIDTH
    ? EXPANDED_CATEGORY_LIMIT
    : COMPACT_CATEGORY_LIMIT;
  const visibleHourlyCategoryActivity = useMemo(
    () => limitHourlyCategoryActivity(hourlyCategoryActivity, visibleCategoryLimit),
    [hourlyCategoryActivity, visibleCategoryLimit],
  );
  const chartData = categoryMode ? visibleHourlyCategoryActivity.points : hourlyActivity;
  const chartTop = margin.top;
  const chartBottom = Math.max(chartTop, size.height - X_AXIS_HEIGHT - margin.bottom);
  const chartHeight = Math.max(0, chartBottom - chartTop);
  const chartLeft = margin.left + padding.left;
  const chartRight = Math.max(chartLeft, size.width - margin.right - padding.right);
  const chartWidth = Math.max(0, chartRight - chartLeft);
  const slotWidth = chartData.length > 0 ? chartWidth / chartData.length : 0;
  const renderedBarWidth = Math.min(BAR_WIDTH, Math.max(2, slotWidth * 0.55));
  const activePoint = activeIndex === null ? undefined : chartData[activeIndex];

  useLayoutEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const updateSize = (width: number, height: number) => {
      setSize({
        height: Math.max(0, Math.round(height)),
        width: Math.max(0, Math.round(width)),
      });
    };

    const rect = chart.getBoundingClientRect();
    updateSize(rect.width, rect.height);
    const observer = new ResizeObserver(([entry]) => {
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(chart);
    return () => observer.disconnect();
  }, []);

  const scaleMinutes = (minutes: number) =>
    Math.min(MAX_MINUTES_PER_HOUR, Math.max(0, minutes)) / MAX_MINUTES_PER_HOUR * chartHeight;
  const activeCenterX = activeIndex === null
    ? 0
    : chartLeft + slotWidth * (activeIndex + 0.5);
  const tooltipLeft = Math.min(
    Math.max(activeCenterX, 72),
    Math.max(72, size.width - 72),
  );

  return (
    <div
      ref={chartRef}
      className="relative h-full w-full"
      data-hourly-activity-chart-mode={mode}
      onMouseLeave={() => setActiveIndex(null)}
    >
      {size.width > 0 && size.height > 0 ? (
        <svg
          aria-hidden="true"
          className="block h-full w-full overflow-visible"
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          {activeIndex !== null ? (
            <rect
              fill="var(--qp-chart-cursor)"
              height={chartHeight}
              width={slotWidth}
              x={chartLeft + slotWidth * activeIndex}
              y={chartTop}
            />
          ) : null}
          {chartData.map((point, index) => {
            const centerX = chartLeft + slotWidth * (index + 0.5);
            const x = centerX - renderedBarWidth / 2;

            if (!categoryMode) {
              const barHeight = scaleMinutes(point.minutes);
              return (
                <rect
                  key={point.hour}
                  className="qp-hourly-chart-bar"
                  fill="var(--qp-accent-default)"
                  height={barHeight}
                  rx={Math.min(3, barHeight / 2)}
                  width={renderedBarWidth}
                  x={x}
                  y={chartBottom - barHeight}
                />
              );
            }

            let stackedHeight = 0;
            const segments = getPointSegments(point as HourlyCategoryActivityPoint);
            return (
              <g key={point.hour}>
                {segments.map(({ dataKey, segment }, segmentIndex) => {
                  const segmentHeight = scaleMinutes(segment.minutes);
                  const y = chartBottom - stackedHeight - segmentHeight;
                  stackedHeight += segmentHeight;
                  return (
                    <rect
                      key={dataKey}
                      className="qp-hourly-chart-bar"
                      fill={segment.color}
                      height={segmentHeight}
                      rx={segmentIndex === segments.length - 1 ? Math.min(3, segmentHeight / 2) : 0}
                      width={renderedBarWidth}
                      x={x}
                      y={y}
                    />
                  );
                })}
              </g>
            );
          })}
          {chartData.map((point, index) => {
            const x = chartLeft + slotWidth * index;
            return (
              <rect
                key={`hit-${point.hour}`}
                aria-label={formatHourlyChartAriaLabel(point, categoryMode)}
                className="qp-hourly-chart-hit"
                fill="transparent"
                height={chartHeight}
                onBlur={() => setActiveIndex((current) => current === index ? null : current)}
                onFocus={() => setActiveIndex(index)}
                onMouseEnter={() => setActiveIndex(index)}
                role="img"
                tabIndex={0}
                width={slotWidth}
                x={x}
                y={chartTop}
              />
            );
          })}
          {chartData.map((point, index) => {
            if (index % 6 !== 0) return null;
            return (
              <text
                key={`tick-${point.hour}`}
                fill="var(--qp-text-tertiary)"
                fontSize="10"
                textAnchor="middle"
                x={chartLeft + slotWidth * (index + 0.5)}
                y={chartBottom + 18}
              >
                {point.hour}
              </text>
            );
          })}
        </svg>
      ) : null}
      {activePoint && activePoint.minutes > 0 ? (
        <QuietChartTooltip
          fixedBottom
          items={categoryMode
            ? getPointSegments(activePoint as HourlyCategoryActivityPoint)
              .slice()
              .reverse()
              .map(({ dataKey, segment }) => ({
                color: segment.color,
                key: dataKey,
                name: segment.name,
                value: `${Math.round(segment.minutes)}m`,
              }))
            : [{
              key: "active-minutes",
              name: UI_TEXT.hourlyActivityChart.activeMinutes,
              value: `${Math.round(activePoint.minutes)}m`,
            }]}
          label={categoryMode
            ? `${activePoint.hour} · ${UI_TEXT.hourlyActivityChart.activeMinutes} ${Math.round(activePoint.minutes)}m`
            : activePoint.hour}
          style={{
            bottom: `${Math.max(0, size.height - chartBottom + 8)}px`,
            left: `${tooltipLeft}px`,
            position: "absolute",
            transform: "translate(-50%, -100%)",
            zIndex: 10,
          }}
        />
      ) : null}
    </div>
  );
}
