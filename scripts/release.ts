import { createReadStream } from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const CHANGELOG_PATH = path.join(ROOT, "CHANGELOG.md");
const PACKAGE_JSON_PATH = path.join(ROOT, "package.json");
const NATIVE_CARGO_TOML_PATH = path.join(ROOT, "desktop", "patina", "Cargo.toml");
const NATIVE_CARGO_LOCK_PATH = path.join(ROOT, "desktop", "Cargo.lock");

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9A-Za-z-][0-9A-Za-z-]*))*))?$/;

const SHA256_SUMS_FILE_NAME = "SHA256SUMS.txt";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RELEASE_NOTE_SECTION_TITLES = {
  Added: "新增",
  Changed: "改进",
  Fixed: "修复",
  Removed: "移除",
};
const VISIBLE_CHANGELOG_HEADINGS = Object.keys(RELEASE_NOTE_SECTION_TITLES);

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function assertVersion(version) {
  if (!version) {
    fail("missing version");
  }

  if (!VERSION_PATTERN.test(version)) {
    fail(`invalid SemVer version "${version}"`);
  }
}

export const WINDOWS_RELEASE_TARGETS = [
  { arch: "x64", target: "x86_64-pc-windows-msvc", platform: "windows-x86_64", machine: 0x8664 },
  { arch: "arm64", target: "aarch64-pc-windows-msvc", platform: "windows-aarch64", machine: 0xaa64 },
] as const;

export function releaseTarget(platform: string) {
  const target = WINDOWS_RELEASE_TARGETS.find((entry) => entry.platform === platform);
  if (!target) throw new Error(`unsupported release platform: ${platform}`);
  return target;
}

export function buildReleaseInstallerName(version, platform = "windows-x86_64") {
  if (!version || !VERSION_PATTERN.test(version)) {
    throw new Error(`invalid SemVer version "${version ?? ""}"`);
  }

  return `Patina_${version}_${releaseTarget(platform).arch}-setup.exe`;
}

function assertSafeFileName(fileName) {
  if (
    !fileName
    || fileName === "."
    || fileName === ".."
    || path.basename(fileName) !== fileName
    || fileName.includes("/")
    || fileName.includes("\\")
    || /[\s:<>"|?*\x00-\x1f]/.test(fileName)
  ) {
    throw new Error(`unsafe release asset file name "${fileName ?? ""}"`);
  }
}

export function renderSha256Sums(digest, fileName) {
  if (!SHA256_PATTERN.test(digest ?? "")) {
    throw new Error("SHA-256 digest must contain exactly 64 lowercase hexadecimal characters");
  }

  assertSafeFileName(fileName);
  return `${digest}  ${fileName}\n`;
}

export function parseSha256SumsText(content) {
  if (content.startsWith("\uFEFF")) {
    throw new Error(`${SHA256_SUMS_FILE_NAME} must not contain a UTF-8 BOM`);
  }

  if (content.includes("\r")) {
    throw new Error(`${SHA256_SUMS_FILE_NAME} must use LF line endings`);
  }

  const lines = content.split("\n");
  if (lines.length < 2 || lines.pop() !== "") {
    throw new Error(`${SHA256_SUMS_FILE_NAME} must contain records and one trailing newline`);
  }

  const records = lines.map((line) => {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) {
      throw new Error(`${SHA256_SUMS_FILE_NAME} must use "<lowercase sha256><two spaces><file name>" format`);
    }

    const [, digest, fileName] = match;
    assertSafeFileName(fileName);
    return { digest, fileName };
  });
  if (new Set(records.map((entry) => entry.fileName)).size !== records.length) {
    throw new Error(`${SHA256_SUMS_FILE_NAME} contains duplicate files`);
  }
  return records;
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });

  return hash.digest("hex");
}

async function readText(filePath) {
  return readFile(filePath, "utf8");
}

async function readPackageVersion() {
  const packageJson = JSON.parse(await readText(PACKAGE_JSON_PATH));
  return packageJson.version;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function updateJsonVersion(filePath, version) {
  const json = JSON.parse(await readText(filePath));
  json.version = version;

  await writeJson(filePath, json);
}

function jsonValue(content, filePath, selector) {
  try {
    return selector(JSON.parse(content)) ?? null;
  } catch (error) {
    return {
      error: `${filePath} could not be parsed as JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function readPackageJsonVersionText(content) {
  return jsonValue(content, "package.json", (json) => json.version);
}

export function hasChangelogVersionSectionText(content, version) {
  const headingPattern = new RegExp(
    `^## \\[${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`,
    "m",
  );
  return headingPattern.test(content);
}

function versionFileError(filePath, actual, expected, label = "version") {
  if (actual && typeof actual === "object" && "error" in actual) {
    return actual.error;
  }

  if (!actual) {
    return `${filePath} is missing ${label}`;
  }

  if (actual !== expected) {
    return `${filePath} ${label} is ${actual}, expected ${expected}`;
  }

  return null;
}

export function validateReleaseVersionFilesText(files, version) {
  const errors = [];

  if (!version) {
    return ["missing version"];
  }

  if (!VERSION_PATTERN.test(version)) {
    return [`invalid SemVer version "${version}"`];
  }

  const checks = [
    versionFileError(
      "package.json",
      readPackageJsonVersionText(files.packageJson ?? ""),
      version,
    ),
    hasChangelogVersionSectionText(files.changelog ?? "", version)
      ? null
      : `CHANGELOG.md is missing "## [${version}] - YYYY-MM-DD"`,
  ];

  for (const error of checks) {
    if (error) {
      errors.push(error);
    }
  }

  return errors;
}

async function validateReleaseVersionFiles(version) {
  assertVersion(version);

  const errors = validateReleaseVersionFilesText({
    packageJson: await readText(PACKAGE_JSON_PATH),
    changelog: await readText(CHANGELOG_PATH),
  }, version);

  if (errors.length > 0) {
    fail(`version files are not ready for ${version}:\n- ${errors.join("\n- ")}`);
  }
  const { validateNativeVersionFiles } = await import("./native-release.ts");
  validateNativeVersionFiles(version, await readText(NATIVE_CARGO_TOML_PATH), await readText(NATIVE_CARGO_LOCK_PATH));
}

async function syncVersion(version) {
  assertVersion(version);
  const { syncNativeVersionText } = await import("./native-release.ts");
  const native = syncNativeVersionText(version, await readText(NATIVE_CARGO_TOML_PATH), await readText(NATIVE_CARGO_LOCK_PATH));

  await updateJsonVersion(PACKAGE_JSON_PATH, version);

  await writeFile(NATIVE_CARGO_TOML_PATH, native.manifest, "utf8");
  await writeFile(NATIVE_CARGO_LOCK_PATH, native.lock, "utf8");
}

async function resolveTargetVersion(version) {
  if (version) {
    assertVersion(version);
    return version;
  }

  const packageVersion = await readPackageVersion();
  assertVersion(packageVersion);
  return packageVersion;
}

function findVersionSection(changelog, version) {
  const headingPattern = new RegExp(
    `^## \\[${escapeRegExp(version)}\\] - (\\d{4}-\\d{2}-\\d{2})\\s*$`,
    "m",
  );
  const heading = headingPattern.exec(changelog);

  if (!heading) {
    fail(`CHANGELOG.md is missing "## [${version}] - YYYY-MM-DD"`);
  }

  const sectionStart = heading.index + heading[0].length;
  const rest = changelog.slice(sectionStart);
  const nextHeading = rest.search(/^## \[/m);
  const body = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  return {
    date: heading[1],
    body: body.trim(),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function fieldValue(sectionBody, field) {
  const match = new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m").exec(sectionBody);
  return match?.[1]?.trim() ?? "";
}

export function renderUpdaterNotes(parsed) {
  if (!parsed.appNoteEn) {
    return parsed.appNote;
  }

  return [
    `zh-CN: ${parsed.appNote}`,
    `en-US: ${parsed.appNoteEn}`,
  ].join("\n");
}

function assertFinalField(field, value, version) {
  if (!value) {
    fail(`CHANGELOG.md ${version} is missing "${field}:"`);
  }

  if (/^(待定|TBD|TODO)\.?$/i.test(value)) {
    fail(`CHANGELOG.md ${version} has unfinished "${field}: ${value}"`);
  }
}

function sectionBullets(sectionBody, heading) {
  const match = new RegExp(`^### ${heading}\\s*$`, "m").exec(sectionBody);
  if (!match) {
    return [];
  }

  const contentStart = match.index + match[0].length;
  const rest = sectionBody.slice(contentStart);
  const nextHeading = rest.search(/^### /m);
  const content = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .filter((line) => !/^-\s*暂无。?$/.test(line));
}

function releaseNoteVisibleSections(parsed) {
  return (parsed.sections ?? [
    {
      heading: "Changed",
      bullets: parsed.bullets ?? [],
    },
  ]).filter((section) =>
    Object.hasOwn(RELEASE_NOTE_SECTION_TITLES, section.heading)
    && (section.bullets ?? []).length > 0
  );
}

export function validateReleaseNoteVisibleChangeCount(parsed) {
  const version = VERSION_PATTERN.exec(parsed.version);
  const isMinorRelease = version && version[2] !== "0" && version[3] === "0";
  const limit = isMinorRelease ? 14 : 7;
  const visibleChangeCount = releaseNoteVisibleSections(parsed).reduce(
    (count, section) => count + section.bullets.length,
    0,
  );

  if (visibleChangeCount === 0) {
    return `CHANGELOG.md ${parsed.version} must include 1 to ${limit} user-visible Added/Changed/Fixed/Removed entries`;
  }

  if (visibleChangeCount > limit) {
    return `CHANGELOG.md ${parsed.version} has ${visibleChangeCount} user-visible Added/Changed/Fixed/Removed entries; keep the combined count to 1-${limit}`;
  }

  return null;
}

export async function parseChangelog(version) {
  const targetVersion = await resolveTargetVersion(version);

  const changelog = await readText(CHANGELOG_PATH);
  const section = findVersionSection(changelog, targetVersion);
  const release = fieldValue(section.body, "Release");
  const appNote = fieldValue(section.body, "App note");
  const appNoteEn = fieldValue(section.body, "App note en");
  const sections = VISIBLE_CHANGELOG_HEADINGS.map((heading) => ({
    heading,
    bullets: sectionBullets(section.body, heading),
  })).filter((visibleSection) => visibleSection.bullets.length > 0);

  return {
    version: targetVersion,
    ...section,
    release,
    appNote,
    appNoteEn,
    sections,
    bullets: sections.flatMap((visibleSection) => visibleSection.bullets),
  };
}

async function validateChangelog(version) {
  const parsed = await parseChangelog(version);
  assertFinalField("Release", parsed.release, parsed.version);
  assertFinalField("App note", parsed.appNote, parsed.version);

  const visibleChangeCountError = validateReleaseNoteVisibleChangeCount(parsed);
  if (visibleChangeCountError) {
    fail(visibleChangeCountError);
  }
}

export function renderReleaseNotes(parsed) {
  const visibleSections = releaseNoteVisibleSections(parsed);
  const lines = [parsed.release, ""];

  for (const section of visibleSections) {
    lines.push(`### ${RELEASE_NOTE_SECTION_TITLES[section.heading]}`, "", ...section.bullets, "");
  }

  const installerBadges = WINDOWS_RELEASE_TARGETS.map(({ arch, platform }) => {
    const name = parsed.version ? buildReleaseInstallerName(parsed.version, platform) : `Patina_<version>_${arch}-setup.exe`;
    if (!parsed.version) return name;

    const displayArch = arch === "arm64" ? "ARM64" : arch;
    const badge = `https://img.shields.io/badge/Setup-${displayArch}-1683a7?logo=windows11&logoColor=white`;
    return `[![Setup ${displayArch}](${badge})](${buildReleaseInstallerUrl(parsed.version, "Ceceliaee/patina", platform)})`;
  });

  lines.push(
    "### 下载",
    "",
    "| 系统 | 下载 |",
    "| --- | --- |",
    `| Windows | ${installerBadges.join("<br>")} |`,
    "",
  );

  return lines.join("\n");
}

async function writeReleaseNotes(version, outputPath) {
  const parsed = await parseChangelog(version);
  await validateChangelog(version);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderReleaseNotes(parsed), "utf8");
}

async function printReleaseNotes(version) {
  const parsed = await parseChangelog(version);
  await validateChangelog(version);
  process.stdout.write(renderReleaseNotes(parsed));
}

export function buildReleaseInstallerUrl(version, repository, platform = "windows-x86_64") {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("invalid release repository");
  }
  return `https://github.com/${repository}/releases/download/v${version}/${buildReleaseInstallerName(version, platform)}`;
}

export function verifyPeArchitecture(bytes: Buffer, platform: string) {
  const expected = releaseTarget(platform).machine;
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("invalid PE DOS header");
  const offset = bytes.readUInt32LE(0x3c);
  if (offset < 64 || offset > bytes.length - 24 || bytes.readUInt32LE(offset) !== 0x4550) {
    throw new Error("invalid PE signature or offset");
  }
  if (bytes.readUInt16LE(offset + 4) !== expected) throw new Error(`PE architecture does not match ${platform}`);
}

export async function verifyUpdaterSignature(installerPath: string, signature: string, publicKey: string) {
  const keyLines = Buffer.from(publicKey.trim(), "base64").toString("utf8").trim().split(/\r?\n/);
  const sigLines = Buffer.from(signature.trim(), "base64").toString("utf8").trim().split(/\r?\n/);
  const key = Buffer.from(keyLines[1] ?? "", "base64");
  const packet = Buffer.from(sigLines[1] ?? "", "base64");
  if (key.length !== 42 || packet.length !== 74 || key.toString("ascii", 0, 2) !== "Ed"
    || !packet.subarray(2, 10).equals(key.subarray(2, 10))
    || !sigLines[2]?.startsWith("trusted comment: ")) throw new Error("invalid updater signature/key packet");
  const algorithm = packet.toString("ascii", 0, 2);
  if (algorithm !== "ED") throw new Error("expected prehashed minisign updater signature");
  const digest = createHash("blake2b512");
  for await (const chunk of createReadStream(installerPath)) digest.update(chunk);
  const edKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]),
    format: "der", type: "spki",
  });
  if (!verify(null, digest.digest(), edKey, packet.subarray(10))
    || !verify(null, Buffer.concat([packet.subarray(10), Buffer.from(sigLines[2].slice(17))]),
      edKey, Buffer.from(sigLines[3] ?? "", "base64"))) {
    throw new Error(`updater signature verification failed: ${installerPath}`);
  }
}

export function buildMirrorManifest(latest, repository, baseUrl: string) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("mirror base must be a plain HTTPS URL");
  const result = structuredClone(latest);
  assertVersion(result.version);
  if (JSON.stringify(Object.keys(result.platforms ?? {}).sort()) !== JSON.stringify(WINDOWS_RELEASE_TARGETS.map((entry) => entry.platform).sort())) {
    throw new Error("mirror requires both Windows platforms");
  }
  for (const { platform } of WINDOWS_RELEASE_TARGETS) {
    const entry = result.platforms[platform];
    if (!entry.signature || entry.url !== buildReleaseInstallerUrl(result.version, repository, platform)) throw new Error(`invalid GitHub manifest entry ${platform}`);
    entry.url = `${base.href.replace(/\/$/, "")}/releases/v${result.version}/${buildReleaseInstallerName(result.version, platform)}`;
  }
  return result;
}

function help() {
  console.log(`Usage:
  node --experimental-strip-types scripts/release.ts sync-version <version>
  node --experimental-strip-types scripts/release.ts validate-version-files <version>
  node --experimental-strip-types scripts/release.ts validate-changelog <version>
  node --experimental-strip-types scripts/release.ts print-release-notes <version>
  node --experimental-strip-types scripts/release.ts write-release-notes <version> <output>
`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "sync-version":
      await syncVersion(args[0]);
      break;
    case "validate-version-files":
      await validateReleaseVersionFiles(args[0]);
      break;
    case "validate-changelog":
      await validateChangelog(args[0]);
      break;
    case "print-release-notes":
      await printReleaseNotes(args[0]);
      break;
    case "write-release-notes":
      await writeReleaseNotes(args[0], args[1]);
      break;

    default:
      help();
      process.exit(command ? 1 : 0);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
