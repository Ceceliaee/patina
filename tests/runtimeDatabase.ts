import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { StorageSnapshot } from "../src/platform/storage/storageRuntimeGateway.ts";

// Inspect committed state outside the WebView; the application never receives arbitrary SQL.
export async function readRuntimeDatabaseRows(
  evaluate: (expression: string) => Promise<unknown>,
  query: string,
  values: SQLInputValue[] = [],
) {
  const snapshot = await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_get_storage_snapshot")') as StorageSnapshot;
  const db = new DatabaseSync(snapshot.paths.databasePath, { readOnly: true, allowExtension: false });
  try {
    // The separate application process can still hold a write lock after an IPC reply.
    db.exec("PRAGMA busy_timeout = 5000");
    return db.prepare(query).all(...values).map(row => ({ ...row }));
  } finally {
    db.close();
  }
}
