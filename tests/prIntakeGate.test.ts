import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  findValidationChainRegressions,
  runPrIntakeCheck,
  type ChangedFile,
} from "../scripts/check-pr-intake.ts";

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
  "- [x] Screenshots attached",
  "## Validation",
  "- [x] `npm run check`",
  "## Screenshots",
  "![Rendered UI](https://example.com/rendered-ui.png)",
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

function testVisibleUiRequiresScreenshotEvidence() {
  const body = VALID_BODY.replace("![Rendered UI](https://example.com/rendered-ui.png)", "N/A");
  assert.ok(ruleNames({
    pullRequestBody: body,
    requirePullRequestBody: true,
    changedFiles: [changedFile({ path: "src/features/settings/components/Settings.tsx" })],
  }).includes("missing-ui-evidence"));
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
      path: "package-lock.json",
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
      path: "scripts/check-bundle-budget.ts",
      additions: 1,
      deletions: 1,
    })],
  }).includes("quality-gate-modified"));
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
  assert.match(workflow, /node-version: 22/);
  assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.doesNotMatch(workflow, /\b(?:labeled|unlabeled)\b/);
  assert.doesNotMatch(workflow, /labels-env|PR_LABELS_JSON/);
  assert.doesNotMatch(workflow, /npm ci/);
  assert.doesNotMatch(workflow, /--head HEAD(?:\s|$)/m);
}

function testVerifyRunsAfterSuccessfulIntake() {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  assert.doesNotMatch(workflow, /^\s+pull_request:\s*$/m);
  assert.match(workflow, /workflow_run:\s*\r?\n\s+workflows:\s*\r?\n\s+- PR Intake/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /refs\/pull\/\$\{\{ github\.event\.workflow_run\.pull_requests\[0\]\.number \}\}\/head/);
  assert.match(workflow, /workflow_dispatch:/);
}

function testValidationChainCanGrowButCannotBeWeakened() {
  const baseScripts = {
    check: "npm run check:frontend && npm run check:types && npm run check:rust",
    "check:frontend": "npm run test:settings && npm run build",
    "check:types": "tsc --noEmit",
    "check:rust": "npm run check:rust-boundaries && cargo test --quiet && npm run check:clippy",
    "check:rust-boundaries": "node scripts/check-rust-boundaries.ts",
    "check:clippy": "cargo clippy -- -D warnings",
    "test:settings": "node tests/settingsPageState.test.ts",
    build: "tsc && vite build",
  };
  const strongerScripts = {
    ...baseScripts,
    "test:new": "node tests/newBehavior.test.ts",
    "check:frontend": `${baseScripts["check:frontend"]} && npm run test:new`,
  };
  assert.deepEqual(findValidationChainRegressions(baseScripts, strongerScripts), []);

  const weakenedScripts = {
    ...baseScripts,
    "test:settings": "echo skipped",
  };
  assert.ok(findValidationChainRegressions(baseScripts, weakenedScripts)
    .some((failure) => failure.rule === "validation-chain-weakened"));

  const rustTestsRemoved = {
    ...baseScripts,
    "check:rust": "npm run check:rust-boundaries && npm run check:clippy",
  };
  assert.ok(findValidationChainRegressions(baseScripts, rustTestsRemoved)
    .some((failure) => failure.rule === "validation-chain-weakened"));
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
testVisibleUiRequiresScreenshotEvidence();
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
testEncodingAndHardcodedCopyFail();
testFeatureSpecificSelectorsCannotGrowQuietProCss();
testEstablishedFeatureStyleOwnerCanAddItsStylesheet();
testWorkflowRunsTrustedBaseGate();
testVerifyRunsAfterSuccessfulIntake();
testValidationChainCanGrowButCannotBeWeakened();
testLegacyPrTemplateCanBeSkipped();

console.log("Passed 27 PR intake gate tests");
