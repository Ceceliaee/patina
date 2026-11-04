import { useEffect, useLayoutEffect } from "react";
import { markDataNavigationStage } from "../services/dataNavigationPerformance.ts";
import { isDataHeatmapSelectionSettled, type HeatmapSelection } from "../services/dataHeatmapReadModel.ts";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useDataNavigationReadiness({
  initialContentReady,
  freshHeatmapRows,
  heatmapColdError,
  yearSessionsView,
  selectedHeatmapView,
  trustedReadModelsReady,
  destinationContentReady,
  destinationPanelCommitted,
  onInitialContentReady,
}: {
  initialContentReady: boolean;
  freshHeatmapRows: object | null;
  heatmapColdError: boolean;
  yearSessionsView: HeatmapSelection | null;
  selectedHeatmapView: HeatmapSelection;
  trustedReadModelsReady: boolean;
  destinationContentReady: boolean;
  destinationPanelCommitted: boolean;
  onInitialContentReady?: () => void;
}) {
  const dataContentComplete = Boolean(
    trustedReadModelsReady
    && (freshHeatmapRows || heatmapColdError)
    && isDataHeatmapSelectionSettled(yearSessionsView, selectedHeatmapView, heatmapColdError)
    && destinationContentReady
    && destinationPanelCommitted,
  );
  useIsomorphicLayoutEffect(() => {
    markDataNavigationStage("rootMounted");
    markDataNavigationStage("structureActive");
    if (initialContentReady) onInitialContentReady?.();
    if (trustedReadModelsReady) markDataNavigationStage("readModelReady");
    if (dataContentComplete) markDataNavigationStage("complete");
  }, [dataContentComplete, initialContentReady, onInitialContentReady, trustedReadModelsReady]);

  return dataContentComplete;
}
