import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const CHANGELOG_PATH = path.join(ROOT, "CHANGELOG.md");
const PACKAGE_JSON_PATH = path.join(ROOT, "package.json");
const PACKAGE_LOCK_PATH = path.join(ROOT, "package-lock.json");
const TAURI_CONFIG_PATH = path.join(ROOT, "src-tauri", "tauri.conf.json");
const TAURI_DEV_CONFIG_PATH = path.join(ROOT, "src-tauri", "tauri.dev.conf.json");
const TAURI_LOCAL_CONFIG_PATH = path.join(ROOT, "src-tauri", "tauri.local.conf.json");
const CARGO_TOML_PATH = path.join(ROOT, "src-tauri", "Cargo.toml");
const CARGO_LOCK_PATH = path.join(ROOT, "src-tauri", "Cargo.lock");

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9A-Za-z-][0-9A-Za-z-]*))*))?$/;
const GITHUB_UPDATER_ENDPOINT =
  "https://github.com/Ceceliaee/patina/releases/latest/download/latest.json";
const SHA256_SUMS_FILE_NAME = "SHA256SUMS.txt";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_RELEASE_NOTE_LENGTH = 100;
const MAX_APP_NOTE_LENGTH = 60;
const MAX_APP_NOTE_EN_LENGTH = 120;
const MAX_VISIBLE_RELEASE_CHANGE_COUNT = 7;
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

export function buildReleaseInstallerName(version) {
  if (!version || !VERSION_PATTERN.test(version)) {
    throw new Error(`invalid SemVer version "${version ?? ""}"`);
  }

  return `Patina_${version}_x64-setup.exe`;
}

function assertSafeFileName(fileName) {
  if (
    !fileName
    || fileName === "."
    || fileName === ".."
    || path.basename(fileName) !== fileName
    || fileName.includes("/")
    || fileName.includes("\\")
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
  if (lines.length !== 2 || lines[1] !== "") {
    throw new Error(`${SHA256_SUMS_FILE_NAME} must contain exactly one record and one trailing newline`);
  }

  const match = lines[0].match(/^([0-9a-f]{64})  (.+)$/);
  if (!match) {
    throw new Error(`${SHA256_SUMS_FILE_NAME} must use "<lowercase sha256><two spaces><file name>" format`);
  }

  const [, digest, fileName] = match;
  assertSafeFileName(fileName);
  return { digest, fileName };
}

export function selectSignedInstallerCandidates(entries) {
  const sortedEntries = [...entries].sort((left, right) => left.localeCompare(right, "en"));
  const signatureFiles = sortedEntries.filter((entry) => /\.exe\.sig$/i.test(entry));

  if (signatureFiles.length === 0) {
    throw new Error("could not find an updater .exe.sig artifact");
  }

  if (signatureFiles.length > 1) {
    throw new Error(`found multiple updater .exe.sig artifacts: ${signatureFiles.join(", ")}`);
  }

  const signatureFilePath = signatureFiles[0];
  const installerFilePath = signatureFilePath.replace(/\.sig$/i, "");
  if (!sortedEntries.includes(installerFilePath)) {
    throw new Error(`could not find installer matching ${signatureFilePath}`);
  }

  return { installerFilePath, signatureFilePath };
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

async function updateJsonVersion(filePath, version, updateLockRoot = false) {
  const json = JSON.parse(await readText(filePath));
  json.version = version;

  if (updateLockRoot && json.packages?.[""]) {
    json.packages[""].version = version;
  }

  await writeJson(filePath, json);
}

function dedupeStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

export function buildUpdaterEndpoints(existingEndpoints = []) {
  return dedupeStrings([
    GITHUB_UPDATER_ENDPOINT,
    ...existingEndpoints.filter((endpoint) => endpoint !== GITHUB_UPDATER_ENDPOINT),
  ]);
}

function withUpdaterDefaults(config) {
  return {
    ...config,
    plugins: {
      ...config.plugins,
      updater: {
        ...config.plugins?.updater,
        active: true,
        dialog: false,
        endpoints: buildUpdaterEndpoints(config.plugins?.updater?.endpoints ?? []),
      },
    },
  };
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

export function readPackageLockVersionsText(content) {
  const parsed = jsonValue(content, "package-lock.json", (json) => ({
    version: json.version ?? null,
    rootPackageVersion: json.packages?.[""]?.version ?? null,
  }));

  if (parsed && typeof parsed === "object" && "error" in parsed) {
    return parsed;
  }

  return parsed ?? {
    version: null,
    rootPackageVersion: null,
  };
}

export function readTauriConfigVersionText(content, filePath = "src-tauri/tauri.conf.json") {
  return jsonValue(content, filePath, (json) => json.version);
}

export function readCargoTomlPackageVersionText(content) {
  const match = /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(content);
  return match?.[1] ?? null;
}

export function readCargoLockPackageVersionText(content, packageName = "patina") {
  const blocks = content.split(/\r?\n(?=\[\[package\]\])/);
  for (const block of blocks) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (name === packageName) {
      return /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1] ?? null;
    }
  }

  return null;
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

  const packageLockVersions = readPackageLockVersionsText(files.packageLockJson ?? "");
  const checks = [
    versionFileError(
      "package.json",
      readPackageJsonVersionText(files.packageJson ?? ""),
      version,
    ),
    versionFileError(
      "package-lock.json",
      packageLockVersions && typeof packageLockVersions === "object" && "error" in packageLockVersions
        ? packageLockVersions
        : packageLockVersions.version,
      version,
      "version",
    ),
    versionFileError(
      'package-lock.json packages[""]',
      packageLockVersions && typeof packageLockVersions === "object" && "error" in packageLockVersions
        ? packageLockVersions
        : packageLockVersions.rootPackageVersion,
      version,
      "version",
    ),
    versionFileError(
      "src-tauri/tauri.conf.json",
      readTauriConfigVersionText(files.tauriConfig ?? "", "src-tauri/tauri.conf.json"),
      version,
    ),
    versionFileError(
      "src-tauri/tauri.dev.conf.json",
      readTauriConfigVersionText(files.tauriDevConfig ?? "", "src-tauri/tauri.dev.conf.json"),
      version,
    ),
    versionFileError(
      "src-tauri/tauri.local.conf.json",
      readTauriConfigVersionText(files.tauriLocalConfig ?? "", "src-tauri/tauri.local.conf.json"),
      version,
    ),
    versionFileError(
      "src-tauri/Cargo.toml",
      readCargoTomlPackageVersionText(files.cargoToml ?? ""),
      version,
      "[package].version",
    ),
    versionFileError(
      "src-tauri/Cargo.lock package patina",
      readCargoLockPackageVersionText(files.cargoLock ?? "", "patina"),
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
    packageLockJson: await readText(PACKAGE_LOCK_PATH),
    tauriConfig: await readText(TAURI_CONFIG_PATH),
    tauriDevConfig: await readText(TAURI_DEV_CONFIG_PATH),
    tauriLocalConfig: await readText(TAURI_LOCAL_CONFIG_PATH),
    cargoToml: await readText(CARGO_TOML_PATH),
    cargoLock: await readText(CARGO_LOCK_PATH),
    changelog: await readText(CHANGELOG_PATH),
  }, version);

  if (errors.length > 0) {
    fail(`version files are not ready for ${version}:\n- ${errors.join("\n- ")}`);
  }
}

async function syncVersion(version) {
  assertVersion(version);

  await updateJsonVersion(PACKAGE_JSON_PATH, version);
  await updateJsonVersion(PACKAGE_LOCK_PATH, version, true);

  const tauriConfig = withUpdaterDefaults(JSON.parse(await readText(TAURI_CONFIG_PATH)));
  tauriConfig.version = version;
  tauriConfig.bundle = {
    ...tauriConfig.bundle,
    createUpdaterArtifacts: true,
  };
  await writeJson(TAURI_CONFIG_PATH, tauriConfig);

  const tauriDevConfig = withUpdaterDefaults(JSON.parse(await readText(TAURI_DEV_CONFIG_PATH)));
  tauriDevConfig.version = version;
  await writeJson(TAURI_DEV_CONFIG_PATH, tauriDevConfig);

  const tauriLocalConfig = withUpdaterDefaults(JSON.parse(await readText(TAURI_LOCAL_CONFIG_PATH)));
  tauriLocalConfig.version = version;
  await writeJson(TAURI_LOCAL_CONFIG_PATH, tauriLocalConfig);

  const cargoToml = await readText(CARGO_TOML_PATH);
  const cargoPackageVersionPattern = /(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m;
  if (!cargoPackageVersionPattern.test(cargoToml)) {
    fail("could not find [package] version in src-tauri/Cargo.toml");
  }

  const updatedCargoToml = cargoToml.replace(
    cargoPackageVersionPattern,
    `$1${version}$2`,
  );

  await writeFile(CARGO_TOML_PATH, updatedCargoToml, "utf8");
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
  const visibleChangeCount = releaseNoteVisibleSections(parsed).reduce(
    (count, section) => count + section.bullets.length,
    0,
  );

  if (visibleChangeCount === 0) {
    return `CHANGELOG.md ${parsed.version} must include 1 to ${MAX_VISIBLE_RELEASE_CHANGE_COUNT} user-visible Added/Changed/Fixed/Removed entries`;
  }

  if (visibleChangeCount > MAX_VISIBLE_RELEASE_CHANGE_COUNT) {
    return `CHANGELOG.md ${parsed.version} has ${visibleChangeCount} user-visible Added/Changed/Fixed/Removed entries; keep the combined count to 1-${MAX_VISIBLE_RELEASE_CHANGE_COUNT}`;
  }

  return null;
}

async function parseChangelog(version) {
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
  if (parsed.release.length > MAX_RELEASE_NOTE_LENGTH) {
    fail(`CHANGELOG.md ${parsed.version} Release is too long; keep it short`);
  }

  if (parsed.appNote.length > MAX_APP_NOTE_LENGTH) {
    fail(`CHANGELOG.md ${parsed.version} App note is too long; keep it lighter`);
  }

  if (parsed.appNoteEn && parsed.appNoteEn.length > MAX_APP_NOTE_EN_LENGTH) {
    fail(`CHANGELOG.md ${parsed.version} App note en is too long; keep it lighter`);
  }

  const visibleChangeCountError = validateReleaseNoteVisibleChangeCount(parsed);
  if (visibleChangeCountError) {
    fail(visibleChangeCountError);
  }
}

export function renderReleaseNotes(parsed) {
  const visibleSections = releaseNoteVisibleSections(parsed);
  const releaseInstallerName = parsed.version
    ? buildReleaseInstallerName(parsed.version)
    : "Patina_<version>_x64-setup.exe";
  const lines = [parsed.release, ""];

  for (const section of visibleSections) {
    lines.push(`### ${RELEASE_NOTE_SECTION_TITLES[section.heading]}`, "", ...section.bullets, "");
  }

  lines.push(
    "### 下载",
    "",
    "- Windows 安装包：请下载本页面附件中的 `.exe` 安装包。",
    `- SHA-256：下载 \`${SHA256_SUMS_FILE_NAME}\` 后，可在 PowerShell 中运行 \`Get-FileHash .\\${releaseInstallerName} -Algorithm SHA256\` 并比对摘要。`,
    `- 构建来源：安装 GitHub CLI 后，可运行 \`gh attestation verify .\\${releaseInstallerName} --repo Ceceliaee/patina\`。`,
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

async function writeLatestJson(version, assetUrl, signature, outputPath, target = "windows-x86_64") {
  const parsed = await parseChangelog(version);
  await validateChangelog(version);

  if (!assetUrl) {
    fail("missing updater asset URL");
  }

  if (!signature) {
    fail("missing updater signature");
  }

  const latest = {
    version,
    notes: renderUpdaterNotes(parsed),
    pub_date: new Date().toISOString(),
    platforms: {
      [target]: {
        signature,
        url: assetUrl,
      },
    },
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, latest);
}

async function findSignedInstaller(bundleDir) {
  const entries = await readDirRecursive(bundleDir);
  let selected;
  try {
    selected = selectSignedInstallerCandidates(entries);
  } catch (error) {
    throw new Error(`${error.message} under ${bundleDir}`);
  }

  const signature = (await readText(selected.signatureFilePath)).trim();
  if (!signature) {
    throw new Error(`updater signature file is empty: ${selected.signatureFilePath}`);
  }

  return {
    ...selected,
    signature,
  };
}

async function readDirRecursive(rootDir) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      return readDirRecursive(absolutePath);
    }
    return entry.isFile() ? [absolutePath] : [];
  }));
  return files.flat();
}

function buildReleaseInstallerUrl(version, repository) {
  const releaseInstallerName = buildReleaseInstallerName(version);
  const tagName = `v${version}`;
  return `https://github.com/${repository}/releases/download/${tagName}/${encodeURIComponent(releaseInstallerName)}`;
}

export function validatePreparedReleaseAssetValues({
  version,
  repository,
  target,
  sourceDigest,
  finalDigest,
  checksumContent,
  latest,
  signature,
}) {
  const errors = [];
  const releaseInstallerName = buildReleaseInstallerName(version);
  let checksum;

  try {
    checksum = parseSha256SumsText(checksumContent);
  } catch (error) {
    errors.push(error.message);
  }

  if (sourceDigest !== finalDigest) {
    errors.push(`final installer SHA-256 ${finalDigest} does not match source installer SHA-256 ${sourceDigest}`);
  }

  if (checksum?.fileName !== releaseInstallerName) {
    errors.push(`${SHA256_SUMS_FILE_NAME} records ${checksum?.fileName ?? "no file"}, expected ${releaseInstallerName}`);
  }

  if (checksum?.digest !== finalDigest) {
    errors.push(`${SHA256_SUMS_FILE_NAME} records SHA-256 ${checksum?.digest ?? "none"}, expected ${finalDigest}`);
  }

  if (!latest || typeof latest !== "object" || Array.isArray(latest)) {
    errors.push("latest.json must contain a JSON object");
    return errors;
  }

  if (latest.version !== version) {
    errors.push(`latest.json version is ${latest.version ?? "missing"}, expected ${version}`);
  }

  const platform = latest.platforms?.[target];
  if (!platform || typeof platform !== "object" || Array.isArray(platform)) {
    errors.push(`latest.json is missing platforms.${target}`);
    return errors;
  }

  if (platform.signature !== signature) {
    errors.push(`latest.json platforms.${target}.signature does not match the Tauri updater signature`);
  }

  const expectedUrl = buildReleaseInstallerUrl(version, repository);
  if (platform.url !== expectedUrl) {
    errors.push(`latest.json platforms.${target}.url is ${platform.url ?? "missing"}, expected ${expectedUrl}`);
  }

  return errors;
}

export async function verifyReleaseAssets(
  version,
  bundleDir,
  outputDir,
  repository,
  target = "windows-x86_64",
) {
  const resolvedVersion = await resolveTargetVersion(version);
  if (!bundleDir) {
    fail("missing bundle directory");
  }

  if (!outputDir) {
    fail("missing output directory");
  }

  if (!repository) {
    fail("missing repository slug");
  }

  const { installerFilePath, signature } = await findSignedInstaller(bundleDir);
  const releaseInstallerName = buildReleaseInstallerName(resolvedVersion);
  const releaseInstallerPath = path.join(outputDir, releaseInstallerName);
  const checksumPath = path.join(outputDir, SHA256_SUMS_FILE_NAME);
  const latestJsonPath = path.join(outputDir, "latest.json");

  const [sourceDigest, finalDigest, checksumContent, latestContent] = await Promise.all([
    sha256File(installerFilePath),
    sha256File(releaseInstallerPath),
    readText(checksumPath),
    readText(latestJsonPath),
  ]);

  let latest;
  try {
    latest = JSON.parse(latestContent);
  } catch (error) {
    throw new Error(`latest.json is not valid JSON: ${error.message}`);
  }

  const errors = validatePreparedReleaseAssetValues({
    version: resolvedVersion,
    repository,
    target,
    sourceDigest,
    finalDigest,
    checksumContent,
    latest,
    signature,
  });

  if (errors.length > 0) {
    throw new Error(`release asset validation failed:\n- ${errors.join("\n- ")}`);
  }

  console.log(`release: verified version=${resolvedVersion}`);
  console.log(`release: verified installer=${releaseInstallerName}`);
  console.log(`release: verified sha256=${finalDigest}`);
}

export async function prepareReleaseAssets(
  version,
  bundleDir,
  outputDir,
  repository,
  target = "windows-x86_64",
) {
  const resolvedVersion = await resolveTargetVersion(version);
  await validateChangelog(resolvedVersion);

  if (!bundleDir) {
    fail("missing bundle directory");
  }

  if (!outputDir) {
    fail("missing output directory");
  }

  if (!repository) {
    fail("missing repository slug");
  }

  const { installerFilePath, signature } = await findSignedInstaller(bundleDir);
  const releaseInstallerName = buildReleaseInstallerName(resolvedVersion);
  const releaseInstallerPath = path.join(outputDir, releaseInstallerName);
  const assetUrl = buildReleaseInstallerUrl(resolvedVersion, repository);
  const latestJsonPath = path.join(outputDir, "latest.json");
  const checksumPath = path.join(outputDir, SHA256_SUMS_FILE_NAME);

  await mkdir(outputDir, { recursive: true });
  await copyFile(installerFilePath, releaseInstallerPath);
  const [sourceDigest, finalDigest] = await Promise.all([
    sha256File(installerFilePath),
    sha256File(releaseInstallerPath),
  ]);
  if (sourceDigest !== finalDigest) {
    throw new Error(`copied installer SHA-256 ${finalDigest} does not match source installer SHA-256 ${sourceDigest}`);
  }

  await writeFile(checksumPath, renderSha256Sums(finalDigest, releaseInstallerName), "utf8");
  await writeLatestJson(resolvedVersion, assetUrl, signature, latestJsonPath, target);
}

function help() {
  console.log(`Usage:
  node --experimental-strip-types scripts/release.ts sync-version <version>
  node --experimental-strip-types scripts/release.ts validate-version-files <version>
  node --experimental-strip-types scripts/release.ts validate-changelog <version>
  node --experimental-strip-types scripts/release.ts print-release-notes <version>
  node --experimental-strip-types scripts/release.ts write-release-notes <version> <output>
  node --experimental-strip-types scripts/release.ts write-latest-json <version> <asset-url> <signature> <output> [target]
  node --experimental-strip-types scripts/release.ts prepare-release-assets <version> <bundle-dir> <output-dir> <repository> [target]
  node --experimental-strip-types scripts/release.ts verify-release-assets <version> <bundle-dir> <output-dir> <repository> [target]
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
    case "write-latest-json":
      await writeLatestJson(args[0], args[1], args[2], args[3], args[4]);
      break;
    case "prepare-release-assets":
      await prepareReleaseAssets(args[0], args[1], args[2], args[3], args[4]);
      break;
    case "verify-release-assets":
      await verifyReleaseAssets(args[0], args[1], args[2], args[3], args[4]);
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
