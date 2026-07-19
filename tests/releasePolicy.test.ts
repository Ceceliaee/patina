import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildUpdaterEndpoints,
  fieldValue,
  renderReleaseNotes,
  readVersionPolicyCurrentCodeVersion,
  renderUpdaterNotes,
  syncVersionPolicyCurrentCodeVersion,
  validateReleaseNoteVisibleChangeCount,
  validateReleaseVersionFilesText,
  validateVersionPolicyCurrentCodeVersionText,
} from "../scripts/release.ts";

const versionPolicyExcerpt = [
  "## 3. 当前仓库现实",
  "",
  "截至当前仓库状态：",
  "",
  "- 代码版本为 `0.4.2`",
  "- 稳定发布线处于 `0.4.x`",
  "",
].join("\n");

function versionFileFixture(version = "1.6.0") {
  return {
    packageJson: JSON.stringify({ version }),
    packageLockJson: JSON.stringify({
      version,
      packages: {
        "": {
          version,
        },
      },
    }),
    tauriConfig: JSON.stringify({ version }),
    tauriDevConfig: JSON.stringify({ version }),
    tauriLocalConfig: JSON.stringify({ version }),
    cargoToml: [
      "[package]",
      'name = "patina"',
      `version = "${version}"`,
      "",
      "[dependencies]",
    ].join("\n"),
    cargoLock: [
      "version = 4",
      "",
      "[[package]]",
      'name = "other"',
      'version = "0.1.0"',
      "",
      "[[package]]",
      'name = "patina"',
      `version = "${version}"`,
      "dependencies = []",
    ].join("\n"),
    versionPolicy: [
      "## 3. 当前仓库现实",
      "",
      `- 代码版本为 \`${version}\``,
    ].join("\n"),
    changelog: [
      "# Changelog",
      "",
      `## [${version}] - 2026-06-13`,
      "",
      "Release: Ready.",
    ].join("\n"),
  };
}

function testSyncsCurrentCodeVersion() {
  const updated = syncVersionPolicyCurrentCodeVersion(versionPolicyExcerpt, "0.4.3");
  assert.equal(readVersionPolicyCurrentCodeVersion(updated), "0.4.3");
  assert.match(updated, /- 代码版本为 `0\.4\.3`/);
  assert.match(updated, /- 稳定发布线处于 `0\.4\.x`/);
}

function testSupportsPrereleaseVersion() {
  const updated = syncVersionPolicyCurrentCodeVersion(versionPolicyExcerpt, "0.5.0-beta.1");
  assert.equal(readVersionPolicyCurrentCodeVersion(updated), "0.5.0-beta.1");
}

function testMissingPolicyVersionIsNull() {
  assert.equal(readVersionPolicyCurrentCodeVersion("## empty"), null);
}

function testStalePolicyVersionFailsValidation() {
  assert.equal(
    validateVersionPolicyCurrentCodeVersionText(versionPolicyExcerpt, "0.4.3"),
    "docs/versioning-and-release-policy.md current code version is 0.4.2, expected 0.4.3",
  );
}

function testUpdaterNotesKeepLocalizedVariants() {
  const sectionBody = [
    "Release: Fixed release notes.",
    "App note: Fixed Chinese release notes.",
    "App note en: Fixed English release notes.",
  ].join("\n");

  const notes = renderUpdaterNotes({
    appNote: fieldValue(sectionBody, "App note"),
    appNoteEn: fieldValue(sectionBody, "App note en"),
  });

  assert.equal(notes, [
    "zh-CN: Fixed Chinese release notes.",
    "en-US: Fixed English release notes.",
  ].join("\n"));
}

function testUpdaterNotesFallsBackToAppNote() {
  const sectionBody = [
    "Release: Fixed release notes.",
    "App note: Fixed release notes.",
  ].join("\n");

  const notes = renderUpdaterNotes({
    appNote: fieldValue(sectionBody, "App note"),
    appNoteEn: fieldValue(sectionBody, "App note en"),
  });

  assert.equal(notes, "Fixed release notes.");
}

function testUpdaterEndpointsKeepGithubFirstAndPreserveMirrors() {
  const endpoints = buildUpdaterEndpoints([
    "https://pub-example.r2.dev/latest.json",
    "https://github.com/Ceceliaee/patina/releases/latest/download/latest.json",
    "https://pub-example.r2.dev/latest.json",
  ]);

  assert.deepEqual(endpoints, [
    "https://github.com/Ceceliaee/patina/releases/latest/download/latest.json",
    "https://pub-example.r2.dev/latest.json",
  ]);
}

function testReleaseNotesIncludeAllVisibleBullets() {
  const notes = renderReleaseNotes({
    release: "Ready.",
    sections: [
      {
        heading: "Changed",
        bullets: Array.from({ length: 7 }, (_, index) => `- Change ${index + 1}`),
      },
    ],
  });

  assert.match(notes, /- Change 7/);
  assert.doesNotMatch(notes, /Internal/);
}

function testReleaseNotesKeepVisibleSectionsAndSkipInternal() {
  const notes = renderReleaseNotes({
    release: "Ready.",
    sections: [
      { heading: "Added", bullets: ["- Added item"] },
      { heading: "Changed", bullets: ["- Changed item"] },
      { heading: "Fixed", bullets: ["- Fixed item"] },
      { heading: "Removed", bullets: ["- Removed item"] },
      { heading: "Internal", bullets: ["- Internal item"] },
    ],
  });

  assert.match(notes, /### 新增/);
  assert.match(notes, /- Added item/);
  assert.match(notes, /### 改进/);
  assert.match(notes, /- Changed item/);
  assert.match(notes, /### 修复/);
  assert.match(notes, /- Fixed item/);
  assert.match(notes, /### 移除/);
  assert.match(notes, /- Removed item/);
  assert.doesNotMatch(notes, /Internal item/);
}

function testReleaseNotesOnlyMentionPatinaInstaller() {
  const notes = renderReleaseNotes({
    release: "Ready.",
    bullets: [],
  });

  assert.match(notes, /Windows 安装包/);
  assert.doesNotMatch(notes, /patina-chromium-extension/);
  assert.doesNotMatch(notes, /patina-firefox-extension/);
}

function testReleaseVisibleChangeCountIgnoresInternal() {
  assert.equal(
    validateReleaseNoteVisibleChangeCount({
      version: "1.6.0",
      sections: [
        { heading: "Changed", bullets: Array.from({ length: 7 }, (_, index) => `- Change ${index + 1}`) },
        { heading: "Internal", bullets: Array.from({ length: 20 }, (_, index) => `- Internal ${index + 1}`) },
      ],
    }),
    null,
  );
}

function testReleaseVisibleChangeCountRejectsTooManyUserFacingItems() {
  assert.equal(
    validateReleaseNoteVisibleChangeCount({
      version: "1.6.0",
      sections: [
        { heading: "Changed", bullets: Array.from({ length: 8 }, (_, index) => `- Change ${index + 1}`) },
      ],
    }),
    "CHANGELOG.md 1.6.0 has 8 user-visible Added/Changed/Fixed/Removed entries; keep the combined count to 1-7",
  );
}

function testReleaseWorkflowDoesNotPublishBrowserExtensionAssets() {
  const workflow = readFileSync(".github/workflows/prepare-release.yml", "utf8");

  assert.doesNotMatch(workflow, /npm run extension:chromium:package/);
  assert.doesNotMatch(workflow, /npm run extension:firefox:sign/);
  assert.doesNotMatch(workflow, /CHROMIUM_EXTENSION_ASSET|FIREFOX_EXTENSION_ASSET/);
  assert.doesNotMatch(workflow, /patina-chromium-extension|patina-firefox-extension/);
  assert.match(workflow, /dist-release\/Patina_\$\{\{ needs\.resolve\.outputs\.version \}\}_x64-setup\.exe/);
  assert.match(workflow, /dist-release\/latest\.json/);
}

function testReleaseWorkflowSplitsQualityGatesBeforePublish() {
  const workflow = readFileSync(".github/workflows/prepare-release.yml", "utf8");

  assert.match(workflow, /^  version-files:/m);
  assert.match(workflow, /^  changelog:/m);
  assert.match(workflow, /^  release-notes:/m);
  assert.match(workflow, /^  frontend:/m);
  assert.match(workflow, /^  rust:/m);
  assert.match(workflow, /^  build:/m);
  assert.match(workflow, /^  publish:/m);
  assert.match(workflow, /^  r2:/m);
  assert.doesNotMatch(workflow, /^  release-assets:/m);
  assert.doesNotMatch(workflow, /^  github-release:/m);
  assert.doesNotMatch(workflow, /^  r2-config:/m);
  assert.doesNotMatch(workflow, /^  r2-upload:/m);
  assert.doesNotMatch(workflow, /^  r2-clean:/m);
  assert.match(workflow, /needs: \[resolve, version-files, changelog, release-notes, frontend, rust\]/);
  assert.match(workflow, /needs: \[resolve, release-notes, build\]/);
  assert.match(workflow, /needs: \[resolve, publish\]/);
  assert.match(workflow, /if: steps\.r2\.outputs\.enabled == 'true'/);
  assert.match(workflow, /run: npm run check$/m);
  assert.match(workflow, /run: npm run check:rust$/m);
  assert.match(workflow, /uses: actions\/upload-artifact@v4/);
  assert.match(workflow, /uses: actions\/download-artifact@v4/);
  assert.match(workflow, /name: Prepare release assets/);
  assert.match(workflow, /name: Publish GitHub Release/);
  assert.match(workflow, /name: Check R2 mirror configuration/);
  assert.match(workflow, /name: Upload R2 updater mirror/);
  assert.match(workflow, /name: Clean old R2 updater mirrors/);
  assert.doesNotMatch(workflow, /run: npm run release:check/);
}

function testToolchainContractsStayAligned() {
  const nodeVersion = readFileSync(".node-version", "utf8").trim();
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const rootLockPackage = packageLock.packages[""];

  assert.equal(packageJson.engines.node, nodeVersion);
  assert.equal(packageJson.devEngines.runtime.name, "node");
  assert.equal(packageJson.devEngines.runtime.version, nodeVersion);
  assert.equal(packageJson.devEngines.runtime.onFail, "error");
  assert.equal(rootLockPackage.engines.node, nodeVersion);

  const npmVersion = packageJson.engines.npm;
  assert.equal(packageJson.devEngines.packageManager.name, "npm");
  assert.equal(packageJson.devEngines.packageManager.version, npmVersion);
  assert.equal(packageJson.devEngines.packageManager.onFail, "error");
  assert.equal(rootLockPackage.engines.npm, npmVersion);

  const nodeMajor = nodeVersion.split(".")[0];
  const nodeTypesMajor = packageJson.devDependencies["@types/node"].match(/\d+/)?.[0];
  assert.equal(nodeTypesMajor, nodeMajor);

  const esbuildVersion = packageJson.dependencies.esbuild;
  assert.deepEqual(packageJson.allowScripts, {
    [`esbuild@${esbuildVersion}`]: true,
  });
}

function testWorkflowsUseNodeVersionFileAsSingleSource() {
  for (const workflowPath of [
    ".github/workflows/pr-intake.yml",
    ".github/workflows/verify.yml",
    ".github/workflows/prepare-release.yml",
  ]) {
    const workflow = readFileSync(workflowPath, "utf8");
    const setupNodeCount = workflow.match(/uses: actions\/setup-node@/g)?.length ?? 0;
    const versionFileCount = workflow.match(/node-version-file: \.node-version/g)?.length ?? 0;

    assert.ok(setupNodeCount > 0, `${workflowPath} must configure actions/setup-node`);
    assert.equal(versionFileCount, setupNodeCount, `${workflowPath} must source every Node version from .node-version`);
    assert.doesNotMatch(workflow, /^\s+node-version:\s/m);
  }
}

function testVersionFilesValidationPassesWhenAllVersionsMatch() {
  assert.deepEqual(validateReleaseVersionFilesText(versionFileFixture(), "1.6.0"), []);
}

function testVersionFilesValidationCatchesPackageJsonMismatch() {
  const files = versionFileFixture();
  files.packageJson = JSON.stringify({ version: "1.5.9" });

  assert.deepEqual(validateReleaseVersionFilesText(files, "1.6.0"), [
    "package.json version is 1.5.9, expected 1.6.0",
  ]);
}

function testVersionFilesValidationCatchesPackageLockRootMismatch() {
  const files = versionFileFixture();
  files.packageLockJson = JSON.stringify({
    version: "1.6.0",
    packages: {
      "": {
        version: "1.5.9",
      },
    },
  });

  assert.deepEqual(validateReleaseVersionFilesText(files, "1.6.0"), [
    'package-lock.json packages[""] version is 1.5.9, expected 1.6.0',
  ]);
}

function testVersionFilesValidationCatchesTauriConfigMismatch() {
  const files = versionFileFixture();
  files.tauriDevConfig = JSON.stringify({ version: "1.5.9" });

  assert.deepEqual(validateReleaseVersionFilesText(files, "1.6.0"), [
    "src-tauri/tauri.dev.conf.json version is 1.5.9, expected 1.6.0",
  ]);
}

function testVersionFilesValidationCatchesCargoMismatch() {
  const files = versionFileFixture();
  files.cargoToml = [
    "[package]",
    'name = "patina"',
    'version = "1.5.9"',
  ].join("\n");
  files.cargoLock = [
    "[[package]]",
    'name = "patina"',
    'version = "1.5.8"',
  ].join("\n");

  assert.deepEqual(validateReleaseVersionFilesText(files, "1.6.0"), [
    "src-tauri/Cargo.toml [package].version is 1.5.9, expected 1.6.0",
    "src-tauri/Cargo.lock package patina version is 1.5.8, expected 1.6.0",
  ]);
}

function testVersionFilesValidationCatchesPolicyMismatch() {
  const files = versionFileFixture();
  files.versionPolicy = versionPolicyExcerpt;

  assert.deepEqual(validateReleaseVersionFilesText(files, "1.6.0"), [
    "docs/versioning-and-release-policy.md current code version is 0.4.2, expected 1.6.0",
  ]);
}

function testVersionFilesValidationCatchesMissingChangelogSection() {
  const files = versionFileFixture();
  files.changelog = "# Changelog\n\n## [1.5.9] - 2026-06-12";

  assert.deepEqual(validateReleaseVersionFilesText(files, "1.6.0"), [
    'CHANGELOG.md is missing "## [1.6.0] - YYYY-MM-DD"',
  ]);
}

function testVersionFilesValidationRejectsInvalidVersion() {
  assert.deepEqual(validateReleaseVersionFilesText(versionFileFixture(), "1.6"), [
    'invalid SemVer version "1.6"',
  ]);
}

testSyncsCurrentCodeVersion();
testSupportsPrereleaseVersion();
testMissingPolicyVersionIsNull();
testStalePolicyVersionFailsValidation();
testUpdaterNotesKeepLocalizedVariants();
testUpdaterNotesFallsBackToAppNote();
testUpdaterEndpointsKeepGithubFirstAndPreserveMirrors();
testReleaseNotesIncludeAllVisibleBullets();
testReleaseNotesKeepVisibleSectionsAndSkipInternal();
testReleaseNotesOnlyMentionPatinaInstaller();
testReleaseVisibleChangeCountIgnoresInternal();
testReleaseVisibleChangeCountRejectsTooManyUserFacingItems();
testReleaseWorkflowDoesNotPublishBrowserExtensionAssets();
testReleaseWorkflowSplitsQualityGatesBeforePublish();
testToolchainContractsStayAligned();
testWorkflowsUseNodeVersionFileAsSingleSource();
testVersionFilesValidationPassesWhenAllVersionsMatch();
testVersionFilesValidationCatchesPackageJsonMismatch();
testVersionFilesValidationCatchesPackageLockRootMismatch();
testVersionFilesValidationCatchesTauriConfigMismatch();
testVersionFilesValidationCatchesCargoMismatch();
testVersionFilesValidationCatchesPolicyMismatch();
testVersionFilesValidationCatchesMissingChangelogSection();
testVersionFilesValidationRejectsInvalidVersion();

console.log("Passed 24 release policy tests");
