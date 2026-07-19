import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import { useIconThemeColors } from "../../../shared/hooks/useIconThemeColors";
import { useRequestedAppIcons } from "../../../shared/hooks/useRequestedAppIcons.ts";
import { useQuietDialogs } from "../../../shared/hooks/useQuietDialogs";
import type { ColorDisplayFormat } from "../../../shared/lib/colorFormatting";
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
import { loadClassificationIconsForExecutables } from "../services/classificationIconService.ts";
import type { CandidateFilter, ObservedAppCandidate } from "../types";
import {
  buildAppMappingCategoryOverride,
  buildAppMappingOverride,
  buildWebDomainCategoryOverride,
  buildWebDomainMappingOverride,
  cloneObservedCandidates,
  createCategoryInDraftState,
  createAppMappingDraftState,
  deleteCategoryFromDraftState,
  mergeCategoryIntoDraftState,
  updateAppOverrideInDraftState,
  updateCategoryColorInDraftState,
  updateCategoryLabelInDraftState,
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
  createCategoryId,
  getCategoryToken,
  type AppCategory,
  type UserAssignableAppCategory,
} from "../../../shared/classification/categoryTokens";
import type {
  ObservedWebDomainCandidate,
  WebDomainOverride,
} from "../../../shared/types/webActivity.ts";
import {
  cloneObservedWebDomainCandidates,
  normalizeCategoryNameInput,
  useAppMappingDerivedState,
} from "./useAppMappingDerivedState.ts";
import { useClassificationAppCatalog } from "./useClassificationAppCatalog.ts";


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
  const [loadError, setLoadError] = useState(false);
  const [loadRequestVersion, setLoadRequestVersion] = useState(0);
  const [candidates, setCandidates] = useState<ObservedAppCandidate[]>(
    () => cloneObservedCandidates(initialBootstrap?.observed ?? []),
  );
  const [webDomainCandidates, setWebDomainCandidates] = useState<ObservedWebDomainCandidate[]>(
    () => cloneObservedWebDomainCandidates(initialBootstrap?.observedWebDomains ?? []),
  );
  const [bootstrapIcons, setBootstrapIcons] = useState<Record<string, string>>(
    () => initialBootstrap?.icons ?? {},
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
  const skipNextNameBlurExeRef = useRef<string | null>(null);
  const skipNextWebNameBlurDomainRef = useRef<string | null>(null);
  const hasUnsavedChangesRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const hadCacheAtStart = Boolean(initialBootstrapRef.current);
      if (!hadCacheAtStart) {
        setLoading(true);
        setLoadError(false);
      }
      try {
        const bootstrap = await ClassificationService.loadClassificationBootstrap();
        const nextObserved = cloneObservedCandidates(bootstrap.observed);
        const nextWebDomainCandidates = cloneObservedWebDomainCandidates(bootstrap.observedWebDomains);
        const nextState = createAppMappingDraftState(bootstrap);
        const nextBootstrapIcons = bootstrap.icons ?? {};
        setClassificationBootstrapCache(bootstrap);
        if (cancelled) return;
        setLoadError(false);
        setCandidates(nextObserved);
        setWebDomainCandidates(nextWebDomainCandidates);
        setBootstrapIcons(nextBootstrapIcons);
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
        console.warn("load app mapping bootstrap failed", error);
        if (!cancelled && !hadCacheAtStart) {
          setLoadError(true);
        }
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
  }, [loadRequestVersion]);

  const retryLoading = useCallback(() => {
    setLoadRequestVersion((current) => current + 1);
  }, []);

  const draftOverrides = useMemo(() => draftState?.overrides ?? {}, [draftState?.overrides]);
  const draftWebDomainOverrides = useMemo(
    () => draftState?.webDomainOverrides ?? {},
    [draftState?.webDomainOverrides],
  );
  const draftCategoryColorOverrides = useMemo(
    () => draftState?.categoryColorOverrides ?? {},
    [draftState?.categoryColorOverrides],
  );
  const draftCategoryLabelOverrides = useMemo(
    () => draftState?.categoryLabelOverrides ?? {},
    [draftState?.categoryLabelOverrides],
  );
  const draftPersistedCategoryIds = useMemo(
    () => draftState?.persistedCategoryIds ?? [],
    [draftState?.persistedCategoryIds],
  );
  const draftDeletedCategories = useMemo(
    () => draftState?.deletedCategories ?? [],
    [draftState?.deletedCategories],
  );
  const appCatalog = useClassificationAppCatalog({
    enabled: draftState !== null,
    initialCandidates: candidates,
  });
  const candidateIconExeNames = useMemo(
    () => appCatalog.candidates.map((candidate) => candidate.exeName),
    [appCatalog.candidates],
  );
  const baseMappingIcons = useMemo(() => ({
    ...icons,
    ...bootstrapIcons,
  }), [bootstrapIcons, icons]);
  const mappingIcons = useRequestedAppIcons({
    baseIcons: baseMappingIcons,
    exeNames: candidateIconExeNames,
    loadIcons: loadClassificationIconsForExecutables,
    onError: (error) => {
      console.warn("Failed to refresh classification app icons:", error);
    },
  });
  const iconThemeColors = useIconThemeColors(mappingIcons);

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
  } = useAppMappingDerivedState({
    candidates: appCatalog.candidates,
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
  });

  const refreshCandidates = useCallback(async () => {
    const observed = await ClassificationService.loadObservedAppCandidates();
    setCandidates(observed);
    if (savedState) {
      setClassificationBootstrapCache({
        observed: cloneObservedCandidates(observed),
        icons: { ...bootstrapIcons },
        observedWebDomains: cloneObservedWebDomainCandidates(webDomainCandidates),
        loadedOverrides: { ...savedState.overrides },
        loadedWebDomainOverrides: { ...savedState.webDomainOverrides },
        loadedCategoryColorOverrides: { ...savedState.categoryColorOverrides },
        loadedCategoryLabelOverrides: { ...savedState.categoryLabelOverrides },
        loadedPersistedCategoryIds: [...savedState.persistedCategoryIds],
        loadedDeletedCategories: [...savedState.deletedCategories],
      });
    }
    return observed;
  }, [bootstrapIcons, savedState, webDomainCandidates]);

  const refreshWebDomainCandidates = useCallback(async () => {
    const observedWebDomains = await ClassificationService.loadObservedWebDomainCandidates();
    setWebDomainCandidates(observedWebDomains);
    if (savedState) {
      setClassificationBootstrapCache({
        observed: cloneObservedCandidates(candidates),
        icons: { ...bootstrapIcons },
        observedWebDomains: cloneObservedWebDomainCandidates(observedWebDomains),
        loadedOverrides: { ...savedState.overrides },
        loadedWebDomainOverrides: { ...savedState.webDomainOverrides },
        loadedCategoryColorOverrides: { ...savedState.categoryColorOverrides },
        loadedCategoryLabelOverrides: { ...savedState.categoryLabelOverrides },
        loadedPersistedCategoryIds: [...savedState.persistedCategoryIds],
        loadedDeletedCategories: [...savedState.deletedCategories],
      });
    }
    return observedWebDomains;
  }, [bootstrapIcons, candidates, savedState]);

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

  const handleCreateCategory = useCallback(async () => {
    const categoryName = await prompt({
      title: UI_TEXT.mapping.createCategoryTitle,
      description: UI_TEXT.mapping.createCategoryDescription,
      placeholder: UI_TEXT.mapping.createCategoryPlaceholder,
    });
    if (!categoryName) return;
    const normalized = normalizeCategoryNameInput(categoryName);
    if (!normalized) return;
    const duplicateOption = candidateCategoryOptions.find((option) => option.label === normalized);
    if (duplicateOption) return;
    const category = createCategoryId();
    setDraftState((current) => {
      if (!current) return current;
      let nextCategory = category;
      while (current.persistedCategoryIds.includes(nextCategory)) {
        nextCategory = createCategoryId();
      }
      return createCategoryInDraftState(current, nextCategory, normalized);
    });
  }, [candidateCategoryOptions, prompt]);

  const handleDeleteCategory = useCallback(async (category: AppCategory) => {
    if (category === "other") {
      return;
    }
    const categoryLabel = resolveCategoryLabel(category);
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
  }, [confirm, resolveCategoryLabel]);

  const handleRenameCategory = useCallback(async (category: AppCategory) => {
    if (!draftState || category === "other" || category === "system") {
      return;
    }

    const categoryLabel = resolveCategoryLabel(category);
    const categoryName = await prompt({
      title: UI_TEXT.mapping.renameCategoryTitle,
      description: UI_TEXT.mapping.renameCategoryDescription,
      placeholder: UI_TEXT.mapping.renameCategoryPlaceholder,
      initialValue: categoryLabel,
    });
    if (!categoryName) return;

    const normalized = normalizeCategoryNameInput(categoryName);
    if (!normalized) return;
    if (normalized === categoryLabel) return;

    const duplicateOption = candidateCategoryOptions.find((item) => (
      item.value !== category && item.label === normalized
    ));
    if (duplicateOption?.value === "other") return;
    if (duplicateOption) {
      const confirmed = await confirm({
        title: UI_TEXT.mapping.renameCategoryDuplicateTitle,
        description: UI_TEXT.mapping.renameCategoryDuplicateDetail(normalized),
        confirmLabel: UI_TEXT.dialog.confirm,
      });
      if (!confirmed) return;

      setDraftState((current) => {
        if (!current) return current;
        return mergeCategoryIntoDraftState(
          current,
          category,
          duplicateOption.value as UserAssignableAppCategory,
          resolveCategoryColor(category),
        );
      });
      return;
    }

    const defaultLabel = getCategoryToken(category).label;
    const nextLabel = normalized === defaultLabel ? null : normalized;
    setDraftState((current) => {
      if (!current) return current;
      return updateCategoryLabelInDraftState(current, category, nextLabel);
    });
  }, [candidateCategoryOptions, confirm, draftState, prompt, resolveCategoryColor, resolveCategoryLabel]);

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
      captureTitle: current?.captureTitle !== false,
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
      captureTitle: current?.captureTitle !== false,
      updatedAt: current?.updatedAt,
    });
    updateWebDomainOverride(candidate.normalizedDomain, nextOverride);
  }, [draftWebDomainOverrides, updateWebDomainOverride]);

  const handleWebDomainTitleCaptureToggle = useCallback((candidate: ObservedWebDomainCandidate, nextCaptureTitle: boolean) => {
    const current = draftWebDomainOverrides[candidate.normalizedDomain] ?? null;
    const nextOverride = buildWebDomainMappingOverride({
      category: current?.category,
      color: current?.color,
      displayName: current?.displayName,
      enabled: current?.enabled !== false,
      captureTitle: nextCaptureTitle,
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
  }, [editingNameExe, nameDrafts, nameEditSnapshots, resolveAutoDisplayName]);

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
        categoryLabelOverrides: {},
        persistedCategoryIds: [],
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
        categoryLabelOverrides: {},
        persistedCategoryIds: [],
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
        deleteObservedAppSessions: async (exeName, scope) => {
          await ClassificationService.deleteObservedAppSessions(exeName, scope);
        },
        refreshCandidates,
        onSessionsDeleted,
      });
      if (!result.deleted) {
        return;
      }
      setSavedState((current) => (
        current ? updateAppOverrideInDraftState(current, candidate.exeName, null) : current
      ));
      setDraftState((current) => (
        current ? updateAppOverrideInDraftState(current, candidate.exeName, null) : current
      ));
      setNameDrafts((current) => {
        const next = { ...current };
        delete next[candidate.exeName];
        return next;
      });
      setNameEditSnapshots((current) => {
        const next = { ...current };
        delete next[candidate.exeName];
        return next;
      });
      setEditingNameExe((current) => (current === candidate.exeName ? null : current));
      ClassificationService.invalidateBootstrapCache();
      await appCatalog.reload();
    } finally {
      setDeletingSessionsExe(null);
    }
  }, [appCatalog, confirm, onSessionsDeleted, refreshCandidates, resolveEffectiveDisplayName]);

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
        const nextBootstrapIcons = result.nextBootstrap.icons ?? bootstrapIcons;
        setBootstrapIcons(nextBootstrapIcons);
        setClassificationBootstrapCache({
          ...result.nextBootstrap,
          icons: nextBootstrapIcons,
        });
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
  }, [bootstrapIcons, candidates, draftState, hasUnsavedChanges, onOverridesChanged, savedState, saving, webDomainCandidates]);

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
    icons: mappingIcons,
    loading,
    loadError,
    retryLoading,
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
    appCatalogLoading: appCatalog.loading,
    appCatalogError: appCatalog.error,
    appCatalogRetry: appCatalog.retry,
    filteredWebDomainCandidates,
    showCategoryDialog,
    setShowCategoryDialog,
    colorFormat,
    setColorFormat,
    categoryControlCategories,
    candidateCategoryOptions,
    resolveCategoryColor,
    resolveCategoryLabel,
    handleCreateCategory,
    handleDeleteCategory,
    handleRenameCategory,
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
    handleWebDomainTitleCaptureToggle,
    handleTitleCaptureToggle,
    handleTrackingToggle,
    handleDeleteAllSessions,
    handleDeleteWebDomainHistory,
    applyCategoryColor,
  };
}
