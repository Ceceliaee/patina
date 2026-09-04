import assert from "node:assert/strict";
import { runNpmAudit } from "../scripts/npm-audit.ts";

const failure = (report: unknown) => ({ status: 1, stdout: JSON.stringify(report), stderr: "" });
const timeout = failure({ message: "network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk" });
const success = { status: 0, stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 0 } } }), stderr: "" };

async function scenario(results: Array<typeof success>, expectedStatus: number, expectedCalls: number, offline = false) {
  let calls = 0;
  let pauses = 0;
  const status = await runNpmAudit("npm-cli.js", {
    offline,
    execute: (args) => {
      assert.ok(args.includes("--audit-level=low"));
      assert.ok(args.includes("--fetch-timeout=120000"));
      assert.equal(args.includes("--offline"), offline);
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
await scenario([failure({ statusCode: 503 }), success], 0, 2);
await scenario([failure({ statusCode: 429 }), success], 0, 2);
await scenario([failure({ statusCode: 401 })], 1, 1);
await scenario([failure({ statusCode: 400 })], 1, 1);
await scenario([failure({ vulnerabilities: { example: { severity: "low" } }, message: "ECONNRESET" })], 1, 1);
await scenario([{ status: 1, stdout: "invalid report", stderr: "" }], 1, 1);
await scenario([timeout], 1, 1, true);
await assert.rejects(runNpmAudit("npm-cli.js", {
  execute: () => ({ status: null, stdout: "", stderr: "", error: new Error("process timed out") }),
}), /process timed out/);
console.log("PASS npm audit: bounded network retries, vulnerability failures, invalid reports and offline behavior");
