import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import QuietTooltip from "../../../shared/components/QuietTooltip.tsx";
import { getUiLocale } from "../../../shared/copy/uiText.ts";
import { formatDuration, formatTime } from "../services/historyFormatting.ts";
import type {
  HistoryTimelineDisplayMode,
  HistoryTimelineSegment,
  HistoryTimelineViewModel,
} from "../services/historyTimelineViewModel.ts";

const MAX_LEGEND_ITEMS = 7;

interface Props {
  viewModel: HistoryTimelineViewModel;
  mode: HistoryTimelineDisplayMode;
  iconThemeColors: Record<string, string>;
  title?: string | null;
  actions?: ReactNode;
  variant?: "default" | "expanded";
  showEmptyMessage?: boolean;
}

type TimelineMetricVariable =
  | "--history-horizontal-timeline-segment-height"
  | "--history-horizontal-timeline-segment-hover-height"
  | "--history-horizontal-timeline-segment-active-height"
  | "--history-horizontal-timeline-segment-active-strong-height";
type TimelineStyle = CSSProperties
  & Record<"--segment-left" | "--segment-width" | "--segment-color", string>
  & Partial<Record<TimelineMetricVariable, string>>;
type TrackStyle = CSSProperties & Partial<Record<TimelineMetricVariable, string>>;
type TooltipStyle = CSSProperties & Record<"--tooltip-left" | "--tooltip-color", string>;

function resolveSegmentColor(
  segment: HistoryTimelineSegment,
  mode: HistoryTimelineDisplayMode,
  iconThemeColors: Record<string, string>,
) {
  if (mode === "category") {
    return AppClassification.getCategoryColor(segment.category);
  }

  const overrideColor = AppClassification.getUserOverride(segment.appKey)?.color
    ?? AppClassification.getUserOverride(segment.exeName)?.color;
  const mapped = AppClassification.mapApp(segment.appKey, { appName: segment.displayName });

  return overrideColor
    ?? iconThemeColors[segment.appKey]
    ?? iconThemeColors[segment.exeName]
    ?? mapped.color;
}

function resolveLegendColor(
  item: { key: string; category: HistoryTimelineSegment["category"]; exeName: string },
  mode: HistoryTimelineDisplayMode,
  iconThemeColors: Record<string, string>,
) {
  if (mode === "category") {
    return AppClassification.getCategoryColor(item.category);
  }

  const overrideColor = AppClassification.getUserOverride(item.key)?.color
    ?? AppClassification.getUserOverride(item.exeName)?.color;
  const mapped = AppClassification.mapApp(item.key);

  return overrideColor
    ?? iconThemeColors[item.key]
    ?? iconThemeColors[item.exeName]
    ?? mapped.color;
}

function getSegmentLabel(segment: HistoryTimelineSegment, mode: HistoryTimelineDisplayMode) {
  return mode === "category" ? segment.categoryLabel : segment.displayName;
}

function getTimelineCopy() {
  const isEnglish = getUiLocale() === "en-US";
  if (isEnglish) {
    return {
      ariaLabel: "Horizontal daily timeline",
      defaultTitle: "Day Timeline",
      emptyDay: "No records for this day",
      remainingLegendItems: (count: number) => `+${count}`,
      remainingLegendItemsHint: (labels: string[]) => labels.join(", "),
    };
  }

  return {
    ariaLabel: "横向日内时间轴",
    defaultTitle: "时间轴",
    emptyDay: "这一天暂无记录",
    remainingLegendItems: (count: number) => `+${count}`,
    remainingLegendItemsHint: (labels: string[]) => labels.join("、"),
  };
}

function getViewportWidth() {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

function getTimelineMetrics(variant: Props["variant"], viewportWidth: number) {
  if (variant !== "default") {
    return null;
  }

  if (viewportWidth >= 1900) {
    return {
      trackHeight: "72px",
      segmentHeight: "54px",
      segmentHoverHeight: "58px",
      segmentActiveHeight: "50px",
      segmentActiveStrongHeight: "60px",
    };
  }

  if (viewportWidth >= 1600) {
    return {
      trackHeight: "60px",
      segmentHeight: "45px",
      segmentHoverHeight: "48px",
      segmentActiveHeight: "42px",
      segmentActiveStrongHeight: "50px",
    };
  }

  return null;
}

function formatTimelineTime(timeMs: number, viewModel: HistoryTimelineViewModel) {
  return timeMs === viewModel.dayEndMs ? "24:00" : formatTime(timeMs);
}

export default function HistoryHorizontalTimeline({
  viewModel,
  mode,
  iconThemeColors,
  title,
  actions,
  variant = "default",
  showEmptyMessage = true,
}: Props) {
  const copy = getTimelineCopy();
  const headingTitle = title ?? copy.defaultTitle;
  const [viewportWidth, setViewportWidth] = useState(getViewportWidth);
  useEffect(() => {
    if (variant !== "default") {
      return undefined;
    }

    const handleResize = () => setViewportWidth(getViewportWidth());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [variant]);

  const timelineMetrics = getTimelineMetrics(variant, viewportWidth);
  const trackStyle: TrackStyle | undefined = timelineMetrics
    ? {
      height: timelineMetrics.trackHeight,
      "--history-horizontal-timeline-segment-height": timelineMetrics.segmentHeight,
      "--history-horizontal-timeline-segment-hover-height": timelineMetrics.segmentHoverHeight,
      "--history-horizontal-timeline-segment-active-height": timelineMetrics.segmentActiveHeight,
      "--history-horizontal-timeline-segment-active-strong-height": timelineMetrics.segmentActiveStrongHeight,
    }
    : undefined;
  const visibleLegendItems = viewModel.legendItems.slice(0, MAX_LEGEND_ITEMS);
  const hiddenLegendItems = viewModel.legendItems.slice(MAX_LEGEND_ITEMS);
  const hiddenLegendCount = Math.max(0, viewModel.legendItems.length - visibleLegendItems.length);
  const hiddenLegendLabel = copy.remainingLegendItems(hiddenLegendCount);
  const hiddenLegendHint = copy.remainingLegendItemsHint(
    hiddenLegendItems.map((item) => item.label),
  );
  const hiddenLegendTooltip = (
    <span
      className="history-horizontal-timeline-legend-more-tooltip"
      data-hidden-legend-count={hiddenLegendCount}
      data-hidden-legend-layout={hiddenLegendCount >= 8 ? "double" : "single"}
      aria-hidden="true"
    >
      {hiddenLegendItems.map((item) => (
        <span key={item.key} className="history-horizontal-timeline-legend-more-tooltip-item">
          <span
            className="history-horizontal-timeline-legend-more-tooltip-dot"
            style={{ backgroundColor: resolveLegendColor(item, mode, iconThemeColors) }}
          />
          <span className="history-horizontal-timeline-legend-more-tooltip-label">
            {item.label}
          </span>
        </span>
      ))}
    </span>
  );
  const [tooltipSegmentId, setTooltipSegmentId] = useState<string | null>(null);
  const tooltipSegment = tooltipSegmentId
    ? viewModel.segments.find((segment) => segment.id === tooltipSegmentId)
    : undefined;
  const tooltipSegmentColor = tooltipSegment
    ? resolveSegmentColor(tooltipSegment, mode, iconThemeColors)
    : undefined;
  const tooltipSegmentLabel = tooltipSegment
    ? getSegmentLabel(tooltipSegment, mode)
    : "";
  const tooltipCenterRatio = tooltipSegment
    ? (tooltipSegment.startRatio + tooltipSegment.endRatio) / 2
    : 0.5;
  const tooltipStyle: TooltipStyle | undefined = tooltipSegmentColor
    ? {
      "--tooltip-left": `${tooltipCenterRatio * 100}%`,
      "--tooltip-color": tooltipSegmentColor,
    }
    : undefined;
  const tooltipEdgeClass = tooltipCenterRatio < 0.12
    ? "history-horizontal-timeline-tooltip-start"
    : tooltipCenterRatio > 0.88
      ? "history-horizontal-timeline-tooltip-end"
      : "";

  return (
    <section
      className={`history-horizontal-timeline history-horizontal-timeline-${mode} history-horizontal-timeline-${variant}`}
      data-history-timeline-mode={mode}
      aria-label={copy.ariaLabel}
    >
      <header className="history-horizontal-timeline-header">
        {headingTitle && (
          <h3 className="history-horizontal-timeline-title font-semibold text-[var(--qp-text-primary)] text-sm">
            {headingTitle}
          </h3>
        )}
        <div className="history-horizontal-timeline-meta">
          {visibleLegendItems.length > 0 && (
            <div className="history-horizontal-timeline-legend">
              {visibleLegendItems.map((item) => (
                <span key={item.key} className="history-horizontal-timeline-legend-item">
                  <span
                    className="history-horizontal-timeline-legend-dot"
                    style={{ backgroundColor: resolveLegendColor(item, mode, iconThemeColors) }}
                    aria-hidden="true"
                  />
                  <span className="history-horizontal-timeline-legend-label">{item.label}</span>
                </span>
              ))}
              {hiddenLegendCount > 0 && (
                <QuietTooltip
                  label={hiddenLegendTooltip}
                  placement="top"
                  className="history-horizontal-timeline-legend-more-anchor"
                  tooltipClassName="history-horizontal-timeline-legend-more-popover"
                >
                  <span
                    className="history-horizontal-timeline-legend-more"
                    tabIndex={0}
                    aria-label={hiddenLegendHint}
                    data-history-timeline-legend-more={hiddenLegendCount}
                  >
                    {hiddenLegendLabel}
                  </span>
                </QuietTooltip>
              )}
            </div>
          )}
          {actions && (
            <div className="history-horizontal-timeline-actions">
              {actions}
            </div>
          )}
        </div>
      </header>

      <div className="history-horizontal-timeline-canvas">
        <div className="history-horizontal-timeline-track" style={trackStyle}>
          {viewModel.segments.map((segment) => {
            const segmentColor = resolveSegmentColor(segment, mode, iconThemeColors);
            const segmentStyle: TimelineStyle = {
              "--segment-left": `${segment.startRatio * 100}%`,
              "--segment-width": `${segment.widthRatio * 100}%`,
              "--segment-color": segmentColor,
              ...(timelineMetrics
                ? {
                  "--history-horizontal-timeline-segment-height": timelineMetrics.segmentHeight,
                  "--history-horizontal-timeline-segment-hover-height": timelineMetrics.segmentHoverHeight,
                  "--history-horizontal-timeline-segment-active-height": timelineMetrics.segmentActiveHeight,
                  "--history-horizontal-timeline-segment-active-strong-height": timelineMetrics.segmentActiveStrongHeight,
                }
                : {}),
            };
            const label = getSegmentLabel(segment, mode);

            return (
              <span
                key={segment.id}
                tabIndex={0}
                aria-label={`${copy.ariaLabel} ${label} ${formatTimelineTime(
                  segment.startTime,
                  viewModel,
                )} - ${formatTimelineTime(segment.endTime, viewModel)} ${formatDuration(segment.duration)}`}
                className="history-horizontal-timeline-segment"
                style={segmentStyle}
                onPointerEnter={() => setTooltipSegmentId(segment.id)}
                onPointerLeave={() => setTooltipSegmentId((current) => (current === segment.id ? null : current))}
                onFocus={() => setTooltipSegmentId(segment.id)}
                onBlur={() => setTooltipSegmentId((current) => (current === segment.id ? null : current))}
              />
            );
          })}
          {tooltipSegment && tooltipStyle && (
            <div
              className={`history-horizontal-timeline-tooltip ${tooltipEdgeClass}`.trim()}
              style={tooltipStyle}
              role="tooltip"
            >
              <div className="history-horizontal-timeline-tooltip-title">
                <span className="history-horizontal-timeline-tooltip-dot" aria-hidden="true" />
                <span className="history-horizontal-timeline-tooltip-label">
                  {tooltipSegmentLabel}
                </span>
              </div>
              <div className="history-horizontal-timeline-tooltip-time">
                {formatTimelineTime(tooltipSegment.startTime, viewModel)}
                {" - "}
                {formatTimelineTime(tooltipSegment.endTime, viewModel)}
                <span aria-hidden="true"> · </span>
                {formatDuration(tooltipSegment.duration)}
              </div>
            </div>
          )}
          {viewModel.segments.length === 0 && showEmptyMessage && (
            <span className="history-horizontal-timeline-empty">
              {copy.emptyDay}
            </span>
          )}
        </div>
        <div className="history-horizontal-timeline-axis" aria-hidden="true">
          {viewModel.axisTicks.map((tick) => (
            <span key={tick.label} style={{ left: `${tick.ratio * 100}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
