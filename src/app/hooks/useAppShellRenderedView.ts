import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPreloadableViewChunkStatus,
  preloadLazyViewChunk,
} from "../services/viewChunkPreloadService.ts";
import type { View } from "../types/view.ts";
import {
  beginDataNavigationMeasurement,
  markDataNavigationStage,
} from "../../features/data/services/dataNavigationPerformance.ts";
import {
  ClassificationService,
  prewarmClassificationBootstrapCache,
} from "../../features/classification/services/classificationService.ts";
import {
  getSettingsPageBootstrapCache,
  prewarmSettingsBootstrapCache,
} from "../../features/settings/services/settingsBootstrapService.ts";
import {
  prewarmToolsRuntimeSnapshot,
  toolsRuntimeSnapshotStore,
} from "../../features/tools/services/toolsRuntimeSnapshotStore.ts";

function prepareViewData(view: View): Promise<unknown> {
  if (view === "mapping") return prewarmClassificationBootstrapCache();
  if (view === "settings") return prewarmSettingsBootstrapCache();
  if (view === "tools") return prewarmToolsRuntimeSnapshot();
  return Promise.resolve();
}

export function preloadNavigationView(view: View, reason: "intent" | "preview"): void {
  if (view === "data" && reason === "intent") {
    beginDataNavigationMeasurement();
  }

  void Promise.all([
    preloadLazyViewChunk(view),
    prepareViewData(view),
  ]).catch((error) => {
    console.warn(`Failed to preload ${view} view on navigation ${reason}`, error);
  });
}

function isNavigationViewReady(view: View) {
  if (getPreloadableViewChunkStatus(view) !== "resolved") return false;
  if (view === "settings") {
    return getSettingsPageBootstrapCache() !== null;
  }
  if (view === "tools") {
    return toolsRuntimeSnapshotStore.getCurrentSnapshot() !== null;
  }
  if (view !== "mapping") return true;

  return ClassificationService.getBootstrapCache() !== null
    && ClassificationService.getAppCatalogSnapshot().committed !== null;
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
  const [content, setContent] = useState({ view: renderedView, ready: false });
  if (content.view !== renderedView) setContent({ view: renderedView, ready: false });
  const markContentReady = useCallback((view: View) => {
    setContent(current => current.view === view && !current.ready ? { view, ready: true } : current);
  }, []);
  const onHistoryContentReady = useCallback(() => markContentReady("history"), [markContentReady]);
  const onDataContentReady = useCallback(() => markContentReady("data"), [markContentReady]);
  const requestRef = useRef(0);

  useEffect(() => {
    requestRef.current += 1;
    const requestId = requestRef.current;

    if (isNavigationViewReady(currentView)) {
      if (currentView === "data") {
        markDataNavigationStage("chunkReady");
      }
      setRenderedView(currentView);
      return undefined;
    }

    let cancelled = false;
    void prepareNavigationView(currentView)
      .then(() => {
        if (!cancelled && requestRef.current === requestId) {
          if (currentView === "data") {
            markDataNavigationStage("chunkReady");
          }
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
      contentReady: (renderedView !== "history" && renderedView !== "data")
        || (content.view === renderedView && content.ready),
    },
    onHistoryContentReady,
    onDataContentReady,
    presentedView,
  };
}
