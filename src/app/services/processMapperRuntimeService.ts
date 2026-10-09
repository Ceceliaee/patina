import { ProcessMapper, type AppOverride } from "../../shared/classification/processMapper.ts";
import { AppClassification } from "../../shared/classification/appClassification.ts";
import type { AppLinks } from "../../shared/classification/appLinks.ts";
import type { AppCategory } from "../../shared/classification/categoryTokens.ts";
import {
  loadAppOverrides,
  loadAppLinks,
  loadCategoryColorOverrides,
  loadCategoryDefaultColorAssignments,
  loadCategoryLabelOverrides,
  loadDeletedCategories,
  saveCategoryDefaultColorAssignment,
} from "../../features/classification/services/classificationStore.ts";

interface ProcessMapperRuntimeSnapshot {
  appLinks: AppLinks;
  overrides: Record<string, AppOverride>;
  categoryColorOverrides: Record<string, string>;
  categoryLabelOverrides: Record<string, string>;
  categoryDefaultColorAssignments: Record<string, string>;
  deletedCategories: AppCategory[];
}

async function loadProcessMapperRuntimeSnapshot(): Promise<ProcessMapperRuntimeSnapshot> {
  const [
    appLinks,
    overrides,
    categoryColorOverrides,
    categoryLabelOverrides,
    categoryDefaultColorAssignments,
    deletedCategories,
  ] = await Promise.all([
    loadAppLinks(),
    loadAppOverrides(),
    loadCategoryColorOverrides(),
    loadCategoryLabelOverrides(),
    loadCategoryDefaultColorAssignments(),
    loadDeletedCategories(),
  ]);

  return {
    appLinks,
    overrides,
    categoryColorOverrides: categoryColorOverrides ?? {},
    categoryLabelOverrides: categoryLabelOverrides ?? {},
    categoryDefaultColorAssignments: categoryDefaultColorAssignments ?? {},
    deletedCategories: deletedCategories ?? [],
  };
}

function applyProcessMapperRuntimeSnapshot(snapshot: ProcessMapperRuntimeSnapshot): void {
  AppClassification.setAppLinks(snapshot.appLinks);
  ProcessMapper.setUserOverrides(snapshot.overrides);
  ProcessMapper.setCategoryColorOverrides(snapshot.categoryColorOverrides);
  ProcessMapper.setCategoryLabelOverrides(snapshot.categoryLabelOverrides);
  ProcessMapper.setCategoryDefaultColorAssignments(snapshot.categoryDefaultColorAssignments);
  ProcessMapper.setDeletedCategories(snapshot.deletedCategories);
  ProcessMapper.setCategoryDefaultColorAssignmentPersistence(
    saveCategoryDefaultColorAssignment,
  );
}

export async function refreshProcessMapperRuntime(): Promise<void> {
  for (;;) {
    const linksRevision = AppClassification.getAppLinksRevision();
    const snapshot = await loadProcessMapperRuntimeSnapshot();
    // A save may finish while storage reads are pending. Re-read the whole
    // snapshot so neither its links nor its overrides undo that newer save.
    if (linksRevision !== AppClassification.getAppLinksRevision()) continue;
    applyProcessMapperRuntimeSnapshot(snapshot);
    return;
  }
}

export async function initializeProcessMapperRuntime(): Promise<void> {
  await refreshProcessMapperRuntime();
}
