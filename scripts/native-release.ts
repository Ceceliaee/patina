import { constants } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WINDOWS_RELEASE_TARGETS, buildReleaseInstallerName, buildMirrorManifest, parseChangelog,
  renderSha256Sums, renderUpdaterNotes, sha256File, verifyPeArchitecture, verifyUpdaterSignature,
} from "./release.ts";

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9A-Za-z-][0-9A-Za-z-]*))*))?$/;
const MANIFEST = "gpui-latest.json";
const APPLICATION = "patina-gpui";
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const writeJson = (file: string, value: unknown) => {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text) > 1024 ** 2) throw new Error("Update manifest exceeds 1 MiB");
  return writeFile(file, text, { flag: "wx" });
};

export function assertNativeVersion(version: string) {
  if (!VERSION.test(version ?? "")) throw new Error("Invalid release version");
}

export function validateNativeVersionFiles(version: string, manifest: string, lock: string) {
  assertNativeVersion(version);
  const packageSection = manifest.match(/^\[package\]\s*\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
  if (!packageSection?.match(/^name\s*=\s*"patina-gpui"\s*$/m)
      || packageSection.match(/^version\s*=\s*"([^"]+)"/m)?.[1] !== version) {
    throw new Error("desktop/patina/Cargo.toml version differs from the release tag");
  }
  const packages = lock.split(/^\[\[package\]\]\s*$/m)
    .filter(section => /^name\s*=\s*"patina-gpui"\s*$/m.test(section));
  if (packages.length !== 1 || packages[0].match(/^version\s*=\s*"([^"]+)"/m)?.[1] !== version) {
    throw new Error("desktop/Cargo.lock version differs from the release tag");
  }
}

export function syncNativeVersionText(version: string, manifest: string, lock: string) {
  assertNativeVersion(version);
  const current = manifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "";
  validateNativeVersionFiles(current, manifest, lock);
  const nextManifest = manifest.replace(/(^\[package\]\s*\n[\s\S]*?^version\s*=\s*")[^"]+(".*$)/m, `$1${version}$2`);
  const nextLock = lock.replace(/(^\[\[package\]\]\s*\nname = "patina-gpui"\s*\nversion = ")[^"]+(")/m, `$1${version}$2`);
  validateNativeVersionFiles(version, nextManifest, nextLock);
  return { manifest: nextManifest, lock: nextLock };
}

function assetBase(repository: string, tag: string) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w.-]+$/.test(tag)) {
    throw new Error("Invalid release repository or tag");
  }
  return `https://github.com/${repository}/releases/download/${tag}`;
}

export async function verifyNativeInstaller(file: string, entry, version: string, platform: string, publicKey: string) {
  const lines = Buffer.from(entry.signature ?? "", "base64").toString("utf8").trim().split(/\r?\n/);
  if (lines[2] !== `trusted comment: ${APPLICATION} ${version} ${platform}`) {
    throw new Error("Installer signature identity differs from release version or architecture");
  }
  const size = (await stat(file)).size;
  if (!Number.isSafeInteger(entry.size) || entry.size !== size || size <= 0 || size > 1024 ** 3) {
    throw new Error("Installer size differs from manifest");
  }
  await verifyUpdaterSignature(file, entry.signature, publicKey);
}

async function readInputs(version: string, input: string, repository: string, tag: string, publicKey: string) {
  assertNativeVersion(version);
  if (tag !== `v${version}`) throw new Error("Release tag differs from version");
  const base = assetBase(repository, tag);
  return Promise.all(WINDOWS_RELEASE_TARGETS.map(async ({ arch, platform }) => {
    const dir = path.join(input, arch);
    const manifest = await json(path.join(dir, MANIFEST));
    if (manifest.schema !== 1 || manifest.application !== APPLICATION || manifest.version !== version
        || JSON.stringify(Object.keys(manifest.platforms ?? {})) !== JSON.stringify([platform])) {
      throw new Error(`Invalid build manifest for ${arch}`);
    }
    const name = buildReleaseInstallerName(version, platform);
    const entry = manifest.platforms[platform];
    if (entry.url !== `${base}/${name}`) throw new Error(`Invalid installer URL for ${arch}`);
    const source = path.join(dir, name);
    await verifyNativeInstaller(source, entry, version, platform, publicKey);
    verifyPeArchitecture(await readFile(path.join(dir, "patina-gpui.exe")), platform);
    return { name, source, entry, platform };
  }));
}

export function nativeMirrorManifest(manifest, repository: string, baseUrl: string) {
  if (manifest.schema !== 1 || manifest.application !== APPLICATION) throw new Error("Invalid native mirror manifest");
  const result = buildMirrorManifest(manifest, repository, baseUrl);
  const base = new URL(baseUrl).href.replace(/\/$/, "");
  for (const { platform } of WINDOWS_RELEASE_TARGETS) {
    result.platforms[platform].url = `${base}/desktop/releases/v${result.version}/${buildReleaseInstallerName(result.version, platform)}`;
  }
  return result;
}

export function validateMirrorAdvance(next, current) {
  for (const manifest of [next, current]) {
    assertNativeVersion(manifest.version);
    if (manifest.schema !== 1 || manifest.application !== APPLICATION || manifest.version.includes("-")) {
      throw new Error("Mirror requires stable native manifests");
    }
  }
  const a = next.version.split(".").map(BigInt);
  const b = current.version.split(".").map(BigInt);
  const part = a.findIndex((value, index) => value !== b[index]);
  if (part !== -1 && a[part] < b[part]) throw new Error("Cannot replace a newer mirror version");
  if (part === -1 && JSON.stringify(next) !== JSON.stringify(current)) {
    throw new Error("Cannot replace different assets for the same mirror version");
  }
}

export async function prepareNativeAssets(version: string, input: string, output: string, repository: string, tag: string, publicKey: string, notes: string) {
  const inputs = await readInputs(version, input, repository, tag, publicKey);
  await mkdir(output, { recursive: true });
  const manifest = { schema: 1, application: APPLICATION, version, notes, platforms: {} };
  const sums: string[] = [];
  for (const item of inputs) {
    const destination = path.join(output, item.name);
    await copyFile(item.source, destination, constants.COPYFILE_EXCL);
    const hash = await sha256File(destination);
    if (hash !== await sha256File(item.source)) throw new Error("Copied installer differs from build input");
    sums.push(renderSha256Sums(hash, item.name));
    manifest.platforms[item.platform] = item.entry;
  }
  await writeFile(path.join(output, "SHA256SUMS.txt"), sums.join(""), { flag: "wx" });
  await writeJson(path.join(output, MANIFEST), manifest);
}

export async function verifyNativeAssets(version: string, input: string, output: string, repository: string, tag: string, publicKey: string) {
  const inputs = await readInputs(version, input, repository, tag, publicKey);
  const manifest = await json(path.join(output, MANIFEST));
  if (manifest.schema !== 1 || manifest.application !== APPLICATION || manifest.version !== version
      || JSON.stringify(Object.keys(manifest.platforms ?? {}).sort()) !== JSON.stringify(inputs.map(x => x.platform).sort())) {
    throw new Error("Invalid published manifest");
  }
  const sums: string[] = [];
  for (const item of inputs) {
    const destination = path.join(output, item.name);
    const entry = manifest.platforms[item.platform];
    if (entry.url !== item.entry.url || entry.signature !== item.entry.signature || entry.size !== item.entry.size) {
      throw new Error("Published manifest differs from signed build input");
    }
    await verifyNativeInstaller(destination, entry, version, item.platform, publicKey);
    const hash = await sha256File(destination);
    if (hash !== await sha256File(item.source)) throw new Error("Published installer differs from build input");
    sums.push(renderSha256Sums(hash, item.name));
  }
  if (await readFile(path.join(output, "SHA256SUMS.txt"), "utf8") !== sums.join("")) {
    throw new Error("Published checksums differ from installers");
  }
  const files = await readdir(output);
  const allowed = new Set([...inputs.map(x => x.name), MANIFEST, "SHA256SUMS.txt", "release-notes.md"]);
  if (files.some(file => !allowed.has(file))) throw new Error("Unexpected public release asset");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const [version, input, output, repository, tag] = args;
  switch (command) {
    case "validate-version":
      validateNativeVersionFiles(version, await readFile("desktop/patina/Cargo.toml", "utf8"), await readFile("desktop/Cargo.lock", "utf8"));
      break;
    case "prepare":
      await prepareNativeAssets(version, input, output, repository, tag, (await json("desktop/updater/config.json")).public_key, renderUpdaterNotes(await parseChangelog(version)));
      break;
    case "verify":
      await verifyNativeAssets(version, input, output, repository, tag, (await json("desktop/updater/config.json")).public_key);
      break;
    case "mirror": {
      const [manifest, repo, baseUrl, destination] = args;
      await writeJson(destination, nativeMirrorManifest(await json(manifest), repo, baseUrl));
      break;
    }
    case "mirror-advance":
      validateMirrorAdvance(await json(args[0]), await json(args[1]));
      break;
    default: throw new Error("Expected validate-version, prepare, verify, mirror or mirror-advance");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
