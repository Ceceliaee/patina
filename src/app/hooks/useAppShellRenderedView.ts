import { useEffect, useRef, useState } from "react";
import {
  getPreloadableViewChunkStatus,
  preloadLazyViewChunk,
  type PreloadableView,
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

function getPreloadableNavigationView(view: View): PreloadableView | null {
  switch (view) {
    case "about":
    case "data":
    case "history":
    case "mapping":
    case "settings":
    case "tools":
      return view;
    case "dashboard":
      return null;
  }
}

export function preloadNavigationView(view: View, reason: "intent" | "preview"): void {
  const preloadableView = getPreloadableNavigationView(view);
  if (!preloadableView) return;
  if (view === "data" && reason === "intent") {
    beginDataNavigationMeasurement();
  }

  void Promise.all([
    preloadLazyViewChunk(preloadableView),
    prepareViewData(view),
  ]).catch((error) => {
    console.warn(`Failed to preload ${preloadableView} view on navigation ${reason}`, error);
  });
}

function isNavigationViewReady(view: View) {
  const preloadableView = getPreloadableNavigationView(view);
  if (!preloadableView) return true;
  if (getPreloadableViewChunkStatus(preloadableView) !== "resolved") return false;
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
  const preloadableView = getPreloadableNavigationView(view);
  if (!preloadableView) return;

  const [chunkResult, dataResult] = await Promise.allSettled([
    preloadLazyViewChunk(preloadableView),
    prepareViewData(view),
  ]);
  if (chunkResult.status === "rejected") {
    throw chunkResult.reason;
  }
  if (dataResult.status === "rejected") {
    throw dataResult.reason;
  }
}

export function useAppShellRenderedView(currentView: View) {
  const [renderedView, setRenderedView] = useState<View>("dashboard");
  const [presentedView, setPresentedView] = useState<View>(renderedView);
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
      onPresentedViewChange: setPresentedView,
      renderedView,
    },
    presentedView,
    renderedView,
  };
}
