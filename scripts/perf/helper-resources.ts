import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sourceFingerprint } from "../coverage/source-fingerprint.ts";

// Each case owns one bounded native test process. This does not launch Patina,
// access its database, or resume a soak.
assert.equal(process.platform, "win32", "Native resource experiments require Windows");
const cases = new Map<string, { test: string; env: Record<string, string> }>();
for (const mode of ["uncached", "cached", "missing", "com-only", "uncached-retained", "missing-retained", "uncached-pumped", "missing-pumped", "uncached-mta", "missing-mta", "parsing", "missing-parsing"]) {
  cases.set(`shell-${mode}`, {
    test: "app_metadata::resource_tests::shell_icon_resource_boundaries",
    env: { PATINA_SHELL_RESOURCE_CASE: mode },
  });
}
for (const mode of ["echo", "device", "manager", "enumerator", "retained-enumerator", "query", "activation-query", "lifecycle"]) {
  cases.set(`audio-${mode}`, {
    test: "audio::resource_tests::audio_resource_boundaries",
    env: { PATINA_AUDIO_RESOURCE_CASE: mode },
  });
}
cases.set("file", {
  test: "icon::resource_tests::file_icon_resource_boundaries",
  env: { PATINA_ICON_RESOURCE_PATH: process.env.PATINA_ICON_RESOURCE_PATH
    ?? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "notepad.exe") },
});
const selected = process.argv.slice(2);
assert(selected.length > 0 && selected.every(name => cases.has(name)),
  `Choose cases: ${[...cases.keys()].join(", ")}; file accepts PATINA_ICON_RESOURCE_PATH`);
const fingerprint = sourceFingerprint(["src-tauri/src/", "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock", "src-tauri/build.rs", "scripts/perf/helper-resources.ts"]);
const root = resolve("artifacts/runtime-reliability", `helper-resources-${Date.now()}`);
mkdirSync(root, { recursive: true });
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
console.log(`Native resource evidence: ${root}`);
const build = spawnSync("cargo", ["test", "--locked", "--manifest-path", "src-tauri/Cargo.toml",
  "--lib", "--no-run", "--message-format=json"], {
  encoding: "utf8", windowsHide: true, timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
});
writeFileSync(join(root, "build.jsonl"), build.stdout ?? "");
writeFileSync(join(root, "build.stderr.log"), build.stderr ?? "");
assert.equal(build.status, 0, `Build failed: ${build.error ?? build.stderr}`);
assert.deepEqual(sourceFingerprint(fingerprint.scope), fingerprint, "Inputs changed during build");
const executable = (build.stdout ?? "").split(/\r?\n/).filter(line => line.startsWith("{"))
  .map(line => JSON.parse(line))
  .find(row => row.reason === "compiler-artifact" && row.target.name === "patina_lib"
    && row.executable)?.executable;
assert.equal(typeof executable, "string", "Missing native test executable");
const frozen = join(root, "resource-tests.exe");
copyFileSync(executable, frozen);
let probeExecutable: string | undefined;
if (selected.includes("shell-cached")) {
  const app = spawnSync("cargo", ["build", "--locked", "--manifest-path",
    "src-tauri/Cargo.toml", "--message-format=json"], {
    encoding: "utf8", windowsHide: true, timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(join(root, "probe-build.jsonl"), app.stdout ?? "");
  writeFileSync(join(root, "probe-build.stderr.log"), app.stderr ?? "");
  assert.equal(app.status, 0, "Native probe build failed");
  const binary = (app.stdout ?? "").split(/\r?\n/).filter(line => line.startsWith("{"))
    .map(line => JSON.parse(line)).find(row => row.reason === "compiler-artifact"
      && row.target.name === "patina" && row.executable)?.executable;
  assert.equal(typeof binary, "string", "Missing native probe executable");
  probeExecutable = join(root, "Patina.exe");
  copyFileSync(binary, probeExecutable);
}
const report = {
  fingerprint, binarySha256: sha(frozen), measuredAt: new Date().toISOString(),
  probeBinarySha256: probeExecutable ? sha(probeExecutable) : null,
  soakRestarted: false,
  limitations: ["Counters and release results do not identify native allocation stacks.",
    "Installed apps, audio sessions and system load may change during a case."],
  cases: [] as Array<{ name: string; exitCode: number | null; error: string | null;
    elapsedMs: number; logSha256: string; deadlineMs: number }>,
};
for (const name of selected) {
  const fixture = cases.get(name)!;
  const started = performance.now();
  const result = spawnSync(frozen, ["--exact", `platform::windows::${fixture.test}`,
    "--ignored", "--nocapture"], {
    env: { ...process.env, ...fixture.env,
      ...(probeExecutable ? { PATINA_RESOURCE_PROBE_EXECUTABLE: probeExecutable } : {}) },
    encoding: "utf8", windowsHide: true,
    timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
  });
  const log = join(root, `${name}.log`);
  writeFileSync(log, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  report.cases.push({ name, exitCode: result.status, error: result.error?.message ?? null,
    elapsedMs: performance.now() - started, logSha256: sha(log), deadlineMs: 180_000 });
  writeFileSync(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(`${name}: exit=${result.status}, ${Math.round(performance.now() - started)} ms`);
  assert.equal(result.status, 0, `${name} failed; inspect ${log}: ${result.error ?? ""}`);
}
assert.deepEqual(sourceFingerprint(fingerprint.scope), fingerprint, "Inputs changed during experiments");
console.log(`Completed ${selected.length} bounded cases; inspect counters before judging resource stability.`);
