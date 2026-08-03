import { ChevronDown, ChevronRight, ChevronUp, Globe2 } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import { formatDuration, formatTime } from "../services/historyFormatting.ts";
import type { TimelineSession } from "../../../shared/lib/sessionReadCompiler.ts";
import type { WebTimelineItem } from "../services/historyWebActivityViewModel.ts";
import type {
  HistoryTimelineDetailsPopoverState,
  TimelineDetailTitle,
} from "./HistoryTimelineDetailsPopover.tsx";

interface HistoryTimelineListProps {
  loading: boolean;
  timelineSessions: TimelineSession[];
  icons: Record<string, string>;
  iconThemeColors: Record<string, string>;
  detailsPopover: HistoryTimelineDetailsPopoverState | null;
  className?: string;
  onToggleSessionDetails: (
    sessionId: number | string,
    appName: string,
    titleSampleDetails: TimelineDetailTitle[],
    trigger: HTMLElement,
  ) => void;
}

interface HistoryWebTimelineListProps {
  loading: boolean;
  items: WebTimelineItem[];
  detailsPopover: HistoryTimelineDetailsPopoverState | null;
  className?: string;
  onToggleSessionDetails: (
    sessionId: number | string,
    appName: string,
    titleSampleDetails: TimelineDetailTitle[],
    trigger: HTMLElement,
  ) => void;
}

export function HistoryTimelineList({
  loading,
  timelineSessions,
  icons,
  iconThemeColors,
  detailsPopover,
  className = "",
  onToggleSessionDetails,
}: HistoryTimelineListProps) {
  if (loading) {
    return <div className="flex-1" aria-hidden="true" />;
  }

  if (timelineSessions.length === 0) {
    return (
      <div className={`history-timeline-list-empty flex-1 flex items-center justify-center text-[var(--qp-text-tertiary)] text-sm ${className}`.trim()}>
        {UI_TEXT.history.emptyDay}
      </div>
    );
  }

  return (
    <div className={`history-timeline-list flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1 ${className}`.trim()}>
      {timelineSessions.map((session) => {
          const mapped = AppClassification.mapApp(session.exeName, { appName: session.displayName });
          const overrideColor = AppClassification.getUserOverride(session.exeName)?.color;
          const accentColor = overrideColor ?? iconThemeColors[session.exeName] ?? mapped.color;
          const titleSamples = session.titleSamples.length > 0
            ? session.titleSamples
            : (session.displayTitle ? [session.displayTitle] : []);
          const titleSampleDetails: TimelineDetailTitle[] = session.titleSampleDetails.length > 0
            ? session.titleSampleDetails
            : titleSamples.map((title) => ({
              title,
              startTime: session.startTime,
              endTime: session.endTime,
            }));
          const hasDetails = titleSampleDetails.length > 0;
          const isExpanded = detailsPopover?.sessionId === session.id;
          const detailPlacement = isExpanded && detailsPopover ? detailsPopover.placement : "bottom";

          return (
            <div
              key={session.id}
              className="qp-workbench-list-card flex items-center gap-3 p-3"
            >
              <div
                className="w-1 self-stretch rounded-full flex-shrink-0"
                style={{ backgroundColor: accentColor }}
              />
              <div className="w-8 h-8 rounded-[8px] bg-[var(--qp-bg-panel)] border border-[var(--qp-border-subtle)] flex items-center justify-center flex-shrink-0 overflow-hidden p-1.5">
                {icons[session.exeName] ? (
                  <img src={icons[session.exeName]} className="w-full h-full object-contain" alt="" />
                ) : (
                  <div className="text-[10px] font-semibold opacity-35 text-[var(--qp-text-secondary)]">{mapped.category[0].toUpperCase()}</div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <div className="flex min-w-0 flex-1 items-end gap-1.5">
                  <div className="min-w-0 truncate text-sm font-semibold text-[var(--qp-text-primary)]">
                    {session.displayName}
                  </div>
                  <span className="qp-workbench-list-meta">
                    <span>
                      {UI_TEXT.history.activitySegmentCount(session.mergedCount)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {UI_TEXT.history.titleRowCount(titleSampleDetails.length)}
                    </span>
                  </span>
                  {hasDetails && (
                    <button
                      type="button"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => onToggleSessionDetails(
                        session.id,
                        session.displayName,
                        titleSampleDetails,
                        event.currentTarget,
                      )}
                      aria-expanded={isExpanded}
                      aria-label={UI_TEXT.accessibility.history.toggleActivityDetails(
                        isExpanded,
                        session.displayName,
                      )}
                      className="qp-button-secondary qp-compact-disclosure"
                    >
                      {isExpanded
                        ? detailPlacement === "top"
                          ? <ChevronUp size={11} aria-hidden="true" />
                          : <ChevronDown size={11} aria-hidden="true" />
                        : <ChevronRight size={11} aria-hidden="true" />}
                    </button>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-xs font-semibold text-[var(--qp-text-primary)] tabular-nums">{formatDuration(session.duration || 0)}</div>
                <div className="text-[10px] text-[var(--qp-text-tertiary)] mt-0.5 tabular-nums">
                  {formatTime(session.startTime)}
                  {session.endTime ? ` - ${formatTime(session.endTime)}` : ` ${UI_TEXT.history.untilNow}`}
                </div>
              </div>
            </div>
          );
        })}
    </div>
  );
}

export function HistoryWebTimelineList({
  loading,
  items,
  detailsPopover,
  className = "",
  onToggleSessionDetails,
}: HistoryWebTimelineListProps) {
  if (loading) {
    return <div className="flex-1" aria-hidden="true" />;
  }

  if (items.length === 0) {
    return (
      <div className={`history-timeline-list-empty flex-1 flex items-center justify-center text-[var(--qp-text-tertiary)] text-sm ${className}`.trim()}>
        {UI_TEXT.history.emptyDay}
      </div>
    );
  }

  return (
    <div className={`history-timeline-list flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1 ${className}`.trim()}>
      {items.map((item) => {
          const titleSampleDetails: TimelineDetailTitle[] = item.titleSampleDetails;
          const hasDetails = titleSampleDetails.length > 0;
          const titleCount = item.titleSamples.length;
          const isExpanded = detailsPopover?.sessionId === item.id;
          const detailPlacement = isExpanded && detailsPopover ? detailsPopover.placement : "bottom";

          return (
            <div
              key={item.id}
              className="qp-workbench-list-card flex items-center gap-3 p-3"
            >
              <div
                className="w-1 self-stretch rounded-full flex-shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <div className="w-8 h-8 rounded-[8px] bg-[var(--qp-bg-panel)] border border-[var(--qp-border-subtle)] flex items-center justify-center flex-shrink-0 overflow-hidden p-1.5">
                {item.faviconUrl ? (
                  <img src={item.faviconUrl} className="w-full h-full object-contain" alt="" />
                ) : (
                  <Globe2 size={15} className="text-[var(--qp-text-tertiary)]" aria-hidden="true" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <div className="flex min-w-0 flex-1 items-end gap-1.5">
                  <div className="min-w-0 truncate text-sm font-semibold text-[var(--qp-text-primary)]">
                    {item.label}
                  </div>
                  {titleCount > 0 && (
                    <span className="qp-workbench-list-meta">
                      {UI_TEXT.history.titleRowCount(titleCount)}
                    </span>
                  )}
                  {hasDetails && (
                    <button
                      type="button"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => onToggleSessionDetails(
                        item.id,
                        item.label,
                        titleSampleDetails,
                        event.currentTarget,
                      )}
                      aria-expanded={isExpanded}
                      aria-label={UI_TEXT.accessibility.history.toggleActivityDetails(
                        isExpanded,
                        item.label,
                      )}
                      className="qp-button-secondary qp-compact-disclosure"
                    >
                      {isExpanded
                        ? detailPlacement === "top"
                          ? <ChevronUp size={11} aria-hidden="true" />
                          : <ChevronDown size={11} aria-hidden="true" />
                        : <ChevronRight size={11} aria-hidden="true" />}
                    </button>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-xs font-semibold text-[var(--qp-text-primary)] tabular-nums">
                  {formatDuration(item.duration || 0)}
                </div>
                <div className="text-[10px] text-[var(--qp-text-tertiary)] mt-0.5 tabular-nums">
                  {formatTime(item.startTime)}
                  {item.endTime ? ` - ${formatTime(item.endTime)}` : ` ${UI_TEXT.history.untilNow}`}
                </div>
              </div>
            </div>
          );
        })}
    </div>
  );
}
