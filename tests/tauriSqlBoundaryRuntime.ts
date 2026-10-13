import assert from "node:assert/strict";
import { readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StorageSnapshot } from "../src/platform/storage/storageRuntimeGateway.ts";
import { assertIsolatedTempPath } from "./uiBrowserSmoke/browserHarness.ts";

type Evaluate = (expression: string) => Promise<unknown>;

export async function assertSqlCommandsDenied(evaluate: Evaluate) {
  const queries = [
    "SELECT key FROM settings",
    "INSERT INTO settings(key,value) VALUES('__sql_boundary_probe','one') RETURNING key",
    "UPDATE settings SET value='two' WHERE key='__sql_boundary_probe' RETURNING key",
    "DELETE FROM settings WHERE key='__sql_boundary_probe' RETURNING key",
    "CREATE TABLE __sql_boundary_probe(value TEXT)",
    "PRAGMA query_only=OFF",
    "ATTACH DATABASE ':memory:' AS boundary_probe",
    "SELECT 1; INSERT INTO settings(key,value) VALUES('__sql_boundary_probe','multi')",
  ];
  const calls = queries.map(query => ({ command: "plugin:sql|select", args: { db: "sqlite:patina.db", query, values: [] } }));
  calls.push({ command: "plugin:sql|execute", args: { db: "sqlite:patina.db", query: queries[3], values: [] } });
  for (const { command, args } of [...calls, { command: "plugin:sql|load", args: { db: "sqlite:patina.db" } }]) {
    const error = await evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})
      .then(() => null, error => String(error))`);
    assert.equal(typeof error, "string", `${command} unexpectedly succeeded: ${JSON.stringify(args)}`);
    assert.match(String(error), /not allowed|permission|denied|not found/i);
  }
}

export async function verifySqlBoundaryRuntime(evaluate: Evaluate, root: string) {
  assertIsolatedTempPath(root, "patina-tauri-e2e-");
  const storage = await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_get_storage_snapshot")') as StorageSnapshot;
  const databasePath = realpathSync(storage.paths.databasePath);
  const childPath = relative(realpathSync(root), databasePath);
  assert.ok(childPath && !childPath.startsWith("..") && !isAbsolute(childPath), "SQL boundary probe requires its isolated database");
  const db = new DatabaseSync(databasePath, { allowExtension: false });
  const read = (sql: string) => db.prepare(sql).all().map(row => ({ ...row }));
  const snapshot = () => ({
    settings: read("SELECT key,value FROM settings ORDER BY key"),
    schema: read("SELECT name,sql FROM sqlite_master ORDER BY name"),
    revision: read("SELECT * FROM read_model_revision"),
    facts: read("SELECT * FROM sessions ORDER BY id"),
    files: readdirSync(dirname(databasePath)).sort(),
  });
  let before: ReturnType<typeof snapshot>;
  let transactionStarted = false;
  try {
    db.exec("PRAGMA busy_timeout=5000");
    // Freeze legitimate tracker writes and their transient journal lifecycle.
    // Plugin calls must fail at dispatch, before attempting any database access.
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    before = snapshot();
    await assertSqlCommandsDenied(evaluate);
    assert.deepEqual(snapshot(), before, "denied SQL commands must leave all committed state and files unchanged");
  } finally {
    try { if (transactionStarted) db.exec("ROLLBACK"); } finally { db.close(); }
  }
  const rows = await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_get_setting_rows", {key:"tracking_paused",keyPrefix:null})');
  assert.deepEqual(rows, before.settings.filter(row => row.key === "tracking_paused"));
  console.log("PASS main SQL load/select/execute denial matrix, unchanged committed state and typed read positive control");
}
