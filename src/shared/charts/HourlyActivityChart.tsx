import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, Rectangle, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { BarShapeProps } from "recharts";
import { UI_TEXT } from "../copy/uiText.ts";
import type {
  HourlyActivityPoint,
  HourlyCategoryActivity,
  HourlyCategoryActivityPoint,
  HourlyCategoryActivitySegment,
} from "../lib/hourlyActivityCompiler.ts";
import {
  getHourlyCategorySlotDataKey,
  limitHourlyCategoryActivity,
} from "../lib/hourlyActivityCompiler.ts";
import QuietChartTooltip from "../components/QuietChartTooltip";
import type { HourlyActivityChartMode } from "../settings/appSettings.ts";

export type { HourlyActivityChartMode } from "../settings/appSettings.ts";

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

const BAR_TOP_RADIUS: [number, number, number, number] = [3, 3, 0, 0];
const COMPACT_CATEGORY_LIMIT = 4;
const EXPANDED_CATEGORY_LIMIT = 6;
const EXPANDED_CATEGORY_WIDTH = 400;

function renderStackedBarShape(
  dataKey: string,
  higherDataKeys: string[],
) {
  return ({ height, payload, width, x, y }: BarShapeProps) => {
    const point = payload as HourlyCategoryActivityPoint | undefined;
    const segment = point?.segmentDetails[dataKey];
    const hasHigherActiveSegment = higherDataKeys.some(
      (higherDataKey) => Number(payload?.[higherDataKey] ?? 0) > 0,
    );

    return (
      <Rectangle
        fill={segment?.color}
        height={height}
        radius={hasHigherActiveSegment ? 0 : BAR_TOP_RADIUS}
        width={width}
        x={x}
        y={y}
      />
    );
  };
}

export default function HourlyActivityChart({
  mode,
  hourlyActivity,
  hourlyCategoryActivity,
  margin,
  padding,
}: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [visibleCategoryLimit, setVisibleCategoryLimit] = useState(COMPACT_CATEGORY_LIMIT);
  const categoryMode = mode === "category";
  const visibleHourlyCategoryActivity = useMemo(
    () => limitHourlyCategoryActivity(hourlyCategoryActivity, visibleCategoryLimit),
    [hourlyCategoryActivity, visibleCategoryLimit],
  );
  const chartData = categoryMode ? visibleHourlyCategoryActivity.points : hourlyActivity;
  const stackedDataKeyCount = visibleHourlyCategoryActivity.points.reduce(
    (maxCount, point) => Math.max(maxCount, Object.keys(point.segmentDetails).length),
    0,
  );
  const stackedDataKeys = Array.from({ length: stackedDataKeyCount }, (_, index) =>
    getHourlyCategorySlotDataKey(index),
  );
  const getTooltipSegment = (item: { dataKey?: string | number; payload?: unknown }) => {
    const dataKey = String(item.dataKey ?? "");
    const point = item.payload as HourlyCategoryActivityPoint | undefined;
    return point?.segmentDetails[dataKey] as HourlyCategoryActivitySegment | undefined;
  };

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const updateLimit = (width: number) => {
      setVisibleCategoryLimit(width >= EXPANDED_CATEGORY_WIDTH
        ? EXPANDED_CATEGORY_LIMIT
        : COMPACT_CATEGORY_LIMIT);
    };

    updateLimit(chart.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      updateLimit(entry.contentRect.width);
    });
    observer.observe(chart);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={chartRef} className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={margin}>
        <XAxis
          dataKey="hour"
          tick={{ fontSize: 10, fill: "var(--qp-text-tertiary)" }}
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          interval={5}
          padding={padding}
        />
        <YAxis hide domain={[0, 60]} allowDataOverflow />
        <QuietChartTooltip
          cursor={{ fill: "var(--qp-chart-cursor)" }}
          filterZeroValues={categoryMode}
          reverseItems={categoryMode}
          colorFormatter={(item) => categoryMode ? getTooltipSegment(item)?.color : undefined}
          labelFormatter={(label, payload) => {
            if (!categoryMode) return label;
            const totalMinutes = Number(payload[0]?.payload && (
              payload[0].payload as { minutes?: number }
            ).minutes) || 0;
            return `${String(label)} · ${UI_TEXT.dashboard.activeMinutes} ${Math.round(totalMinutes)}m`;
          }}
          formatter={(value, _name, item) => [
            `${Math.round(Number(value))}m`,
            categoryMode ? getTooltipSegment(item)?.name : UI_TEXT.dashboard.activeMinutes,
          ]}
        />
        {categoryMode ? (
          stackedDataKeys.map((dataKey, index) => (
            <Bar
              key={dataKey}
              dataKey={dataKey}
              stackId="hourly-category"
              shape={renderStackedBarShape(
                dataKey,
                stackedDataKeys.slice(index + 1),
              )}
              barSize={8}
            />
          ))
        ) : (
          <Bar dataKey="minutes" fill="var(--qp-accent-default)" radius={BAR_TOP_RADIUS} barSize={8} />
        )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
