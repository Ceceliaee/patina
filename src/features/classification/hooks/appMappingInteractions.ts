import type { ObservedAppCandidate } from "../services/classificationStore.ts";
import type { AppOverride } from "../services/classificationService.ts";
import {
  cloneClassificationDraftState,
  type ClassificationDraftState,
} from "../services/classificationDraftState.ts";
import { buildAppMappingOverride, cloneObservedCandidates } from "./appMappingStateHelpers.ts";

type SaveStatus = "idle" | "saving" | "saved";

export interface AppMappingNameEditState {
  draftState: ClassificationDraftState;
  nameDrafts: Record<string, string>;
  nameEditSnapshots: Record<string, AppOverride | null>;
  editingNameExe: string | null;
  skipNextNameBlurExe: string | null;
}

export interface AppMappingSaveFlowInput {
  savedState: ClassificationDraftState | null;
  draftState: ClassificationDraftState | null;
  candidates: ObservedAppCandidate[];
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
  loadedOverrides: ClassificationDraftState["overrides"];
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
        loadedOverrides: { ...nextDraftState.overrides },
        loadedCategoryColorOverrides: { ...nextDraftState.categoryColorOverrides },
        loadedCustomCategories: [...nextDraftState.customCategories],
        loadedDeletedCategories: [...nextDraftState.deletedCategories],
      },
      nextSaveStatus: "saved",
      resetEditingState: true,
    };
  } catch {
    return {
      accepted: false,
      skippedReason: null,
      nextSavedState: input.savedState,
      nextDraftState: input.draftState,
      nextBootstrap: null,
      nextSaveStatus: "idle",
      resetEditingState: false,
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
