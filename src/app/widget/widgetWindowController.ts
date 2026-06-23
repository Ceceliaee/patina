import type {
  WidgetMonitorLike,
  WidgetPlacement,
  WidgetWindowPosition,
  WidgetWindowRect,
  WidgetWindowSize,
} from "../../platform/desktop/widgetRuntimeGateway.ts";

interface WidgetWindowControllerDeps {
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
  onCollapsedDragSettled?: () => void;
  onWarning?: (message: string, error: unknown) => void;
}

export const DEFAULT_WIDGET_PLACEMENT: WidgetPlacement = {
  side: "right",
  anchorY: 0.28,
};

const DRAG_SETTLE_MS = 40;
export const COLLAPSE_ANIMATION_MS = 120;

export function clampWidgetAnchorY(anchorY: number) {
  if (!Number.isFinite(anchorY)) {
    return DEFAULT_WIDGET_PLACEMENT.anchorY;
  }

  return Math.max(0, Math.min(1, anchorY));
}

function resolveWidgetPlacementFromWindowRect(
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
    anchorY,
  };
}

function isWindowAtPlacement(
  monitor: WidgetMonitorLike,
  position: WidgetWindowPosition,
  size: WidgetWindowSize,
  placement: WidgetPlacement,
) {
  const workArea = monitor.workArea;
  const expectedX = placement.side === "left"
    ? workArea.position.x
    : workArea.position.x + workArea.size.width - size.width;
  const maxYOffset = Math.max(0, workArea.size.height - size.height);
  const expectedY = workArea.position.y + Math.round(placement.anchorY * maxYOffset);
  const tolerance = 2;

  return Math.abs(position.x - expectedX) <= tolerance
    && Math.abs(position.y - expectedY) <= tolerance;
}

export function createWidgetWindowController(
  initialShowObjectSlot: boolean,
  deps: WidgetWindowControllerDeps,
) {
  let placement = DEFAULT_WIDGET_PLACEMENT;
  let expanded = false;
  let showObjectSlot = initialShowObjectSlot;
  let applyingRuntimeLayout = false;
  let userDragActive = false;
  let runtimeHidden = false;
  let collapsedDragSettlePending = false;
  let dragTimerHandle: number | null = null;
  let layoutReleaseHandle: number | null = null;
  let collapseRuntimeHandle: number | null = null;

  function setPlacement(nextPlacement: WidgetPlacement) {
    placement = {
      side: nextPlacement.side,
      anchorY: clampWidgetAnchorY(nextPlacement.anchorY),
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

  function clearCollapsedDragSettlePending() {
    collapsedDragSettlePending = false;
  }

  function settleCollapsedDragVisual() {
    if (!collapsedDragSettlePending) {
      return;
    }

    collapsedDragSettlePending = false;
    deps.onCollapsedDragSettled?.();
  }

  function scheduleFinalizeMove() {
    clearDragTimer();
    dragTimerHandle = deps.schedule(() => {
      dragTimerHandle = null;
      void finalizeMove().finally(settleCollapsedDragVisual);
    }, DRAG_SETTLE_MS);
  }

  function clearLayoutReleaseTimer() {
    if (layoutReleaseHandle !== null) {
      deps.clearScheduled(layoutReleaseHandle);
      layoutReleaseHandle = null;
    }
  }

  function clearCollapseRuntimeTimer() {
    if (collapseRuntimeHandle !== null) {
      deps.clearScheduled(collapseRuntimeHandle);
      collapseRuntimeHandle = null;
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
    if (expanded) {
      return;
    }

    const rect = await deps.readWindowRect();
    if (!rect) {
      return;
    }

    const monitor = await deps.resolveMonitorForWindowRect(rect.position, rect.size);
    if (!monitor) {
      return;
    }

    if (expanded) {
      return;
    }

    const nextPlacement = resolveWidgetPlacementFromWindowRect(monitor, rect.position, rect.size);
    const alreadySettled = isWindowAtPlacement(monitor, rect.position, rect.size, nextPlacement);
    setPlacement(nextPlacement);
    if (alreadySettled) {
      return;
    }

    try {
      await runRuntimeLayout(nextPlacement, false, showObjectSlot);
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

    runtimeHidden = false;
    clearCollapseRuntimeTimer();
    clearCollapsedDragSettlePending();
    setExpanded(true);
    void deps.persistExpanded(true, showObjectSlot).catch((error) => {
      deps.onWarning?.("widget expand failed", error);
    });
  }

  function collapse() {
    if (!expanded) {
      return;
    }

    runtimeHidden = false;
    clearDragTimer();
    clearCollapsedDragSettlePending();
    setExpanded(false);
    clearCollapseRuntimeTimer();
    collapseRuntimeHandle = deps.schedule(() => {
      collapseRuntimeHandle = null;
      void deps.persistExpanded(false, showObjectSlot).catch((error) => {
        deps.onWarning?.("widget collapse failed", error);
      });
    }, COLLAPSE_ANIMATION_MS);
  }

  function beginUserDrag() {
    if (expanded) {
      return;
    }

    runtimeHidden = false;
    userDragActive = true;
    clearCollapsedDragSettlePending();
    clearDragTimer();
  }

  function syncCollapsedFromRuntime() {
    runtimeHidden = true;
    userDragActive = false;
    clearDragTimer();
    clearCollapsedDragSettlePending();
    clearCollapseRuntimeTimer();
    if (!expanded) {
      return;
    }

    setExpanded(false);
  }

  function syncShownFromRuntime() {
    runtimeHidden = false;
  }

  function endUserDrag() {
    if (!userDragActive) {
      return;
    }

    userDragActive = false;
    collapsedDragSettlePending = true;
    scheduleFinalizeMove();
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
    if (runtimeHidden || applyingRuntimeLayout || expanded) {
      return;
    }

    if (userDragActive) {
      clearDragTimer();
      return;
    }

    scheduleFinalizeMove();
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
    runtimeHidden = false;
    userDragActive = false;
    clearDragTimer();
    clearCollapsedDragSettlePending();
    clearLayoutReleaseTimer();
    clearCollapseRuntimeTimer();
  }

  return {
    beginUserDrag,
    collapse,
    dispose,
    endUserDrag,
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
    syncCollapsedFromRuntime,
    syncShownFromRuntime,
    toggleExpanded,
  };
}
