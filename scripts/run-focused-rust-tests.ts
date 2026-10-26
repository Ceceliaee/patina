import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function focusedRustArguments(args: string[]) {
  let filter: string | undefined;
  let target: string | undefined;
  let exact = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--filter" || argument === "--test") {
      const value = args[++index];
      assert.ok(value?.trim() && !value.startsWith("-"), `${argument} requires a nonempty value`);
      if (argument === "--filter") {
        assert.equal(filter, undefined, "Duplicate --filter"); filter = value;
      } else {
        assert.equal(target, undefined, "Duplicate --test"); target = value;
      }
    } else if (argument === "--exact") {
      assert.ok(!exact, "Duplicate --exact"); exact = true;
    } else throw new Error(`Unknown focused Rust argument: ${argument}`);
  }
  assert.ok(filter, "--filter is required; use check:rust for complete validation");
  return ["test", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--offline",
    ...(target ? ["--test", target] : ["--lib"]), filter, "--", ...(exact ? ["--exact"] : [])];
}

export function assertFocusedRustResult(status: number | null, output: string) {
  assert.equal(status, 0, `Focused Rust command failed (exit ${status})`);
  const summaries = [...output.matchAll(/^test result: ok\. (\d+) passed; (\d+) failed;/gm)];
  const passed = summaries.reduce((sum, match) => sum + Number(match[1]), 0);
  assert.ok(summaries.length > 0 && passed > 0 && summaries.every(match => Number(match[2]) === 0),
    "Focused Rust selection ran zero passing tests; check the filter and target (ignored tests do not count)");
  return passed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = focusedRustArguments(process.argv.slice(2));
  const result = spawnSync("cargo", args, {
    env: { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? resolve("src-tauri/target/quality") },
    encoding: "utf8", windowsHide: true, shell: false, maxBuffer: 16 * 1024 * 1024,
    stdio: ["inherit", "pipe", "inherit"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.error) throw result.error;
  const passed = assertFocusedRustResult(result.status, result.stdout ?? "");
  console.log(`Focused Rust selection: ${passed} passed; complete acceptance remains separate`);
}
