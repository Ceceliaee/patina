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
const VERSION_POLICY_PATH = path.join(ROOT, "docs", "versioning-and-release-policy.md");

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9A-Za-z-][0-9A-Za-z-]*))*))?$/;
const VERSION_POLICY_CURRENT_CODE_VERSION_PATTERN = /(- 代码版本为 `)([^`]+)(`)/;

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

export function syncVersionPolicyCurrentCodeVersion(content, version) {
  assertVersion(version);

  if (!VERSION_POLICY_CURRENT_CODE_VERSION_PATTERN.test(content)) {
    fail("could not find current code version in docs/versioning-and-release-policy.md");
  }

  return content.replace(
    VERSION_POLICY_CURRENT_CODE_VERSION_PATTERN,
    `$1${version}$3`,
  );
}

export function readVersionPolicyCurrentCodeVersion(content) {
  return VERSION_POLICY_CURRENT_CODE_VERSION_PATTERN.exec(content)?.[2] ?? null;
}

export function validateVersionPolicyCurrentCodeVersionText(content, version) {
  const policyVersion = readVersionPolicyCurrentCodeVersion(content);

  if (!policyVersion) {
    return "docs/versioning-and-release-policy.md is missing current code version";
  }

  if (policyVersion !== version) {
    return `docs/versioning-and-release-policy.md current code version is ${policyVersion}, expected ${version}`;
  }

  return null;
}

async function updateVersionPolicyCurrentCodeVersion(version) {
  const versionPolicy = await readText(VERSION_POLICY_PATH);
  const updatedVersionPolicy = syncVersionPolicyCurrentCodeVersion(versionPolicy, version);
  await writeFile(VERSION_POLICY_PATH, updatedVersionPolicy, "utf8");
}

async function syncVersion(version) {
  assertVersion(version);

  await updateJsonVersion(PACKAGE_JSON_PATH, version);
  await updateJsonVersion(PACKAGE_LOCK_PATH, version, true);

  const tauriConfig = JSON.parse(await readText(TAURI_CONFIG_PATH));
  tauriConfig.version = version;
  tauriConfig.bundle = {
    ...tauriConfig.bundle,
    createUpdaterArtifacts: true,
  };
  tauriConfig.plugins = {
    ...tauriConfig.plugins,
    updater: {
      ...tauriConfig.plugins?.updater,
      active: true,
      dialog: false,
      endpoints: ["https://raw.githubusercontent.com/182376/time-tracking/updates/latest.json"],
    },
  };
  await writeJson(TAURI_CONFIG_PATH, tauriConfig);

  const tauriDevConfig = JSON.parse(await readText(TAURI_DEV_CONFIG_PATH));
  tauriDevConfig.version = version;
  await writeJson(TAURI_DEV_CONFIG_PATH, tauriDevConfig);

  const tauriLocalConfig = JSON.parse(await readText(TAURI_LOCAL_CONFIG_PATH));
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
  await updateVersionPolicyCurrentCodeVersion(version);
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

function fieldValue(sectionBody, field) {
  const match = new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m").exec(sectionBody);
  return match?.[1]?.trim() ?? "";
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

async function parseChangelog(version) {
  const targetVersion = await resolveTargetVersion(version);

  const changelog = await readText(CHANGELOG_PATH);
  const section = findVersionSection(changelog, targetVersion);
  const release = fieldValue(section.body, "Release");
  const appNote = fieldValue(section.body, "App note");

  return {
    version: targetVersion,
    ...section,
    release,
    appNote,
    bullets: ["Added", "Changed", "Fixed", "Removed"].flatMap((heading) =>
      sectionBullets(section.body, heading),
    ),
  };
}

async function validateChangelog(version) {
  const parsed = await parseChangelog(version);
  assertFinalField("Release", parsed.release, parsed.version);
  assertFinalField("App note", parsed.appNote, parsed.version);
  await validateVersionPolicyCurrentCodeVersion(parsed.version);

  if (parsed.release.length > 100) {
    fail(`CHANGELOG.md ${parsed.version} Release is too long; keep it short`);
  }

  if (parsed.appNote.length > 40) {
    fail(`CHANGELOG.md ${parsed.version} App note is too long; keep it lighter`);
  }
}

async function validateVersionPolicyCurrentCodeVersion(version) {
  const versionPolicy = await readText(VERSION_POLICY_PATH);
  const error = validateVersionPolicyCurrentCodeVersionText(versionPolicy, version);

  if (error) {
    fail(error);
  }
}

function renderReleaseNotes(parsed) {
  const visibleBullets = parsed.bullets.slice(0, 6);
  const lines = [parsed.release, ""];

  if (visibleBullets.length > 0) {
    lines.push("### 主要变化", "", ...visibleBullets, "");
  }

  lines.push("### 下载", "", "- Windows 安装包：请下载本页面附件中的 `.exe` 安装包。", "");

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
    notes: parsed.appNote,
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
  const signatureFile = entries.find((entry) => entry.endsWith(".exe.sig"));

  if (!signatureFile) {
    fail(`Could not find updater .exe.sig artifact under ${bundleDir}.`);
  }

  const installerFilePath = signatureFile.replace(/\.sig$/i, "");
  try {
    await readFile(installerFilePath);
  } catch {
    fail(`Could not find installer matching ${signatureFile}.`);
  }

  return {
    installerFilePath,
    signatureFilePath: signatureFile,
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

async function prepareReleaseAssets(
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

  const { installerFilePath, signatureFilePath } = await findSignedInstaller(bundleDir);
  const signature = (await readText(signatureFilePath)).trim();
  if (!signature) {
    fail(`updater signature file is empty: ${signatureFilePath}`);
  }

  const releaseInstallerName = `TimeTracker_${resolvedVersion}_x64-setup.exe`;
  const releaseInstallerPath = path.join(outputDir, releaseInstallerName);
  const tagName = `v${resolvedVersion}`;
  const encodedName = encodeURIComponent(releaseInstallerName);
  const assetUrl = `https://github.com/${repository}/releases/download/${tagName}/${encodedName}`;
  const latestJsonPath = path.join(outputDir, "latest.json");

  await mkdir(outputDir, { recursive: true });
  await copyFile(installerFilePath, releaseInstallerPath);
  await writeLatestJson(resolvedVersion, assetUrl, signature, latestJsonPath, target);
}

function help() {
  console.log(`Usage:
  node --experimental-strip-types scripts/release.ts sync-version <version>
  node --experimental-strip-types scripts/release.ts validate-changelog <version>
  node --experimental-strip-types scripts/release.ts print-release-notes <version>
  node --experimental-strip-types scripts/release.ts write-release-notes <version> <output>
  node --experimental-strip-types scripts/release.ts write-latest-json <version> <asset-url> <signature> <output> [target]
  node --experimental-strip-types scripts/release.ts prepare-release-assets <version> <bundle-dir> <output-dir> <repository> [target]
`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "sync-version":
      await syncVersion(args[0]);
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
    default:
      help();
      process.exit(command ? 1 : 0);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
