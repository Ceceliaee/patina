import type { CandidateFilter, ObservedAppCandidate } from "../types.ts";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { AppOverride } from "../services/classificationService.ts";
import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";
import { getUiLocale } from "../../../shared/copy/uiText.ts";
import {
  cloneClassificationDraftState,
  type ClassificationDraftState,
} from "../services/classificationDraftState.ts";

function createAppMappingCollator() {
  return new Intl.Collator(getUiLocale(), {
    numeric: true,
    sensitivity: "base",
  });
}

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
  updatedAt?: number;
};

type FilterAndSortCandidatesParams = {
  candidates: ObservedAppCandidate[];
  filter: CandidateFilter;
  searchQuery?: string;
  resolveMappedCategory: (candidate: ObservedAppCandidate) => UserAssignableAppCategory;
  resolveEffectiveDisplayName: (candidate: ObservedAppCandidate) => string;
  resolveCategoryLabel?: (category: UserAssignableAppCategory) => string;
};

type ClassificationBootstrapSnapshot = {
  loadedOverrides: ClassificationDraftState["overrides"];
  loadedWebDomainOverrides: ClassificationDraftState["webDomainOverrides"];
  loadedCategoryColorOverrides: ClassificationDraftState["categoryColorOverrides"];
  loadedCustomCategories: ClassificationDraftState["customCategories"];
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
  if (!category && !displayName && !color && enabled !== false) return null;
  const next: WebDomainOverride = { updatedAt: params.updatedAt ?? Date.now() };
  if (category) next.category = category;
  if (displayName) next.displayName = displayName;
  if (color) next.color = color;
  if (enabled === false) next.enabled = false;
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
    customCategories: bootstrap.loadedCustomCategories,
    deletedCategories: bootstrap.loadedDeletedCategories,
  });
}

export function filterAndSortCandidates({
  candidates,
  filter,
  searchQuery,
  resolveMappedCategory,
  resolveEffectiveDisplayName,
  resolveCategoryLabel,
}: FilterAndSortCandidatesParams): ObservedAppCandidate[] {
  const collator = createAppMappingCollator();
  const normalizedQuery = searchQuery?.trim().toLocaleLowerCase(getUiLocale()) ?? "";

  return candidates
    .filter((candidate) => {
      const category = resolveMappedCategory(candidate);
      if (filter === "all") return true;
      if (filter === "other") return category === "other";
      return category !== "other";
    })
    .filter((candidate) => {
      if (!normalizedQuery) return true;
      const category = resolveMappedCategory(candidate);
      const categoryLabel = resolveCategoryLabel?.(category) ?? category;
      const haystack = [
        resolveEffectiveDisplayName(candidate),
        candidate.appName,
        candidate.exeName,
        categoryLabel,
        category,
      ].join(" ").toLocaleLowerCase(getUiLocale());
      return haystack.includes(normalizedQuery);
    })
    .sort((left, right) => {
      const labelCompare = collator.compare(
        resolveEffectiveDisplayName(left),
        resolveEffectiveDisplayName(right),
      );
      if (labelCompare !== 0) {
        return labelCompare;
      }
      return collator.compare(left.exeName, right.exeName);
    });
}
