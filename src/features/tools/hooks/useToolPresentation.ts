import { useSyncExternalStore } from "react";
import { toolPresentationStore } from "../services/toolPresentationStore.ts";

export function useToolPresentation() {
  return useSyncExternalStore(toolPresentationStore.subscribe, toolPresentationStore.getSnapshot, toolPresentationStore.getSnapshot);
}
