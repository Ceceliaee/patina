import type { CSSProperties, ReactNode } from "react";
import QuietTooltip from "./QuietTooltip.tsx";
import type { TimelineAxisTick } from "../lib/timelineAxis.ts";

type TimelineTrackStyle = CSSProperties & Partial<Record<
  "--qp-timeline-segment-height",
  string
>>;

type TimelineSegmentStyle = CSSProperties & Record<
  | "--qp-timeline-segment-left"
  | "--qp-timeline-segment-width"
  | "--qp-timeline-segment-color",
  string
>;

interface QuietTimelineTrackProps {
  children: ReactNode;
  axisTicks: readonly TimelineAxisTick[];
  className?: string;
  trackClassName?: string;
  axisClassName?: string;
  trackStyle?: TimelineTrackStyle;
  showAxis?: boolean;
}

interface QuietTimelineSegmentProps {
  ariaLabel: string;
  color: string;
  leftRatio: number;
  widthRatio: number;
  tooltip: ReactNode;
  className?: string;
  tooltipClassName?: string;
  disabled?: boolean;
  hideOnPointerDown?: boolean;
}

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function QuietTimelineTrack({
  children,
  axisTicks,
  className,
  trackClassName,
  axisClassName,
  trackStyle,
  showAxis = true,
}: QuietTimelineTrackProps) {
  return (
    <div className={joinClasses("qp-timeline-canvas", className)}>
      <div
        className={joinClasses("qp-timeline-track", trackClassName)}
        style={trackStyle}
      >
        {children}
      </div>
      {showAxis && (
        <div
          className={joinClasses("qp-timeline-axis", axisClassName)}
          aria-hidden="true"
        >
          {axisTicks.map((tick) => (
            <span
              key={`${tick.label}:${tick.ratio}`}
              style={{ left: `${tick.ratio * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuietTimelineSegment({
  ariaLabel,
  color,
  leftRatio,
  widthRatio,
  tooltip,
  className,
  tooltipClassName,
  disabled = false,
  hideOnPointerDown = true,
}: QuietTimelineSegmentProps) {
  const style: TimelineSegmentStyle = {
    "--qp-timeline-segment-left": `${leftRatio * 100}%`,
    "--qp-timeline-segment-width": `${Math.max(0, widthRatio) * 100}%`,
    "--qp-timeline-segment-color": color,
  };

  return (
    <QuietTooltip
      label={tooltip}
      placement="top"
      disabled={disabled}
      hideOnPointerDown={hideOnPointerDown}
      className={joinClasses("qp-timeline-segment", className)}
      tooltipClassName={tooltipClassName}
      style={style}
    >
      <span aria-label={ariaLabel} />
    </QuietTooltip>
  );
}

export type { TimelineTrackStyle as QuietTimelineTrackStyle };
