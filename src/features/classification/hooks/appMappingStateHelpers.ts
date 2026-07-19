import type { ObservedAppCandidate } from "../types.ts";
import {
  isExtendedCategory,
  type AppCategory,
  type ExtendedAppCategory,
  type UserAssignableAppCategory,
} from "../../../shared/classification/categoryTokens.ts";
import type { AppOverride } from "../services/classificationService.ts";
import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";
import {
  cloneClassificationDraftState,
  type ClassificationDraftState,
} from "../services/classificationDraftState.ts";

type AppMappingOverrideParams = {
  category?: UserAssignableAppCategory;
  displayName?: string;
  color?: string;
  track?: boolean;
  captureTitle?: boolean;
  updatedAt?: number;
};

type WebDomainOverrideParams = {
  category?: UserAssignableAppCategory;
  displayName?: string;
  color?: string;
  enabled?: boolean;
  captureTitle?: boolean;
  updatedAt?: number;
};

type ClassificationBootstrapSnapshot = {
  loadedOverrides: ClassificationDraftState["overrides"];
  loadedWebDomainOverrides: ClassificationDraftState["webDomainOverrides"];
  loadedCategoryColorOverrides: ClassificationDraftState["categoryColorOverrides"];
  loadedCategoryLabelOverrides: ClassificationDraftState["categoryLabelOverrides"];
  loadedPersistedCategoryIds: ClassificationDraftState["persistedCategoryIds"];
  loadedDeletedCategories: ClassificationDraftState["deletedCategories"];
};

export function cloneObservedCandidates(observed: ObservedAppCandidate[]): ObservedAppCandidate[] {
  return observed.map((candidate) => ({ ...candidate }));
}

export function normalizeHexColor(colorValue: string | undefined): string | undefined {
  const raw = (colorValue ?? "").trim();
  if (!raw) return undefined;
  const normalized = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#[0-9A-Fa-f]{6}$/.test(normalized)) return undefined;
  return normalized.toUpperCase();
}

export function fallbackDisplayName(exeName: string): string {
  return exeName
    .replace(/\.exe$/i, "")
    .split(/[_\-\s.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildAppMappingOverride(params: AppMappingOverrideParams): AppOverride | null {
  const category = params.category;
  const displayName = params.displayName?.trim();
  const color = normalizeHexColor(params.color);
  const track = params.track;
  const captureTitle = params.captureTitle;
  if (!category && !displayName && !color && track !== false && captureTitle !== false) return null;
  const next: AppOverride = { enabled: true, updatedAt: params.updatedAt ?? Date.now() };
  if (category) next.category = category;
  if (displayName) next.displayName = displayName;
  if (color) next.color = color;
  if (track === false) next.track = false;
  if (captureTitle === false) next.captureTitle = false;
  return next;
}

export function buildAppMappingCategoryOverride(
  current: AppOverride | null,
  categoryValue: string,
): AppOverride | null {
  return buildAppMappingOverride({
    category: categoryValue === "other" ? undefined : categoryValue as UserAssignableAppCategory,
    color: current?.color,
    displayName: current?.displayName,
    track: current?.track !== false,
    captureTitle: current?.captureTitle !== false,
    updatedAt: current?.updatedAt,
  });
}

export function buildWebDomainMappingOverride(params: WebDomainOverrideParams): WebDomainOverride | null {
  const category = params.category;
  const displayName = params.displayName?.trim();
  const color = normalizeHexColor(params.color);
  const enabled = params.enabled;
  const captureTitle = params.captureTitle;
  if (!category && !displayName && !color && enabled !== false && captureTitle !== false) return null;
  const next: WebDomainOverride = { updatedAt: params.updatedAt ?? Date.now() };
  if (category) next.category = category;
  if (displayName) next.displayName = displayName;
  if (color) next.color = color;
  if (enabled === false) next.enabled = false;
  if (captureTitle === false) next.captureTitle = false;
  return next;
}

export function buildWebDomainCategoryOverride(
  current: WebDomainOverride | null,
  categoryValue: string,
): WebDomainOverride | null {
  return buildWebDomainMappingOverride({
    category: categoryValue === "other" ? undefined : categoryValue as UserAssignableAppCategory,
    color: current?.color,
    displayName: current?.displayName,
    enabled: current?.enabled !== false,
    captureTitle: current?.captureTitle !== false,
    updatedAt: current?.updatedAt,
  });
}

export function createAppMappingDraftState(
  bootstrap: ClassificationBootstrapSnapshot,
): ClassificationDraftState {
  return cloneClassificationDraftState({
    overrides: bootstrap.loadedOverrides,
    webDomainOverrides: bootstrap.loadedWebDomainOverrides ?? {},
    categoryColorOverrides: bootstrap.loadedCategoryColorOverrides,
    categoryLabelOverrides: bootstrap.loadedCategoryLabelOverrides ?? {},
    persistedCategoryIds: bootstrap.loadedPersistedCategoryIds,
    deletedCategories: bootstrap.loadedDeletedCategories,
  });
}

export function deleteCategoryFromDraftState(
  current: ClassificationDraftState,
  category: AppCategory,
): ClassificationDraftState {
  const nextOverrides: Record<string, AppOverride> = {};
  for (const [exeName, override] of Object.entries(current.overrides)) {
    if (override.category !== category) {
      nextOverrides[exeName] = override;
      continue;
    }
    const nextOverride = buildAppMappingOverride({
      category: undefined,
      color: override.color,
      displayName: override.displayName,
      track: override.track !== false,
      captureTitle: override.captureTitle !== false,
      updatedAt: override.updatedAt,
    });
    if (nextOverride) nextOverrides[exeName] = nextOverride;
  }

  const nextWebDomainOverrides: Record<string, WebDomainOverride> = {};
  for (const [normalizedDomain, override] of Object.entries(current.webDomainOverrides)) {
    if (override.category !== category) {
      nextWebDomainOverrides[normalizedDomain] = override;
      continue;
    }
    const nextOverride = buildWebDomainMappingOverride({
      category: undefined,
      color: override.color,
      displayName: override.displayName,
      enabled: override.enabled !== false,
      updatedAt: override.updatedAt,
    });
    if (nextOverride) nextWebDomainOverrides[normalizedDomain] = nextOverride;
  }

  const nextCategoryColorOverrides = { ...current.categoryColorOverrides };
  delete nextCategoryColorOverrides[category];
  const nextCategoryLabelOverrides = { ...current.categoryLabelOverrides };
  delete nextCategoryLabelOverrides[category];
  if (isExtendedCategory(category)) {
    return {
      ...current,
      overrides: nextOverrides,
      webDomainOverrides: nextWebDomainOverrides,
      categoryColorOverrides: nextCategoryColorOverrides,
      categoryLabelOverrides: nextCategoryLabelOverrides,
      persistedCategoryIds: current.persistedCategoryIds.filter((item) => item !== category),
      deletedCategories: current.deletedCategories.filter((item) => item !== category),
    };
  }

  return {
    ...current,
    overrides: nextOverrides,
    webDomainOverrides: nextWebDomainOverrides,
    categoryColorOverrides: nextCategoryColorOverrides,
    categoryLabelOverrides: nextCategoryLabelOverrides,
    deletedCategories: Array.from(new Set([...current.deletedCategories, category])),
  };
}

export function createCategoryInDraftState(
  current: ClassificationDraftState,
  category: ExtendedAppCategory,
  label: string,
): ClassificationDraftState {
  const normalizedLabel = label.trim().replace(/\s+/g, " ");
  if (!normalizedLabel) {
    return current;
  }

  return {
    ...current,
    categoryLabelOverrides: {
      ...current.categoryLabelOverrides,
      [category]: normalizedLabel,
    },
    persistedCategoryIds: current.persistedCategoryIds.includes(category)
      ? current.persistedCategoryIds
      : [...current.persistedCategoryIds, category],
    deletedCategories: current.deletedCategories.filter((item) => item !== category),
  };
}

export function mergeCategoryIntoDraftState(
  current: ClassificationDraftState,
  fromCategory: AppCategory,
  toCategory: UserAssignableAppCategory,
  fallbackColor?: string,
): ClassificationDraftState {
  if (fromCategory === toCategory) {
    return current;
  }

  const nextOverrides: Record<string, AppOverride> = {};
  for (const [exeName, override] of Object.entries(current.overrides)) {
    nextOverrides[exeName] = override.category === fromCategory
      ? { ...override, category: toCategory }
      : override;
  }

  const nextWebDomainOverrides: Record<string, WebDomainOverride> = {};
  for (const [normalizedDomain, override] of Object.entries(current.webDomainOverrides)) {
    nextWebDomainOverrides[normalizedDomain] = override.category === fromCategory
      ? { ...override, category: toCategory }
      : override;
  }

  const nextCategoryColorOverrides = { ...current.categoryColorOverrides };
  const movedColor = nextCategoryColorOverrides[fromCategory] ?? normalizeHexColor(fallbackColor);
  delete nextCategoryColorOverrides[fromCategory];
  if (movedColor && !nextCategoryColorOverrides[toCategory]) {
    nextCategoryColorOverrides[toCategory] = movedColor;
  }

  const nextCategoryLabelOverrides = { ...current.categoryLabelOverrides };
  delete nextCategoryLabelOverrides[fromCategory];

  const nextPersistedCategoryIds = new Set(current.persistedCategoryIds);
  if (isExtendedCategory(fromCategory)) {
    nextPersistedCategoryIds.delete(fromCategory);
  }
  if (isExtendedCategory(toCategory)) {
    nextPersistedCategoryIds.add(toCategory);
  }

  const nextDeletedCategories = new Set(current.deletedCategories.filter((category) => (
    category !== fromCategory && category !== toCategory
  )));
  if (!isExtendedCategory(fromCategory) && fromCategory !== "system" && fromCategory !== "other") {
    nextDeletedCategories.add(fromCategory);
  }

  return {
    ...current,
    overrides: nextOverrides,
    webDomainOverrides: nextWebDomainOverrides,
    categoryColorOverrides: nextCategoryColorOverrides,
    categoryLabelOverrides: nextCategoryLabelOverrides,
    persistedCategoryIds: Array.from(nextPersistedCategoryIds),
    deletedCategories: Array.from(nextDeletedCategories),
  };
}

export function updateAppOverrideInDraftState(
  current: ClassificationDraftState,
  exeName: string,
  nextOverride: AppOverride | null,
): ClassificationDraftState {
  const nextOverrides = { ...current.overrides };
  if (!nextOverride) delete nextOverrides[exeName];
  else nextOverrides[exeName] = nextOverride;
  return { ...current, overrides: nextOverrides };
}

export function updateWebDomainOverrideInDraftState(
  current: ClassificationDraftState,
  normalizedDomain: string,
  nextOverride: WebDomainOverride | null,
): ClassificationDraftState {
  const nextOverrides = { ...current.webDomainOverrides };
  if (!nextOverride) delete nextOverrides[normalizedDomain];
  else nextOverrides[normalizedDomain] = nextOverride;
  return { ...current, webDomainOverrides: nextOverrides };
}

export function updateCategoryColorInDraftState(
  current: ClassificationDraftState,
  category: AppCategory,
  colorValue: string | null,
): ClassificationDraftState {
  const next = { ...current.categoryColorOverrides };
  if (!colorValue) delete next[category];
  else next[category] = colorValue;
  return { ...current, categoryColorOverrides: next };
}

export function updateCategoryLabelInDraftState(
  current: ClassificationDraftState,
  category: AppCategory,
  label: string | null,
): ClassificationDraftState {
  const next = { ...current.categoryLabelOverrides };
  const normalizedLabel = label?.trim().replace(/\s+/g, " ");
  if (!normalizedLabel) delete next[category];
  else next[category] = normalizedLabel;
  return { ...current, categoryLabelOverrides: next };
}
