export interface SqlWriteExecutor {
  execute(query: string, values?: unknown[]): Promise<unknown>;
}

export interface SqlWriteOperation {
  query: string;
  values?: unknown[];
}

export function isRecoverableSqliteWriteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes("database is locked")
    || normalized.includes("database is busy")
    || normalized.includes("sqlite_busy")
    || normalized.includes("sqlite_locked")
    || normalized.includes("pool closed")
    || normalized.includes("pooltimedout");
}

export async function executeWriteBatchWithExecutor(
  executor: SqlWriteExecutor,
  operations: readonly SqlWriteOperation[],
): Promise<void> {
  // @tauri-apps/plugin-sql runs each execute call through the Rust-side pool.
  // A manual BEGIN/COMMIT sequence from the frontend can land on different
  // pooled connections and self-lock. Keep ordering here; true atomic
  // transactions should live behind a Rust command that owns one transaction.
  for (const operation of operations) {
    await executor.execute(operation.query, operation.values);
  }
}

export function createSerializedJobRunner() {
  let tail = Promise.resolve();

  return async function runSerializedJob<T>(job: () => Promise<T>): Promise<T> {
    const previous = tail;
    let releaseCurrent!: () => void;
    tail = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    await previous;
    try {
      return await job();
    } finally {
      releaseCurrent();
    }
  };
}
