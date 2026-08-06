import { useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { Pause, Play, SquareArrowOutUpRight } from "lucide-react";
import QuietIconAction from "../../shared/components/QuietIconAction";
import {
  isCursorInsideCurrentWidgetWindow,
  getCurrentCursorPhysicalPosition,
  isPrimaryMouseButtonDown,
  showMainWindow,
  startCurrentWidgetWindowDrag,
} from "../../platform/desktop/widgetRuntimeGateway";
import { toggleTrackingPaused } from "../../platform/runtime/trackingRuntimeGateway";
import type { TrackingStatusSnapshot, TrackingWindowSnapshot } from "../../shared/types/tracking";
import { useAppThemeMode } from "../hooks/useAppThemeMode.ts";
import { useWidgetObjectIcon } from "../hooks/useWidgetObjectIcon";
import { useWidgetTracking } from "./useWidgetTracking.ts";
import { useWidgetWindowState } from "./useWidgetWindowState";
import { buildWidgetViewModel, isWidgetSelfWindow } from "./widgetViewModel";
import { LocaleProvider, useLocaleText } from "../../shared/i18n/index.ts";

interface WidgetDisplaySnapshot {
  activeWindow: TrackingWindowSnapshot | null;
  trackingStatus: TrackingStatusSnapshot;
}

const COLLAPSED_DRAG_HOLD_MS = 120;
const DRAG_RELEASE_POLL_MS = 40;
const STALE_HOVER_ENTER_GUARD_MS = 80;

export default function WidgetShell() {
  const widgetTracking = useWidgetTracking();
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
    classificationReady,
    trackerHealth,
    trackingRuntimeProbeStatus,
  } = widgetTracking;

  useAppThemeMode(appSettings.themeMode, appSettings.colorSchemeLight, appSettings.colorSchemeDark);
  const [lastNonWidgetSnapshot, setLastNonWidgetSnapshot] = useState<WidgetDisplaySnapshot | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverRevealActive, setHoverRevealActive] = useState(false);
  const [suppressHoverReveal, setSuppressHoverReveal] = useState(false);

  useEffect(() => {
    if (isWidgetSelfWindow(activeWindow)) {
      return;
    }

    setLastNonWidgetSnapshot({
      activeWindow,
      trackingStatus,
    });
  }, [activeWindow, trackingStatus]);

  const displaySnapshot = isWidgetSelfWindow(activeWindow) && lastNonWidgetSnapshot
    ? lastNonWidgetSnapshot
    : {
      activeWindow,
      trackingStatus,
    };

  const viewModel = classificationReady
    ? buildWidgetViewModel(
      displaySnapshot.activeWindow,
      displaySnapshot.trackingStatus,
      appSettings,
      trackerHealth,
      trackingRuntimeProbeStatus,
      uiText,
    )
    : {
      statusTone: "idle" as const,
      statusLabel: uiText.widget.loadingStatus,
      appName: uiText.widget.loadingAppName,
      helperText: uiText.widget.loadingHelper,
      pauseActionLabel: uiText.widget.pauseTracking,
      showObjectSlot: false,
      objectIconKey: null,
    };

  const statusTitle = `${viewModel.statusLabel} | ${viewModel.appName}`;
  const objectIcon = useWidgetObjectIcon(viewModel.objectIconKey);
  const showObjectSlot = viewModel.showObjectSlot && Boolean(objectIcon);
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
      .catch((error) => {
        console.warn("check widget cursor position failed", error);
      });
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
    toggleExpanded,
  } = useWidgetWindowState(showObjectSlot, {
    onCollapsedDragSettled: finishPostDragSettle,
    onRuntimeCollapsed: suppressHoverRevealUntilPointerLeaves,
    onRuntimeShown: suppressHoverRevealUntilPointerLeaves,
  });
  const renderExpanded = expanded || collapsing;

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
        .catch((error) => {
          stopCollapsedDrag();
          console.warn("poll widget drag release failed", error);
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
    if (renderExpanded || event.button !== 0) {
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
          console.warn("start widget drag failed", error);
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
        <div
          className={`widget-pill-tray ${
            renderExpanded && showObjectSlot ? "widget-pill-tray-with-object" : "widget-pill-tray-actions-only"
          }`}
          aria-hidden={!expanded}
        >
          {renderExpanded && showObjectSlot ? (
            <div
              className="widget-pill-object-slot"
              aria-hidden={!expanded}
            >
              <div
                className="widget-pill-object"
                aria-label={objectSlotTitle}
                role="img"
              >
                <img src={objectIcon ?? ""} className="widget-pill-object-icon" alt="" />
              </div>
            </div>
          ) : null}

          <div className="widget-pill-actions">
            <QuietIconAction
              icon={appSettings.trackingPaused
                ? <Play size={15} strokeWidth={2} />
                : <Pause size={15} strokeWidth={2} />}
              title={viewModel.pauseActionLabel}
              ariaLabel={viewModel.pauseActionLabel}
              className="widget-pill-action"
              showTooltip={false}
              disabled={!expanded}
              onClick={() => {
                void toggleTrackingPaused().catch((error) => {
                  console.warn("toggle tracking paused failed", error);
                });
              }}
            />

            <QuietIconAction
              icon={<SquareArrowOutUpRight size={15} strokeWidth={1.8} />}
              title={uiText.accessibility.widget.openMainWindow}
              ariaLabel={uiText.accessibility.widget.openMainWindow}
              className="widget-pill-action"
              showTooltip={false}
              disabled={!expanded}
              onClick={() => {
                void showMainWindow().catch((error) => {
                  console.warn("show main window failed", error);
                });
              }}
            />
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
