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
} from "../src/app/widget/widgetWindowController.ts";
import type { WidgetPlacement } from "../src/platform/desktop/widgetRuntimeGateway.ts";
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

const BASE_SETTINGS: AppSettings = {
  idleTimeoutSecs: 300,
  timelineMergeGapSecs: 60,
  refreshIntervalSecs: 1,
  minSessionSecs: 60,
  trackingPaused: false,
  titleRecordingEnabled: true,
  closeBehavior: "tray",
  minimizeBehavior: "taskbar",
  themeMode: "light",
  language: "zh-CN",
  hourlyActivityChartMode: "total",
  dynamicEffects: true,
  colorSchemeLight: "default",
  colorSchemeDark: "default",
  launchAtLogin: false,
  startMinimized: false,
  backgroundOptimization: false,
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

function buildWidgetPlacement(
  side: WidgetPlacement["side"],
  anchorY: number,
  monitorName: string | null = null,
): WidgetPlacement {
  return {
    monitor: monitorName
      ? {
          name: monitorName,
          workArea: { x: 1920, y: 0, width: 2560, height: 1392 },
        }
      : null,
    side,
    anchorY,
  };
}

await runTest("widget window controller covers expand collapse and Rust-owned drag finalization", async () => {
  const scheduler = new FakeScheduler();
  const events: string[] = [];
  let placementFromCallback = "right:0.28:none";
  let expandedFromCallback = false;
  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => buildWidgetPlacement("left", 0.4, "DISPLAY1"),
    persistExpanded: async (nextExpanded, showObjectSlot) => {
      events.push(`expanded:${nextExpanded}:${showObjectSlot}`);
    },
    applyLayout: async (nextExpanded, showObjectSlot) => {
      events.push(`layout:${nextExpanded}:${showObjectSlot}`);
    },
    finalizeDrag: async () => {
      events.push("finalize");
      return buildWidgetPlacement("right", 0.35, "DISPLAY2");
    },
    onCollapsedDragSettled: () => {
      events.push("settled");
    },
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
    onPlacementChange: (placement) => {
      placementFromCallback = `${placement.side}:${placement.anchorY.toFixed(2)}:${placement.monitor?.name ?? "none"}`;
    },
    onExpandedChange: (nextExpanded) => {
      expandedFromCallback = nextExpanded;
    },
  });

  await controller.initialize();
  assert.equal(placementFromCallback, "left:0.40:DISPLAY1");

  controller.expand();
  await flushMicrotasks();
  assert.equal(expandedFromCallback, true);
  assert.deepEqual(events, ["expanded:true:true"]);

  controller.setShowObjectSlot(false);
  await flushMicrotasks();
  assert.ok(events.includes("layout:true:false"));
  scheduler.flushAll();
  await flushMicrotasks();

  const eventsBeforeExpandedMove = events.length;
  controller.handleWindowMoved();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(events.length, eventsBeforeExpandedMove);

  controller.handleFocusChanged(false);
  assert.equal(expandedFromCallback, false);
  scheduler.flushAll();
  await flushMicrotasks();
  assert.deepEqual(events.slice(-1), ["expanded:false:false"]);

  controller.beginUserDrag();
  controller.endUserDrag();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(placementFromCallback, "right:0.35:DISPLAY2");
  assert.deepEqual(events.slice(-2), ["finalize", "settled"]);
});

await runTest("widget controller finalizes a collapsed drag even when move event is missed", async () => {
  const scheduler = new FakeScheduler();
  const events: string[] = [];
  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => buildWidgetPlacement("left", 0.4),
    persistExpanded: async () => undefined,
    applyLayout: async () => undefined,
    finalizeDrag: async () => {
      events.push("finalize");
      return buildWidgetPlacement("left", 0.5, "DISPLAY2");
    },
    onCollapsedDragSettled: () => events.push("settled"),
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
  });

  await controller.initialize();
  controller.beginUserDrag();
  controller.endUserDrag();
  scheduler.flushAll();
  await flushMicrotasks();

  assert.equal(controller.getState().placement.monitor?.name, "DISPLAY2");
  assert.deepEqual(events, ["finalize", "settled"]);
});

await runTest("widget controller preserves the captured physical release point until finalization", async () => {
  const scheduler = new FakeScheduler();
  const capturedPoints: Array<{ x: number; y: number } | null> = [];
  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => buildWidgetPlacement("right", 0.28),
    persistExpanded: async () => undefined,
    applyLayout: async () => undefined,
    finalizeDrag: async (releasePosition) => {
      capturedPoints.push(releasePosition);
      return buildWidgetPlacement("left", 0.5, "DISPLAY2");
    },
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
  });

  await controller.initialize();
  controller.beginUserDrag();
  controller.endUserDrag({ x: -17, y: 640 });
  scheduler.flushAll();
  await flushMicrotasks();

  assert.deepEqual(capturedPoints, [{ x: -17, y: 640 }]);
});

await runTest("widget controller rejects a late release point from an older drag generation", async () => {
  const scheduler = new FakeScheduler();
  const finalizedPoints: Array<{ x: number; y: number } | null> = [];
  let resolveFirstRelease: ((point: { x: number; y: number }) => void) | null = null;
  const firstRelease = new Promise<{ x: number; y: number }>((resolve) => {
    resolveFirstRelease = resolve;
  });
  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => buildWidgetPlacement("right", 0.28),
    persistExpanded: async () => undefined,
    applyLayout: async () => undefined,
    finalizeDrag: async (releasePosition) => {
      finalizedPoints.push(releasePosition);
      return buildWidgetPlacement("right", 0.75, "DISPLAY2");
    },
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
  });

  await controller.initialize();
  controller.beginUserDrag();
  controller.endUserDrag(firstRelease);
  scheduler.flushAll();
  await flushMicrotasks();

  controller.beginUserDrag();
  controller.endUserDrag({ x: 2200, y: 720 });
  scheduler.flushAll();
  await flushMicrotasks();
  assert.deepEqual(finalizedPoints, []);

  assert.ok(resolveFirstRelease);
  resolveFirstRelease({ x: 100, y: 100 });
  await flushMicrotasks();

  assert.deepEqual(finalizedPoints, [{ x: 2200, y: 720 }]);
});

await runTest("widget controller coalesces moved events racing drag release", async () => {
  const scheduler = new FakeScheduler();
  let finalizeCount = 0;
  let settledCount = 0;
  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => buildWidgetPlacement("left", 0.4),
    persistExpanded: async () => undefined,
    applyLayout: async () => undefined,
    finalizeDrag: async () => {
      finalizeCount += 1;
      return buildWidgetPlacement("left", 0.5, "DISPLAY2");
    },
    onCollapsedDragSettled: () => {
      settledCount += 1;
    },
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
  });

  await controller.initialize();
  controller.beginUserDrag();
  controller.endUserDrag();
  controller.handleWindowMoved();
  controller.handleWindowMoved();
  scheduler.flushAll();
  await flushMicrotasks();

  assert.equal(finalizeCount, 1);
  assert.equal(settledCount, 1);

  controller.handleWindowMoved();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(finalizeCount, 1, "programmatic snap movement must not re-finalize");
});

await runTest("widget controller ignores stale drag results and serializes finalization", async () => {
  const scheduler = new FakeScheduler();
  const events: string[] = [];
  let resolveFirst: ((placement: WidgetPlacement) => void) | null = null;
  let finalizeCount = 0;
  let placementFromCallback = "right:none";
  const firstResult = new Promise<WidgetPlacement>((resolve) => {
    resolveFirst = resolve;
  });
  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => buildWidgetPlacement("right", 0.28),
    persistExpanded: async () => undefined,
    applyLayout: async () => undefined,
    finalizeDrag: async () => {
      finalizeCount += 1;
      events.push(`finalize:${finalizeCount}`);
      return finalizeCount === 1
        ? firstResult
        : buildWidgetPlacement("right", 0.8, "DISPLAY2");
    },
    onPlacementChange: (placement) => {
      placementFromCallback = `${placement.side}:${placement.monitor?.name ?? "none"}`;
    },
    onCollapsedDragSettled: () => events.push("settled"),
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
  });

  await controller.initialize();
  controller.beginUserDrag();
  controller.endUserDrag();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(finalizeCount, 1);

  controller.beginUserDrag();
  controller.endUserDrag();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(finalizeCount, 1);

  assert.ok(resolveFirst);
  resolveFirst(buildWidgetPlacement("left", 0.1, "DISPLAY1"));
  await flushMicrotasks();

  assert.equal(finalizeCount, 2);
  assert.equal(placementFromCallback, "right:DISPLAY2");
  assert.deepEqual(events, ["finalize:1", "finalize:2", "settled"]);
});

await runTest("widget controller accepts runtime collapse without finalizing hidden movement", async () => {
  const scheduler = new FakeScheduler();
  const events: string[] = [];
  let expandedFromCallback = false;
  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => buildWidgetPlacement("right", 0.28),
    persistExpanded: async (nextExpanded, showObjectSlot) => {
      events.push(`expanded:${nextExpanded}:${showObjectSlot}`);
    },
    applyLayout: async () => undefined,
    finalizeDrag: async () => {
      events.push("finalize");
      return buildWidgetPlacement("right", 0.35, "DISPLAY2");
    },
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
    onExpandedChange: (nextExpanded) => {
      expandedFromCallback = nextExpanded;
    },
  });

  await controller.initialize();
  controller.expand();
  await flushMicrotasks();
  assert.equal(expandedFromCallback, true);

  controller.syncCollapsedFromRuntime();
  controller.handleWindowMoved();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.equal(expandedFromCallback, false);
  assert.deepEqual(events, ["expanded:true:true"]);

  controller.syncShownFromRuntime();
  controller.handleWindowMoved();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.deepEqual(events, ["expanded:true:true"]);
});

await runTest("widget controller synchronizes the rendered side from native runtime layout", async () => {
  const scheduler = new FakeScheduler();
  const placements: string[] = [];
  const controller = createWidgetWindowController(false, {
    loadPlacement: async () => buildWidgetPlacement("left", 0.28, "DISPLAY1"),
    persistExpanded: async () => undefined,
    applyLayout: async () => undefined,
    finalizeDrag: async () => null,
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
    onPlacementChange: (placement) => {
      placements.push(`${placement.side}:${placement.monitor?.name ?? "none"}`);
    },
  });

  await controller.initialize();
  controller.syncShownFromRuntime(buildWidgetPlacement("right", 0.4, "DISPLAY2"));

  assert.deepEqual(placements, ["left:DISPLAY1", "right:DISPLAY2"]);
  assert.equal(controller.getState().placement.side, "right");
  assert.equal(controller.getState().placement.monitor?.name, "DISPLAY2");
});

await runTest("widget controller rejects stale initialization after a native placement event", async () => {
  const scheduler = new FakeScheduler();
  const placements: string[] = [];
  let resolveLoadedPlacement: ((placement: ReturnType<typeof buildWidgetPlacement>) => void) | null = null;
  const loadedPlacement = new Promise<ReturnType<typeof buildWidgetPlacement>>((resolve) => {
    resolveLoadedPlacement = resolve;
  });
  const controller = createWidgetWindowController(false, {
    loadPlacement: async () => loadedPlacement,
    persistExpanded: async () => undefined,
    applyLayout: async () => undefined,
    finalizeDrag: async () => null,
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
    onPlacementChange: (placement) => {
      placements.push(`${placement.side}:${placement.monitor?.name ?? "none"}`);
    },
  });

  const initialization = controller.initialize();
  controller.syncShownFromRuntime(buildWidgetPlacement("right", 0.4, "DISPLAY2"));
  assert.ok(resolveLoadedPlacement);
  resolveLoadedPlacement(buildWidgetPlacement("left", 0.2, "DISPLAY1"));
  await initialization;

  assert.deepEqual(placements, ["right:DISPLAY2"]);
  assert.equal(controller.getState().placement.side, "right");
  assert.equal(controller.getState().placement.monitor?.name, "DISPLAY2");
});

await runTest("widget controller reapplies DPI layout without interrupting drag finalization", async () => {
  const scheduler = new FakeScheduler();
  const events: string[] = [];
  const controller = createWidgetWindowController(true, {
    loadPlacement: async () => buildWidgetPlacement("right", 0.5, "DISPLAY1"),
    persistExpanded: async (nextExpanded, showObjectSlot) => {
      events.push(`expanded:${nextExpanded}:${showObjectSlot}`);
    },
    applyLayout: async (nextExpanded, showObjectSlot) => {
      events.push(`layout:${nextExpanded}:${showObjectSlot}`);
    },
    finalizeDrag: async () => {
      events.push("finalize");
      return buildWidgetPlacement("right", 0.5, "DISPLAY2");
    },
    schedule: (callback) => scheduler.schedule(callback),
    clearScheduled: (handle) => scheduler.clear(handle),
    onCollapsedDragSettled: () => events.push("settled"),
  });

  await controller.initialize();
  controller.handleScaleFactorChanged();
  await flushMicrotasks();
  assert.deepEqual(events, ["layout:false:true"]);
  scheduler.flushAll();
  await flushMicrotasks();

  controller.beginUserDrag();
  controller.handleScaleFactorChanged();
  controller.endUserDrag();
  scheduler.flushAll();
  await flushMicrotasks();
  assert.deepEqual(events.slice(-2), ["finalize", "settled"]);
  scheduler.flushAll();
  await flushMicrotasks();

  controller.expand();
  await flushMicrotasks();
  events.length = 0;
  controller.handleScaleFactorChanged();
  await flushMicrotasks();
  assert.deepEqual(events, ["layout:true:true"]);
});

console.log(`Passed ${passed} interaction flow tests`);
