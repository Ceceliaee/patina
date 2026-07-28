import { useEffect, useRef, useState } from "react";
import {
  getPreloadableViewChunkStatus,
  preloadLazyViewChunk,
  type PreloadableView,
} from "../services/viewChunkPreloadService.ts";
import type { View } from "../types/view.ts";
import { markDataNavigationStage } from "../../features/data/services/dataNavigationPerformance.ts";

export function getPreloadableNavigationView(view: View): PreloadableView | null {
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

  void preloadLazyViewChunk(preloadableView).catch((error) => {
    console.warn(`Failed to preload ${preloadableView} view on navigation ${reason}`, error);
  });
}

export function useAppShellRenderedView(currentView: View): View {
  const [renderedView, setRenderedView] = useState<View>("dashboard");
  const requestRef = useRef(0);

  useEffect(() => {
    const preloadableView = getPreloadableNavigationView(currentView);
    requestRef.current += 1;
    const requestId = requestRef.current;

    if (!preloadableView || getPreloadableViewChunkStatus(preloadableView) === "resolved") {
      if (currentView === "data") {
        markDataNavigationStage("chunkReady");
      }
      setRenderedView(currentView);
      return undefined;
    }

    let cancelled = false;
    void preloadLazyViewChunk(preloadableView)
      .then(() => {
        if (!cancelled && requestRef.current === requestId) {
          if (currentView === "data") {
            markDataNavigationStage("chunkReady");
          }
          setRenderedView(currentView);
        }
      })
      .catch((error) => {
        console.warn(`Failed to preload ${preloadableView} view before navigation`, error);
        if (!cancelled && requestRef.current === requestId) {
          setRenderedView(currentView);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentView]);

  return renderedView;
}
