import type { ObservedAppCandidate } from "../services/classificationStore.ts";
import type { AppOverride } from "../services/classificationService.ts";
import type { ObservedWebDomainCandidate, WebDomainOverride } from "../../../shared/types/webActivity.ts";
import {
  cloneClassificationDraftState,
  type ClassificationDraftState,
} from "../services/classificationDraftState.ts";
import {
  buildAppMappingOverride,
  buildWebDomainMappingOverride,
  cloneObservedCandidates,
} from "./appMappingStateHelpers.ts";

type SaveStatus = "idle" | "saving" | "saved";

export interface AppMappingNameEditState {
  draftState: ClassificationDraftState;
  nameDrafts: Record<string, string>;
  nameEditSnapshots: Record<string, AppOverride | null>;
  editingNameExe: string | null;
  skipNextNameBlurExe: string | null;
}

export interface WebDomainNameEditState {
  draftState: ClassificationDraftState;
  webNameDrafts: Record<string, string>;
  webNameEditSnapshots: Record<string, WebDomainOverride | null>;
  editingWebDomain: string | null;
  skipNextWebNameBlurDomain: string | null;
}

export interface AppMappingSaveFlowInput {
  savedState: ClassificationDraftState | null;
  draftState: ClassificationDraftState | null;
  candidates: ObservedAppCandidate[];
  webDomainCandidates: ObservedWebDomainCandidate[];
  hasUnsavedChanges: boolean;
  saving: boolean;
}

export interface AppMappingSaveFlowDeps {
  commitDraftChanges: (
    saved: ClassificationDraftState,
    draft: ClassificationDraftState,
  ) => Promise<void>;
}

export interface AppMappingBootstrapSnapshot {
  observed: ObservedAppCandidate[];
  observedWebDomains: ObservedWebDomainCandidate[];
  loadedOverrides: ClassificationDraftState["overrides"];
  loadedWebDomainOverrides: ClassificationDraftState["webDomainOverrides"];
  loadedCategoryColorOverrides: ClassificationDraftState["categoryColorOverrides"];
  loadedCustomCategories: ClassificationDraftState["customCategories"];
  loadedDeletedCategories: ClassificationDraftState["deletedCategories"];
}

export interface AppMappingSaveFlowResult {
  accepted: boolean;
  skippedReason: "missing-state" | "no-changes" | "saving" | null;
  nextSavedState: ClassificationDraftState | null;
  nextDraftState: ClassificationDraftState | null;
  nextBootstrap: AppMappingBootstrapSnapshot | null;
  nextSaveStatus: SaveStatus;
  resetEditingState: boolean;
  error: unknown | null;
}

export interface DeleteObservedSessionsDeps {
  confirmDelete: () => Promise<boolean>;
  deleteObservedAppSessions: (exeName: string, scope: "today" | "all") => Promise<void>;
  refreshCandidates: () => Promise<ObservedAppCandidate[]>;
  onSessionsDeleted?: () => void;
}

export interface DeleteObservedSessionsFlowResult {
  deleted: boolean;
  nextCandidates: ObservedAppCandidate[] | null;
}

function withUpdatedOverride(
  state: ClassificationDraftState,
  exeName: string,
  nextOverride: AppOverride | null,
): ClassificationDraftState {
  const nextOverrides = { ...state.overrides };
  if (!nextOverride) {
    delete nextOverrides[exeName];
  } else {
    nextOverrides[exeName] = nextOverride;
  }

  return {
    ...state,
    overrides: nextOverrides,
  };
}

function withUpdatedWebDomainOverride(
  state: ClassificationDraftState,
  normalizedDomain: string,
  nextOverride: WebDomainOverride | null,
): ClassificationDraftState {
  const nextOverrides = { ...state.webDomainOverrides };
  if (!nextOverride) {
    delete nextOverrides[normalizedDomain];
  } else {
    nextOverrides[normalizedDomain] = nextOverride;
  }

  return {
    ...state,
    webDomainOverrides: nextOverrides,
  };
}

export function startAppMappingNameEdit(
  state: AppMappingNameEditState,
  candidate: ObservedAppCandidate,
  displayName: string,
): AppMappingNameEditState {
  return {
    ...state,
    editingNameExe: candidate.exeName,
    skipNextNameBlurExe: null,
    nameEditSnapshots: {
      ...state.nameEditSnapshots,
      [candidate.exeName]: state.draftState.overrides[candidate.exeName] ?? null,
    },
    nameDrafts: {
      ...state.nameDrafts,
      [candidate.exeName]: state.nameDrafts[candidate.exeName] ?? displayName,
    },
  };
}

export function startWebDomainNameEdit(
  state: WebDomainNameEditState,
  candidate: ObservedWebDomainCandidate,
  displayName: string,
): WebDomainNameEditState {
  return {
    ...state,
    editingWebDomain: candidate.normalizedDomain,
    skipNextWebNameBlurDomain: null,
    webNameEditSnapshots: {
      ...state.webNameEditSnapshots,
      [candidate.normalizedDomain]: state.draftState.webDomainOverrides[candidate.normalizedDomain] ?? null,
    },
    webNameDrafts: {
      ...state.webNameDrafts,
      [candidate.normalizedDomain]: state.webNameDrafts[candidate.normalizedDomain] ?? displayName,
    },
  };
}

export function syncAppMappingNameDraft(
  state: AppMappingNameEditState,
  candidate: ObservedAppCandidate,
  nextInputValue: string,
  autoDisplayName: string,
  normalizeInputDraft: boolean = false,
): AppMappingNameEditState {
  const current = state.draftState.overrides[candidate.exeName] ?? null;
  const trimmedDisplayName = nextInputValue.trim();
  const displayName = trimmedDisplayName && trimmedDisplayName !== autoDisplayName
    ? trimmedDisplayName
    : undefined;
  const nextOverride = buildAppMappingOverride({
    category: current?.category,
    color: current?.color,
    displayName,
    track: current?.track !== false,
    captureTitle: current?.captureTitle !== false,
    updatedAt: current?.updatedAt,
  });

  return {
    ...state,
    draftState: withUpdatedOverride(state.draftState, candidate.exeName, nextOverride),
    nameDrafts: {
      ...state.nameDrafts,
      [candidate.exeName]: normalizeInputDraft ? (displayName ?? autoDisplayName) : nextInputValue,
    },
  };
}

export function syncWebDomainNameDraft(
  state: WebDomainNameEditState,
  candidate: ObservedWebDomainCandidate,
  nextInputValue: string,
  autoDisplayName: string,
  normalizeInputDraft: boolean = false,
): WebDomainNameEditState {
  const current = state.draftState.webDomainOverrides[candidate.normalizedDomain] ?? null;
  const trimmedDisplayName = nextInputValue.trim();
  const displayName = trimmedDisplayName && trimmedDisplayName !== autoDisplayName
    ? trimmedDisplayName
    : undefined;
  const nextOverride = buildWebDomainMappingOverride({
    category: current?.category,
    color: current?.color,
    displayName,
    enabled: current?.enabled !== false,
    updatedAt: current?.updatedAt,
  });

  return {
    ...state,
    draftState: withUpdatedWebDomainOverride(state.draftState, candidate.normalizedDomain, nextOverride),
    webNameDrafts: {
      ...state.webNameDrafts,
      [candidate.normalizedDomain]: normalizeInputDraft ? (displayName ?? autoDisplayName) : nextInputValue,
    },
  };
}

export function cancelAppMappingNameEdit(
  state: AppMappingNameEditState,
  candidate: ObservedAppCandidate,
  resolvedDisplayName: string,
): AppMappingNameEditState {
  const hasSnapshot = Object.prototype.hasOwnProperty.call(state.nameEditSnapshots, candidate.exeName);
  const snapshot = hasSnapshot
    ? state.nameEditSnapshots[candidate.exeName]
    : (state.draftState.overrides[candidate.exeName] ?? null);
  const nextNameEditSnapshots = { ...state.nameEditSnapshots };
  delete nextNameEditSnapshots[candidate.exeName];

  return {
    ...state,
    draftState: withUpdatedOverride(state.draftState, candidate.exeName, snapshot),
    nameDrafts: {
      ...state.nameDrafts,
      [candidate.exeName]: resolvedDisplayName,
    },
    nameEditSnapshots: nextNameEditSnapshots,
    editingNameExe: state.editingNameExe === candidate.exeName ? null : state.editingNameExe,
    skipNextNameBlurExe: candidate.exeName,
  };
}

export function cancelWebDomainNameEdit(
  state: WebDomainNameEditState,
  candidate: ObservedWebDomainCandidate,
  resolvedDisplayName: string,
): WebDomainNameEditState {
  const hasSnapshot = Object.prototype.hasOwnProperty.call(
    state.webNameEditSnapshots,
    candidate.normalizedDomain,
  );
  const snapshot = hasSnapshot
    ? state.webNameEditSnapshots[candidate.normalizedDomain]
    : (state.draftState.webDomainOverrides[candidate.normalizedDomain] ?? null);
  const nextNameEditSnapshots = { ...state.webNameEditSnapshots };
  delete nextNameEditSnapshots[candidate.normalizedDomain];

  return {
    ...state,
    draftState: withUpdatedWebDomainOverride(state.draftState, candidate.normalizedDomain, snapshot),
    webNameDrafts: {
      ...state.webNameDrafts,
      [candidate.normalizedDomain]: resolvedDisplayName,
    },
    webNameEditSnapshots: nextNameEditSnapshots,
    editingWebDomain: state.editingWebDomain === candidate.normalizedDomain ? null : state.editingWebDomain,
    skipNextWebNameBlurDomain: candidate.normalizedDomain,
  };
}

export async function saveAppMappingStateWithDeps(
  input: AppMappingSaveFlowInput,
  deps: AppMappingSaveFlowDeps,
): Promise<AppMappingSaveFlowResult> {
  if (!input.savedState || !input.draftState) {
    return {
      accepted: false,
      skippedReason: "missing-state",
      nextSavedState: input.savedState,
      nextDraftState: input.draftState,
      nextBootstrap: null,
      nextSaveStatus: "idle",
      resetEditingState: false,
      error: null,
    };
  }

  if (!input.hasUnsavedChanges) {
    return {
      accepted: true,
      skippedReason: "no-changes",
      nextSavedState: input.savedState,
      nextDraftState: input.draftState,
      nextBootstrap: null,
      nextSaveStatus: "idle",
      resetEditingState: false,
      error: null,
    };
  }

  if (input.saving) {
    return {
      accepted: false,
      skippedReason: "saving",
      nextSavedState: input.savedState,
      nextDraftState: input.draftState,
      nextBootstrap: null,
      nextSaveStatus: "idle",
      resetEditingState: false,
      error: null,
    };
  }

  try {
    await deps.commitDraftChanges(input.savedState, input.draftState);
    const nextSavedState = cloneClassificationDraftState(input.draftState);
    const nextDraftState = cloneClassificationDraftState(input.draftState);
    return {
      accepted: true,
      skippedReason: null,
      nextSavedState,
      nextDraftState,
      nextBootstrap: {
        observed: cloneObservedCandidates(input.candidates),
        observedWebDomains: input.webDomainCandidates.map((candidate) => ({ ...candidate })),
        loadedOverrides: { ...nextDraftState.overrides },
        loadedWebDomainOverrides: { ...nextDraftState.webDomainOverrides },
        loadedCategoryColorOverrides: { ...nextDraftState.categoryColorOverrides },
        loadedCustomCategories: [...nextDraftState.customCategories],
        loadedDeletedCategories: [...nextDraftState.deletedCategories],
      },
      nextSaveStatus: "saved",
      resetEditingState: true,
      error: null,
    };
  } catch (error) {
    return {
      accepted: false,
      skippedReason: null,
      nextSavedState: input.savedState,
      nextDraftState: input.draftState,
      nextBootstrap: null,
      nextSaveStatus: "idle",
      resetEditingState: false,
      error,
    };
  }
}

export async function deleteObservedCandidateSessionsWithDeps(
  candidate: ObservedAppCandidate,
  deps: DeleteObservedSessionsDeps,
): Promise<DeleteObservedSessionsFlowResult> {
  const confirmed = await deps.confirmDelete();
  if (!confirmed) {
    return {
      deleted: false,
      nextCandidates: null,
    };
  }

  await deps.deleteObservedAppSessions(candidate.exeName, "all");
  const nextCandidates = await deps.refreshCandidates();
  deps.onSessionsDeleted?.();
  return {
    deleted: true,
    nextCandidates,
  };
}
