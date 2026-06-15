import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getUiTextLanguage, UI_TEXT } from "../../../shared/copy/uiText.ts";
import { useIconThemeColors } from "../../../shared/hooks/useIconThemeColors";
import { useQuietDialogs } from "../../../shared/hooks/useQuietDialogs";
import type { ColorDisplayFormat } from "../../../shared/lib/colorFormatting";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import {
  ClassificationService,
  type AppOverride,
  type ClassificationDraftState,
} from "../services/classificationService";
import { cloneClassificationDraftState } from "../services/classificationDraftState.ts";
import {
  getClassificationBootstrapCache,
  setClassificationBootstrapCache,
} from "../services/classificationBootstrapCache";
import type { CandidateFilter, ObservedAppCandidate } from "../types";
import {
  buildAppMappingCategoryOverride,
  buildAppMappingOverride,
  buildWebDomainCategoryOverride,
  buildWebDomainMappingOverride,
  cloneObservedCandidates,
  createAppMappingDraftState,
  fallbackDisplayName,
  filterAndSortCandidates,
} from "./appMappingStateHelpers.ts";
import {
  cancelAppMappingNameEdit,
  cancelWebDomainNameEdit,
  deleteObservedCandidateSessionsWithDeps,
  saveAppMappingStateWithDeps,
  startAppMappingNameEdit,
  startWebDomainNameEdit,
  syncAppMappingNameDraft,
  syncWebDomainNameDraft,
} from "./appMappingInteractions.ts";
import {
  buildCustomCategory,
  isCustomCategory,
  USER_ASSIGNABLE_CATEGORIES,
  type AppCategory,
  type UserAssignableAppCategory,
} from "../../../shared/classification/categoryTokens";
import type {
  ObservedWebDomainCandidate,
  WebDomainOverride,
} from "../../../shared/types/webActivity.ts";

const CATEGORY_OPTIONS: UserAssignableAppCategory[] = USER_ASSIGNABLE_CATEGORIES;
const USER_ASSIGNABLE_CATEGORY_SET = new Set<string>(USER_ASSIGNABLE_CATEGORIES);
const CUSTOM_CATEGORY_NAME_LIMITS = {
  "zh-CN": 2,
  "en-US": 12,
} as const;

function normalizeCustomCategoryInput(input: string) {
  const language = getUiTextLanguage();
  const limit = CUSTOM_CATEGORY_NAME_LIMITS[language] ?? CUSTOM_CATEGORY_NAME_LIMITS["zh-CN"];
  const normalized = input.trim().replace(/\s+/g, " ");
  const value = language === "en-US" ? normalized.split(" ")[0] ?? "" : normalized;
  return Array.from(value).slice(0, limit).join("");
}

function cloneObservedWebDomainCandidates(observed: ObservedWebDomainCandidate[]): ObservedWebDomainCandidate[] {
  return observed.map((candidate) => ({ ...candidate }));
}

function resolveUserAssignableCategory(category: AppCategory | undefined): UserAssignableAppCategory {
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

export interface UseAppMappingStateOptions {
  icons: Record<string, string>;
  onDirtyChange?: (dirty: boolean) => void;
  onOverridesChanged?: () => void;
  onSessionsDeleted?: () => void;
  onRegisterSaveHandler?: (handler: (() => Promise<boolean>) | null) => void;
}

export function useAppMappingState({
  icons,
  onDirtyChange,
  onOverridesChanged,
  onSessionsDeleted,
  onRegisterSaveHandler,
}: UseAppMappingStateOptions) {
  const { confirm, prompt, dialogs } = useQuietDialogs();
  const initialBootstrap = getClassificationBootstrapCache();
  const initialBootstrapRef = useRef(initialBootstrap);
  const [loading, setLoading] = useState(() => !initialBootstrap);
  const [candidates, setCandidates] = useState<ObservedAppCandidate[]>(
    () => cloneObservedCandidates(initialBootstrap?.observed ?? []),
  );
  const [webDomainCandidates, setWebDomainCandidates] = useState<ObservedWebDomainCandidate[]>(
    () => cloneObservedWebDomainCandidates(initialBootstrap?.observedWebDomains ?? []),
  );
  const [savedState, setSavedState] = useState<ClassificationDraftState | null>(
    () => (initialBootstrap ? createAppMappingDraftState(initialBootstrap) : null),
  );
  const [draftState, setDraftState] = useState<ClassificationDraftState | null>(
    () => (initialBootstrap ? createAppMappingDraftState(initialBootstrap) : null),
  );
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [nameEditSnapshots, setNameEditSnapshots] = useState<Record<string, AppOverride | null>>({});
  const [editingNameExe, setEditingNameExe] = useState<string | null>(null);
  const [webNameDrafts, setWebNameDrafts] = useState<Record<string, string>>({});
  const [webNameEditSnapshots, setWebNameEditSnapshots] = useState<Record<string, WebDomainOverride | null>>({});
  const [editingWebDomain, setEditingWebDomain] = useState<string | null>(null);
  const [filter, setFilter] = useState<CandidateFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [saving, setSaving] = useState(false);
  const [deletingSessionsExe, setDeletingSessionsExe] = useState<string | null>(null);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [colorFormat, setColorFormat] = useState<ColorDisplayFormat>("hex");
  const iconThemeColors = useIconThemeColors(icons);
  const webDomainIcons = useMemo(() => {
    const next: Record<string, string> = {};
    for (const candidate of webDomainCandidates) {
      const faviconUrl = candidate.faviconUrl?.trim();
      if (faviconUrl) {
        next[candidate.normalizedDomain] = faviconUrl;
      }
    }
    return next;
  }, [webDomainCandidates]);
  const webDomainIconThemeColors = useIconThemeColors(webDomainIcons);
  const skipNextNameBlurExeRef = useRef<string | null>(null);
  const skipNextWebNameBlurDomainRef = useRef<string | null>(null);
  const hasUnsavedChangesRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const hadCacheAtStart = Boolean(initialBootstrapRef.current);
      if (!hadCacheAtStart) {
        setLoading(true);
      }
      try {
        const bootstrap = await ClassificationService.loadClassificationBootstrap();
        const nextObserved = cloneObservedCandidates(bootstrap.observed);
        const nextWebDomainCandidates = cloneObservedWebDomainCandidates(bootstrap.observedWebDomains);
        const nextState = createAppMappingDraftState(bootstrap);
        setClassificationBootstrapCache(bootstrap);
        if (cancelled) return;
        setCandidates(nextObserved);
        setWebDomainCandidates(nextWebDomainCandidates);
        if (!hasUnsavedChangesRef.current) {
          setSavedState(cloneClassificationDraftState(nextState));
          setDraftState(cloneClassificationDraftState(nextState));
          setNameEditSnapshots({});
          setEditingNameExe(null);
          setWebNameEditSnapshots({});
          setEditingWebDomain(null);
          skipNextNameBlurExeRef.current = null;
          skipNextWebNameBlurDomainRef.current = null;
        }
      } catch (error) {
        console.error("load app mapping bootstrap failed", error);
      } finally {
        if (!cancelled && !hadCacheAtStart) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const draftOverrides = draftState?.overrides ?? {};
  const draftWebDomainOverrides = draftState?.webDomainOverrides ?? {};
  const draftCategoryColorOverrides = draftState?.categoryColorOverrides ?? {};
  const draftCustomCategories = draftState?.customCategories ?? [];
  const draftDeletedCategories = draftState?.deletedCategories ?? [];

  const hasUnsavedChanges = (() => {
    if (!savedState || !draftState) return false;
    return ClassificationService.hasDraftChanges(savedState, draftState);
  })();

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => () => {
    onDirtyChange?.(false);
  }, [onDirtyChange]);

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
    webDomainCandidates,
  ]);

  const webDomainCounts = useMemo(() => {
    const all = webDomainCandidates.length;
    const other = webDomainCandidates.filter((candidate) => resolveWebDomainCategory(candidate) === "other").length;
    const classified = Math.max(0, all - other);
    return { all, other, classified };
  }, [resolveWebDomainCategory, webDomainCandidates]);

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
    () => CATEGORY_OPTIONS.filter((category) => !draftDeletedCategories.includes(category)),
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

  const refreshCandidates = useCallback(async () => {
    const observed = await ClassificationService.loadObservedAppCandidates();
    setCandidates(observed);
    if (savedState) {
      setClassificationBootstrapCache({
        observed: cloneObservedCandidates(observed),
        observedWebDomains: cloneObservedWebDomainCandidates(webDomainCandidates),
        loadedOverrides: { ...savedState.overrides },
        loadedWebDomainOverrides: { ...savedState.webDomainOverrides },
        loadedCategoryColorOverrides: { ...savedState.categoryColorOverrides },
        loadedCustomCategories: [...savedState.customCategories],
        loadedDeletedCategories: [...savedState.deletedCategories],
      });
    }
    return observed;
  }, [savedState, webDomainCandidates]);

  const refreshWebDomainCandidates = useCallback(async () => {
    const observedWebDomains = await ClassificationService.loadObservedWebDomainCandidates();
    setWebDomainCandidates(observedWebDomains);
    if (savedState) {
      setClassificationBootstrapCache({
        observed: cloneObservedCandidates(candidates),
        observedWebDomains: cloneObservedWebDomainCandidates(observedWebDomains),
        loadedOverrides: { ...savedState.overrides },
        loadedWebDomainOverrides: { ...savedState.webDomainOverrides },
        loadedCategoryColorOverrides: { ...savedState.categoryColorOverrides },
        loadedCustomCategories: [...savedState.customCategories],
        loadedDeletedCategories: [...savedState.deletedCategories],
      });
    }
    return observedWebDomains;
  }, [candidates, savedState]);

  const updateOverride = useCallback((exeName: string, nextOverride: AppOverride | null) => {
    setDraftState((current) => {
      if (!current) return current;
      const nextOverrides = { ...current.overrides };
      if (!nextOverride) delete nextOverrides[exeName];
      else nextOverrides[exeName] = nextOverride;
      return { ...current, overrides: nextOverrides };
    });
  }, []);

  const updateWebDomainOverride = useCallback((normalizedDomain: string, nextOverride: WebDomainOverride | null) => {
    setDraftState((current) => {
      if (!current) return current;
      const nextOverrides = { ...current.webDomainOverrides };
      if (!nextOverride) delete nextOverrides[normalizedDomain];
      else nextOverrides[normalizedDomain] = nextOverride;
      return { ...current, webDomainOverrides: nextOverrides };
    });
  }, []);

  const applyCategoryColor = useCallback((category: AppCategory, colorValue: string | null) => {
    setDraftState((current) => {
      if (!current) return current;
      const next = { ...current.categoryColorOverrides };
      if (!colorValue) delete next[category];
      else next[category] = colorValue;
      return { ...current, categoryColorOverrides: next };
    });
  }, []);

  const handleCreateCustomCategory = useCallback(async () => {
    const customCategoryName = await prompt({
      title: UI_TEXT.mapping.createCategoryTitle,
      description: UI_TEXT.mapping.createCategoryDescription,
      placeholder: UI_TEXT.mapping.createCategoryPlaceholder,
    });
    if (!customCategoryName) return;
    const normalized = normalizeCustomCategoryInput(customCategoryName);
    if (!normalized) return;
    const category = buildCustomCategory(normalized);
    setDraftState((current) => {
      if (!current) return current;
      return {
        ...current,
        customCategories: current.customCategories.includes(category)
          ? current.customCategories
          : [...current.customCategories, category],
        deletedCategories: current.deletedCategories.filter((item) => item !== category),
      };
    });
  }, [prompt]);

  const handleDeleteCategory = useCallback(async (category: AppCategory) => {
    if (category === "other") {
      return;
    }
    const categoryLabel = AppClassification.getCategoryLabel(category);
    const confirmed = await confirm({
      title: UI_TEXT.mapping.deleteCategoryTitle,
      description: UI_TEXT.mapping.deleteCategoryDetail(categoryLabel),
      confirmLabel: UI_TEXT.dialog.confirmDanger,
      danger: true,
    });
    if (!confirmed) return;
    setDraftState((current) => {
      if (!current) return current;
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
      if (isCustomCategory(category)) {
        return {
          ...current,
          overrides: nextOverrides,
          webDomainOverrides: nextWebDomainOverrides,
          categoryColorOverrides: nextCategoryColorOverrides,
          customCategories: current.customCategories.filter((item) => item !== category),
          deletedCategories: current.deletedCategories.filter((item) => item !== category),
        };
      }
      return {
        ...current,
        overrides: nextOverrides,
        webDomainOverrides: nextWebDomainOverrides,
        categoryColorOverrides: nextCategoryColorOverrides,
        deletedCategories: Array.from(new Set([...current.deletedCategories, category])),
      };
    });
  }, [confirm]);

  const handleCategoryAssign = useCallback((candidate: ObservedAppCandidate, categoryValue: string) => {
    const current = draftOverrides[candidate.exeName] ?? null;
    const nextOverride = buildAppMappingCategoryOverride(current, categoryValue);
    updateOverride(candidate.exeName, nextOverride);
  }, [draftOverrides, updateOverride]);

  const handleColorAssign = useCallback((candidate: ObservedAppCandidate, colorValue?: string | null) => {
    const current = draftOverrides[candidate.exeName] ?? null;
    const nextOverride = buildAppMappingOverride({
      category: current?.category,
      displayName: current?.displayName,
      color: colorValue ?? undefined,
      track: current?.track !== false,
      captureTitle: current?.captureTitle !== false,
      updatedAt: current?.updatedAt,
    });
    updateOverride(candidate.exeName, nextOverride);
  }, [draftOverrides, updateOverride]);

  const handleWebDomainCategoryAssign = useCallback((candidate: ObservedWebDomainCandidate, categoryValue: string) => {
    const current = draftWebDomainOverrides[candidate.normalizedDomain] ?? null;
    const nextOverride = buildWebDomainCategoryOverride(current, categoryValue);
    updateWebDomainOverride(candidate.normalizedDomain, nextOverride);
  }, [draftWebDomainOverrides, updateWebDomainOverride]);

  const handleWebDomainColorAssign = useCallback((candidate: ObservedWebDomainCandidate, colorValue?: string | null) => {
    const current = draftWebDomainOverrides[candidate.normalizedDomain] ?? null;
    const nextOverride = buildWebDomainMappingOverride({
      category: current?.category,
      displayName: current?.displayName,
      color: colorValue ?? undefined,
      enabled: current?.enabled !== false,
      updatedAt: current?.updatedAt,
    });
    updateWebDomainOverride(candidate.normalizedDomain, nextOverride);
  }, [draftWebDomainOverrides, updateWebDomainOverride]);

  const handleWebDomainTrackingToggle = useCallback((candidate: ObservedWebDomainCandidate, nextEnabled: boolean) => {
    const current = draftWebDomainOverrides[candidate.normalizedDomain] ?? null;
    const nextOverride = buildWebDomainMappingOverride({
      category: current?.category,
      color: current?.color,
      displayName: current?.displayName,
      enabled: nextEnabled,
      updatedAt: current?.updatedAt,
    });
    updateWebDomainOverride(candidate.normalizedDomain, nextOverride);
  }, [draftWebDomainOverrides, updateWebDomainOverride]);

  const syncNameDraftToPageDraft = useCallback((
    candidate: ObservedAppCandidate,
    nextInputValue: string,
    normalizeInputDraft: boolean = false,
  ) => {
    const autoName = resolveAutoDisplayName(candidate);
    setDraftState((current) => {
      if (!current) return current;
      const nextState = syncAppMappingNameDraft({
        draftState: current,
        nameDrafts,
        nameEditSnapshots,
        editingNameExe,
        skipNextNameBlurExe: skipNextNameBlurExeRef.current,
      }, candidate, nextInputValue, autoName, normalizeInputDraft);
      setNameDrafts(nextState.nameDrafts);
      skipNextNameBlurExeRef.current = nextState.skipNextNameBlurExe;
      return nextState.draftState;
    });
  }, [draftOverrides, resolveAutoDisplayName, updateOverride]);

  const syncWebNameDraftToPageDraft = useCallback((
    candidate: ObservedWebDomainCandidate,
    nextInputValue: string,
    normalizeInputDraft: boolean = false,
  ) => {
    const autoName = resolveWebDomainAutoDisplayName(candidate);
    setDraftState((current) => {
      if (!current) return current;
      const nextState = syncWebDomainNameDraft({
        draftState: current,
        webNameDrafts,
        webNameEditSnapshots,
        editingWebDomain,
        skipNextWebNameBlurDomain: skipNextWebNameBlurDomainRef.current,
      }, candidate, nextInputValue, autoName, normalizeInputDraft);
      setWebNameDrafts(nextState.webNameDrafts);
      skipNextWebNameBlurDomainRef.current = nextState.skipNextWebNameBlurDomain;
      return nextState.draftState;
    });
  }, [editingWebDomain, resolveWebDomainAutoDisplayName, webNameDrafts, webNameEditSnapshots]);

  const handleNameCommit = useCallback((candidate: ObservedAppCandidate) => {
    const inputValue = nameDrafts[candidate.exeName] ?? resolveEffectiveDisplayName(candidate);
    syncNameDraftToPageDraft(candidate, inputValue, true);
    setNameEditSnapshots((prev) => {
      const next = { ...prev };
      delete next[candidate.exeName];
      return next;
    });
  }, [nameDrafts, resolveEffectiveDisplayName, syncNameDraftToPageDraft]);

  const handleWebNameCommit = useCallback((candidate: ObservedWebDomainCandidate) => {
    const inputValue = webNameDrafts[candidate.normalizedDomain] ?? resolveWebDomainDisplayName(candidate);
    syncWebNameDraftToPageDraft(candidate, inputValue, true);
    setWebNameEditSnapshots((prev) => {
      const next = { ...prev };
      delete next[candidate.normalizedDomain];
      return next;
    });
  }, [resolveWebDomainDisplayName, syncWebNameDraftToPageDraft, webNameDrafts]);

  const handleNameEditCancel = useCallback((candidate: ObservedAppCandidate) => {
    const snapshot = Object.prototype.hasOwnProperty.call(nameEditSnapshots, candidate.exeName)
      ? nameEditSnapshots[candidate.exeName]
      : (draftOverrides[candidate.exeName] ?? null);
    const nextState = cancelAppMappingNameEdit({
      draftState: draftState ?? savedState ?? {
        overrides: {},
        webDomainOverrides: {},
        categoryColorOverrides: {},
        customCategories: [],
        deletedCategories: [],
      },
      nameDrafts,
      nameEditSnapshots,
      editingNameExe,
      skipNextNameBlurExe: skipNextNameBlurExeRef.current,
    }, candidate, resolveDisplayNameFromOverride(candidate, snapshot));
    skipNextNameBlurExeRef.current = nextState.skipNextNameBlurExe;
    setDraftState(nextState.draftState);
    setNameDrafts(nextState.nameDrafts);
    setNameEditSnapshots(nextState.nameEditSnapshots);
    setEditingNameExe(nextState.editingNameExe);
  }, [draftOverrides, draftState, editingNameExe, nameDrafts, nameEditSnapshots, resolveDisplayNameFromOverride, savedState]);

  const handleWebNameEditCancel = useCallback((candidate: ObservedWebDomainCandidate) => {
    const snapshot = Object.prototype.hasOwnProperty.call(webNameEditSnapshots, candidate.normalizedDomain)
      ? webNameEditSnapshots[candidate.normalizedDomain]
      : (draftWebDomainOverrides[candidate.normalizedDomain] ?? null);
    const nextState = cancelWebDomainNameEdit({
      draftState: draftState ?? savedState ?? {
        overrides: {},
        webDomainOverrides: {},
        categoryColorOverrides: {},
        customCategories: [],
        deletedCategories: [],
      },
      webNameDrafts,
      webNameEditSnapshots,
      editingWebDomain,
      skipNextWebNameBlurDomain: skipNextWebNameBlurDomainRef.current,
    }, candidate, resolveWebDomainDisplayNameFromOverride(candidate, snapshot));
    skipNextWebNameBlurDomainRef.current = nextState.skipNextWebNameBlurDomain;
    setDraftState(nextState.draftState);
    setWebNameDrafts(nextState.webNameDrafts);
    setWebNameEditSnapshots(nextState.webNameEditSnapshots);
    setEditingWebDomain(nextState.editingWebDomain);
  }, [
    draftState,
    draftWebDomainOverrides,
    editingWebDomain,
    resolveWebDomainDisplayNameFromOverride,
    savedState,
    webNameDrafts,
    webNameEditSnapshots,
  ]);

  const startNameEdit = useCallback((candidate: ObservedAppCandidate) => {
    const displayName = resolveEffectiveDisplayName(candidate);
    const baseDraftState = draftState ?? savedState;
    if (!baseDraftState) {
      return;
    }
    const nextState = startAppMappingNameEdit({
      draftState: baseDraftState,
      nameDrafts,
      nameEditSnapshots,
      editingNameExe,
      skipNextNameBlurExe: skipNextNameBlurExeRef.current,
    }, candidate, displayName);
    skipNextNameBlurExeRef.current = nextState.skipNextNameBlurExe;
    setNameEditSnapshots(nextState.nameEditSnapshots);
    setEditingNameExe(nextState.editingNameExe);
    setNameDrafts(nextState.nameDrafts);
  }, [draftState, editingNameExe, nameDrafts, nameEditSnapshots, resolveEffectiveDisplayName, savedState]);

  const startWebNameEdit = useCallback((candidate: ObservedWebDomainCandidate) => {
    const displayName = resolveWebDomainDisplayName(candidate);
    const baseDraftState = draftState ?? savedState;
    if (!baseDraftState) {
      return;
    }
    const nextState = startWebDomainNameEdit({
      draftState: baseDraftState,
      webNameDrafts,
      webNameEditSnapshots,
      editingWebDomain,
      skipNextWebNameBlurDomain: skipNextWebNameBlurDomainRef.current,
    }, candidate, displayName);
    skipNextWebNameBlurDomainRef.current = nextState.skipNextWebNameBlurDomain;
    setWebNameEditSnapshots(nextState.webNameEditSnapshots);
    setEditingWebDomain(nextState.editingWebDomain);
    setWebNameDrafts(nextState.webNameDrafts);
  }, [
    draftState,
    editingWebDomain,
    resolveWebDomainDisplayName,
    savedState,
    webNameDrafts,
    webNameEditSnapshots,
  ]);

  const handleDeleteAllSessions = useCallback(async (candidate: ObservedAppCandidate) => {
    const displayName = resolveEffectiveDisplayName(candidate);
    setDeletingSessionsExe(candidate.exeName);
    try {
      const result = await deleteObservedCandidateSessionsWithDeps(candidate, {
        confirmDelete: () => confirm({
          title: UI_TEXT.mapping.deleteAppSessionsTitle,
          description: UI_TEXT.mapping.deleteAppSessionsDetail(displayName),
          confirmLabel: UI_TEXT.dialog.confirmDanger,
          danger: true,
        }),
        deleteObservedAppSessions: ClassificationService.deleteObservedAppSessions,
        refreshCandidates,
        onSessionsDeleted,
      });
      if (!result.deleted) {
        return;
      }
    } finally {
      setDeletingSessionsExe(null);
    }
  }, [confirm, onSessionsDeleted, refreshCandidates, resolveEffectiveDisplayName]);

  const handleDeleteWebDomainHistory = useCallback(async (candidate: ObservedWebDomainCandidate) => {
    const displayName = resolveWebDomainDisplayName(candidate);
    setDeletingSessionsExe(candidate.normalizedDomain);
    try {
      const confirmed = await confirm({
        title: UI_TEXT.mapping.deleteWebDomainHistoryTitle,
        description: UI_TEXT.mapping.deleteWebDomainHistoryDetail(displayName),
        confirmLabel: UI_TEXT.dialog.confirmDanger,
        danger: true,
      });
      if (!confirmed) {
        return;
      }
      await ClassificationService.deleteObservedWebDomainHistory(candidate.normalizedDomain);
      await refreshWebDomainCandidates();
      onSessionsDeleted?.();
    } finally {
      setDeletingSessionsExe(null);
    }
  }, [confirm, onSessionsDeleted, refreshWebDomainCandidates, resolveWebDomainDisplayName]);

  const handleTrackingToggle = useCallback((candidate: ObservedAppCandidate, nextTrack: boolean) => {
    const current = draftOverrides[candidate.exeName] ?? null;
    const nextOverride = buildAppMappingOverride({
      category: current?.category,
      color: current?.color,
      displayName: current?.displayName,
      track: nextTrack,
      captureTitle: current?.captureTitle !== false,
      updatedAt: current?.updatedAt,
    });
    updateOverride(candidate.exeName, nextOverride);
  }, [draftOverrides, updateOverride]);

  const handleTitleCaptureToggle = useCallback((candidate: ObservedAppCandidate, nextCaptureTitle: boolean) => {
    const current = draftOverrides[candidate.exeName] ?? null;
    const nextOverride = buildAppMappingOverride({
      category: current?.category,
      color: current?.color,
      displayName: current?.displayName,
      track: current?.track !== false,
      captureTitle: nextCaptureTitle,
      updatedAt: current?.updatedAt,
    });
    updateOverride(candidate.exeName, nextOverride);
  }, [draftOverrides, updateOverride]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!savedState || !draftState) return false;
    if (!hasUnsavedChanges) return true;
    if (saving) return false;
    setSaving(true);
    setSaveStatus("saving");
    try {
      const result = await saveAppMappingStateWithDeps({
        savedState,
        draftState,
        candidates,
        webDomainCandidates,
        hasUnsavedChanges,
        saving,
      }, {
        commitDraftChanges: ClassificationService.commitDraftChanges,
      });
      if (result.nextSavedState) {
        setSavedState(result.nextSavedState);
      }
      if (result.nextDraftState) {
        setDraftState(result.nextDraftState);
      }
      if (result.nextBootstrap) {
        setClassificationBootstrapCache(result.nextBootstrap);
      }
      if (result.resetEditingState) {
        setNameEditSnapshots({});
        setEditingNameExe(null);
        setWebNameEditSnapshots({});
        setEditingWebDomain(null);
        skipNextNameBlurExeRef.current = null;
        skipNextWebNameBlurDomainRef.current = null;
        onOverridesChanged?.();
      }
      setSaveStatus(result.nextSaveStatus);
      if (result.nextSaveStatus === "saved") {
        window.setTimeout(() => setSaveStatus("idle"), 1800);
      }
      if (!result.accepted && !result.skippedReason) {
        if (result.error) {
          console.error("save app mapping failed", result.error);
        }
      }
      return result.accepted;
    } catch (error) {
      console.error("save app mapping failed", error);
      setSaveStatus("idle");
      return false;
    } finally {
      setSaving(false);
    }
  }, [candidates, draftState, hasUnsavedChanges, onOverridesChanged, savedState, saving, webDomainCandidates]);

  useEffect(() => {
    onRegisterSaveHandler?.(handleSave);
    return () => {
      onRegisterSaveHandler?.(null);
    };
  }, [handleSave, onRegisterSaveHandler]);

  const handleCancel = useCallback(() => {
    if (!savedState || !hasUnsavedChanges || saving) return;
    setDraftState(savedState);
    setNameDrafts({});
    setNameEditSnapshots({});
    setEditingNameExe(null);
    setWebNameDrafts({});
    setWebNameEditSnapshots({});
    setEditingWebDomain(null);
    skipNextNameBlurExeRef.current = null;
    skipNextWebNameBlurDomainRef.current = null;
    setSaveStatus("idle");
  }, [hasUnsavedChanges, savedState, saving]);

  const handleNameBlur = useCallback((candidate: ObservedAppCandidate) => {
    if (skipNextNameBlurExeRef.current === candidate.exeName) {
      skipNextNameBlurExeRef.current = null;
      return;
    }
    handleNameCommit(candidate);
    setEditingNameExe((prev) => (prev === candidate.exeName ? null : prev));
  }, [handleNameCommit]);

  const handleWebNameBlur = useCallback((candidate: ObservedWebDomainCandidate) => {
    if (skipNextWebNameBlurDomainRef.current === candidate.normalizedDomain) {
      skipNextWebNameBlurDomainRef.current = null;
      return;
    }
    handleWebNameCommit(candidate);
    setEditingWebDomain((prev) => (prev === candidate.normalizedDomain ? null : prev));
  }, [handleWebNameCommit]);

  return {
    dialogs,
    loading,
    draftState,
    savedState,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
    counts,
    webDomainCounts,
    saveStatus,
    saving,
    hasUnsavedChanges,
    handleCancel,
    handleSave,
    filteredCandidates,
    filteredWebDomainCandidates,
    showCategoryDialog,
    setShowCategoryDialog,
    colorFormat,
    setColorFormat,
    categoryControlCategories,
    candidateCategoryOptions,
    resolveCategoryColor,
    handleCreateCustomCategory,
    handleDeleteCategory,
    resolveEffectiveDisplayName,
    resolveCandidateColor,
    resolveMappedCategory,
    resolveTrackingEnabled,
    resolveTitleCaptureEnabled,
    resolveWebDomainDisplayName,
    resolveWebDomainColor,
    resolveWebDomainCategory,
    resolveWebDomainEnabled,
    deletingSessionsExe,
    editingNameExe,
    nameDrafts,
    editingWebDomain,
    webNameDrafts,
    draftOverrides,
    syncNameDraftToPageDraft,
    handleNameBlur,
    handleNameEditCancel,
    startNameEdit,
    syncWebNameDraftToPageDraft,
    handleWebNameBlur,
    handleWebNameEditCancel,
    startWebNameEdit,
    handleColorAssign,
    handleCategoryAssign,
    handleWebDomainColorAssign,
    handleWebDomainCategoryAssign,
    handleWebDomainTrackingToggle,
    handleTitleCaptureToggle,
    handleTrackingToggle,
    handleDeleteAllSessions,
    handleDeleteWebDomainHistory,
    applyCategoryColor,
  };
}
