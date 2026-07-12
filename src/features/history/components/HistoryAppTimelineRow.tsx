import { useState, useMemo } from "react";
import type { CSSProperties } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { formatDuration, formatTime } from "../services/historyFormatting";
import type {
  HistoryAppTimelineAppItem,
  HistoryAppTimelineSegment,
} from "../services/historyAppTimelineViewModel";

interface Props {
  appItem: HistoryAppTimelineAppItem;
  dayStartMs: number;
  dayEndMs: number;
  iconSrc?: string;
  index: number;
  expandable?: boolean;
  isExpanded?: boolean;
  onSegmentClick?: (segment: HistoryAppTimelineSegment, appItem: HistoryAppTimelineAppItem, e?: React.MouseEvent) => void;
  onSegmentDoubleClick?: (segment: HistoryAppTimelineSegment, appItem: HistoryAppTimelineAppItem, e?: React.MouseEvent) => void;
}

type SegmentStyle = CSSProperties & Record<"--segment-left" | "--segment-width" | "--segment-color", string>;
type TrackStyle = CSSProperties & Record<"--segment-color", string>;

function AppIcon({ src, appName, color }: { src?: string; appName: string; color: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-6 w-6 shrink-0 rounded-[6px] object-contain"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }

  const initial = appName.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[10px] font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {initial}
    </div>
  );
}

function formatTimelineTime(timeMs: number, dayEndMs: number) {
  return timeMs === dayEndMs ? "24:00" : formatTime(timeMs);
}

export default function HistoryAppTimelineRow({
  appItem,
  dayStartMs: _dayStartMs,
  dayEndMs,
  iconSrc,
  onSegmentClick,
  onSegmentDoubleClick,
  expandable = false,
  isExpanded = false,
}: Props) {
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);

  const tooltipSegment = useMemo(
    () => appItem.segments.find((s) => s.id === hoveredSegmentId),
    [hoveredSegmentId, appItem.segments],
  );

  const tooltipCenterRatio = tooltipSegment
    ? (tooltipSegment.startRatio + tooltipSegment.widthRatio / 2)
    : 0.5;

  const tooltipEdgeClass = tooltipCenterRatio < 0.12
    ? "history-app-timeline-tooltip-start"
    : tooltipCenterRatio > 0.88
      ? "history-app-timeline-tooltip-end"
      : "";

  const trackStyle: TrackStyle = {
    "--segment-color": appItem.color,
  };

  return (
    <div
      className="history-app-timeline-row group"
      data-app-exe={appItem.exeName}
    >
      <div className="history-app-timeline-row-header">
        <div className="history-app-timeline-row-info">
          <div className="history-app-timeline-row-expander">
            {expandable ? (
              isExpanded ? (
                <ChevronDown size={12} className="text-[var(--qp-text-tertiary)]" />
              ) : (
                <ChevronRight size={12} className="text-[var(--qp-text-tertiary)]" />
              )
            ) : null}
          </div>
          <AppIcon src={iconSrc} appName={appItem.appName} color={appItem.color} />
          <div className="history-app-timeline-row-text">
            <span className="history-app-timeline-row-name" title={appItem.appName}>
              {appItem.appName}
            </span>
            <span className="history-app-timeline-row-category" title={appItem.categoryLabel}>
              {appItem.categoryLabel}
            </span>
          </div>
        </div>
        <div className="history-app-timeline-row-stats">
          <span className="history-app-timeline-row-duration">
            {formatDuration(appItem.totalDuration)}
          </span>
          <span className="history-app-timeline-row-percentage">
            {appItem.percentage.toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="history-app-timeline-track-wrap">
        <div
          className="history-app-timeline-track"
          style={trackStyle}
        >
          {appItem.segments.map((segment) => {
            const isHovered = hoveredSegmentId === segment.id;
            const isActive = activeSegmentId === segment.id;
            const otherHovered = hoveredSegmentId !== null && !isHovered;

            const segmentStyle: SegmentStyle = {
              "--segment-left": `${segment.startRatio * 100}%`,
              "--segment-width": `${segment.widthRatio * 100}%`,
              "--segment-color": appItem.color,
            };

            return (
              <span
                key={segment.id}
                tabIndex={0}
                className={`history-app-timeline-segment ${
                  isHovered ? "is-hovered" : ""
                } ${isActive ? "is-active" : ""} ${otherHovered ? "is-dimmed" : ""}`}
                style={segmentStyle}
                onPointerEnter={() => setHoveredSegmentId(segment.id)}
                onPointerLeave={() => setHoveredSegmentId((current) => (current === segment.id ? null : current))}
                onFocus={() => setHoveredSegmentId(segment.id)}
                onBlur={() => setHoveredSegmentId((current) => (current === segment.id ? null : current))}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveSegmentId(segment.id);
                  onSegmentClick?.(segment, appItem, e);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setActiveSegmentId(segment.id);
                  onSegmentDoubleClick?.(segment, appItem, e);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setActiveSegmentId(segment.id);
                    onSegmentClick?.(segment, appItem);
                  }
                }}
                aria-label={`${appItem.appName} ${formatTimelineTime(
                  segment.startTime,
                  dayEndMs,
                )} - ${formatTimelineTime(segment.endTime, dayEndMs)} ${formatDuration(segment.duration)}`}
              />
            );
          })}

          {tooltipSegment && (
            <div
              className={`history-app-timeline-tooltip ${tooltipEdgeClass}`.trim()}
              style={{
                "--tooltip-left": `${tooltipCenterRatio * 100}%`,
                "--tooltip-color": appItem.color,
              } as CSSProperties}
              role="tooltip"
            >
              <div className="history-app-timeline-tooltip-title">
                <span className="history-app-timeline-tooltip-dot" aria-hidden="true" />
                <span className="history-app-timeline-tooltip-label">
                  {appItem.appName}
                </span>
              </div>
              {tooltipSegment.displayTitle && (
                <div className="history-app-timeline-tooltip-subtitle">
                  {tooltipSegment.displayTitle}
                </div>
              )}
              <div className="history-app-timeline-tooltip-time">
                {formatTimelineTime(tooltipSegment.startTime, dayEndMs)}
                {" - "}
                {formatTimelineTime(tooltipSegment.endTime, dayEndMs)}
                <span aria-hidden="true"> · </span>
                {formatDuration(tooltipSegment.duration)}
              </div>
            </div>
          )}

          {appItem.segments.length === 0 && (
            <span className="history-app-timeline-empty">
              —
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
