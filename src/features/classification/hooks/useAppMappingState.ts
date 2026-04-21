import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UI_TEXT } from "../../../shared/copy/uiText.ts";
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
  AUTO_CATEGORY_VALUE,
  buildAppMappingOverride,
  cloneObservedCandidates,
  createAppMappingDraftState,
  fallbackDisplayName,
  filterAndSortCandidates,
} from "./appMappingStateHelpers.ts";
import {
  cancelAppMappingNameEdit,
  deleteObservedCandidateSessionsWithDeps,
  saveAppMappingStateWithDeps,
  startAppMappingNameEdit,
  syncAppMappingNameDraft,
} from "./appMappingInteractions.ts";
import {
  buildCustomCategory,
  isCustomCategory,
  USER_ASSIGNABLE_CATEGORIES,
  type AppCategory,
  type UserAssignableAppCategory,
} from "../config/categoryTokens";

const CATEGORY_OPTIONS: UserAssignableAppCategory[] = USER_ASSIGNABLE_CATEGORIES;

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
  const [savedState, setSavedState] = useState<ClassificationDraftState | null>(
    () => (initialBootstrap ? createAppMappingDraftState(initialBootstrap) : null),
  );
  const [draftState, setDraftState] = useState<ClassificationDraftState | null>(
    () => (initialBootstrap ? createAppMappingDraftState(initialBootstrap) : null),
  );
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [nameEditSnapshots, setNameEditSnapshots] = useState<Record<string, AppOverride | null>>({});
  const [editingNameExe, setEditingNameExe] = useState<string | null>(null);
  const [filter, setFilter] = useState<CandidateFilter>("all");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [saving, setSaving] = useState(false);
  const [deletingSessionsExe, setDeletingSessionsExe] = useState<string | null>(null);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [colorFormat, setColorFormat] = useState<ColorDisplayFormat>("hex");
  const iconThemeColors = useIconThemeColors(icons);
  const skipNextNameBlurExeRef = useRef<string | null>(null);
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
        const nextState = createAppMappingDraftState(bootstrap);
        setClassificationBootstrapCache(bootstrap);
        if (cancelled) return;
        setCandidates(nextObserved);
        if (!hasUnsavedChangesRef.current) {
          setSavedState(cloneClassificationDraftState(nextState));
          setDraftState(cloneClassificationDraftState(nextState));
          setNameEditSnapshots({});
          setEditingNameExe(null);
          skipNextNameBlurExeRef.current = null;
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
    const mapped = AppClassification.mapApp(candidate.exeName, { appName: candidate.appName });
    const overrideCategory = draftOverrides[candidate.exeName]?.category;
    const category = overrideCategory ?? mapped.category;
    return category === "system" ? "other" : category;
  }, [draftOverrides]);

  const resolveEffectiveDisplayName = useCallback((candidate: ObservedAppCandidate) => {
    const mapped = AppClassification.mapApp(candidate.exeName, { appName: candidate.appName });
    return draftOverrides[candidate.exeName]?.displayName?.trim()
      || mapped.name
      || resolveAutoDisplayName(candidate);
  }, [draftOverrides, resolveAutoDisplayName]);

  const resolveTrackingEnabled = useCallback((candidate: ObservedAppCandidate) => {
    const mapped = AppClassification.mapApp(candidate.exeName, { appName: candidate.appName });
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

  const filteredCandidates = useMemo(
    () => filterAndSortCandidates({
      candidates,
      filter,
      resolveMappedCategory,
      resolveEffectiveDisplayName,
    }),
    [candidates, filter, resolveEffectiveDisplayName, resolveMappedCategory],
  );

  const counts = useMemo(() => {
    const all = candidates.length;
    const other = candidates.filter((candidate) => resolveMappedCategory(candidate) === "other").length;
    const classified = Math.max(0, all - other);
    return { all, other, classified };
  }, [candidates, resolveMappedCategory]);

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
    for (const category of Object.keys(draftCategoryColorOverrides)) {
      if (isCustomCategory(category) && !deletedSet.has(category)) categories.add(category);
    }
    return Array.from(categories)
      .sort((a, b) => AppClassification.getCategoryLabel(a).localeCompare(AppClassification.getCategoryLabel(b), "zh-CN"));
  }, [draftCategoryColorOverrides, draftCustomCategories, draftDeletedCategories, draftOverrides]);

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
    () => [
      { value: AUTO_CATEGORY_VALUE, label: "自动识别" },
      ...orderedAssignableCategories.map((category) => ({
        value: category,
        label: AppClassification.getCategoryLabel(category),
      })),
    ],
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
        loadedOverrides: { ...savedState.overrides },
        loadedCategoryColorOverrides: { ...savedState.categoryColorOverrides },
        loadedCustomCategories: [...savedState.customCategories],
        loadedDeletedCategories: [...savedState.deletedCategories],
      });
    }
    return observed;
  }, [savedState]);

  const updateOverride = useCallback((exeName: string, nextOverride: AppOverride | null) => {
    setDraftState((current) => {
      if (!current) return current;
      const nextOverrides = { ...current.overrides };
      if (!nextOverride) delete nextOverrides[exeName];
      else nextOverrides[exeName] = nextOverride;
      return { ...current, overrides: nextOverrides };
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
    const normalized = customCategoryName.trim();
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
      const nextCategoryColorOverrides = { ...current.categoryColorOverrides };
      delete nextCategoryColorOverrides[category];
      if (isCustomCategory(category)) {
        return {
          ...current,
          overrides: nextOverrides,
          categoryColorOverrides: nextCategoryColorOverrides,
          customCategories: current.customCategories.filter((item) => item !== category),
          deletedCategories: current.deletedCategories.filter((item) => item !== category),
        };
      }
      return {
        ...current,
        overrides: nextOverrides,
        categoryColorOverrides: nextCategoryColorOverrides,
        deletedCategories: Array.from(new Set([...current.deletedCategories, category])),
      };
    });
  }, [confirm]);

  const handleCategoryAssign = useCallback((candidate: ObservedAppCandidate, categoryValue: string) => {
    const current = draftOverrides[candidate.exeName] ?? null;
    const category = categoryValue === AUTO_CATEGORY_VALUE ? undefined : categoryValue as UserAssignableAppCategory;
    const nextOverride = buildAppMappingOverride({
      category,
      color: current?.color,
      displayName: current?.displayName,
      track: current?.track !== false,
      captureTitle: current?.captureTitle !== false,
      updatedAt: current?.updatedAt,
    });
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

  const resolveDisplayNameFromOverride = useCallback((
    candidate: ObservedAppCandidate,
    override: AppOverride | null,
  ) => {
    const mapped = AppClassification.mapApp(candidate.exeName, { appName: candidate.appName });
    return override?.displayName?.trim()
      || mapped.name
      || resolveAutoDisplayName(candidate);
  }, [resolveAutoDisplayName]);

  const handleNameCommit = useCallback((candidate: ObservedAppCandidate) => {
    const inputValue = nameDrafts[candidate.exeName] ?? resolveEffectiveDisplayName(candidate);
    syncNameDraftToPageDraft(candidate, inputValue, true);
    setNameEditSnapshots((prev) => {
      const next = { ...prev };
      delete next[candidate.exeName];
      return next;
    });
  }, [nameDrafts, resolveEffectiveDisplayName, syncNameDraftToPageDraft]);

  const handleNameEditCancel = useCallback((candidate: ObservedAppCandidate) => {
    const snapshot = Object.prototype.hasOwnProperty.call(nameEditSnapshots, candidate.exeName)
      ? nameEditSnapshots[candidate.exeName]
      : (draftOverrides[candidate.exeName] ?? null);
    const nextState = cancelAppMappingNameEdit({
      draftState: draftState ?? savedState ?? {
        overrides: {},
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

  const handleResetAppOverride = useCallback((candidate: ObservedAppCandidate) => {
    updateOverride(candidate.exeName, null);
    setNameDrafts((prev) => ({ ...prev, [candidate.exeName]: resolveAutoDisplayName(candidate) }));
  }, [resolveAutoDisplayName, updateOverride]);

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
        skipNextNameBlurExeRef.current = null;
        onOverridesChanged?.();
      }
      setSaveStatus(result.nextSaveStatus);
      if (result.nextSaveStatus === "saved") {
        window.setTimeout(() => setSaveStatus("idle"), 1800);
      }
      return result.accepted;
    } catch (error) {
      console.error("save app mapping failed", error);
      setSaveStatus("idle");
      return false;
    } finally {
      setSaving(false);
    }
  }, [candidates, draftState, hasUnsavedChanges, onOverridesChanged, savedState, saving]);

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
    skipNextNameBlurExeRef.current = null;
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

  return {
    dialogs,
    loading,
    draftState,
    savedState,
    filter,
    setFilter,
    counts,
    saveStatus,
    saving,
    hasUnsavedChanges,
    handleCancel,
    handleSave,
    filteredCandidates,
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
    deletingSessionsExe,
    editingNameExe,
    nameDrafts,
    draftOverrides,
    syncNameDraftToPageDraft,
    handleNameBlur,
    handleNameEditCancel,
    startNameEdit,
    handleColorAssign,
    handleCategoryAssign,
    handleTitleCaptureToggle,
    handleTrackingToggle,
    handleResetAppOverride,
    handleDeleteAllSessions,
    applyCategoryColor,
  };
}
