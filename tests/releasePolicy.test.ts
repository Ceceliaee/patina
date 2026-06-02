import assert from "node:assert/strict";
import {
  buildUpdaterEndpoints,
  fieldValue,
  readVersionPolicyCurrentCodeVersion,
  renderUpdaterNotes,
  syncVersionPolicyCurrentCodeVersion,
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
    "https://github.com/Ceceliaee/time-tracking/releases/latest/download/latest.json",
    "https://pub-example.r2.dev/latest.json",
  ]);

  assert.deepEqual(endpoints, [
    "https://github.com/Ceceliaee/time-tracking/releases/latest/download/latest.json",
    "https://pub-example.r2.dev/latest.json",
  ]);
}

testSyncsCurrentCodeVersion();
testSupportsPrereleaseVersion();
testMissingPolicyVersionIsNull();
testStalePolicyVersionFailsValidation();
testUpdaterNotesKeepLocalizedVariants();
testUpdaterNotesFallsBackToAppNote();
testUpdaterEndpointsKeepGithubFirstAndPreserveMirrors();

console.log("Passed 7 release policy tests");
