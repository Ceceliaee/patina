import type { WidgetPlacement } from "../../platform/desktop/widgetRuntimeGateway.ts";

export interface WidgetWindowPosition {
  x: number;
  y: number;
}

export interface WidgetWindowSize {
  width: number;
  height: number;
}

export interface WidgetWindowRect {
  position: WidgetWindowPosition;
  size: WidgetWindowSize;
}

export interface WidgetMonitorLike {
  workArea: {
    position: WidgetWindowPosition;
    size: WidgetWindowSize;
  };
}

export interface WidgetWindowControllerDeps {
  loadPlacement: () => Promise<WidgetPlacement | null>;
  persistExpanded: (expanded: boolean, showObjectSlot: boolean) => Promise<void>;
  applyLayout: (
    placement: WidgetPlacement,
    expanded: boolean,
    showObjectSlot: boolean,
  ) => Promise<void>;
  readWindowRect: () => Promise<WidgetWindowRect | null>;
  resolveMonitorForWindowRect: (
    position: WidgetWindowPosition,
    size: WidgetWindowSize,
  ) => Promise<WidgetMonitorLike | null>;
  schedule: (callback: () => void, delayMs: number) => number;
  clearScheduled: (handle: number) => void;
  onPlacementChange?: (placement: WidgetPlacement) => void;
  onExpandedChange?: (expanded: boolean) => void;
  onWarning?: (message: string, error: unknown) => void;
}

export const DEFAULT_WIDGET_PLACEMENT: WidgetPlacement = {
  side: "right",
  anchor_y: 0.28,
};

export const DRAG_SETTLE_MS = 160;

export function clampWidgetAnchorY(anchorY: number) {
  if (!Number.isFinite(anchorY)) {
    return DEFAULT_WIDGET_PLACEMENT.anchor_y;
  }

  return Math.max(0, Math.min(1, anchorY));
}

export function resolveWidgetPlacementFromWindowRect(
  monitor: WidgetMonitorLike,
  position: WidgetWindowPosition,
  size: WidgetWindowSize,
): WidgetPlacement {
  const workArea = monitor.workArea;
  const centerX = position.x + size.width / 2;
  const side = centerX < (workArea.position.x + workArea.size.width / 2) ? "left" : "right";
  const maxYOffset = Math.max(0, workArea.size.height - size.height);
  const anchorY = maxYOffset <= 0
    ? 0
    : clampWidgetAnchorY((position.y - workArea.position.y) / maxYOffset);

  return {
    side,
    anchor_y: anchorY,
  };
}

export function createWidgetWindowController(
  initialShowObjectSlot: boolean,
  deps: WidgetWindowControllerDeps,
) {
  let placement = DEFAULT_WIDGET_PLACEMENT;
  let expanded = false;
  let showObjectSlot = initialShowObjectSlot;
  let applyingRuntimeLayout = false;
  let dragTimerHandle: number | null = null;
  let layoutReleaseHandle: number | null = null;

  function setPlacement(nextPlacement: WidgetPlacement) {
    placement = {
      side: nextPlacement.side,
      anchor_y: clampWidgetAnchorY(nextPlacement.anchor_y),
    };
    deps.onPlacementChange?.(placement);
  }

  function setExpanded(nextExpanded: boolean) {
    expanded = nextExpanded;
    deps.onExpandedChange?.(expanded);
  }

  function clearDragTimer() {
    if (dragTimerHandle !== null) {
      deps.clearScheduled(dragTimerHandle);
      dragTimerHandle = null;
    }
  }

  function clearLayoutReleaseTimer() {
    if (layoutReleaseHandle !== null) {
      deps.clearScheduled(layoutReleaseHandle);
      layoutReleaseHandle = null;
    }
  }

  async function runRuntimeLayout(
    nextPlacement: WidgetPlacement,
    nextExpanded: boolean,
    nextShowObjectSlot: boolean,
  ) {
    applyingRuntimeLayout = true;
    clearLayoutReleaseTimer();
    try {
      await deps.applyLayout(nextPlacement, nextExpanded, nextShowObjectSlot);
    } finally {
      layoutReleaseHandle = deps.schedule(() => {
        applyingRuntimeLayout = false;
        layoutReleaseHandle = null;
      }, 0);
    }
  }

  async function finalizeMove() {
    const rect = await deps.readWindowRect();
    if (!rect) {
      return;
    }

    const monitor = await deps.resolveMonitorForWindowRect(rect.position, rect.size);
    if (!monitor) {
      return;
    }

    const nextPlacement = resolveWidgetPlacementFromWindowRect(monitor, rect.position, rect.size);
    setPlacement(nextPlacement);
    try {
      await runRuntimeLayout(nextPlacement, true, showObjectSlot);
    } catch (error) {
      deps.onWarning?.("apply widget drag layout failed", error);
    }
  }

  async function initialize() {
    try {
      const loadedPlacement = await deps.loadPlacement();
      if (loadedPlacement) {
        setPlacement(loadedPlacement);
      }
    } catch (error) {
      deps.onWarning?.("load widget placement failed", error);
    }
  }

  function expand() {
    if (expanded) {
      return;
    }

    setExpanded(true);
    void deps.persistExpanded(true, showObjectSlot).catch((error) => {
      deps.onWarning?.("widget expand failed", error);
    });
  }

  function collapse() {
    if (!expanded) {
      return;
    }

    setExpanded(false);
    void deps.persistExpanded(false, showObjectSlot).catch((error) => {
      deps.onWarning?.("widget collapse failed", error);
    });
  }

  function toggleExpanded() {
    if (expanded) {
      collapse();
      return;
    }

    expand();
  }

  function handleFocusChanged(focused: boolean) {
    if (!focused && expanded) {
      collapse();
    }
  }

  function handleWindowMoved() {
    if (applyingRuntimeLayout || !expanded) {
      return;
    }

    clearDragTimer();
    dragTimerHandle = deps.schedule(() => {
      dragTimerHandle = null;
      void finalizeMove();
    }, DRAG_SETTLE_MS);
  }

  function setShowObjectSlot(nextShowObjectSlot: boolean) {
    const previousShowObjectSlot = showObjectSlot;
    showObjectSlot = nextShowObjectSlot;
    if (!expanded || previousShowObjectSlot === nextShowObjectSlot) {
      return;
    }

    void runRuntimeLayout(placement, true, nextShowObjectSlot).catch((error) => {
      deps.onWarning?.("apply widget slot layout failed", error);
    });
  }

  function dispose() {
    clearDragTimer();
    clearLayoutReleaseTimer();
  }

  return {
    collapse,
    dispose,
    expand,
    getState: () => ({
      placement,
      expanded,
      showObjectSlot,
    }),
    handleFocusChanged,
    handleWindowMoved,
    initialize,
    setShowObjectSlot,
    toggleExpanded,
  };
}
