import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Exclusive opt-in build: each mutant restores exact source bytes in finally.
// The helper-crash test owns its Job, so assertion failure still reaps descendants.
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && ["--subscriptions-only", "--data-cache-only", "--audio-only", "--media-only", "--catalog-only", "--probe-lifecycle-only"].includes(process.argv[2])));
const audioOnly = process.argv.includes("--audio-only");
const mediaOnly = process.argv.includes("--media-only");
const catalogOnly = process.argv.includes("--catalog-only");
const probeOnly = process.argv.includes("--probe-lifecycle-only");
const cases = [
  { name: "wait-for-name", file: "engine/tracking/active_session.rs",
    search: "schedule_name(confirm_name, window);",
    replacement: "schedule_name(confirm_name, window);\n    while data.load_active_session().await?.is_some_and(|session| session.app_name.is_empty()) { tokio::task::yield_now().await; }",
    test: "blocked_name_keeps_a_b_a_samples_and_late_results_keep_session_identity", failure: /recording waited for a display name/ },
  { name: "accept-pre-restore-name", file: "data/tracking_runtime.rs",
    search: "if *guard != epoch {", replacement: "if false && *guard != epoch {",
    test: "app_name_from_before_legacy_restore_cannot_fill_reused_session_id", failure: /assertion failed/ },
  { name: "heartbeat-as-commit", file: "engine/tracking/runtime/loop_state.rs",
    search: "state.last_heartbeat_persisted_at_ms = Some(now_ms);",
    replacement: "state.last_heartbeat_persisted_at_ms = Some(now_ms); committed = true;",
    test: "timestamp_persistence_recovers_from_reversed_wall_clock_and_reports_write_failure", failure: /written heartbeat cannot count/ },
  { name: "old-webview-generation", file: "app/webview_recovery.rs",
    search: "if registration != self.registration {", replacement: "if false && registration != self.registration {",
    test: "stale_duplicate_and_recoverable_events_cannot_rebuild_a_window", failure: /assertion failed/ },
  { name: "orphan-native-probe", file: "platform/windows/native_probe/process.rs",
    search: "limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;",
    replacement: "limits.BasicLimitInformation.LimitFlags = Default::default();",
    integration: true, test: "native_probe_processes_are_reused_reaped_and_recovered", failure: /assertion .*failed|descendant.*exit/ },
  { name: "leaked-probe-handle", file: "platform/windows/native_probe/process.rs",
    search: "let job = create_job()?;",
    replacement: "let job = create_job()?; std::mem::forget(job.try_clone().unwrap());",
    integration: true, test: "native_probe_processes_are_reused_reaped_and_recovered", failure: /handle growth:/ },
  { name: "leaked-probe-thread", file: "platform/windows/native_probe/process.rs",
    search: "let (requests, receiver) = mpsc::sync_channel::<Exchange>(1);",
    replacement: "std::thread::spawn(|| loop { std::thread::park(); }); let (requests, receiver) = mpsc::sync_channel::<Exchange>(1);",
    integration: true, test: "native_probe_processes_are_reused_reaped_and_recovered", failure: /thread growth:/ },
  { name: "cancelled-icon-frees-native-slot", file: "engine/tracking/metadata.rs",
    search: "let _permit = permit;", replacement: "drop(permit);",
    test: "cancelled_icon_waiter_keeps_native_capacity_until_worker_finishes", failure: /cancellation freed a still-running native slot/ },
  { name: "audio-apartment-ended", file: "platform/windows/native_probe/worker.rs",
    search: "audio_apartment = Some(audio::ComGuard::initialize()?);",
    replacement: "audio_apartment = Some(audio::ComGuard::initialize()?); drop(audio_apartment.take());",
    integration: true, test: "native_probe_processes_are_reused_reaped_and_recovered", failure: /audio MTA must stay initialized between queries/ },
  { name: "audio-worker-thread-leak", file: "platform/windows/native_probe/worker.rs",
    search: "let result = execute(request.body, &mut media_probe);",
    replacement: "if kind == ProbeKind::Audio { std::thread::spawn(|| loop { std::thread::park(); }); } let result = execute(request.body, &mut media_probe);",
    integration: true, test: "native_probe_processes_are_reused_reaped_and_recovered", failure: /audio helper resource growth: thread_count/ },
  { name: "media-manager-recreated", file: "platform/windows/native_probe/worker.rs",
    search: "if media_probe.is_none() {", replacement: "if true {",
    integration: true, test: "native_probe_processes_are_reused_reaped_and_recovered", failure: /media helper resource growth: private_usage_bytes/ },
];
const output = resolve("artifacts/runtime-reliability/mutations");
mkdirSync(output, { recursive: true });
function run(label: string, args: string[]) {
  const result = spawnSync("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--offline", ...args],
    { encoding: "utf8", windowsHide: true, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
  const log = String(result.stdout ?? "") + String(result.stderr ?? "") + String(result.error ?? "");
  writeFileSync(resolve(output, `${label}.log`), log, "utf8");
  if (result.error) throw result.error;
  return { status: result.status, log };
}
if (process.argv.length === 2 || audioOnly || mediaOnly || probeOnly) {
const nativeOnly = audioOnly || mediaOnly || probeOnly;
const prefix = audioOnly ? "audio-" : mediaOnly ? "media-" : probeOnly ? "probe-" : "";
const baselineArgs = nativeOnly ? ["--test", "native_probe_lifecycle", "--quiet"] : ["--quiet"];
const baseline = run(`${prefix}baseline`, baselineArgs);
assert.equal(baseline.status, 0, baseline.log);
console.log("PASS runtime mutation baseline");
for (const mutation of cases.filter(mutation => (!audioOnly || mutation.name.startsWith("audio-")) && (!mediaOnly || mutation.name.startsWith("media-")) && (!probeOnly || mutation.file === "platform/windows/native_probe/process.rs"))) {
  const source = resolve("src-tauri/src", mutation.file);
  const original = readFileSync(source);
  const text = original.toString("utf8");
  assert.equal(text.split(mutation.search).length, 2, `mutation anchor drifted: ${mutation.name}`);
  try {
    writeFileSync(source, text.replace(mutation.search, mutation.replacement), "utf8");
    const mutant = run(mutation.name, [...(mutation.integration ? ["--test", "native_probe_lifecycle"] : ["--lib"]), mutation.test, "--", "--nocapture"]);
    assert.notEqual(mutant.status, 0, `SURVIVED ${mutation.name}`);
    assert.match(mutant.log, /test result: FAILED/, "a compiler or harness failure is not a killed mutant");
    assert.match(mutant.log, mutation.failure);
    console.log(`KILLED ${mutation.name}`);
  } finally {
    writeFileSync(source, original);
    assert.deepEqual(readFileSync(source), original);
  }
}
// Rebuild restored production sources so no mutant executable remains the candidate.
const restored = run(`${prefix}restored`, baselineArgs);
assert.equal(restored.status, 0, restored.log);
console.log("PASS restored runtime reliability sources and tests");
}

function runSubscriptions(label: string) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "tests/uiBrowserSmoke.test.ts", "--startup-only"],
    { encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const log = String(result.stdout ?? "") + String(result.stderr ?? "") + String(result.error ?? "");
  writeFileSync(resolve(output, `${label}.log`), log, "utf8");
  if (result.error) throw result.error;
  return { status: result.status, log };
}

if (!audioOnly && !mediaOnly && !catalogOnly && !probeOnly && !process.argv.includes("--data-cache-only")) {
const subscriptionBaseline = runSubscriptions("subscriptions-baseline");
assert.equal(subscriptionBaseline.status, 0, subscriptionBaseline.log);
for (const mutation of [
  { name: "leaked-main-listener", file: "src/app/hooks/useWindowTracking.ts",
    search: "if (cancelled) off(); else unlisteners.push(off);", replacement: "if (!cancelled) unlisteners.push(off);" },
  { name: "leaked-mini-listener", file: "src/app/mini/useMiniTracking.ts",
    search: "if (cancelled) off(); else unlisteners.push(off);", replacement: "if (!cancelled) unlisteners.push(off);" },
  { name: "leaked-icon-listener", file: "src/platform/runtime/appIconEventGateway.ts",
    search: "if (disposed) { stop(); return; }", replacement: "if (disposed) { return; }" },
]) {
  const source = resolve(mutation.file);
  const original = readFileSync(source);
  const text = original.toString("utf8");
  assert.equal(text.split(mutation.search).length, 2, `mutation anchor drifted: ${mutation.name}`);
  try {
    writeFileSync(source, text.replace(mutation.search, mutation.replacement), "utf8");
    const mutant = runSubscriptions(mutation.name);
    assert.notEqual(mutant.status, 0, `SURVIVED ${mutation.name}`);
    assert.match(mutant.log, /late unlisten must restore the original listener count/,
      "the resource assertion must fail, not compilation or browser startup");
    console.log(`KILLED ${mutation.name}`);
  } finally {
    writeFileSync(source, original);
    assert.deepEqual(readFileSync(source), original);
  }
}
const subscriptionsRestored = runSubscriptions("subscriptions-restored");
assert.equal(subscriptionsRestored.status, 0, subscriptionsRestored.log);
console.log("PASS restored subscription owners and browser tests");
}

if (!audioOnly && !mediaOnly && !catalogOnly && !probeOnly && !process.argv.includes("--subscriptions-only")) {
  function runDataCache(label: string, entry = "tests/dataReadModel.test.ts") {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", entry],
      { encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    const log = String(result.stdout ?? "") + String(result.stderr ?? "") + String(result.error ?? "");
    writeFileSync(resolve(output, `${label}.log`), log, "utf8");
    if (result.error) throw result.error;
    return { status: result.status, log };
  }
  const baseline = runDataCache("data-cache-baseline");
  assert.equal(baseline.status, 0, baseline.log);
  for (const mutation of [
    { name: "trend-clears-native-slots", file: "dataTrendSnapshot.ts", search: "dataTrendSnapshotCacheEpoch += 1;", replacement: "dataTrendSnapshotCacheEpoch += 1; sessionPromises.clear();", failure: /trend invalidation released unfinished native query capacity/ },
    { name: "heatmap-clears-native-slots", file: "dataHeatmapSnapshot.ts", search: "dataReadModelCacheEpoch += 1;", replacement: "dataReadModelCacheEpoch += 1; heatmapSnapshotPromises.clear();", failure: /heatmap invalidation released unfinished native query capacity/ },
    { name: "heatmap-releases-partial-query", file: "dataHeatmapSnapshot.ts", search: "void Promise.allSettled([earliestStartTimePromise, sessionsPromise]).then(() => {", replacement: "void snapshotPromise.catch(() => undefined).then(() => {", failure: /partial heatmap failure released unfinished native query capacity/ },
    { name: "trend-name-key-collision", file: "dataSessionIdentity.ts", search: "`${session.exeName.length}:${session.exeName}${session.appName}`", replacement: "session.exeName", failure: /identity reuse must preserve name-dependent filtering/ },
    { name: "trend-unbounded-identity-entries", file: "dataSessionIdentity.ts", search: "identities.size < 128", replacement: "true", failure: /reuse common identities but retain at most 128 short keys/ },
    { name: "trend-unbounded-identity-key", file: "dataSessionIdentity.ts", search: "session.exeName.length + session.appName.length <= 1024", replacement: "true", failure: /reuse common identities but retain at most 128 short keys/ },
  ]) {
    const source = resolve("src/features/data/services", mutation.file);
    const original = readFileSync(source);
    const text = original.toString("utf8");
    assert.equal(text.split(mutation.search).length, 2, `mutation anchor drifted: ${mutation.name}`);
    try {
      writeFileSync(source, text.replace(mutation.search, mutation.replacement), "utf8");
      const mutant = runDataCache(mutation.name);
      assert.notEqual(mutant.status, 0, `SURVIVED ${mutation.name}`);
      assert.match(mutant.log, /AssertionError/);
      assert.match(mutant.log, mutation.failure);
      console.log(`KILLED ${mutation.name}`);
    } finally {
      writeFileSync(source, original);
      assert.deepEqual(readFileSync(source), original);
    }
  }
  const restored = runDataCache("data-cache-restored");
  assert.equal(restored.status, 0, restored.log);
  console.log("PASS restored data cache owners and tests");

  const historyBaseline = runDataCache("history-capacity-baseline", "tests/historyReadModel.test.ts");
  assert.equal(historyBaseline.status, 0, historyBaseline.log);
  const historySource = resolve("src/features/history/services/historyReadModel.ts");
  const historyOriginal = readFileSync(historySource);
  const historyText = historyOriginal.toString("utf8");
  const release = "void Promise.allSettled(nativeReads).then(() => { pendingHistoryReadGroups -= 1; });";
  assert.equal(historyText.split(release).length, 2, "History capacity mutation anchor drifted");
  try {
    writeFileSync(historySource, historyText.replace(release, "pendingHistoryReadGroups -= 1;"), "utf8");
    const mutant = runDataCache("history-releases-partial-query", "tests/historyReadModel.test.ts");
    assert.notEqual(mutant.status, 0, "SURVIVED history-releases-partial-query");
    assert.match(mutant.log, /AssertionError/);
    assert.match(mutant.log, /History partial failure released unfinished native query capacity/);
    console.log("KILLED history-releases-partial-query");
  } finally {
    writeFileSync(historySource, historyOriginal);
    assert.deepEqual(readFileSync(historySource), historyOriginal);
  }
  const historyRestored = runDataCache("history-capacity-restored", "tests/historyReadModel.test.ts");
  assert.equal(historyRestored.status, 0, historyRestored.log);
  console.log("PASS restored History native capacity and tests");
}

if (process.argv.length === 2 || catalogOnly) {
  for (const mutation of [
    { name: "catalog-missing-invalidation", file: "src/app/hooks/useWindowTracking.ts",
      search: "ClassificationService.invalidateAppCatalog();", replacement: "void ClassificationService;",
      failure: /data event must invalidate the warmed inactive catalog/, browser: true },
    { name: "catalog-waits-for-name-event", file: "src/app/hooks/useWindowTracking.ts",
      search: 'invalidateCaches || payload.reason === "session-transition" || payload.reason === "session-recovered"', replacement: "invalidateCaches",
      failure: /data event must invalidate the warmed inactive catalog/, browser: true },
    { name: "catalog-missing-mounted-refresh", file: "src/features/classification/hooks/useClassificationAppCatalog.ts",
      search: "enabled, snapshot.status, snapshot.requestGeneration", replacement: "enabled",
      failure: /mounted catalog must reread facts after invalidation/, browser: true },
    { name: "catalog-releases-native-capacity", file: "src/features/classification/services/classificationAppCatalog.ts",
      search: "if (this.inFlight) {", replacement: "if (this.inFlight && this.inFlight.generation === this.state.requestGeneration) {",
      failure: /invalidations must share one trailing refresh|catalog invalidation released unfinished native query capacity/, browser: false },
  ]) {
    const runCatalog = (label: string) => {
      if (mutation.browser) return runSubscriptions(label);
      const result = spawnSync(process.execPath, ["--experimental-strip-types", "tests/classificationAppCatalog.test.ts"],
        { encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      const log = String(result.stdout ?? "") + String(result.stderr ?? "") + String(result.error ?? "");
      writeFileSync(resolve(output, `${label}.log`), log, "utf8");
      if (result.error) throw result.error;
      return { status: result.status, log };
    };
    const baseline = runCatalog(`${mutation.name}-baseline`);
    assert.equal(baseline.status, 0, baseline.log);
    const source = resolve(mutation.file);
    const original = readFileSync(source);
    const text = original.toString("utf8");
    assert.equal(text.split(mutation.search).length, 2, `mutation anchor drifted: ${mutation.name}`);
    try {
      writeFileSync(source, text.replace(mutation.search, mutation.replacement), "utf8");
      const mutant = runCatalog(mutation.name);
      assert.notEqual(mutant.status, 0, `SURVIVED ${mutation.name}`);
      assert.match(mutant.log, mutation.failure, "the behavioral assertion must reject the mutant");
      console.log(`KILLED ${mutation.name}`);
    } finally {
      writeFileSync(source, original);
      assert.deepEqual(readFileSync(source), original);
    }
    const restored = runCatalog(`${mutation.name}-restored`);
    assert.equal(restored.status, 0, restored.log);
  }
  console.log("PASS restored catalog owners and tests");
}
