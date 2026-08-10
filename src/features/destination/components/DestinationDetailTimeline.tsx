import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, } from "react";
import QuietStepperSlider from "../../../shared/components/QuietStepperSlider.tsx";
import {
  QuietTimelineSegment, QuietTimelineTrack, } from "../../../shared/components/QuietTimelineTrack.tsx";
import { formatDuration } from "../../../shared/lib/durationFormatting.ts";
import type {
  DestinationDetailDayViewModel,
} from "../services/destinationDetailReadModel.ts";
import { formatDestinationTime as formatTime } from "../services/destinationTimeFormatting.ts";
import {
  buildDestinationDetailTimelineAxisTicks,
  buildDestinationDetailTimelineSegments,
  getDestinationDetailTimelineWheelZoomHours,
  panDestinationDetailTimelineViewport,
  panDestinationDetailTimelineViewportByPixels,
  resizeDestinationDetailTimelineViewport,
  zoomDestinationDetailTimelineViewportAroundAnchor,
  type DestinationDetailTimelineViewport,
} from "../services/destinationDetailTimelineViewport.ts";

interface Props {
  objectName: string;
  color: string;
  day: DestinationDetailDayViewModel;
  viewport: DestinationDetailTimelineViewport;
  minimumDurationMs: number;
  toolbarAside: ReactNode;
  onViewportChange: (viewport: DestinationDetailTimelineViewport) => void;
  onZoomHoursChange: (zoomHours: number) => void;
}

interface DragSession {
  pointerId: number;
  startClientX: number;
  startViewport: DestinationDetailTimelineViewport;
  trackWidthPx: number;
  element: HTMLDivElement;
  dragging: boolean;
}

type TooltipContentStyle = CSSProperties & Record<"--tooltip-color", string>;

const DRAG_THRESHOLD_PX = 5;
const HORIZONTAL_WHEEL_DOMINANCE = 1.1;
const WHEEL_NOISE_THRESHOLD_PX = 0.5;
const WHEEL_LINE_HEIGHT_PX = 16;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

function clampRatio(value: number) {
  return Math.min(1, Math.max(0, value));
}

function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  pageSizePx: number,
) {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === DOM_DELTA_LINE) return delta * WHEEL_LINE_HEIGHT_PX;
  if (deltaMode === DOM_DELTA_PAGE) return delta * Math.max(1, pageSizePx);
  return delta;
}

function viewportsMatch(
  left: DestinationDetailTimelineViewport,
  right: DestinationDetailTimelineViewport,
) {
  return left.startMs === right.startMs
    && left.endMs === right.endMs
    && left.durationMs === right.durationMs;
}

export default function DestinationDetailTimeline({
  objectName,
  color,
  day,
  viewport,
  minimumDurationMs,
  toolbarAside,
  onViewportChange,
  onZoomHoursChange,
}: Props) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const copy = UI_TEXT.destinationDetail;
  const [isDragging, setIsDragging] = useState(false);
  const interactionRef = useRef<HTMLDivElement | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const viewportRef = useRef(viewport);
  const onViewportChangeRef = useRef(onViewportChange);
  const onZoomHoursChangeRef = useRef(onZoomHoursChange);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);
  useEffect(() => {
    onZoomHoursChangeRef.current = onZoomHoursChange;
  }, [onZoomHoursChange]);
  const axisTicks = buildDestinationDetailTimelineAxisTicks(
    viewport,
    day.dayStartMs,
    day.dayEndMs,
  );
  const segments = buildDestinationDetailTimelineSegments(
    day.activities,
    viewport,
    minimumDurationMs,
  );
  const zoomHours = viewport.durationMs / 3_600_000;
  const displayedZoomHours = Number(zoomHours.toFixed(1));
  const windowLabel = `${formatTime(viewport.startMs, day.dayEndMs, locale)}–${formatTime(
    viewport.endMs,
    day.dayEndMs,
    locale,
  )}`;

  const finishDrag = (pointerId: number) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== pointerId) return;
    dragSessionRef.current = null;
    if (session.element.hasPointerCapture(pointerId)) {
      session.element.releasePointerCapture(pointerId);
    }
    setIsDragging(false);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragSessionRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startViewport: viewport,
      trackWidthPx: rect.width,
      element: event.currentTarget,
      dragging: false,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const deltaPx = event.clientX - session.startClientX;
    if (!session.dragging) {
      if (Math.abs(deltaPx) < DRAG_THRESHOLD_PX) return;
      session.dragging = true;
      setIsDragging(true);
    }
    event.preventDefault();
    onViewportChange(panDestinationDetailTimelineViewportByPixels({
      dayStartMs: day.dayStartMs,
      dayEndMs: day.dayEndMs,
      viewport: session.startViewport,
      deltaPx,
      trackWidthPx: session.trackWidthPx,
    }));
  };

  const handleWheel = useCallback((event: WheelEvent) => {
    const interactionElement = interactionRef.current;
    if (!interactionElement) return;
    const rect = interactionElement.getBoundingClientRect();
    if (rect.width <= 0) return;
    const normalizedDeltaX = normalizeWheelDelta(
      event.deltaX,
      event.deltaMode,
      rect.width,
    );
    const normalizedDeltaY = normalizeWheelDelta(
      event.deltaY,
      event.deltaMode,
      rect.height,
    );
    const isShiftPan = event.shiftKey
      && Math.abs(normalizedDeltaY) >= WHEEL_NOISE_THRESHOLD_PX;
    const isHorizontalPan = Math.abs(normalizedDeltaX)
      > Math.abs(normalizedDeltaY) * HORIZONTAL_WHEEL_DOMINANCE;
    const currentViewport = viewportRef.current;

    if (isShiftPan || isHorizontalPan) {
      const panDeltaPx = isShiftPan ? normalizedDeltaY : normalizedDeltaX;
      if (Math.abs(panDeltaPx) < WHEEL_NOISE_THRESHOLD_PX) return;
      const nextViewport = panDestinationDetailTimelineViewport({
        dayStartMs: day.dayStartMs,
        dayEndMs: day.dayEndMs,
        viewport: currentViewport,
        deltaMs: (panDeltaPx / rect.width) * currentViewport.durationMs,
      });
      if (viewportsMatch(nextViewport, currentViewport)) return;
      event.preventDefault();
      viewportRef.current = nextViewport;
      onViewportChangeRef.current(nextViewport);
      return;
    }

    const currentZoomHours = currentViewport.durationMs / 3_600_000;
    const nextZoomHours = getDestinationDetailTimelineWheelZoomHours(
      currentZoomHours,
      normalizedDeltaY,
    );
    const nextViewport = zoomDestinationDetailTimelineViewportAroundAnchor({
      dayStartMs: day.dayStartMs,
      dayEndMs: day.dayEndMs,
      viewport: currentViewport,
      anchorRatio: clampRatio((event.clientX - rect.left) / rect.width),
      requestedZoomHours: nextZoomHours,
    });
    if (viewportsMatch(nextViewport, currentViewport)) return;
    event.preventDefault();
    viewportRef.current = nextViewport;
    onZoomHoursChangeRef.current(nextZoomHours);
    onViewportChangeRef.current(nextViewport);
  }, [day.dayEndMs, day.dayStartMs]);

  useEffect(() => {
    const interactionElement = interactionRef.current;
    if (!interactionElement) return undefined;
    interactionElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => interactionElement.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const panStepMs = viewport.durationMs / 10;
    let nextViewport: DestinationDetailTimelineViewport | null = null;
    if (event.key === "ArrowLeft") {
      nextViewport = panDestinationDetailTimelineViewport({
        dayStartMs: day.dayStartMs,
        dayEndMs: day.dayEndMs,
        viewport,
        deltaMs: -panStepMs,
      });
    } else if (event.key === "ArrowRight") {
      nextViewport = panDestinationDetailTimelineViewport({
        dayStartMs: day.dayStartMs,
        dayEndMs: day.dayEndMs,
        viewport,
        deltaMs: panStepMs,
      });
    } else if (event.key === "Home") {
      nextViewport = panDestinationDetailTimelineViewport({
        dayStartMs: day.dayStartMs,
        dayEndMs: day.dayEndMs,
        viewport,
        deltaMs: day.dayStartMs - viewport.startMs,
      });
    } else if (event.key === "End") {
      nextViewport = panDestinationDetailTimelineViewport({
        dayStartMs: day.dayStartMs,
        dayEndMs: day.dayEndMs,
        viewport,
        deltaMs: day.dayEndMs - viewport.endMs,
      });
    }
    if (!nextViewport) return;
    event.preventDefault();
    onViewportChange(nextViewport);
  };

  return (
    <div
      className="destination-detail-timeline"
      data-destination-detail-timeline-start-ms={viewport.startMs}
      data-destination-detail-timeline-end-ms={viewport.endMs}
      data-destination-detail-timeline-zoom-hours={displayedZoomHours}
    >
      <div className="destination-detail-timeline-toolbar">
        <div
          className="destination-detail-timeline-scale"
          role="group"
          aria-label={copy.timelineZoom}
        >
          <QuietStepperSlider
            ariaLabel={copy.timelineWindowHours}
            value={zoomHours}
            min={1}
            max={24}
            step={0.2}
            integerButtons
            displayValue={copy.timelineHoursValue(displayedZoomHours)}
            decreaseAriaLabel={copy.timelineDecreaseHours}
            increaseAriaLabel={copy.timelineIncreaseHours}
            className="destination-detail-timeline-slider"
            onChange={(nextZoomHours) => {
              onZoomHoursChange(nextZoomHours);
              onViewportChange(resizeDestinationDetailTimelineViewport({
                dayStartMs: day.dayStartMs,
                dayEndMs: day.dayEndMs,
                viewport,
                requestedZoomHours: nextZoomHours,
              }));
            }}
          />
        </div>
        <span className="destination-detail-timeline-window">
          {windowLabel}
        </span>
        <div className="destination-detail-timeline-date">
          {toolbarAside}
        </div>
      </div>
      <div
        ref={interactionRef}
        className={`destination-detail-timeline-interaction ${
          isDragging ? "destination-detail-timeline-interaction-dragging" : ""
        }`}
        aria-label={copy.timelineInteractionAria(objectName, day.dateKey, windowLabel)}
        role="group"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishDrag(event.pointerId)}
        onPointerCancel={(event) => finishDrag(event.pointerId)}
        onLostPointerCapture={(event) => finishDrag(event.pointerId)}
        onKeyDown={handleKeyDown}
      >
        <QuietTimelineTrack
          axisTicks={axisTicks}
          trackClassName="destination-detail-timeline-track"
          axisClassName="destination-detail-timeline-axis"
        >
          {segments.map((segment) => {
            const start = formatTime(segment.startTime, day.dayEndMs, locale);
            const end = formatTime(segment.endTime, day.dayEndMs, locale);
            const ariaLabel = copy.recordAria(
              start,
              end,
              objectName,
              formatDuration(segment.duration),
            );
            const tooltipContentStyle: TooltipContentStyle = {
              "--tooltip-color": color,
            };
            return (
              <QuietTimelineSegment
                key={segment.id}
                ariaLabel={ariaLabel}
                color={color}
                leftRatio={segment.startRatio}
                widthRatio={segment.endRatio - segment.startRatio}
                tooltip={(
                  <div
                    className="destination-detail-timeline-tooltip-content"
                    style={tooltipContentStyle}
                  >
                    <div className="destination-detail-timeline-tooltip-title">
                      <span
                        className="destination-detail-timeline-tooltip-dot"
                        aria-hidden="true"
                      />
                      <span className="destination-detail-timeline-tooltip-label">
                        {objectName}
                      </span>
                    </div>
                    <div className="destination-detail-timeline-tooltip-time">
                      {start}
                      {" - "}
                      {end}
                      <span aria-hidden="true"> · </span>
                      {formatDuration(segment.duration)}
                    </div>
                  </div>
                )}
                disabled={isDragging}
                hideOnPointerDown
                className="destination-detail-timeline-segment"
                tooltipClassName="destination-detail-timeline-tooltip"
              />
            );
          })}
        </QuietTimelineTrack>
      </div>
    </div>
  );
}
