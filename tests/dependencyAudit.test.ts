import assert from "node:assert/strict";
import { runPnpmAudit } from "../scripts/pnpm-audit.ts";
import { collectRustAuditFindings } from "../scripts/rust-audit-report.ts";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolchainErrors } from "../scripts/check-toolchain.ts";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const cleanRustReport = { vulnerabilities: { list: [] }, warnings: {} };
const crateLock = (name: string, version: string) => `[[package]]\nname = "${name}"\nversion = "${version}"\n`;
for (const version of ["2.0.0", "2.10.3", "2.11.0"]) {
  assert.equal(collectRustAuditFindings(cleanRustReport, crateLock("tauri", version))[0]?.advisory?.id, "GHSA-7gmj-67g7-phm9");
}
for (const version of ["2.11.1", "2.11.5", "2.12.0"]) {
  assert.deepEqual(collectRustAuditFindings(cleanRustReport, crateLock("tauri", version)), []);
}
assert.equal(collectRustAuditFindings(cleanRustReport, crateLock("thrift", "0.17.0")).length, 1);
assert.equal(collectRustAuditFindings(cleanRustReport, crateLock("thrift", "0.22.0")).length, 1);
assert.deepEqual(collectRustAuditFindings(cleanRustReport, crateLock("thrift", "0.23.0")), []);
const unsound = { advisory: { id: "RUSTSEC-example" }, package: { name: "example", version: "1.0.0" } };
assert.deepEqual(collectRustAuditFindings({ ...cleanRustReport, warnings: { unsound: [unsound] } }, ""), [unsound]);
assert.deepEqual(collectRustAuditFindings({ vulnerabilities: { list: [unsound] }, warnings: {} }, ""), [unsound]);
assert.throws(() => collectRustAuditFindings({}, ""), /Incomplete/);
assert.throws(() => collectRustAuditFindings(cleanRustReport, crateLock("tauri", "2.11.1-rc.1")), /Unsupported/);
console.log("PASS Rust audit: GitHub-only version ranges, unsound findings and incomplete reports");

const failure = (report: unknown) => ({ status: 1, stdout: JSON.stringify(report), stderr: "" });
const registryFailure = (status: number) => ({ status: 1, stdout: "", stderr:
  `Error: ERR_PNPM_AUDIT_BAD_RESPONSE\n\n  × The audit endpoint (at http://127.0.0.1:1234/-/npm/v1/security/\n  │ advisories/bulk) responded with ${status}: {"error":"controlled failure"}\n` });
const timeout = { status: 1, stdout: "", stderr: "Error: ERR_PNPM_AUDIT_BAD_RESPONSE\n\n  × Failed to request the audit endpoint (at http://127.0.0.1:1234/): error sending request for url\n  ╰─▶ operation timed out\n" };
const success = { status: 0, stdout: JSON.stringify({ advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } }), stderr: "" };
const fixture = mkdtempSync(path.join(os.tmpdir(), "patina-pnpm-audit-"));
const snapshotPath = path.join(fixture, "audit.json");
const lockfilePath = path.join(fixture, "pnpm-lock.yaml");
writeFileSync(lockfilePath, "lock baseline");
const executable = path.resolve("pnpm.exe");
try {

async function scenario(results: Array<typeof success>, expectedStatus: number, expectedCalls: number, offline = false) {
  let calls = 0;
  let pauses = 0;
  const status = await runPnpmAudit(executable, {
    offline,
    snapshotPath,
    lockfilePath,
    execute: (args) => {
      assert.ok(args.includes("--audit-level=low"));
      assert.deepEqual(args, ["audit", "--audit-level=low", "--json"]);
      return results[Math.min(calls++, results.length - 1)];
    },
    pause: async (ms) => { assert.equal(ms, 2_000); pauses++; },
    report: () => {},
  });
  assert.equal(status, expectedStatus);
  assert.equal(calls, expectedCalls);
  assert.equal(pauses, expectedCalls - 1);
}

await scenario([success], 0, 1);
await scenario([timeout, success], 0, 2);
await scenario([timeout], 1, 3);
await scenario([registryFailure(503), success], 0, 2);
await scenario([registryFailure(429), success], 0, 2);
await scenario([registryFailure(401)], 1, 1);
await scenario([registryFailure(400)], 1, 1);
await scenario([{ ...timeout, stderr: timeout.stderr.replace("operation timed out", "远程主机强迫关闭了一个现有的连接。 (os error 10054)") }, success], 0, 2);
await scenario([{ ...timeout, stderr: timeout.stderr.replace("operation timed out", "invalid peer certificate: UnknownIssuer") }], 1, 1);
await scenario([{ ...registryFailure(401), stderr: registryFailure(401).stderr + "ECONNRESET" }], 1, 1);
for (const registryStatus of [503, 401]) {
  const server = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    let requests = 0;
    require('node:http').createServer((request, response) => {
      request.resume();
      request.on('end', () => {
        response.writeHead(requests++ === 0 ? workerData : 200, { 'Content-Type': 'application/json' });
        response.end('{}');
      });
    }).listen(0, '127.0.0.1', function () { parentPort.postMessage(this.address().port); });
  `, { eval: true, workerData: registryStatus });
  const originalDirectory = process.cwd();
  const noProxy = process.env.NO_PROXY;
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Audit fixture server did not start")), 10_000);
      server.once("message", (port: number) => { clearTimeout(timeout); resolve(port); });
      server.once("error", (error) => { clearTimeout(timeout); reject(error); });
    });
    const registryDirectory = path.join(fixture, `registry-${registryStatus}`);
    mkdirSync(registryDirectory);
    for (const name of ["package.json", "pnpm-lock.yaml"]) copyFileSync(name, path.join(registryDirectory, name));
    writeFileSync(path.join(registryDirectory, "pnpm-workspace.yaml"), JSON.stringify({
      packages: ["."], registry: `http://127.0.0.1:${port}`, fetchRetries: 0, fetchTimeout: 1000,
    }));
    process.chdir(registryDirectory);
    process.env.NO_PROXY = "127.0.0.1,localhost,::1";
    let retries = 0;
    const status = await runPnpmAudit(process.env.npm_execpath!, {
      snapshotPath, lockfilePath: path.resolve("pnpm-lock.yaml"), report: () => {},
      pause: async () => { retries++; },
    });
    assert.equal(status, registryStatus === 503 ? 0 : 1, `real pnpm audit against HTTP ${registryStatus}`);
    assert.equal(retries, registryStatus === 503 ? 1 : 0);
  } finally {
    process.chdir(originalDirectory);
    if (noProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = noProxy;
    await server.terminate();
  }
}
await scenario([failure({ vulnerabilities: { example: { severity: "low" } }, message: "ECONNRESET" })], 1, 1);
await scenario([{ status: 1, stdout: "invalid report", stderr: "" }], 1, 1);
await assert.rejects(runPnpmAudit(executable, { snapshotPath, lockfilePath, report: () => {}, execute: () => ({ ...success, stdout: "{}" }) }), /incomplete/);
await assert.rejects(runPnpmAudit(executable, { snapshotPath, lockfilePath, report: () => {}, execute: () => ({ ...success, stdout: "invalid" }) }), SyntaxError);
await assert.rejects(runPnpmAudit(executable, {
  snapshotPath, lockfilePath,
  execute: () => ({ status: null, stdout: "", stderr: "", error: new Error("process timed out") }),
}), /process timed out/);
await scenario([success], 0, 1);
assert.equal(await runPnpmAudit(executable, { offline: true, snapshotPath, lockfilePath, execute: () => { throw new Error("network must not run"); } }), 0);
await scenario([failure({ advisories: { example: { severity: "low" } } })], 1, 1);
await assert.rejects(runPnpmAudit(executable, { offline: true, snapshotPath, lockfilePath }), /ENOENT/);
await assert.rejects(runPnpmAudit(executable, {
  snapshotPath, lockfilePath, report: () => {}, execute: () => { writeFileSync(lockfilePath, "changed during audit"); return success; },
}), /changed during pnpm audit/);
await scenario([success], 0, 1);
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
await assert.rejects(runPnpmAudit(executable, { offline: true, snapshotPath, lockfilePath, now: () => snapshot.createdAt + 86_400_001 }), /last 24 hours/);
writeFileSync(lockfilePath, "changed lock");
await assert.rejects(runPnpmAudit(executable, { offline: true, snapshotPath, lockfilePath }), /last 24 hours/);
await assert.rejects(runPnpmAudit(executable, { offline: true, snapshotPath: path.join(fixture, "missing.json"), lockfilePath }), /ENOENT/);
await assert.rejects(runPnpmAudit(path.resolve("pnpm.cmd")), /native pnpm/);
const manifest = { engines: { node: "24.18.0", pnpm: "12.3.4" }, packageManager: "pnpm@12.3.4" };
assert.deepEqual(toolchainErrors("24.18.0", manifest, "24.18.0", "pnpm/12.3.4 npm/? node/v24.18.0"), []);
assert.ok(toolchainErrors("24.18.0", manifest, "22.0.0", "pnpm/12.3.4").length);
assert.ok(toolchainErrors("24.18.0", manifest, "24.18.0", "npm/11.16.0").length);
assert.ok(toolchainErrors("24.18.0", { ...manifest, packageManager: "pnpm@11.0.0" }, "24.18.0", "pnpm/12.3.4").length);
const gate = fileURLToPath(new URL("../scripts/check-toolchain.ts", import.meta.url));
const currentManifest = { ...manifest, engines: { ...manifest.engines, node: process.versions.node } };
writeFileSync(path.join(fixture, "package.json"), JSON.stringify(currentManifest));
writeFileSync(path.join(fixture, ".node-version"), process.versions.node);
const runGate = (userAgent: string) => spawnSync(process.execPath, [gate], {
  cwd: fixture, encoding: "utf8", env: { ...process.env, npm_config_user_agent: userAgent },
});
assert.equal(runGate("pnpm/12.3.4").status, 0);
assert.notEqual(runGate("npm/11.16.0").status, 0);
rmSync(lockfilePath);
assert.match(runGate("pnpm/12.3.4").stderr, /pnpm-lock.yaml is required/);
console.log("PASS pnpm audit and toolchain: failures, bounded retries and lock-bound offline snapshot");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
