import { ChevronDown, ChevronRight, ChevronUp, Globe2 } from "lucide-react";
import { useCallback, useState } from "react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import { formatDuration, formatTime } from "../services/historyFormatting.ts";
import type { TimelineSession } from "../../../shared/lib/sessionReadCompiler.ts";
import type { WebTimelineItem } from "../services/historyWebActivityViewModel.ts";
import type {
  HistoryTimelineDetailsPopoverState,
  TimelineDetailTitle,
} from "./HistoryTimelineDetailsPopover.tsx";
import type { ScreenshotEntry } from "../services/historyScreenshots.ts";
import { getScreenshotData } from "../services/historyScreenshots.ts";

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
  screenshotsBySessionId: Record<number, ScreenshotEntry[]>;
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

const PREVIEW_SCREENSHOT_COUNT = 5;

function SessionScreenshotThumbnails({ screenshots }: { screenshots: ScreenshotEntry[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [fullImage, setFullImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const displayScreenshots = showAll ? screenshots : screenshots.slice(0, PREVIEW_SCREENSHOT_COUNT);
  const hasMore = screenshots.length > PREVIEW_SCREENSHOT_COUNT;

  const handleClick = useCallback(async (s: ScreenshotEntry) => {
    if (expandedId === s.id) {
      setExpandedId(null);
      setFullImage(null);
      return;
    }
    setExpandedId(s.id);
    setFullImage(null);
    setLoading(true);
    try {
      const data = await getScreenshotData(s.id);
      setFullImage(data);
    } catch {
      setExpandedId(null);
    } finally {
      setLoading(false);
    }
  }, [expandedId]);

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1">
        {displayScreenshots.map((s) => (
          <div key={s.id} className="flex flex-col">
            <button
              type="button"
              className={`shrink-0 rounded overflow-hidden border-2 transition-colours ${
                expandedId === s.id
                  ? "border-[var(--qp-accent)]"
                  : "border-transparent hover:border-[var(--qp-border)]"
              }`}
              onClick={() => handleClick(s)}
              title={new Date(s.capturedAt).toLocaleTimeString()}
            >
              <img
                src={`data:image/webp;base64,${s.thumbnailBase64}`}
                alt={`Screenshot at ${new Date(s.capturedAt).toLocaleTimeString()}`}
                className="block"
                style={{ width: "100px", height: "auto", aspectRatio: `${s.width}/${s.height}` }}
              />
            </button>
            {expandedId === s.id && (
              <div className="mt-1 relative rounded overflow-hidden border border-[var(--qp-border)] bg-black/5 max-w-[320px] z-10">
                {loading && (
                  <div className="text-[10px] text-[var(--qp-text-tertiary)] p-2">Loading...</div>
                )}
                {fullImage && (
                  <img
                    src={`data:image/webp;base64,${fullImage}`}
                    alt="Screenshot full view"
                    className="w-full h-auto max-h-[40vh] object-contain"
                  />
                )}
              </div>
            )}
          </div>
        ))}
        {hasMore && !showAll && (
          <button
            type="button"
            className="shrink-0 w-[100px] rounded border border-[var(--qp-border)] bg-[var(--qp-bg-panel)] hover:bg-[var(--qp-bg-elevated)] transition-colours text-[10px] text-[var(--qp-text-secondary)] font-medium flex items-center justify-center"
            onClick={() => setShowAll(true)}
            style={{ aspectRatio: "16/9" }}
          >
            +{screenshots.length - PREVIEW_SCREENSHOT_COUNT} more
          </button>
        )}
      </div>
      {hasMore && showAll && (
        <button
          type="button"
          className="mt-1 text-[10px] text-[var(--qp-text-tertiary)] hover:text-[var(--qp-text-secondary)] transition-colours"
          onClick={() => {
            setShowAll(false);
            setExpandedId(null);
            setFullImage(null);
          }}
        >
          Show fewer
        </button>
      )}
    </div>
  );
}

export function HistoryTimelineList({
  loading,
  timelineSessions,
  icons,
  iconThemeColors,
  detailsPopover,
  className = "",
  onToggleSessionDetails,
  screenshotsBySessionId,
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
          const sessionScreenshots = session.sourceIds.flatMap((id) => screenshotsBySessionId[id] || []);
          const hasScreenshots = sessionScreenshots.length > 0;

          return (
            <div
              key={session.id}
              className="flex items-start gap-3 p-3 border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-elevated)] rounded-[10px] hover:border-[var(--qp-border-strong)] hover:bg-[var(--qp-bg-panel)] transition-colors"
            >
              <div
                className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
                style={{ backgroundColor: accentColor }}
              />
              <div className="w-8 h-8 rounded-[8px] bg-[var(--qp-bg-panel)] border border-[var(--qp-border-subtle)] flex items-center justify-center flex-shrink-0 overflow-hidden p-1.5 mt-0.5">
                {icons[session.exeName] ? (
                  <img src={icons[session.exeName]} className="w-full h-full object-contain" alt="" />
                ) : (
                  <div className="text-[10px] font-semibold opacity-35 text-[var(--qp-text-secondary)]">{mapped.category[0].toUpperCase()}</div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="flex min-w-0 flex-1 items-end gap-1.5">
                    <div className="min-w-0 truncate text-sm font-semibold text-[var(--qp-text-primary)]">
                      {session.displayName}
                    </div>
                    <span className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)] px-1.5 text-[9px] font-semibold leading-none text-[var(--qp-text-tertiary)]">
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
                        className="qp-button-secondary inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] p-0 text-[var(--qp-text-tertiary)]"
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
                <div className="text-xs font-semibold text-[var(--qp-text-primary)] tabular-nums">{formatDuration(session.duration || 0)}</div>
                <div className="text-[10px] text-[var(--qp-text-tertiary)] mt-0.5 tabular-nums">
                  {formatTime(session.startTime)}
                  {session.endTime ? ` - ${formatTime(session.endTime)}` : ` ${UI_TEXT.history.untilNow}`}
                </div>
                {hasScreenshots && (
                  <SessionScreenshotThumbnails screenshots={sessionScreenshots} />
                )}
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
              className="flex items-center gap-3 p-3 border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-elevated)] rounded-[10px] hover:border-[var(--qp-border-strong)] hover:bg-[var(--qp-bg-panel)] transition-colors"
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
                    <span className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)] px-1.5 text-[9px] font-semibold leading-none text-[var(--qp-text-tertiary)]">
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
                      className="qp-button-secondary inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] p-0 text-[var(--qp-text-tertiary)]"
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
