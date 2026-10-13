import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { sourceFingerprint } from "./source-fingerprint.ts";

const root = resolve("artifacts/coverage-full");
mkdirSync(root, { recursive: true });
const output = mkdtempSync(join(root, "frontend-"));
const fingerprint = sourceFingerprint(["src/", "tests/", "scripts/", "package.json", "pnpm-lock.yaml", "vite.config.ts"]);
const require = createRequire(import.meta.url);
const coverageRequire = createRequire(require.resolve("c8/package.json"));
const { createCoverageMap } = coverageRequire("istanbul-lib-coverage");
const pnpm = process.env.npm_execpath;
assert.ok(pnpm, "Run through pnpm run test:coverage:full:frontend");
function run(args: string[], env = process.env) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env, windowsHide: true });
  assert.equal(result.status, 0, `coverage child failed: ${result.error ?? args.join(" ")}`);
}
for (const suite of ["test:fast:covered", "test:fast:remaining"]) {
  const directory = suite.replaceAll(":", "-");
  run([require.resolve("c8/bin/c8.js"), "--all", "--clean", "--include=src/**", "--reporter=json",
    `--temp-directory=${join(output, directory, "raw")}`, `--report-dir=${join(output, directory)}`, pnpm, "run", suite]);
}
run(["--experimental-strip-types", "tests/uiBrowserSmoke.test.ts"], {
  ...process.env, PATINA_BROWSER_COVERAGE_DIR: join(output, "browser"),
});
const filesResult = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", windowsHide: true });
assert.equal(filesResult.status, 0);
const inventory = [...new Set(filesResult.stdout.split(/\r?\n/).filter(p => p && existsSync(p)))];
const maps = ["test-fast-covered", "test-fast-remaining", "browser"].map(suite => (
  createCoverageMap(JSON.parse(readFileSync(join(output, suite, "coverage-final.json"), "utf8")))
));
const excluded: Array<{ path: string; reason: string }> = [];
const details = [];
for (const file of inventory.filter(p => p.startsWith("src/") && /\.(ts|tsx)$/.test(p))) {
  const source = readFileSync(file, "utf8");
  const compiled = file.endsWith(".d.ts") ? "" : ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.trim();
  const reason = file.endsWith(".d.ts") ? "declaration"
    : file.startsWith("src/shared/i18n/generated/") ? "generated locale resources"
    : /^(export\s*\{\s*\};?)?$/.test(compiled) ? "type-only module" : null;
  if (reason) { excluded.push({ path: file, reason }); continue; }
  const counts: Record<string, number> = {};
  const canonical = resolve(file).toLowerCase();
  for (const map of maps) {
    const mapped = map.files().find((p: string) => resolve(p).toLowerCase() === canonical);
    if (!mapped) continue;
    for (const [line, hits] of Object.entries(map.fileCoverageFor(mapped).getLineCoverage())) {
      assert.ok(Number(line) > 0 && Number(line) <= source.split(/\r?\n/).length, `${file}: invalid source line ${line}`);
      counts[line] = Math.max(counts[line] ?? 0, Number(hits));
    }
  }
  // c8 --all normally supplies these. Missing modules must remain visible as zero.
  if (!Object.keys(counts).length) source.split(/\r?\n/).forEach((_, i) => { counts[String(i + 1)] = 0; });
  const uncovered = Object.keys(counts).filter(line => counts[line] === 0).map(Number);
  details.push({ path: file, total: Object.keys(counts).length, covered: Object.keys(counts).length - uncovered.length, uncovered });
}
const total = details.reduce((sum, row) => sum + row.total, 0);
const covered = details.reduce((sum, row) => sum + row.covered, 0);
const collection = JSON.parse(readFileSync(join(output, "browser/collection.json"), "utf8"));
assert.deepEqual(sourceFingerprint(fingerprint.scope), fingerprint, "Source changed during coverage collection");
const result = { measuredAt: new Date().toISOString(), fingerprint, environment: { platform: process.platform, arch: process.arch, node: process.version },
  files: details.length, total, covered, pct: covered / total * 100, excluded,
  toolsAndTests: inventory.filter(p => /^(scripts|tests)\//.test(p)),
  browser: collection,
  limitations: ["Line coverage is the union of observed Node and browser lines; branch/function instrumentation is not merged.",
    "Navigation can discard counts after the last sample. Acquisition failures are listed, not inferred as covered.",
    "Tool scripts and test infrastructure have behavior/self-test validation, not product coverage percentages."], details };
writeFileSync(join(output, "production-summary.json"), JSON.stringify(result, null, 2), "utf8");
writeFileSync(join(root, "frontend-latest.json"), JSON.stringify({ path: relative(process.cwd(), output), files: details.length, total, covered, pct: result.pct }, null, 2), "utf8");
console.log(JSON.stringify({ output, files: details.length, total, covered, pct: result.pct, acquisitionErrors: collection.errors.length }, null, 2));
