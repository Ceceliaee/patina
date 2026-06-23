import { useCallback, useEffect, useRef, useState } from "react";
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
  buildAppMappingCategoryOverride,
  buildAppMappingOverride,
  buildWebDomainCategoryOverride,
  buildWebDomainMappingOverride,
  cloneObservedCandidates,
  createAppMappingDraftState,
  deleteCategoryFromDraftState,
  updateAppOverrideInDraftState,
  updateCategoryColorInDraftState,
  updateWebDomainOverrideInDraftState,
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
  type AppCategory,
} from "../../../shared/classification/categoryTokens";
import type {
  ObservedWebDomainCandidate,
  WebDomainOverride,
} from "../../../shared/types/webActivity.ts";
import {
  cloneObservedWebDomainCandidates,
  normalizeCustomCategoryInput,
  useAppMappingDerivedState,
} from "./useAppMappingDerivedState.ts";


export interface UseAppMappingStateOptions {
  icons: Record<string, string>;
  onDirtyChange?: (dirty: boolean) => void;
  onOverridesChanged?: () => void;
  onSessionsDeleted?: () => void;
  onRegisterSaveHandler?: (handler: (() => Promise<boolean>) | null) => void;
  webActivityEnabled?: boolean;
}

export function useAppMappingState({
  icons,
  onDirtyChange,
  onOverridesChanged,
  onSessionsDeleted,
  onRegisterSaveHandler,
  webActivityEnabled = false,
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

  const {
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
  } = useAppMappingDerivedState({
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
  });

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
      return updateAppOverrideInDraftState(current, exeName, nextOverride);
    });
  }, []);

  const updateWebDomainOverride = useCallback((normalizedDomain: string, nextOverride: WebDomainOverride | null) => {
    setDraftState((current) => {
      if (!current) return current;
      return updateWebDomainOverrideInDraftState(current, normalizedDomain, nextOverride);
    });
  }, []);

  const applyCategoryColor = useCallback((category: AppCategory, colorValue: string | null) => {
    setDraftState((current) => {
      if (!current) return current;
      return updateCategoryColorInDraftState(current, category, colorValue);
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
      return deleteCategoryFromDraftState(current, category);
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
