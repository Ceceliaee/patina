import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:patina.db";

// Low-level DB adapter only.
// Read-model queries should live in shared read repositories.
let dbInstance: Database | null = null;
let dbInstancePromise: Promise<Database> | null = null;

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
