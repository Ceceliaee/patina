export const MAX_MANUAL_LINES = 1_000;
export const MAX_MANUAL_FILES = 25;

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
  /^scripts\/pr-intake-policy\.ts$/,
  /^scripts\/perf\/.*benchmark.*\.ts$/,
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
    id: "window-authority",
    label: "native window process and command dispatch",
    paths: [/^desktop\/patina\/src\/(?:window_process|windows_host|tray)\.rs$/],
    tests: [/^desktop\/patina\/tests\/(?:today\.rs|pages\/resident\.rs)$/],
    testExamples: "desktop/patina/tests/pages/resident.rs or desktop/patina/tests/today.rs",
  },
  {
    id: "tracking",
    label: "tracking lifecycle",
    paths: [/^desktop\/recorder\/src\/engine\/tracking\//],
    tests: [
      /^tests\/tracking/i,
      /^desktop\/recorder\/src\/engine\/tracking\/.*test/i,
      /^desktop\/recorder\/src\/engine\/tracking\/.*tests\.rs$/i,
    ],
    testExamples: "tests/tracking*.test.ts or recorder tracking tests",
  },
  {
    id: "data",
    label: "SQLite data boundary",
    paths: [/^desktop\/recorder\/src\/data\/(?!export\/|backup\/|remote_backup\/)/],
    tests: [
      /^desktop\/recorder\/tests\/contracts\/.*\.rs$/,
      /^tests\/persistence/i,
      /^tests\/.*sqlite/i,
      /^desktop\/recorder\/src\/data\/.*test/i,
      /^desktop\/recorder\/src\/data\/.*tests\.rs$/i,
    ],
    testExamples: "tests/persistence*.test.ts, tests/*sqlite*.test.ts, or recorder data tests",
  },
  {
    id: "backup",
    label: "backup and restore",
    paths: [/^desktop\/recorder\/src\/data\/(?:backup\/|remote_backup\/)/],
    tests: [
      /^desktop\/recorder\/tests\/contracts\/storage\.rs$/,
      /^tests\/.*backup/i,
      /^tests\/settings/i,
      /^desktop\/recorder\/src\/.*backup.*test/i,
      /^desktop\/recorder\/src\/.*backup.*tests\.rs$/i,
    ],
    testExamples: "tests/*backup*.test.ts, tests/settings*.test.ts, or recorder backup tests",
  },
  {
    id: "export",
    label: "data export",
    paths: [
      /^desktop\/patina\/src\/settings\/storage\/export\.rs$/,
      /^desktop\/recorder\/src\/data\/export\//,
      /^src\/features\/settings\/.*export/i,
    ],
    tests: [
      /^desktop\/recorder\/tests\/contracts\/storage\.rs$/,
      /^tests\/export/i,
      /^tests\/.*export/i,
      /^desktop\/recorder\/src\/.*export.*test/i,
      /^desktop\/recorder\/src\/.*export.*tests\.rs$/i,
    ],
    testExamples: "desktop/recorder/tests/contracts/storage.rs or export module tests",
  },
  {
    id: "tools-alerts",
    label: "tools alert behavior",
    paths: [
      /^desktop\/patina\/src\/(?:tool_notice|tools)\.rs$/,
      /^src\/features\/tools\/(hooks\/useToolPresentation|services\/toolPresentationStore)\.ts$/,
      /^src\/platform\/runtime\/toolNotificationGateway\.ts$/,
      /^src\/features\/tools\/components\/(?:NotificationToastStack|ToolAlertDialog)\.tsx$/,
    ],
    tests: [
      /^desktop\/patina\/tests\/pages\/tools\.rs$/,
      /^tests\/.*tools?.*\.test\.(ts|tsx)$/i,
      /^src\/features\/tools\/.*\.test\.(ts|tsx)$/i,
    ],
    testExamples: "desktop/patina/tests/pages/tools.rs",
  },
  {
    id: "data-read-model",
    label: "data read model and trend aggregation",
    paths: [
      /^desktop\/recorder\/src\/data\/activity_read_model\//,
      /^desktop\/patina\/src\/data_page(?:\/|\.rs)/,
      /^src\/features\/data\/services\/data.*ReadModel\.ts$/i,
      /^src\/features\/data\/services\/data(?:BootstrapSnapshot|FirstScreenPrewarm)\.ts$/i,
      /^src\/features\/data\/components\/Data(?:AppTrend|Trend|WebTrend).*\.tsx$/i,
    ],
    tests: [
      /^desktop\/recorder\/tests\/contracts\.rs$/,
      /^desktop\/recorder\/src\/data\/activity_read_model\/.*tests\.rs$/,
      /^desktop\/patina\/tests\/pages\/(?:data_range|trend_chart)\.rs$/,
      /^tests\/data.*\.test\.ts$/i,
      /^tests\/.*data.*ReadModel.*\.test\.ts$/i,
      /^src\/features\/data\/.*\.test\.(ts|tsx)$/i,
    ],
    testExamples: "Recorder read-model tests or native data page tests",
  },
  {
    id: "native-probe",
    label: "native probe process lifecycle",
    paths: [/^desktop\/recorder\/src\/platform\/windows\/native_probe(?:\.rs|\/)/],
    tests: [
      /^desktop\/patina\/tests\/native_probe\.rs$/,
      /^desktop\/recorder\/src\/platform\/windows\/native_probe\/.*tests\.rs$/,
    ],
    testExamples: "desktop/patina/tests/native_probe.rs or a registered probe regression test",
  },
  {
    id: "settings-persistence",
    label: "settings persistence",
    paths: [
      /^desktop\/patina\/src\/settings(?:\/|\.rs)/,
      /^src\/features\/settings\//,
      /^src\/platform\/persistence\//,
    ],
    tests: [
      /^desktop\/patina\/tests\/pages\/(?:storage|services|schemes)\.rs$/,
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

const REVIEW_MEDIA_EXTENSION = /\.(?:png|apng|jpe?g|gif|webp|avif|bmp|svg|tiff?|heic|heif|mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpe?g)$/i;
const REVIEW_MEDIA_PATH_HINT = /(?:^|[\/_.-])(?:review|evidence|before|after|demo|screenshot|screen[-_]?recording)(?=$|[\/_.-])/i;

function isAllowedProductMediaPath(path: string) {
  return /^src\/features\/[^/]+\/assets\//.test(path) || /^desktop\/patina\/assets\/icons\//.test(path);
}

export function isRepositoryReviewMediaAddition(file: ChangedFile) {
  const addsPath = /^(?:A|C|R)/.test(file.status);
  return addsPath
    && REVIEW_MEDIA_EXTENSION.test(file.path)
    && (REVIEW_MEDIA_PATH_HINT.test(file.path) || !isAllowedProductMediaPath(file.path));
}

function isAllowedExternalScreenshotUrl(value: string) {
  try {
    const url = new URL(value.replace(/[)>.,;]+$/, ""));
    if (url.protocol !== "https:") return false;
    if (url.hostname === "raw.githubusercontent.com") return false;
    if (url.hostname === "github.com") {
      return /^\/user-attachments\/assets\//.test(url.pathname);
    }
    return true;
  } catch {
    return false;
  }
}

function hasExternalScreenshot(section: string) {
  const urls = section.match(/https:\/\/[^\s"'<>]+/gi) ?? [];
  return urls.some((url) => {
    const cleaned = url.replace(/[)>.,;]+$/, "");
    return isAllowedExternalScreenshotUrl(cleaned)
      && (/\.(?:png|jpe?g|webp)(?:\?|#|$)/i.test(cleaned) || /github\.com\/user-attachments\/assets\//i.test(cleaned));
  });
}

export function isUiImplementationPath(path: string) {
  return (
    /^desktop\/patina\/src\/(?:today|classification|data_page|history|about|settings|tools|tool_notice|mini|main_window|page_controls)(?:[/.]|$)/.test(path) ||
    /^desktop\/quietpro\/src\/(?:controls|layout|theme)(?:[/.]|$)/.test(path) ||
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
  return new RegExp(`^-[\\t ]*${escaped}:[\\t ]*\\S[^\\r\\n]*$`, "im").test(stripComments(section));
}

function hasCheckedItem(section: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^-\\s*\\[[xX]\\]\\s*${escaped}(?:\\s|$)`, "im").test(section);
}

function hasCheckedTestCommand(section: string) {
  return [...section.matchAll(/^-\s*\[[xX]\]\s*`([^`\r\n]+)`(?:\s|$)/gm)].some(([, command]) =>
    /^pnpm (?:run )?test(?::[\w:-]+)?(?:\s|$)/.test(command)
    || /^pnpm run check:rust(?:\s|$)/.test(command)
    || /^node\s+(?:--[\w=-]+\s+)*tests\/[\w./-]+\.test\.ts(?:\s|$)/.test(command)
    || /^cargo test(?:\s|$)/.test(command),
  );
}

function hasRepeatableUiValidation(section: string) {
  const match = stripComments(section).match(/^-\s*Repeatable test or existing owner test:\s*(\S.*)$/im);
  if (!match) return false;
  return /(?:`?pnpm run\s+[\w:-]+|`?node\s+|`?cargo test\b|(?:^|\s)(?:tests?|src)\/\S+test\S*)/i.test(match[1])
    || /\b(?:existing owner|browser|structural) test\s*(?::|=|-)\s*\S+/i.test(match[1]);
}

const DOCUMENTATION_GOVERNANCE_PATHS = new Set([
  "AGENTS.md",
  "CONTRIBUTING.md",
  "docs/engineering-quality.md",
  ".github/pull_request_template.md",
]);

function isRepositoryDocumentationPath(path: string) {
  return DOCUMENTATION_GOVERNANCE_PATHS.has(path)
    || /^(?:README(?:\.zh-CN)?|CHANGELOG)\.md$/.test(path)
    || /^docs\/(?:[^./\\][^/\\]*\/)*[^./\\][^/\\]*\.md$/.test(path);
}

function isDocumentationOnlyDiff(changedFiles: ChangedFile[]) {
  return changedFiles.length > 0 && changedFiles.every((file) => {
    if (file.binary || !/^(?:A|M|D|[RC](?:0?\d{1,2}|100))$/.test(file.status)) return false;
    if (!isRepositoryDocumentationPath(file.path)) return false;
    // The CLI emits deletions + additions for moves; explicit rename/copy input
    // must preserve the source path so moving code cannot qualify as docs-only.
    if (/^[RC]/.test(file.status) && !file.oldPath) return false;
    return file.oldPath === undefined || isRepositoryDocumentationPath(file.oldPath);
  });
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

  const repositoryReviewMedia = changedFiles.filter(isRepositoryReviewMediaAddition);
  if (repositoryReviewMedia.length > 0) {
    failures.push({
      rule: "repository-review-media-added",
      message: "Review screenshots, GIFs, and videos must not be added to the repository.",
      detail: `Attach review evidence outside the repository. Added media: ${repositoryReviewMedia.map((file) => file.path).join(", ")}`,
    });
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
      detail: "Add a concrete #issue reference or URL under Accepted Scope before requesting review.",
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
  const validation = stripComments(getBodySection(body, "Validation"));
  if (!hasCheckedItem(validation, "`pnpm run check`") && !hasCheckedItem(validation, "`pnpm run check:full`")) {
    if (!isDocumentationOnlyDiff(changedFiles)) {
      if (changedFiles.length === 0 || !hasCheckedTestCommand(validation)) {
        incomplete.push("Validation must confirm related test commands were run for the changed behavior; documentation or static checks alone do not cover code changes");
      }
    } else {
      if (!hasCheckedItem(validation, "`pnpm run check:docs`")) incomplete.push("Validation must confirm pnpm run check:docs or pnpm run check was run");
      const changesGovernance = changedFiles.some((file) =>
        DOCUMENTATION_GOVERNANCE_PATHS.has(file.path) || (file.oldPath !== undefined && DOCUMENTATION_GOVERNANCE_PATHS.has(file.oldPath)),
      );
      if (changesGovernance && !hasCheckedItem(validation, "`pnpm run check:docs:self-test`")) {
        incomplete.push("Documentation governance or validation policy changes must also confirm pnpm run check:docs:self-test was run");
      }
    }
  }
  if (incomplete.length > 0) failures.push({ rule: "incomplete-pr-sections", message: "Required PR template fields are incomplete.", detail: incomplete.join("\n") });

  if (changedFiles.some((file) => isUiImplementationPath(file.path))) {
    const ui = getBodySection(body, "UI Review");
    const screenshots = stripComments(getBodySection(body, "Screenshots"));
    const hasUiReview = hasCheckedItem(ui, "UI follows Quiet Pro")
      && hasCheckedItem(ui, "Screenshots attached externally")
      && hasLabeledValue(ui, "Affected states")
      && hasLabeledValue(ui, "Keyboard and focus")
      && hasRepeatableUiValidation(ui);
    if (!hasUiReview || !hasExternalScreenshot(screenshots)) {
      failures.push({
        rule: "missing-ui-evidence",
        message: "Visible UI changes require Quiet Pro confirmation and externally hosted screenshots.",
        detail: "Check Quiet Pro and external screenshots, list affected states and keyboard/focus behavior, name a repeatable command or existing owner test, then add GitHub user-attachments or repository-external HTTPS image links. Repository blob/raw URLs do not count.",
      });
    }
  }
  if (hasUncheckedContributorChecklist(body)) {
    failures.push({
      rule: "unchecked-contributor-checklist",
      message: "Contributor Checklist still has unchecked items.",
      detail: "Complete the checklist before requesting review.",
    });
  }
  return failures;
}
