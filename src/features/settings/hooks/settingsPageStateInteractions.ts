import type { AppSettings } from "../../../shared/settings/appSettings.ts";
import type { SettingsCommitResult } from "../services/settingsRuntimeAdapterService.ts";

type SettingsPatch = Partial<AppSettings>;
type SaveStatus = "idle" | "saving" | "saved";

export interface SettingsSaveFlowInput {
  savedSettings: AppSettings | null;
  draftSettings: AppSettings | null;
  appVersion: string;
  hasUnsavedChanges: boolean;
  saveStatus: SaveStatus;
}

export interface SettingsSaveFlowDeps {
  buildPatch: (saved: AppSettings, draft: AppSettings) => SettingsPatch;
  commitPatch: (patch: SettingsPatch) => Promise<SettingsCommitResult>;
}

export interface SettingsBootstrapSnapshot {
  settings: AppSettings;
  appVersion: string;
}

export interface SettingsSaveFlowResult {
  accepted: boolean;
  skippedReason: "missing-settings" | "no-changes" | "saving" | null;
  nextSavedSettings: AppSettings | null;
  nextDraftSettings: AppSettings | null;
  nextBootstrap: SettingsBootstrapSnapshot | null;
  nextSaveStatus: SaveStatus;
  toastKind: "saved" | "runtime-sync-warning" | "save-failed" | null;
  runtimeSyncErrors: string[];
}

export interface SettingsCancelFlowInput {
  savedSettings: AppSettings | null;
  hasUnsavedChanges: boolean;
}

export interface SettingsCancelFlowResult {
  cancelled: boolean;
  nextDraftSettings: AppSettings | null;
  nextSaveStatus: SaveStatus;
  toastKind: "cancelled" | null;
}

export async function saveSettingsPageStateWithDeps(
  input: SettingsSaveFlowInput,
  deps: SettingsSaveFlowDeps,
): Promise<SettingsSaveFlowResult> {
  if (!input.savedSettings || !input.draftSettings) {
    return {
      accepted: false,
      skippedReason: "missing-settings",
      nextSavedSettings: input.savedSettings,
      nextDraftSettings: input.draftSettings,
      nextBootstrap: null,
      nextSaveStatus: input.saveStatus,
      toastKind: null,
      runtimeSyncErrors: [],
    };
  }

  if (!input.hasUnsavedChanges) {
    return {
      accepted: true,
      skippedReason: "no-changes",
      nextSavedSettings: input.savedSettings,
      nextDraftSettings: input.draftSettings,
      nextBootstrap: null,
      nextSaveStatus: input.saveStatus,
      toastKind: null,
      runtimeSyncErrors: [],
    };
  }

  if (input.saveStatus === "saving") {
    return {
      accepted: false,
      skippedReason: "saving",
      nextSavedSettings: input.savedSettings,
      nextDraftSettings: input.draftSettings,
      nextBootstrap: null,
      nextSaveStatus: input.saveStatus,
      toastKind: null,
      runtimeSyncErrors: [],
    };
  }

  try {
    const patch = deps.buildPatch(input.savedSettings, input.draftSettings);
    const commitResult = await deps.commitPatch(patch);
    const nextSettings = { ...input.draftSettings };
    return {
      accepted: true,
      skippedReason: null,
      nextSavedSettings: nextSettings,
      nextDraftSettings: nextSettings,
      nextBootstrap: {
        settings: nextSettings,
        appVersion: input.appVersion,
      },
      nextSaveStatus: "saved",
      toastKind: commitResult.runtimeSync === "failed" ? "runtime-sync-warning" : "saved",
      runtimeSyncErrors: commitResult.runtimeSyncErrors,
    };
  } catch {
    return {
      accepted: false,
      skippedReason: null,
      nextSavedSettings: input.savedSettings,
      nextDraftSettings: input.draftSettings,
      nextBootstrap: null,
      nextSaveStatus: "idle",
      toastKind: "save-failed",
      runtimeSyncErrors: [],
    };
  }
}

export function cancelSettingsPageState(
  input: SettingsCancelFlowInput,
): SettingsCancelFlowResult {
  if (!input.savedSettings || !input.hasUnsavedChanges) {
    return {
      cancelled: false,
      nextDraftSettings: input.savedSettings,
      nextSaveStatus: "idle",
      toastKind: null,
    };
  }

  return {
    cancelled: true,
    nextDraftSettings: { ...input.savedSettings },
    nextSaveStatus: "idle",
    toastKind: "cancelled",
  };
}
