import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import path from "node:path";
import {
  WINDOWS_RELEASE_TARGETS,
  buildMirrorManifest,
  verifyPeArchitecture,
  verifyUpdaterSignature,
  buildReleaseInstallerName,
  buildUpdaterEndpoints,
  fieldValue,
  parseSha256SumsText,
  prepareReleaseAssets,
  renderSha256Sums,
  renderReleaseNotes,
  renderUpdaterNotes,
  selectSignedInstallerCandidates,
  sha256File,
  validatePreparedReleaseAssetValues,
  validateReleaseNoteVisibleChangeCount,
  validateReleaseVersionFilesText,
  verifyReleaseAssets,
} from "../scripts/release.ts";

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
    changelog: [
      "# Changelog",
      "",
      `## [${version}] - 2026-06-13`,
      "",
      "Release: Ready.",
    ].join("\n"),
  };
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
  assert.deepEqual(parseSha256SumsText(rendered), [{ digest, fileName }]);
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
    () => parseSha256SumsText(`${digest}  Patina_1.9.3_x64-setup.exe\n${digest}  Patina_1.9.3_x64-setup.exe\n`),
    /duplicate/,
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
  assert.throws(() => selectSignedInstallerCandidates([installer, `${installer}.sig`, "extra.exe"]), /exactly one/);
}

function preparedReleaseValues() {
  const version = "1.9.3";
  const assets = WINDOWS_RELEASE_TARGETS.map(({ platform }, index) => ({
    platform, sourceDigest: String(index).repeat(64), finalDigest: String(index).repeat(64), signature: `signature-${platform}`,
  }));
  return {
    version, repository: "Ceceliaee/patina", assets,
    checksumContent: assets.map((asset) => renderSha256Sums(asset.finalDigest, buildReleaseInstallerName(version, asset.platform))).join(""),
    latest: { version, platforms: Object.fromEntries(assets.map((asset) => [asset.platform, {
      signature: asset.signature,
      url: `https://github.com/Ceceliaee/patina/releases/download/v${version}/${buildReleaseInstallerName(version, asset.platform)}`,
    }])) },
  };
}

function testPreparedReleaseValuesPassWhenAligned() {
  assert.deepEqual(validatePreparedReleaseAssetValues(preparedReleaseValues()), []);
}

function testPreparedReleaseValuesReportDrift() {
  const values = preparedReleaseValues();
  values.assets[0].finalDigest = "c".repeat(64);
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

  assert.match(notes, /Windows 设备/);
  assert.match(notes, /https:\/\/github.com\/Ceceliaee\/patina\/releases\/download\/v1\.9\.3\/Patina_1\.9\.3_arm64-setup\.exe/);
  assert.match(notes, /Get-FileHash \.\\Patina_1\.9\.3_arm64-setup\.exe -Algorithm SHA256/);
  assert.doesNotMatch(notes, /<version>/);
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
  assert.match(workflow, /^  rust-quality:/m);
  assert.match(workflow, /^  windows-build:/m);
  assert.match(workflow, /^  publish:/m);
  assert.match(workflow, /^  r2:/m);
  assert.doesNotMatch(workflow, /^  release-assets:/m);
  assert.doesNotMatch(workflow, /^  github-release:/m);
  assert.doesNotMatch(workflow, /^  r2-config:/m);
  assert.doesNotMatch(workflow, /^  r2-upload:/m);
  assert.doesNotMatch(workflow, /^  r2-clean:/m);
  assert.match(workflow, /needs: \[resolve, version-files, changelog, release-notes, frontend, rust-quality\]/);
  assert.match(workflow, /needs: \[resolve, release-notes, windows-build\]/);
  assert.match(workflow, /needs: \[resolve, publish\]/);
  assert.match(workflow, /if: steps\.r2\.outputs\.enabled == 'true'/);
  assert.match(workflow, /run: npm run check$/m);
  assert.match(workflow, /run: npm run check:rust$/m);
  assert.match(workflow, /uses: actions\/upload-artifact@[0-9a-f]{40} # v7/);
  assert.match(workflow, /uses: actions\/download-artifact@[0-9a-f]{40} # v8/);
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
  assert.match(publishJob, /uses: actions\/attest@[0-9a-f]{40} # v4/);
  assert.match(
    publishJob,
    /subject-path: dist-release\/Patina_\$\{\{ needs\.resolve\.outputs\.version \}\}_x64-setup\.exe/,
  );
  assert.doesNotMatch(publishJob, /subject-path:.*\*|subject-path:.*bundle/);
  assert.match(publishJob, /overwrite_files: false/);
}

function testDualArchitectureWorkflowBoundaries() {
  const workflow = readFileSync(".github/workflows/prepare-release.yml", "utf8");
  assert.match(workflow, /name: tauri-bundle-\$\{\{ matrix.arch \}\}/);
  assert.match(workflow, /target: aarch64-pc-windows-msvc/);
  assert.match(workflow, /runner: windows-11-arm/);
  assert.match(workflow, /--bundles nsis --target \$\{\{ matrix.target \}\}/);
  assert.match(workflow, /subject-path: dist-release\/Patina_\$\{\{ needs.resolve.outputs.version \}\}_arm64-setup.exe/);
  const mirror = workflow.slice(workflow.indexOf("      - name: Upload R2 updater mirror"));
  const digestIndex = mirror.indexOf("R2 digest mismatch");
  const manifestIndex = mirror.indexOf('"s3://$env:R2_BUCKET/latest.json"');
  const uploadFailureIndex = mirror.indexOf("R2 manifest upload failed");
  const cleanupIndex = mirror.indexOf("Clean old R2 updater mirrors");
  assert.ok([digestIndex, manifestIndex, uploadFailureIndex, cleanupIndex].every((index) => index >= 0));
  assert.ok(digestIndex < manifestIndex && manifestIndex < uploadFailureIndex && uploadFailureIndex < cleanupIndex);
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

function testWorkflowsPinThirdPartyActionsToReviewedCommits() {
  for (const workflowPath of [
    ".github/workflows/pr-intake.yml",
    ".github/workflows/verify.yml",
    ".github/workflows/prepare-release.yml",
  ]) {
    const workflow = readFileSync(workflowPath, "utf8");
    const usesCount = workflow.match(/^\s+uses:/gm)?.length ?? 0;
    const pinnedCount = workflow.match(
      /^\s+uses: [^@\s]+@[0-9a-f]{40} # v\d+$/gm,
    )?.length ?? 0;

    assert.ok(usesCount > 0, `${workflowPath} must use at least one reviewed Action`);
    assert.equal(
      pinnedCount,
      usesCount,
      `${workflowPath} must pin every Action to a commit and retain its reviewed major version`,
    );
  }
}

function testWorkflowsUseReviewedNode24ActionRevisions() {
  const workflows = [
    ".github/workflows/pr-intake.yml",
    ".github/workflows/verify.yml",
    ".github/workflows/prepare-release.yml",
  ].map((workflowPath) => ({
    path: workflowPath,
    source: readFileSync(workflowPath, "utf8"),
  }));
  const reviewedActions = [
    {
      action: "actions/checkout",
      reference: "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6",
      expectedCount: 19,
    },
    {
      action: "actions/setup-node",
      reference: "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6",
      expectedCount: 12,
    },
    {
      action: "actions/upload-artifact",
      reference: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7",
      expectedCount: 4,
    },
    {
      action: "actions/download-artifact",
      reference: "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8",
      expectedCount: 3,
    },
    {
      action: "actions/attest",
      reference: "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4",
      expectedCount: 2,
    },
    {
      action: "softprops/action-gh-release",
      reference: "softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228 # v3",
      expectedCount: 1,
    },
  ];

  const workflowActionCount = workflows.reduce(
    (count, workflow) => count + (workflow.source.match(/^\s+uses:/gm)?.length ?? 0),
    0,
  );
  const reviewedActionCount = reviewedActions.reduce(
    (count, reviewedAction) => count + reviewedAction.expectedCount,
    0,
  );
  assert.equal(
    workflowActionCount,
    reviewedActionCount,
    "every workflow Action must have a reviewed Node 24 revision",
  );

  for (const reviewedAction of reviewedActions) {
    const references = workflows.flatMap((workflow) =>
      workflow.source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith(`uses: ${reviewedAction.action}@`))
        .map((line) => ({ line, path: workflow.path })),
    );

    assert.equal(
      references.length,
      reviewedAction.expectedCount,
      `${reviewedAction.action} must keep its reviewed workflow occurrence count`,
    );
    for (const reference of references) {
      assert.equal(
        reference.line,
        `uses: ${reviewedAction.reference}`,
        `${reference.path} must use the reviewed Node 24 revision of ${reviewedAction.action}`,
      );
    }
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
  assert.match(source, /runNpmAudit\(npmExecutable, \{ offline: OFFLINE \}\)/);
}

function peFixture(platform: string) {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ"); bytes.writeUInt32LE(64, 0x3c); bytes.writeUInt32LE(0x4550, 64);
  bytes.writeUInt16LE(WINDOWS_RELEASE_TARGETS.find((entry) => entry.platform === platform)!.machine, 68);
  return bytes;
}

function signingFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = Buffer.alloc(8, 7);
  const key = Buffer.concat([Buffer.from("Ed"), keyId, publicKey.export({ format: "der", type: "spki" }).subarray(-32)]);
  return {
    publicKey: Buffer.from(`untrusted comment: test key\n${key.toString("base64")}\n`).toString("base64"),
    signature(bytes: Buffer) {
      const sig = sign(null, createHash("blake2b512").update(bytes).digest(), privateKey);
      const packet = Buffer.concat([Buffer.from("ED"), keyId, sig]);
      const comment = "timestamp:0";
      const global = sign(null, Buffer.concat([sig, Buffer.from(comment)]), privateKey);
      return Buffer.from(`untrusted comment: test\n${packet.toString("base64")}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`).toString("base64");
    },
  };
}

function testArchitectureAndMirrorContracts() {
  assert.equal(buildReleaseInstallerName("1.9.3", "windows-aarch64"), "Patina_1.9.3_arm64-setup.exe");
  assert.throws(() => buildReleaseInstallerName("1.9.3", "linux-x86_64"), /unsupported/);
  for (const { platform } of WINDOWS_RELEASE_TARGETS) verifyPeArchitecture(peFixture(platform), platform);
  assert.throws(() => verifyPeArchitecture(peFixture("windows-x86_64"), "windows-aarch64"), /architecture/);
  assert.throws(() => verifyPeArchitecture(Buffer.alloc(12), "windows-aarch64"), /DOS/);
  const malformed = peFixture("windows-aarch64"); malformed.writeUInt32LE(0xffffffff, 0x3c);
  assert.throws(() => verifyPeArchitecture(malformed, "windows-aarch64"), /offset/);
  const values = preparedReleaseValues();
  const mirror = buildMirrorManifest(values.latest, values.repository, "https://example.com/patina/");
  for (const { platform } of WINDOWS_RELEASE_TARGETS) {
    assert.equal(mirror.platforms[platform].signature, values.latest.platforms[platform].signature);
    assert.equal(mirror.platforms[platform].url, `https://example.com/patina/releases/v1.9.3/${buildReleaseInstallerName("1.9.3", platform)}`);
    assert.match(values.latest.platforms[platform].url, /^https:\/\/github.com/);
  }
  assert.throws(() => buildMirrorManifest(values.latest, values.repository, "http://example.com"), /HTTPS/);
  delete values.latest.platforms["windows-aarch64"];
  assert.ok(validatePreparedReleaseAssetValues(values).some((error) => error.includes("platforms")));
  assert.throws(() => buildMirrorManifest(values.latest, values.repository, "https://example.com"), /both/);
}

async function testPrepareAndVerifyReleaseAssetsDetectTampering() {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const testRoot = await mkdtemp(path.join(os.tmpdir(), "patina-release-assets-"));
  const bundleDir = path.join(testRoot, "bundle");
  const outputDir = path.join(testRoot, "dist-release");
  const signing = signingFixture();
  const prepare = () => prepareReleaseAssets(version, bundleDir, outputDir, "Ceceliaee/patina");
  const verifyAssets = () => verifyReleaseAssets(version, bundleDir, outputDir, "Ceceliaee/patina", signing.publicKey);
  try {
    for (const { arch, platform } of WINDOWS_RELEASE_TARGETS) {
      const dir = path.join(bundleDir, arch, "nsis");
      await mkdir(dir, { recursive: true });
      const bytes = Buffer.from(`installer payload ${platform}`);
      await writeFile(path.join(dir, "Patina-setup.exe"), bytes);
      await writeFile(path.join(dir, "Patina-setup.exe.sig"), signing.signature(bytes));
      await writeFile(path.join(bundleDir, arch, "Patina.exe"), peFixture(platform));
    }
    await prepare(); await verifyAssets();
    const latestPath = path.join(outputDir, "latest.json");
    const goodLatest = JSON.parse(await readFile(latestPath, "utf8"));
    const sums = parseSha256SumsText(await readFile(path.join(outputDir, "SHA256SUMS.txt"), "utf8"));
    assert.equal(sums.length, 2);
    for (const { platform } of WINDOWS_RELEASE_TARGETS) {
      const installer = path.join(outputDir, buildReleaseInstallerName(version, platform));
      assert.equal(sums.find((entry) => entry.fileName === path.basename(installer))?.digest, await sha256File(installer));
      await writeFile(installer, "tampered");
      await assert.rejects(verifyAssets(), /signature verification failed/);
      await prepare();
    }
    const armFile = path.join(outputDir, buildReleaseInstallerName(version, "windows-aarch64"));
    await assert.rejects(verifyUpdaterSignature(armFile, goodLatest.platforms["windows-x86_64"].signature, signing.publicKey), /verification failed/);
    await assert.rejects(verifyUpdaterSignature(armFile, goodLatest.platforms["windows-aarch64"].signature, signingFixture().publicKey), /verification failed/);
    for (const mutate of [
      (latest) => { delete latest.platforms["windows-aarch64"]; },
      (latest) => { latest.platforms.extra = latest.platforms["windows-x86_64"]; },
      (latest) => { latest.platforms["windows-aarch64"].url = latest.platforms["windows-x86_64"].url; },
      (latest) => { latest.platforms["windows-aarch64"].signature = latest.platforms["windows-x86_64"].signature; },
      (latest) => { latest.version = "0.0.1"; },
    ]) {
      const changed = structuredClone(goodLatest); mutate(changed);
      await writeFile(latestPath, JSON.stringify(changed));
      await assert.rejects(verifyAssets(), /validation failed/);
    }
    await prepare();
    await writeFile(path.join(outputDir, "SHA256SUMS.txt"), renderSha256Sums("0".repeat(64), "wrong.exe"));
    await assert.rejects(verifyAssets(), /canonical order/);
    await prepare();
    await writeFile(path.join(outputDir, "extra.exe"), "extra");
    await assert.rejects(verifyAssets(), /exactly the two/);
    await rm(path.join(outputDir, "extra.exe"));
    await writeFile(path.join(bundleDir, "arm64", "Patina.exe"), peFixture("windows-x86_64"));
    await assert.rejects(prepare(), /architecture/);
    await writeFile(path.join(bundleDir, "arm64", "Patina.exe"), peFixture("windows-aarch64"));
    await writeFile(path.join(bundleDir, "arm64", "nsis", "Patina-setup.exe.sig"), "  \n");
    await assert.rejects(prepare(), /signature file is empty/);
    await rm(path.join(bundleDir, "arm64", "nsis", "Patina-setup.exe.sig"));
    await assert.rejects(prepare(), /could not find/);
  } finally {
    const root = path.resolve(testRoot);
    assert.ok(root.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    await rm(root, { recursive: true, force: true });
  }
}

testArchitectureAndMirrorContracts();
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
testDualArchitectureWorkflowBoundaries();
testToolchainContractsStayAligned();
testWorkflowsUseNodeVersionFileAsSingleSource();
testWorkflowsPinThirdPartyActionsToReviewedCommits();
testWorkflowsUseReviewedNode24ActionRevisions();
testVersionFilesValidationPassesWhenAllVersionsMatch();
testVersionFilesValidationCatchesPackageJsonMismatch();
testVersionFilesValidationCatchesPackageLockRootMismatch();
testVersionFilesValidationCatchesTauriConfigMismatch();
testVersionFilesValidationCatchesCargoMismatch();
testVersionFilesValidationCatchesMissingChangelogSection();
testVersionFilesValidationRejectsInvalidVersion();
testDependencyAuditKeepsOfflineModeExplicitAndNetworkFree();
await testPrepareAndVerifyReleaseAssetsDetectTampering();

console.log("Passed release policy tests");
