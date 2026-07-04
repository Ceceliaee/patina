import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import { formatTime } from "../services/historyFormatting.ts";

export type TimelineDetailTitle = {
  title: string;
  startTime: number;
  endTime: number | null;
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

export default function HistoryTimelineDetailsPopover({
  popover,
  popoverRef,
}: HistoryTimelineDetailsPopoverProps) {
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
                <span className="history-activity-popover-item-title">
                  {sample.title}
                </span>
                <span className="history-activity-popover-item-time">
                  {formatTime(sample.startTime)}
                  {sample.endTime ? ` - ${formatTime(sample.endTime)}` : ` ${UI_TEXT.history.untilNow}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null,
    document.body,
  );
}
