import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";
import { sourceFingerprint } from "./source-fingerprint.ts";

const base = resolve("artifacts/coverage-full");
mkdirSync(base, { recursive: true });
const output = mkdtempSync(join(base, "rust-"));
const fingerprint = sourceFingerprint(["src-tauri/src/", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/build.rs", "tests/", "scripts/coverage/", "src/"]);
const profiles = join(output, "profiles");
mkdirSync(profiles);
let sequence = 0;
function run(command: string, args: string[], env = process.env) {
  console.log(`Coverage: ${command} ${args.slice(0, 4).join(" ")}`);
  const result = spawnSync(command, args, { encoding: "utf8", env, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  writeFileSync(join(output, `${++sequence}.log`), String(result.stdout ?? "") + String(result.stderr ?? "") + String(result.error ?? ""), "utf8");
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed: ${result.error ?? result.stderr.slice(-6000)} (logs: ${output})`);
  return result.stdout;
}
const host = /host: (\S+)/.exec(run("rustc", ["-vV"]))![1];
const bin = join(run("rustc", ["--print", "sysroot"]).trim(), "lib", "rustlib", host, "bin");
const executable = process.platform === "win32" ? ".exe" : "";
const llvmProfdata = join(bin, "llvm-profdata" + executable);
const llvmCov = join(bin, "llvm-cov" + executable);
assert.ok(existsSync(llvmProfdata) && existsSync(llvmCov), "Install the pinned toolchain's llvm-tools-preview component before collecting coverage");
assert.ok(!process.env.RUSTC_WORKSPACE_WRAPPER, "Cannot combine an existing workspace compiler wrapper with coverage");
const target = resolve("src-tauri/target/coverage");
const wrapper = join(base, "instrument-rustc" + executable);
run("rustc", ["scripts/coverage/instrument-rustc.rs", "-o", wrapper]);
const env = { ...process.env, CARGO_TARGET_DIR: target, RUSTC_WORKSPACE_WRAPPER: wrapper,
  LLVM_PROFILE_FILE: join(profiles, "unit-%p-%m.profraw") };
const manifest = ["--manifest-path", "src-tauri/Cargo.toml", "--locked", "--offline"];
run("cargo", ["run", ...manifest, "--example", "coverage-source-scope", "--", resolve("src-tauri/src"), join(output, "scope.json")]);
const unitLog = run("cargo", ["test", ...manifest, "--lib", "--message-format=json"], env);
const artifacts = unitLog.split(/\r?\n/).filter(line => line.startsWith("{")).map(line => JSON.parse(line));
const unit = artifacts.find(item => item.reason === "compiler-artifact" && item.profile.test && item.target.name === "patina_lib")?.executable;
assert.ok(unit && existsSync(unit), "Missing exact instrumented library-test executable");
const unitProfiles = readdirSync(profiles).filter(p => p.startsWith("unit-") && p.endsWith(".profraw"));
assert.ok(unitProfiles.length > 0, "Library process produced no counters");
run(process.execPath, ["--experimental-strip-types", "tests/tauriRuntimeSmoke.test.ts"], {
  ...env, PATINA_COVERAGE_TARGET_DIR: target, LLVM_PROFILE_FILE: join(profiles, "desktop-%p-%m.profraw"),
});
const desktopProfiles = readdirSync(profiles).filter(p => p.startsWith("desktop-") && p.endsWith(".profraw"));
assert.ok(desktopProfiles.length > 0, "Real Tauri process produced no native counters");
const allProfiles = [...unitProfiles, ...desktopProfiles].map(p => join(profiles, p));
const profdata = join(output, "all.profdata");
run(llvmProfdata, ["merge", "-sparse", ...allProfiles, "-o", profdata]);
const lcov = run(llvmCov, ["export", "-format=lcov", unit, "-object", join(target, "debug", "patina" + executable), `-instr-profile=${profdata}`]);
writeFileSync(join(output, "coverage.lcov"), lcov, "utf8");
const scope = JSON.parse(readFileSync(join(output, "scope.json"), "utf8"));
const canon = (p: string) => normalize(p.startsWith("\\\\?\\") ? p.slice(4) : p).toLowerCase();
const sourceRoot = canon(resolve("src-tauri/src"));
const spans = new Map<string, number[][]>(Object.entries(scope.test_spans).map(([p, values]) => [canon(p), values as number[][]]));
const tests = new Set<string>(scope.test_files.map(canon));
const generated = new Set<string>(scope.generated_files.map(canon));
const records = new Map<string, Map<number, number>>();
let current: Map<number, number> | null = null;
let currentPath = "";
for (const line of lcov.split(/\r?\n/)) {
  if (line.startsWith("SF:")) {
    currentPath = canon(line.slice(3));
    current = currentPath.startsWith(sourceRoot) && !tests.has(currentPath) && !generated.has(currentPath)
      ? records.get(currentPath) ?? new Map() : null;
    if (current) records.set(currentPath, current);
  } else if (line.startsWith("DA:") && current) {
    const [number, hits] = line.slice(3).split(",").map(Number);
    if (!(spans.get(currentPath) ?? []).some(([start, end]) => number >= start && number <= end)) {
      current.set(number, Math.max(current.get(number) ?? 0, hits));
    }
  }
}
const details = [...records].filter(([, lines]) => lines.size > 0).map(([path, lines]) => ({
  path: relative(process.cwd(), path).replaceAll("\\", "/"), total: lines.size,
  covered: [...lines.values()].filter(hits => hits > 0).length,
  uncovered: [...lines].filter(([, hits]) => hits === 0).map(([line]) => line),
}));
assert.ok(details.some(row => row.path.endsWith("/main.rs") && row.covered > 0), "Binary entry point was not captured");
const total = details.reduce((sum, row) => sum + row.total, 0);
const covered = details.reduce((sum, row) => sum + row.covered, 0);
assert.deepEqual(sourceFingerprint(fingerprint.scope), fingerprint, "Source changed during coverage collection");
const result = { measuredAt: new Date().toISOString(), fingerprint, host, files: details.length, total, covered, pct: covered / total * 100,
  unitExecutable: unit, unitProfiles, desktopProfiles, excludedTestFiles: [...tests], generated: [...generated],
  unmapped: [...spans.keys()].filter(p => !tests.has(p) && !generated.has(p) && !records.get(p)?.size),
  limitations: ["Executed host target only; ARM64 and other conditional targets are not inferred.",
    "Forced process termination loses counters after the last diagnostics checkpoint; the crash recovery outcomes are tested separately.",
    "Unmapped files are listed explicitly, not treated as executed or silently counted as zero."], details };
writeFileSync(join(output, "production-summary.json"), JSON.stringify(result, null, 2), "utf8");
writeFileSync(join(base, "rust-latest.json"), JSON.stringify({ path: relative(process.cwd(), output), files: details.length, total, covered, pct: result.pct }, null, 2), "utf8");
console.log(JSON.stringify({ output, files: details.length, total, covered, pct: result.pct, desktopProfiles: desktopProfiles.length }, null, 2));
