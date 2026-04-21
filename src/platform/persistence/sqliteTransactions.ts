export interface SqlWriteExecutor {
  execute(query: string, values?: unknown[]): Promise<unknown>;
}

export interface SqlWriteOperation {
  query: string;
  values?: unknown[];
}

export interface SqlTransactionStatements {
  begin: string;
  commit: string;
  rollback: string;
}

const DEFAULT_SQL_TRANSACTION_STATEMENTS: SqlTransactionStatements = {
  begin: "BEGIN IMMEDIATE",
  commit: "COMMIT",
  rollback: "ROLLBACK",
};

export async function executeTransactionWithExecutor(
  executor: SqlWriteExecutor,
  operations: readonly SqlWriteOperation[],
  statements: Partial<SqlTransactionStatements> = {},
): Promise<void> {
  if (operations.length === 0) {
    return;
  }

  const resolvedStatements = {
    ...DEFAULT_SQL_TRANSACTION_STATEMENTS,
    ...statements,
  };

  await executor.execute(resolvedStatements.begin);
  try {
    for (const operation of operations) {
      await executor.execute(operation.query, operation.values);
    }
    await executor.execute(resolvedStatements.commit);
  } catch (error) {
    try {
      await executor.execute(resolvedStatements.rollback);
    } catch {
      // The original mutation error remains the primary failure.
    }
    throw error;
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
