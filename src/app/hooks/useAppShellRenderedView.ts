import { useEffect, useRef, useState } from "react";
import {
  getPreloadableViewChunkStatus,
  preloadLazyViewChunk,
} from "../services/viewChunkPreloadService.ts";
import type { View } from "../types/view.ts";
import {
  prewarmToolsRuntimeSnapshot,
  toolsRuntimeSnapshotStore,
} from "../../features/tools/services/toolsRuntimeSnapshotStore.ts";

function prepareViewData(view: View): Promise<unknown> {
  if (view === "tools") return prewarmToolsRuntimeSnapshot();
  return Promise.resolve();
}

export function preloadNavigationView(view: View, reason: "intent" | "preview"): void {

  void Promise.all([
    preloadLazyViewChunk(view),
    prepareViewData(view),
  ]).catch((error) => {
    console.warn(`Failed to preload ${view} view on navigation ${reason}`, error);
  });
}

function isNavigationViewReady(view: View) {
  if (getPreloadableViewChunkStatus(view) !== "resolved") return false;
  if (view === "tools") {
    return toolsRuntimeSnapshotStore.getCurrentSnapshot() !== null;
  }
  return true;
}

async function prepareNavigationView(view: View) {
  const [chunkResult, dataResult] = await Promise.allSettled([
    preloadLazyViewChunk(view),
    prepareViewData(view),
  ]);
  if (chunkResult.status === "rejected") {
    throw chunkResult.reason;
  }
  if (dataResult.status === "rejected") {
    throw dataResult.reason;
  }
}

export function useAppShellRenderedView(currentView: View, foregroundReady: boolean) {
  const [renderedView, setRenderedView] = useState<View | null>(null);
  const [presentedView, setPresentedView] = useState<View | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    requestRef.current += 1;
    const requestId = requestRef.current;

    if (isNavigationViewReady(currentView)) {
      setRenderedView(currentView);
      return undefined;
    }

    let cancelled = false;
    void prepareNavigationView(currentView)
      .then(() => {
        if (!cancelled && requestRef.current === requestId) {
          setRenderedView(currentView);
        }
      })
      .catch((error) => {
        console.warn(`Failed to prepare ${currentView} view before navigation`, error);
        if (!cancelled && requestRef.current === requestId) {
          setRenderedView(currentView);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentView]);

  return {
    outletProps: {
      foregroundReady,
      onPresentedViewChange: setPresentedView,
      renderedView: renderedView ?? currentView,
      prepared: renderedView !== null,
      contentReady: true,
    },
    presentedView,
  };
}
