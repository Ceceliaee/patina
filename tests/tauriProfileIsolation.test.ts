import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";

import {
  DEV_CONFIG_PATH,
  resolveTauriArguments,
} from "../scripts/tauri-cli.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseRuntimeMeasurementOptions,
  parseRuntimeFixtureManifest,
  prepareRuntimeFixture,
  fixtureExpectedTotal,
  assertFixtureProjectionSample,
  fingerprintRuntimeInputs,
  prepareRuntimeMeasurements,
  recordRuntimeMeasurementCleanup,
  summarizeRuntimeResources,
  summarizeRuntimeValues,
  navigationExpression,
  annualSelectionExpression,
  resolveFixtureHistoryDays,
  inspectFixtureHistoryDays,
  resourceSceneExpression,
  observeRuntimeResourceScene,
} from "../scripts/perf/tauri-runtime-measurements.ts";

function resourceSceneFixture() {
  const listeners = new Map<string, () => void>();
  const state = { visible: true, frameVisible: true, view: "dashboard", generation: 1,
    visibility: "visible", timeOrigin: 123, url: "http://127.0.0.1:1420/", paused: "0", optimization: "1" };
  let mutation: (() => void) | undefined;
  const calls: string[] = [];
  const context = {
    window: {
      get __PATINA_MAIN_WINDOW_GENERATION__() { return state.generation; },
      __TAURI_INTERNALS__: { invoke: async (command: string) => {
        calls.push(command);
        if (command === "plugin:window|is_visible") return state.visible;
        assert.equal(command, "plugin:sql|select", "resource observation must remain read-only");
        return [{ key: "tracking_paused", value: state.paused }, { key: "background_optimization", value: state.optimization }];
      } },
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    },
    document: {
      get visibilityState() { return state.visibility; },
      querySelector: (selector: string) => selector === "[data-sidebar-primary-nav]" ? {} : selector === ".qp-app-frame"
        ? { checkVisibility: () => state.frameVisible } : { dataset: { sidebarNavItem: state.view } },
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    },
    performance: { get timeOrigin() { return state.timeOrigin; } },
    location: { get href() { return state.url; } },
    MutationObserver: class {
      constructor(callback: () => void) { mutation = callback; }
      observe() {}
      disconnect() { mutation = undefined; }
    },
  };
  return { state, calls, listeners, context,
    navigate: () => mutation?.(),
    evaluate: async (expression: string) => {
      const value = await runInNewContext(expression, context);
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    },
    assertClean: () => { assert.equal(listeners.size, 0); assert.equal(mutation, undefined); },
  };
}

test("resource scene generated expressions retain transient hiding, navigation and pagehide until cleanup", async () => {
  for (const change of ["visibilitychange", "navigation", "pagehide"]) {
    const fixture = resourceSceneFixture();
    try {
      await fixture.evaluate(resourceSceneExpression("start"));
      if (change === "navigation") fixture.navigate();
      else {
        fixture.state.visibility = "hidden";
        fixture.listeners.get(change)!();
        fixture.state.visibility = "visible";
      }
      const sample = await fixture.evaluate(resourceSceneExpression("sample"));
      assert.ok(sample.violation, "a restored visible state must not erase a scene transition");
      assert.equal(sample.documentVisibility, "visible");
    } finally {
      await fixture.evaluate(resourceSceneExpression("stop"));
      fixture.assertClean();
    }
    await assert.rejects(fixture.evaluate(resourceSceneExpression("sample")), /observer lost/);
  }
});

test("resource observation checks the final scene and cancels sampling on hidden or replaced windows and changed settings", async () => {
  const changes = [
    { visible: false }, {}, { frameVisible: false }, { visibility: "hidden" }, { generation: 2 },
    { timeOrigin: 456 }, { url: "http://127.0.0.1:1420/replaced" }, { view: "data" }, { paused: "1" }, { optimization: "0" },
  ];
  for (const change of changes) {
    const fixture = resourceSceneFixture();
    const evidence: Record<string, unknown> = {};
    const events: Record<string, unknown>[] = [];
    const unchanged = Object.keys(change).length === 0;
    const observation = observeRuntimeResourceScene(fixture.evaluate, {
      intervalSeconds: 0.001, signal: new AbortController().signal, evidence, event: value => events.push(value),
    }, async () => { Object.assign(fixture.state, change); });
    if (unchanged) await observation;
    else await assert.rejects(observation);
    assert.equal(evidence.acceptanceEligible, unchanged);
    assert.equal(evidence.status, unchanged ? "completed" : "failed");
    assert.equal(evidence.sampleCount, 2, "operation completion still requires a final state observation");
    assert.equal(evidence.cleanupCompleted, true);
    fixture.assertClean();
    assert.equal(events.filter(event => event.kind === "resource-scene-failure").length, unchanged ? 0 : 1);
  }
  const fixture = resourceSceneFixture();
  const evidence: Record<string, unknown> = {};
  let samplingAborted = false;
  await assert.rejects(observeRuntimeResourceScene(fixture.evaluate, {
    intervalSeconds: 0.001, signal: new AbortController().signal, evidence, event: () => {},
  }, async signal => {
    fixture.state.visible = false;
    await new Promise<void>(resolve => signal.addEventListener("abort", () => { samplingAborted = true; resolve(); }, { once: true }));
  }), /hidden or missing/);
  assert.equal(samplingAborted, true, "scene failure must abort the existing resource sampler");
  fixture.assertClean();
});

test("resource observation rejects destroyed contexts, operation failures and interruption without reopening a window", async () => {
  for (const mode of ["destroyed", "operation", "abort"]) {
    const fixture = resourceSceneFixture();
    const controller = new AbortController();
    const evidence: Record<string, unknown> = {};
    let destroyed = false;
    const evaluate = async (expression: string) => {
      if (destroyed) throw new Error("CDP target destroyed");
      return fixture.evaluate(expression);
    };
    try {
      await assert.rejects(observeRuntimeResourceScene(evaluate, {
        intervalSeconds: 0.001, signal: controller.signal, evidence, event: () => {},
      }, async () => {
        if (mode === "destroyed") destroyed = true;
        if (mode === "operation") throw new Error("sampler failed");
        if (mode === "abort") controller.abort(new Error("test interruption"));
      }));
      assert.equal(evidence.acceptanceEligible, false);
      assert.equal(evidence.status, "failed");
      assert.equal(evidence.cleanupCompleted, mode !== "destroyed");
      if (mode === "destroyed") assert.match(String(evidence.cleanupError), /CDP target destroyed/);
    } finally {
      // A real destroyed document owns no live listeners; the VM fixture is explicitly disposed.
      await fixture.evaluate(resourceSceneExpression("stop"));
      fixture.assertClean();
    }
  }
});

test("resource scene observation has a real deadline and cleans listeners even when native visibility never resolves", async () => {
  const fixture = resourceSceneFixture();
  const original = fixture.context.window.__TAURI_INTERNALS__.invoke;
  let finishRead: (() => void) | undefined;
  fixture.context.window.__TAURI_INTERNALS__.invoke = async command => {
    if (command === "plugin:window|is_visible") await new Promise<void>(resolve => { finishRead = resolve; });
    return original(command);
  };
  const evidence: Record<string, unknown> = {};
  try {
    await assert.rejects(observeRuntimeResourceScene(fixture.evaluate, {
      intervalSeconds: 5, signal: new AbortController().signal, evidence, event: () => {},
    }, async () => { assert.fail("sampling must not start without a scene precondition"); }), /observation timed out/);
    assert.equal(evidence.acceptanceEligible, false);
    assert.equal(evidence.sampleCount, 0);
    assert.equal(evidence.cleanupCompleted, true);
    fixture.assertClean();
  } finally {
    finishRead?.();
    await fixture.evaluate(resourceSceneExpression("stop"));
    fixture.assertClean();
  }
});

test("resource completion cannot discard an invalid periodic read already in flight", async () => {
  const fixture = resourceSceneFixture();
  let periodicEntered: () => void = () => {};
  const entered = new Promise<void>(resolve => { periodicEntered = resolve; });
  let releasePeriodic: () => void = () => {};
  const periodic = new Promise<void>(resolve => { releasePeriodic = resolve; });
  let invalidObserved: () => void = () => {};
  const invalid = new Promise<void>(resolve => { invalidObserved = resolve; });
  const original = fixture.context.window.__TAURI_INTERNALS__.invoke;
  let reads = 0;
  fixture.context.window.__TAURI_INTERNALS__.invoke = async command => {
    const result = await original(command);
    if (command === "plugin:sql|select") {
      const read = ++reads;
      if (read === 2) { periodicEntered(); await periodic; }
      if (read === 3) await invalid;
    }
    return result;
  };
  const evidence: Record<string, unknown> = {};
  let release: ReturnType<typeof setImmediate> | undefined;
  try {
    await assert.rejects(observeRuntimeResourceScene(fixture.evaluate, {
      intervalSeconds: 0.001, signal: new AbortController().signal, evidence,
      event: value => { if (value.trackingPaused === "1") invalidObserved(); },
    }, async () => {
      fixture.state.paused = "1";
      await entered;
      fixture.state.paused = "0";
      // Let operation completion reach the observer before releasing its older read.
      release = setImmediate(releasePeriodic);
    }), /tracking is paused/);
    assert.equal(evidence.acceptanceEligible, false);
    assert.equal(evidence.sampleCount, 2);
    assert.equal(reads, 2, "a failed periodic observation must stop the final success read");
    fixture.assertClean();
  } finally {
    clearImmediate(release);
    releasePeriodic();
    invalidObserved();
    await fixture.evaluate(resourceSceneExpression("stop"));
    fixture.assertClean();
  }
});

test("History navigation records trusted content before fresh completion and rejects stale or failed completion", async () => {
  for (const dateAction of [undefined, "calendar", "previous", "next"] as const) {
    const createNavigation = () => {
      const now = new Date();
      const dateKey = dateAction ? "2023-12-31" : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const dataset = { historyContentState: "refreshing", historyContentMeaningful: "true",
        historyContentDate: dateKey, historyRequestedDate: dateKey,
        historyContentMappingVersion: "3", historyRequestedMappingVersion: "3" };
      const surface = { active: true, visible: true, segments: 1000, duration: "6h 0m", actions: [] as string[] };
      const root = { dataset,
        querySelector: (selector: string) => selector.includes("day-summary") ? { textContent: surface.duration } : { checkVisibility: () => surface.visible },
        querySelectorAll: () => Array.from({ length: surface.segments }),
      };
      const action = (name: string) => ({ click: () => { surface.actions.push(name); } });
      const header = { textContent: new Date(dateKey + "T12:00:00").toLocaleDateString("zh-CN", { month: "short", day: "numeric" }),
        parentElement: { previousElementSibling: action("previous"), nextElementSibling: action("next") } };
      const node = { ...action("sidebar"), getAttribute: () => surface.active ? "page" : null };
      let elapsed = 0;
      let callbacks: Array<() => void> = [];
      let expire: () => void = () => undefined;
      const promise = runInNewContext(navigationExpression("history", dateAction ? { dateKey, action: dateAction, expectedTotalDurationMs: 21_600_000 } : undefined), {
        document: { documentElement: { lang: "zh-CN" }, querySelector: (selector: string) => selector.includes("sidebar") ? node
          : selector === ".history-date-label" ? header : selector.includes("history-calendar") ? action("calendar")
          : selector.includes("day-summary") ? root.querySelector(selector) : root,
        querySelectorAll: root.querySelectorAll },
        performance: { now: () => elapsed, getEntriesByType: () => [] }, Date,
        requestAnimationFrame: (callback: () => void) => callbacks.push(callback),
        setTimeout: (callback: () => void) => { expire = callback; }, clearTimeout: () => undefined,
      }) as Promise<{ meaningfulContentMs: number; meaningfulContentState: string; completeMs: number; freshCompleteMs: number }>;
      return { dataset, surface, promise, expire: () => expire(), frame: (time: number) => {
        elapsed = time;
        const pending = callbacks;
        callbacks = [];
        pending.forEach(callback => callback());
      } };
    };
    const successful = createNavigation();
    successful.frame(16);
    successful.dataset.historyContentState = "ready";
    successful.frame(100);
    successful.frame(116);
    const result = await successful.promise;
    assert.equal(result.meaningfulContentMs, 16);
    assert.equal(result.meaningfulContentState, "refreshing");
    assert.equal(result.completeMs, 116);
    assert.equal(result.freshCompleteMs, result.completeMs);
    assert.deepEqual(successful.surface.actions, [dateAction ?? "sidebar"]);

    for (const regression of ["refreshing", "inactive", "hidden"] as const) {
      const changed = createNavigation();
      let settled = false;
      void changed.promise.then(() => { settled = true; }, () => { settled = true; });
      changed.frame(16);
      changed.dataset.historyContentState = "ready";
      changed.frame(100);
      if (regression === "refreshing") changed.dataset.historyContentState = "refreshing";
      else changed.surface[regression === "inactive" ? "active" : "visible"] = false;
      changed.frame(116);
      await Promise.resolve();
      assert.equal(settled, false, `${regression} content must not complete in the queued frame`);
      changed.dataset.historyContentState = "ready";
      changed.surface.active = true;
      changed.surface.visible = true;
      changed.frame(200);
      changed.frame(216);
      const restored = await changed.promise;
      assert.equal(restored.meaningfulContentMs, 16);
      assert.equal(restored.freshCompleteMs, 216);
    }

    const pendingRefresh = createNavigation();
    pendingRefresh.frame(16);
    pendingRefresh.dataset.historyContentState = "ready";
    pendingRefresh.frame(100);
    pendingRefresh.dataset.historyContentState = "refreshing";
    pendingRefresh.frame(116);
    pendingRefresh.expire();
    await assert.rejects(pendingRefresh.promise, /content timed out: history/);

    for (const mismatch of ["date", "mapping"] as const) {
      const stale = createNavigation();
      if (mismatch === "date") stale.dataset.historyContentDate = "2000-01-01";
      else stale.dataset.historyContentMappingVersion = "2";
      stale.frame(16);
      stale.dataset.historyContentState = "ready";
      stale.frame(100);
      stale.frame(116);
      if (dateAction && mismatch === "date") stale.expire();
      await assert.rejects(stale.promise, dateAction && mismatch === "date" ? /content timed out/ : /without a stable meaningful identity/);
    }
    if (dateAction) for (const invalid of ["empty-timeline", "wrong-total"] as const) {
      const selection = createNavigation();
      if (invalid === "empty-timeline") selection.surface.segments = 0;
      else selection.surface.duration = "5h 0m";
      selection.dataset.historyContentState = "ready";
      selection.frame(16);
      selection.frame(32);
      await assert.rejects(selection.promise, /without a stable meaningful identity/);
    }
    const failed = createNavigation();
    failed.frame(16);
    failed.dataset.historyContentState = "error";
    failed.frame(100);
    failed.expire();
    await assert.rejects(failed.promise, /content timed out: history/);
  }
});

test("dense local days use the independent oracle and a read-only fact inventory", () => {
  for (const profile of ["r1", "r3"] as const) {
    const fixture = parseRuntimeFixtureManifest(fixtureManifest(profile));
    const candidates = fixture.dailyOracle.slice(-3).map(day => ({ dateKey: new Date(day.dayStartMs).toISOString().slice(0, 10),
      startMs: day.dayStartMs - 8 * 3_600_000, endMs: day.dayStartMs + 16 * 3_600_000 }));
    const selected = resolveFixtureHistoryDays(fixture, candidates);
    assert.equal(selected.latest.dateKey, profile === "r1" ? "2023-12-31" : "2025-12-30");
    assert.equal(selected.previous.endMs, selected.latest.startMs);
    assert.equal(selected.latest.expectedTotalDurationMs, 21_600_000);
    assert.equal(selected.previous.expectedTotalDurationMs, 21_600_000);
    assert.throws(() => resolveFixtureHistoryDays(fixture, candidates.map(day => ({ ...day,
      startMs: day.startMs + 12 * 3_600_000, endMs: day.endMs + 12 * 3_600_000 }))), /no adjacent complete dense local days/);
  }
  const root = fs.mkdtempSync(join(tmpdir(), "patina-dense-day-inventory-"));
  const database = join(root, "patina.db");
  const days = [30, 31].map(day => ({ dateKey: `2023-12-${day}`, startMs: Date.UTC(2023, 11, day) - 8 * 3_600_000,
    endMs: Date.UTC(2023, 11, day) + 16 * 3_600_000, expectedTotalDurationMs: 21_600_000 }));
  try {
    const created = spawnSync("python", ["-c", `
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    for table, column, count in [('sessions','start_time',1001), ('import_exact_sessions','start_time',3), ('import_time_buckets','bucket_start_time',2), ('web_activity_segments','start_time',10)]:
        db.execute('CREATE TABLE ' + table + '(' + column + ' INTEGER)')
        db.executemany('INSERT INTO ' + table + ' VALUES (?)', [(int(start) + offset,) for start in sys.argv[2:] for offset in range(count)])
`, database, ...[30, 31].map(day => String(Date.UTC(2023, 11, day)))], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
    assert.equal(created.status, 0, created.stderr);
    const before = fs.readFileSync(database);
    const counts = inspectFixtureHistoryDays(database, days);
    assert.deepEqual(counts.map(row => [row.nativeRows, row.exactRows, row.bucketRows, row.webRows]), [[1001, 3, 2, 10], [1001, 3, 2, 10]]);
    assert.deepEqual(fs.readFileSync(database), before, "inventory leaves source bytes unchanged");
    const absent = join(root, "absent.db");
    assert.throws(() => inspectFixtureHistoryDays(absent, days), /dense-day source inspection failed/);
    assert.equal(fs.existsSync(absent), false, "mode=ro must not create an absent source");
    assert.throws(() => inspectFixtureHistoryDays(database, days.map(day => ({ ...day, startMs: day.startMs + 36_000_000 }))), /1001 native facts/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("annual content stays trusted in the completion frame without restarting its deadline", async () => {
  const flushMicrotasks = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
  const createSelection = async () => {
    let elapsed = 0;
    let pickerOpen = false;
    let draft = false;
    let mode = 0;
    let timerId = 0;
    let callbacks: Array<() => void> = [];
    const timers = new Map<number, () => void>();
    const content = { ready: true, duration: "1h 0m", points: 12 };
    const trigger = { textContent: "7 days", click: () => { pickerOpen = true; } };
    const next = { disabled: false, click: () => { trigger.textContent = ["day", "month", "2023年"][mode++]; } };
    const panel = {
      getAttribute: () => content.ready ? "false" : "true",
      querySelector: (selector: string) => selector === ".data-trend-range-trigger" ? trigger
        : selector.includes("last-child") ? next
        : selector.includes("inline-metric") ? { textContent: content.duration } : null,
      querySelectorAll: () => Array.from({ length: content.points }),
    };
    const promise = runInNewContext(annualSelectionExpression(2023, 3_600_000), {
      document: { querySelector: (selector: string) => {
        if (selector === ".data-overview .data-trend-panel") return panel;
        if (selector === ".qp-range-picker") return pickerOpen ? {} : null;
        if (selector.includes(":not([data-muted])")) return { getAttribute: () => "2023-01-01" };
        if (selector.includes("data-range-picker-date=")) return { click: () => { draft = true; } };
        if (selector.includes("qp-range-picker-footer")) return { disabled: !draft, click: () => { pickerOpen = false; } };
        if (selector.includes("data-data-content-state")) return { checkVisibility: () => true };
        throw new Error(`Unexpected annual selector: ${selector}`);
      } },
      performance: { now: () => elapsed },
      requestAnimationFrame: (callback: () => void) => callbacks.push(callback),
      cancelAnimationFrame: () => undefined,
      setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
      clearTimeout: (id: number) => timers.delete(id),
    }) as Promise<{ completeMs: number; rangeLabel: string; actualDuration: string; chartPoints: number }>;
    await flushMicrotasks();
    assert.equal(callbacks.length, 1, "selection reached the final content frame");
    return { content, trigger, promise, timers, frame: async (time: number) => {
      elapsed = time;
      const pending = callbacks;
      callbacks = [];
      pending.forEach(callback => callback());
      await flushMicrotasks();
    } };
  };
  for (const regression of ["ready", "range", "total", "points"] as const) {
    const selection = await createSelection();
    let settled = false;
    void selection.promise.then(() => { settled = true; }, () => { settled = true; });
    if (regression === "ready") selection.content.ready = false;
    if (regression === "range") selection.trigger.textContent = "2022年";
    if (regression === "total") selection.content.duration = "0s";
    if (regression === "points") selection.content.points = 0;
    await selection.frame(16);
    assert.equal(settled, false, `annual ${regression} changed before completion`);
    selection.content.ready = true;
    selection.trigger.textContent = "2023年";
    selection.content.duration = "1h 0m";
    selection.content.points = 12;
    await selection.frame(32);
    await selection.frame(48);
    const result = await selection.promise;
    assert.equal(result.completeMs, 48);
    assert.equal(result.rangeLabel, "2023年");
    assert.equal(result.actualDuration, "1h 0m");
    assert.equal(result.chartPoints, 12);
  }
  const pending = await createSelection();
  const originalTimers = [...pending.timers.keys()];
  assert.equal(originalTimers.length, 1);
  pending.content.ready = false;
  await pending.frame(16);
  await pending.frame(32);
  assert.deepEqual([...pending.timers.keys()], originalTimers);
  pending.timers.get(originalTimers[0])!();
  await assert.rejects(pending.promise, /annual fixture UI timeout: trusted annual content/);
});

test("runtime measurement uses an explicit new output and at least 30 navigation samples", () => {
  assert.equal(parseRuntimeMeasurementOptions([]), null);
  const output = join(tmpdir(), "runtime-report.json");
  assert.deepEqual(parseRuntimeMeasurementOptions(["--measure", "--output", output]), {
    output, samples: 30, warmupSeconds: 300, resourceSeconds: 600, intervalSeconds: 5,
  });
  for (const args of [[], ["--output", "relative.json"], ["--output", output, "--samples", "29"],
    ["--output", output, "--resource-seconds", "28801"], ["--output", output, "--samples", "30.5"],
    ["--output", output, "--output", output], ["--output", output, "--unknown", "1"]]) {
    assert.throws(() => parseRuntimeMeasurementOptions(["--measure", ...args]));
  }
});

function fixtureManifest(profile: "e0" | "r1" | "r3" = "e0", database = Buffer.from("fixture bytes")) {
  const days = { e0: 0, r1: 365, r3: 1095 }[profile];
  const start = Date.UTC(2023, 0, 1);
  const dayMs = 86_400_000;
  const year = profile === "r3" ? 2025 : 2023;
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);
  const queryDays = Math.min(days, 365);
  const queryStart = start + (days - queryDays) * dayMs;
  const queryEnd = start + (days === 0 ? dayMs : (days - 1) * dayMs + 36_000_000);
  const boundaries = Array.from({ length: Math.max(queryDays, 1) + 1 }, (_, index) => queryStart + index * dayMs);
  boundaries[boundaries.length - 1] = queryEnd;
  const factDays = profile === "e0" ? 0 : profile === "r3" ? 364 : 365;
  const verifiedDiversity = { appCount: profile === "e0" ? 0 : profile === "r3" ? 49 : 17, projectionAppCount: profile === "e0" ? 0 : profile === "r3" ? 49 : 17,
    importSourceCount: profile === "e0" ? 0 : profile === "r3" ? 6 : 2, domainCount: profile === "e0" ? 0 : profile === "r3" ? 30 : 10 };
  return { fixtureVersion: 2, profile, days,
    seed: { kind: "deterministic-grid", version: 2, utcStartMs: start, cohortDays: 365,
      dailyCoverageStartOffsetMs: 0, dailyCoverageEndOffsetMs: 36_000_000 },
    database: { file: "patina.db", sha256: createHash("sha256").update(database).digest("hex"), bytes: database.length, closed: true, checkpointed: true },
    schemaIdentity: { userVersion: 0, sqlxMigrations: [{ version: 1, checksum: "AB".repeat(48), success: true }] },
    query: { startMs: queryStart, endMs: queryEnd, localDayBoundariesMs: boundaries, boundaryTimezone: "UTC", expectedTotalDurationMs: queryDays * 21_600_000, verifiedDiversity },
    yearQuery: { year, startMs: yearStart, endMs: yearEnd, localDayBoundariesMs: Array.from({ length: (yearEnd - yearStart) / dayMs + 1 }, (_, index) => yearStart + index * dayMs),
      boundaryTimezone: "UTC", factDays, expectedTotalDurationMs: factDays * 21_600_000, verifiedDiversity },
    dailyOracle: Array.from({ length: days }, (_, index) => ({ dayStartMs: start + index * dayMs, totalDurationMs: 21_600_000, nativeDurationMs: 16_200_000, importedDurationMs: 5_400_000 })) };
}

test("historical fixtures preserve R3's 364-day final year and reject unsupported partial-day oracles", () => {
  const fixture = parseRuntimeFixtureManifest(fixtureManifest("r3"));
  assert.equal(fixture.yearQuery.factDays, 364);
  assert.equal(fixture.yearQuery.expectedTotalDurationMs, 7_862_400_000);
  assert.equal(fixtureExpectedTotal(fixture, Date.UTC(2024, 11, 31, 16), Date.UTC(2025, 11, 31, 16)), 7_862_400_000);
  assert.throws(() => fixtureExpectedTotal(fixture, Date.UTC(2025, 0, 1, 5), Date.UTC(2026, 0, 1, 5)), /cuts a fixture day/);
  const invalid = [
    { ...fixtureManifest(), fixtureVersion: 1 },
    { ...fixtureManifest(), days: 365 },
    { ...fixtureManifest(), database: { ...fixtureManifest().database, file: "../patina.db" } },
    { ...fixtureManifest(), database: { ...fixtureManifest().database, closed: false } },
    { ...fixtureManifest(), query: { ...fixtureManifest().query, localDayBoundariesMs: [0, 0] } },
    { ...fixtureManifest("r3"), yearQuery: { ...fixtureManifest("r3").yearQuery, factDays: 365 } },
    { ...fixtureManifest("r1"), dailyOracle: fixtureManifest("r1").dailyOracle.slice(1) },
  ];
  for (const manifest of invalid) assert.throws(() => parseRuntimeFixtureManifest(manifest));
});

test("fixture IPC accepts only independently empty year boundaries and stable clean projections", () => {
  for (const profile of ["r1", "r3"] as const) {
    const fixture = parseRuntimeFixtureManifest(fixtureManifest(profile));
    const status = { sourceRevision: 5, activityHourlyState: "ready", dirtyRangeCount: 0,
      activityCoverageStartMs: fixture.seed.utcStartMs, activityCoverageEndMs: fixture.query.endMs };
    const projected = { readPath: "projection", fallbackReason: null, sourceRevision: 5,
      projectionRows: 36_500, factRows: 0, readModelBefore: status, readModelAfter: status };
    assertFixtureProjectionSample(fixture, fixture.query, projected);
    const year = fixture.yearQuery.year;
    const localYear = { startMs: Date.UTC(year - 1, 11, 31, 16), endMs: Date.UTC(year, 11, 31, 16), allowEmptyBoundaryFallback: true };
    const hybrid = { ...projected, readPath: "hybrid", fallbackReason: "outside_projection_coverage" };
    assertFixtureProjectionSample(fixture, localYear, hybrid);
    const rejected = [
      { ...hybrid, readPath: "projection" },
      { ...hybrid, fallbackReason: "model_not_ready" },
      { ...hybrid, fallbackReason: "partial_dirty_or_active" },
      { ...hybrid, readPath: "facts" },
      { ...hybrid, factRows: 1 },
      { ...hybrid, projectionRows: 0 },
      { ...hybrid, sourceRevision: 6 },
      ...[{ ...status, dirtyRangeCount: 1 }, { ...status, activityHourlyState: "building" },
        { ...status, activityCoverageStartMs: null }, { ...status, activityCoverageEndMs: Number.NaN },
        { ...status, sourceRevision: -1 }].map(changed => ({ ...hybrid, readModelBefore: changed, readModelAfter: changed })),
      { ...hybrid, readModelAfter: { ...status, sourceRevision: 6 } },
      { ...hybrid, readModelAfter: { ...status, activityCoverageEndMs: status.activityCoverageEndMs + 3_600_000 } },
    ];
    for (const sample of rejected) assert.throws(() => assertFixtureProjectionSample(fixture, localYear, sample));
    assert.throws(() => assertFixtureProjectionSample(fixture, { ...localYear, allowEmptyBoundaryFallback: false }, hybrid));
    assert.throws(() => assertFixtureProjectionSample(fixture, fixture.query, { ...projected, fallbackReason: "model_not_ready" }));
    const lostDay = { ...status, activityCoverageEndMs: fixture.query.endMs - 86_400_000 };
    assert.throws(() => assertFixtureProjectionSample(fixture, localYear, { ...hybrid, readModelBefore: lostDay, readModelAfter: lostDay }), /empty fixture boundary/);
    const fullCoverage = { ...status, activityCoverageStartMs: localYear.startMs, activityCoverageEndMs: localYear.endMs };
    assertFixtureProjectionSample(fixture, localYear, { ...projected, readModelBefore: fullCoverage, readModelAfter: fullCoverage });
  }
});

test("fixture preparation rejects tampering and sidecars without modifying source or an existing data directory", async () => {
  const root = fs.mkdtempSync(join(tmpdir(), "patina-runtime-fixture-test-"));
  try {
    const source = join(root, "source");
    const target = join(root, "target");
    fs.mkdirSync(source);
    fs.mkdirSync(target);
    const database = Buffer.from("fixture bytes");
    fs.writeFileSync(join(source, "patina.db"), database);
    const manifest = fixtureManifest();
    const path = join(source, "manifest.json");
    const options = parseRuntimeMeasurementOptions(["--measure", "--output", join(root, "report.json"), "--fixture-manifest", path])!;
    assert.equal(options.fixtureManifest, path);
    assert.throws(() => parseRuntimeMeasurementOptions(["--measure", "--output", join(root, "report.json"), "--fixture-manifest", "relative.json"]));
    fs.writeFileSync(path, JSON.stringify({ ...manifest, database: { ...manifest.database, sha256: "0".repeat(64) } }));
    await assert.rejects(prepareRuntimeFixture(options, target), /SHA256 differs/);
    assert.equal(fs.existsSync(join(target, "data")), false);
    fs.writeFileSync(path, JSON.stringify(manifest));
    fs.writeFileSync(join(source, "patina.db-wal"), "uncheckpointed");
    await assert.rejects(prepareRuntimeFixture(options, target), /sidecar/);
    fs.rmSync(join(source, "patina.db-wal"));
    fs.mkdirSync(join(target, "data"));
    fs.writeFileSync(join(target, "data", "patina.db"), "pre-existing target");
    await assert.rejects(prepareRuntimeFixture(options, target), /EEXIST/);
    assert.equal(fs.readFileSync(join(target, "data", "patina.db"), "utf8"), "pre-existing target");
    assert.deepEqual(fs.readFileSync(join(source, "patina.db")), database);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runtime distributions preserve slow samples and do not invent empty results", () => {
  assert.equal(summarizeRuntimeValues([]), null);
  assert.deepEqual(summarizeRuntimeValues([1, 2, 3, 100]), { count: 4, average: 26.5, p50: 2, p95: 100, max: 100 });
  assert.throws(() => summarizeRuntimeValues([Number.NaN]));
  assert.throws(() => summarizeRuntimeValues([-1]));
});

test("resource summaries exclude and count unavailable process data instead of zero-filling", () => {
  const source = [
    { kind: "metadata", intervalSeconds: 5 },
    { kind: "sample", elapsedSeconds: 0, processes: [{ privateBytes: 100, cpuOneCorePercent: null }, { privateBytes: 200, cpuOneCorePercent: null }] },
    { kind: "sample", elapsedSeconds: 5, processes: [{ privateBytes: 120, cpuOneCorePercent: 1 }, { unavailable: true }] },
    { kind: "sample", elapsedSeconds: 10, processes: [{ privateBytes: 130, cpuOneCorePercent: 1 }, { privateBytes: 220, cpuOneCorePercent: 2 }] },
    { kind: "completed", stopReason: "duration", elapsedSeconds: 10 },
  ].map((row) => JSON.stringify(row)).join("\n");
  const summary = summarizeRuntimeResources(source);
  assert.equal(summary.distributions.privateBytes?.count, 2);
  assert.equal(summary.distributions.privateBytes?.average, 325);
  assert.equal(summary.distributions.cpuOneCorePercent?.average, 3);
  assert.equal(summary.missingSamples.privateBytes, 1);
  assert.equal(summary.missingSamples.cpuOneCorePercent, 2);
  assert.equal(summary.fullEightHourObservation, false);
  assert.equal(summary.samplingCoverageComplete, false);
  assert.equal(summary.privateBytesMedianGrowth, null);
  const invalidScene = summarizeRuntimeResources(source, false);
  assert.equal(invalidScene.completed, true, "sampler duration must remain distinct from scene acceptance");
  assert.equal(invalidScene.sceneAcceptanceEligible, false);
  assert.ok(Object.values(invalidScene.metricAcceptanceEligible).every(eligible => !eligible));
});

test("a long completion timestamp without samples cannot satisfy an eight-hour observation", () => {
  const summary = summarizeRuntimeResources(JSON.stringify({ kind: "completed", stopReason: "duration", elapsedSeconds: 28800 }));
  assert.equal(summary.fullEightHourObservation, false);
  assert.equal(summary.distributions.privateBytes, null);
  assert.equal(summary.eightHourPrivateDriftAccepted, null);
  assert.equal(summary.metricAcceptanceEligible.privateBytes, false);
  assert.equal(summarizeRuntimeResources("").completed, false);
});

test("CPU acceptance excludes only the initial counter baseline", () => {
  const summarize = (lastCpu: number | null, sceneAcceptanceEligible?: boolean) => summarizeRuntimeResources([
    { kind: "metadata", intervalSeconds: 5 },
    { kind: "sample", elapsedSeconds: 0, processes: [{ privateBytes: 100, cpuOneCorePercent: null }] },
    { kind: "sample", elapsedSeconds: 5, processes: [{ privateBytes: 100, cpuOneCorePercent: 2 }] },
    { kind: "sample", elapsedSeconds: 10, processes: [{ privateBytes: 100, cpuOneCorePercent: lastCpu }] },
    { kind: "completed", stopReason: "duration", elapsedSeconds: 10 },
  ].map((row) => JSON.stringify(row)).join("\n"), sceneAcceptanceEligible);
  const complete = summarize(4);
  assert.equal(complete.metricAcceptanceEligible.cpuOneCorePercent, true);
  assert.equal(complete.distributions.cpuOneCorePercent?.average, 3);
  assert.equal(complete.missingSamples.cpuOneCorePercent, 1);
  assert.equal(summarize(null).metricAcceptanceEligible.cpuOneCorePercent, false);
  assert.equal(summarize(4, false).metricAcceptanceEligible.cpuOneCorePercent, false);
  assert.equal(summarize(4, false).metricAcceptanceEligible.privateBytes, false);
});

test("runtime input fingerprints include new files and exclude generated build output", () => {
  const root = fs.mkdtempSync(join(tmpdir(), "patina-runtime-fingerprint-"));
  try {
    fs.mkdirSync(join(root, "src"));
    fs.mkdirSync(join(root, "src-tauri", "target"), { recursive: true });
    fs.writeFileSync(join(root, "src", "existing.ts"), "export const first = 1;");
    const before = fingerprintRuntimeInputs(root);
    fs.writeFileSync(join(root, "src", "untracked.ts"), "export const second = 2;");
    const after = fingerprintRuntimeInputs(root);
    assert.notEqual(after.sha256, before.sha256);
    assert.ok(after.files.some((file) => file.path === "src/untracked.ts"));
    fs.writeFileSync(join(root, "src-tauri", "target", "output"), "generated");
    assert.equal(fingerprintRuntimeInputs(root).sha256, after.sha256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failed measurement preparation cannot overwrite pre-existing evidence during cleanup", async () => {
  const root = fs.mkdtempSync(join(tmpdir(), "patina-runtime-output-"));
  try {
    const output = join(root, "existing.json");
    fs.writeFileSync(output, "existing evidence");
    const options = parseRuntimeMeasurementOptions(["--measure", "--output", output, "--resource-seconds", "0"])!;
    await assert.rejects(prepareRuntimeMeasurements(options));
    recordRuntimeMeasurementCleanup(options, [new Error("setup failed")]);
    assert.equal(fs.readFileSync(output, "utf8"), "existing evidence");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runtime cleanup reports preserve run failures independently of cleanup failures", { skip: process.platform !== "win32" }, async () => {
  const root = fs.mkdtempSync(join(tmpdir(), "patina-runtime-cleanup-report-"));
  try {
    for (const { cleanupErrors, primaryError, initialReport } of [
      { cleanupErrors: [], primaryError: new Error("navigation timed out"), initialReport: { status: "failed", error: "navigation timed out" } },
      { cleanupErrors: [new Error("owned directory remained")], primaryError: undefined, initialReport: { status: "completed" } },
    ]) {
      const output = join(root, `report-${cleanupErrors.length}.json`);
      const options = parseRuntimeMeasurementOptions(["--measure", "--output", output, "--resource-seconds", "0"])!;
      await prepareRuntimeMeasurements(options);
      fs.writeFileSync(output, JSON.stringify(initialReport));
      recordRuntimeMeasurementCleanup(options, cleanupErrors, primaryError);
      const report = JSON.parse(fs.readFileSync(output, "utf8"));
      assert.equal(report.status, "failed");
      assert.equal(report.error, initialReport.error);
      assert.equal(report.cleanupCompleted, cleanupErrors.length === 0);
      assert.deepEqual(report.cleanupErrors, cleanupErrors.map(String));
      assert.deepEqual(report.failures, [...(primaryError ? [String(primaryError)] : []), ...cleanupErrors.map(String)]);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("tauri dev defaults to the isolated development profile", () => {
  assert.deepEqual(resolveTauriArguments(["dev"]), [
    "dev",
    "--config",
    DEV_CONFIG_PATH,
  ]);
  assert.deepEqual(resolveTauriArguments(["dev", "--no-watch"]), [
    "dev",
    "--config",
    DEV_CONFIG_PATH,
    "--no-watch",
  ]);
  assert.deepEqual(resolveTauriArguments(["-v", "dev"]), [
    "-v",
    "dev",
    "--config",
    DEV_CONFIG_PATH,
  ]);
  assert.deepEqual(
    resolveTauriArguments(["dev", "--", "--config", "runner.json"]),
    [
      "dev",
      "--config",
      DEV_CONFIG_PATH,
      "--",
      "--config",
      "runner.json",
    ],
  );
});

test("tauri dev preserves an explicitly selected non-default profile", () => {
  const explicitLong = [
    "dev",
    "--config",
    "src-tauri/tauri.local.conf.json",
  ];
  const explicitShort = [
    "dev",
    "-c",
    "src-tauri/tauri.local.conf.json",
  ];

  assert.deepEqual(resolveTauriArguments(explicitLong), explicitLong);
  assert.deepEqual(resolveTauriArguments(explicitShort), explicitShort);
});

test("tauri release commands remain on the production profile", () => {
  assert.deepEqual(resolveTauriArguments(["build"]), ["build"]);
  assert.deepEqual(
    resolveTauriArguments(["build", "--bundles", "nsis"]),
    ["build", "--bundles", "nsis"],
  );
  assert.deepEqual(resolveTauriArguments(["build", "--", "dev"]), [
    "build",
    "--",
    "dev",
  ]);
});

test("production and development configs declare distinct identities", () => {
  const production = JSON.parse(
    fs.readFileSync("src-tauri/tauri.conf.json", "utf8"),
  ) as { identifier?: string; productName?: string; mainBinaryName?: string };
  const development = JSON.parse(
    fs.readFileSync("src-tauri/tauri.dev.conf.json", "utf8"),
  ) as { identifier?: string; productName?: string; mainBinaryName?: string };

  assert.equal(production.identifier, "com.ceceliaee.patina");
  assert.equal(development.identifier, "com.ceceliaee.patina.dev");
  assert.notEqual(development.identifier, production.identifier);
  assert.notEqual(development.productName, production.productName);
  assert.notEqual(development.mainBinaryName, production.mainBinaryName);
});
