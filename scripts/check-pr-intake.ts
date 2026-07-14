import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateMaintainerScopeApproval, evaluatePullRequestBody,
  EXCEPTION_RULES, FEATURE_STYLE_OWNER_PREFIXES, INTAKE_EXCEPTION_LABELS,
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
  requireMaintainerScopeApproval?: boolean;
  addedLinesByFile?: Record<string, string[]>;
  registeredTypeScriptTests?: string[];
  registeredRustTests?: string[];
  labels?: string[];
}

interface CliOptions {
  base?: string;
  head?: string;
  bodyFile?: string;
  bodyEnv?: string;
  labelsJson?: string;
  labelsEnv?: string;
  authorAssociationEnv?: string;
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
  }).trimEnd();
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

    if (arg === "--labels-json" && next) {
      options.labelsJson = next;
      index += 1;
      continue;
    }

    if (arg === "--labels-env" && next) {
      options.labelsEnv = next;
      index += 1;
      continue;
    }

    if (arg === "--author-association-env" && next) {
      options.authorAssociationEnv = next;
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
    path === "package-lock.json" ||
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
  if (!output.trim()) {
    return [];
  }

  return output.split(/\r?\n/).map((line) => {
    const parts = line.split("\t");
    const status = parts[0];

    return {
      status,
      path: normalizePath(parts[1]),
      additions: 0,
      deletions: 0,
    };
  });
}

function parseNumstat(output: string) {
  const stats = new Map<string, Pick<ChangedFile, "additions" | "deletions" | "binary">>();

  if (!output.trim()) {
    return stats;
  }

  for (const line of output.split(/\r?\n/)) {
    const [additionsText, deletionsText, ...pathParts] = line.split("\t");
    const path = normalizePath(pathParts.join("\t"));
    const binary = additionsText === "-" || deletionsText === "-";

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
  const files = parseNameStatus(git(["diff", "--no-renames", "--name-status", range]));
  const stats = parseNumstat(git(["diff", "--no-renames", "--numstat", range]));

  return files.map((file) => ({
    ...file,
    ...(stats.get(file.path) ?? {}),
  }));
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

    for (const match of command.matchAll(/(?:^|\s)npm\s+run\s+([\w:-]+)/g)) {
      visit(match[1]);
    }

    for (const match of command.matchAll(/\btests\/[\w./-]+\.(?:test|spec)\.(?:ts|tsx)\b/g)) {
      registered.add(normalizePath(match[0]));
    }
  };

  ["check", "check:full", "check:frontend"].forEach(visit);
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
  const weakenedCommands = [...baseGraph.reachableScripts]
    .filter((name) => {
      const baseCommand = baseScripts[name] ?? "";
      const headCommand = headScripts[name] ?? "";
      const directSegments = baseCommand
        .split(/&&/)
        .map((segment) => segment.trim())
        .filter(Boolean)
        .filter((segment) => !/^npm\s+run\s+[\w:-]+(?:\s|$)/.test(segment));
      return headCommand && directSegments.some((segment) => !headCommand.includes(segment));
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
    details.push(`Existing validation command segments removed or replaced: ${weakenedCommands.slice(0, 12).join(", ")}`);
  }

  return [{
    rule: "validation-chain-weakened",
    message: "The normal validation chain was weakened.",
    detail: `${details.join("\n")}. Feature PRs may add focused validation, but must not remove or replace existing checks.`,
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
      detail: `Manual content changed: ${manualLines} lines. Limit: ${MAX_MANUAL_LINES} lines unless a maintainer applies ${INTAKE_EXCEPTION_LABELS.size}.`,
    });
  }

  if (manualFiles.length > MAX_MANUAL_FILES) {
    failures.push({
      rule: "too-many-manual-files",
      message: "Pull request touches too many manually maintained files.",
      detail: `Manual files changed: ${manualFiles.length}. Limit: ${MAX_MANUAL_FILES} files unless a maintainer applies ${INTAKE_EXCEPTION_LABELS.size}.`,
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
        return `${area.label}: ${paths}. Add ${area.testExamples}, or ask the maintainer whether ${INTAKE_EXCEPTION_LABELS.tests} is appropriate.`;
      })
      .join("\n"),
  }];
}

function normalizeLabel(label: string) {
  return label.trim().toLowerCase();
}

function hasExceptionLabel(labels: string[] | undefined, label: string) {
  const normalizedLabels = new Set((labels ?? []).map(normalizeLabel));
  return normalizedLabels.has(normalizeLabel(label));
}

function applyMaintainerExceptions(failures: IntakeFailure[], labels: string[] | undefined) {
  return failures.filter((failure) => {
    const exceptionLabel = EXCEPTION_RULES[failure.rule];
    return !exceptionLabel || !hasExceptionLabel(labels, exceptionLabel);
  });
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
    ...evaluateMaintainerScopeApproval(input.requireMaintainerScopeApproval ?? false, input.labels),
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

  return applyMaintainerExceptions(failures, input.labels);
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

function parseLabelsText(labelsText: string | undefined): string[] {
  if (!labelsText?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(labelsText);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }

          if (item && typeof item === "object" && "name" in item && typeof item.name === "string") {
            return item.name;
          }

          return "";
        })
        .map((label) => label.trim())
        .filter(Boolean);
    }
  } catch {
    return labelsText
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
  }

  return [];
}

function readLabels(options: CliOptions) {
  if (options.labelsJson) {
    return parseLabelsText(options.labelsJson);
  }

  if (options.labelsEnv) {
    return parseLabelsText(process.env[options.labelsEnv]);
  }

  return [];
}

function requiresMaintainerScopeApproval(options: CliOptions) {
  if (!options.authorAssociationEnv) {
    return false;
  }

  const association = (process.env[options.authorAssociationEnv] ?? "").trim().toUpperCase();
  return !new Set(["OWNER", "MEMBER", "COLLABORATOR"]).has(association);
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
    "- [ ] Screenshots attached",
    "## Validation",
    "- [x] `npm run check`",
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
    labels: [],
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
    labels: [],
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
  const labels = readLabels(options);
  const requirePullRequestBody = shouldRequirePullRequestTemplate(options);
  const requireMaintainerScopeApproval = requiresMaintainerScopeApproval(options);
  const registeredTypeScriptTests = loadRegisteredTypeScriptTests(options.head);
  const registeredRustTests = loadRegisteredRustTests(options.head, changedFiles);
  const failures = runPrIntakeCheck({
    changedFiles,
    addedLinesByFile,
    pullRequestBody,
    requirePullRequestBody,
    requireMaintainerScopeApproval,
    registeredTypeScriptTests,
    registeredRustTests,
    labels,
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
