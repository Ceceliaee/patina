import { useEffect, useMemo, useRef, useState } from "react";
import {
  finalizeWidgetDrag,
  getWidgetPlacement,
  onCurrentWidgetWindowFocusChanged,
  onCurrentWidgetWindowMoved,
  onCurrentWidgetWindowScaleChanged,
  onWidgetRuntimeCollapsed,
  onWidgetRuntimeShown,
  setCurrentWidgetWindowFocusable,
  setWidgetExpanded,
  setWidgetPinned,
  type WidgetPlacement,
} from "../../platform/desktop/widgetRuntimeGateway";
import {
  COLLAPSE_ANIMATION_MS,
  clampWidgetAnchorY,
  createWidgetWindowController,
  DEFAULT_WIDGET_PLACEMENT,
} from "./widgetWindowController.ts";

interface WidgetWindowStateOptions {
  onCollapsedDragSettled?: () => void;
  onRuntimeCollapsed?: () => void;
  onRuntimeShown?: () => void;
}

export function useWidgetWindowState(
  initialPinned: boolean,
  toolSlotCount: number,
  options: WidgetWindowStateOptions = {},
) {
  const [placement, setPlacementState] = useState<WidgetPlacement>(DEFAULT_WIDGET_PLACEMENT);
  const [expanded, setExpandedState] = useState(initialPinned);
  const [pinned, setPinnedState] = useState(initialPinned);
  const [pinSaveFailed, setPinSaveFailed] = useState(false);
  const pinnedRef = useRef(initialPinned);
  const desiredPinnedRef = useRef(initialPinned);
  const toolSlotCountRef = useRef(toolSlotCount);
  const pinMutationRef = useRef<Promise<boolean> | null>(null);
  const [collapsing, setCollapsing] = useState(false);
  const collapseVisualTimerRef = useRef<number | null>(null);
  const onCollapsedDragSettledRef = useRef(options.onCollapsedDragSettled);
  const onRuntimeCollapsedRef = useRef(options.onRuntimeCollapsed);
  const onRuntimeShownRef = useRef(options.onRuntimeShown);
  const clearCollapseVisualTimer = () => {
    if (collapseVisualTimerRef.current !== null) {
      window.clearTimeout(collapseVisualTimerRef.current);
      collapseVisualTimerRef.current = null;
    }
  };

  useEffect(() => {
    onCollapsedDragSettledRef.current = options.onCollapsedDragSettled;
    onRuntimeCollapsedRef.current = options.onRuntimeCollapsed;
    onRuntimeShownRef.current = options.onRuntimeShown;
  }, [options.onCollapsedDragSettled, options.onRuntimeCollapsed, options.onRuntimeShown]);

  const initialToolSlotCountRef = useRef(toolSlotCount);
  const controller = useMemo(() => createWidgetWindowController(initialPinned, initialToolSlotCountRef.current, {
    loadPlacement: getWidgetPlacement,
    applyLayout: setWidgetExpanded,
    finalizeDrag: finalizeWidgetDrag,
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearScheduled: (handle) => window.clearTimeout(handle),
    onPlacementChange: (nextPlacement) => {
      setPlacementState({
        monitor: nextPlacement.monitor
          ? {
              name: nextPlacement.monitor.name,
              workArea: { ...nextPlacement.monitor.workArea },
            }
          : null,
        side: nextPlacement.side,
        anchorY: clampWidgetAnchorY(nextPlacement.anchorY),
      });
    },
    onExpandedChange: (nextExpanded) => {
      clearCollapseVisualTimer();
      if (nextExpanded) {
        setCollapsing(false);
        setExpandedState(true);
        return;
      }

      setExpandedState(false);
      setCollapsing(true);
      collapseVisualTimerRef.current = window.setTimeout(() => {
        collapseVisualTimerRef.current = null;
        setCollapsing(false);
      }, COLLAPSE_ANIMATION_MS);
    },
    onCollapsedDragSettled: () => {
      onCollapsedDragSettledRef.current?.();
    },
    onWarning: (message, error) => {
      console.warn(message, error);
    },
  }), [initialPinned]);

  useEffect(() => {
    let cancelled = false;
    const unlistenPromises: Array<Promise<() => void>> = [];

    void setCurrentWidgetWindowFocusable(true).catch((error) => {
      console.warn("widget:focus", error);
    });

    void controller.initialize().then(() => {
      if (cancelled) {
        controller.dispose();
      }
    });

    unlistenPromises.push(onCurrentWidgetWindowMoved(() => {
      controller.handleWindowMoved();
    }));

    unlistenPromises.push(onCurrentWidgetWindowScaleChanged(() => {
      controller.handleScaleFactorChanged();
    }));

    unlistenPromises.push(onCurrentWidgetWindowFocusChanged((focused) => {
      controller.handleFocusChanged(focused);
    }));

    unlistenPromises.push(onWidgetRuntimeCollapsed(() => {
      onRuntimeCollapsedRef.current?.();
      controller.syncCollapsedFromRuntime();
    }));

    unlistenPromises.push(onWidgetRuntimeShown((runtimePlacement) => {
      onRuntimeShownRef.current?.();
      controller.syncShownFromRuntime(runtimePlacement);
    }));

    return () => {
      cancelled = true;
      controller.dispose();
      clearCollapseVisualTimer();
      for (const promise of unlistenPromises) {
        void promise.then((unlisten) => {
          unlisten();
        });
      }
    };
  }, [controller]);

  useEffect(() => {
    toolSlotCountRef.current = toolSlotCount;
    controller.setToolSlotCount(toolSlotCount);
  }, [controller, toolSlotCount]);

  const updatePinned = (nextPinned: boolean) => {
    desiredPinnedRef.current = nextPinned;
    if (pinMutationRef.current) return pinMutationRef.current;
    setPinSaveFailed(false);
    const mutation = (async () => {
      while (pinnedRef.current !== desiredPinnedRef.current) {
        const requestedPinned = desiredPinnedRef.current;
        try {
          await setWidgetPinned(requestedPinned, toolSlotCountRef.current);
        } catch (error) {
          desiredPinnedRef.current = pinnedRef.current;
          setPinSaveFailed(true);
          console.warn("widget:pin", error);
          return false;
        }

        pinnedRef.current = requestedPinned;
        controller.setPinned(requestedPinned);
        setPinnedState(requestedPinned);
      }
      return true;
    })()
      .finally(() => {
        pinMutationRef.current = null;
      });
    pinMutationRef.current = mutation;
    return mutation;
  };

  const toggleExpandedFromAnchor = () => {
    if (controller.getState().expanded && desiredPinnedRef.current) {
      void updatePinned(false).then((saved) => {
        if (saved) controller.collapse();
      });
      return;
    }
    controller.toggleExpanded();
  };

  return {
    beginUserDrag: controller.beginUserDrag,
    collapse: controller.collapse,
    endUserDrag: controller.endUserDrag,
    expand: controller.expand,
    expanded,
    collapsing,
    pinned,
    pinSaveFailed,
    placement,
    toggleExpanded: toggleExpandedFromAnchor,
    togglePinned: () => updatePinned(!desiredPinnedRef.current),
  };
}
