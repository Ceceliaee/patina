import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  panHistoryTimelineViewport,
  panHistoryTimelineViewportByPixels,
  zoomHistoryTimelineViewportAroundAnchor,
  type HistoryTimelineViewport,
} from "../services/historyTimelineViewModel.ts";

const DRAG_THRESHOLD_PX = 5;
const HORIZONTAL_WHEEL_DOMINANCE = 1.1;
const WHEEL_NOISE_THRESHOLD_PX = 0.5;
const WHEEL_ZOOM_STEP_MS = 0.2 * 60 * 60_000;
const WHEEL_LINE_HEIGHT_PX = 16;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

export type HistoryTimelineViewportChangeReason = "pan" | "zoom";

interface Params {
  selectedDate: Date;
  viewport: HistoryTimelineViewport;
  enabled: boolean;
  interactionRef: RefObject<HTMLDivElement | null>;
  onViewportChange: (
    viewport: HistoryTimelineViewport,
    reason: HistoryTimelineViewportChangeReason,
  ) => void;
}

interface PendingViewportChange {
  viewport: HistoryTimelineViewport;
  reason: HistoryTimelineViewportChangeReason;
}

interface DragSession {
  pointerId: number;
  startClientX: number;
  startViewport: HistoryTimelineViewport;
  trackWidthPx: number;
  element: HTMLDivElement;
  dragging: boolean;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function viewportsMatch(left: HistoryTimelineViewport, right: HistoryTimelineViewport) {
  return left.startMs === right.startMs
    && left.endMs === right.endMs
    && left.durationMs === right.durationMs;
}

export function normalizeHistoryTimelineWheelDelta(
  delta: number,
  deltaMode: number,
  pageSizePx: number,
) {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === DOM_DELTA_LINE) {
    return delta * WHEEL_LINE_HEIGHT_PX;
  }
  if (deltaMode === DOM_DELTA_PAGE) {
    return delta * Math.max(1, pageSizePx);
  }
  return delta;
}

export function getHistoryTimelineWheelZoomDurationMs(
  currentDurationMs: number,
  normalizedDeltaY: number,
) {
  if (!Number.isFinite(currentDurationMs) || !Number.isFinite(normalizedDeltaY)) {
    return currentDurationMs;
  }
  if (Math.abs(normalizedDeltaY) < WHEEL_NOISE_THRESHOLD_PX) {
    return currentDurationMs;
  }
  return currentDurationMs + Math.sign(normalizedDeltaY) * WHEEL_ZOOM_STEP_MS;
}

export function useHistoryTimelineViewportInteraction({
  selectedDate,
  viewport,
  enabled,
  interactionRef,
  onViewportChange,
}: Params) {
  const [isDragging, setIsDragging] = useState(false);
  const viewportRef = useRef(viewport);
  const onViewportChangeRef = useRef(onViewportChange);
  const pendingChangeRef = useRef<PendingViewportChange | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  const flushPendingChange = useCallback(() => {
    animationFrameRef.current = null;
    const pendingChange = pendingChangeRef.current;
    pendingChangeRef.current = null;
    if (pendingChange) {
      onViewportChangeRef.current(pendingChange.viewport, pendingChange.reason);
    }
  }, []);

  const scheduleViewportChange = useCallback((
    nextViewport: HistoryTimelineViewport,
    reason: HistoryTimelineViewportChangeReason,
  ) => {
    if (viewportsMatch(nextViewport, viewportRef.current)) return false;

    viewportRef.current = nextViewport;
    pendingChangeRef.current = { viewport: nextViewport, reason };
    if (animationFrameRef.current === null) {
      animationFrameRef.current = window.requestAnimationFrame(flushPendingChange);
    }
    return true;
  }, [flushPendingChange]);

  const finishDragSession = useCallback(() => {
    const session = dragSessionRef.current;
    if (!session) return;

    dragSessionRef.current = null;
    if (session.element.hasPointerCapture(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId);
    }
    setIsDragging(false);
  }, []);

  const cancelInteraction = useCallback(() => {
    finishDragSession();
    pendingChangeRef.current = null;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, [finishDragSession]);

  useEffect(() => {
    if (!enabled) {
      cancelInteraction();
      return undefined;
    }

    window.addEventListener("blur", cancelInteraction);
    return () => window.removeEventListener("blur", cancelInteraction);
  }, [cancelInteraction, enabled]);

  useEffect(() => cancelInteraction, [cancelInteraction]);

  useEffect(() => {
    if (enabled) {
      cancelInteraction();
    }
  }, [cancelInteraction, enabled, selectedDate]);

  const handleWheel = useCallback((event: WheelEvent) => {
    if (!enabled) return;

    const interactionElement = interactionRef.current;
    if (!interactionElement) return;
    const rect = interactionElement.getBoundingClientRect();
    if (rect.width <= 0) return;

    const normalizedDeltaX = normalizeHistoryTimelineWheelDelta(event.deltaX, event.deltaMode, rect.width);
    const normalizedDeltaY = normalizeHistoryTimelineWheelDelta(event.deltaY, event.deltaMode, rect.height);
    const isShiftPan = event.shiftKey && Math.abs(normalizedDeltaY) >= WHEEL_NOISE_THRESHOLD_PX;
    const isHorizontalPan = Math.abs(normalizedDeltaX)
      > Math.abs(normalizedDeltaY) * HORIZONTAL_WHEEL_DOMINANCE;

    if (isShiftPan || isHorizontalPan) {
      const panDeltaPx = isShiftPan ? normalizedDeltaY : normalizedDeltaX;
      if (Math.abs(panDeltaPx) < WHEEL_NOISE_THRESHOLD_PX) return;
      const currentViewport = viewportRef.current;
      const nextViewport = panHistoryTimelineViewport({
        selectedDate,
        viewport: currentViewport,
        deltaMs: (panDeltaPx / rect.width) * currentViewport.durationMs,
      });
      if (scheduleViewportChange(nextViewport, "pan")) {
        event.preventDefault();
      }
      return;
    }

    if (Math.abs(normalizedDeltaY) < WHEEL_NOISE_THRESHOLD_PX) return;
    const currentViewport = viewportRef.current;
    const anchorRatio = clampNumber((event.clientX - rect.left) / rect.width, 0, 1);
    const nextDurationMs = getHistoryTimelineWheelZoomDurationMs(
      currentViewport.durationMs,
      normalizedDeltaY,
    );
    const nextViewport = zoomHistoryTimelineViewportAroundAnchor({
      selectedDate,
      viewport: currentViewport,
      anchorRatio,
      requestedDurationMs: nextDurationMs,
    });
    if (scheduleViewportChange(nextViewport, "zoom")) {
      event.preventDefault();
    }
  }, [enabled, interactionRef, scheduleViewportChange, selectedDate]);

  useEffect(() => {
    if (!enabled) return undefined;
    const interactionElement = interactionRef.current;
    if (!interactionElement) return undefined;

    interactionElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => interactionElement.removeEventListener("wheel", handleWheel);
  }, [enabled, handleWheel, interactionRef]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || !event.isPrimary || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragSessionRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startViewport: viewportRef.current,
      trackWidthPx: rect.width,
      element: event.currentTarget,
      dragging: false,
    };
  }, [enabled]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    const deltaPx = event.clientX - session.startClientX;
    if (!session.dragging) {
      if (Math.abs(deltaPx) < DRAG_THRESHOLD_PX) return;
      session.dragging = true;
      setIsDragging(true);
    }

    event.preventDefault();
    const nextViewport = panHistoryTimelineViewportByPixels({
      selectedDate,
      viewport: session.startViewport,
      deltaPx,
      trackWidthPx: session.trackWidthPx,
    });
    scheduleViewportChange(nextViewport, "pan");
  }, [scheduleViewportChange, selectedDate]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    finishDragSession();
  }, [finishDragSession]);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    cancelInteraction();
  }, [cancelInteraction]);

  const handleLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) return;
    cancelInteraction();
  }, [cancelInteraction]);

  return {
    isDragging,
    cancelInteraction,
    interactionProps: {
      onPointerDownCapture: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onLostPointerCapture: handleLostPointerCapture,
    },
  };
}
