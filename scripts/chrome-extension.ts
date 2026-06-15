import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_DIR = join(REPO_ROOT, "extensions", "chrome");
const BUILD_DIR = join(REPO_ROOT, "dist", "extensions", "chrome", "unpacked");
const PACKAGE_FILE = join(REPO_ROOT, "dist", "extensions", "chrome", "patina-chrome-extension.zip");
const REQUIRED_ICON_FILES = {
  "32": "icons/icon-32.png",
  "64": "icons/icon-64.png",
  "128": "icons/icon-128.png",
} as const;
const REQUIRED_FILES = [
  "manifest.json",
  "background.js",
  "options.html",
  "options.js",
  "popup.html",
  "popup.js",
  "README.md",
  ...Object.values(REQUIRED_ICON_FILES),
] as const;

type ChromeManifest = {
  manifest_version?: number;
  name?: string;
  background?: {
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
    fail("Chrome extension check failed. Missing extensions/chrome/manifest.json.");
  }

  try {
    return JSON.parse(raw) as ChromeManifest;
  } catch (error) {
    fail(`Chrome extension check failed. manifest.json is invalid JSON: ${String(error)}`);
  }
}

async function ensureFile(relativePath: string) {
  const filePath = join(SOURCE_DIR, relativePath);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      fail(`Chrome extension check failed. Expected file: ${relativePath}`);
    }
  } catch {
    fail(`Chrome extension check failed. Missing file: ${relativePath}`);
  }
}

async function checkExtension() {
  for (const file of REQUIRED_FILES) {
    await ensureFile(file);
  }

  const manifest = await readManifest();
  const background = await readFile(join(SOURCE_DIR, "background.js"), "utf8");
  const permissions = new Set(manifest.permissions ?? []);
  const hostPermissions = manifest.host_permissions ?? [];
  const csp = manifest.content_security_policy?.extension_pages ?? "";

  if (manifest.manifest_version !== 3) {
    fail("Chrome extension check failed. manifest_version must be 3.");
  }
  if (!manifest.name?.trim()) {
    fail("Chrome extension check failed. manifest name is required.");
  }
  if (manifest.background?.service_worker !== "background.js") {
    fail("Chrome extension check failed. background.service_worker must be background.js.");
  }
  for (const permission of ["alarms", "favicon", "storage", "tabs"]) {
    if (!permissions.has(permission)) {
      fail(`Chrome extension check failed. Missing permission: ${permission}.`);
    }
  }
  if (!hostPermissions.includes("http://127.0.0.1/*") || !hostPermissions.includes("http://localhost/*")) {
    fail("Chrome extension check failed. Host permissions must stay limited to local Patina addresses.");
  }
  if (!csp.includes("http://127.0.0.1:*") || !csp.includes("http://localhost:*")) {
    fail("Chrome extension check failed. CSP must allow local HTTP bridge addresses.");
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
    fail("Chrome extension check failed. CSP must not allow remote fetches; favicons should come from Chrome's local favicon cache.");
  }
  if (!background.includes("/_favicon/") || !background.includes("chromeCachedFaviconUrl")) {
    fail("Chrome extension check failed. Background worker must use Chrome's local favicon cache.");
  }
  for (const [size, iconFile] of Object.entries(REQUIRED_ICON_FILES)) {
    if (manifest.icons?.[size] !== iconFile) {
      fail(`Chrome extension check failed. Missing extension icon ${size}: ${iconFile}.`);
    }
    if (manifest.action?.default_icon?.[size] !== iconFile) {
      fail(`Chrome extension check failed. Missing action icon ${size}: ${iconFile}.`);
    }
  }
  if (manifest.options_page !== "options.html") {
    fail("Chrome extension check failed. options_page must be options.html.");
  }
  if (manifest.action?.default_popup !== "popup.html") {
    fail("Chrome extension check failed. action.default_popup must be popup.html.");
  }

  console.log("Chrome extension check passed.");
}

async function buildExtension() {
  await checkExtension();
  await rm(BUILD_DIR, { force: true, recursive: true });
  await mkdir(BUILD_DIR, { recursive: true });
  for (const file of REQUIRED_FILES) {
    const outputFile = join(BUILD_DIR, file);
    await mkdir(dirname(outputFile), { recursive: true });
    await cp(join(SOURCE_DIR, file), outputFile);
  }
  console.log(`Chrome extension unpacked build written to ${relative(REPO_ROOT, BUILD_DIR)}.`);
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

async function createZipFromDirectory(sourceDir: string, outputFile: string) {
  const files = await listFiles(sourceDir);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file, "utf8");
    const data = await readFile(join(sourceDir, file));
    const crc = crc32(data);
    const localHeader = writeLocalHeader(name, data, crc);
    localParts.push(localHeader);
    centralParts.push(writeCentralHeader(name, data, crc, offset));
    offset += localHeader.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = writeEndRecord(files.length, centralDirectory.length, offset);
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, Buffer.concat([...localParts, centralDirectory, endRecord]));
}

async function packageExtension() {
  await buildExtension();
  await rm(PACKAGE_FILE, { force: true });
  await createZipFromDirectory(BUILD_DIR, PACKAGE_FILE);
  console.log(`Chrome extension package written to ${relative(REPO_ROOT, PACKAGE_FILE)}.`);
}

const command = process.argv[2] ?? "check";

if (command === "check") {
  await checkExtension();
} else if (command === "build") {
  await buildExtension();
} else if (command === "package") {
  await packageExtension();
} else {
  fail(`Unknown chrome extension command: ${command}`);
}
