import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import { assertResourceEnvironment, assertRuntimeResults, parseRuntimeOptions, selectRuntimeGroups } from "./tauriRuntimeOptions.ts";
import { createRuntimeJob, quoteWindowsArgument } from "./tauriRuntimeProcess.ts";
import { readPreparedRuntime, runBackgroundCommand, runtimeInstrumentation, RuntimeSession, runtimeSourceFingerprint } from "./tauriRuntimeHarness.ts";
import { RuntimeReport } from "./tauriRuntimeReport.ts";
import { assertIsolatedTempPath, waitFor, type CdpConnection } from "./uiBrowserSmoke/browserHarness.ts";
import { verifyDesktopResourceLifecycle } from "./tauriResourceLifecycle.ts";

assert.equal(parseRuntimeOptions([]).group, null);
assert.deepEqual(selectRuntimeGroups(parseRuntimeOptions([])), ["contracts", "data-recovery", "storage-restart", "webview-recovery", "window-lifecycle", "mini-input"]);
assert.deepEqual(selectRuntimeGroups(parseRuntimeOptions(["--resource-cycles"])), ["contracts", "data-recovery", "storage-restart", "webview-recovery", "window-lifecycle", "resources"]);
assert.deepEqual(selectRuntimeGroups(parseRuntimeOptions(["--group", "contracts"])), ["contracts"]);
assert.throws(() => assertRuntimeResults([], []), /at least one/);
assertResourceEnvironment({});
for (const env of [{ PATINA_COVERAGE_TARGET_DIR: "coverage" }, { RUSTFLAGS: "-C instrument-coverage" }, { CARGO_ENCODED_RUSTFLAGS: "-C\u001fprofile-generate" }]) assert.throws(() => assertResourceEnvironment(env), /uninstrumented/);
assert.equal(parseRuntimeOptions(["--group", "contracts"]).group, "contracts");
assert.equal(parseRuntimeOptions(["--resource-cycles"]).resourceCycles, true);
assert.equal(parseRuntimeOptions(["--prepare-only"]).prepareOnly, true);
for(const args of [["--group"], ["--group", "missing"], ["--skip"], ["--group", "contracts", "--resource-cycles"], ["--prepare-only", "--group", "contracts"], ["--prepared"], ["--resource-cycles", "--resource-cycles"]]) {
  assert.throws(() => parseRuntimeOptions(args));
}
assertRuntimeResults(["contracts", "resources"], [{ group: "contracts", status: "passed" }, { group: "resources", status: "passed" }]);
for(const results of [[], [{ group: "contracts", status: "passed" }], [{ group: "contracts", status: "passed" }, { group: "contracts", status: "passed" }], [{ group: "contracts", status: "passed" }, { group: "resources", status: "cancelled" }]]) {
  assert.throws(() => assertRuntimeResults(["contracts", "resources"], results));
}
assert.equal(quoteWindowsArgument('a"b\\'), '"a\\"b\\\\"');
assert.throws(() => quoteWindowsArgument("a\0b"));

// The driver must settle on cancellation before its workload timer expires.
// No Windows input is needed to test this orchestration boundary.
{
  const cancellation = new AbortController();
  let stopped = 0;
  let measurements = 0;
  let cancelled: () => void;
  const observedCancellation = new Promise<void>(resolve => { cancelled = resolve; });
  const views: string[] = [];
  const client = {
    onMessage: () => () => { stopped++; }, command: async () => ({}),
  } as unknown as CdpConnection;
  let outcome: unknown;
  const work = verifyDesktopResourceLifecycle(client, async expression => {
    const view = /data-sidebar-nav-item="([^"]+)"/.exec(expression)?.[1];
    if (view) views.push(view);
    if (expression.includes("data-presented-view")) setImmediate(() => { cancellation.abort(); cancelled(); });
    return expression.includes("live.values") ? [] : true;
  }, () => { measurements++; throw new Error("Cancelled workload must not measure"); }, "forced", cancellation.signal)
    .then(() => { outcome = new Error("Unexpected resource success"); }, error => { outcome = error; });
  try {
    await observedCancellation;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(outcome instanceof Error && outcome.name === "AbortError", "resource wait must observe abort without waiting for its timer");
  } finally { await work; }
  assert.deepEqual(views, ["data"]);
  assert.equal(stopped, 1);
  assert.equal(measurements, 0);
}

const artifactBase = "artifacts/runtime-smoke";
mkdirSync(artifactBase, { recursive: true });
const preparedRoot = realpathSync(mkdtempSync(join(artifactBase, "harness-fixture-")));
try {
  const binary = join(preparedRoot, "fixture.exe"), frontend = join(preparedRoot, "frontend");
  mkdirSync(frontend); writeFileSync(binary, "fixture-binary"); writeFileSync(join(frontend, "index.html"), "fixture-html");
  const digest = (text: string) => createHash("sha256").update(text).digest("hex");
  const valid = { format: 1 as const, directory: preparedRoot, binary, frontend, frontendPort: 54321,
    config: JSON.stringify({ identifier: "com.ceceliaee.patina.runtime-smoke", build: { beforeDevCommand: "", devUrl: "http://127.0.0.1:54321" } }),
    fingerprint: runtimeSourceFingerprint(), binaryHash: digest("fixture-binary"), assetsHash: digest("index.html\0fixture-html"),
    instrumentation: runtimeInstrumentation(), node: process.version };
  const manifest = join(preparedRoot, "manifest.json");
  const save = (value: unknown) => writeFileSync(manifest, JSON.stringify(value));
  save(valid); assert.deepEqual(readPreparedRuntime(manifest), valid);
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => { blocker.once("error", reject); blocker.listen(0, "127.0.0.1", resolve); });
  const address = blocker.address(); assert.ok(address && typeof address === "object");
  const report = new RuntimeReport("harness-negative-controls");
  const session = new RuntimeSession({ ...valid, frontendPort: address.port }, report);
  try {
    await assert.rejects(session.start(), /already in use/);
    assert.equal(session.job, null, "occupied preview port must prevent process launch");
    session.ownCleanup(async () => { throw new Error("injected cleanup failure"); });
    rmSync(report.output, { recursive: true, force: true });
    await assert.rejects(session.cleanup(), error => error instanceof AggregateError
      && error.errors.some(item => String(item).includes("injected cleanup failure"))
      && error.errors.some(item => (item as NodeJS.ErrnoException).code === "ENOENT"));
    assert.equal(existsSync(session.root), false, "log write failure must not skip remaining cleanup");
    assert.equal(blocker.listening, true, "cleanup must not stop an unrelated server");
  } finally {
    await new Promise<void>(resolve => blocker.close(() => resolve()));
    assertIsolatedTempPath(session.root, "patina-tauri-e2e-");
    rmSync(session.root, { recursive: true, force: true });
    assert.match(report.id, /^\d+-[a-f0-9-]+$/);
    rmSync(report.output, { recursive: true, force: true });
  }
  for (const patch of [{ fingerprint: { ...valid.fingerprint, sha256: "stale" } }, { instrumentation: "changed" }, { config: "{}" }, { directory: frontend }]) {
    save({ ...valid, ...patch }); assert.throws(() => readPreparedRuntime(manifest));
  }
  save(valid); writeFileSync(binary, "tampered"); assert.throws(() => readPreparedRuntime(manifest), /binary changed/);
  writeFileSync(binary, "fixture-binary"); writeFileSync(join(frontend, "index.html"), "tampered");
  assert.throws(() => readPreparedRuntime(manifest), /frontend changed/);
  console.log("PASS prepared source, configuration, instrumentation, binary and frontend integrity rejection");
} finally {
  assert.equal(preparedRoot.startsWith(realpathSync(artifactBase)), true);
  rmSync(preparedRoot, { recursive: true, force: true });
}

// These children do not create windows or inject input. A separate child is the
// negative control proving that closing one job cannot kill unrelated processes.
const root = mkdtempSync(join(tmpdir(), "patina-runtime-harness-"));
assertIsolatedTempPath(root, "patina-runtime-harness-");
let unrelated: ReturnType<typeof spawn> | null = null;
let job: Awaited<ReturnType<typeof createRuntimeJob>> | null = null;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
try {
  unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { windowsHide: true, stdio: "ignore" });
  await waitFor("control child starts", () => unrelated!.pid && alive(unrelated!.pid));
  const descendantFile = join(root, "descendant.json");
  const log: string[] = [];
  job = await createRuntimeJob(process.env, value => log.push(value));
  const lease = `Local\\PatinaRuntimeHarness-${process.pid}-${Date.now()}`;
  await job.claimDesktop(lease);
  const competingJob = await createRuntimeJob(process.env, value => log.push(value));
  try { await assert.rejects(competingJob.claimDesktop(lease), /Another runtime run/); }
  finally { await competingJob.close(); }
  const code = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});fs.writeFileSync(process.argv[1],JSON.stringify({root:process.pid,child:child.pid,args:process.argv.slice(2)}));setInterval(()=>{},1000);`;
  const args = ['spaces and "quotes"', "trailing\\", "中文路径"];
  const pid = await job.start(process.execPath, ["-e", code, descendantFile, ...args]);
  const observed = await waitFor("owned child and descendant start", () => {
    try { return JSON.parse(readFileSync(descendantFile, "utf8")); } catch { return null; }
  });
  assert.equal(observed.root, pid);
  assert.deepEqual(observed.args, args);
  const noisy = await job.start(process.execPath, ["-e", "process.stdout.write('partial-child-line');setInterval(()=>process.stdout.write('PATINA_JOB_REPLY {\"id\":1,\"result\":123}'),5)"]);
  await waitFor("child partial log", () => log.join("").includes("partial-child-line"));
  for (let request = 0; request < 10; request++) {
    assert.equal(await job.exitCode(noisy), -1, "child logs must not corrupt or spoof control replies");
  }
  assert.ok(log.join("").includes("PATINA_JOB_REPLY"), "protocol-like child output must remain a log");
  assert.ok(await job.count() >= 2, "job must contain root and descendant; Windows may also create console hosts");
  await job.stop();
  assert.equal(await job.count(), 0);
  assert.equal(alive(pid), false);
  assert.equal(alive(observed.child), false);
  assert.equal(alive(unrelated.pid!), true);
  await assert.rejects(runBackgroundCommand(process.execPath, ["-e", "process.exit(9)"]), /failed/);
  const previousControl = process.env.PATINA_RUNTIME_CANCEL;
  const cancelFile = join(root, "cancel"), cancelledPidFile = join(root, "cancelled-pid");
  try {
    process.env.PATINA_RUNTIME_CANCEL = cancelFile;
    const completion = runBackgroundCommand(process.execPath, ["-e", "require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)", cancelledPidFile])
      .then(() => new Error("Unexpected background success"), error => error);
    const cancelledPid = await waitFor("cancellation fixture starts", () => { try { return Number(readFileSync(cancelledPidFile, "utf8")) || null; } catch { return null; } });
    writeFileSync(cancelFile, "cancel");
    assert.match(String(await completion), /Background command cancelled/);
    assert.equal(alive(cancelledPid), false);
    assert.equal(alive(unrelated.pid!), true);
  } finally {
    if (previousControl === undefined) delete process.env.PATINA_RUNTIME_CANCEL; else process.env.PATINA_RUNTIME_CANCEL = previousControl;
  }
  await assert.rejects(job.exitCode(unrelated.pid!), /not owned/);
  const exit = await job.start(process.execPath, ["-e", "process.exit(7)"]);
  await waitFor("owned exit status", async () => (await job!.exitCode(exit)) !== -1);
  assert.equal(await job.exitCode(exit), 7);
  await assert.rejects(job.start(join(root, "missing.exe")));
  const next = await job.start(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  await job.close(); job = null;
  const releasedLease = await createRuntimeJob(process.env, value => log.push(value));
  try { assert.equal(await releasedLease.claimDesktop(lease), 0); }
  finally { await releasedLease.close(); }
  assert.equal(alive(next), false);
  assert.equal(alive(unrelated.pid!), true);
  const crashed = await createRuntimeJob(process.env, value => log.push(value));
  const crashReceipt = join(root, "crashed-tree.json"), crashTrigger = join(root, "crash-supervisor");
  try {
    const crashCode = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});fs.writeFileSync(process.argv[1],JSON.stringify({root:process.pid,child:child.pid}));setInterval(()=>{if(fs.existsSync(process.argv[2]))process.kill(process.ppid)},20);`;
    await crashed.start(process.execPath, ["-e", crashCode, crashReceipt, crashTrigger]);
    const tree = await waitFor("crash control tree starts", () => {
      try { return JSON.parse(readFileSync(crashReceipt, "utf8")); } catch { return null; }
    });
    writeFileSync(crashTrigger, "crash");
    await waitFor("supervisor crash reaps its complete job", () => !alive(tree.root) && !alive(tree.child));
    await assert.rejects(crashed.count(), /closed|exited/);
    await assert.rejects(crashed.close(), /closed|exited|cleanly/);
    assert.equal(alive(unrelated.pid!), true);
  } finally { await crashed.close().catch(() => {}); }
  console.log("PASS runtime selection, required results, owned job descendants, quoting, restart, failure and cleanup isolation");
} finally {
  await job?.close();
  unrelated?.kill();
  if(unrelated?.pid) await waitFor("control child cleanup", () => !alive(unrelated!.pid!));
  assertIsolatedTempPath(root, "patina-runtime-harness-");
  rmSync(root, { recursive: true, force: true });
}
