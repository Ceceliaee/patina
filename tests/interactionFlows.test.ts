import assert from "node:assert/strict";
import {
  cancelAppMappingNameEdit,
  cancelWebDomainNameEdit,
  deleteObservedCandidateSessionsWithDeps,
  saveAppMappingStateWithDeps,
  startAppMappingNameEdit,
  startWebDomainNameEdit,
  syncAppMappingNameDraft,
  syncWebDomainNameDraft,
} from "../src/features/classification/hooks/appMappingInteractions.ts";
import {
  readClassificationObjectMode,
  rememberClassificationObjectMode,
} from "../src/features/classification/services/classificationLayoutPreferenceStorage.ts";
import {
  readSidebarNavigationMode,
  rememberSidebarNavigationMode,
} from "../src/app/services/sidebarNavigationPreferenceStorage.ts";
import {
  cancelSettingsPageState,
  saveSettingsPageStateWithDeps,
} from "../src/features/settings/hooks/settingsPageStateInteractions.ts";
import type { ObservedAppCandidate } from "../src/features/classification/services/classificationStore.ts";
import type { ObservedWebDomainCandidate } from "../src/shared/types/webActivity.ts";
import {
  cloneClassificationDraftState,
  hasClassificationDraftChanges,
  type ClassificationDraftState,
} from "../src/features/classification/services/classificationDraftState.ts";
import type { AppSettings } from "../src/shared/settings/appSettings.ts";
import {
  getHistoryTimelineWheelZoomDurationMs,
  normalizeHistoryTimelineWheelDelta,
} from "../src/features/history/hooks/useHistoryTimelineViewportInteraction.ts";
import { MemoryStorage, withWindowStorage, withWindowValue } from "./helpers/browserTestGlobals.ts";

const BASE_SETTINGS: AppSettings = {
  idleTimeoutSecs: 300,
  timelineMergeGapSecs: 60,
  refreshIntervalSecs: 1,
  minSessionSecs: 60,
  trackingPaused: false,
  titleRecordingEnabled: true,
  showTrayIcon: true,
  closeBehavior: "tray",
  themeMode: "light",
  language: "zh-CN",
  hourlyActivityChartMode: "total",
  dynamicEffects: true,
  colorSchemeLight: "default",
  colorSchemeDark: "default",
  launchAtLogin: false,
  startMinimized: false,
  onboardingCompleted: false,
  webActivityEnabled: false,
  webActivityPort: 12345,
  webActivityToken: "",
  remoteStatusBridgeEnabled: false,
  remoteStatusBridgeUrl: "",
  remoteStatusBridgeToken: "",
  remoteStatusBridgeMachineId: "",
};

function buildSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...BASE_SETTINGS,
    ...overrides,
  };
}

function buildDraftState(overrides: Partial<ClassificationDraftState> = {}): ClassificationDraftState {
  return {
    overrides: {},
    webDomainOverrides: {},
    categoryColorOverrides: {},
    categoryLabelOverrides: {},
    persistedCategoryIds: [],
    deletedCategories: [],
    ...overrides,
  };
}

function buildCandidate(
  exeName: string,
  appName: string,
): ObservedAppCandidate {
  return {
    exeName,
    appName,
    totalDuration: 600,
    lastSeenMs: 1_714_000_000_000,
  };
}

function buildWebDomainCandidate(
  normalizedDomain: string,
  domain = normalizedDomain,
): ObservedWebDomainCandidate {
  return {
    normalizedDomain,
    domain,
    faviconUrl: null,
    title: null,
    totalDuration: 600,
    lastSeenMs: 1_714_000_000_000,
  };
}



let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("history timeline normalizes pixel line and page wheel deltas", () => {
  assert.equal(normalizeHistoryTimelineWheelDelta(12, 0, 500), 12);
  assert.equal(normalizeHistoryTimelineWheelDelta(2, 1, 500), 32);
  assert.equal(normalizeHistoryTimelineWheelDelta(-1, 2, 500), -500);
  assert.equal(normalizeHistoryTimelineWheelDelta(Number.NaN, 0, 500), 0);
  assert.equal(normalizeHistoryTimelineWheelDelta(1, 2, 0), 1);
});

await runTest("history timeline wheel zoom changes the window by 0.2 hours per event", () => {
  const fourHoursMs = 4 * 60 * 60_000;
  const stepMs = 0.2 * 60 * 60_000;
  assert.equal(getHistoryTimelineWheelZoomDurationMs(fourHoursMs, -120), fourHoursMs - stepMs);
  assert.equal(getHistoryTimelineWheelZoomDurationMs(fourHoursMs, 120), fourHoursMs + stepMs);
  assert.equal(getHistoryTimelineWheelZoomDurationMs(fourHoursMs, 0.1), fourHoursMs);
});

await runTest("settings interaction helpers cover save, cancel, and failed save semantics", async () => {
  const savedSettings = buildSettings();
  const draftSettings = buildSettings({
    trackingPaused: true,
    timelineMergeGapSecs: 180,
  });

  const saveResult = await saveSettingsPageStateWithDeps({
    savedSettings,
    draftSettings,
    appVersion: "0.3.3",
    hasUnsavedChanges: true,
    saveStatus: "idle",
  }, {
    buildPatch: (saved, draft) => ({
      trackingPaused: draft.trackingPaused !== saved.trackingPaused ? draft.trackingPaused : saved.trackingPaused,
      timelineMergeGapSecs: draft.timelineMergeGapSecs,
    }),
    commitPatch: async () => ({
      persisted: true,
      runtimeSync: "synced",
      runtimeSyncErrors: [],
    }),
  });

  assert.equal(saveResult.accepted, true);
  assert.equal(saveResult.toastKind, "saved");
  assert.equal(saveResult.nextSaveStatus, "saved");
  assert.equal(saveResult.nextSavedSettings?.trackingPaused, true);
  assert.equal(saveResult.nextBootstrap?.settings.timelineMergeGapSecs, 180);

  const cancelResult = cancelSettingsPageState({
    savedSettings,
    hasUnsavedChanges: true,
  });
  assert.equal(cancelResult.cancelled, true);
  assert.deepEqual(cancelResult.nextDraftSettings, savedSettings);

  const failedSaveResult = await saveSettingsPageStateWithDeps({
    savedSettings,
    draftSettings,
    appVersion: "0.3.3",
    hasUnsavedChanges: true,
    saveStatus: "idle",
  }, {
    buildPatch: () => ({ trackingPaused: true }),
    commitPatch: async () => {
      throw new Error("db busy");
    },
  });

  assert.equal(failedSaveResult.accepted, false);
  assert.equal(failedSaveResult.toastKind, "save-failed");
  assert.equal(failedSaveResult.nextDraftSettings?.trackingPaused, true);
  assert.equal(
    failedSaveResult.nextSavedSettings?.trackingPaused !== failedSaveResult.nextDraftSettings?.trackingPaused,
    true,
  );
});

await runTest("app mapping interaction helpers keep dirty state correct across edit cancel save and delete", async () => {
  const candidate = buildCandidate("chrome.exe", "Chrome");
  const savedState = buildDraftState();

  const started = startAppMappingNameEdit({
    draftState: cloneClassificationDraftState(savedState),
    nameDrafts: {},
    nameEditSnapshots: {},
    editingNameExe: null,
    skipNextNameBlurExe: null,
  }, candidate, "Chrome");

  assert.equal(started.editingNameExe, "chrome.exe");
  assert.equal(started.nameDrafts["chrome.exe"], "Chrome");

  const edited = syncAppMappingNameDraft(
    started,
    candidate,
    "Work Browser",
    "Chrome",
  );
  assert.equal(
    hasClassificationDraftChanges(savedState, edited.draftState),
    true,
  );

  const cleared = syncAppMappingNameDraft(
    edited,
    candidate,
    "   ",
    "Chrome",
    true,
  );
  assert.equal(cleared.draftState.overrides["chrome.exe"], undefined);
  assert.equal(cleared.nameDrafts["chrome.exe"], "Chrome");

  const cancelled = cancelAppMappingNameEdit(
    edited,
    candidate,
    "Chrome",
  );
  assert.equal(cancelled.editingNameExe, null);
  assert.equal(
    hasClassificationDraftChanges(savedState, cancelled.draftState),
    false,
  );

  const reEdited = syncAppMappingNameDraft(
    startAppMappingNameEdit(cancelled, candidate, "Chrome"),
    candidate,
    "Work Browser",
    "Chrome",
  );

  const saveResult = await saveAppMappingStateWithDeps({
    savedState,
    draftState: reEdited.draftState,
    webDomainCandidates: [],
    hasUnsavedChanges: true,
    saving: false,
  }, {
    commitDraftChanges: async () => {},
  });
  assert.equal(saveResult.accepted, true);
  assert.equal(saveResult.nextSaveStatus, "saved");
  assert.equal(saveResult.resetEditingState, true);

  const failedSaveResult = await saveAppMappingStateWithDeps({
    savedState,
    draftState: reEdited.draftState,
    webDomainCandidates: [],
    hasUnsavedChanges: true,
    saving: false,
  }, {
    commitDraftChanges: async () => {
      throw new Error("sqlite busy");
    },
  });
  assert.equal(failedSaveResult.accepted, false);
  assert.equal(
    hasClassificationDraftChanges(savedState, failedSaveResult.nextDraftState ?? savedState),
    true,
  );

  let deletedSessions = 0;
  const deleteResult = await deleteObservedCandidateSessionsWithDeps(candidate, {
    confirmDelete: async () => true,
    deleteObservedAppSessions: async () => {
      deletedSessions += 1;
    },
    onSessionsDeleted: () => {
      deletedSessions += 1;
    },
  });
  assert.equal(deleteResult.deleted, true);
  assert.equal(deletedSessions, 2);

  let externalDeleteCalls = 0;
  const externalOnlyDeleteResult = await deleteObservedCandidateSessionsWithDeps({
    ...candidate,
    hasNativeRecords: false,
  }, {
    confirmDelete: async () => {
      externalDeleteCalls += 1;
      return true;
    },
    deleteObservedAppSessions: async () => {
      externalDeleteCalls += 1;
    },
  });
  assert.equal(externalOnlyDeleteResult.deleted, true);
  assert.equal(externalDeleteCalls, 2);
  assert.equal(
    hasClassificationDraftChanges(savedState, reEdited.draftState),
    true,
  );
});

await runTest("classification object mode preference persists apps and web", () => {
  const storage = new MemoryStorage();
  withWindowStorage(storage, () => {
    assert.equal(readClassificationObjectMode(), "app");
    rememberClassificationObjectMode("web");
    assert.equal(readClassificationObjectMode(), "web");
    assert.equal(storage.getItem("patina:classification-object-mode"), "web");

    storage.setItem("patina:classification-object-mode", "category");
    assert.equal(readClassificationObjectMode(), "app");
  });
});

await runTest("sidebar navigation mode preference is strict and failure-safe", () => {
  const storage = new MemoryStorage();
  withWindowStorage(storage, () => {
    assert.equal(readSidebarNavigationMode(), "icons");

    rememberSidebarNavigationMode("labeled");
    assert.equal(readSidebarNavigationMode(), "labeled");
    assert.equal(storage.getItem("patina:sidebar-navigation-mode"), "labeled");

    rememberSidebarNavigationMode("icons");
    assert.equal(readSidebarNavigationMode(), "icons");
    assert.equal(storage.getItem("patina:sidebar-navigation-mode"), "icons");

    storage.setItem("patina:sidebar-navigation-mode", "expanded");
    assert.equal(readSidebarNavigationMode(), "icons");
  });

  withWindowValue(undefined, () => {
    assert.equal(readSidebarNavigationMode(), "icons");
    assert.doesNotThrow(() => rememberSidebarNavigationMode("labeled"));
  });

  withWindowValue({
    get localStorage(): Storage {
      throw new Error("storage unavailable");
    },
  }, () => {
    assert.equal(readSidebarNavigationMode(), "icons");
    assert.doesNotThrow(() => rememberSidebarNavigationMode("labeled"));
  });
});

await runTest("web domain name edit mirrors app mapping edit semantics", () => {
  const candidate = buildWebDomainCandidate("github.com");
  const savedState = buildDraftState();

  const started = startWebDomainNameEdit({
    draftState: cloneClassificationDraftState(savedState),
    webNameDrafts: {},
    webNameEditSnapshots: {},
    editingWebDomain: null,
    skipNextWebNameBlurDomain: null,
  }, candidate, "github.com");

  assert.equal(started.editingWebDomain, "github.com");
  assert.equal(started.webNameDrafts["github.com"], "github.com");

  const edited = syncWebDomainNameDraft(
    started,
    candidate,
    "GitHub",
    "github.com",
  );
  assert.equal(
    hasClassificationDraftChanges(savedState, edited.draftState),
    true,
  );

  const cleared = syncWebDomainNameDraft(
    edited,
    candidate,
    "   ",
    "github.com",
    true,
  );
  assert.equal(cleared.draftState.webDomainOverrides["github.com"], undefined);
  assert.equal(cleared.webNameDrafts["github.com"], "github.com");

  const cancelled = cancelWebDomainNameEdit(
    edited,
    candidate,
    "github.com",
  );
  assert.equal(cancelled.editingWebDomain, null);
  assert.equal(
    hasClassificationDraftChanges(savedState, cancelled.draftState),
    false,
  );
});

console.log(`Passed ${passed} interaction flow tests`);
