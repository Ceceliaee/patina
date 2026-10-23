import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readRuntimeDatabaseRows } from "./runtimeDatabase.ts";

export async function verifyBackupRetirementRuntime(evaluate: (expression: string) => Promise<unknown>, root: string) {
  const path = join(root, "unsupported-backup.zip");
  const db = join(root, "data", "patina.db");
  const seed = spawnSync("python", ["-c", [
    "import sqlite3, sys, zipfile",
    "archive=zipfile.ZipFile(sys.argv[1], 'w')",
    "archive.writestr('manifest.json', '{\"format\":\"PatinaBackup\",\"version\":1}')",
    "archive.writestr('sessions.json', '[]')",
    "archive.close()",
    "db=sqlite3.connect(sys.argv[2])",
    "db.execute(\"INSERT INTO sessions(app_name,exe_name,start_time,continuity_group_start_time) VALUES('Reject sentinel','reject-sentinel.exe',?,?)\", (int(sys.argv[3]), int(sys.argv[3])))",
    "db.execute(\"CREATE TRIGGER retirement_reject_seal BEFORE UPDATE OF end_time ON sessions WHEN OLD.exe_name='reject-sentinel.exe' BEGIN SELECT RAISE(ABORT, 'retirement probe forbids sealing'); END\")",
    "db.commit()",
    "db.close()",
  ].join("; "), path, db, String(Date.now() - 60_000)], { encoding: "utf8", windowsHide: true });
  assert.equal(seed.status, 0, seed.stderr);
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  const query = "SELECT id,exe_name,start_time,end_time,duration FROM sessions WHERE exe_name='reject-sentinel.exe'";
  try {
    const before = await readRuntimeDatabaseRows(evaluate, query);
    const invokeError = (command: string, payload: unknown) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(payload)}).then(() => null, error => error)`) as Promise<{ code: string; message: string } | null>;
    // The trigger isolates this open row from the paused background sampler. If
    // restore tries to seal before checking format/hash, it returns the trigger
    // failure instead of the expected input error, so the assertions still fail.
    assert.equal((await invokeError("cmd_preview_backup", { backupPath: path }))?.code, "BACKUP_FORMAT_UNSUPPORTED");
    for (const restoreStrategy of ["replace", "merge"]) {
      assert.equal((await invokeError("cmd_restore_backup", { backupPath: path, hash, restoreStrategy }))?.code, "BACKUP_FORMAT_UNSUPPORTED");
      const changed = await invokeError("cmd_restore_backup", { backupPath: path, hash: "0".repeat(64), restoreStrategy });
      assert.equal(changed?.code, "BACKUP_FAILED");
      assert.match(changed!.message, /changed after preview/);
      const malformed = await invokeError("cmd_restore_backup", { backupPath: path, hash: "invalid", restoreStrategy });
      assert.equal(malformed?.code, "BACKUP_FAILED");
      assert.match(malformed!.message, /preview identity is invalid/);
      assert.deepEqual(await readRuntimeDatabaseRows(evaluate, query), before, "rejection must not seal the active session");
      assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), hash);
    }
  } finally {
    const cleanup = spawnSync("python", ["-c", "import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('DROP TRIGGER retirement_reject_seal'); db.execute(\"DELETE FROM sessions WHERE exe_name='reject-sentinel.exe'\"); db.commit(); db.close()", db], { encoding: "utf8", windowsHide: true });
    assert.equal(cleanup.status, 0, cleanup.stderr);
  }
  console.log("PASS unsupported backup preview/direct restore and changed hash preserve active facts and source bytes");
}
