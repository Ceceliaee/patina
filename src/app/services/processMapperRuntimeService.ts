import { ProcessMapper, type AppOverride } from "../../shared/classification/processMapper.ts";
import type { AppCategory } from "../../shared/classification/categoryTokens.ts";
import {
  loadAppOverrides,
  loadCategoryColorOverrides,
  loadCategoryDefaultColorAssignments,
  loadDeletedCategories,
  saveCategoryDefaultColorAssignment,
} from "../../features/classification/services/classificationStore.ts";

interface ProcessMapperRuntimeSnapshot {
  overrides: Record<string, AppOverride>;
  categoryColorOverrides: Record<string, string>;
  categoryDefaultColorAssignments: Record<string, string>;
  deletedCategories: AppCategory[];
}

async function loadProcessMapperRuntimeSnapshot(): Promise<ProcessMapperRuntimeSnapshot> {
  const [
    overrides,
    categoryColorOverrides,
    categoryDefaultColorAssignments,
    deletedCategories,
  ] = await Promise.all([
    loadAppOverrides(),
    loadCategoryColorOverrides(),
    loadCategoryDefaultColorAssignments(),
    loadDeletedCategories(),
  ]);

  return {
    overrides,
    categoryColorOverrides: categoryColorOverrides ?? {},
    categoryDefaultColorAssignments: categoryDefaultColorAssignments ?? {},
    deletedCategories: deletedCategories ?? [],
  };
}

function applyProcessMapperRuntimeSnapshot(snapshot: ProcessMapperRuntimeSnapshot): void {
  ProcessMapper.setUserOverrides(snapshot.overrides);
  ProcessMapper.setCategoryColorOverrides(snapshot.categoryColorOverrides);
  ProcessMapper.setCategoryDefaultColorAssignments(snapshot.categoryDefaultColorAssignments);
  ProcessMapper.setDeletedCategories(snapshot.deletedCategories);
  ProcessMapper.setCategoryDefaultColorAssignmentPersistence(
    saveCategoryDefaultColorAssignment,
  );
}

export async function refreshProcessMapperRuntime(): Promise<void> {
  const snapshot = await loadProcessMapperRuntimeSnapshot();
  applyProcessMapperRuntimeSnapshot(snapshot);
}

export async function initializeProcessMapperRuntime(): Promise<void> {
  await refreshProcessMapperRuntime();
}
