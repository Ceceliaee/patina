import { useLocale, useLocaleText, type Locale } from "../../../shared/i18n/index.ts";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  QuietTimelineSegment, QuietTimelineTrack, type QuietTimelineTrackStyle, } from "../../../shared/components/QuietTimelineTrack.tsx";
import QuietTooltip from "../../../shared/components/QuietTooltip.tsx";

import { formatDuration, formatTime } from "../services/historyFormatting.ts";
import type {
  HistoryTimelineDisplayMode,
  HistoryTimelineViewModel,
} from "../services/historyTimelineViewModel.ts";

const MAX_LEGEND_ITEMS = 7;

interface Props {
  viewModel: HistoryTimelineViewModel;
  mode: HistoryTimelineDisplayMode;
  title?: string | null;
  titleAction?: ReactNode;
  actions?: ReactNode;
  variant?: "default" | "expanded" | "lane";
  showHeader?: boolean;
  showAxis?: boolean;
  showEmptyMessage?: boolean;
  emptyMessage?: string;
  interactionActive?: boolean;
}

type TooltipContentStyle = CSSProperties & Record<"--tooltip-color", string>;

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
    };
  }

  if (viewportWidth >= 1600) {
    return {
      trackHeight: "60px",
      segmentHeight: "45px",
    };
  }

  return null;
}

function formatTimelineTime(timeMs: number, viewModel: HistoryTimelineViewModel, locale: Locale) {
  return timeMs === viewModel.dayEndMs ? "24:00" : formatTime(timeMs, locale);
}

export default function HistoryHorizontalTimeline({
  viewModel,
  mode,
  title,
  titleAction,
  actions,
  variant = "default",
  showHeader = true,
  showAxis = true,
  showEmptyMessage = true,
  emptyMessage,
  interactionActive = false,
}: Props) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const copy = UI_TEXT.history.horizontalTimeline;
  const headingTitle = title === undefined ? copy.defaultTitle : title;
  const resolvedEmptyMessage = emptyMessage ?? copy.emptyDay;
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
  const trackStyle: QuietTimelineTrackStyle | undefined = timelineMetrics
    ? {
      height: timelineMetrics.trackHeight,
      "--qp-timeline-segment-height": timelineMetrics.segmentHeight,
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
            style={{ backgroundColor: item.color }}
          />
          <span className="history-horizontal-timeline-legend-more-tooltip-label">
            {item.label}
          </span>
        </span>
      ))}
    </span>
  );
  return (
    <section
      className={`history-horizontal-timeline history-horizontal-timeline-${mode} history-horizontal-timeline-${variant}`}
      data-history-timeline-mode={mode}
      data-history-timeline-zoom-hours={viewModel.zoomHours}
      data-history-timeline-window-start={viewModel.viewportStartMs}
      data-history-timeline-window-end={viewModel.viewportEndMs}
      aria-label={copy.ariaLabel}
    >
      {showHeader && (
        <header className="history-horizontal-timeline-header">
          {(headingTitle || titleAction) && (
            <div className="history-horizontal-timeline-title-row">
              {headingTitle && (
                <h3 className="history-horizontal-timeline-title font-semibold text-[var(--qp-text-primary)] text-sm">
                  {headingTitle}
                </h3>
              )}
              {titleAction}
            </div>
          )}
          <div className="history-horizontal-timeline-meta">
            {visibleLegendItems.length > 0 && (
              <div className="history-horizontal-timeline-legend">
                {visibleLegendItems.map((item) => (
                  <span key={item.key} className="history-horizontal-timeline-legend-item">
                    <span
                      className="history-horizontal-timeline-legend-dot"
                      style={{ backgroundColor: item.color }}
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
      )}

      <QuietTimelineTrack
        axisTicks={viewModel.axisTicks}
        className="history-horizontal-timeline-canvas"
        trackClassName="history-horizontal-timeline-track"
        axisClassName="history-horizontal-timeline-axis"
        trackStyle={trackStyle}
        showAxis={showAxis}
      >
        {viewModel.segments.map((segment) => {
          const segmentColor = segment.color;
          const label = segment.label;
          const ariaLabel = `${copy.ariaLabel} ${label} ${formatTimelineTime(
            segment.startTime,
            viewModel,
            locale,
          )} - ${formatTimelineTime(segment.endTime, viewModel, locale)} ${formatDuration(segment.duration)}`;
          const tooltipContentStyle: TooltipContentStyle = {
            "--tooltip-color": segmentColor,
          };

          return (
            <QuietTimelineSegment
              key={segment.id}
              ariaLabel={ariaLabel}
              color={segmentColor}
              leftRatio={segment.startRatio}
              widthRatio={segment.widthRatio}
              tooltip={(
                <div
                  className="history-horizontal-timeline-tooltip-content"
                  style={tooltipContentStyle}
                >
                  <div className="history-horizontal-timeline-tooltip-title">
                    <span
                      className="history-horizontal-timeline-tooltip-dot"
                      aria-hidden="true"
                    />
                    <span className="history-horizontal-timeline-tooltip-label">
                      {label}
                    </span>
                  </div>
                  <div className="history-horizontal-timeline-tooltip-time">
                    {formatTimelineTime(segment.startTime, viewModel, locale)}
                    {" - "}
                    {formatTimelineTime(segment.endTime, viewModel, locale)}
                    <span aria-hidden="true"> · </span>
                    {formatDuration(segment.duration)}
                  </div>
                </div>
              )}
              disabled={interactionActive}
              hideOnPointerDown={variant !== "expanded"}
              className="history-horizontal-timeline-segment"
              tooltipClassName="history-horizontal-timeline-tooltip"
            />
          );
        })}
        {viewModel.segments.length === 0 && showEmptyMessage && (
          <span className="history-horizontal-timeline-empty">
            {resolvedEmptyMessage}
          </span>
        )}
      </QuietTimelineTrack>
    </section>
  );
}
