import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareNativeAssets, verifyNativeAssets, validateNativeVersionFiles, syncNativeVersionText, nativeMirrorManifest, validateMirrorAdvance } from "../scripts/native-release.ts";
import { WINDOWS_RELEASE_TARGETS, buildReleaseInstallerName } from "../scripts/release.ts";

const version = "0.2.0";
const repository = "example/patina";
const tag = `v${version}`;
const fixture = JSON.parse(await readFile("desktop/updater/tests/fixtures/signed.json", "utf8"));
const root = await mkdtemp(path.join(os.tmpdir(), "patina-release-test-"));
const input = path.join(root, "inputs");
const output = path.join(root, "output");
const payload = Buffer.from(fixture.payload, "base64");
const verify = () => verifyNativeAssets(version, input, output, repository, tag, fixture.public_key);
try {
  const manifest = `[package]\nname = "patina-gpui"\nversion = "${version}"\n\n[dependencies]\n`;
  const lock = `[[package]]\nname = "patina-gpui"\nversion = "${version}"\n`;
  validateNativeVersionFiles(version, manifest, lock);
  assert.throws(() => validateNativeVersionFiles("0.3.0", manifest, lock), /version differs/);
  assert.throws(() => validateNativeVersionFiles(version, manifest, lock + lock), /version differs/);
  assert.throws(() => validateNativeVersionFiles("../0.2.0", manifest, lock), /Invalid release version/);
  for (const newline of ["\n", "\r\n"]) {
    const dependency = '[[package]]\nname = "other"\nversion = "9.8.7"\n'.replaceAll("\n", newline);
    const next = syncNativeVersionText("1.2.3-beta.1", manifest.replaceAll("\n", newline), lock.replaceAll("\n", newline) + dependency);
    validateNativeVersionFiles("1.2.3-beta.1", next.manifest, next.lock);
    assert.ok(next.lock.endsWith(dependency));
    assert.ok(next.manifest.includes("[dependencies]"));
  }
  for (const { arch, platform, machine } of WINDOWS_RELEASE_TARGETS) {
    const dir = path.join(input, arch);
    await mkdir(dir, { recursive: true });
    const pe = Buffer.alloc(128);
    pe.write("MZ");
    pe.writeUInt32LE(64, 0x3c);
    pe.writeUInt32LE(0x4550, 64);
    pe.writeUInt16LE(machine, 68);
    await writeFile(path.join(dir, "patina-gpui.exe"), pe);
    const name = buildReleaseInstallerName(version, platform);
    await writeFile(path.join(dir, name), payload);
    await writeFile(path.join(dir, "gpui-latest.json"), JSON.stringify({
      schema: 1, application: "patina-gpui", version, platforms: { [platform]: {
        url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
        size: payload.length,
        signature: arch === "x64" ? fixture.signature : fixture.signature_arm64,
      } },
    }));
  }
  await prepareNativeAssets(version, input, output, repository, tag, fixture.public_key, "Release notes");
  await verify();
  await assert.rejects(() => prepareNativeAssets(version, input, output, repository, tag, fixture.public_key, ""), /EEXIST/);

  const manifestPath = path.join(output, "gpui-latest.json");
  const original = await readFile(manifestPath, "utf8");
  const release = JSON.parse(original);
  const mirror = nativeMirrorManifest(release, repository, "https://mirror.example.org/");
  for (const { platform } of WINDOWS_RELEASE_TARGETS) {
    assert.deepEqual(mirror.platforms[platform], {
      ...release.platforms[platform],
      url: `https://mirror.example.org/desktop/releases/v${version}/${buildReleaseInstallerName(version, platform)}`,
    });
  }
  assert.throws(() => nativeMirrorManifest(release, repository, "http://mirror.example.org/"), /https/i);
  assert.throws(() => nativeMirrorManifest(release, "other/repository", "https://mirror.example.org/"), /invalid GitHub manifest/);
  validateMirrorAdvance(mirror, structuredClone(mirror));
  validateMirrorAdvance({ ...mirror, version: "0.10.0" }, mirror);
  assert.throws(() => validateMirrorAdvance(mirror, { ...mirror, version: "0.10.0" }), /newer mirror version/);
  assert.throws(() => validateMirrorAdvance({ ...mirror, notes: "Changed immutable version" }, mirror), /same mirror version/);
  assert.throws(() => validateMirrorAdvance({ ...mirror, version: "0.3.0-beta.1" }, mirror), /stable native manifests/);
  assert.throws(() => validateMirrorAdvance({ ...mirror, application: "other" }, mirror), /stable native manifests/);
  for (const mutate of [
    value => { delete value.platforms["windows-aarch64"]; },
    value => { value.application = "tauri"; },
    value => { value.version = "9.0.0"; },
    value => { value.platforms["windows-x86_64"].url = "https://example.org/setup.exe"; },
    value => { value.platforms["windows-x86_64"].size += 1; },
    value => { value.platforms["windows-x86_64"].signature = fixture.signature_arm64; },
  ]) {
    const value = JSON.parse(original);
    mutate(value);
    await writeFile(manifestPath, JSON.stringify(value));
    await assert.rejects(verify);
  }
  await writeFile(manifestPath, original);
  const finalInstaller = path.join(output, buildReleaseInstallerName(version));
  const changed = Buffer.from(payload);
  changed[0] ^= 1;
  await writeFile(finalInstaller, changed);
  await assert.rejects(verify, /signature verification failed/);
  await writeFile(finalInstaller, payload);
  const sumsPath = path.join(output, "SHA256SUMS.txt");
  const sums = await readFile(sumsPath);
  await writeFile(sumsPath, "");
  await assert.rejects(verify, /checksums/);
  await writeFile(sumsPath, sums);
  await writeFile(path.join(output, "private-key.txt"), "unexpected attachment");
  await assert.rejects(verify, /Unexpected public release asset/);
  await rm(path.join(output, "private-key.txt"));
  const armPe = path.join(input, "arm64", "patina-gpui.exe");
  await writeFile(armPe, await readFile(path.join(input, "x64", "patina-gpui.exe")));
  await assert.rejects(verify, /PE architecture/);
  console.log("Passed native release asset tests");
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("patina-release-test-"));
  await rm(root, { recursive: true, force: true });
}
