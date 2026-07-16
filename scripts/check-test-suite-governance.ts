import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, sep } from "node:path";

interface AuditInput {
  scripts: Record<string, string>;
  testFiles: string[];
  testSources: Map<string, string>;
  rustSources: Map<string, string>;
  allowedIgnoredTests: Map<string, string>;
}

interface AuditResult {
  failures: string[];
  leafOwners: Map<string, string[]>;
  checkCounts: Map<string, number>;
  fastCounts: Map<string, number>;
}

const BROWSER_TEST = "tests/uiBrowserSmoke.test.ts";
const RUNTIME_TEST = "tests/tauriRuntimeSmoke.test.ts";
const REQUIRED_SCRIPTS = [
  "test",
  "test:fast:covered",
  "test:fast:remaining",
  "test:coverage",
  "test:ui-browser-smoke",
  "test:tauri-runtime-smoke",
  "check:test-governance",
  "check:test-governance:self-test",
  "check:tests",
  "check",
] as const;
const ALLOWED_IGNORED_TESTS = new Map([
  [
    "src-tauri/src/data/schema.rs::session_range_query_plan_report",
    "run with npm run perf:sqlite-query-plan",
  ],
]);

function normalizePath(path: string) {
  return path.split(sep).join("/").replace(/^\.\//, "");
}

function collectFiles(root: string, extension: RegExp): string[] {
  const files: string[] = [];
  function walk(path: string) {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) walk(`${path}/${entry}`);
    } else if (extension.test(path)) {
      files.push(normalizePath(relative(process.cwd(), path)));
    }
  }
  walk(root);
  return files.sort();
}

function directTestReferences(command: string) {
  return [...command.matchAll(/(?:^|[\s"'])(tests[\\/][^\s"';&|]+\.test\.ts)/g)]
    .map((match) => normalizePath(match[1]));
}

function referencedScripts(command: string) {
  const references = [...command.matchAll(/\bnpm(?:\.cmd)?\s+run(?:-script)?\s+([A-Za-z0-9:_-]+)/g)]
    .map((match) => match[1]);
  for (const match of command.matchAll(/\bnpm(?:\.cmd)?\s+(test|start|stop|restart)\b/g)) {
    references.push(match[1]);
  }
  return references;
}

function expandScript(
  root: string,
  scripts: Record<string, string>,
  failures: string[],
  ancestry: string[] = [],
): Map<string, number> {
  const counts = new Map<string, number>();
  if (ancestry.includes(root)) {
    failures.push(`script cycle detected: ${[...ancestry, root].join(" -> ")}`);
    return counts;
  }
  const command = scripts[root];
  if (command === undefined) {
    failures.push(`referenced npm script does not exist: ${root}`);
    return counts;
  }
  for (const test of directTestReferences(command)) {
    counts.set(test, (counts.get(test) ?? 0) + 1);
  }
  for (const child of referencedScripts(command)) {
    const childCounts = expandScript(child, scripts, failures, [...ancestry, root]);
    for (const [test, count] of childCounts) {
      counts.set(test, (counts.get(test) ?? 0) + count);
    }
  }
  return counts;
}

function findIgnoredTests(path: string, source: string) {
  const ignoredTests: Array<{ key: string; name: string | null; path: string; reason: string }> = [];
  const ignoreAttribute = /#\s*\[\s*ignore(?:\s*=\s*"([^"]*)")?\s*\]/g;
  for (const match of source.matchAll(ignoreAttribute)) {
    const followingSource = source.slice((match.index ?? 0) + match[0].length);
    const signature = followingSource.match(
      /^(?:(?:\s+)|(?:\/\/[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/)|(?:#\s*\[[^\]]+\]))*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/,
    );
    const line = source.slice(0, match.index ?? 0).split(/\r?\n/).length;
    const name = signature?.[1] ?? null;
    ignoredTests.push({
      key: `${path}::${name ?? `<unresolved-ignore-line-${line}>`}`,
      name,
      path,
      reason: match[1] ?? "",
    });
  }
  return ignoredTests;
}

function audit(input: AuditInput): AuditResult {
  const failures: string[] = [];
  const testFileSet = new Set(input.testFiles);
  const leafOwners = new Map<string, string[]>();

  for (const script of REQUIRED_SCRIPTS) {
    if (input.scripts[script] === undefined) failures.push(`required npm script is missing: ${script}`);
  }

  for (const [script, command] of Object.entries(input.scripts)) {
    for (const test of directTestReferences(command)) {
      if (!testFileSet.has(test)) failures.push(`${script} references missing test: ${test}`);
      const owners = leafOwners.get(test) ?? [];
      owners.push(script);
      leafOwners.set(test, owners);
    }
  }

  for (const test of input.testFiles) {
    const owners = leafOwners.get(test) ?? [];
    if (owners.length === 0) failures.push(`top-level test has no leaf script owner: ${test}`);
    if (owners.length > 1) failures.push(`top-level test has multiple leaf script owners: ${test} (${owners.join(", ")})`);
  }

  const coveredFailures: string[] = [];
  const coveredCounts = expandScript("test:fast:covered", input.scripts, coveredFailures);
  const remainingFailures: string[] = [];
  const remainingCounts = expandScript("test:fast:remaining", input.scripts, remainingFailures);
  const fastFailures: string[] = [];
  const fastCounts = expandScript("test", input.scripts, fastFailures);
  const checkFailures: string[] = [];
  const checkCounts = expandScript("check", input.scripts, checkFailures);
  failures.push(...coveredFailures, ...remainingFailures, ...fastFailures, ...checkFailures);

  const quickTests = input.testFiles.filter((test) => test !== BROWSER_TEST && test !== RUNTIME_TEST);
  for (const test of quickTests) {
    const covered = coveredCounts.get(test) ?? 0;
    const remaining = remainingCounts.get(test) ?? 0;
    if (covered + remaining !== 1) {
      failures.push(`quick test must belong to exactly one fast partition: ${test} (covered=${covered}, remaining=${remaining})`);
    }
    if ((fastCounts.get(test) ?? 0) !== 1) {
      failures.push(`npm test must execute quick test exactly once: ${test} (count=${fastCounts.get(test) ?? 0})`);
    }
    if ((checkCounts.get(test) ?? 0) !== 1) {
      failures.push(`npm run check must execute deterministic test exactly once: ${test} (count=${checkCounts.get(test) ?? 0})`);
    }
  }
  if ((fastCounts.get(BROWSER_TEST) ?? 0) !== 0 || (fastCounts.get(RUNTIME_TEST) ?? 0) !== 0) {
    failures.push("npm test must not include browser or desktop runtime smoke tests");
  }
  if ((checkCounts.get(BROWSER_TEST) ?? 0) !== 1) {
    failures.push(`npm run check must execute browser smoke exactly once (count=${checkCounts.get(BROWSER_TEST) ?? 0})`);
  }
  if ((checkCounts.get(RUNTIME_TEST) ?? 0) !== 0) {
    failures.push("npm run check must keep desktop runtime smoke in its independent CI job");
  }

  for (const [path, source] of input.testSources) {
    for (const match of source.matchAll(/\b(?:describe|it|test|runTest)\.(only|skip)\s*\(/g)) {
      failures.push(`focused or skipped TypeScript test is not allowed: ${path} (${match[0].trim()})`);
    }
  }

  const foundIgnored = new Map<string, string>();
  for (const [path, source] of input.rustSources) {
    for (const ignored of findIgnoredTests(path, source)) {
      if (!ignored.name) {
        failures.push(`Rust ignored attribute could not be bound to a test function: ${ignored.key}`);
      }
      if (foundIgnored.has(ignored.key)) {
        failures.push(`Rust ignored test was discovered more than once: ${ignored.key}`);
      }
      foundIgnored.set(ignored.key, ignored.reason);
      if (!ignored.reason) failures.push(`Rust ignored test must include a reason: ${ignored.key}`);
      const allowedReason = input.allowedIgnoredTests.get(ignored.key);
      if (allowedReason !== ignored.reason) {
        failures.push(`Rust ignored test is not in the exact allowlist: ${ignored.key} (${ignored.reason || "no reason"})`);
      }
    }
  }
  for (const [key, reason] of input.allowedIgnoredTests) {
    if (foundIgnored.get(key) !== reason) {
      failures.push(`allowed Rust ignored test no longer exists with its declared reason: ${key}`);
    }
  }

  return { failures: [...new Set(failures)].sort(), leafOwners, checkCounts, fastCounts };
}

function expectFailure(result: AuditResult, fragment: string) {
  if (!result.failures.some((failure) => failure.includes(fragment))) {
    throw new Error(`test governance self-test did not catch: ${fragment}\n${result.failures.join("\n")}`);
  }
}

function runSelfTest() {
  const base: AuditInput = {
    scripts: {
      "leaf:a": "node tests/a.test.ts",
      "leaf:b": "node tests/b.test.ts",
      "test:fast:covered": "npm run leaf:a",
      "test:fast:remaining": "npm run leaf:b",
      test: "npm run test:fast:covered && npm run test:fast:remaining",
      "test:coverage": "c8 npm run test:fast:covered",
      "test:mutation": "node scripts/mutation.ts",
      "test:ui-browser-smoke": "node tests/uiBrowserSmoke.test.ts",
      "test:tauri-runtime-smoke": "node tests/tauriRuntimeSmoke.test.ts",
      "check:test-governance": "node scripts/check-test-suite-governance.ts",
      "check:test-governance:self-test": "node scripts/check-test-suite-governance.ts --self-test",
      "check:tests": "npm run test:coverage && npm run test:fast:remaining && npm run test:mutation && npm run test:ui-browser-smoke",
      check: "npm run check:test-governance && npm run check:tests",
    },
    testFiles: ["tests/a.test.ts", "tests/b.test.ts", BROWSER_TEST, RUNTIME_TEST],
    testSources: new Map([
      ["tests/a.test.ts", "runTest('a', () => {})"],
      ["tests/b.test.ts", "runTest('b', () => {})"],
      [BROWSER_TEST, "runTest('browser', () => {})"],
      [RUNTIME_TEST, "runTest('runtime', () => {})"],
    ]),
    rustSources: new Map([[
      "src-tauri/src/data/schema.rs",
      '#[ignore = "run with npm run perf:sqlite-query-plan"]\nasync fn session_range_query_plan_report() {}',
    ]]),
    allowedIgnoredTests: new Map(ALLOWED_IGNORED_TESTS),
  };

  const valid = audit(base);
  if (valid.failures.length > 0) throw new Error(`valid governance fixture failed:\n${valid.failures.join("\n")}`);

  expectFailure(audit({ ...base, testFiles: [...base.testFiles, "tests/orphan.test.ts"] }), "no leaf script owner");
  expectFailure(audit({ ...base, scripts: { ...base.scripts, "leaf:a-copy": "node tests/a.test.ts" } }), "multiple leaf script owners");
  expectFailure(audit({
    ...base,
    scripts: { ...base.scripts, "check:tests": `${base.scripts["check:tests"]} && npm test` },
  }), "deterministic test exactly once");
  expectFailure(audit({
    ...base,
    scripts: { ...base.scripts, "leaf:missing": "node tests/missing.test.ts" },
  }), "references missing test");
  expectFailure(audit({
    ...base,
    testSources: new Map(base.testSources).set("tests/a.test.ts", "test.only('a', () => {})"),
  }), "focused or skipped TypeScript test");
  expectFailure(audit({
    ...base,
    rustSources: new Map([[
      "src-tauri/src/data/schema.rs",
      "#[ignore]\nasync fn session_range_query_plan_report() {}",
    ]]),
  }), "must include a reason");
  expectFailure(audit({
    ...base,
    rustSources: new Map([[
      "src-tauri/src/data/schema.rs",
      [
        '#[ignore = "run with npm run perf:sqlite-query-plan"]',
        "async fn session_range_query_plan_report() {}",
        '#[ignore = "run with npm run perf:sqlite-query-plan"]',
        "async fn unreviewed_copy_of_the_ignored_test() {}",
      ].join("\n"),
    ]]),
  }), "unreviewed_copy_of_the_ignored_test");
  expectFailure(audit({
    ...base,
    rustSources: new Map([[
      "src-tauri/src/data/schema.rs",
      '#[ignore = "run with npm run perf:sqlite-query-plan"]\nconst NOT_A_TEST: bool = true;',
    ]]),
  }), "could not be bound to a test function");
}

function inventory(): AuditInput {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  const testFiles = readdirSync("tests", { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => `tests/${entry.name}`)
    .sort();
  const allTestSources = new Map(
    collectFiles("tests", /\.ts$/).map((path) => [path, readFileSync(path, "utf8")]),
  );
  const rustSources = new Map(
    collectFiles("src-tauri/src", /\.rs$/).map((path) => [path, readFileSync(path, "utf8")]),
  );
  return {
    scripts: packageJson.scripts,
    testFiles,
    testSources: allTestSources,
    rustSources,
    allowedIgnoredTests: new Map(ALLOWED_IGNORED_TESTS),
  };
}

runSelfTest();
if (process.argv.includes("--self-test")) {
  console.log("Test suite governance self-test passed (8 adversarial cases)");
  process.exit(0);
}

const result = audit(inventory());
if (process.argv.includes("--report")) {
  console.log(JSON.stringify({
    topLevelTests: result.leafOwners.size,
    fastTests: [...result.fastCounts.values()].reduce((sum, count) => sum + count, 0),
    checkTests: [...result.checkCounts.values()].reduce((sum, count) => sum + count, 0),
    duplicateCheckTests: [...result.checkCounts].filter(([, count]) => count > 1),
    failures: result.failures,
  }, null, 2));
  process.exit(result.failures.length === 0 ? 0 : 1);
}
if (result.failures.length > 0) {
  console.error(`Test suite governance check failed:\n${result.failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log(`Test suite governance check passed (${result.leafOwners.size} top-level tests, no default-gate duplicates)`);
