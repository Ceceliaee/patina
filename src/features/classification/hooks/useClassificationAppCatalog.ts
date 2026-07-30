import { useCallback, useEffect, useSyncExternalStore } from "react";
import { ClassificationService } from "../services/classificationService.ts";

interface UseClassificationAppCatalogInput {
  enabled: boolean;
}

export function useClassificationAppCatalog({
  enabled,
}: UseClassificationAppCatalogInput) {
  const snapshot = useSyncExternalStore(
    ClassificationService.subscribeAppCatalogSnapshot,
    ClassificationService.getAppCatalogSnapshot,
    ClassificationService.getAppCatalogSnapshot,
  );

  useEffect(() => {
    if (!enabled) return;
    void ClassificationService.ensureAppCatalogLoaded().catch(() => undefined);
  }, [enabled]);

  const retry = useCallback(
    () => ClassificationService.retryAppCatalog(),
    [],
  );
  const reload = useCallback(() => {
    ClassificationService.invalidateAppCatalog();
    return ClassificationService.refreshAppCatalog();
  }, []);

  return {
    candidates: snapshot.committed?.candidates ?? [],
    hasSnapshot: snapshot.committed !== null,
    loading: snapshot.status === "cold" || snapshot.status === "refreshing",
    error: snapshot.status === "error" && snapshot.committed === null,
    refreshError: snapshot.status === "error" && snapshot.committed !== null,
    retry,
    reload,
  };
}
