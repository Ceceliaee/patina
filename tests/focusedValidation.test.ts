import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { browserGroups, parseBrowserGroup, assertBrowserSelection } from "./uiBrowserSmoke/options.ts";
import { focusedRustArguments, assertFocusedRustResult } from "../scripts/run-focused-rust-tests.ts";
import { miniFeedbackSamples, parseRuntimeOptions } from "./tauriRuntimeOptions.ts";

assert.equal(parseBrowserGroup([]), null);
for (const group of browserGroups) {
  assert.equal(parseBrowserGroup(["--group", group]), group);
  assert.equal(parseBrowserGroup([`--${group}-only`]), group);
  assertBrowserSelection(group, 2, 1);
}
for (const args of [["--typo"], ["--group"], ["--group", "missing"], ["--startup-only", "--startup-only"], ["--startup-only", "--group", "mini"]]) {
  assert.throws(() => parseBrowserGroup(args));
}
assert.throws(() => assertBrowserSelection(null, 0, 0), /zero tests/);
assert.throws(() => assertBrowserSelection("history", 9, 9), /zero selected/);
assertBrowserSelection("startup", 9, 9);

assert.deepEqual(focusedRustArguments(["--filter", "data::", "--exact"]),
  ["test", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--offline", "--lib", "data::", "--", "--exact"]);
assert.ok(focusedRustArguments(["--filter", "lifecycle", "--test", "native_probe_lifecycle"]).includes("native_probe_lifecycle"));
for (const args of [[], ["--filter"], ["--filter", " "], ["--filter", "x", "--filter", "y"], ["--filter", "x", "--ignored"], ["--filter", "x", "--test", "a", "--test", "b"], ["--filter", "x", "--exact", "--exact"]]) {
  assert.throws(() => focusedRustArguments(args));
}
assert.equal(assertFocusedRustResult(0, "test result: ok. 2 passed; 0 failed; 1 ignored;\n"), 2);
for (const [code, output] of [[0, ""], [0, "test result: ok. 0 passed; 0 failed; 1 ignored;"], [1, "test result: ok. 2 passed; 0 failed;"], [null, "test result: ok. 2 passed; 0 failed;"]] as const) {
  assert.throws(() => assertFocusedRustResult(code, output));
}

assert.deepEqual(miniFeedbackSamples(false), { hover: 50, reopen: 10 });
assert.deepEqual(miniFeedbackSamples(true), { hover: 3, reopen: 2 });
assert.equal(parseRuntimeOptions(["--group", "mini-input", "--feedback"]).feedback, true);
assert.equal(parseRuntimeOptions([]).feedback, false);
for (const args of [["--feedback"], ["--group", "resources", "--feedback"], ["--prepare-only", "--feedback"], ["--group", "contracts", "--feedback", "--feedback"]]) {
  assert.throws(() => parseRuntimeOptions(args));
}

// Exercise the public entry paths: bad options must fail before any build or desktop work.
for (const entry of ["tests/uiBrowserSmoke.test.ts", "tests/tauriRuntimeSmoke.test.ts", "scripts/run-focused-rust-tests.ts"]) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", entry, "--invalid-selection"], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  assert.notEqual(result.status, 0, `${entry} accepted an invalid selection`);
  assert.match(result.stderr, /Unknown.*(option|argument)/, `${entry} failed for an unrelated reason`);
}
console.log("Passed focused validation option, nonzero selection, acceptance sample and CLI negative controls");
