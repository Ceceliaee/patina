import {
  getCategoryToken,
  isExtendedCategory,
  USER_ASSIGNABLE_CATEGORIES,
  type AppCategory,
  type UserAssignableAppCategory,
} from "../../../shared/classification/categoryTokens.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import type { ClassificationBootstrapData } from "./classificationService.ts";

export interface QuickAppCategoryOption {
  value: UserAssignableAppCategory;
  label: string;
}

export interface QuickAppOverridePatch {
  category?: UserAssignableAppCategory | null;
  displayName?: string | null;
}

export function isQuickAppUnclassified(
  override: AppOverride | null | undefined,
  deletedCategories: readonly AppCategory[] = [],
): boolean {
  const category = override?.category;
  return !category || category === "other" || deletedCategories.includes(category);
}

export function buildQuickAppOverride(
  current: AppOverride | null,
  patch: QuickAppOverridePatch,
  updatedAt: number = Date.now(),
): AppOverride | null {
  const category = Object.prototype.hasOwnProperty.call(patch, "category")
    ? patch.category ?? undefined
    : current?.category;
  const displayName = Object.prototype.hasOwnProperty.call(patch, "displayName")
    ? patch.displayName ?? undefined
    : current?.displayName;

  const next: AppOverride = { enabled: true, updatedAt };
  if (category && category !== "other") next.category = category;
  if (displayName?.trim()) next.displayName = displayName.trim();
  if (current?.color) next.color = current.color;
  if (current?.track === false) next.track = false;
  if (current?.captureTitle === false) next.captureTitle = false;
  const hasMeaningfulOverride = Boolean(
    next.category
    || next.displayName
    || next.color
    || next.track === false
    || next.captureTitle === false,
  );
  return hasMeaningfulOverride ? next : null;
}

export function buildQuickAppCategoryOptions(
  bootstrap: Pick<
    ClassificationBootstrapData,
    | "loadedOverrides"
    | "loadedWebDomainOverrides"
    | "loadedCategoryColorOverrides"
    | "loadedCategoryLabelOverrides"
    | "loadedPersistedCategoryIds"
    | "loadedDeletedCategories"
  >,
): QuickAppCategoryOption[] {
  const deleted = new Set<AppCategory>(bootstrap.loadedDeletedCategories);
  const extended = new Set<UserAssignableAppCategory>();
  const collectExtended = (category: AppCategory | undefined) => {
    if (category && isExtendedCategory(category) && !deleted.has(category)) {
      extended.add(category);
    }
  };

  bootstrap.loadedPersistedCategoryIds.forEach(collectExtended);
  Object.values(bootstrap.loadedOverrides).forEach((override) => collectExtended(override.category));
  Object.values(bootstrap.loadedWebDomainOverrides).forEach((override) => collectExtended(override.category));
  Object.keys(bootstrap.loadedCategoryColorOverrides).forEach((category) => {
    collectExtended(category as AppCategory);
  });

  const resolveLabel = (category: UserAssignableAppCategory) => (
    bootstrap.loadedCategoryLabelOverrides[category] ?? getCategoryToken(category).label
  );
  const seeded = USER_ASSIGNABLE_CATEGORIES.filter(
    (category) => category !== "other" && !deleted.has(category),
  );
  const custom = Array.from(extended).sort((left, right) => (
    resolveLabel(left).localeCompare(resolveLabel(right), "zh-CN")
  ));
  const ordered = deleted.has("other")
    ? [...seeded, ...custom]
    : [...seeded, ...custom, "other" as const];

  return ordered.map((category) => ({ value: category, label: resolveLabel(category) }));
}
