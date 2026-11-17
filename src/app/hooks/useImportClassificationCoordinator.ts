import { useCallback, type Dispatch, type SetStateAction } from "react";
import { ClassificationService } from "../../features/classification/services/classificationService.ts";
import { clearDashboardSnapshotCache } from "../../features/dashboard/services/dashboardSnapshotCache.ts";
import { clearToolsPageCaches } from "../../features/tools/services/toolsCacheLifecycle.ts";
import {
  applyMappingOverridesReadModelRefresh,
  type ReadModelRefreshState,
} from "../services/readModelRefreshState.ts";

export function useImportClassificationCoordinator(
  setReadModelRefreshState: Dispatch<SetStateAction<ReadModelRefreshState>>,
) {
  const onMappingOverridesChanged = useCallback(() => {
    clearDashboardSnapshotCache();
    clearToolsPageCaches();
    setReadModelRefreshState(applyMappingOverridesReadModelRefresh);
  }, [setReadModelRefreshState]);
  const onImportedDataChanged = useCallback(() => {
    ClassificationService.invalidateBootstrapCache();
    clearDashboardSnapshotCache();
    clearToolsPageCaches();
    void Promise.all([
    ]).then(async () => {
      const bootstrap = await ClassificationService.loadClassificationBootstrap();
      ClassificationService.applyBootstrapToProcessMapper(bootstrap);
    }).catch(() => {
      ClassificationService.invalidateBootstrapCache();
    });
    setReadModelRefreshState(applyMappingOverridesReadModelRefresh);
  }, [setReadModelRefreshState]);
  const prepareImportCategories = useCallback(async (
    candidates: Parameters<typeof ClassificationService.prepareImportedCategoryCandidates>[0],
  ) => {
    const prepared = await ClassificationService.prepareImportedCategoryCandidates(candidates);
    return {
      mutations: prepared.mutations,
      applyRuntime: () => {
        prepared.applyRuntime();
        void onImportedDataChanged();
      },
    };
  }, [onImportedDataChanged]);
  return { prepareImportCategories, onImportedDataChanged, onMappingOverridesChanged };
}
