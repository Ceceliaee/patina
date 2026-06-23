import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyWidgetLayout,
  getWidgetPlacement,
  onCurrentWidgetWindowFocusChanged,
  onCurrentWidgetWindowMoved,
  onWidgetRuntimeCollapsed,
  onWidgetRuntimeShown,
  readCurrentWidgetWindowRect,
  resolveWidgetMonitorForWindowRect,
  setCurrentWidgetWindowFocusable,
  setWidgetExpanded,
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
  showObjectSlot: boolean,
  options: WidgetWindowStateOptions = {},
) {
  const [placement, setPlacementState] = useState<WidgetPlacement>(DEFAULT_WIDGET_PLACEMENT);
  const [expanded, setExpandedState] = useState(false);
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

  const controller = useMemo(() => createWidgetWindowController(showObjectSlot, {
    loadPlacement: getWidgetPlacement,
    persistExpanded: setWidgetExpanded,
    applyLayout: async (nextPlacement, nextExpanded, nextShowObjectSlot) => {
      await applyWidgetLayout(
        nextPlacement.side,
        nextPlacement.anchorY,
        nextExpanded,
        nextShowObjectSlot,
      );
    },
    readWindowRect: readCurrentWidgetWindowRect,
    resolveMonitorForWindowRect: resolveWidgetMonitorForWindowRect,
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearScheduled: (handle) => window.clearTimeout(handle),
    onPlacementChange: (nextPlacement) => {
      setPlacementState({
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
  }), []);

  useEffect(() => {
    let cancelled = false;
    const unlistenPromises: Array<Promise<() => void>> = [];

    void setCurrentWidgetWindowFocusable(true).catch((error) => {
      console.warn("widget set focusable failed", error);
    });

    void controller.initialize().then(() => {
      if (cancelled) {
        controller.dispose();
      }
    });

    unlistenPromises.push(onCurrentWidgetWindowMoved(() => {
      controller.handleWindowMoved();
    }));

    unlistenPromises.push(onCurrentWidgetWindowFocusChanged((focused) => {
      controller.handleFocusChanged(focused);
    }));

    unlistenPromises.push(onWidgetRuntimeCollapsed(() => {
      onRuntimeCollapsedRef.current?.();
      controller.syncCollapsedFromRuntime();
    }));

    unlistenPromises.push(onWidgetRuntimeShown(() => {
      onRuntimeShownRef.current?.();
      controller.syncShownFromRuntime();
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
    controller.setShowObjectSlot(showObjectSlot);
  }, [controller, showObjectSlot]);

  return {
    beginUserDrag: controller.beginUserDrag,
    collapse: controller.collapse,
    endUserDrag: controller.endUserDrag,
    expand: controller.expand,
    expanded,
    collapsing,
    placement,
    toggleExpanded: controller.toggleExpanded,
  };
}
