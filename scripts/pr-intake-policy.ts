export const MAX_MANUAL_LINES = 1_000;
export const MAX_MANUAL_FILES = 25;

export const INTAKE_EXCEPTION_LABELS = {
  size: "intake-exception/size",
  tests: "intake-exception/tests",
} as const;

export const INTAKE_APPROVAL_LABELS = {
  acceptedScope: "intake/accepted-scope",
} as const;

export const EXCEPTION_RULES: Record<string, string> = {
  "oversized-manual-diff": INTAKE_EXCEPTION_LABELS.size,
  "too-many-manual-files": INTAKE_EXCEPTION_LABELS.size,
  "risk-path-without-tests": INTAKE_EXCEPTION_LABELS.tests,
};

export const KNOWN_FEATURE_OWNERS = new Set([
  "about",
  "classification",
  "dashboard",
  "data",
  "history",
  "settings",
  "tools",
  "update",
]);

export const QUALITY_GATE_PATH_PATTERNS = [
  /^scripts\/check-.*\.ts$/,
  /^\.github\/workflows\/[^/]+\.ya?ml$/,
] as const;

export const FEATURE_STYLE_OWNER_PREFIXES = [
  "about",
  "classification",
  "dashboard",
  "data",
  "history",
  "settings",
  "tools",
  "update",
] as const;

export const RISK_AREAS = [
  {
    id: "tracking",
    label: "tracking lifecycle",
    paths: [/^src-tauri\/src\/engine\/tracking\//],
    tests: [
      /^tests\/tracking/i,
      /^src-tauri\/src\/engine\/tracking\/.*test/i,
      /^src-tauri\/src\/engine\/tracking\/.*tests\.rs$/i,
    ],
    testExamples: "tests/tracking*.test.ts or src-tauri tracking tests",
  },
  {
    id: "data",
    label: "SQLite data boundary",
    paths: [/^src-tauri\/src\/data\//],
    tests: [
      /^tests\/persistence/i,
      /^tests\/.*sqlite/i,
      /^src-tauri\/src\/data\/.*test/i,
      /^src-tauri\/src\/data\/.*tests\.rs$/i,
    ],
    testExamples: "tests/persistence*.test.ts, tests/*sqlite*.test.ts, or src-tauri data tests",
  },
  {
    id: "backup",
    label: "backup and restore",
    paths: [/^src-tauri\/src\/commands\/backup\.rs$/],
    tests: [
      /^tests\/.*backup/i,
      /^tests\/settings/i,
      /^src-tauri\/src\/.*backup.*test/i,
      /^src-tauri\/src\/.*backup.*tests\.rs$/i,
    ],
    testExamples: "tests/*backup*.test.ts, tests/settings*.test.ts, or src-tauri backup tests",
  },
  {
    id: "export",
    label: "data export",
    paths: [
      /^src-tauri\/src\/commands\/export\.rs$/,
      /^src-tauri\/src\/engine\/export\//,
      /^src\/features\/settings\/.*export/i,
    ],
    tests: [
      /^tests\/export/i,
      /^tests\/.*export/i,
      /^src-tauri\/src\/.*export.*test/i,
      /^src-tauri\/src\/.*export.*tests\.rs$/i,
    ],
    testExamples: "tests/export*.test.ts or src-tauri export tests",
  },
  {
    id: "tools-alerts",
    label: "tools alert behavior",
    paths: [
      /^src\/features\/tools\/hooks\/useToolAlerts\.ts$/,
      /^src\/features\/tools\/components\/(?:NotificationToastStack|ToolAlertDialog)\.tsx$/,
    ],
    tests: [
      /^tests\/.*tools?.*\.test\.(ts|tsx)$/i,
      /^src\/features\/tools\/.*\.test\.(ts|tsx)$/i,
    ],
    testExamples: "tests/*tools*.test.ts or owner-local tools alert tests",
  },
  {
    id: "data-read-model",
    label: "data read model and trend aggregation",
    paths: [
      /^src\/features\/data\/services\/data.*ReadModel\.ts$/i,
      /^src\/features\/data\/services\/data(?:BootstrapSnapshot|FirstScreenPrewarm)\.ts$/i,
      /^src\/features\/data\/components\/Data(?:AppTrend|Trend|WebTrend).*\.tsx$/i,
    ],
    tests: [
      /^tests\/data.*\.test\.ts$/i,
      /^tests\/.*data.*ReadModel.*\.test\.ts$/i,
      /^src\/features\/data\/.*\.test\.(ts|tsx)$/i,
    ],
    testExamples: "tests/data*.test.ts or owner-local data read-model tests",
  },
  {
    id: "screenshot-capture",
    label: "screen capture and screenshot file lifecycle",
    paths: [
      /^src-tauri\/src\/commands\/screenshots\.rs$/,
      /^src-tauri\/src\/engine\/screenshots\//,
    ],
    tests: [
      /^src-tauri\/src\/commands\/screenshots.*test.*\.rs$/i,
      /^src-tauri\/src\/commands\/screenshots.*tests\.rs$/i,
      /^src-tauri\/src\/engine\/screenshots\/.*test.*\.rs$/i,
      /^src-tauri\/src\/engine\/screenshots\/.*tests\.rs$/i,
    ],
    testExamples: "src-tauri screenshot command/engine tests covering settings, retention, capture, and file path safety",
  },
  {
    id: "settings-persistence",
    label: "settings persistence",
    paths: [
      /^src\/features\/settings\//,
      /^src\/platform\/persistence\//,
    ],
    tests: [
      /^tests\/settings/i,
      /^tests\/persistence/i,
      /^tests\/.*settings/i,
      /^src\/features\/settings\/.*test\.(ts|tsx)$/i,
      /^src\/platform\/persistence\/.*test\.(ts|tsx)$/i,
    ],
    testExamples: "tests/settings*.test.ts, tests/persistence*.test.ts, or owner-local settings tests",
  },
] as const;

const REQUIRED_BODY_SECTIONS = [
  "Purpose",
  "Accepted Scope",
  "Changes",
  "Scope Boundary",
  "Owner Check",
  "Risk Review",
  "UI Review",
  "Validation",
  "Contributor Checklist",
] as const;

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: string;
  additions: number;
  deletions: number;
  binary?: boolean;
}

export interface IntakeFailure {
  rule: string;
  message: string;
  detail?: string;
}

export function isUiImplementationPath(path: string) {
  return (
    /^src\/features\/.*\.(tsx|css)$/.test(path) ||
    /^src\/app\/.*\.(tsx|css)$/.test(path) ||
    /^src\/shared\/.*\.(tsx|css)$/.test(path) ||
    /^src\/styles\/(?!tokens\.css$).*\.css$/.test(path)
  );
}

function getBodySection(body: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^##\\s+${escaped}\\s*(?:\\r?\\n)([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "im");
  return body.match(pattern)?.[1] ?? "";
}

function stripComments(text: string) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function hasMeaningfulAcceptedScope(body: string) {
  return /(?:#\d+\b|https:\/\/\S+)/i.test(stripComments(getBodySection(body, "Accepted Scope")));
}

function hasUncheckedContributorChecklist(body: string) {
  return /^\s*-\s*\[\s\]/m.test(getBodySection(body, "Contributor Checklist"));
}

function hasMeaningfulText(section: string) {
  return stripComments(section)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line && line !== "-" && !/^Refs\s*#\s*$/i.test(line));
}

function hasLabeledValue(section: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^-\\s*${escaped}:\\s*\\S.+$`, "im").test(stripComments(section));
}

function hasCheckedItem(section: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^-\\s*\\[[xX]\\]\\s*${escaped}(?:\\s|$)`, "im").test(section);
}

export function evaluatePullRequestBody(
  body: string | undefined,
  required: boolean,
  changedFiles: ChangedFile[],
): IntakeFailure[] {
  const failures: IntakeFailure[] = [];
  if (!required) return failures;
  if (!body?.trim()) {
    return [{
      rule: "missing-pr-body",
      message: "Missing pull request body.",
      detail: "Use the pull request template and complete the intake sections before requesting review.",
    }];
  }

  for (const section of REQUIRED_BODY_SECTIONS) {
    if (!getBodySection(body, section).trim()) {
      failures.push({ rule: "missing-pr-section", message: `Missing required PR section: ${section}.` });
    }
  }
  if (!hasMeaningfulAcceptedScope(body)) {
    failures.push({
      rule: "missing-accepted-scope",
      message: "Missing accepted scope.",
      detail: "Add a concrete #issue reference or URL under Accepted Scope. External PRs also require the maintainer-applied scope label.",
    });
  }

  const incomplete: string[] = [];
  if (!hasMeaningfulText(getBodySection(body, "Purpose"))) incomplete.push("Purpose must explain the user problem or maintenance goal");
  if (!hasMeaningfulText(getBodySection(body, "Changes"))) incomplete.push("Changes must describe the behavior being changed");
  const scope = getBodySection(body, "Scope Boundary");
  if (!hasLabeledValue(scope, "In scope") || !hasLabeledValue(scope, "Out of scope")) incomplete.push("Scope Boundary must complete both In scope and Out of scope");
  const owner = getBodySection(body, "Owner Check");
  if (!hasLabeledValue(owner, "Frontend owner") || !hasLabeledValue(owner, "Rust owner") || !hasLabeledValue(owner, "Why this placement fits")) incomplete.push("Owner Check must identify both owners (use N/A when unaffected) and justify the placement");
  const risk = getBodySection(body, "Risk Review");
  for (const label of ["Tracking correctness", "Local data safety", "Privacy or security", "Compatibility and migration", "Failure and recovery behavior"]) {
    if (!hasLabeledValue(risk, label)) incomplete.push(`Risk Review must complete ${label} (use N/A when unaffected)`);
  }
  if (!hasCheckedItem(getBodySection(body, "Validation"), "`npm run check`")) incomplete.push("Validation must confirm npm run check was run");
  if (incomplete.length > 0) failures.push({ rule: "incomplete-pr-sections", message: "Required PR template fields are incomplete.", detail: incomplete.join("\n") });

  if (changedFiles.some((file) => isUiImplementationPath(file.path))) {
    const ui = getBodySection(body, "UI Review");
    const screenshots = stripComments(getBodySection(body, "Screenshots"));
    const hasScreenshot = /(?:!\[[^\]]*\]\(https:\/\/|<img\b[^>]*\bsrc=["']https:\/\/|https:\/\/\S+\.(?:png|jpe?g|webp)\b)/i.test(screenshots);
    if (!hasCheckedItem(ui, "UI follows Quiet Pro") || !hasCheckedItem(ui, "Screenshots attached") || !hasScreenshot) {
      failures.push({
        rule: "missing-ui-evidence",
        message: "Visible UI changes require Quiet Pro confirmation and screenshots.",
        detail: "Check UI follows Quiet Pro and Screenshots attached, then add rendered UI image links under Screenshots.",
      });
    }
  }
  if (hasUncheckedContributorChecklist(body)) {
    failures.push({
      rule: "unchecked-contributor-checklist",
      message: "Contributor Checklist still has unchecked items.",
      detail: "Complete the checklist before requesting review. Maintainer exceptions are tracked with repository labels, not PR text.",
    });
  }
  return failures;
}

export function evaluateMaintainerScopeApproval(required: boolean, labels: string[] | undefined) {
  const normalized = new Set((labels ?? []).map((label) => label.trim().toLowerCase()));
  if (!required || normalized.has(INTAKE_APPROVAL_LABELS.acceptedScope)) return [];
  return [{
    rule: "missing-maintainer-scope-approval",
    message: "The proposed scope has not been accepted by a maintainer.",
    detail: `Discuss the change in an Issue first. A maintainer will apply ${INTAKE_APPROVAL_LABELS.acceptedScope} when the problem, boundary, and acceptance criteria are agreed. PR body text cannot grant this approval.`,
  }];
}
