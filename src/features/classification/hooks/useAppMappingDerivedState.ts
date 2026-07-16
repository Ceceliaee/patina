import { useCallback, useMemo } from "react";
import { getUiTextLanguage } from "../../../shared/copy/index.ts";
import { useIconThemeColors } from "../../../shared/hooks/useIconThemeColors";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import {
  isExtendedCategory,
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
const CATEGORY_NAME_LIMITS = {
  cjkCharacters: 6,
  latinWords: 2,
  latinCharacters: 12,
} as const;
const CJK_CHARACTER_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

interface UseAppMappingDerivedStateParams {
  candidates: ObservedAppCandidate[];
  webDomainCandidates: ObservedWebDomainCandidate[];
  iconThemeColors: Record<string, string>;
  draftOverrides: ClassificationDraftState["overrides"];
  draftWebDomainOverrides: ClassificationDraftState["webDomainOverrides"];
  draftCategoryColorOverrides: ClassificationDraftState["categoryColorOverrides"];
  draftCategoryLabelOverrides: ClassificationDraftState["categoryLabelOverrides"];
  draftPersistedCategoryIds: ClassificationDraftState["persistedCategoryIds"];
  draftDeletedCategories: ClassificationDraftState["deletedCategories"];
  editingNameExe: string | null;
  nameEditSnapshots: Record<string, AppOverride | null>;
  editingWebDomain: string | null;
  webNameEditSnapshots: Record<string, WebDomainOverride | null>;
  filter: CandidateFilter;
  searchQuery: string;
  webActivityEnabled: boolean;
}

export function normalizeCategoryNameInput(input: string) {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (CJK_CHARACTER_PATTERN.test(normalized)) {
    return Array.from(normalized).slice(0, CATEGORY_NAME_LIMITS.cjkCharacters).join("");
  }
  const latinValue = normalized.split(" ").slice(0, CATEGORY_NAME_LIMITS.latinWords).join(" ");
  return Array.from(latinValue).slice(0, CATEGORY_NAME_LIMITS.latinCharacters).join("").trimEnd();
}

export function cloneObservedWebDomainCandidates(
  observed: ObservedWebDomainCandidate[],
): ObservedWebDomainCandidate[] {
  return observed.map((candidate) => ({ ...candidate }));
}

export function resolveUserAssignableCategory(
  category: AppCategory | undefined,
): UserAssignableAppCategory {
  if (category && (isExtendedCategory(category) || USER_ASSIGNABLE_CATEGORY_SET.has(category))) {
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
  draftCategoryLabelOverrides,
  draftPersistedCategoryIds,
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

  const resolveCategoryLabel = useCallback((category: AppCategory) => (
    draftCategoryLabelOverrides[category] ?? AppClassification.getCategoryLabel(category)
  ), [draftCategoryLabelOverrides]);

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

  const resolveWebDomainTitleCaptureEnabled = useCallback((candidate: ObservedWebDomainCandidate) => (
    draftWebDomainOverrides[candidate.normalizedDomain]?.captureTitle !== false
  ), [draftWebDomainOverrides]);

  const filteredCandidates = useMemo(
    () => filterAndSortCandidates({
      candidates,
      filter,
      searchQuery,
      resolveMappedCategory,
      resolveTrackingEnabled,
      resolveEffectiveDisplayName: resolveSortDisplayName,
      resolveCategoryLabel,
    }),
    [
      candidates,
      filter,
      searchQuery,
      resolveCategoryLabel,
      resolveMappedCategory,
      resolveSortDisplayName,
      resolveTrackingEnabled,
    ],
  );

  const counts = useMemo(() => {
    const includedCandidates = candidates.filter((candidate) => resolveTrackingEnabled(candidate));
    const all = includedCandidates.length;
    const other = includedCandidates.filter((candidate) => resolveMappedCategory(candidate) === "other").length;
    const excluded = candidates.filter((candidate) => !resolveTrackingEnabled(candidate)).length;
    const classified = Math.max(0, all - other);
    return { all, other, classified, excluded };
  }, [candidates, resolveMappedCategory, resolveTrackingEnabled]);

  const filteredWebDomainCandidates = useMemo(() => {
    if (!webActivityEnabled) return [];

    const normalizedQuery = searchQuery.trim().toLocaleLowerCase(getUiTextLanguage());
    return webDomainCandidates
      .filter((candidate) => {
        const category = resolveWebDomainCategory(candidate);
        const recordingEnabled = resolveWebDomainEnabled(candidate);
        if (filter === "excluded") return !recordingEnabled;
        if (!recordingEnabled) return false;
        if (filter === "all") return true;
        if (filter === "other") return category === "other";
        return category !== "other";
      })
      .filter((candidate) => {
        if (!normalizedQuery) return true;
        const category = resolveWebDomainCategory(candidate);
        const categoryLabel = resolveCategoryLabel(category);
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
    resolveWebDomainEnabled,
    resolveCategoryLabel,
    resolveWebDomainSortDisplayName,
    webActivityEnabled,
    webDomainCandidates,
  ]);

  const webDomainCounts = useMemo(() => {
    if (!webActivityEnabled) return { all: 0, other: 0, classified: 0, excluded: 0 };

    const includedCandidates = webDomainCandidates.filter((candidate) => resolveWebDomainEnabled(candidate));
    const all = includedCandidates.length;
    const other = includedCandidates.filter((candidate) => resolveWebDomainCategory(candidate) === "other").length;
    const excluded = webDomainCandidates.filter((candidate) => !resolveWebDomainEnabled(candidate)).length;
    const classified = Math.max(0, all - other);
    return { all, other, classified, excluded };
  }, [resolveWebDomainCategory, resolveWebDomainEnabled, webActivityEnabled, webDomainCandidates]);

  const extendedCategoryOptions = useMemo(() => {
    const deletedSet = new Set(draftDeletedCategories);
    const categories = new Set<UserAssignableAppCategory>();
    for (const category of draftPersistedCategoryIds) {
      if (isExtendedCategory(category) && !deletedSet.has(category)) categories.add(category);
    }
    for (const override of Object.values(draftOverrides)) {
      if (override.category && isExtendedCategory(override.category) && !deletedSet.has(override.category)) {
        categories.add(override.category);
      }
    }
    for (const override of Object.values(draftWebDomainOverrides)) {
      if (override.category && isExtendedCategory(override.category) && !deletedSet.has(override.category)) {
        categories.add(override.category);
      }
    }
    for (const category of Object.keys(draftCategoryColorOverrides)) {
      if (isExtendedCategory(category) && !deletedSet.has(category)) categories.add(category);
    }
    return Array.from(categories)
      .sort((a, b) => resolveCategoryLabel(a).localeCompare(resolveCategoryLabel(b), "zh-CN"));
  }, [
    draftCategoryColorOverrides,
    draftPersistedCategoryIds,
    draftDeletedCategories,
    draftOverrides,
    draftWebDomainOverrides,
    resolveCategoryLabel,
  ]);

  const activeSeededCategories = useMemo(
    () => USER_ASSIGNABLE_CATEGORIES.filter((category) => !draftDeletedCategories.includes(category)),
    [draftDeletedCategories],
  );

  const orderedAssignableCategories = useMemo<UserAssignableAppCategory[]>(() => {
    const base = activeSeededCategories.filter((category) => category !== "other");
    const hasOther = activeSeededCategories.includes("other");
    return hasOther ? [...base, ...extendedCategoryOptions, "other"] : [...base, ...extendedCategoryOptions];
  }, [activeSeededCategories, extendedCategoryOptions]);

  const candidateCategoryOptions = useMemo(
    () => orderedAssignableCategories.map((category) => ({
      value: category,
      label: resolveCategoryLabel(category),
    })),
    [orderedAssignableCategories, resolveCategoryLabel],
  );

  const categoryControlCategories = useMemo<AppCategory[]>(() => {
    const manageable = [
      ...activeSeededCategories.filter((category) => category !== "other"),
      ...extendedCategoryOptions,
    ];
    return [...manageable]
      .sort((a, b) => resolveCategoryLabel(a).localeCompare(
        resolveCategoryLabel(b),
        "zh-CN",
      ));
  }, [activeSeededCategories, extendedCategoryOptions, resolveCategoryLabel]);

  return {
    filteredCandidates,
    counts,
    filteredWebDomainCandidates,
    webDomainCounts,
    candidateCategoryOptions,
    categoryControlCategories,
    resolveCategoryColor,
    resolveCategoryLabel,
    resolveEffectiveDisplayName,
    resolveCandidateColor,
    resolveMappedCategory,
    resolveTrackingEnabled,
    resolveTitleCaptureEnabled,
    resolveWebDomainDisplayName,
    resolveWebDomainColor,
    resolveWebDomainCategory,
    resolveWebDomainEnabled,
    resolveWebDomainTitleCaptureEnabled,
    resolveAutoDisplayName,
    resolveDisplayNameFromOverride,
    resolveWebDomainAutoDisplayName,
    resolveWebDomainDisplayNameFromOverride,
  };
}
