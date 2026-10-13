import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// This opt-in gate restores exact source bytes even when compilation or the
// behavioral assertion fails. Never run it concurrently with another Rust build.
const source = "src-tauri/src/data/remote_backup_config.rs";
const original = readFileSync(source);
const text = original.toString("utf8");
const search = "let id = store.prepare(&identity)?;";
assert.equal(text.split(search).length, 2, "native mutation anchor drifted");
const output = resolve("artifacts/quality-9plus/native-mutation");
mkdirSync(output, { recursive: true });
function run(label: string) {
  const result = spawnSync("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--offline", "--lib",
    "sqlite_failure_and_cleanup_failure_have_distinct_commit_outcomes", "--", "--nocapture"],
  { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(`${output}/${label}.log`, String(result.stdout ?? "") + String(result.stderr ?? "") + String(result.error ?? ""), "utf8");
  if (result.error) throw result.error;
  return result;
}
try {
  const baseline = run("baseline");
  assert.equal(baseline.status, 0, baseline.stderr);
  writeFileSync(source, text.replace(search, "let id = old.credential_ref.clone().unwrap_or(store.prepare(&identity)?);"), "utf8");
  const mutant = run("reuse-active-credential");
  assert.notEqual(mutant.status, 0, "SURVIVED overwriting the active credential before SQLite commit");
  assert.match(mutant.stdout + mutant.stderr, /assertion .*failed/,
    "The mutant must fail a behavior assertion, not compilation or process startup");
  console.log("KILLED active credential overwrite: failed SQLite commit no longer preserves the old usable pair");
} finally {
  writeFileSync(source, original);
}
