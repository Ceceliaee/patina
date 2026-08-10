import {
  USER_ASSIGNABLE_CATEGORIES,
  isExtendedCategory,
  type AppCategory,
  type ExtendedAppCategory,
} from "../../../shared/classification/categoryTokens.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";

export interface ClassificationDraftState {
  overrides: Record<string, AppOverride>;
  webDomainOverrides: Record<string, WebDomainOverride>;
  categoryColorOverrides: Record<string, string>;
  categoryLabelOverrides: Record<string, string>;
  persistedCategoryIds: ExtendedAppCategory[];
  deletedCategories: AppCategory[];
}

export interface ClassificationDraftChangePlan {
  overrideUpserts: Array<{ exeName: string; override: AppOverride | null }>;
  webDomainOverrideUpserts: Array<{ normalizedDomain: string; override: WebDomainOverride | null }>;
  categoryColorUpdates: Array<{ category: AppCategory; colorValue: string | null }>;
  categoryLabelUpdates: Array<{ category: AppCategory; label: string | null }>;
  persistedCategoryIdsToAdd: ExtendedAppCategory[];
  persistedCategoryIdsToRemove: ExtendedAppCategory[];
  deletedCategoryUpdates: Array<{ category: AppCategory; deleted: boolean }>;
  sanitizedDeletedCategories: AppCategory[];
}

function areStringMapsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

export function cloneClassificationDraftState(state: ClassificationDraftState): ClassificationDraftState {
  const overrides: Record<string, AppOverride> = {};
  for (const [exeName, override] of Object.entries(state.overrides)) {
    overrides[exeName] = { ...override };
  }
  const webDomainOverrides: Record<string, WebDomainOverride> = {};
  for (const [normalizedDomain, override] of Object.entries(state.webDomainOverrides ?? {})) {
    webDomainOverrides[normalizedDomain] = { ...override };
  }

  return {
    overrides,
    webDomainOverrides,
    categoryColorOverrides: { ...state.categoryColorOverrides },
    categoryLabelOverrides: { ...(state.categoryLabelOverrides ?? {}) },
    persistedCategoryIds: [...state.persistedCategoryIds],
    deletedCategories: [...state.deletedCategories],
  };
}

export function sanitizeDeletedCategories(categories: AppCategory[]): AppCategory[] {
  return categories.filter((category) => (
    !isExtendedCategory(category)
    && category !== "system"
    && category !== "other"
  ));
}

export function normalizeClassificationOverride(
  override: AppOverride | null | undefined,
): AppOverride | null {
  if (!override) return null;
  if (override.enabled === false) return null;
  const next: AppOverride = {};
  if (override.category) next.category = override.category;
  if (override.displayName?.trim()) next.displayName = override.displayName.trim();
  if (override.color) next.color = override.color;
  if (override.track === false) next.track = false;
  if (override.captureTitle === false) next.captureTitle = false;
  if (typeof override.updatedAt === "number") next.updatedAt = override.updatedAt;
  next.enabled = true;
  const hasMeaningfulValue = Boolean(
    next.category
    || next.displayName
    || next.color
    || next.track === false
    || next.captureTitle === false,
  );
  return hasMeaningfulValue ? next : null;
}

export function normalizeWebDomainOverride(
  override: WebDomainOverride | null | undefined,
): WebDomainOverride | null {
  if (!override) return null;
  const next: WebDomainOverride = {};
  if (override.category) next.category = override.category;
  if (override.displayName?.trim()) next.displayName = override.displayName.trim();
  if (override.color) next.color = override.color;
  if (override.enabled === false) next.enabled = false;
  if (override.captureTitle === false) next.captureTitle = false;
  if (typeof override.updatedAt === "number") next.updatedAt = override.updatedAt;
  const hasMeaningfulValue = Boolean(
    next.category
    || next.displayName
    || next.color
    || next.enabled === false
    || next.captureTitle === false,
  );
  return hasMeaningfulValue ? next : null;
}

function areClassificationOverridesEqual(
  left: AppOverride | null,
  right: AppOverride | null,
): boolean {
  const normalizedLeft = normalizeClassificationOverride(left);
  const normalizedRight = normalizeClassificationOverride(right);
  if (!normalizedLeft && !normalizedRight) return true;
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.category === normalizedRight.category
    && normalizedLeft.displayName === normalizedRight.displayName
    && normalizedLeft.color === normalizedRight.color
    && normalizedLeft.track === normalizedRight.track
    && normalizedLeft.captureTitle === normalizedRight.captureTitle;
}

function areWebDomainOverridesEqual(
  left: WebDomainOverride | null,
  right: WebDomainOverride | null,
): boolean {
  const normalizedLeft = normalizeWebDomainOverride(left);
  const normalizedRight = normalizeWebDomainOverride(right);
  if (!normalizedLeft && !normalizedRight) return true;
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.category === normalizedRight.category
    && normalizedLeft.displayName === normalizedRight.displayName
    && normalizedLeft.color === normalizedRight.color
    && normalizedLeft.enabled === normalizedRight.enabled
    && normalizedLeft.captureTitle === normalizedRight.captureTitle;
}

export function hasClassificationDraftChanges(
  saved: ClassificationDraftState,
  draft: ClassificationDraftState,
): boolean {
  if (!areStringMapsEqual(saved.categoryColorOverrides, draft.categoryColorOverrides)) {
    return true;
  }
  if (!areStringMapsEqual(saved.categoryLabelOverrides, draft.categoryLabelOverrides)) {
    return true;
  }
  if (!areStringArraysEqual(saved.persistedCategoryIds, draft.persistedCategoryIds)) {
    return true;
  }
  if (!areStringArraysEqual(
    sanitizeDeletedCategories(saved.deletedCategories),
    sanitizeDeletedCategories(draft.deletedCategories),
  )) {
    return true;
  }

  const exeNames = new Set([...Object.keys(saved.overrides), ...Object.keys(draft.overrides)]);
  for (const exeName of exeNames) {
    const savedOverride = saved.overrides[exeName] ?? null;
    const draftOverride = draft.overrides[exeName] ?? null;
    if (!areClassificationOverridesEqual(savedOverride, draftOverride)) {
      return true;
    }
  }

  const normalizedDomains = new Set([
    ...Object.keys(saved.webDomainOverrides ?? {}),
    ...Object.keys(draft.webDomainOverrides ?? {}),
  ]);
  for (const normalizedDomain of normalizedDomains) {
    const savedOverride = saved.webDomainOverrides?.[normalizedDomain] ?? null;
    const draftOverride = draft.webDomainOverrides?.[normalizedDomain] ?? null;
    if (!areWebDomainOverridesEqual(savedOverride, draftOverride)) {
      return true;
    }
  }

  return false;
}

export function buildClassificationDraftChangePlan(
  saved: ClassificationDraftState,
  draft: ClassificationDraftState,
): ClassificationDraftChangePlan {
  const sanitizedSavedDeletedCategories = sanitizeDeletedCategories(saved.deletedCategories);
  const sanitizedDraftDeletedCategories = sanitizeDeletedCategories(draft.deletedCategories);

  const overrideKeys = new Set([
    ...Object.keys(saved.overrides),
    ...Object.keys(draft.overrides),
  ]);
  const overrideUpserts: ClassificationDraftChangePlan["overrideUpserts"] = [];
  for (const exeName of overrideKeys) {
    const savedOverride = saved.overrides[exeName] ?? null;
    const draftOverride = draft.overrides[exeName] ?? null;
    if (areClassificationOverridesEqual(savedOverride, draftOverride)) {
      continue;
    }
    overrideUpserts.push({ exeName, override: draftOverride });
  }

  const webDomainKeys = new Set([
    ...Object.keys(saved.webDomainOverrides ?? {}),
    ...Object.keys(draft.webDomainOverrides ?? {}),
  ]);
  const webDomainOverrideUpserts: ClassificationDraftChangePlan["webDomainOverrideUpserts"] = [];
  for (const normalizedDomain of webDomainKeys) {
    const savedOverride = saved.webDomainOverrides?.[normalizedDomain] ?? null;
    const draftOverride = draft.webDomainOverrides?.[normalizedDomain] ?? null;
    if (areWebDomainOverridesEqual(savedOverride, draftOverride)) {
      continue;
    }
    webDomainOverrideUpserts.push({ normalizedDomain, override: draftOverride });
  }

  const categoryColorUpdates: ClassificationDraftChangePlan["categoryColorUpdates"] = [];
  const colorKeys = new Set([
    ...Object.keys(saved.categoryColorOverrides),
    ...Object.keys(draft.categoryColorOverrides),
  ]);
  for (const category of colorKeys) {
    const savedColor = saved.categoryColorOverrides[category];
    const draftColor = draft.categoryColorOverrides[category];
    if (savedColor === draftColor) {
      continue;
    }
    categoryColorUpdates.push({
      category: category as AppCategory,
      colorValue: draftColor ?? null,
    });
  }

  const categoryLabelUpdates: ClassificationDraftChangePlan["categoryLabelUpdates"] = [];
  const labelKeys = new Set([
    ...Object.keys(saved.categoryLabelOverrides),
    ...Object.keys(draft.categoryLabelOverrides),
  ]);
  for (const category of labelKeys) {
    const savedLabel = saved.categoryLabelOverrides[category];
    const draftLabel = draft.categoryLabelOverrides[category];
    if (savedLabel === draftLabel) {
      continue;
    }
    categoryLabelUpdates.push({
      category: category as AppCategory,
      label: draftLabel ?? null,
    });
  }

  const savedPersistedCategoryIds = new Set(saved.persistedCategoryIds);
  const draftPersistedCategoryIds = new Set(draft.persistedCategoryIds);
  const persistedCategoryIdsToAdd = draft.persistedCategoryIds.filter((category) => (
    !savedPersistedCategoryIds.has(category)
  ));
  const persistedCategoryIdsToRemove = saved.persistedCategoryIds.filter((category) => (
    !draftPersistedCategoryIds.has(category)
  ));

  const deletedCategoryUpdates: ClassificationDraftChangePlan["deletedCategoryUpdates"] = [];
  const assignableCategories = USER_ASSIGNABLE_CATEGORIES.filter((category) => (
    !isExtendedCategory(category) && category !== "other"
  ));
  for (const category of assignableCategories) {
    const savedDeleted = sanitizedSavedDeletedCategories.includes(category);
    const draftDeleted = sanitizedDraftDeletedCategories.includes(category);
    if (savedDeleted === draftDeleted) {
      continue;
    }
    deletedCategoryUpdates.push({ category, deleted: draftDeleted });
  }

  return {
    overrideUpserts,
    webDomainOverrideUpserts,
    categoryColorUpdates,
    categoryLabelUpdates,
    persistedCategoryIdsToAdd,
    persistedCategoryIdsToRemove,
    deletedCategoryUpdates,
    sanitizedDeletedCategories: sanitizedDraftDeletedCategories,
  };
}
