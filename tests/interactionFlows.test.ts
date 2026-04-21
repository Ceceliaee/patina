import assert from "node:assert/strict";
import {
  cancelAppMappingNameEdit,
  deleteObservedCandidateSessionsWithDeps,
  saveAppMappingStateWithDeps,
  startAppMappingNameEdit,
  syncAppMappingNameDraft,
} from "../src/features/classification/hooks/appMappingInteractions.ts";
import {
  cancelSettingsPageState,
  saveSettingsPageStateWithDeps,
} from "../src/features/settings/hooks/settingsPageStateInteractions.ts";
import {
  createWidgetWindowController,
  type WidgetMonitorLike,
  type WidgetWindowPosition,
  type WidgetWindowRect,
  type WidgetWindowSize,
} from "../src/app/widget/widgetWindowController.ts";
import type { ObservedAppCandidate } from "../src/features/classification/services/classificationStore.ts";
import {
  cloneClassificationDraftState,
  hasClassificationDraftChanges,
  type ClassificationDraftState,
} from "../src/features/classification/services/classificationDraftState.ts";
import type { AppSettings } from "../src/shared/settings/appSettings.ts";

const BASE_SETTINGS: AppSettings = {
  idle_timeout_secs: 300,
  timeline_merge_gap_secs: 60,
  refresh_interval_secs: 1,
  min_session_secs: 60,
  tracking_paused: false,
  close_behavior: "tray",
  minimize_behavior: "taskbar",
  launch_at_login: false,
  start_minimized: false,
  onboarding_completed: false,
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
    categoryColorOverrides: {},
    customCategories: [],
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

class FakeScheduler {
  private nextId = 1;
  private jobs = new Map<number, () => void>();

  schedule(callback: () => void): number {
    const id = this.nextId;
    this.nextId += 1;
    this.jobs.set(id, callback);
    return id;
  }

  clear(handle: number) {
    this.jobs.delete(handle);
  }

  flushAll() {
    const jobs = Array.from(this.jobs.values());
    this.jobs.clear();
    for (const job of jobs) {
      job();
    }
  }
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("settings interaction helpers cover save, cancel, and failed save semantics", async () => {
  const savedSettings = buildSettings();
  const draftSettings = buildSettings({
    tracking_paused: true,
    timeline_merge_gap_secs: 180,
  });

  const saveResult = await saveSettingsPageStateWithDeps({
    savedSettings,
    draftSettings,
    appVersion: "0.3.3",
    hasUnsavedChanges: true,
    saveStatus: "idle",
  }, {
    buildPatch: (saved, draft) => ({
      tracking_paused: draft.tracking_paused !== saved.tracking_paused ? draft.tracking_paused : saved.tracking_paused,
      timeline_merge_gap_secs: draft.timeline_merge_gap_secs,
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
  assert.equal(saveResult.nextSavedSettings?.tracking_paused, true);
  assert.equal(saveResult.nextBootstrap?.settings.timeline_merge_gap_secs, 180);

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
    buildPatch: () => ({ tracking_paused: true }),
    commitPatch: async () => {
      throw new Error("db busy");
    },
  });

  assert.equal(failedSaveResult.accepted, false);
  assert.equal(failedSaveResult.toastKind, "save-failed");
  assert.equal(failedSaveResult.nextDraftSettings?.tracking_paused, true);
  assert.equal(
    failedSaveResult.nextSavedSettings?.tracking_paused !== failedSaveResult.nextDraftSettings?.tracking_paused,
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
    candidates: [candidate],
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
    candidates: [candidate],
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
    refreshCandidates: async () => [],
    onSessionsDeleted: () => {
      deletedSessions += 1;
    },
  });
  assert.equal(deleteResult.deleted, true);
  assert.deepEqual(deleteResult.nextCandidates, []);
  assert.equal(deletedSessions, 2);
  assert.equal(
    hasClassificationDraftChanges(savedState, reEdited.draftState),
    true,
  );
});

await runTest("widget window controller covers expand collapse focus-loss collapse and drag placement", async () => {
  const scheduler = new FakeScheduler();
  const events: string[] = [];
  let placementFromCallback = "right:0.28";
  let expandedFromCallback = false;
  let currentRect: WidgetWindowRect | null = {
    position: { x: 1500, y: 300 },
    size: { width: 148, height: 48 },
  };
  let currentMonitor: WidgetMonitorLike | null = {
    workArea: {
      position: { x: 1000, y: 0 },
      size: { width: 1000, height: 900 },
    },
  };

  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => ({ side: "left", anchor_y: 0.4 }),
    persistExpanded: async (nextExpanded, showObjectSlot) => {
      events.push(`expanded:${nextExpanded}:${showObjectSlot}`);
    },
    applyLayout: async (placement, nextExpanded, showObjectSlot) => {
      events.push(`layout:${placement.side}:${placement.anchor_y.toFixed(2)}:${nextExpanded}:${showObjectSlot}`);
    },
    readWindowRect: async () => currentRect,
    resolveMonitorForWindowRect: async (
      _position: WidgetWindowPosition,
      _size: WidgetWindowSize,
    ) => currentMonitor,
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
    onPlacementChange: (placement) => {
      placementFromCallback = `${placement.side}:${placement.anchor_y.toFixed(2)}`;
    },
    onExpandedChange: (nextExpanded) => {
      expandedFromCallback = nextExpanded;
    },
  });

  await controller.initialize();
  assert.equal(placementFromCallback, "left:0.40");

  controller.expand();
  await flushMicrotasks();
  assert.equal(expandedFromCallback, true);
  assert.deepEqual(events, ["expanded:true:true"]);

  controller.setShowObjectSlot(false);
  await flushMicrotasks();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.ok(events.includes("layout:left:0.40:true:false"));

  controller.handleWindowMoved();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(placementFromCallback, "right:0.35");
  assert.ok(events.includes("layout:right:0.35:true:false"));

  controller.handleFocusChanged(false);
  await flushMicrotasks();
  assert.equal(expandedFromCallback, false);
  assert.deepEqual(events.slice(-1), ["expanded:false:false"]);
});

console.log(`Passed ${passed} interaction flow tests`);
