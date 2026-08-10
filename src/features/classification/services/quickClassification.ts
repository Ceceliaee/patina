import {
  getCategoryToken,
  isExtendedCategory,
  USER_ASSIGNABLE_CATEGORIES,
  type AppCategory,
  type UserAssignableAppCategory,
} from "../../../shared/classification/categoryTokens.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";
import {
  ClassificationService,
  type ClassificationBootstrapData,
} from "./classificationService.ts";
import type { Locale, UiText } from "../../../shared/i18n/index.ts";
import type { QuickClassificationTarget } from "../types.ts";

export interface QuickClassificationCategoryOption {
  value: UserAssignableAppCategory;
  label: string;
}

interface QuickClassificationOverridePatch {
  category?: UserAssignableAppCategory | null;
  displayName?: string | null;
}

export type QuickClassificationOverride = AppOverride | WebDomainOverride;

export function isQuickClassificationUnclassified(
  category: AppCategory | null | undefined,
  deletedCategories: readonly AppCategory[] = [],
): boolean {
  return !category || category === "other" || deletedCategories.includes(category);
}

export function buildQuickAppOverride(
  current: AppOverride | null,
  patch: QuickClassificationOverridePatch,
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

export function buildQuickWebDomainOverride(
  current: WebDomainOverride | null,
  patch: QuickClassificationOverridePatch,
  updatedAt: number = Date.now(),
): WebDomainOverride | null {
  const category = Object.prototype.hasOwnProperty.call(patch, "category")
    ? patch.category ?? undefined
    : current?.category;
  const displayName = Object.prototype.hasOwnProperty.call(patch, "displayName")
    ? patch.displayName ?? undefined
    : current?.displayName;

  const next: WebDomainOverride = { updatedAt };
  if (category && category !== "other") next.category = category;
  if (displayName?.trim()) next.displayName = displayName.trim();
  if (current?.color) next.color = current.color;
  if (current?.enabled === false) next.enabled = false;
  if (current?.captureTitle === false) next.captureTitle = false;
  const hasMeaningfulOverride = Boolean(
    next.category
    || next.displayName
    || next.color
    || next.enabled === false
    || next.captureTitle === false,
  );
  return hasMeaningfulOverride ? next : null;
}

export function resolveQuickClassificationOverride(
  bootstrap: Pick<ClassificationBootstrapData, "loadedOverrides" | "loadedWebDomainOverrides">,
  target: QuickClassificationTarget,
): QuickClassificationOverride | null {
  return target.kind === "app"
    ? bootstrap.loadedOverrides[target.exeName] ?? null
    : bootstrap.loadedWebDomainOverrides[target.normalizedDomain] ?? null;
}

export function buildQuickClassificationOverride(
  target: QuickClassificationTarget,
  current: QuickClassificationOverride | null,
  patch: QuickClassificationOverridePatch,
  updatedAt: number = Date.now(),
): QuickClassificationOverride | null {
  return target.kind === "app"
    ? buildQuickAppOverride(current as AppOverride | null, patch, updatedAt)
    : buildQuickWebDomainOverride(current as WebDomainOverride | null, patch, updatedAt);
}

export async function saveQuickClassificationOverride(
  target: QuickClassificationTarget,
  override: QuickClassificationOverride | null,
): Promise<void> {
  if (target.kind === "app") {
    await ClassificationService.saveAppOverride(
      target.exeName,
      override as AppOverride | null,
    );
    return;
  }
  await ClassificationService.saveWebDomainOverride(
    target.normalizedDomain,
    override as WebDomainOverride | null,
  );
}

export function buildQuickClassificationCategoryOptions(
  bootstrap: Pick<
    ClassificationBootstrapData,
    | "loadedOverrides"
    | "loadedWebDomainOverrides"
    | "loadedCategoryColorOverrides"
    | "loadedCategoryLabelOverrides"
    | "loadedPersistedCategoryIds"
    | "loadedDeletedCategories"
  >,
  uiText: UiText,
  locale: Locale,
): QuickClassificationCategoryOption[] {
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
    bootstrap.loadedCategoryLabelOverrides[category] ?? getCategoryToken(category, uiText).label
  );
  const seeded = USER_ASSIGNABLE_CATEGORIES.filter(
    (category) => category !== "other" && !deleted.has(category),
  );
  const custom = Array.from(extended).sort((left, right) => (
    resolveLabel(left).localeCompare(resolveLabel(right), locale)
  ));
  const ordered = deleted.has("other")
    ? [...seeded, ...custom]
    : [...seeded, ...custom, "other" as const];

  return ordered.map((category) => ({ value: category, label: resolveLabel(category) }));
}
