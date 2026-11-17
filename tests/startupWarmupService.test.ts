import assert from "node:assert/strict";
import { startStartupWarmup, resetStartupWarmupForTests } from "../src/app/services/startupWarmupService.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function dependencies(events: string[], fail?: string, cached = false) {
  const run = async (name: string) => {
    events.push(name);
    if (name === fail) throw new Error(`failed ${name}`);
  };
  return {
    getDashboardSnapshotCache: () => cached ? {} : null,
    loadDashboardRuntimeSnapshot: () => run("dashboard"),
    preloadLazyViewChunk: (view: string) => run(`chunk:${view}`),
    prewarmClassificationBootstrapCache: () => run("mapping"),
    prewarmToolsRuntimeSnapshot: () => run("tools"),
    warn: () => {},
  };
}
const options = { initialDelayMs: 0, taskGapMs: 0 };
for (const mode of ["hidden-start", "visible-start", "foreground-open"] as const) {
  resetStartupWarmupForTests();
  const events: string[] = [];
  const controller = startStartupWarmup({ ...options, mode }, dependencies(events));
  assert.equal(startStartupWarmup(options), controller, "concurrent startup shares one owner");
  await controller.ready;
  if (mode === "hidden-start") {
    assert.deepEqual(events, [], "hidden startup must not hydrate UI snapshots");
    assert.ok(Object.values(controller.snapshot().tasks).every(task => task.status === "skipped"));
  } else {
    assert.deepEqual(events.filter(event => event.startsWith("chunk:")), ["chunk:tools"]);
    assert.ok(events.includes("dashboard") && events.includes("tools"));
    assert.ok(Object.values(controller.snapshot().tasks).every(task => task.status === "fulfilled"));
  }
  const snapshot = controller.snapshot();
  snapshot.tasks["view-chunks"].status = "idle";
  assert.notEqual(controller.snapshot().tasks["view-chunks"].status, "idle");
}
for (const fail of ["chunk:tools", "mapping", "dashboard", "tools"]) {
  const controller = startStartupWarmup(options, dependencies([], fail));
  await controller.ready;
  assert.ok(Object.values(controller.snapshot().tasks).some(task => task.status === "rejected" && task.errorMessage?.includes(fail)));
  assert.notEqual(controller.snapshot().completedAtMs, null);
}
{
  const events: string[] = [];
  const controller = startStartupWarmup(options, dependencies(events, undefined, true));
  await controller.ready;
  assert.equal(controller.snapshot().tasks["dashboard-snapshot"].status, "skipped");
  assert.ok(!events.includes("dashboard"));
}
{
  const gate = deferred();
  const events: string[] = [];
  const old = startStartupWarmup({ ...options, runtimeReady: gate.promise }, dependencies(events));
  for (let i = 0; i < 40; i++) await Promise.resolve();
  assert.ok(!events.includes("dashboard"), "recording reads wait for runtime readiness");
  old.cancel();
  const newGate = deferred();
  const current = startStartupWarmup({ ...options, runtimeReady: newGate.promise }, dependencies([]));
  gate.resolve();
  await old.ready;
  assert.equal(startStartupWarmup(options), current, "late completion cannot clear a newer controller");
  assert.equal(old.snapshot().tasks["dashboard-snapshot"].status, "cancelled");
  newGate.resolve();
  await current.ready;
}
resetStartupWarmupForTests();
console.log("PASS remaining startup warmup lifecycle, failures and cancellation");
