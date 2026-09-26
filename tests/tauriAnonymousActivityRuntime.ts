import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assertIsolatedTempPath } from "./uiBrowserSmoke/browserHarness.ts";

export async function verifyAnonymousActivityRuntime(
  evaluate: (expression: string) => Promise<unknown>,
  root: string,
  databasePath: string,
) {
  assertIsolatedTempPath(root, "patina-tauri-e2e-");
  const seed = spawnSync("python", ["-c", [
    "import sqlite3, sys",
    "db = sqlite3.connect(sys.argv[1])",
    "assert {r[1] for r in db.execute('PRAGMA table_info(anonymous_activity)')} == {'id','start_time','end_time','observed_until','is_web'}",
    "db.executemany('INSERT INTO anonymous_activity(id,start_time,end_time,observed_until,is_web) VALUES (?,?,?,?,?)', [('runtime-anonymous-native',1000,2000,2000,0),('runtime-anonymous-web',2000,3000,3000,1)])",
    "db.commit()",
    "db.close()",
  ].join("; "), databasePath], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  assert.equal(seed.status, 0, `anonymous activity seed failed (signal ${seed.signal}): ${seed.error?.message || seed.stderr || seed.stdout}`);
  const native = await evaluate(`window.__TAURI_INTERNALS__.invoke("cmd_get_activity_aggregate_range", {
    startMs: 0, endMs: 4000, bucketBoundariesMs: [0,4000]
  })`) as { records: Array<{ anonymous: boolean; appName: string; exeName: string; startTime: number; endTime: number }> };
  assert.ok(native.records.length > 0);
  assert.equal(native.records.reduce((sum, row) => sum + row.endTime - row.startTime, 0), 2000);
  assert.ok(native.records.every(row => row.anonymous && row.appName === "" && row.exeName === ""));
  const web = await evaluate(`window.__TAURI_INTERNALS__.invoke("cmd_get_web_activity_aggregate_range", {
    startMs: 0, endMs: 4000, bucketBoundariesMs: [0,4000], snapshotNowMs: 4000
  })`) as { records: unknown[]; anonymousRecords: Array<{ bucketStartMs: number; durationMs: number }> };
  assert.deepEqual(web.records, []);
  assert.deepEqual(web.anonymousRecords, [{ bucketStartMs: 0, durationMs: 1000 }]);
  const detail = await evaluate(`window.__TAURI_INTERNALS__.invoke("cmd_get_web_links", {
    startMs: 0, endMs: 4000, nowMs: 4000
  })`) as { anonymousActivity: Array<{ startTime: number; endTime: number; isWeb: boolean }> };
  assert.equal(detail.anonymousActivity.length, 1);
  assert.equal(detail.anonymousActivity[0].startTime, 2000);
  assert.equal(detail.anonymousActivity[0].endTime, 3000);
  assert.equal(detail.anonymousActivity[0].isWeb, true);
  await evaluate(`window.__TAURI_INTERNALS__.invoke("cmd_delete_sessions_before", { cutoffTime: 4000 })`);
  const cleared = await evaluate(`window.__TAURI_INTERNALS__.invoke("cmd_get_activity_aggregate_range", {
    startMs: 0, endMs: 4000, bucketBoundariesMs: [0,4000]
  })`) as { records: unknown[] };
  assert.deepEqual(cleared.records, []);
  console.log("PASS real Tauri anonymous facts, desktop/web conservation, detail and time cleanup");
}
