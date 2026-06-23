import { useCallback, useMemo } from "react";
import { getUiTextLanguage } from "../../../shared/copy/uiText.ts";
import { useIconThemeColors } from "../../../shared/hooks/useIconThemeColors";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import {
  isCustomCategory,
  USER_ASSIGNABLE_CATEGORIES,
  type AppCategory,
  type UserAssignableAppCategory,
} from "../../../shared/classification/categoryTokens";
import type { CandidateFilter, ObservedAppCandidate } from "../types";
import type {
  ObservedWebDomainCandidate,
  WebDomainOverride,
} from "../../../shared/types/webActivity.ts";
import type { AppOverride, ClassificationDraftState } from "../services/classificationService";
import {
  fallbackDisplayName,
  filterAndSortCandidates,
} from "./appMappingStateHelpers.ts";

const USER_ASSIGNABLE_CATEGORY_SET = new Set<string>(USER_ASSIGNABLE_CATEGORIES);
const CUSTOM_CATEGORY_NAME_LIMITS = {
  "zh-CN": 2,
  "en-US": 12,
} as const;

interface UseAppMappingDerivedStateParams {
  candidates: ObservedAppCandidate[];
  webDomainCandidates: ObservedWebDomainCandidate[];
  iconThemeColors: Record<string, string>;
  draftOverrides: ClassificationDraftState["overrides"];
  draftWebDomainOverrides: ClassificationDraftState["webDomainOverrides"];
  draftCategoryColorOverrides: ClassificationDraftState["categoryColorOverrides"];
  draftCustomCategories: ClassificationDraftState["customCategories"];
  draftDeletedCategories: ClassificationDraftState["deletedCategories"];
  editingNameExe: string | null;
  nameEditSnapshots: Record<string, AppOverride | null>;
  editingWebDomain: string | null;
  webNameEditSnapshots: Record<string, WebDomainOverride | null>;
  filter: CandidateFilter;
  searchQuery: string;
  webActivityEnabled: boolean;
}

export function normalizeCustomCategoryInput(input: string) {
  const language = getUiTextLanguage();
  const limit = CUSTOM_CATEGORY_NAME_LIMITS[language] ?? CUSTOM_CATEGORY_NAME_LIMITS["zh-CN"];
  const normalized = input.trim().replace(/\s+/g, " ");
  const value = language === "en-US" ? normalized.split(" ")[0] ?? "" : normalized;
  return Array.from(value).slice(0, limit).join("");
}

export function cloneObservedWebDomainCandidates(
  observed: ObservedWebDomainCandidate[],
): ObservedWebDomainCandidate[] {
  return observed.map((candidate) => ({ ...candidate }));
}

export function resolveUserAssignableCategory(
  category: AppCategory | undefined,
): UserAssignableAppCategory {
  if (category && (isCustomCategory(category) || USER_ASSIGNABLE_CATEGORY_SET.has(category))) {
    return category as UserAssignableAppCategory;
  }
  return "other";
}

function stableDomainColor(normalizedDomain: string) {
  const palette = [
    "#36AC7E",
    "#4790CF",
    "#6F7AE6",
    "#B07E55",
    "#35A69E",
    "#C56A73",
    "#8C6FA1",
  ];
  let hash = 0;
  for (const char of normalizedDomain) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

export function useAppMappingDerivedState({
  candidates,
  webDomainCandidates,
  iconThemeColors,
  draftOverrides,
  draftWebDomainOverrides,
  draftCategoryColorOverrides,
  draftCustomCategories,
  draftDeletedCategories,
  editingNameExe,
  nameEditSnapshots,
  editingWebDomain,
  webNameEditSnapshots,
  filter,
  searchQuery,
  webActivityEnabled,
}: UseAppMappingDerivedStateParams) {
  const webDomainIcons = useMemo(() => {
    if (!webActivityEnabled) return {};

    const next: Record<string, string> = {};
    for (const candidate of webDomainCandidates) {
      const faviconUrl = candidate.faviconUrl?.trim();
      if (faviconUrl) {
        next[candidate.normalizedDomain] = faviconUrl;
      }
    }
    return next;
  }, [webActivityEnabled, webDomainCandidates]);
  const webDomainIconThemeColors = useIconThemeColors(webDomainIcons);

  const resolveCategoryColor = useCallback((category: AppCategory) => (
    draftCategoryColorOverrides[category] ?? AppClassification.getCategoryColor(category)
  ), [draftCategoryColorOverrides]);

  const resolveAutoDisplayName = useCallback((candidate: ObservedAppCandidate) => {
    const appName = candidate.appName.trim();
    return appName || fallbackDisplayName(candidate.exeName) || candidate.exeName;
  }, []);

  const resolveMappedCategory = useCallback((candidate: ObservedAppCandidate): UserAssignableAppCategory => {
    const mapped = AppClassification.mapDefaultApp(candidate.exeName, { appName: candidate.appName });
    const overrideCategory = draftOverrides[candidate.exeName]?.category;
    return resolveUserAssignableCategory(overrideCategory ?? mapped.category);
  }, [draftOverrides]);

  const resolveEffectiveDisplayName = useCallback((candidate: ObservedAppCandidate) => {
    const mapped = AppClassification.mapDefaultApp(candidate.exeName, { appName: candidate.appName });
    return draftOverrides[candidate.exeName]?.displayName?.trim()
      || mapped.name
      || resolveAutoDisplayName(candidate);
  }, [draftOverrides, resolveAutoDisplayName]);

  const resolveDisplayNameFromOverride = useCallback((
    candidate: ObservedAppCandidate,
    override: AppOverride | null,
  ) => {
    const mapped = AppClassification.mapDefaultApp(candidate.exeName, { appName: candidate.appName });
    return override?.displayName?.trim()
      || mapped.name
      || resolveAutoDisplayName(candidate);
  }, [resolveAutoDisplayName]);

  const resolveSortDisplayName = useCallback((candidate: ObservedAppCandidate) => {
    if (editingNameExe !== candidate.exeName) {
      return resolveEffectiveDisplayName(candidate);
    }
    const snapshot = Object.prototype.hasOwnProperty.call(nameEditSnapshots, candidate.exeName)
      ? nameEditSnapshots[candidate.exeName]
      : (draftOverrides[candidate.exeName] ?? null);
    return resolveDisplayNameFromOverride(candidate, snapshot);
  }, [draftOverrides, editingNameExe, nameEditSnapshots, resolveDisplayNameFromOverride, resolveEffectiveDisplayName]);

  const resolveTrackingEnabled = useCallback((candidate: ObservedAppCandidate) => {
    const mapped = AppClassification.mapDefaultApp(candidate.exeName, { appName: candidate.appName });
    const baseCategory = draftOverrides[candidate.exeName]?.category ?? mapped.category;
    return baseCategory !== "system" && draftOverrides[candidate.exeName]?.track !== false;
  }, [draftOverrides]);

  const resolveTitleCaptureEnabled = useCallback((candidate: ObservedAppCandidate) => (
    draftOverrides[candidate.exeName]?.captureTitle !== false
  ), [draftOverrides]);

  const resolveCandidateColor = useCallback((candidate: ObservedAppCandidate) => {
    const overrideColor = draftOverrides[candidate.exeName]?.color;
    if (overrideColor) return overrideColor;
    const mappedCategory = resolveMappedCategory(candidate);
    return iconThemeColors[candidate.exeName] ?? resolveCategoryColor(mappedCategory);
  }, [draftOverrides, iconThemeColors, resolveCategoryColor, resolveMappedCategory]);

  const resolveWebDomainCategory = useCallback((candidate: ObservedWebDomainCandidate): UserAssignableAppCategory => (
    resolveUserAssignableCategory(draftWebDomainOverrides[candidate.normalizedDomain]?.category)
  ), [draftWebDomainOverrides]);

  const resolveWebDomainAutoDisplayName = useCallback((candidate: ObservedWebDomainCandidate) => (
    candidate.domain || candidate.normalizedDomain
  ), []);

  const resolveWebDomainDisplayName = useCallback((candidate: ObservedWebDomainCandidate) => (
    draftWebDomainOverrides[candidate.normalizedDomain]?.displayName?.trim()
      || resolveWebDomainAutoDisplayName(candidate)
  ), [draftWebDomainOverrides, resolveWebDomainAutoDisplayName]);

  const resolveWebDomainDisplayNameFromOverride = useCallback((
    candidate: ObservedWebDomainCandidate,
    override: WebDomainOverride | null,
  ) => (
    override?.displayName?.trim()
      || resolveWebDomainAutoDisplayName(candidate)
  ), [resolveWebDomainAutoDisplayName]);

  const resolveWebDomainSortDisplayName = useCallback((candidate: ObservedWebDomainCandidate) => {
    if (editingWebDomain !== candidate.normalizedDomain) {
      return resolveWebDomainDisplayName(candidate);
    }
    const snapshot = Object.prototype.hasOwnProperty.call(webNameEditSnapshots, candidate.normalizedDomain)
      ? webNameEditSnapshots[candidate.normalizedDomain]
      : (draftWebDomainOverrides[candidate.normalizedDomain] ?? null);
    return resolveWebDomainDisplayNameFromOverride(candidate, snapshot);
  }, [
    draftWebDomainOverrides,
    editingWebDomain,
    resolveWebDomainDisplayName,
    resolveWebDomainDisplayNameFromOverride,
    webNameEditSnapshots,
  ]);

  const resolveWebDomainColor = useCallback((candidate: ObservedWebDomainCandidate) => {
    const override = draftWebDomainOverrides[candidate.normalizedDomain];
    if (override?.color) return override.color;
    const iconColor = webDomainIconThemeColors[candidate.normalizedDomain];
    if (iconColor) return iconColor;
    const category = resolveWebDomainCategory(candidate);
    if (category !== "other") {
      return resolveCategoryColor(category);
    }
    return stableDomainColor(candidate.normalizedDomain);
  }, [draftWebDomainOverrides, resolveCategoryColor, resolveWebDomainCategory, webDomainIconThemeColors]);

  const resolveWebDomainEnabled = useCallback((candidate: ObservedWebDomainCandidate) => (
    draftWebDomainOverrides[candidate.normalizedDomain]?.enabled !== false
  ), [draftWebDomainOverrides]);

  const filteredCandidates = useMemo(
    () => filterAndSortCandidates({
      candidates,
      filter,
      searchQuery,
      resolveMappedCategory,
      resolveEffectiveDisplayName: resolveSortDisplayName,
      resolveCategoryLabel: (category) => AppClassification.getCategoryLabel(category),
    }),
    [candidates, filter, searchQuery, resolveMappedCategory, resolveSortDisplayName],
  );

  const counts = useMemo(() => {
    const all = candidates.length;
    const other = candidates.filter((candidate) => resolveMappedCategory(candidate) === "other").length;
    const classified = Math.max(0, all - other);
    return { all, other, classified };
  }, [candidates, resolveMappedCategory]);

  const filteredWebDomainCandidates = useMemo(() => {
    if (!webActivityEnabled) return [];

    const normalizedQuery = searchQuery.trim().toLocaleLowerCase(getUiTextLanguage());
    return webDomainCandidates
      .filter((candidate) => {
        const category = resolveWebDomainCategory(candidate);
        if (filter === "all") return true;
        if (filter === "other") return category === "other";
        return category !== "other";
      })
      .filter((candidate) => {
        if (!normalizedQuery) return true;
        const category = resolveWebDomainCategory(candidate);
        const categoryLabel = AppClassification.getCategoryLabel(category);
        const haystack = [
          resolveWebDomainSortDisplayName(candidate),
          candidate.domain,
          candidate.normalizedDomain,
          candidate.title ?? "",
          categoryLabel,
          category,
        ].join(" ").toLocaleLowerCase(getUiTextLanguage());
        return haystack.includes(normalizedQuery);
      })
      .sort((left, right) => (
        resolveWebDomainSortDisplayName(left).localeCompare(resolveWebDomainSortDisplayName(right), getUiTextLanguage(), {
          numeric: true,
          sensitivity: "base",
        })
        || left.normalizedDomain.localeCompare(right.normalizedDomain, getUiTextLanguage())
      ));
  }, [
    filter,
    searchQuery,
    resolveWebDomainCategory,
    resolveWebDomainSortDisplayName,
    webActivityEnabled,
    webDomainCandidates,
  ]);

  const webDomainCounts = useMemo(() => {
    if (!webActivityEnabled) return { all: 0, other: 0, classified: 0 };

    const all = webDomainCandidates.length;
    const other = webDomainCandidates.filter((candidate) => resolveWebDomainCategory(candidate) === "other").length;
    const classified = Math.max(0, all - other);
    return { all, other, classified };
  }, [resolveWebDomainCategory, webActivityEnabled, webDomainCandidates]);

  const customCategoryOptions = useMemo(() => {
    const deletedSet = new Set(draftDeletedCategories);
    const categories = new Set<UserAssignableAppCategory>();
    for (const category of draftCustomCategories) {
      if (isCustomCategory(category) && !deletedSet.has(category)) categories.add(category);
    }
    for (const override of Object.values(draftOverrides)) {
      if (override.category && isCustomCategory(override.category) && !deletedSet.has(override.category)) {
        categories.add(override.category);
      }
    }
    for (const override of Object.values(draftWebDomainOverrides)) {
      if (override.category && isCustomCategory(override.category) && !deletedSet.has(override.category)) {
        categories.add(override.category);
      }
    }
    for (const category of Object.keys(draftCategoryColorOverrides)) {
      if (isCustomCategory(category) && !deletedSet.has(category)) categories.add(category);
    }
    return Array.from(categories)
      .sort((a, b) => AppClassification.getCategoryLabel(a).localeCompare(AppClassification.getCategoryLabel(b), "zh-CN"));
  }, [draftCategoryColorOverrides, draftCustomCategories, draftDeletedCategories, draftOverrides, draftWebDomainOverrides]);

  const activeBuiltinCategories = useMemo(
    () => USER_ASSIGNABLE_CATEGORIES.filter((category) => !draftDeletedCategories.includes(category)),
    [draftDeletedCategories],
  );

  const orderedAssignableCategories = useMemo<UserAssignableAppCategory[]>(() => {
    const base = activeBuiltinCategories.filter((category) => category !== "other");
    const hasOther = activeBuiltinCategories.includes("other");
    return hasOther ? [...base, ...customCategoryOptions, "other"] : [...base, ...customCategoryOptions];
  }, [activeBuiltinCategories, customCategoryOptions]);

  const candidateCategoryOptions = useMemo(
    () => orderedAssignableCategories.map((category) => ({
      value: category,
      label: AppClassification.getCategoryLabel(category),
    })),
    [orderedAssignableCategories],
  );

  const categoryControlCategories = useMemo<AppCategory[]>(() => {
    const manageable = [
      ...activeBuiltinCategories.filter((category) => category !== "other"),
      ...customCategoryOptions,
    ];
    return [...manageable]
      .sort((a, b) => AppClassification.getCategoryLabel(a).localeCompare(
        AppClassification.getCategoryLabel(b),
        "zh-CN",
      ));
  }, [activeBuiltinCategories, customCategoryOptions]);

  return {
    filteredCandidates,
    counts,
    filteredWebDomainCandidates,
    webDomainCounts,
    candidateCategoryOptions,
    categoryControlCategories,
    resolveCategoryColor,
    resolveEffectiveDisplayName,
    resolveCandidateColor,
    resolveMappedCategory,
    resolveTrackingEnabled,
    resolveTitleCaptureEnabled,
    resolveWebDomainDisplayName,
    resolveWebDomainColor,
    resolveWebDomainCategory,
    resolveWebDomainEnabled,
    resolveAutoDisplayName,
    resolveDisplayNameFromOverride,
    resolveWebDomainAutoDisplayName,
    resolveWebDomainDisplayNameFromOverride,
  };
}
