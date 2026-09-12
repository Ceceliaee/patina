import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  findValidationChainRegressions,
  runPrIntakeCheck,
  type ChangedFile,
} from "../scripts/check-pr-intake.ts";
import {
  resolveVerifyCandidate,
  verifyAndPublishCandidate,
  type VerifyCandidate,
  type VerifyContext,
} from "../scripts/check-verify-candidate.ts";

const VALID_BODY = [
  "## Purpose",
  "Improve one accepted behavior.",
  "## Accepted Scope",
  "- Refs #123",
  "## Changes",
  "- Update the owned implementation.",
  "## Scope Boundary",
  "- In scope: the accepted behavior",
  "- Out of scope: unrelated cleanup",
  "## Owner Check",
  "- Frontend owner: features/settings",
  "- Rust owner: N/A",
  "- Why this placement fits: settings owns this behavior",
  "## Risk Review",
  "- Tracking correctness: N/A",
  "- Local data safety: N/A",
  "- Privacy or security: N/A",
  "- Compatibility and migration: N/A",
  "- Failure and recovery behavior: N/A",
  "## UI Review",
  "- [ ] No UI changes",
  "- [x] UI follows Quiet Pro",
  "- [x] Screenshots attached externally",
  "- Affected states: default, hover, focus, and disabled",
  "- Keyboard and focus: existing behavior preserved",
  "- Repeatable test or existing owner test: `pnpm run test:settings` existing owner test",
  "## Validation",
  "- [x] `pnpm run check`",
  "## Screenshots",
  "![Rendered UI](https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000)",
  "## Contributor Checklist",
  "- [x] This pull request is linked to an accepted issue, Project item, or explicit maintainer-approved scope.",
  "- [x] Every changed file is necessary for the accepted problem.",
].join("\n\n");

function changedFile(overrides: Partial<ChangedFile>): ChangedFile {
  return {
    path: "src/features/settings/services/example.ts",
    status: "M",
    additions: 10,
    deletions: 2,
    ...overrides,
  };
}

function ruleNames(input: Parameters<typeof runPrIntakeCheck>[0]) {
  return runPrIntakeCheck(input).map((failure) => failure.rule);
}

function testValidFocusedPrPasses() {
  assert.deepEqual(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [
      changedFile({}),
      changedFile({ path: "tests/settingsPageState.test.ts", status: "M", additions: 20, deletions: 0 }),
    ],
    addedLinesByFile: {},
    registeredTypeScriptTests: ["tests/settingsPageState.test.ts"],
  }), []);
}

function testAcceptedScopeDoesNotRequireMaintainerLabel() {
  assert.deepEqual(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [],
  }), []);
}

function testMissingAcceptedScopeFails() {
  const body = VALID_BODY.replace("- Refs #123", "- Linked issue / Project item / maintainer approval:");
  assert.ok(ruleNames({
    pullRequestBody: body,
    requirePullRequestBody: true,
    changedFiles: [],
  }).includes("missing-accepted-scope"));
}

function testUncheckedContributorChecklistFails() {
  const body = VALID_BODY.replace("- [x] Every changed file", "- [ ] Every changed file");
  assert.ok(ruleNames({
    pullRequestBody: body,
    requirePullRequestBody: true,
    changedFiles: [],
  }).includes("unchecked-contributor-checklist"));
}

function testIncompleteTemplateFieldsFail() {
  const body = VALID_BODY.replace("- Why this placement fits: settings owns this behavior", "- Why this placement fits:");
  assert.ok(ruleNames({
    pullRequestBody: body,
    requirePullRequestBody: true,
    changedFiles: [],
  }).includes("incomplete-pr-sections"));
}

function testEmptyIntakeValueCannotConsumeTheNextField() {
  for (const label of ["In scope", "Frontend owner", "Tracking correctness", "Local data safety", "Privacy or security", "Compatibility and migration"]) {
    for (const newline of ["\n", "\r\n"]) {
      const body = VALID_BODY.replace(new RegExp(`^- ${label}:.*$`, "m"), `- ${label}: \t`).replaceAll("\n", newline);
      assert.ok(ruleNames({
        pullRequestBody: body,
        requirePullRequestBody: true,
        changedFiles: [],
      }).includes("incomplete-pr-sections"), label);
    }
  }
  const body = VALID_BODY.replace("- Frontend owner: features/settings", "- Frontend owner:\t N/A");
  assert.deepEqual(ruleNames({ pullRequestBody: body, requirePullRequestBody: true, changedFiles: [] }), []);
}

const DOCS_BODY = VALID_BODY.replace("`pnpm run check`", "`pnpm run check:docs`");
const DOCS_GOVERNANCE_BODY = DOCS_BODY.replace(
  "- [x] `pnpm run check:docs`",
  "- [x] `pnpm run check:docs`\n- [x] `pnpm run check:docs:self-test`",
);

function testRepositoryDocumentationCanUseDocsValidation() {
  for (const path of ["README.md", "README.zh-CN.md", "CHANGELOG.md", "docs/product-principles-and-scope.md", "docs/working/plan.md", "docs/archive/plan.md", "docs/examples/worker/README.md"]) {
    for (const status of ["A", "M", "D"]) {
      assert.deepEqual(ruleNames({
        pullRequestBody: DOCS_BODY,
        requirePullRequestBody: true,
        changedFiles: [changedFile({ path, status })],
      }), [], `${status} ${path}`);
    }
  }
  for (const status of ["R100", "C075"]) {
    assert.deepEqual(ruleNames({
      pullRequestBody: DOCS_BODY,
      requirePullRequestBody: true,
      changedFiles: [changedFile({ path: "docs/archive/plan.md", oldPath: "docs/working/plan.md", status })],
    }), [], status);
  }
}

function testDocumentationGovernanceRequiresSelfTestEvidence() {
  for (const path of ["AGENTS.md", "CONTRIBUTING.md", "docs/engineering-quality.md", ".github/pull_request_template.md"]) {
    for (const files of [
      [changedFile({ path })],
      [changedFile({ path, status: "D" })],
      [changedFile({ path: "docs/archive/policy.md", oldPath: path, status: "R100" })],
      // The trusted CLI uses --no-renames, so moves arrive as deletion + addition.
      [changedFile({ path, status: "D" }), changedFile({ path: "docs/archive/policy.md", status: "A" })],
    ]) {
      const input = { requirePullRequestBody: true, changedFiles: files };
      assert.ok(ruleNames({ ...input, pullRequestBody: DOCS_BODY }).includes("incomplete-pr-sections"), path);
      assert.deepEqual(ruleNames({ ...input, pullRequestBody: DOCS_GOVERNANCE_BODY }), [], path);
      assert.deepEqual(ruleNames({ ...input, pullRequestBody: VALID_BODY }), [], "check already includes the documentation self-test");
    }
  }
}

function testDocsValidationCannotCoverCodeOrUncertainDiffs() {
  const cases: ChangedFile[][] = [
    [],
    [changedFile({ path: "docs/guide.md" }), changedFile({ path: "src/features/about/services/example.ts" })],
    ...[".agents/skills/example/SKILL.md", "src/README.md", "tests/fixtures/README.md", "docs-extra/guide.md", "docs/example.ts", "docs/example.md.ts", "docs/../src/README.md", "docs//guide.md", "docs/./guide.md", "docs/.hidden/guide.md", "docs\\guide.md", "/docs/guide.md", "C:/docs/guide.md"].map((path) => [changedFile({ path })]),
    ...["", "?", "T", "U", "M100", "R101", "Runknown"].map((status) => [changedFile({ path: "docs/guide.md", status })]),
    [changedFile({ path: "docs/guide.md", binary: true })],
    [changedFile({ path: "docs/guide.md", status: "R100" })],
    [changedFile({ path: "docs/guide.md", status: "C100" })],
    [changedFile({ path: "docs/guide.md", oldPath: "src/example.ts", status: "R100" })],
    [changedFile({ path: "src/example.ts", oldPath: "docs/guide.md", status: "R100" })],
    [changedFile({ path: "docs/guide.md", oldPath: "src/example.ts" })],
    [changedFile({ path: "src/example.ts", status: "D" }), changedFile({ path: "docs/guide.md", status: "A" })],
  ];
  for (const changedFiles of cases) {
    const failures = ruleNames({
      pullRequestBody: DOCS_GOVERNANCE_BODY.replace("Improve one accepted behavior.", "Documentation only; no implementation changes."),
      requirePullRequestBody: true,
      changedFiles,
    });
    assert.ok(failures.includes("incomplete-pr-sections"), JSON.stringify(changedFiles));
  }
}

function testDocsValidationStillRequiresCheckedEvidenceAndCompleteIntake() {
  const changedFiles = [changedFile({ path: "README.md" })];
  for (const body of [
    DOCS_BODY.replace("- [x] `pnpm run check:docs`", "- [ ] `pnpm run check:docs`"),
    DOCS_BODY.replace("- [x] `pnpm run check:docs`", "<!--\n- [x] `pnpm run check:docs`\n-->"),
    DOCS_BODY.replace("`pnpm run check:docs`", "`pnpm run check:docs:self-test`"),
    DOCS_BODY.replace("- Why this placement fits: settings owns this behavior", "- Why this placement fits:"),
    DOCS_BODY.replace("- Tracking correctness: N/A", ""),
  ]) {
    assert.ok(ruleNames({ pullRequestBody: body, requirePullRequestBody: true, changedFiles }).includes("incomplete-pr-sections"));
  }
  assert.ok(ruleNames({
    pullRequestBody: DOCS_BODY.replace("- Refs #123", "- Documentation only; accepted scope is unnecessary"),
    requirePullRequestBody: true,
    changedFiles,
  }).includes("missing-accepted-scope"));
}

function testVisibleUiRequiresScreenshotEvidence() {
  const body = VALID_BODY.replace("![Rendered UI](https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000)", "N/A");
  assert.ok(ruleNames({
    pullRequestBody: body,
    requirePullRequestBody: true,
    changedFiles: [changedFile({ path: "src/features/settings/components/Settings.tsx" })],
  }).includes("missing-ui-evidence"));
}

function testVisibleUiRequiresQuietProConfirmation() {
  const body = VALID_BODY.replace("- [x] UI follows Quiet Pro", "- [ ] UI follows Quiet Pro");
  assert.ok(ruleNames({
    pullRequestBody: body,
    requirePullRequestBody: true,
    changedFiles: [changedFile({ path: "src/features/settings/components/Settings.tsx" })],
  }).includes("missing-ui-evidence"));
}

function testVisibleUiRequiresRepeatableValidation() {
  for (const vagueEvidence of ["screenshots only", "existing owner test"]) {
    const body = VALID_BODY.replace(
      "- Repeatable test or existing owner test: `pnpm run test:settings` existing owner test",
      `- Repeatable test or existing owner test: ${vagueEvidence}`,
    );
    assert.ok(ruleNames({
      pullRequestBody: body,
      requirePullRequestBody: true,
      changedFiles: [changedFile({ path: "src/features/settings/components/Settings.tsx" })],
    }).includes("missing-ui-evidence"));
  }
}

function testRepositoryBlobAndRawUrlsDoNotCountAsScreenshotEvidence() {
  for (const url of [
    "https://github.com/Ceceliaee/patina/blob/main/docs/settings.png",
    "https://raw.githubusercontent.com/Ceceliaee/patina/main/docs/settings.png",
  ]) {
    const body = VALID_BODY.replace(
      "https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000",
      url,
    );
    assert.ok(ruleNames({
      pullRequestBody: body,
      requirePullRequestBody: true,
      changedFiles: [changedFile({ path: "src/features/settings/components/Settings.tsx" })],
    }).includes("missing-ui-evidence"));
  }
}

function testRepositoryReviewMediaAdditionsFail() {
  for (const path of [
    "docs/review-evidence/settings-before.png",
    "docs/review-evidence/settings-before.avif",
    "demo/settings-flow.mp4",
    "demo/settings-flow.mkv",
  ]) {
    assert.ok(ruleNames({
      pullRequestBody: VALID_BODY,
      requirePullRequestBody: true,
      changedFiles: [changedFile({ path, status: "A", binary: true })],
    }).includes("repository-review-media-added"));
  }
}

function testProductMediaAssetsRemainAllowed() {
  assert.deepEqual(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [changedFile({ path: "src/features/about/assets/support-badge.png", status: "A", binary: true })],
  }), []);

  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [changedFile({ path: "src/features/about/assets/review-before.png", status: "A", binary: true })],
  }).includes("repository-review-media-added"));
}

function testOversizedManualDiffFails() {
  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [changedFile({ additions: 800, deletions: 250 })],
  }).includes("oversized-manual-diff"));
}

function testLockfileDoesNotCountTowardManualDiff() {
  assert.deepEqual(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [changedFile({
      path: "pnpm-lock.yaml",
      additions: 10_000,
      deletions: 10_000,
    })],
  }), []);
}

function testSuspiciousOwnerAndStyleEscapesFail() {
  const rules = ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [
      changedFile({
        path: "src/features/export/components/Export.tsx",
        status: "A",
        additions: 20,
        deletions: 0,
      }),
      changedFile({
        path: "src/styles/features/export.css",
        status: "A",
        additions: 20,
        deletions: 0,
      }),
    ],
    addedLinesByFile: {
      "src/features/export/components/Export.tsx": [
        "const style = { borderRadius: 16, color: '#fff' };",
      ],
    },
  });

  assert.ok(rules.includes("suspicious-new-feature-owner"));
  assert.ok(rules.includes("standalone-feature-css"));
  assert.ok(rules.includes("hardcoded-visual-style"));
}

function testRiskPathRequiresTests() {
  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [changedFile({
      path: "src-tauri/src/engine/export/csv_exporter.rs",
      additions: 20,
      deletions: 0,
    })],
  }).includes("risk-path-without-tests"));

  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [
      changedFile({
        path: "src-tauri/src/engine/export/csv_exporter.rs",
        additions: 20,
        deletions: 0,
      }),
      changedFile({
        path: "tests/settingsPageState.test.ts",
        status: "M",
        additions: 30,
        deletions: 0,
      }),
    ],
  }).includes("risk-path-without-tests"));

  assert.deepEqual(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [
      changedFile({
        path: "src-tauri/src/engine/export/csv_exporter.rs",
        additions: 20,
        deletions: 0,
      }),
      changedFile({
        path: "tests/exportWriter.test.ts",
        status: "A",
        additions: 30,
        deletions: 0,
      }),
    ],
  }), []);
}

function testUnregisteredTypeScriptTestDoesNotSatisfyRiskCoverage() {
  const input = {
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [
      changedFile({
        path: "src-tauri/src/engine/export/csv_exporter.rs",
        additions: 20,
        deletions: 0,
      }),
      changedFile({
        path: "tests/exportWriter.test.ts",
        status: "A",
        additions: 30,
        deletions: 0,
      }),
    ],
  };

  assert.ok(ruleNames({
    ...input,
    registeredTypeScriptTests: [],
  }).includes("risk-path-without-tests"));

  assert.deepEqual(ruleNames({
    ...input,
    registeredTypeScriptTests: ["tests/exportWriter.test.ts"],
  }), []);
}

function testFocusedTestMustAddPositiveCoverage() {
  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [
      changedFile({
        path: "src-tauri/src/engine/export/csv_exporter.rs",
        additions: 20,
        deletions: 0,
      }),
      changedFile({
        path: "tests/exportWriter.test.ts",
        status: "M",
        additions: 0,
        deletions: 12,
      }),
    ],
  }).includes("risk-path-without-tests"));
}

function testToolsAlertRiskRequiresToolsTests() {
  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [
      changedFile({
        path: "src/features/tools/hooks/useToolAlerts.ts",
        additions: 20,
        deletions: 5,
      }),
      changedFile({
        path: "tests/uiSmoke.test.ts",
        additions: 4,
        deletions: 1,
      }),
    ],
  }).includes("risk-path-without-tests"));

  assert.deepEqual(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [
      changedFile({
        path: "src/features/tools/hooks/useToolAlerts.ts",
        additions: 20,
        deletions: 5,
      }),
      changedFile({
        path: "tests/toolsAlerts.test.ts",
        status: "A",
        additions: 35,
        deletions: 0,
      }),
    ],
  }), []);
}

function testDataReadModelRiskRequiresDataTests() {
  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [
      changedFile({
        path: "src/features/data/services/dataWebTrendReadModel.ts",
        status: "A",
        additions: 120,
        deletions: 0,
      }),
      changedFile({
        path: "tests/uiBrowserSmoke/dataScenarios.ts",
        additions: 10,
        deletions: 2,
      }),
    ],
  }).includes("risk-path-without-tests"));

  assert.deepEqual(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [
      changedFile({
        path: "src/features/data/services/dataWebTrendReadModel.ts",
        status: "A",
        additions: 120,
        deletions: 0,
      }),
      changedFile({
        path: "tests/dataReadModel.test.ts",
        additions: 40,
        deletions: 0,
      }),
    ],
  }), []);
}

function testScreenshotEngineRiskRequiresRustScreenshotTests() {
  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [
      changedFile({
        path: "src-tauri/src/engine/screenshots/capture.rs",
        status: "A",
        additions: 180,
        deletions: 0,
      }),
      changedFile({
        path: "tests/historyScreenshots.test.ts",
        status: "A",
        additions: 80,
        deletions: 0,
      }),
    ],
  }).includes("risk-path-without-tests"));

  assert.deepEqual(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [
      changedFile({
        path: "src-tauri/src/engine/screenshots/capture.rs",
        status: "A",
        additions: 180,
        deletions: 0,
      }),
      changedFile({
        path: "src-tauri/src/engine/screenshots/capture_tests.rs",
        status: "A",
        additions: 80,
        deletions: 0,
      }),
    ],
  }), []);
}

function testUnregisteredRustTestModuleDoesNotSatisfyRiskCoverage() {
  const source = changedFile({
    path: "src-tauri/src/engine/screenshots/capture.rs",
    status: "M",
    additions: 20,
    deletions: 0,
  });
  const testModule = changedFile({
    path: "src-tauri/src/engine/screenshots/capture_tests.rs",
    status: "A",
    additions: 40,
    deletions: 0,
  });

  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [source, testModule],
    registeredRustTests: [],
  }).includes("risk-path-without-tests"));

  assert.deepEqual(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [source, testModule],
    registeredRustTests: [testModule.path],
  }), []);
}

function testInlineRustTestSatisfiesRiskCoverage() {
  const source = changedFile({
    path: "src-tauri/src/engine/screenshots/capture.rs",
    status: "M",
    additions: 20,
    deletions: 0,
  });
  assert.deepEqual(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [source],
    registeredRustTests: [],
    addedLinesByFile: {
      [source.path]: ["#[test]", "fn rejects_invalid_capture_interval() {}"],
    },
  }), []);
}

function testHardRulesRemainFailures() {
  const rules = ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [changedFile({
      path: "src/features/export/components/Export.tsx",
      status: "A",
      additions: 20,
      deletions: 0,
    })],
    addedLinesByFile: {
      "src/features/export/components/Export.tsx": [
        "const style = { borderRadius: 16, color: '#fff' };",
      ],
    },
  });

  assert.ok(rules.includes("suspicious-new-feature-owner"));
  assert.ok(rules.includes("hardcoded-visual-style"));
}

function testStyleGateCatchesHardcodedColorAndBorder() {
  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [changedFile({
      path: "src/features/settings/components/SettingsPanel.tsx",
      status: "M",
      additions: 4,
      deletions: 0,
    })],
    addedLinesByFile: {
      "src/features/settings/components/SettingsPanel.tsx": [
        "const panel = { border: '1px solid rgba(0, 0, 0, 0.12)' };",
      ],
    },
  }).includes("hardcoded-visual-style"));
}

function testQualityGateFilesAreMaintainerOwned() {
  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [changedFile({
      path: "scripts/pr-intake-policy.ts",
      additions: 1,
      deletions: 1,
    })],
  }).includes("quality-gate-modified"), "the existing intake policy owner must have the same protection as its checker");

  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [changedFile({
      path: "scripts/check-bundle-budget.ts",
      additions: 1,
      deletions: 1,
    })],
  }).includes("quality-gate-modified"));

  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [changedFile({
      path: "scripts/perf/data-history-browser-benchmark.ts",
      status: "M",
      additions: 1,
      deletions: 1,
    })],
  }).includes("quality-gate-modified"));
}

function testWindowAuthorityChangesRequireRuntimeMatrixEvidence() {
  const capability = changedFile({
    path: "src-tauri/capabilities/widget.json",
    additions: 1,
    deletions: 1,
  });
  const runtimeMatrix = changedFile({
    path: "tests/tauriRuntimeSmoke.test.ts",
    additions: 20,
    deletions: 0,
  });

  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [capability],
  }).includes("risk-path-without-tests"));

  assert.deepEqual(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [capability, runtimeMatrix],
    registeredTypeScriptTests: [runtimeMatrix.path],
  }), []);
}

function testEncodingAndHardcodedCopyFail() {
  const rules = ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [
      changedFile({
        path: "src/styles/features/history.css",
        additions: 1,
        deletions: 1,
      }),
      changedFile({
        path: "src/features/tools/components/NotificationToastStack.tsx",
        additions: 1,
        deletions: 0,
      }),
      changedFile({
        path: "tests/toolsAlerts.test.ts",
        additions: 10,
        deletions: 0,
      }),
    ],
    addedLinesByFile: {
      "src/styles/features/history.css": ["\uFEFF.history-row { color: var(--qp-text-primary); }"],
      "src/features/tools/components/NotificationToastStack.tsx": ["<button aria-label=\"Dismiss\" />"],
    },
  });

  assert.ok(rules.includes("encoding-marker-added"));
  assert.ok(rules.includes("hardcoded-ui-copy"));
}

function testFeatureSpecificSelectorsCannotGrowQuietProCss() {
  assert.ok(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [changedFile({
      path: "src/styles/quiet-pro.css",
      additions: 10,
      deletions: 0,
    })],
    addedLinesByFile: {
      "src/styles/quiet-pro.css": [".data-trend-card {"],
    },
  }).includes("feature-specific-shared-style"));
}

function testEstablishedFeatureStyleOwnerCanAddItsStylesheet() {
  assert.deepEqual(ruleNames({
    pullRequestBody: VALID_BODY,
    requirePullRequestBody: true,
    changedFiles: [changedFile({
      path: "src/styles/features/history.css",
      status: "A",
      additions: 10,
      deletions: 0,
    })],
  }), []);
}

function testWorkflowRunsTrustedBaseGate() {
  const workflow = readFileSync(".github/workflows/pr-intake.yml", "utf8");
  assert.match(workflow, /ref:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /Fetch pull request head without checking it out/);
  assert.match(workflow, /node --experimental-strip-types scripts\/check-pr-intake\.ts/);
  assert.match(workflow, /node-version-file: \.node-version/);
  assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.doesNotMatch(workflow, /\b(?:labeled|unlabeled)\b/);
  assert.doesNotMatch(workflow, /labels-env|PR_LABELS_JSON/);
  assert.doesNotMatch(workflow, /pnpm install --frozen-lockfile/);
  assert.doesNotMatch(workflow, /--head HEAD(?:\s|$)/m);
}

function testVerifyRunsAfterSuccessfulIntake() {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  assert.doesNotMatch(workflow, /^\s+pull_request:\s*$/m);
  assert.match(workflow, /workflow_run:\s*\r?\n\s+workflows:\s*\r?\n\s+- PR Intake/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(workflow, /head_sha: \$\{\{ steps\.verify\.outputs\.head_sha \}\}/);
  assert.match(workflow, /node --experimental-strip-types scripts\/check-verify-candidate\.ts/);
  assert.doesNotMatch(workflow, /refs\/pull\/|cache: pnpm|cache-dependency-path|secrets\./);
  for (const name of ["frontend", "rust-quality", "tauri-runtime-smoke"]) {
    const section = workflow.split(`  ${name}:`)[1].split(/\r?\n  [a-z][\w-]*:/)[0];
    assert.match(section, /needs: candidate/);
    assert.match(section, /ref: \$\{\{ needs\.candidate\.outputs\.head_sha \}\}/);
    assert.match(section, /persist-credentials: false/);
    assert.match(section, /package-manager-cache: false/);
    assert.match(section, /\$actual -cne \$env:VERIFIED_HEAD_SHA/);
    assert.ok(section.indexOf("Assert verified candidate") < section.indexOf("Install pinned pnpm"));
    assert.doesNotMatch(section, /permissions:|actions: write|contents: write/);
  }
  assert.match(workflow, /workflow_dispatch:/);
}

const BASE_SHA = "1".repeat(40);
const FIRST_HEAD_SHA = "2".repeat(40);
const SECOND_HEAD_SHA = "3".repeat(40);
const REPOSITORY = { id: 100, full_name: "owner/repository" };

function verifyFixtures() {
  const reference = { id: 123, number: 9, base: { repo: { id: 100 } }, head: { repo: { id: 200 } } };
  const run = {
    id: 456, run_attempt: 1, workflow_id: 789, path: ".github/workflows/pr-intake.yml", repository: REPOSITORY,
    head_repository: { id: 200, full_name: "contributor/repository" }, head_branch: "feature/fix",
    event: "pull_request", status: "completed", conclusion: "success", pull_requests: [reference], head_sha: FIRST_HEAD_SHA,
  };
  const context: VerifyContext = {
    eventName: "workflow_run", repository: REPOSITORY.full_name, repositoryId: REPOSITORY.id,
    defaultBranch: "main", workflowRef: "owner/repository/.github/workflows/verify.yml@refs/heads/main", sha: BASE_SHA,
    event: { repository: REPOSITORY, workflow_run: structuredClone(run) },
  };
  const pullRequest = {
    id: 123, number: 9, state: "open", draft: false, body: VALID_BODY,
    base: { sha: BASE_SHA, ref: "main", repo: REPOSITORY },
    head: { sha: SECOND_HEAD_SHA, ref: "feature/fix", repo: { id: 200, full_name: "contributor/repository" } },
  };
  return { run, context, pullRequest };
}

async function testCandidateUsesFreshMetadataAndTrustedIntake() {
  const { run, context, pullRequest } = verifyFixtures();
  const requests: string[] = [];
  const candidate = await resolveVerifyCandidate(context, async (path) => {
    requests.push(path);
    return path.includes("/actions/runs/") ? run : pullRequest;
  });
  assert.deepEqual(requests, ["/repos/owner/repository/actions/runs/456", "/repos/owner/repository/pulls/9"]);
  assert.deepEqual(candidate, { head: SECOND_HEAD_SHA, base: BASE_SHA, pullRequestNumber: 9, body: VALID_BODY });
  pullRequest.head.sha = FIRST_HEAD_SHA;
  pullRequest.base.sha = "4".repeat(40);
  pullRequest.body = "Changed after the snapshot";
  const seen: string[] = [];
  verifyAndPublishCandidate(candidate, {
    fetch: (snapshot) => { assert.equal(snapshot.head, SECOND_HEAD_SHA); seen.push("fetch"); },
    head: () => SECOND_HEAD_SHA,
    intake: (snapshot) => {
      assert.equal(snapshot.base, BASE_SHA);
      assert.equal(snapshot.body, VALID_BODY);
      seen.push("intake");
    },
    publish: () => seen.push("publish"),
  });
  assert.deepEqual(seen, ["fetch", "intake", "publish"]);
}

async function testCandidateRejectsUnverifiableAssociations() {
  const cases: Array<(fixture: ReturnType<typeof verifyFixtures>) => void> = [
    ({ context }) => { context.event.repository = { id: 999, full_name: REPOSITORY.full_name }; },
    ({ context }) => { context.workflowRef = "owner/repository/.github/workflows/verify.yml@refs/heads/untrusted"; },
    ({ context }) => { context.event.workflow_run = undefined; },
    ({ run }) => { run.id = 999; },
    ({ run }) => { run.run_attempt = 2; },
    ({ run }) => { run.workflow_id = 999; },
    ({ run }) => { run.path = ".github/workflows/forged.yml"; },
    ({ run }) => { run.conclusion = "failure"; },
    ({ run }) => { run.event = "workflow_dispatch"; },
    ({ run }) => { run.repository = { id: 999, full_name: "attacker/repository" }; },
    ({ run }) => { run.pull_requests.push(structuredClone(run.pull_requests[0])); },
    ({ run }) => { run.pull_requests[0].id = 999; },
    ({ run }) => { run.pull_requests[0].base.repo.id = 999; },
    ({ run }) => { run.head_repository.id = 999; },
    ({ run }) => { run.head_branch = "other-branch"; },
    ({ pullRequest }) => { pullRequest.state = "closed"; },
    ({ pullRequest }) => { pullRequest.draft = true; },
    ({ pullRequest }) => { pullRequest.number = 10; },
    ({ pullRequest }) => { pullRequest.base.repo = { id: 999, full_name: "attacker/repository" }; },
    ({ pullRequest }) => { pullRequest.base.ref = "untrusted"; },
    ({ pullRequest }) => { pullRequest.head.repo.id = 999; },
    ({ pullRequest }) => { pullRequest.head.sha = "refs/pull/9/head"; },
    ({ pullRequest }) => { pullRequest.base.sha = "abcd"; },
  ];
  for (const change of cases) {
    const fixture = verifyFixtures();
    change(fixture);
    await assert.rejects(resolveVerifyCandidate(fixture.context, async (path) =>
      path.includes("/actions/runs/") ? fixture.run : fixture.pullRequest), /Verify candidate rejected:/);
  }
  const fixture = verifyFixtures();
  await assert.rejects(resolveVerifyCandidate(fixture.context, async () => { throw new Error("metadata unavailable"); }), /metadata unavailable/);
  await assert.rejects(resolveVerifyCandidate(fixture.context, async (path) =>
    path.includes("/actions/runs/") ? fixture.run : { ...fixture.pullRequest, head: { sha: SECOND_HEAD_SHA, repo: null } }), /head repository/);
}

async function testManualAndPushCandidatePaths() {
  const { context, pullRequest } = verifyFixtures();
  context.eventName = "workflow_dispatch";
  context.event.inputs = { pr_number: "9" };
  const candidate = await resolveVerifyCandidate(context, async (path) => {
    assert.equal(path, "/repos/owner/repository/pulls/9");
    return pullRequest;
  });
  assert.equal(candidate.head, SECOND_HEAD_SHA);
  for (const input of ["", "0", "-1", "9/head", " 9", "1\nhead_sha=forged", "9007199254740992"]) {
    context.event.inputs.pr_number = input;
    await assert.rejects(resolveVerifyCandidate(context, async () => { throw new Error("must not read metadata"); }), /manual input/);
  }
  context.eventName = "push";
  context.event.ref = "refs/heads/main";
  context.event.after = BASE_SHA;
  const pushed = await resolveVerifyCandidate(context, async () => { throw new Error("push does not use PR metadata"); });
  assert.deepEqual(pushed, { head: BASE_SHA });
  const steps: string[] = [];
  verifyAndPublishCandidate(pushed, {
    fetch: () => steps.push("fetch"), head: () => BASE_SHA,
    intake: () => steps.push("intake"), publish: () => steps.push("publish"),
  });
  assert.deepEqual(steps, ["publish"]);
  context.event.after = SECOND_HEAD_SHA;
  await assert.rejects(resolveVerifyCandidate(context, async () => ({})), /push commit or branch/);
}

async function testMissingRunPullRequestListUsesExactSourceIdentity() {
  const fixture = verifyFixtures();
  fixture.run.pull_requests = [];
  fixture.context.event.workflow_run!.pull_requests = [];
  const lookup = "/repos/owner/repository/pulls?state=open&base=main&head=contributor%3Afeature%2Ffix&per_page=100";
  const paths: string[] = [];
  const wrongFork = structuredClone(fixture.pullRequest);
  wrongFork.head.repo.id = 999;
  const read = async (path: string) => {
    paths.push(path);
    if (path.includes("/actions/runs/")) return fixture.run;
    if (path.includes("?state=")) {
      assert.equal(path, lookup);
      return [wrongFork, fixture.pullRequest];
    }
    return fixture.pullRequest;
  };
  const resolved = await resolveVerifyCandidate(fixture.context, read);
  assert.equal(resolved.head, SECOND_HEAD_SHA);
  assert.deepEqual(paths, ["/repos/owner/repository/actions/runs/456", lookup, "/repos/owner/repository/pulls/9"]);
  for (const matches of [[], [wrongFork], [fixture.pullRequest, fixture.pullRequest], Array.from({ length: 100 }, () => wrongFork)]) {
    await assert.rejects(resolveVerifyCandidate(fixture.context, async (path) =>
      path.includes("/actions/runs/") ? fixture.run : matches), /lookup is incomplete|exactly one open pull request/);
  }
  await assert.rejects(resolveVerifyCandidate(fixture.context, async (path) => {
    if (path.includes("/actions/runs/")) return fixture.run;
    if (path.includes("?state=")) return [fixture.pullRequest];
    return { ...fixture.pullRequest, head: { ...fixture.pullRequest.head, ref: "renamed-after-lookup" } };
  }), /source changed/);
  const newBase = "5".repeat(40);
  fixture.pullRequest.base.sha = newBase;
  assert.equal((await resolveVerifyCandidate(fixture.context, read)).base, newBase);
}

function testFailedOrMovingCandidateNeverPublishes() {
  const candidate: VerifyCandidate = { head: SECOND_HEAD_SHA, base: BASE_SHA, pullRequestNumber: 9, body: VALID_BODY };
  for (const failure of ["fetch", "head", "intake"] as const) {
    const steps: string[] = [];
    assert.throws(() => verifyAndPublishCandidate(candidate, {
      fetch: () => { steps.push("fetch"); if (failure === "fetch") throw new Error("head removed"); },
      head: () => failure === "head" ? FIRST_HEAD_SHA : SECOND_HEAD_SHA,
      intake: () => { steps.push("intake"); throw new Error("B failed trusted intake"); },
      publish: () => steps.push("publish"),
    }));
    assert.ok(!steps.includes("publish"));
    if (failure !== "intake") assert.ok(!steps.includes("intake"));
  }
}

async function testCandidateCliRunsBasePolicyInAnIsolatedWorktree() {
  const directory = mkdtempSync(join(tmpdir(), "patina-verify-candidate-test-"));
  const repository = join(directory, "repository");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const pullRequest = verifyFixtures().pullRequest;
  let metadataRequests = 0;
  const unexpectedMetadataPaths: Array<string | undefined> = [];
  const server = createServer((request, response) => {
    metadataRequests += 1;
    if (request.url !== "/repos/owner/repository/pulls/9") {
      unexpectedMetadataPaths.push(request.url);
      response.writeHead(404);
      response.end("Unexpected metadata request path");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(pullRequest));
  });
  try {
    mkdirSync(join(repository, "scripts"), { recursive: true });
    git("init", "--initial-branch=main");
    git("config", "user.name", "Patina test");
    git("config", "user.email", "test@example.invalid");
    git("config", "commit.gpgsign", "false");
    for (const file of ["check-pr-intake.ts", "pr-intake-policy.ts"]) copyFileSync(`scripts/${file}`, join(repository, "scripts", file));
    writeFileSync(join(repository, "package.json"), JSON.stringify({ type: "module", scripts: {} }));
    writeFileSync(join(repository, "README.md"), "# Fixture\n");
    git("add", ".");
    git("commit", "-m", "Fixture base");
    const base = git("rev-parse", "HEAD");
    pullRequest.base.sha = base;
    writeFileSync(join(repository, "README.md"), "# Fixture\n\nDocument the accepted behavior.\n");
    git("add", ".");
    git("commit", "-m", "Fixture accepted candidate");
    const accepted = git("rev-parse", "HEAD");
    git("remote", "add", "origin", repository);
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolveListen();
      });
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const runCandidate = async (head: string) => {
      pullRequest.head.sha = head;
      git("update-ref", "refs/pull/9/head", head);
      git("checkout", "--detach", base);
      const output = join(directory, "output");
      const event = join(directory, "event.json");
      const requestsBeforeLaunch = metadataRequests;
      const launchedAt = Date.now();
      writeFileSync(output, "");
      writeFileSync(event, JSON.stringify({ repository: { ...REPOSITORY, default_branch: "main" }, inputs: { pr_number: "9" } }));
      const child = spawn(process.execPath, ["--experimental-strip-types", resolve("scripts/check-verify-candidate.ts")], {
        cwd: repository, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
        detached: process.platform !== "win32",
        env: {
          ...process.env, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_EVENT_PATH: event,
          // This child only contacts the fixture's loopback HTTP server and a
          // local Git origin. Keep the caller's real CLI proxy policy intact.
          NODE_USE_ENV_PROXY: "0",
          GITHUB_REPOSITORY: REPOSITORY.full_name, GITHUB_REPOSITORY_ID: String(REPOSITORY.id),
          GITHUB_SHA: base, VERIFY_WORKFLOW_REF: "owner/repository/.github/workflows/verify.yml@refs/heads/main",
          GH_TOKEN: "fixture-token", GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
          GITHUB_SERVER_URL: "https://github.com", GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: join(directory, "summary"), RUNNER_TEMP: directory,
        },
      });
      let log = "";
      child.stdout.on("data", (data) => { log += String(data); });
      child.stderr.on("data", (data) => { log += String(data); });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid && child.exitCode === null) {
          try {
            if (process.platform === "win32") {
              execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
                windowsHide: true, stdio: "ignore", timeout: 5000,
              });
            } else {
              process.kill(-child.pid, "SIGKILL");
            }
          } catch (error) {
            log += `\nTimed-out fixture process cleanup failed: ${String(error)}`;
            child.kill();
          }
        }
      }, 30_000);
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolveExit({ code, signal }));
      }).finally(() => clearTimeout(timer));
      assert.deepEqual(unexpectedMetadataPaths, [], "candidate must use the expected metadata endpoint");
      assert.equal(git("worktree", "list", "--porcelain").split("worktree ").length, 2, "temporary trusted worktree must be removed");
      return { ...exit, output: readFileSync(output, "utf8"), log,
        diagnostics: { ...exit, timedOut, elapsedMs: Date.now() - launchedAt, metadataRequests: metadataRequests - requestsBeforeLaunch, log } };
    };

    const success = await runCandidate(accepted);
    assert.equal(success.code, 0, JSON.stringify(success.diagnostics));
    assert.equal(success.diagnostics.metadataRequests, 1, JSON.stringify(success.diagnostics));
    assert.match(success.output, new RegExp(`head_sha=${accepted}`));
    assert.match(success.output, new RegExp(`base_sha=${base}`));
    pullRequest.body = DOCS_BODY;
    const docsSuccess = await runCandidate(accepted);
    assert.equal(docsSuccess.code, 0, JSON.stringify(docsSuccess.diagnostics));
    assert.match(docsSuccess.output, new RegExp(`head_sha=${accepted}`));
    pullRequest.body = VALID_BODY;
    git("checkout", "--detach", accepted);
    const marker = join(directory, "candidate-script-executed");
    writeFileSync(join(repository, "scripts", "check-pr-intake.ts"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "executed");\n`);
    git("add", ".");
    git("commit", "-m", "Fixture malicious policy override");
    const rejected = await runCandidate(git("rev-parse", "HEAD"));
    assert.equal(rejected.code, 1, JSON.stringify(rejected.diagnostics));
    assert.equal(rejected.diagnostics.metadataRequests, 1, JSON.stringify(rejected.diagnostics));
    assert.equal(rejected.output, "");
    assert.equal(existsSync(marker), false, "candidate policy must never execute");
    assert.match(rejected.log, /quality-gate-modified/);
  } finally {
    try {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) => server.close((error) => error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolveClose()));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

function testIntakeCliPreservesGitPaths() {
  const directory = mkdtempSync(join(tmpdir(), "patina-intake-path-test-"));
  const repository = join(directory, "repository");
  const git = (args: string[], input?: string) => execFileSync("git", args, {
    cwd: repository, input, encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  try {
    mkdirSync(repository);
    git(["init", "--initial-branch=main"]);
    git(["config", "user.name", "Patina test"]);
    git(["config", "user.email", "test@example.invalid"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "core.quotePath", "true"]);
    git(["config", "core.protectNTFS", "false"]);
    writeFileSync(join(repository, "package.json"), JSON.stringify({ type: "module", scripts: {} }));
    writeFileSync(join(repository, "README.md"), "# Fixture\n");
    git(["add", "."]);
    git(["commit", "-m", "Fixture base"]);
    const base = git(["rev-parse", "HEAD"]);
    const body = join(directory, "body.md");
    writeFileSync(body, DOCS_BODY);
    const blob = git(["hash-object", "-w", "--stdin"], "# Documentation\n\nClarify accepted behavior.\n");
    const cases: Array<{ paths: string[]; accepted: boolean; content?: string; failureRule?: string }> = [
      { paths: ["docs/中文.md"], accepted: true },
      { paths: ["docs/space name.md"], accepted: true },
      { paths: ["docs/tab\tname.md"], accepted: true },
      { paths: ["docs/line\nname.md"], accepted: true },
      { paths: ["docs/quote\"name.md"], accepted: true },
      { paths: ["docs/back\\slash.md"], accepted: false },
      { paths: ["docs/中文.md", "src/features/settings/services/example.ts"], accepted: false },
      { paths: ["docs/二进制.md"], accepted: false, content: "binary\0content\n" },
      { paths: ["docs/超长.md"], accepted: false, content: "Documented behavior.\n".repeat(1_001), failureRule: "oversized-manual-diff" },
    ];
    for (const { paths, accepted, content, failureRule } of cases) {
      // Git's index can represent Linux filenames without checking them out on Windows.
      git(["read-tree", base]);
      const contentBlob = content === undefined ? blob : git(["hash-object", "-w", "--stdin"], content);
      git(["update-index", "-z", "--index-info"], paths.map((path) => `100644 ${contentBlob}\t${path}\0`).join(""));
      const tree = git(["write-tree"]);
      const head = git(["commit-tree", tree, "-p", base, "-m", "Fixture changed paths"]);
      const result = spawnSync(process.execPath, ["--experimental-strip-types", resolve("scripts/check-pr-intake.ts"),
        "--base", base, "--head", head, "--body-file", body, "--require-pr-body"], {
        cwd: repository, encoding: "utf8", windowsHide: true, timeout: 30_000,
      });
      const diagnostics = JSON.stringify({ paths, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr,
        nameStatus: git(["diff", "--no-renames", "--name-status", "-z", `${base}...${head}`]),
        numstat: git(["diff", "--no-renames", "--numstat", "-z", `${base}...${head}`]),
      });
      assert.equal(result.status, accepted ? 0 : 1, diagnostics);
      if (accepted) assert.match(result.stdout, /PR Intake Gate passed/, diagnostics);
      else assert.match(result.stderr, new RegExp(failureRule ?? "incomplete-pr-sections"), diagnostics);
    }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.includes("patina-intake-path-test-"));
    rmSync(directory, { recursive: true, force: true });
  }
}

function testValidationChainCanGrowButCannotBeWeakened() {
  const baseScripts = {
    check: "pnpm run check:frontend && pnpm run check:types && pnpm run check:rust",
    "check:frontend": "pnpm run test:settings && pnpm run build",
    "check:types": "tsc --noEmit",
    "check:rust": "pnpm run check:rust-boundaries && cargo test --quiet && pnpm run check:clippy",
    "check:rust-boundaries": "node scripts/check-rust-boundaries.ts",
    "check:clippy": "cargo clippy -- -D warnings",
    "test:settings": "node tests/settingsPageState.test.ts",
    build: "tsc && vite build",
  };
  const strongerScripts = {
    ...baseScripts,
    "test:new": "node tests/newBehavior.test.ts",
    "check:frontend": `${baseScripts["check:frontend"]} && pnpm run test:new`,
  };
  assert.deepEqual(findValidationChainRegressions(baseScripts, strongerScripts), []);
  const windowsScripts = { ...baseScripts, check: baseScripts.check.replaceAll("pnpm run", "pnpm.exe run") };
  assert.deepEqual(findValidationChainRegressions(baseScripts, windowsScripts), []);
  const shorthandScripts = { ...baseScripts, check: "pnpm.cmd test", test: baseScripts.check };
  assert.deepEqual(findValidationChainRegressions(baseScripts, shorthandScripts), []);
  assert.ok(findValidationChainRegressions(shorthandScripts, { ...shorthandScripts, test: "echo skipped" }).length);

  const weakenedScripts = {
    ...baseScripts,
    "test:settings": "echo skipped",
  };
  assert.ok(findValidationChainRegressions(baseScripts, weakenedScripts)
    .some((failure) => failure.rule === "validation-chain-weakened"));

  const rustTestsRemoved = {
    ...baseScripts,
    "check:rust": "pnpm run check:rust-boundaries && pnpm run check:clippy",
  };
  assert.ok(findValidationChainRegressions(baseScripts, rustTestsRemoved)
    .some((failure) => failure.rule === "validation-chain-weakened"));

  for (const command of [
    `exit 0 && ${baseScripts["check:rust"]}`,
    `true || ${baseScripts["check:rust"]}`,
    `echo ${baseScripts["check:rust"]}`,
    `${baseScripts["check:rust"]} || exit 0`,
    `${baseScripts["check:rust"]} & exit 0`,
    `if false; then ${baseScripts["check:rust"]}; fi`,
    `echo "${baseScripts["check:rust"]}"`,
    `${baseScripts["check:rust"]}\nexit 0`,
    baseScripts["check:rust"].replace("cargo test --quiet", "echo cargo test --quiet"),
    baseScripts["check:rust"].replace("cargo test --quiet", "cargo test --quiet --help"),
    "pnpm run check:clippy && cargo test --quiet && pnpm run check:rust-boundaries",
  ]) {
    assert.ok(findValidationChainRegressions(baseScripts, { ...baseScripts, "check:rust": command }).length, command);
  }
  for (const command of ["echo node tests/newBehavior.test.ts", "exit 0 && node tests/newBehavior.test.ts", "pnpm run test:new"]) {
    assert.ok(findValidationChainRegressions(baseScripts, { ...strongerScripts, "test:new": command }).length, command);
  }
  assert.deepEqual(findValidationChainRegressions(baseScripts, {
    ...baseScripts,
    "test:settings": `${baseScripts["test:settings"]} && node --experimental-strip-types tests/newBehavior.test.ts`,
  }), []);
  assert.deepEqual(findValidationChainRegressions(baseScripts, {
    ...strongerScripts,
    "test:settings": `${baseScripts["test:settings"]} && node --test tests/additionalBehavior.test.ts`,
  }), []);
  const trustedOpaque = { check: "node -e \"process.exitCode = 0\"" };
  assert.deepEqual(findValidationChainRegressions(trustedOpaque, trustedOpaque), []);
  assert.ok(findValidationChainRegressions(trustedOpaque, { check: `${trustedOpaque.check} || exit 0` }).length);
}

function testIntakeCliRejectsSuccessfulShellShortCircuit() {
  const directory = mkdtempSync(join(tmpdir(), "patina-intake-short-circuit-"));
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  try {
    git("init", "--initial-branch=main");
    git("config", "user.name", "Patina test");
    git("config", "user.email", "test@example.invalid");
    git("config", "commit.gpgsign", "false");
    const original = "node check.cjs";
    writeFileSync(join(directory, "check.cjs"), "require('node:fs').writeFileSync('check-ran', 'yes'); process.exitCode = 1;\n");
    writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts: { check: original } }));
    git("add", ".");
    git("commit", "-m", "Fixture trusted validation");
    const base = git("rev-parse", "HEAD");
    const command = `exit 0 && ${original}`;
    writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts: { check: command } }));
    git("add", "package.json");
    git("commit", "-m", "Fixture skipped validation");
    const head = git("rev-parse", "HEAD");
    const shell = process.platform === "win32"
      ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], { cwd: directory, encoding: "utf8", windowsHide: true })
      : spawnSync("/bin/sh", ["-c", command], { cwd: directory, encoding: "utf8" });
    assert.equal(shell.status, 0, shell.stderr);
    assert.equal(existsSync(join(directory, "check-ran")), false, "the successful shell exit must actually skip the check");
    const result = spawnSync(process.execPath, ["--experimental-strip-types", resolve("scripts/check-pr-intake.ts"),
      "--base", base, "--head", head, "--body-env", "PR_BODY", "--require-pr-body"], {
      cwd: directory, encoding: "utf8", windowsHide: true, env: { ...process.env, PR_BODY: VALID_BODY },
    });
    assert.equal(result.status, 1, `shell exit=${shell.status}, check executed=false; intake stdout=${result.stdout}; stderr=${result.stderr}`);
    assert.match(result.stderr, /validation-chain-weakened/);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.includes("patina-intake-short-circuit-"));
    rmSync(directory, { recursive: true, force: true });
  }
}

function testLegacyPrTemplateCanBeSkipped() {
  assert.deepEqual(ruleNames({
    pullRequestBody: "",
    requirePullRequestBody: false,
    changedFiles: [],
  }), []);
}

testValidFocusedPrPasses();
testAcceptedScopeDoesNotRequireMaintainerLabel();
testMissingAcceptedScopeFails();
testUncheckedContributorChecklistFails();
testIncompleteTemplateFieldsFail();
testEmptyIntakeValueCannotConsumeTheNextField();
testRepositoryDocumentationCanUseDocsValidation();
testDocumentationGovernanceRequiresSelfTestEvidence();
testDocsValidationCannotCoverCodeOrUncertainDiffs();
testDocsValidationStillRequiresCheckedEvidenceAndCompleteIntake();
testVisibleUiRequiresScreenshotEvidence();
testVisibleUiRequiresQuietProConfirmation();
testVisibleUiRequiresRepeatableValidation();
testRepositoryBlobAndRawUrlsDoNotCountAsScreenshotEvidence();
testRepositoryReviewMediaAdditionsFail();
testProductMediaAssetsRemainAllowed();
testOversizedManualDiffFails();
testLockfileDoesNotCountTowardManualDiff();
testSuspiciousOwnerAndStyleEscapesFail();
testRiskPathRequiresTests();
testUnregisteredTypeScriptTestDoesNotSatisfyRiskCoverage();
testFocusedTestMustAddPositiveCoverage();
testToolsAlertRiskRequiresToolsTests();
testDataReadModelRiskRequiresDataTests();
testScreenshotEngineRiskRequiresRustScreenshotTests();
testUnregisteredRustTestModuleDoesNotSatisfyRiskCoverage();
testInlineRustTestSatisfiesRiskCoverage();
testHardRulesRemainFailures();
testStyleGateCatchesHardcodedColorAndBorder();
testQualityGateFilesAreMaintainerOwned();
testWindowAuthorityChangesRequireRuntimeMatrixEvidence();
testEncodingAndHardcodedCopyFail();
testFeatureSpecificSelectorsCannotGrowQuietProCss();
testEstablishedFeatureStyleOwnerCanAddItsStylesheet();
testWorkflowRunsTrustedBaseGate();
testVerifyRunsAfterSuccessfulIntake();
await testCandidateUsesFreshMetadataAndTrustedIntake();
await testCandidateRejectsUnverifiableAssociations();
await testManualAndPushCandidatePaths();
await testMissingRunPullRequestListUsesExactSourceIdentity();
testFailedOrMovingCandidateNeverPublishes();
await testCandidateCliRunsBasePolicyInAnIsolatedWorktree();
testIntakeCliPreservesGitPaths();
testValidationChainCanGrowButCannotBeWeakened();
testIntakeCliRejectsSuccessfulShellShortCircuit();
testLegacyPrTemplateCanBeSkipped();

console.log("Passed 46 PR intake and immutable candidate gate tests");
