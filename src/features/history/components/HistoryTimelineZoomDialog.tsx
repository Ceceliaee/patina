import type { HTMLAttributes, ReactNode, RefObject } from "react";
import { X } from "lucide-react";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import QuietStepperSlider from "../../../shared/components/QuietStepperSlider.tsx";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import type {
  HistoryTimelineDisplayMode,
  HistoryTimelineViewModel,
} from "../services/historyTimelineViewModel.ts";
import HistoryHorizontalTimeline from "./HistoryHorizontalTimeline.tsx";
import HistoryTimelineLaneList from "./HistoryTimelineLaneList.tsx";

interface Props {
  open: boolean;
  onClose: () => void;
  zoomHours: number;
  onZoomHoursChange: (hours: number) => void;
  windowLabel: string;
  modeAction: ReactNode;
  interactionRef: RefObject<HTMLDivElement | null>;
  interactionProps: HTMLAttributes<HTMLDivElement>;
  interactionLabel: string;
  isDragging: boolean;
  viewModel: HistoryTimelineViewModel;
  mode: HistoryTimelineDisplayMode;
  sourceIcons: Record<string, string>;
  showEmptyMessage: boolean;
  emptyMessage: string;
}

export default function HistoryTimelineZoomDialog({
  open,
  onClose,
  zoomHours,
  onZoomHoursChange,
  windowLabel,
  modeAction,
  interactionRef,
  interactionProps,
  interactionLabel,
  isDragging,
  viewModel,
  mode,
  sourceIcons,
  showEmptyMessage,
  emptyMessage,
}: Props) {
  const displayedZoomHours = Number(zoomHours.toFixed(1));

  return (
    <QuietDialog
      open={open}
      title={UI_TEXT.history.timelineZoom}
      surfaceClassName="history-timeline-zoom-dialog-surface"
      onClose={onClose}
    >
      <button
        type="button"
        className="qp-dialog-close-button history-timeline-dialog-close"
        aria-label={UI_TEXT.common.close}
        onClick={onClose}
      >
        <X size={16} aria-hidden />
      </button>
      <div className="history-timeline-zoom-dialog-body">
        <div className="history-timeline-zoom-dialog-toolbar">
          <div className="history-timeline-zoom-scale-controls history-timeline-zoom-dialog-scale" role="group" aria-label={UI_TEXT.history.timelineZoom}>
            <QuietStepperSlider
              ariaLabel={UI_TEXT.history.timelineWindowHours}
              value={zoomHours}
              min={1}
              max={24}
              step={0.2}
              integerButtons
              displayValue={UI_TEXT.history.timelineHoursValue(displayedZoomHours)}
              decreaseAriaLabel={UI_TEXT.history.timelineDecreaseHours}
              increaseAriaLabel={UI_TEXT.history.timelineIncreaseHours}
              className="history-timeline-hour-slider"
              onChange={onZoomHoursChange}
            />
          </div>
          <div className="history-timeline-window-controls history-timeline-zoom-dialog-window">
            <span className="history-timeline-window-label">{windowLabel}</span>
          </div>
          <div className="history-timeline-zoom-dialog-mode">
            {modeAction}
          </div>
        </div>
        <div
          ref={interactionRef}
          className={`history-timeline-zoom-dialog-timeline ${isDragging ? "history-timeline-zoom-dialog-timeline-dragging" : ""}`.trim()}
          role="group"
          aria-label={interactionLabel}
          {...interactionProps}
        >
          <HistoryHorizontalTimeline
            viewModel={viewModel}
            mode={mode}
            title={null}
            variant="expanded"
            showHeader={false}
            showEmptyMessage={showEmptyMessage}
            emptyMessage={emptyMessage}
            interactionActive={isDragging}
          />
        </div>
        <HistoryTimelineLaneList
          title={mode === "category"
            ? UI_TEXT.history.timelineCategoryLanes
            : mode === "web"
              ? UI_TEXT.history.timelineWebLanes
              : UI_TEXT.history.timelineAppLanes}
          emptyMessage={emptyMessage}
          viewModel={viewModel}
          mode={mode}
          sourceIcons={sourceIcons}
          interactionActive={isDragging}
        />
      </div>
    </QuietDialog>
  );
}
