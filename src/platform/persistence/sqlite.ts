import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import {
  createSerializedJobRunner,
  executeWriteBatchWithExecutor,
  isRecoverableSqliteWriteError,
  type SqlWriteOperation,
} from "./sqliteTransactions.ts";

const DB_URL = "sqlite:patina.db";

// Low-level DB adapter only.
// Read-model queries should live in shared read repositories.
let dbInstance: Database | null = null;
let dbInstancePromise: Promise<Database> | null = null;
const runSerializedWrite = createSerializedJobRunner();

export const getDB = async () => {
  try {
    if (dbInstance) {
      return dbInstance;
    }

    if (!dbInstancePromise) {
      dbInstancePromise = Promise.resolve(Database.get(DB_URL)).then((db) => {
        dbInstance = db;
        return db;
      });
    }

    return await dbInstancePromise;
  } catch (error) {
    console.error("Database Load Error:", error);
    throw new Error(
      "DB_INIT_FAILED: " + (error instanceof Error ? error.message : String(error)),
    );
  }
};

export type { SqlWriteOperation } from "./sqliteTransactions.ts";

async function resetDBConnectionPool(): Promise<void> {
  dbInstance = null;
  dbInstancePromise = null;
  await invoke("cmd_reopen_sqlite_pool");
}

async function withRecoverableWriteRetry(job: () => Promise<void>): Promise<void> {
  try {
    await job();
  } catch (error) {
    if (!isRecoverableSqliteWriteError(error)) {
      throw error;
    }
    console.warn("Recovering SQLite write connection after transient lock", error);
    await resetDBConnectionPool();
    await job();
  }
}

export async function executeWrite(query: string, values?: unknown[]): Promise<void> {
  await runSerializedWrite(async () => {
    await withRecoverableWriteRetry(async () => {
      const db = await getDB();
      await db.execute(query, values);
    });
  });
}

export async function executeWriteBatch(
  operations: readonly SqlWriteOperation[],
): Promise<void> {
  await runSerializedWrite(async () => {
    await withRecoverableWriteRetry(async () => {
      const db = await getDB();
      await executeWriteBatchWithExecutor(db, operations);
    });
  });
}
