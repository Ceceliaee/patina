import type {
  WidgetPhysicalPoint,
  WidgetPlacement,
} from "../../platform/desktop/widgetRuntimeGateway.ts";

interface WidgetWindowControllerDeps {
  loadPlacement: () => Promise<WidgetPlacement | null>;
  applyLayout: (expanded: boolean, toolSlotCount: number) => Promise<void>;
  finalizeDrag: (
    releasePosition: WidgetPhysicalPoint | null,
    expanded: boolean,
    toolSlotCount: number,
  ) => Promise<WidgetPlacement | null>;
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
  initialPinned: boolean,
  initialToolSlotCount: number,
  deps: WidgetWindowControllerDeps,
) {
  let placement = DEFAULT_WIDGET_PLACEMENT;
  let placementRevision = 0;
  let expanded = initialPinned;
  let pinned = initialPinned;
  let toolSlotCount = initialToolSlotCount;
  let applyingRuntimeLayout = false;
  let userDragActive = false;
  let collapseAfterDragFinalize = false;
  let runtimeHidden = false;
  let scaleRefreshPending = false;
  let collapsedDragSettlePending = false;
  let dragGeneration = 0;
  let finalizeInFlightGeneration: number | null = null;
  let queuedFinalizeGeneration: number | null = null;
  let dragReleasePosition: {
    generation: number;
    point: Promise<WidgetPhysicalPoint | null>;
  } | null = null;
  let dragTimerHandle: number | null = null;
  let layoutReleaseHandle: number | null = null;
  let collapseRuntimeHandle: number | null = null;

  function setPlacement(nextPlacement: WidgetPlacement) {
    placement = normalizePlacement(nextPlacement);
    placementRevision += 1;
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
    nextToolSlotCount: number,
  ) {
    applyingRuntimeLayout = true;
    clearLayoutReleaseTimer();
    try {
      await deps.applyLayout(nextExpanded, nextToolSlotCount);
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
    void runRuntimeLayout(expanded, toolSlotCount).catch((error) => {
      deps.onWarning?.("widget:dpi", error);
    });
  }

  async function finalizeMove(generation: number) {
    if (
      runtimeHidden
      || userDragActive
      || generation !== dragGeneration
    ) {
      return;
    }

    const releasePosition = dragReleasePosition?.generation === generation
      ? await dragReleasePosition.point
      : null;
    if (
      runtimeHidden
      || userDragActive
      || generation !== dragGeneration
    ) {
      return;
    }
    const nextPlacement = await deps.finalizeDrag(releasePosition, expanded, toolSlotCount);
    if (
      !nextPlacement
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
        deps.onWarning?.("widget:drag", error);
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
          && !runtimeHidden
          && !userDragActive
        ) {
          startFinalizeMove(queuedGeneration);
          return;
        }

        if (collapseAfterDragFinalize && expanded && !pinned && !runtimeHidden) {
          collapseAfterDragFinalize = false;
          collapse();
        }
      });
  }

  function requestFinalizeMove(generation: number) {
    if (
      runtimeHidden
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
    const revisionAtStart = placementRevision;
    try {
      const loadedPlacement = await deps.loadPlacement();
      if (loadedPlacement && placementRevision === revisionAtStart) {
        setPlacement(loadedPlacement);
      }
    } catch (error) {
      deps.onWarning?.("widget:placement", error);
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
    void runRuntimeLayout(true, toolSlotCount).catch((error) => {
      deps.onWarning?.("widget:expand", error);
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
      void runRuntimeLayout(false, toolSlotCount).catch((error) => {
        deps.onWarning?.("widget:collapse", error);
      });
    }, COLLAPSE_ANIMATION_MS);
  }

  function beginUserDrag() {
    runtimeHidden = false;
    dragGeneration += 1;
    userDragActive = true;
    queuedFinalizeGeneration = null;
    dragReleasePosition = null;
    collapseAfterDragFinalize = false;
    clearCollapsedDragSettlePending();
    clearDragTimer();
  }

  function syncCollapsedFromRuntime() {
    runtimeHidden = true;
    dragGeneration += 1;
    userDragActive = false;
    scaleRefreshPending = false;
    queuedFinalizeGeneration = null;
    dragReleasePosition = null;
    collapseAfterDragFinalize = false;
    clearDragTimer();
    clearCollapsedDragSettlePending();
    clearCollapseRuntimeTimer();
    if (!expanded) {
      return;
    }

    setExpanded(false);
  }

  function syncShownFromRuntime(runtimePlacement: WidgetPlacement | null = null) {
    runtimeHidden = false;
    if (runtimePlacement) {
      setPlacement(runtimePlacement);
    }
    if (pinned && !expanded) {
      setExpanded(true);
    }
  }

  function endUserDrag(
    releasePosition: WidgetPhysicalPoint | null | Promise<WidgetPhysicalPoint | null> = null,
  ) {
    if (!userDragActive) {
      return;
    }

    userDragActive = false;
    dragReleasePosition = {
      generation: dragGeneration,
      point: Promise.resolve(releasePosition).catch(() => null),
    };
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
    if (focused) {
      collapseAfterDragFinalize = false;
      return;
    }

    if (!focused && expanded && !pinned) {
      if (userDragActive || finalizeInFlightGeneration !== null || collapsedDragSettlePending) {
        collapseAfterDragFinalize = true;
        return;
      }

      collapse();
    }
  }

  function handleWindowMoved() {
    if (
      runtimeHidden
      || applyingRuntimeLayout
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

  function setToolSlotCount(nextToolSlotCount: number) {
    const normalized = Math.max(0, Math.min(2, Math.trunc(nextToolSlotCount)));
    const previousToolSlotCount = toolSlotCount;
    toolSlotCount = normalized;
    if (!expanded || previousToolSlotCount === normalized) {
      return;
    }

    void runRuntimeLayout(true, normalized).catch((error) => {
      deps.onWarning?.("widget:slots", error);
    });
  }

  function setPinned(nextPinned: boolean) {
    pinned = nextPinned;
    if (nextPinned) {
      collapseAfterDragFinalize = false;
    }
  }

  function dispose() {
    runtimeHidden = true;
    dragGeneration += 1;
    userDragActive = false;
    scaleRefreshPending = false;
    queuedFinalizeGeneration = null;
    dragReleasePosition = null;
    collapseAfterDragFinalize = false;
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
      pinned,
      toolSlotCount,
    }),
    handleFocusChanged,
    handleScaleFactorChanged,
    handleWindowMoved,
    initialize,
    setPinned,
    setToolSlotCount,
    syncCollapsedFromRuntime,
    syncShownFromRuntime,
    toggleExpanded,
  };
}
