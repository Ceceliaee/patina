import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluatePullRequestBody,
  FEATURE_STYLE_OWNER_PREFIXES,
  isUiImplementationPath, KNOWN_FEATURE_OWNERS,
  MAX_MANUAL_FILES, MAX_MANUAL_LINES,
  QUALITY_GATE_PATH_PATTERNS, RISK_AREAS,
  type ChangedFile,
  type IntakeFailure,
} from "./pr-intake-policy.ts";

export type { ChangedFile, IntakeFailure } from "./pr-intake-policy.ts";

interface IntakeInput {
  changedFiles: ChangedFile[];
  pullRequestBody?: string;
  requirePullRequestBody?: boolean;
  addedLinesByFile?: Record<string, string[]>;
  registeredTypeScriptTests?: string[];
  registeredRustTests?: string[];
}

interface CliOptions {
  base?: string;
  head?: string;
  bodyFile?: string;
  bodyEnv?: string;
  prCreatedAtEnv?: string;
  templateRequiredAfter?: string;
  requirePullRequestBody: boolean;
  selfTest: boolean;
}

function normalizePath(path: string) {
  return path.split(sep).join("/").replace(/\\/g, "/");
}

function diffRange(base: string, head: string) {
  return `${base}...${head}`;
}

function git(args: string[]) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    requirePullRequestBody: false,
    selfTest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--base" && next) {
      options.base = next;
      index += 1;
      continue;
    }

    if (arg === "--head" && next) {
      options.head = next;
      index += 1;
      continue;
    }

    if (arg === "--body-file" && next) {
      options.bodyFile = next;
      index += 1;
      continue;
    }

    if (arg === "--body-env" && next) {
      options.bodyEnv = next;
      index += 1;
      continue;
    }

    if (arg === "--pr-created-at-env" && next) {
      options.prCreatedAtEnv = next;
      index += 1;
      continue;
    }

    if (arg === "--template-required-after" && next) {
      options.templateRequiredAfter = next;
      index += 1;
      continue;
    }

    if (arg === "--require-pr-body") {
      options.requirePullRequestBody = true;
      continue;
    }

    if (arg === "--self-test") {
      options.selfTest = true;
    }
  }

  return options;
}

function isGeneratedOrLockPath(path: string) {
  return (
    path === "pnpm-lock.yaml" ||
    path === "Cargo.lock" ||
    path === "src-tauri/Cargo.lock" ||
    path === "skills-lock.json" ||
    path.startsWith("dist/") ||
    path.startsWith("src-tauri/target/") ||
    /\.(png|jpg|jpeg|gif|webp|ico|icns|bmp|mp4|mov|zip|gz|7z|pdf)$/i.test(path)
  );
}

function getRiskAreasForPath(path: string) {
  return RISK_AREAS.filter((area) => area.paths.some((pattern) => pattern.test(path)));
}

function matchesRiskAreaTest(path: string, area: (typeof RISK_AREAS)[number]) {
  return area.tests.some((pattern) => pattern.test(path));
}

function parseNameStatus(output: string): ChangedFile[] {
  if (output === "") {
    return [];
  }

  const fields = output.split("\0");
  if (fields.pop() !== "" || fields.length % 2 !== 0) {
    throw new Error("Malformed Git --name-status -z output: expected complete status/path records.");
  }
  const files: ChangedFile[] = [];
  const paths = new Set<string>();
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!/^[ADMTUXB]$/.test(status) || !path || paths.has(path)) {
      throw new Error("Malformed Git --name-status -z output: invalid status, empty path, or duplicate path.");
    }
    paths.add(path);
    files.push({ status, path, additions: 0, deletions: 0 });
  }
  return files;
}

function parseNumstat(output: string) {
  const stats = new Map<string, Pick<ChangedFile, "additions" | "deletions" | "binary">>();

  if (output === "") {
    return stats;
  }

  const records = output.split("\0");
  if (records.pop() !== "") {
    throw new Error("Malformed Git --numstat -z output: expected complete NUL-terminated records.");
  }
  for (const record of records) {
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    const additionsText = record.slice(0, firstTab);
    const deletionsText = record.slice(firstTab + 1, secondTab);
    const path = record.slice(secondTab + 1);
    const binary = additionsText === "-" && deletionsText === "-";
    const validCount = (value: string) => /^(?:0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value));
    if (firstTab < 0 || secondTab < 0 || !path || stats.has(path)
      || (!binary && (!validCount(additionsText) || !validCount(deletionsText)))) {
      throw new Error("Malformed Git --numstat -z output: invalid counts, empty path, or duplicate path.");
    }

    stats.set(path, {
      additions: binary ? 0 : Number(additionsText),
      deletions: binary ? 0 : Number(deletionsText),
      binary,
    });
  }

  return stats;
}

function loadChangedFiles(base?: string, head?: string): ChangedFile[] {
  if (!base || !head) {
    return [];
  }

  const range = diffRange(base, head);
  const files = parseNameStatus(git(["diff", "--no-renames", "--name-status", "-z", range]));
  const stats = parseNumstat(git(["diff", "--no-renames", "--numstat", "-z", range]));
  if (stats.size !== files.length) {
    throw new Error("Git diff metadata is incomplete: name-status and numstat file counts differ.");
  }
  return files.map((file) => {
    const fileStats = stats.get(file.path);
    if (!fileStats) throw new Error(`Git diff metadata is missing numstat for ${JSON.stringify(file.path)}.`);
    return { ...file, ...fileStats };
  });
}

function loadAddedLines(base?: string, head?: string, changedFiles: ChangedFile[] = []) {
  const addedLinesByFile: Record<string, string[]> = {};
  if (!base || !head) {
    return addedLinesByFile;
  }

  const range = diffRange(base, head);
  for (const file of changedFiles) {
    if (file.binary || file.status === "D") {
      continue;
    }

    const diff = git(["diff", "--unified=0", range, "--", file.path]);
    const addedLines = diff
      .split(/\r?\n/)
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1));
    addedLinesByFile[file.path] = addedLines;
  }

  return addedLinesByFile;
}

function loadPackageScripts(ref?: string) {
  if (!ref) {
    return {};
  }
  let packageText = "";
  try {
    packageText = git(["show", `${ref}:package.json`]);
  } catch {
    return {};
  }

  try {
    const parsed = JSON.parse(packageText) as { scripts?: Record<string, unknown> };
    return Object.fromEntries(
      Object.entries(parsed.scripts ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function collectValidationGraph(scripts: Record<string, string>) {
  const registered = new Set<string>();
  const visited = new Set<string>();
  const reachable = new Set<string>();
  const visit = (name: string) => {
    if (visited.has(name)) {
      return;
    }
    visited.add(name);

    const command = scripts[name];
    if (!command) {
      return;
    }
    reachable.add(name);

    for (const match of command.matchAll(/(?:^|\s)pnpm(?:\.(?:cmd|exe))?\s+run\s+([\w:-]+)/g)) {
      visit(match[1]);
    }
    if (/(?:^|\s)pnpm(?:\.(?:cmd|exe))?\s+test\b/.test(command)) visit("test");

    for (const match of command.matchAll(/\btests\/[\w./-]+\.(?:test|spec)\.(?:ts|tsx)\b/g)) {
      registered.add(normalizePath(match[0]));
    }
  };

  ["check", "check:full", "check:frontend", "test:tauri-runtime-smoke"].forEach(visit);
  return {
    reachableScripts: reachable,
    registeredTypeScriptTests: registered,
  };
}

function loadRegisteredTypeScriptTests(head?: string) {
  return [...collectValidationGraph(loadPackageScripts(head)).registeredTypeScriptTests];
}

function loadRegisteredRustTests(head: string | undefined, changedFiles: ChangedFile[]) {
  if (!head) {
    return [];
  }

  const registered: string[] = [];
  for (const file of changedFiles) {
    if (!/\.rs$/i.test(file.path) || !/(?:^|[/_])tests?(?:[/_.]|$)/i.test(file.path)) {
      continue;
    }

    if (/^src-tauri\/tests\/.*\.rs$/i.test(file.path)) {
      registered.push(file.path);
      continue;
    }

    const fileName = file.path.split("/").pop() ?? "";
    const moduleName = fileName.replace(/\.rs$/i, "");
    try {
      const references = git([
        "grep",
        "-l",
        "-E",
        `(?:mod[[:space:]]+${moduleName}[[:space:]]*;|${fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
        head,
        "--",
        "src-tauri/src",
      ]);
      if (references.trim()) {
        registered.push(file.path);
      }
    } catch {
      // git grep exits with 1 when the test module is not wired into the crate.
    }
  }

  return registered;
}

function expandValidationSteps(scripts: Record<string, string>, name: string, parents = new Set<string>()): string[] | null {
  if (parents.has(name) || !scripts[name]) return null;
  const steps: string[] = [];
  const chain = new Set([...parents, name]);
  for (const value of scripts[name].split("&&")) {
    const segment = value.trim();
    // Only an argv sequence joined by && is understood here. Other shell
    // syntax requires a maintainer change, not an inferred execution graph.
    if (!/^[\w./:=@,+-]+(?:[ \t]+[\w./:=@,+-]+)*$/.test(segment)) return null;
    const normalized = segment.replace(/[ \t]+/g, " ");
    const call = normalized.match(/^pnpm(?:\.(?:cmd|exe))? (?:run ([\w:-]+)|(test))$/);
    if (call) {
      const nested = expandValidationSteps(scripts, call[1] ?? call[2], chain);
      if (!nested) return null;
      steps.push(...nested);
    } else {
      steps.push(normalized);
    }
  }
  return steps;
}

export function findValidationChainRegressions(
  baseScripts: Record<string, string>,
  headScripts: Record<string, string>,
): IntakeFailure[] {
  const baseGraph = collectValidationGraph(baseScripts);
  const headGraph = collectValidationGraph(headScripts);
  const missingScripts = [...baseGraph.reachableScripts]
    .filter((name) => !headGraph.reachableScripts.has(name));
  const missingTests = [...baseGraph.registeredTypeScriptTests]
    .filter((path) => !headGraph.registeredTypeScriptTests.has(path));
  const trustedSteps = new Set([...baseGraph.reachableScripts]
    .flatMap((name) => expandValidationSteps(baseScripts, name) ?? []));
  const allowedAddition = (step: string) => trustedSteps.has(step)
    || /^node(?: --(?:experimental-strip-types|experimental-specifier-resolution=node|test))* tests\/[\w./-]+\.(?:test|spec)\.(?:ts|tsx)$/.test(step);
  const weakenedCommands = [...headGraph.reachableScripts].filter((name) => {
    if (headScripts[name] === baseScripts[name]) return false;
    const headSteps = expandValidationSteps(headScripts, name);
    if (!headSteps) return true;
    if (!baseGraph.reachableScripts.has(name)) return headSteps.some((step) => !allowedAddition(step));
    const baseSteps = expandValidationSteps(baseScripts, name);
    if (!baseSteps) return true;
    let preserved = 0;
    for (const step of headSteps) {
      if (step === baseSteps[preserved]) preserved += 1;
      else if (!allowedAddition(step)) return true;
    }
    return preserved !== baseSteps.length;
  });

  if (missingScripts.length === 0 && missingTests.length === 0 && weakenedCommands.length === 0) {
    return [];
  }

  const details: string[] = [];
  if (missingScripts.length > 0) {
    details.push(`Validation scripts no longer reachable: ${missingScripts.slice(0, 12).join(", ")}`);
  }
  if (missingTests.length > 0) {
    details.push(`Tests no longer reachable: ${missingTests.slice(0, 12).join(", ")}`);
  }
  if (weakenedCommands.length > 0) {
    details.push(`Validation execution changed or uses unsupported shell syntax: ${weakenedCommands.slice(0, 12).join(", ")}`);
  }

  return [{
    rule: "validation-chain-weakened",
    message: "The normal validation chain was weakened.",
    detail: `${details.join("\n")}. Preserve existing checks in order. Add focused Node test calls through && or complete pnpm run/test calls; other command changes require maintainer-owned validation policy.`,
  }];
}

function evaluateDiffSize(changedFiles: ChangedFile[]): IntakeFailure[] {
  const manualFiles = changedFiles.filter((file) => !isGeneratedOrLockPath(file.path));
  const manualLines = manualFiles.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const failures: IntakeFailure[] = [];

  if (manualLines > MAX_MANUAL_LINES) {
    failures.push({
      rule: "oversized-manual-diff",
      message: "Diff is too large for one review.",
      detail: `Manual content changed: ${manualLines} lines. Limit: ${MAX_MANUAL_LINES} lines. Split the pull request by behavior, owner, or independently verifiable stage before requesting review.`,
    });
  }

  if (manualFiles.length > MAX_MANUAL_FILES) {
    failures.push({
      rule: "too-many-manual-files",
      message: "Pull request touches too many manually maintained files.",
      detail: `Manual files changed: ${manualFiles.length}. Limit: ${MAX_MANUAL_FILES} files. Split the pull request by behavior, owner, or independently verifiable stage before requesting review.`,
    });
  }

  return failures;
}

function evaluateOwnerAndPathRules(changedFiles: ChangedFile[]): IntakeFailure[] {
  const failures: IntakeFailure[] = [];
  const reportedSuspiciousOwners = new Set<string>();

  for (const file of changedFiles) {
    if (/^src\/(lib|types)\//.test(file.path)) {
      failures.push({
        rule: "retired-root-layer",
        message: `Retired root layer changed: ${file.path}.`,
        detail: "Do not reintroduce src/lib or src/types.",
      });
    }

    if (file.path.startsWith("src/styles/shared/")) {
      failures.push({
        rule: "unowned-shared-styles",
        message: `Unowned shared style path changed: ${file.path}.`,
        detail: "Quiet Pro shared styling belongs in tokens.css or quiet-pro.css, not src/styles/shared.",
      });
    }

    const featureMatch = file.path.match(/^src\/features\/([^/]+)\//);
    if (featureMatch && file.status.startsWith("A") && !KNOWN_FEATURE_OWNERS.has(featureMatch[1])) {
      const owner = featureMatch[1];
      if (reportedSuspiciousOwners.has(owner)) {
        continue;
      }
      reportedSuspiciousOwners.add(owner);
      failures.push({
        rule: "suspicious-new-feature-owner",
        message: `Suspicious new feature owner: src/features/${owner}.`,
        detail: "Explain why this is a standalone feature; otherwise move the behavior under the real existing owner.",
      });
    }

    const featureStyleMatch = file.path.match(/^src\/styles\/features\/([^/]+)\.css$/);
    if (
      file.status.startsWith("A") &&
      featureStyleMatch &&
      !KNOWN_FEATURE_OWNERS.has(featureStyleMatch[1])
    ) {
      failures.push({
        rule: "standalone-feature-css",
        message: `Standalone feature CSS added: ${file.path}.`,
        detail: "Feature CSS must map to an established feature owner and must not bypass Quiet Pro tokens or component primitives.",
      });
    }
  }

  return failures;
}

function isQualityGatePath(path: string) {
  return QUALITY_GATE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function evaluateQualityGateOwnership(changedFiles: ChangedFile[]): IntakeFailure[] {
  const files = changedFiles
    .filter((file) => isQualityGatePath(file.path))
    .map((file) => file.path);

  if (files.length === 0) {
    return [];
  }

  return [{
    rule: "quality-gate-modified",
    message: "Quality gate files changed inside a pull request.",
    detail: `${files.slice(0, 8).join(", ")}. Gate scripts and workflow policy are maintainer-owned; do not loosen budgets, checks, or CI behavior inside a feature PR.`,
  }];
}

function findEncodingMarkerLines(addedLinesByFile: Record<string, string[]>) {
  const hits: string[] = [];

  for (const [path, lines] of Object.entries(addedLinesByFile)) {
    lines.forEach((line, index) => {
      if (line.includes("\uFEFF") || line.includes("ï»¿")) {
        hits.push(`${path}: added line ${index + 1}`);
      }
    });
  }

  return hits;
}

function findHardcodedStyleLines(addedLinesByFile: Record<string, string[]>) {
  const hits: string[] = [];

  for (const [path, lines] of Object.entries(addedLinesByFile)) {
    if (!isUiImplementationPath(path)) {
      continue;
    }

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
        return;
      }

      const hasToken = trimmed.includes("var(");
      const hardcodedColor =
        /#[0-9a-fA-F]{3,8}\b/.test(trimmed) ||
        /\b(?:rgb|rgba|hsl|hsla)\s*\(/i.test(trimmed);
      const hardcodedShadow = /\b(box-shadow|boxShadow)\s*:/.test(trimmed) && !hasToken;
      const hardcodedRadius = /\b(border-radius|borderRadius)\s*:/.test(trimmed) && !hasToken;
      const hardcodedBorder =
        /\b(border|borderColor|border-color)\s*:/.test(trimmed) &&
        !hasToken &&
        /(?:\bsolid\b|\brgba?\s*\(|#[0-9a-fA-F]{3,8}\b|\b\d+px\b)/.test(trimmed);
      const blur = /\b(backdrop-filter|filter)\s*:\s*blur/.test(trimmed);

      if (hardcodedColor || hardcodedShadow || hardcodedRadius || hardcodedBorder || blur) {
        hits.push(`${path}: added line ${index + 1}: ${trimmed}`);
      }
    });
  }

  return hits;
}

function findHardcodedCopyLines(addedLinesByFile: Record<string, string[]>) {
  const hits: string[] = [];
  const literalAttributePattern = /\b(aria-label|title|placeholder|alt)\s*=\s*(["'])([^"'{}`]+)\2/g;

  for (const [path, lines] of Object.entries(addedLinesByFile)) {
    if (
      !/^src\/features\/.*\.tsx$/.test(path) &&
      !/^src\/app\/.*\.tsx$/.test(path) &&
      !/^src\/shared\/.*\.tsx$/.test(path)
    ) {
      continue;
    }

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) {
        return;
      }

      for (const match of trimmed.matchAll(literalAttributePattern)) {
        const attribute = match[1];
        const value = match[3].trim();
        if (!value || (attribute === "alt" && value === "")) {
          continue;
        }

        hits.push(`${path}: added line ${index + 1}: ${match[0]}`);
        break;
      }
    });
  }

  return hits;
}

function findFeatureSpecificSharedStyleLines(addedLinesByFile: Record<string, string[]>) {
  const hits: string[] = [];
  const prefixPattern = new RegExp(`^\\.(${FEATURE_STYLE_OWNER_PREFIXES.join("|")})[-_]`);

  for (const [path, lines] of Object.entries(addedLinesByFile)) {
    if (path !== "src/styles/quiet-pro.css") {
      continue;
    }

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (prefixPattern.test(trimmed)) {
        hits.push(`${path}: added line ${index + 1}: ${trimmed}`);
      }
    });
  }

  return hits;
}

function evaluateEncodingRules(addedLinesByFile: Record<string, string[]>): IntakeFailure[] {
  const hits = findEncodingMarkerLines(addedLinesByFile);
  if (hits.length === 0) {
    return [];
  }

  return [{
    rule: "encoding-marker-added",
    message: "Encoding marker or mojibake marker detected in added text.",
    detail: `${hits.slice(0, 8).join("\n")}. Save text files as clean UTF-8 without BOM or mojibake markers.`,
  }];
}

function evaluateStyleRules(addedLinesByFile: Record<string, string[]>): IntakeFailure[] {
  const hits = findHardcodedStyleLines(addedLinesByFile);
  if (hits.length === 0) {
    return [];
  }

  return [{
    rule: "hardcoded-visual-style",
    message: "Hardcoded visual styles detected in UI implementation files.",
    detail: hits.slice(0, 8).join("\n"),
  }];
}

function evaluateCopyRules(addedLinesByFile: Record<string, string[]>): IntakeFailure[] {
  const hits = findHardcodedCopyLines(addedLinesByFile);
  if (hits.length === 0) {
    return [];
  }

  return [{
    rule: "hardcoded-ui-copy",
    message: "Hardcoded UI copy detected in implementation files.",
    detail: `${hits.slice(0, 8).join("\n")}. Add user-facing labels to the relevant copy owner instead of inline JSX literals.`,
  }];
}

function evaluateSharedStyleRules(addedLinesByFile: Record<string, string[]>): IntakeFailure[] {
  const hits = findFeatureSpecificSharedStyleLines(addedLinesByFile);
  if (hits.length === 0) {
    return [];
  }

  return [{
    rule: "feature-specific-shared-style",
    message: "Feature-specific selectors added to the shared Quiet Pro stylesheet.",
    detail: `${hits.slice(0, 8).join("\n")}. Shared styles should define stable primitives; feature selectors belong to their feature style owner.`,
  }];
}

function isTypeScriptTestPath(path: string) {
  return /\.(?:test|spec)\.(?:ts|tsx)$/i.test(path);
}

function evaluateRiskCoverage(
  changedFiles: ChangedFile[],
  registeredTypeScriptTests: string[] | undefined,
  registeredRustTests: string[] | undefined,
  addedLinesByFile: Record<string, string[]>,
): IntakeFailure[] {
  const riskAreas = new Map<(typeof RISK_AREAS)[number], ChangedFile[]>();

  for (const file of changedFiles) {
    for (const area of getRiskAreasForPath(file.path)) {
      riskAreas.set(area, [...(riskAreas.get(area) ?? []), file]);
    }
  }

  if (riskAreas.size === 0) {
    return [];
  }

  const registeredTests = registeredTypeScriptTests
    ? new Set(registeredTypeScriptTests.map(normalizePath))
    : undefined;
  const registeredRustTestPaths = registeredRustTests
    ? new Set(registeredRustTests.map(normalizePath))
    : undefined;
  const positiveCoverageFiles = changedFiles.filter((file) => {
    if (file.additions <= 0 || file.status.startsWith("D")) {
      return false;
    }

    if (registeredTests && isTypeScriptTestPath(file.path)) {
      return registeredTests.has(normalizePath(file.path));
    }

    if (registeredRustTestPaths && /\.rs$/i.test(file.path) && /test/i.test(file.path)) {
      return registeredRustTestPaths.has(normalizePath(file.path));
    }

    return true;
  });
  const uncovered = [...riskAreas.entries()]
    .filter(([area, files]) => {
      const hasFocusedFile = positiveCoverageFiles.some((file) => matchesRiskAreaTest(file.path, area));
      const hasInlineRustTest = files.some((file) =>
        /\.rs$/i.test(file.path) &&
        (addedLinesByFile[file.path] ?? []).some((line) => /#\[(?:tokio::)?test\]/.test(line)),
      );
      return !hasFocusedFile && !hasInlineRustTest;
    });

  if (uncovered.length === 0) {
    return [];
  }

  return [{
    rule: "risk-path-without-tests",
    message: "Risk-bearing files changed without focused tests.",
    detail: uncovered
      .map(([area, files]) => {
        const paths = files.map((file) => file.path).slice(0, 6).join(", ");
        return `${area.label}: ${paths}. Add ${area.testExamples} before requesting review.`;
      })
      .join("\n"),
  }];
}

function evaluateStaticTreeRules(): IntakeFailure[] {
  const failures: IntakeFailure[] = [];
  const retiredPaths = ["src/lib", "src/types", "src/styles/shared"];

  for (const path of retiredPaths) {
    if (existsSync(path)) {
      failures.push({
        rule: "retired-or-unowned-tree-path",
        message: `Retired or unowned tree path exists: ${path}.`,
        detail: "Use the current app / features / shared / platform structure and Quiet Pro style owners.",
      });
    }
  }

  return failures;
}

export function runPrIntakeCheck(input: IntakeInput): IntakeFailure[] {
  const failures = [
    ...evaluatePullRequestBody(
      input.pullRequestBody,
      input.requirePullRequestBody ?? false,
      input.changedFiles,
    ),
    ...evaluateDiffSize(input.changedFiles),
    ...evaluateOwnerAndPathRules(input.changedFiles),
    ...evaluateQualityGateOwnership(input.changedFiles),
    ...evaluateEncodingRules(input.addedLinesByFile ?? {}),
    ...evaluateStyleRules(input.addedLinesByFile ?? {}),
    ...evaluateCopyRules(input.addedLinesByFile ?? {}),
    ...evaluateSharedStyleRules(input.addedLinesByFile ?? {}),
    ...evaluateRiskCoverage(
      input.changedFiles,
      input.registeredTypeScriptTests,
      input.registeredRustTests,
      input.addedLinesByFile ?? {},
    ),
  ];

  return failures;
}

function readPullRequestBody(options: CliOptions) {
  if (options.bodyFile) {
    return readFileSync(options.bodyFile, "utf8");
  }

  if (options.bodyEnv) {
    return process.env[options.bodyEnv] ?? "";
  }

  return undefined;
}

function shouldRequirePullRequestTemplate(options: CliOptions) {
  if (!options.requirePullRequestBody) {
    return false;
  }

  if (!options.prCreatedAtEnv && !options.templateRequiredAfter) {
    return true;
  }

  const createdAtText = options.prCreatedAtEnv ? process.env[options.prCreatedAtEnv] : undefined;
  const requiredAfterText = options.templateRequiredAfter;
  if (!createdAtText || !requiredAfterText) {
    return true;
  }

  const createdAt = Date.parse(createdAtText);
  const requiredAfter = Date.parse(requiredAfterText);
  if (Number.isNaN(createdAt) || Number.isNaN(requiredAfter)) {
    return true;
  }

  return createdAt >= requiredAfter;
}

function formatFailures(failures: IntakeFailure[]) {
  return failures
    .map((failure) => {
      const lines = [`- ${failure.message}`, `  Rule: ${failure.rule}`];
      if (failure.detail) {
        lines.push(`  ${failure.detail.replace(/\n/g, "\n  ")}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

function runSelfTest() {
  const unusualPath = "docs/中文\tline\nquote\"back\\slash.md";
  assert.deepEqual(parseNameStatus(`M\0${unusualPath}\0`), [{ path: unusualPath, status: "M", additions: 0, deletions: 0 }]);
  assert.deepEqual(parseNumstat(`2\t1\t${unusualPath}\0`).get(unusualPath), { additions: 2, deletions: 1, binary: false });
  assert.deepEqual(parseNumstat("-\t-\tdocs/binary.md\0").get("docs/binary.md"), { additions: 0, deletions: 0, binary: true });
  for (const output of ["M\tdocs/a.md\n", "M\0docs/a.md", "M\0\0", "?\0docs/a.md\0", "M\0docs/a.md\0M\0docs/a.md\0"]) {
    assert.throws(() => parseNameStatus(output), /Malformed Git --name-status/);
  }
  for (const output of ["1\t0\tdocs/a.md", "1\tdocs/a.md\0", "1\t0\t\0", "-\t0\tdocs/a.md\0", "NaN\t0\tdocs/a.md\0", "1\t0\tdocs/a.md\0".repeat(2)]) {
    assert.throws(() => parseNumstat(output), /Malformed Git --numstat/);
  }
  const passingBody = [
    "## Purpose",
    "Improve a focused behavior.",
    "## Accepted Scope",
    "- Refs #123",
    "## Changes",
    "- Update owned code.",
    "## Scope Boundary",
    "- In scope: focused behavior",
    "- Out of scope: unrelated cleanup",
    "## Owner Check",
    "- Frontend owner: features/settings",
    "- Rust owner: N/A",
    "- Why this placement fits: settings owns it",
    "## Risk Review",
    "- Tracking correctness: N/A",
    "- Local data safety: N/A",
    "- Privacy or security: N/A",
    "- Compatibility and migration: N/A",
    "- Failure and recovery behavior: N/A",
    "## UI Review",
    "- [x] No UI changes",
    "- [ ] UI follows Quiet Pro",
    "- [ ] Screenshots attached externally",
    "- Affected states: N/A, no visible UI change",
    "- Keyboard and focus: N/A, no visible UI change",
    "- Repeatable test or existing owner test: N/A, no visible UI change",
    "## Validation",
    "- [x] `pnpm run check`",
    "## Contributor Checklist",
    "- [x] This pull request is linked to an accepted issue, Project item, or explicit maintainer-approved scope.",
  ].join("\n\n");

  const failures = runPrIntakeCheck({
    pullRequestBody: passingBody,
    requirePullRequestBody: true,
    changedFiles: [{
      path: "src/features/settings/services/example.ts",
      status: "M",
      additions: 10,
      deletions: 2,
    }, {
      path: "tests/settingsPageState.test.ts",
      status: "A",
      additions: 20,
      deletions: 0,
    }],
    addedLinesByFile: {},
  });

  if (failures.length > 0) {
    throw new Error(`PR intake self-test expected pass, got ${failures.map((failure) => failure.rule).join(", ")}`);
  }

  const failingRules = runPrIntakeCheck({
    pullRequestBody: "## Accepted Scope\n\n- Linked issue / Project item / maintainer approval:\n\n## Contributor Checklist\n\n- [ ] unchecked",
    requirePullRequestBody: true,
    changedFiles: [{
      path: "src/features/export/components/Export.tsx",
      status: "A",
      additions: 1_200,
      deletions: 0,
    }, {
      path: "src-tauri/src/engine/export/csv_exporter.rs",
      status: "M",
      additions: 20,
      deletions: 0,
    }],
    addedLinesByFile: {
      "src/features/export/components/Export.tsx": ["const style = { borderRadius: 16, color: '#fff' };"],
    },
  }).map((failure) => failure.rule);

  const expectedRules = [
    "missing-pr-section",
    "missing-accepted-scope",
    "unchecked-contributor-checklist",
    "oversized-manual-diff",
    "suspicious-new-feature-owner",
    "hardcoded-visual-style",
    "risk-path-without-tests",
  ];

  for (const rule of expectedRules) {
    if (!failingRules.includes(rule)) {
      throw new Error(`PR intake self-test expected rule ${rule}, got ${failingRules.join(", ")}`);
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.selfTest) {
    runSelfTest();
    console.log("PR intake self-test passed");
    return;
  }

  const changedFiles = loadChangedFiles(options.base, options.head);
  const addedLinesByFile = loadAddedLines(options.base, options.head, changedFiles);
  const pullRequestBody = readPullRequestBody(options);
  const requirePullRequestBody = shouldRequirePullRequestTemplate(options);
  const registeredTypeScriptTests = loadRegisteredTypeScriptTests(options.head);
  const registeredRustTests = loadRegisteredRustTests(options.head, changedFiles);
  const failures = runPrIntakeCheck({
    changedFiles,
    addedLinesByFile,
    pullRequestBody,
    requirePullRequestBody,
    registeredTypeScriptTests,
    registeredRustTests,
  }).concat(
    options.base && options.head
      ? findValidationChainRegressions(
          loadPackageScripts(options.base),
          loadPackageScripts(options.head),
        )
      : evaluateStaticTreeRules(),
  );

  if (failures.length === 0) {
    if (options.base && options.head) {
      console.log("PR Intake Gate passed");
    } else if (existsSync(".github/pull_request_template.md")) {
      console.log("PR Intake Gate static check passed");
    } else {
      console.log("PR Intake Gate static check passed without diff context");
    }
    return;
  }

  console.error("PR Intake Gate failed:");
  console.error("");
  console.error(formatFailures(failures));
  process.exitCode = 1;
}

if (process.argv[1] && normalizePath(process.argv[1]) === normalizePath(fileURLToPath(import.meta.url))) {
  main();
}
