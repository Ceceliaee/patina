import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildReleaseInstallerName,
  buildUpdaterEndpoints,
  fieldValue,
  parseSha256SumsText,
  prepareReleaseAssets,
  renderSha256Sums,
  renderReleaseNotes,
  readVersionPolicyCurrentCodeVersion,
  renderUpdaterNotes,
  selectSignedInstallerCandidates,
  sha256File,
  syncVersionPolicyCurrentCodeVersion,
  validatePreparedReleaseAssetValues,
  validateReleaseNoteVisibleChangeCount,
  validateReleaseVersionFilesText,
  validateVersionPolicyCurrentCodeVersionText,
  verifyReleaseAssets,
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

function testReleaseInstallerNamesStayStable() {
  assert.equal(buildReleaseInstallerName("1.9.3"), "Patina_1.9.3_x64-setup.exe");
  assert.equal(buildReleaseInstallerName("2.0.0-rc.1"), "Patina_2.0.0-rc.1_x64-setup.exe");
  assert.throws(() => buildReleaseInstallerName("1.9"), /invalid SemVer/);
}

function testSha256SumsRoundTripUsesCanonicalFormat() {
  const digest = "a".repeat(64);
  const fileName = "Patina_1.9.3_x64-setup.exe";
  const rendered = renderSha256Sums(digest, fileName);

  assert.equal(rendered, `${digest}  ${fileName}\n`);
  assert.deepEqual(parseSha256SumsText(rendered), { digest, fileName });
}

function testSha256SumsRejectInvalidContent() {
  const digest = "a".repeat(64);

  assert.throws(() => renderSha256Sums("A".repeat(64), "Patina_1.9.3_x64-setup.exe"), /lowercase/);
  assert.throws(() => renderSha256Sums(digest.slice(1), "Patina_1.9.3_x64-setup.exe"), /64/);
  assert.throws(() => renderSha256Sums(digest, "../Patina_1.9.3_x64-setup.exe"), /unsafe/);
  assert.throws(() => parseSha256SumsText(`\uFEFF${digest}  Patina_1.9.3_x64-setup.exe\n`), /BOM/);
  assert.throws(() => parseSha256SumsText(`${digest}  Patina_1.9.3_x64-setup.exe\r\n`), /LF/);
  assert.throws(() => parseSha256SumsText(`${digest} Patina_1.9.3_x64-setup.exe\n`), /two spaces/);
  assert.throws(
    () => parseSha256SumsText(`${digest}  Patina_1.9.3_x64-setup.exe\n${digest}  extra.exe\n`),
    /exactly one record/,
  );
}

function testSignedInstallerSelectionRequiresOnePair() {
  const installer = path.join("bundle", "Patina.exe");
  assert.deepEqual(
    selectSignedInstallerCandidates([`${installer}.sig`, installer]),
    { installerFilePath: installer, signatureFilePath: `${installer}.sig` },
  );

  assert.throws(() => selectSignedInstallerCandidates([]), /could not find/);
  assert.throws(
    () => selectSignedInstallerCandidates([installer, `${installer}.sig`, "bundle/Other.exe", "bundle/Other.exe.sig"]),
    /multiple/,
  );
  assert.throws(() => selectSignedInstallerCandidates([`${installer}.sig`]), /matching/);
}

function preparedReleaseValues(overrides = {}) {
  const version = "1.9.3";
  const installerName = buildReleaseInstallerName(version);
  const digest = "b".repeat(64);
  const signature = "test-updater-signature";

  return {
    version,
    repository: "Ceceliaee/patina",
    target: "windows-x86_64",
    sourceDigest: digest,
    finalDigest: digest,
    checksumContent: renderSha256Sums(digest, installerName),
    signature,
    latest: {
      version,
      platforms: {
        "windows-x86_64": {
          signature,
          url: `https://github.com/Ceceliaee/patina/releases/download/v${version}/${installerName}`,
        },
      },
    },
    ...overrides,
  };
}

function testPreparedReleaseValuesPassWhenAligned() {
  assert.deepEqual(validatePreparedReleaseAssetValues(preparedReleaseValues()), []);
}

function testPreparedReleaseValuesReportDrift() {
  const values = preparedReleaseValues({ finalDigest: "c".repeat(64) });
  values.latest.version = "1.9.2";
  values.latest.platforms["windows-x86_64"].signature = "wrong-signature";
  values.latest.platforms["windows-x86_64"].url = "https://example.com/wrong.exe";

  const errors = validatePreparedReleaseAssetValues(values);
  assert.ok(errors.some((error) => error.includes("does not match source installer")));
  assert.ok(errors.some((error) => error.includes("SHA256SUMS.txt records SHA-256")));
  assert.ok(errors.some((error) => error.includes("latest.json version")));
  assert.ok(errors.some((error) => error.includes("updater signature")));
  assert.ok(errors.some((error) => error.includes("expected https://github.com")));
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
    version: "1.9.3",
    release: "Ready.",
    bullets: [],
  });

  assert.match(notes, /Windows 安装包/);
  assert.match(notes, /SHA256SUMS\.txt/);
  assert.match(notes, /Get-FileHash \.\\Patina_1\.9\.3_x64-setup\.exe -Algorithm SHA256/);
  assert.match(notes, /gh attestation verify \.\\Patina_1\.9\.3_x64-setup\.exe --repo Ceceliaee\/patina/);
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
  assert.equal(workflow.match(/dist-release\/SHA256SUMS\.txt/g)?.length, 2);
  assert.match(workflow, /dist-release\/latest\.json/);
  assert.doesNotMatch(workflow.slice(workflow.indexOf("\n  r2:")), /SHA256SUMS\.txt/);
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
  assert.match(workflow, /name: Verify release assets/);
  assert.match(workflow, /name: Attest Windows installer/);
  assert.match(workflow, /name: Publish GitHub Release/);
  assert.match(workflow, /name: Check R2 mirror configuration/);
  assert.match(workflow, /name: Upload R2 updater mirror/);
  assert.match(workflow, /name: Clean old R2 updater mirrors/);
  assert.doesNotMatch(workflow, /run: npm run release:check/);
}

function testReleaseWorkflowAttestsVerifiedFinalInstallerWithMinimumPermissions() {
  const workflow = readFileSync(".github/workflows/prepare-release.yml", "utf8");
  const publishStart = workflow.indexOf("\n  publish:");
  const r2Start = workflow.indexOf("\n  r2:", publishStart);
  assert.ok(publishStart > 0 && r2Start > publishStart);

  const beforePublish = workflow.slice(0, publishStart);
  const publishJob = workflow.slice(publishStart, r2Start);
  assert.match(
    workflow,
    /concurrency:\n  group: publish-release-\$\{\{ github\.event_name == 'workflow_dispatch' && format\('v\{0\}', inputs\.version\) \|\| github\.ref_name \}\}\n  cancel-in-progress: false/,
  );
  assert.match(beforePublish, /permissions:\n  contents: read/);
  assert.doesNotMatch(beforePublish, /id-token: write|attestations: write|artifact-metadata: write/);
  assert.match(beforePublish, /name: Ensure release does not already exist/);
  assert.match(beforePublish, /Published release assets are immutable/);
  assert.match(beforePublish, /if \(\$statusCode -ne 404\)/);
  assert.match(publishJob, /permissions:\n      contents: write\n      id-token: write\n      attestations: write\n      artifact-metadata: write/);

  const prepareIndex = publishJob.indexOf("- name: Prepare release assets");
  const verifyIndex = publishJob.indexOf("- name: Verify release assets");
  const attestIndex = publishJob.indexOf("- name: Attest Windows installer");
  const uploadIndex = publishJob.indexOf("- name: Upload release assets");
  const releaseIndex = publishJob.indexOf("- name: Publish GitHub Release");
  assert.ok(prepareIndex < verifyIndex && verifyIndex < attestIndex && attestIndex < uploadIndex && uploadIndex < releaseIndex);
  assert.match(publishJob, /uses: actions\/attest@v4/);
  assert.match(
    publishJob,
    /subject-path: dist-release\/Patina_\$\{\{ needs\.resolve\.outputs\.version \}\}_x64-setup\.exe/,
  );
  assert.doesNotMatch(publishJob, /subject-path:.*\*|subject-path:.*bundle/);
  assert.match(publishJob, /overwrite_files: false/);
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

function testDependencyAuditKeepsOfflineModeExplicitAndNetworkFree() {
  const source = readFileSync("scripts/audit-dependencies.ts", "utf8");
  assert.match(source, /PATINA_DEPENDENCY_AUDIT_OFFLINE === "1"/);
  assert.match(source, /if \(OFFLINE\) rustAuditArgs\.push\("--no-fetch"\)/);
  assert.match(source, /if \(OFFLINE\) npmAuditArgs\.push\("--offline"\)/);
}

async function testPrepareAndVerifyReleaseAssetsDetectTampering() {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const testRoot = await mkdtemp(path.join(os.tmpdir(), "patina-release-assets-"));
  const bundleDir = path.join(testRoot, "bundle", "nsis");
  const outputDir = path.join(testRoot, "dist-release");
  const sourceInstaller = path.join(bundleDir, "Patina-test-setup.exe");
  const sourceSignature = `${sourceInstaller}.sig`;

  try {
    await mkdir(bundleDir, { recursive: true });
    await writeFile(sourceInstaller, Buffer.from([0, 1, 2, 3, 254, 255]));
    await writeFile(sourceSignature, "fixture-updater-signature\n", "utf8");

    await prepareReleaseAssets(
      version,
      path.join(testRoot, "bundle"),
      outputDir,
      "Ceceliaee/patina",
      "windows-x86_64",
    );
    await verifyReleaseAssets(
      version,
      path.join(testRoot, "bundle"),
      outputDir,
      "Ceceliaee/patina",
      "windows-x86_64",
    );

    const releaseInstaller = path.join(outputDir, buildReleaseInstallerName(version));
    const digest = await sha256File(releaseInstaller);
    assert.equal(
      await readFile(path.join(outputDir, "SHA256SUMS.txt"), "utf8"),
      renderSha256Sums(digest, buildReleaseInstallerName(version)),
    );

    await writeFile(releaseInstaller, Buffer.from([0, 1, 2, 3, 254, 0]));
    await assert.rejects(
      verifyReleaseAssets(
        version,
        path.join(testRoot, "bundle"),
        outputDir,
        "Ceceliaee/patina",
        "windows-x86_64",
      ),
      /does not match source installer/,
    );

    await prepareReleaseAssets(
      version,
      path.join(testRoot, "bundle"),
      outputDir,
      "Ceceliaee/patina",
      "windows-x86_64",
    );
    await writeFile(path.join(outputDir, "SHA256SUMS.txt"), `${"0".repeat(64)}  wrong.exe\n`, "utf8");
    await assert.rejects(
      verifyReleaseAssets(
        version,
        path.join(testRoot, "bundle"),
        outputDir,
        "Ceceliaee/patina",
        "windows-x86_64",
      ),
      /records wrong\.exe/,
    );

    await prepareReleaseAssets(
      version,
      path.join(testRoot, "bundle"),
      outputDir,
      "Ceceliaee/patina",
      "windows-x86_64",
    );
    const latestPath = path.join(outputDir, "latest.json");
    const latest = JSON.parse(await readFile(latestPath, "utf8"));
    latest.platforms["windows-x86_64"].url = "https://example.com/wrong.exe";
    await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
    await assert.rejects(
      verifyReleaseAssets(
        version,
        path.join(testRoot, "bundle"),
        outputDir,
        "Ceceliaee/patina",
        "windows-x86_64",
      ),
      /expected https:\/\/github\.com/,
    );
  } finally {
    const resolvedRoot = path.resolve(testRoot);
    const resolvedTemp = path.resolve(os.tmpdir());
    assert.ok(resolvedRoot.startsWith(`${resolvedTemp}${path.sep}`));
    await rm(resolvedRoot, { recursive: true, force: true });
  }
}

testSyncsCurrentCodeVersion();
testSupportsPrereleaseVersion();
testMissingPolicyVersionIsNull();
testStalePolicyVersionFailsValidation();
testUpdaterNotesKeepLocalizedVariants();
testUpdaterNotesFallsBackToAppNote();
testUpdaterEndpointsKeepGithubFirstAndPreserveMirrors();
testReleaseInstallerNamesStayStable();
testSha256SumsRoundTripUsesCanonicalFormat();
testSha256SumsRejectInvalidContent();
testSignedInstallerSelectionRequiresOnePair();
testPreparedReleaseValuesPassWhenAligned();
testPreparedReleaseValuesReportDrift();
testReleaseNotesIncludeAllVisibleBullets();
testReleaseNotesKeepVisibleSectionsAndSkipInternal();
testReleaseNotesOnlyMentionPatinaInstaller();
testReleaseVisibleChangeCountIgnoresInternal();
testReleaseVisibleChangeCountRejectsTooManyUserFacingItems();
testReleaseWorkflowDoesNotPublishBrowserExtensionAssets();
testReleaseWorkflowSplitsQualityGatesBeforePublish();
testReleaseWorkflowAttestsVerifiedFinalInstallerWithMinimumPermissions();
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
testDependencyAuditKeepsOfflineModeExplicitAndNetworkFree();
await testPrepareAndVerifyReleaseAssetsDetectTampering();

console.log("Passed release policy tests");
