import Database from "@tauri-apps/plugin-sql";
import {
  createSerializedJobRunner,
  executeTransactionWithExecutor,
  type SqlWriteOperation,
} from "./sqliteTransactions.ts";

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
      dbInstancePromise = Database.load("sqlite:timetracker.db")
        .then((db) => {
          dbInstance = db;
          return db;
        })
        .catch((error) => {
          dbInstancePromise = null;
          throw error;
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

export async function executeWrite(query: string, values?: unknown[]): Promise<void> {
  await runSerializedWrite(async () => {
    const db = await getDB();
    await db.execute(query, values);
  });
}

export async function executeWriteTransaction(
  operations: readonly SqlWriteOperation[],
): Promise<void> {
  await runSerializedWrite(async () => {
    const db = await getDB();
    await executeTransactionWithExecutor(db, operations);
  });
}
