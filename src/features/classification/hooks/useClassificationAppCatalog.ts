import { useCallback, useEffect, useRef, useState } from "react";
import { ClassificationService } from "../services/classificationService.ts";
import type { ObservedAppCandidate } from "../services/classificationStore.ts";

interface UseClassificationAppCatalogInput {
  enabled: boolean;
  initialCandidates: readonly ObservedAppCandidate[];
}

interface CatalogViewState {
  candidates: ObservedAppCandidate[];
  loading: boolean;
  error: boolean;
}

let completeCatalogCache: ObservedAppCandidate[] | null = null;

export function useClassificationAppCatalog({
  enabled,
  initialCandidates,
}: UseClassificationAppCatalogInput) {
  const [view, setView] = useState<CatalogViewState>(() => ({
    candidates: completeCatalogCache ?? [...initialCandidates],
    loading: !completeCatalogCache,
    error: false,
  }));
  const controllerRef = useRef<ReturnType<typeof ClassificationService.createAppCatalogController> | null>(null);
  controllerRef.current ??= ClassificationService.createAppCatalogController();

  const loadAll = useCallback(async () => {
    const cachedCatalog = completeCatalogCache;
    const hasCache = !!cachedCatalog;
    const loadedCandidates: ObservedAppCandidate[] = [];
    setView({
      candidates: cachedCatalog ?? [...initialCandidates],
      loading: !hasCache,
      error: false,
    });

    try {
      await controllerRef.current!.loadAll({
        onBatch: (candidates, hasMore) => {
          if (!candidates.length && hasMore) return;

          loadedCandidates.push(...candidates);
          if (hasMore && hasCache) return;
          const nextCandidates = [...loadedCandidates];
          if (!hasMore) completeCatalogCache = nextCandidates;

          setView({
            candidates: nextCandidates,
            loading: hasMore,
            error: false,
          });
        },
      });
    } catch {
      setView((current) => ({
        ...current,
        loading: false,
        error: !completeCatalogCache,
      }));
    }
  }, [initialCandidates]);

  useEffect(() => {
    if (!enabled) return;
    void loadAll();
    return () => { controllerRef.current?.invalidate(); };
  }, [enabled, loadAll]);

  return { ...view, retry: loadAll, reload: loadAll };
}
