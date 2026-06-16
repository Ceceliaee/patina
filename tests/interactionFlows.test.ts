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
import type { ObservedWebDomainCandidate } from "../src/shared/types/webActivity.ts";
import {
  cloneClassificationDraftState,
  hasClassificationDraftChanges,
  type ClassificationDraftState,
} from "../src/features/classification/services/classificationDraftState.ts";
import type { AppSettings } from "../src/shared/settings/appSettings.ts";

const BASE_SETTINGS: AppSettings = {
  idleTimeoutSecs: 300,
  timelineMergeGapSecs: 60,
  refreshIntervalSecs: 1,
  minSessionSecs: 60,
  trackingPaused: false,
  closeBehavior: "tray",
  minimizeBehavior: "taskbar",
  themeMode: "light",
  language: "zh-CN",
  hourlyActivityChartMode: "total",
  colorSchemeLight: "default",
  colorSchemeDark: "default",
  launchAtLogin: false,
  startMinimized: false,
  backgroundOptimization: false,
  onboardingCompleted: false,
  localApiEnabled: false,
  localApiPort: 12345,
  localApiToken: "",
  webActivityEnabled: false,
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

class MemoryStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function withWindowStorage(storage: MemoryStorage, fn: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });

  try {
    fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
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
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
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
    candidates: [candidate],
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
    candidates: [candidate],
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

await runTest("widget window controller covers expand collapse focus-loss collapse and drag placement", async () => {
  const scheduler = new FakeScheduler();
  const events: string[] = [];
  let placementFromCallback = "right:0.28";
  let expandedFromCallback = false;
  let currentRect: WidgetWindowRect | null = {
    position: { x: 1500, y: 300 },
    size: { width: 228, height: 48 },
  };
  let currentMonitor: WidgetMonitorLike | null = {
    workArea: {
      position: { x: 1000, y: 0 },
      size: { width: 1000, height: 900 },
    },
  };

  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => ({ side: "left", anchorY: 0.4 }),
    persistExpanded: async (nextExpanded, showObjectSlot) => {
      events.push(`expanded:${nextExpanded}:${showObjectSlot}`);
    },
    applyLayout: async (placement, nextExpanded, showObjectSlot) => {
      events.push(`layout:${placement.side}:${placement.anchorY.toFixed(2)}:${nextExpanded}:${showObjectSlot}`);
    },
    onCollapsedDragSettled: () => {
      events.push("settled");
    },
    readWindowRect: async () => currentRect,
    resolveMonitorForWindowRect: async (
      _position: WidgetWindowPosition,
      _size: WidgetWindowSize,
    ) => currentMonitor,
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
    onPlacementChange: (placement) => {
      placementFromCallback = `${placement.side}:${placement.anchorY.toFixed(2)}`;
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

  const eventsBeforeExpandedMove = events.length;
  controller.handleWindowMoved();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(events.length, eventsBeforeExpandedMove);
  assert.equal(placementFromCallback, "left:0.40");

  const eventsBeforeFocusCollapse = events.length;
  controller.handleFocusChanged(false);
  await flushMicrotasks();
  assert.equal(expandedFromCallback, false);
  assert.equal(events.length, eventsBeforeFocusCollapse);
  scheduler.flushAll();
  await flushMicrotasks();
  assert.deepEqual(events.slice(-1), ["expanded:false:false"]);

  currentRect = {
    position: { x: 1500, y: 300 },
    size: { width: 64, height: 48 },
  };
  controller.handleWindowMoved();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(placementFromCallback, "right:0.35");
  assert.ok(events.includes("layout:right:0.35:false:false"));
});

await runTest("widget controller snaps collapsed drag to the nearest edge", async () => {
  const scheduler = new FakeScheduler();
  const events: string[] = [];
  let placementFromCallback = "right:0.28";
  const currentRect: WidgetWindowRect = {
    position: { x: 1008, y: 426 },
    size: { width: 64, height: 48 },
  };
  const currentMonitor: WidgetMonitorLike = {
    workArea: {
      position: { x: 1000, y: 0 },
      size: { width: 1000, height: 900 },
    },
  };

  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => ({ side: "left", anchorY: 0.4 }),
    persistExpanded: async (nextExpanded, showObjectSlot) => {
      events.push(`expanded:${nextExpanded}:${showObjectSlot}`);
    },
    applyLayout: async (placement, nextExpanded, showObjectSlot) => {
      events.push(`layout:${placement.side}:${placement.anchorY.toFixed(2)}:${nextExpanded}:${showObjectSlot}`);
    },
    onCollapsedDragSettled: () => {
      events.push("settled");
    },
    readWindowRect: async () => currentRect,
    resolveMonitorForWindowRect: async (
      _position: WidgetWindowPosition,
      _size: WidgetWindowSize,
    ) => currentMonitor,
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
    onPlacementChange: (placement) => {
      placementFromCallback = `${placement.side}:${placement.anchorY.toFixed(2)}`;
    },
  });

  await controller.initialize();

  controller.beginUserDrag();
  controller.handleWindowMoved();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(placementFromCallback, "left:0.40");
  assert.deepEqual(events, []);

  controller.endUserDrag();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(placementFromCallback, "left:0.50");
  assert.deepEqual(events, ["layout:left:0.50:false:true", "settled"]);
});

await runTest("widget controller settles collapsed drag when move event is missed", async () => {
  const scheduler = new FakeScheduler();
  const events: string[] = [];
  let placementFromCallback = "right:0.28";
  const currentRect: WidgetWindowRect = {
    position: { x: 1008, y: 426 },
    size: { width: 64, height: 48 },
  };
  const currentMonitor: WidgetMonitorLike = {
    workArea: {
      position: { x: 1000, y: 0 },
      size: { width: 1000, height: 900 },
    },
  };

  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => ({ side: "left", anchorY: 0.4 }),
    persistExpanded: async (nextExpanded, showObjectSlot) => {
      events.push(`expanded:${nextExpanded}:${showObjectSlot}`);
    },
    applyLayout: async (placement, nextExpanded, showObjectSlot) => {
      events.push(`layout:${placement.side}:${placement.anchorY.toFixed(2)}:${nextExpanded}:${showObjectSlot}`);
    },
    onCollapsedDragSettled: () => {
      events.push("settled");
    },
    readWindowRect: async () => currentRect,
    resolveMonitorForWindowRect: async (
      _position: WidgetWindowPosition,
      _size: WidgetWindowSize,
    ) => currentMonitor,
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
    onPlacementChange: (placement) => {
      placementFromCallback = `${placement.side}:${placement.anchorY.toFixed(2)}`;
    },
  });

  await controller.initialize();

  controller.beginUserDrag();
  controller.endUserDrag();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(placementFromCallback, "left:0.50");
  assert.deepEqual(events, ["layout:left:0.50:false:true", "settled"]);
});

await runTest("widget controller keeps collapsed drag settled callback when moved event races release", async () => {
  const scheduler = new FakeScheduler();
  const events: string[] = [];
  let placementFromCallback = "right:0.28";
  const currentRect: WidgetWindowRect = {
    position: { x: 1008, y: 426 },
    size: { width: 64, height: 48 },
  };
  const currentMonitor: WidgetMonitorLike = {
    workArea: {
      position: { x: 1000, y: 0 },
      size: { width: 1000, height: 900 },
    },
  };

  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => ({ side: "left", anchorY: 0.4 }),
    persistExpanded: async (nextExpanded, showObjectSlot) => {
      events.push(`expanded:${nextExpanded}:${showObjectSlot}`);
    },
    applyLayout: async (placement, nextExpanded, showObjectSlot) => {
      events.push(`layout:${placement.side}:${placement.anchorY.toFixed(2)}:${nextExpanded}:${showObjectSlot}`);
    },
    onCollapsedDragSettled: () => {
      events.push("settled");
    },
    readWindowRect: async () => currentRect,
    resolveMonitorForWindowRect: async (
      _position: WidgetWindowPosition,
      _size: WidgetWindowSize,
    ) => currentMonitor,
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
    onPlacementChange: (placement) => {
      placementFromCallback = `${placement.side}:${placement.anchorY.toFixed(2)}`;
    },
  });

  await controller.initialize();

  controller.beginUserDrag();
  controller.endUserDrag();
  controller.handleWindowMoved();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(placementFromCallback, "left:0.50");
  assert.deepEqual(events, ["layout:left:0.50:false:true", "settled"]);
});

await runTest("widget controller accepts runtime collapse without persisting another layout", async () => {
  const scheduler = new FakeScheduler();
  const events: string[] = [];
  let expandedFromCallback = false;
  let placementFromCallback = "right:0.28";
  let currentRect: WidgetWindowRect | null = {
    position: { x: -32_000, y: -32_000 },
    size: { width: 1, height: 1 },
  };
  const currentMonitor: WidgetMonitorLike = {
    workArea: {
      position: { x: 1000, y: 0 },
      size: { width: 1000, height: 900 },
    },
  };

  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => ({ side: "right", anchorY: 0.28 }),
    persistExpanded: async (nextExpanded, showObjectSlot) => {
      events.push(`expanded:${nextExpanded}:${showObjectSlot}`);
    },
    applyLayout: async (placement, nextExpanded, showObjectSlot) => {
      events.push(`layout:${placement.side}:${placement.anchorY.toFixed(2)}:${nextExpanded}:${showObjectSlot}`);
    },
    readWindowRect: async () => currentRect,
    resolveMonitorForWindowRect: async () => currentMonitor,
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
    onPlacementChange: (placement) => {
      placementFromCallback = `${placement.side}:${placement.anchorY.toFixed(2)}`;
    },
    onExpandedChange: (nextExpanded) => {
      expandedFromCallback = nextExpanded;
    },
  });

  await controller.initialize();
  controller.expand();
  await flushMicrotasks();
  assert.equal(expandedFromCallback, true);
  assert.deepEqual(events, ["expanded:true:true"]);

  controller.syncCollapsedFromRuntime();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(expandedFromCallback, false);
  assert.deepEqual(events, ["expanded:true:true"]);

  controller.handleWindowMoved();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(placementFromCallback, "right:0.28");
  assert.deepEqual(events, ["expanded:true:true"]);

  controller.syncShownFromRuntime();
  currentRect = {
    position: { x: 1500, y: 300 },
    size: { width: 64, height: 48 },
  };
  controller.handleWindowMoved();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(placementFromCallback, "right:0.35");
  assert.deepEqual(events.slice(-1), ["layout:right:0.35:false:true"]);
});

console.log(`Passed ${passed} interaction flow tests`);
