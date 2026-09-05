import { createReadStream } from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";
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
  if (sortedEntries.filter((entry) => /\.exe$/i.test(entry)).length !== 1) {
    throw new Error("expected exactly one installer in bundle directory");
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
  const lines = [parsed.release, ""];

  for (const section of visibleSections) {
    lines.push(`### ${RELEASE_NOTE_SECTION_TITLES[section.heading]}`, "", ...section.bullets, "");
  }

  lines.push(
    "### 下载",
    "",
    "| Windows 设备 | 安装包 |",
    "| --- | --- |",
    ...WINDOWS_RELEASE_TARGETS.map(({ arch, platform }) => {
      const name = parsed.version ? buildReleaseInstallerName(parsed.version, platform) : `Patina_<version>_${arch}-setup.exe`;
      const label = arch === "x64" ? "Intel / AMD x64" : "ARM64（如骁龙设备）";
      return `| ${label} | ${parsed.version ? `[${name}](${buildReleaseInstallerUrl(parsed.version, "Ceceliaee/patina", platform)})` : name} |`;
    }),
    "",
    "不确定设备架构时，可在 Windows「设置 → 系统 → 关于 → 系统类型」中查看。自动更新保持当前已安装应用的架构。",
    "",
    `下载 \`${SHA256_SUMS_FILE_NAME}\`，运行与所选安装包对应的 PowerShell 命令，并比对文件中的摘要。构建来源验证需要安装 GitHub CLI。`,
    "",
    ...WINDOWS_RELEASE_TARGETS.flatMap(({ arch, platform }) => {
      const name = parsed.version ? buildReleaseInstallerName(parsed.version, platform) : `Patina_<version>_${arch}-setup.exe`;
      return [`**${arch}**`, "", "```powershell", `Get-FileHash .\\${name} -Algorithm SHA256`, `gh attestation verify .\\${name} --repo Ceceliaee/patina`, "```", ""];
    }),
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

export function validatePreparedReleaseAssetValues({ version, repository, assets, checksumContent, latest }) {
  const errors: string[] = [];
  const expectedNames = WINDOWS_RELEASE_TARGETS.map(({ platform }) => buildReleaseInstallerName(version, platform));
  let checksums: Array<{ digest: string; fileName: string }> = [];
  try { checksums = parseSha256SumsText(checksumContent); } catch (error) { errors.push(error.message); }
  if (JSON.stringify(checksums.map((entry) => entry.fileName)) !== JSON.stringify(expectedNames)) {
    errors.push(`${SHA256_SUMS_FILE_NAME} must record exactly the two installers in canonical order`);
  }
  if (!latest || latest.version !== version) errors.push(`latest.json version must be ${version}`);
  const platforms = WINDOWS_RELEASE_TARGETS.map((entry) => entry.platform);
  if (JSON.stringify(Object.keys(latest?.platforms ?? {}).sort()) !== JSON.stringify([...platforms].sort())) {
    errors.push("latest.json must contain exactly the supported platforms");
  }
  if (!Array.isArray(assets) || assets.length !== 2 || new Set(assets.map((asset) => asset.platform)).size !== 2) {
    errors.push("expected exactly two distinct source assets");
  }
  for (const { platform } of WINDOWS_RELEASE_TARGETS) {
    const asset = assets?.find((entry) => entry.platform === platform);
    if (!asset) { errors.push(`missing source asset ${platform}`); continue; }
    const name = buildReleaseInstallerName(version, platform);
    if (!SHA256_PATTERN.test(asset.finalDigest) || asset.sourceDigest !== asset.finalDigest) {
      errors.push(`${name} does not match source installer SHA-256`);
    }
    if (checksums.find((entry) => entry.fileName === name)?.digest !== asset.finalDigest) {
      errors.push(`${SHA256_SUMS_FILE_NAME} records SHA-256 inconsistent with ${name}`);
    }
    if (!asset.signature || latest?.platforms?.[platform]?.signature !== asset.signature) {
      errors.push(`${platform} updater signature does not match source`);
    }
    const url = buildReleaseInstallerUrl(version, repository, platform);
    if (latest?.platforms?.[platform]?.url !== url) errors.push(`${platform} expected ${url}`);
  }
  return errors;
}

async function readReleaseInputs(version, bundleDir) {
  return Promise.all(WINDOWS_RELEASE_TARGETS.map(async ({ arch, platform }) => {
    const inputDir = path.join(bundleDir, arch);
    const signed = await findSignedInstaller(path.join(inputDir, "nsis"));
    await readFile(path.join(inputDir, "Patina.exe")).then((bytes) => verifyPeArchitecture(bytes, platform));
    return { ...signed, platform, fileName: buildReleaseInstallerName(version, platform) };
  }));
}

export async function verifyReleaseAssets(version, bundleDir, outputDir, repository, publicKey?: string) {
  assertVersion(version);
  const inputs = await readReleaseInputs(version, bundleDir);
  const key = publicKey ?? JSON.parse(await readText(TAURI_CONFIG_PATH)).plugins.updater.pubkey;
  const assets = await Promise.all(inputs.map(async (input) => {
    const finalPath = path.join(outputDir, input.fileName);
    await verifyUpdaterSignature(finalPath, input.signature, key);
    return { ...input, sourceDigest: await sha256File(input.installerFilePath), finalDigest: await sha256File(finalPath) };
  }));
  const latest = JSON.parse(await readText(path.join(outputDir, "latest.json")));
  const checksumContent = await readText(path.join(outputDir, SHA256_SUMS_FILE_NAME));
  const errors = validatePreparedReleaseAssetValues({ version, repository, assets, checksumContent, latest });
  const exeNames = (await readDirRecursive(outputDir)).filter((file) => /\.exe$/i.test(file));
  if (exeNames.length !== 2 || exeNames.some((file) => !inputs.some((input) => path.resolve(file) === path.resolve(outputDir, input.fileName)))) {
    errors.push("output must contain exactly the two final installers");
  }
  if (errors.length) throw new Error(`release asset validation failed:\n- ${errors.join("\n- ")}`);
  console.log(`release: verified both Windows architectures for ${version}`);
}

export async function prepareReleaseAssets(version, bundleDir, outputDir, repository) {
  assertVersion(version);
  await validateChangelog(version);
  const inputs = await readReleaseInputs(version, bundleDir);
  const parsed = await parseChangelog(version);
  const latest = { version, notes: renderUpdaterNotes(parsed), pub_date: new Date().toISOString(), platforms: {} };
  const sums: string[] = [];
  await mkdir(outputDir, { recursive: true });
  for (const input of inputs) {
    const finalPath = path.join(outputDir, input.fileName);
    await copyFile(input.installerFilePath, finalPath);
    const digest = await sha256File(finalPath);
    if (digest !== await sha256File(input.installerFilePath)) throw new Error(`copied installer differs: ${input.fileName}`);
    sums.push(renderSha256Sums(digest, input.fileName));
    latest.platforms[input.platform] = { signature: input.signature, url: buildReleaseInstallerUrl(version, repository, input.platform) };
  }
  await writeFile(path.join(outputDir, SHA256_SUMS_FILE_NAME), sums.join(""), "utf8");
  await writeJson(path.join(outputDir, "latest.json"), latest);
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
  node --experimental-strip-types scripts/release.ts mirror-manifest <github-latest> <repository> <base-url> <output>
  node --experimental-strip-types scripts/release.ts prepare-release-assets <version> <bundle-dir> <output-dir> <repository>
  node --experimental-strip-types scripts/release.ts verify-release-assets <version> <bundle-dir> <output-dir> <repository>
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
    case "mirror-manifest":
      await writeJson(args[3], buildMirrorManifest(JSON.parse(await readText(args[0])), args[1], args[2]));
      break;
    case "prepare-release-assets":
      await prepareReleaseAssets(args[0], args[1], args[2], args[3]);
      break;
    case "verify-release-assets":
      await verifyReleaseAssets(args[0], args[1], args[2], args[3]);
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
