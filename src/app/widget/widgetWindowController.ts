import type { WidgetPlacement } from "../../platform/desktop/widgetRuntimeGateway.ts";

interface WidgetWindowControllerDeps {
  loadPlacement: () => Promise<WidgetPlacement | null>;
  persistExpanded: (expanded: boolean, showObjectSlot: boolean) => Promise<void>;
  applyLayout: (expanded: boolean, showObjectSlot: boolean) => Promise<void>;
  finalizeDrag: () => Promise<WidgetPlacement | null>;
  schedule: (callback: () => void, delayMs: number) => number;
  clearScheduled: (handle: number) => void;
  onPlacementChange?: (placement: WidgetPlacement) => void;
  onExpandedChange?: (expanded: boolean) => void;
  onCollapsedDragSettled?: () => void;
  onWarning?: (message: string, error: unknown) => void;
}

export const DEFAULT_WIDGET_PLACEMENT: WidgetPlacement = {
  monitor: null,
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

function normalizePlacement(nextPlacement: WidgetPlacement): WidgetPlacement {
  return {
    monitor: nextPlacement.monitor
      ? {
          name: nextPlacement.monitor.name,
          workArea: { ...nextPlacement.monitor.workArea },
        }
      : null,
    side: nextPlacement.side,
    anchorY: clampWidgetAnchorY(nextPlacement.anchorY),
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
  let userDragActive = false;
  let runtimeHidden = false;
  let scaleRefreshPending = false;
  let collapsedDragSettlePending = false;
  let dragGeneration = 0;
  let finalizeInFlightGeneration: number | null = null;
  let queuedFinalizeGeneration: number | null = null;
  let dragTimerHandle: number | null = null;
  let layoutReleaseHandle: number | null = null;
  let collapseRuntimeHandle: number | null = null;

  function setPlacement(nextPlacement: WidgetPlacement) {
    placement = normalizePlacement(nextPlacement);
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

  function settleCollapsedDragVisual(generation: number) {
    if (!collapsedDragSettlePending || generation !== dragGeneration) {
      return;
    }

    collapsedDragSettlePending = false;
    deps.onCollapsedDragSettled?.();
  }

  function clearLayoutReleaseTimer() {
    if (layoutReleaseHandle !== null) {
      deps.clearScheduled(layoutReleaseHandle);
      layoutReleaseHandle = null;
    }
  }

  function releaseRuntimeLayoutOnNextTask() {
    clearLayoutReleaseTimer();
    layoutReleaseHandle = deps.schedule(() => {
      applyingRuntimeLayout = false;
      layoutReleaseHandle = null;
      schedulePendingScaleRefresh();
    }, 0);
  }

  function scheduleFinalizeMove(generation = dragGeneration) {
    clearDragTimer();
    dragTimerHandle = deps.schedule(() => {
      dragTimerHandle = null;
      requestFinalizeMove(generation);
    }, DRAG_SETTLE_MS);
  }

  function clearCollapseRuntimeTimer() {
    if (collapseRuntimeHandle !== null) {
      deps.clearScheduled(collapseRuntimeHandle);
      collapseRuntimeHandle = null;
    }
  }

  async function runRuntimeLayout(
    nextExpanded: boolean,
    nextShowObjectSlot: boolean,
  ) {
    applyingRuntimeLayout = true;
    clearLayoutReleaseTimer();
    try {
      await deps.applyLayout(nextExpanded, nextShowObjectSlot);
    } finally {
      releaseRuntimeLayoutOnNextTask();
    }
  }

  function schedulePendingScaleRefresh() {
    if (
      !scaleRefreshPending
      || runtimeHidden
      || userDragActive
      || applyingRuntimeLayout
      || finalizeInFlightGeneration !== null
    ) {
      return;
    }

    scaleRefreshPending = false;
    void runRuntimeLayout(expanded, showObjectSlot).catch((error) => {
      deps.onWarning?.("apply widget DPI layout failed", error);
    });
  }

  async function finalizeMove(generation: number) {
    if (
      expanded
      || runtimeHidden
      || userDragActive
      || generation !== dragGeneration
    ) {
      return;
    }

    const nextPlacement = await deps.finalizeDrag();
    if (
      !nextPlacement
      || expanded
      || runtimeHidden
      || userDragActive
      || generation !== dragGeneration
    ) {
      return;
    }

    scaleRefreshPending = false;
    setPlacement(nextPlacement);
  }

  function startFinalizeMove(generation: number) {
    finalizeInFlightGeneration = generation;
    applyingRuntimeLayout = true;
    clearLayoutReleaseTimer();
    void finalizeMove(generation)
      .catch((error) => {
        deps.onWarning?.("finalize widget drag failed", error);
      })
      .finally(() => {
        const completedGeneration = finalizeInFlightGeneration;
        finalizeInFlightGeneration = null;
        releaseRuntimeLayoutOnNextTask();
        if (completedGeneration !== null) {
          settleCollapsedDragVisual(completedGeneration);
        }

        const queuedGeneration = queuedFinalizeGeneration;
        queuedFinalizeGeneration = null;
        if (
          queuedGeneration !== null
          && queuedGeneration === dragGeneration
          && !expanded
          && !runtimeHidden
          && !userDragActive
        ) {
          startFinalizeMove(queuedGeneration);
        }
      });
  }

  function requestFinalizeMove(generation: number) {
    if (
      expanded
      || runtimeHidden
      || userDragActive
      || generation !== dragGeneration
    ) {
      settleCollapsedDragVisual(generation);
      return;
    }

    if (finalizeInFlightGeneration !== null) {
      queuedFinalizeGeneration = generation;
      return;
    }

    startFinalizeMove(generation);
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
    dragGeneration += 1;
    userDragActive = true;
    queuedFinalizeGeneration = null;
    clearCollapsedDragSettlePending();
    clearDragTimer();
  }

  function syncCollapsedFromRuntime() {
    runtimeHidden = true;
    dragGeneration += 1;
    userDragActive = false;
    scaleRefreshPending = false;
    queuedFinalizeGeneration = null;
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
    if (
      runtimeHidden
      || applyingRuntimeLayout
      || expanded
      || !collapsedDragSettlePending
    ) {
      return;
    }

    if (userDragActive) {
      clearDragTimer();
      return;
    }

    scheduleFinalizeMove();
  }

  function handleScaleFactorChanged() {
    if (runtimeHidden) {
      return;
    }

    scaleRefreshPending = true;
    schedulePendingScaleRefresh();
  }

  function setShowObjectSlot(nextShowObjectSlot: boolean) {
    const previousShowObjectSlot = showObjectSlot;
    showObjectSlot = nextShowObjectSlot;
    if (!expanded || previousShowObjectSlot === nextShowObjectSlot) {
      return;
    }

    void runRuntimeLayout(true, nextShowObjectSlot).catch((error) => {
      deps.onWarning?.("apply widget slot layout failed", error);
    });
  }

  function dispose() {
    runtimeHidden = true;
    dragGeneration += 1;
    userDragActive = false;
    scaleRefreshPending = false;
    queuedFinalizeGeneration = null;
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
    handleScaleFactorChanged,
    handleWindowMoved,
    initialize,
    setShowObjectSlot,
    syncCollapsedFromRuntime,
    syncShownFromRuntime,
    toggleExpanded,
  };
}
