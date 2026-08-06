import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { RefObject } from "react";
import { createPortal } from "react-dom";

import { formatDuration, formatTime } from "../services/historyFormatting.ts";

export type TimelineDetailTitle = {
  title: string;
  secondaryText?: string | null;
  startTime: number;
  endTime: number | null;
  duration?: number;
  isUntitled?: boolean;
};

export interface HistoryTimelineDetailsPopoverState {
  sessionId: number | string;
  titleSamples: TimelineDetailTitle[];
  left: number;
  top: number;
  anchorTop: number;
  anchorBottom: number;
  anchorCenterX: number;
  placement: "top" | "bottom";
}

interface HistoryTimelineDetailsPopoverProps {
  popover: HistoryTimelineDetailsPopoverState | null;
  popoverRef: RefObject<HTMLDivElement | null>;
}

export function resolveTimelineDetailsPopoverPosition(
  anchor: { top: number; bottom: number; centerX: number },
  itemCount: number,
  measuredHeight?: number,
) {
  const viewportPadding = 12;
  const popoverWidth = Math.min(426, window.innerWidth - viewportPadding * 2);
  const horizontalAnchorRatio = 1 / 3;
  const popoverWidthBeforeAnchor = popoverWidth * horizontalAnchorRatio;
  const popoverWidthAfterAnchor = popoverWidth - popoverWidthBeforeAnchor;
  const gap = 8;
  const estimatedHeight = Math.min(260, Math.max(48, 20 + itemCount * 40 + Math.max(0, itemCount - 1) * 6));
  const height = measuredHeight ?? estimatedHeight;
  const boundedHeight = Math.min(height, window.innerHeight - viewportPadding * 2);
  const spaceBelow = window.innerHeight - anchor.bottom - gap - viewportPadding;
  const spaceAbove = anchor.top - gap - viewportPadding;
  const placement: "top" | "bottom" = spaceBelow < height && spaceAbove > spaceBelow ? "top" : "bottom";
  const preferredTop = placement === "top" ? anchor.top - height - gap : anchor.bottom + gap;

  return {
    left: Math.min(
      Math.max(anchor.centerX, popoverWidthBeforeAnchor + viewportPadding),
      window.innerWidth - popoverWidthAfterAnchor - viewportPadding,
    ),
    top: Math.min(
      Math.max(preferredTop, viewportPadding),
      window.innerHeight - boundedHeight - viewportPadding,
    ),
    placement,
  };
}

function getTitleDetailDuration(sample: TimelineDetailTitle, nowMs: number) {
  if (typeof sample.duration === "number") {
    return Math.max(0, sample.duration);
  }

  const endTime = sample.endTime ?? nowMs;
  return Math.max(0, endTime - sample.startTime);
}

export default function HistoryTimelineDetailsPopover({
  popover,
  popoverRef,
}: HistoryTimelineDetailsPopoverProps) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const nowMs = Date.now();

  return createPortal(
    popover ? (
        <div
          ref={popoverRef}
          className={`history-activity-popover qp-motion-popover-enter history-activity-popover-${popover.placement}`}
          style={{
            left: popover.left,
            top: popover.top,
          }}
        >
          <div className="history-activity-popover-title">
            {UI_TEXT.history.titleDetails}
          </div>
          <div className="history-activity-popover-list">
            {popover.titleSamples.map((sample, index) => (
              <div
                key={`${popover.sessionId}-${index}-${sample.title}`}
                className="history-activity-popover-item"
              >
                <span className="history-activity-popover-item-copy">
                  <span className="qp-record-detail-title history-activity-popover-item-title">
                    {sample.isUntitled ? UI_TEXT.history.webTimelineUntitledPage : sample.title}
                  </span>
                  {sample.secondaryText ? (
                    <span className="history-activity-popover-item-secondary">
                      {sample.secondaryText}
                    </span>
                  ) : null}
                </span>
                <span className="history-activity-popover-item-time">
                  <span className="history-activity-popover-item-duration">
                    {formatDuration(getTitleDetailDuration(sample, nowMs))}
                  </span>
                  <span className="history-activity-popover-item-range">
                    {formatTime(sample.startTime, locale)}
                    {sample.endTime ? ` - ${formatTime(sample.endTime, locale)}` : ` ${UI_TEXT.history.untilNow}`}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null,
    document.body,
  );
}
