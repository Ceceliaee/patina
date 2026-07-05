import { spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_DIR = join(REPO_ROOT, "extensions", "firefox");
const BUILD_DIR = join(REPO_ROOT, "dist", "extensions", "firefox", "unpacked");
const PACKAGE_DIR = join(REPO_ROOT, "dist", "extensions", "firefox");
const SIGNED_ARTIFACTS_DIR = join(PACKAGE_DIR, "signed");
const REQUIRED_ICON_FILES = {
  "32": "icons/icon-32.png",
  "64": "icons/icon-64.png",
  "128": "icons/icon-128.png",
} as const;
const EXTENSION_FILES = [
  "manifest.json",
  "background.js",
  "options.html",
  "options.js",
  "popup.html",
  "popup.js",
  ...Object.values(REQUIRED_ICON_FILES),
] as const;

type FirefoxManifest = {
  manifest_version?: number;
  name?: string;
  version?: string;
  background?: {
    scripts?: string[];
    service_worker?: string;
  };
  permissions?: string[];
  host_permissions?: string[];
  icons?: Record<string, string>;
  options_page?: string;
  action?: {
    default_popup?: string;
    default_icon?: Record<string, string>;
  };
  browser_specific_settings?: {
    gecko?: {
      id?: string;
    };
  };
  content_security_policy?: {
    extension_pages?: string;
  };
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readManifest() {
  let raw = "";
  try {
    raw = await readFile(join(SOURCE_DIR, "manifest.json"), "utf8");
  } catch {
    fail("Firefox extension check failed. Missing extensions/firefox/manifest.json.");
  }

  try {
    return JSON.parse(raw) as FirefoxManifest;
  } catch (error) {
    fail(`Firefox extension check failed. manifest.json is invalid JSON: ${String(error)}`);
  }
}

function getExtensionVersion(manifest: FirefoxManifest) {
  const version = manifest.version?.trim();
  if (!version) {
    fail("Firefox extension check failed. manifest version is required.");
  }
  return version;
}

function getPackageFile(version: string) {
  return join(PACKAGE_DIR, `patina-firefox-extension-v${version}.zip`);
}

function getSignedPackageFile(version: string) {
  return join(PACKAGE_DIR, `patina-firefox-extension-v${version}.xpi`);
}

function getPackageRootName(version: string) {
  return `patina-firefox-extension-v${version}`;
}

async function cleanExistingUnsignedPackages() {
  let entries: string[] = [];
  try {
    entries = await readdir(PACKAGE_DIR);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === "patina-firefox-extension.zip" || /^patina-firefox-extension-v.+\.zip$/.test(entry)) {
      await rm(join(PACKAGE_DIR, entry), { force: true });
    }
  }
}

async function cleanExistingSignedPackages() {
  let entries: string[] = [];
  try {
    entries = await readdir(PACKAGE_DIR);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === "signed" || entry === "patina-firefox-extension.xpi" || /^patina-firefox-extension-v.+\.xpi$/.test(entry)) {
      await rm(join(PACKAGE_DIR, entry), { force: true, recursive: true });
    }
  }
}

async function ensureFile(relativePath: string) {
  const filePath = join(SOURCE_DIR, relativePath);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      fail(`Firefox extension check failed. Expected file: ${relativePath}`);
    }
  } catch {
    fail(`Firefox extension check failed. Missing file: ${relativePath}`);
  }
}

async function checkExtension() {
  for (const file of EXTENSION_FILES) {
    await ensureFile(file);
  }

  const manifest = await readManifest();
  const background = await readFile(join(SOURCE_DIR, "background.js"), "utf8");
  const permissions = new Set(manifest.permissions ?? []);
  const hostPermissions = manifest.host_permissions ?? [];
  const csp = manifest.content_security_policy?.extension_pages ?? "";

  if (manifest.manifest_version !== 3) {
    fail("Firefox extension check failed. manifest_version must be 3.");
  }
  if (!manifest.name?.trim()) {
    fail("Firefox extension check failed. manifest name is required.");
  }
  getExtensionVersion(manifest);
  if (manifest.background?.service_worker) {
    fail("Firefox extension check failed. background.service_worker must not be used for this target.");
  }
  if (manifest.background?.scripts?.length !== 1 || manifest.background.scripts[0] !== "background.js") {
    fail("Firefox extension check failed. background.scripts must contain background.js.");
  }
  for (const permission of ["alarms", "storage", "tabs"]) {
    if (!permissions.has(permission)) {
      fail(`Firefox extension check failed. Missing permission: ${permission}.`);
    }
  }
  if (permissions.has("favicon")) {
    fail("Firefox extension check failed. Firefox target must not request Chromium-only favicon permission.");
  }
  if (!hostPermissions.includes("http://127.0.0.1/*") || !hostPermissions.includes("http://localhost/*")) {
    fail("Firefox extension check failed. Host permissions must stay limited to local Patina addresses.");
  }
  if (!csp.includes("http://127.0.0.1:*") || !csp.includes("http://localhost:*")) {
    fail("Firefox extension check failed. CSP must allow local HTTP bridge addresses.");
  }
  const cspWithoutLocalHttp = csp
    .replaceAll("http://127.0.0.1:*", "")
    .replaceAll("http://localhost:*", "");
  if (
    cspWithoutLocalHttp.includes("http:")
    || cspWithoutLocalHttp.includes("https:")
    || cspWithoutLocalHttp.includes("ws:")
    || cspWithoutLocalHttp.includes("wss:")
  ) {
    fail("Firefox extension check failed. CSP must not allow remote fetches.");
  }
  if (background.includes("/_favicon/") || background.includes("chromeCachedFaviconUrl")) {
    fail("Firefox extension check failed. Background script must not use Chromium-only favicon cache logic.");
  }
  if (!background.includes("/web-activity")) {
    fail("Firefox extension check failed. Background script must post to /web-activity.");
  }
  if (!background.includes("incognito: tab.incognito")) {
    fail("Firefox extension check failed. Background script must include incognito state.");
  }
  if (background.includes("chrome.")) {
    fail("Firefox extension check failed. Use browser.* APIs for this target.");
  }
  for (const [size, iconFile] of Object.entries(REQUIRED_ICON_FILES)) {
    if (manifest.icons?.[size] !== iconFile) {
      fail(`Firefox extension check failed. Missing extension icon ${size}: ${iconFile}.`);
    }
    if (manifest.action?.default_icon?.[size] !== iconFile) {
      fail(`Firefox extension check failed. Missing action icon ${size}: ${iconFile}.`);
    }
  }
  if (manifest.options_page !== "options.html") {
    fail("Firefox extension check failed. options_page must be options.html.");
  }
  if (manifest.action?.default_popup !== "popup.html") {
    fail("Firefox extension check failed. action.default_popup must be popup.html.");
  }
  if (manifest.browser_specific_settings?.gecko?.id !== "web-sync@patina.local") {
    fail("Firefox extension check failed. browser_specific_settings.gecko.id must stay stable.");
  }

  console.log("Firefox extension check passed.");
}

async function buildExtension() {
  await checkExtension();
  await rm(BUILD_DIR, { force: true, recursive: true });
  await mkdir(BUILD_DIR, { recursive: true });
  for (const file of EXTENSION_FILES) {
    const outputFile = join(BUILD_DIR, file);
    await mkdir(dirname(outputFile), { recursive: true });
    await cp(join(SOURCE_DIR, file), outputFile);
  }
  console.log(`Firefox extension unpacked build written to ${relative(REPO_ROOT, BUILD_DIR)}.`);
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, nextPrefix));
      continue;
    }
    if (entry.isFile()) {
      files.push(nextPrefix);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function writeLocalHeader(name: Buffer, data: Buffer, crc: number) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name, data]);
}

function writeCentralHeader(name: Buffer, data: Buffer, crc: number, offset: number) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

function writeEndRecord(fileCount: number, centralSize: number, centralOffset: number) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(fileCount, 8);
  record.writeUInt16LE(fileCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

type ZipEntry = {
  sourcePath: string;
  archivePath: string;
};

async function createZipFromEntries(entries: ZipEntry[], outputFile: string) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.archivePath, "utf8");
    const data = await readFile(entry.sourcePath);
    const crc = crc32(data);
    const localHeader = writeLocalHeader(name, data, crc);
    localParts.push(localHeader);
    centralParts.push(writeCentralHeader(name, data, crc, offset));
    offset += localHeader.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = writeEndRecord(entries.length, centralDirectory.length, offset);
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, Buffer.concat([...localParts, centralDirectory, endRecord]));
}

async function packageExtension() {
  await buildExtension();
  const manifest = await readManifest();
  const version = getExtensionVersion(manifest);
  const packageFile = getPackageFile(version);
  const packageRootName = getPackageRootName(version);
  const extensionFiles = await listFiles(BUILD_DIR);
  const zipEntries: ZipEntry[] = [
    ...extensionFiles.map((file) => ({
      sourcePath: join(BUILD_DIR, file),
      archivePath: `${packageRootName}/${file}`,
    })),
  ];
  await cleanExistingUnsignedPackages();
  await createZipFromEntries(zipEntries, packageFile);
  console.log(`Unsigned Firefox extension package written to ${relative(REPO_ROOT, packageFile)}.`);
}

function requireSigningEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`Firefox extension signing failed. Missing ${name}. Create Mozilla AMO API credentials and expose them to web-ext.`);
  }
  return value;
}

function getWebExtEntrypoint() {
  return join(REPO_ROOT, "node_modules", "web-ext", "bin", "web-ext.js");
}

async function runWebExtSign() {
  requireSigningEnv("WEB_EXT_API_KEY");
  requireSigningEnv("WEB_EXT_API_SECRET");

  const webExtEntrypoint = getWebExtEntrypoint();
  const args = [
    webExtEntrypoint,
    "sign",
    "--source-dir",
    BUILD_DIR,
    "--artifacts-dir",
    SIGNED_ARTIFACTS_DIR,
    "--channel",
    "unlisted",
    "--no-input",
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`web-ext sign exited with code ${code ?? "unknown"}.`));
    });
  }).catch((error) => {
    fail(`Firefox extension signing failed. ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function signExtension() {
  await buildExtension();
  const manifest = await readManifest();
  const version = getExtensionVersion(manifest);
  const signedPackageFile = getSignedPackageFile(version);

  await cleanExistingSignedPackages();
  await mkdir(SIGNED_ARTIFACTS_DIR, { recursive: true });
  await runWebExtSign();

  const signedArtifacts = (await listFiles(SIGNED_ARTIFACTS_DIR))
    .filter((file) => file.toLowerCase().endsWith(".xpi"));
  if (signedArtifacts.length !== 1) {
    fail(`Firefox extension signing failed. Expected exactly one signed .xpi under ${relative(REPO_ROOT, SIGNED_ARTIFACTS_DIR)}.`);
  }

  await cp(join(SIGNED_ARTIFACTS_DIR, signedArtifacts[0]), signedPackageFile);
  console.log(`Signed Firefox extension package written to ${relative(REPO_ROOT, signedPackageFile)}.`);
}

const command = process.argv[2] ?? "check";

if (command === "check") {
  await checkExtension();
} else if (command === "build") {
  await buildExtension();
} else if (command === "package") {
  await packageExtension();
} else if (command === "sign") {
  await signExtension();
} else {
  fail(`Unknown Firefox extension command: ${command}`);
}
