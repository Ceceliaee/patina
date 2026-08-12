import { useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import {
  Clock3,
  Pin,
  SquareArrowOutUpRight,
  Timer,
} from "lucide-react";
import {
  isCursorInsideCurrentWidgetWindow,
  getCurrentCursorPhysicalPosition,
  isPrimaryMouseButtonDown,
  showMainWindow,
  startCurrentWidgetWindowDrag,
  type WidgetStatusSnapshot,
} from "../../platform/desktop/widgetRuntimeGateway";
import type { TrackingStatusSnapshot, TrackingWindowSnapshot } from "../../shared/types/tracking";
import { useAppThemeMode } from "../hooks/useAppThemeMode.ts";
import { useWidgetObjectIcon } from "../hooks/useWidgetObjectIcon";
import { useWidgetTracking } from "./useWidgetTracking.ts";
import { useWidgetWindowState } from "./useWidgetWindowState";
import { buildWidgetViewModel, isWidgetSelfWindow } from "./widgetViewModel";
import { buildWidgetStatusViewModel } from "./widgetStatusViewModel.ts";
import { LocaleProvider, useLocaleText } from "../../shared/i18n/index.ts";

interface WidgetDisplaySnapshot {
  activeWindow: TrackingWindowSnapshot | null;
  trackingStatus: TrackingStatusSnapshot;
  widgetStatus: WidgetStatusSnapshot | null;
}

const COLLAPSED_DRAG_HOLD_MS = 120;
const DRAG_RELEASE_POLL_MS = 40;
const STALE_HOVER_ENTER_GUARD_MS = 80;

export default function WidgetShell() {
  const widgetTracking = useWidgetTracking();
  if (!widgetTracking.classificationReady) return null;
  return (
    <LocaleProvider locale={widgetTracking.appSettings.language}>
      <LocalizedWidgetShell widgetTracking={widgetTracking} />
    </LocaleProvider>
  );
}

function LocalizedWidgetShell({
  widgetTracking,
}: {
  widgetTracking: ReturnType<typeof useWidgetTracking>;
}) {
  const uiText = useLocaleText();
  const {
    activeWindow,
    trackingStatus,
    appSettings,
    trackerHealth,
    trackingRuntimeProbeStatus,
    pinned: initialPinned,
    widgetStatus,
  } = widgetTracking;

  useAppThemeMode(appSettings.themeMode, appSettings.colorSchemeLight, appSettings.colorSchemeDark);
  const [lastNonWidgetSnapshot, setLastNonWidgetSnapshot] = useState<WidgetDisplaySnapshot | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverRevealActive, setHoverRevealActive] = useState(false);
  const [suppressHoverReveal, setSuppressHoverReveal] = useState(false);
  const [statusElapsedMs, setStatusElapsedMs] = useState(0);
  const statusClockBaseRef = useRef(performance.now());

  useEffect(() => {
    if (isWidgetSelfWindow(activeWindow)) {
      return;
    }

    setLastNonWidgetSnapshot({
      activeWindow,
      trackingStatus,
      widgetStatus,
    });
  }, [activeWindow, trackingStatus, widgetStatus]);

  const displaySnapshot = isWidgetSelfWindow(activeWindow) && lastNonWidgetSnapshot
    ? lastNonWidgetSnapshot
    : {
      activeWindow,
      trackingStatus,
      widgetStatus,
    };

  const viewModel = buildWidgetViewModel(
    displaySnapshot.activeWindow,
    displaySnapshot.trackingStatus,
    appSettings,
    trackerHealth,
    trackingRuntimeProbeStatus,
    uiText,
  );

  const statusTitle = `${viewModel.statusLabel} | ${viewModel.appName}`;
  const displayWidgetStatus = displaySnapshot.widgetStatus;
  useEffect(() => {
    statusClockBaseRef.current = performance.now();
    setStatusElapsedMs(0);
  }, [displayWidgetStatus]);
  const statusViewModel = buildWidgetStatusViewModel(displayWidgetStatus, statusElapsedMs);
  const trackingIconKey = displayWidgetStatus?.tracking?.exeName ?? viewModel.objectIconKey;
  const objectIcon = useWidgetObjectIcon(trackingIconKey);
  const toolSlotCount = statusViewModel.tools.length;
  const objectSlotTitle = uiText.accessibility.widget.currentApp(viewModel.appName);
  const dragHoldTimerRef = useRef<number | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragReleasePollRef = useRef<number | null>(null);
  const dragHoverSuppressStartedAtRef = useRef(0);
  const hoverSuppressionTokenRef = useRef(0);
  const dragActiveRef = useRef(false);
  const anchorButtonRef = useRef<HTMLButtonElement | null>(null);
  const suppressNextToggleRef = useRef(false);

  const clearHoverRevealLock = () => {
    hoverSuppressionTokenRef.current += 1;
    setSuppressHoverReveal(false);
  };

  const suppressHoverRevealUntilPointerLeaves = () => {
    const token = hoverSuppressionTokenRef.current + 1;
    hoverSuppressionTokenRef.current = token;
    dragHoverSuppressStartedAtRef.current = Date.now();
    anchorButtonRef.current?.blur();
    setHoverRevealActive(false);
    setSuppressHoverReveal(true);

    void isCursorInsideCurrentWidgetWindow()
      .then((cursorInsideWidget) => {
        if (hoverSuppressionTokenRef.current === token && !cursorInsideWidget) {
          setSuppressHoverReveal(false);
        }
      })
      .catch(() => undefined);
  };

  const finishPostDragSettle = () => {
    suppressHoverRevealUntilPointerLeaves();
  };

  const clearPostDragHoverLock = () => {
    clearHoverRevealLock();
  };

  const {
    beginUserDrag,
    collapsing,
    endUserDrag,
    expanded,
    placement,
    pinned,
    pinSaveFailed,
    toggleExpanded,
    togglePinned,
  } = useWidgetWindowState(initialPinned, toolSlotCount, {
    onCollapsedDragSettled: finishPostDragSettle,
    onRuntimeCollapsed: suppressHoverRevealUntilPointerLeaves,
    onRuntimeShown: suppressHoverRevealUntilPointerLeaves,
  });
  const renderExpanded = expanded || collapsing;

  useEffect(() => {
    if (!expanded) return undefined;
    const updateClock = () => {
      setStatusElapsedMs(Math.max(0, performance.now() - statusClockBaseRef.current));
    };
    updateClock();
    const interval = window.setInterval(updateClock, 1_000);
    return () => window.clearInterval(interval);
  }, [expanded]);

  const clearDragHoldTimer = () => {
    if (dragHoldTimerRef.current !== null) {
      window.clearTimeout(dragHoldTimerRef.current);
      dragHoldTimerRef.current = null;
    }
  };

  const clearDragReleasePoll = () => {
    if (dragReleasePollRef.current !== null) {
      window.clearTimeout(dragReleasePollRef.current);
      dragReleasePollRef.current = null;
    }
  };

  const releaseCollapsedDragPointerCapture = () => {
    const pointerId = dragPointerIdRef.current;
    const anchorButton = anchorButtonRef.current;
    dragPointerIdRef.current = null;

    if (pointerId !== null && anchorButton?.hasPointerCapture(pointerId)) {
      anchorButton.releasePointerCapture(pointerId);
    }
  };

  const stopCollapsedDrag = () => {
    clearDragReleasePoll();
    releaseCollapsedDragPointerCapture();
    setDragging(false);
    if (!dragActiveRef.current) {
      return;
    }

    dragActiveRef.current = false;
    suppressHoverRevealUntilPointerLeaves();
    endUserDrag(getCurrentCursorPhysicalPosition());
  };

  const pollCollapsedDragRelease = () => {
    clearDragReleasePoll();
    dragReleasePollRef.current = window.setTimeout(() => {
      dragReleasePollRef.current = null;
      void isPrimaryMouseButtonDown()
        .then((isDown) => {
          if (!isDown) {
            stopCollapsedDrag();
            return;
          }

          pollCollapsedDragRelease();
        })
        .catch(() => {
          stopCollapsedDrag();
        });
    }, DRAG_RELEASE_POLL_MS);
  };

  useEffect(() => () => {
    clearDragHoldTimer();
    clearDragReleasePoll();
  }, []);

  const clearHoverRevealSuppression = () => {
    setHoverRevealActive(false);
    if (!dragging) {
      clearHoverRevealLock();
    }
  };

  const canUnlockSuppressedHover = () => suppressHoverReveal
    && !dragging
    && Date.now() - dragHoverSuppressStartedAtRef.current > STALE_HOVER_ENTER_GUARD_MS;

  const revealHoverIfAllowed = () => {
    if (dragging || renderExpanded) {
      return;
    }

    if (suppressHoverReveal) {
      if (!canUnlockSuppressedHover()) {
        return;
      }

      clearHoverRevealLock();
    }

    setHoverRevealActive(true);
  };

  const handleCollapsedDragPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    dragPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    clearDragHoldTimer();
    dragHoldTimerRef.current = window.setTimeout(() => {
      dragHoldTimerRef.current = null;
      suppressNextToggleRef.current = true;
      dragActiveRef.current = true;
      clearPostDragHoverLock();
      setDragging(true);
      beginUserDrag();
      pollCollapsedDragRelease();
      void startCurrentWidgetWindowDrag()
        .catch((error) => {
          suppressNextToggleRef.current = false;
          stopCollapsedDrag();
              console.warn("widget:drag-start", error);
        });
    }, COLLAPSED_DRAG_HOLD_MS);
  };

  const handleCollapsedDragPointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    clearDragHoldTimer();
    if (dragPointerIdRef.current === event.pointerId) {
      releaseCollapsedDragPointerCapture();
    }

    stopCollapsedDrag();
    if (suppressNextToggleRef.current) {
      window.setTimeout(() => {
        suppressNextToggleRef.current = false;
      }, 0);
    }
  };

  const handleAnchorClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppressNextToggleRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextToggleRef.current = false;
      return;
    }

    toggleExpanded();
    clearPostDragHoverLock();
  };

  return (
    <div
      className={`widget-shell widget-shell-${placement.side} ${
        renderExpanded ? "widget-shell-expanded" : "widget-shell-collapsed"
      } ${collapsing ? "widget-shell-collapsing" : ""} ${
        suppressHoverReveal ? "widget-shell-hover-suppressed" : ""
      } ${hoverRevealActive ? "widget-shell-hover-revealed" : ""} ${
        dragging ? "widget-shell-dragging" : ""
      }`}
      onPointerEnter={revealHoverIfAllowed}
      onPointerMove={revealHoverIfAllowed}
      onPointerLeave={clearHoverRevealSuppression}
    >
      <div className={`widget-pill-shell qp-panel widget-pill-shell-${viewModel.statusTone}`}>
        <span className="sr-only" role="status" aria-live="polite">
          {pinSaveFailed ? uiText.settings.saveFailed : ""}
        </span>
        <div
          className="widget-pill-tray"
          aria-hidden={!expanded}
        >
          <div className="widget-pill-tool-slots" aria-hidden={!expanded}>
            {statusViewModel.tools.map((tool) => {
              const label = tool.kind === "pomodoro"
                ? uiText.tools.pomodoroTitle
                : uiText.tools.timerTitle;
              const value = tool.state === "completed"
                ? uiText.tools.timerStatus.completed
                : tool.timeText;
              return (
                <div
                  key={tool.kind}
                  className={`widget-pill-tool-slot widget-pill-tool-slot-${tool.state}`}
                  aria-label={`${label} ${value}`}
                >
                  {tool.kind === "pomodoro"
                    ? <Clock3 size={14} strokeWidth={1.8} aria-hidden />
                    : <Timer size={14} strokeWidth={1.8} aria-hidden />}
                  <span className="widget-pill-time">
                    {value}
                  </span>
                </div>
              );
            })}
          </div>

          {toolSlotCount > 0 ? <span className="widget-pill-separator" aria-hidden /> : null}

          <div className="widget-pill-tracking-core" aria-label={`${objectSlotTitle} ${statusViewModel.trackingTimeText}`}>
            <div className="widget-pill-object" aria-hidden>
              {objectIcon ? (
                <img src={objectIcon} className="widget-pill-object-icon" alt="" />
              ) : (
                <span className="widget-pill-object-fallback" />
              )}
            </div>
            <span className="widget-pill-time widget-pill-tracking-time">
              {statusViewModel.trackingTimeText}
            </span>
          </div>

          <div className="widget-pill-actions">
            <button
              type="button"
              aria-label={uiText.accessibility.widget.openMainWindow}
              className="qp-icon-action qp-icon-action-neutral widget-pill-action"
              disabled={!expanded}
              onClick={() => {
                void showMainWindow().catch((error) => {
                  console.warn("widget:open", error);
                });
              }}
            >
              <SquareArrowOutUpRight size={15} strokeWidth={1.8} />
            </button>

            <button
              type="button"
              aria-label={uiText.accessibility.widget.pin}
              aria-pressed={pinned}
              className="qp-icon-action qp-icon-action-neutral widget-pill-action widget-pill-pin-action"
              disabled={!expanded}
              onClick={() => {
                void togglePinned();
              }}
            >
              <Pin
                className={`widget-pin-icon ${pinned ? "widget-pin-icon-filled" : ""}`}
                size={15}
                strokeWidth={1.8}
                aria-hidden
              />
            </button>
          </div>
        </div>

        <button
          ref={anchorButtonRef}
          type="button"
          className={`widget-pill-anchor widget-pill-anchor-${viewModel.statusTone} ${
            renderExpanded ? "widget-pill-anchor-expanded" : "widget-pill-anchor-collapsed"
          }`}
          aria-label={uiText.accessibility.widget.toggle(expanded, statusTitle)}
          aria-expanded={expanded}
          onPointerDown={handleCollapsedDragPointerDown}
          onPointerUp={handleCollapsedDragPointerEnd}
          onPointerCancel={handleCollapsedDragPointerEnd}
          onClick={handleAnchorClick}
        >
          <span className={`widget-status-lamp widget-status-lamp-${viewModel.statusTone}`} />
        </button>
      </div>
    </div>
  );
}
