import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { readRuntimeDatabaseRows } from "./runtimeDatabase.ts";

test("runtime inspection waits for a concurrent writer and remains read-only", async () => {
  const root = mkdtempSync(join(tmpdir(), "patina-runtime-reader-"));
  const databasePath = join(root, "test.db");
  const seed = new DatabaseSync(databasePath);
  seed.exec("CREATE TABLE settings (value TEXT); INSERT INTO settings VALUES ('before')");
  seed.close();
  const gate = new SharedArrayBuffer(4);
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(workerData.databasePath);
    db.exec("BEGIN EXCLUSIVE; UPDATE settings SET value = 'committed'");
    parentPort.postMessage('locked');
    Atomics.wait(new Int32Array(workerData.gate), 0, 0, 10000);
    // Hold the real lock beyond a zero-timeout reader's attempt; release independently
    // of the main thread, which blocks inside SQLite while waiting for the writer.
    setTimeout(() => { db.exec('COMMIT'); db.close(); }, 200);
  `, { eval: true, workerData: { databasePath, gate } });
  const exited = once(worker, "exit");
  try {
    assert.deepEqual(await once(worker, "message"), ["locked"]);
    const evaluate = async () => {
      Atomics.store(new Int32Array(gate), 0, 1);
      Atomics.notify(new Int32Array(gate), 0);
      return { paths: { databasePath } };
    };
    assert.deepEqual(await readRuntimeDatabaseRows(evaluate, "SELECT value FROM settings"), [
      { value: "committed" },
    ]);
    await assert.rejects(readRuntimeDatabaseRows(evaluate, "DELETE FROM settings"), /readonly/i);
    await assert.rejects(readRuntimeDatabaseRows(evaluate, "SELECT missing FROM settings"), /no such column/i);
    assert.deepEqual(await readRuntimeDatabaseRows(evaluate, "SELECT value FROM settings"), [
      { value: "committed" },
    ]);
    await exited;
  } finally {
    await worker.terminate();
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime inspection reports a writer that outlives the lock timeout", async () => {
  const root = mkdtempSync(join(tmpdir(), "patina-runtime-reader-timeout-"));
  const databasePath = join(root, "test.db");
  const writer = new DatabaseSync(databasePath);
  try {
    writer.exec("CREATE TABLE settings (value TEXT); BEGIN EXCLUSIVE");
    const evaluate = async () => ({ paths: { databasePath } });
    await assert.rejects(readRuntimeDatabaseRows(evaluate, "SELECT value FROM settings"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 5,
    });
    writer.exec("ROLLBACK");
    assert.deepEqual(await readRuntimeDatabaseRows(evaluate, "SELECT value FROM settings"), []);
  } finally {
    writer.close();
    rmSync(root, { recursive: true, force: true });
  }
});
