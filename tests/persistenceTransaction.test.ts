import assert from "node:assert/strict";
import {
  createSerializedJobRunner,
  executeTransactionWithExecutor,
  type SqlWriteOperation,
} from "../src/platform/persistence/sqliteTransactions.ts";
import { buildClassificationDraftChangePlan } from "../src/features/classification/services/classificationDraftState.ts";
import { buildCommitDraftChangePlanOperations } from "../src/features/classification/services/classificationStore.ts";
import { buildSaveSettingEntryOperations } from "../src/platform/persistence/appSettingsStore.ts";

class FakeTransactionalExecutor {
  committedStatements: Array<{ query: string; values?: unknown[] }> = [];
  private pendingStatements: Array<{ query: string; values?: unknown[] }> = [];
  private mutationCount = 0;
  private readonly failAtMutationNumber: number | null;

  constructor(failAtMutationNumber: number | null = null) {
    this.failAtMutationNumber = failAtMutationNumber;
  }

  async execute(query: string, values?: unknown[]): Promise<void> {
    if (query === "BEGIN IMMEDIATE") {
      this.pendingStatements = [];
      return;
    }
    if (query === "COMMIT") {
      this.committedStatements.push(...this.pendingStatements);
      this.pendingStatements = [];
      return;
    }
    if (query === "ROLLBACK") {
      this.pendingStatements = [];
      return;
    }

    this.mutationCount += 1;
    if (this.failAtMutationNumber !== null && this.mutationCount === this.failAtMutationNumber) {
      throw new Error(`forced failure at mutation ${this.mutationCount}`);
    }

    this.pendingStatements.push({ query, values });
  }
}

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("executeTransactionWithExecutor commits all operations on success", async () => {
  const executor = new FakeTransactionalExecutor();
  const operations: SqlWriteOperation[] = [
    { query: "INSERT setting A", values: ["a"] },
    { query: "INSERT setting B", values: ["b"] },
  ];

  await executeTransactionWithExecutor(executor, operations);

  assert.deepEqual(executor.committedStatements, operations);
});

await runTest("executeTransactionWithExecutor rolls back all operations when a mutation fails", async () => {
  const executor = new FakeTransactionalExecutor(2);
  const operations: SqlWriteOperation[] = [
    { query: "INSERT setting A", values: ["a"] },
    { query: "INSERT setting B", values: ["b"] },
    { query: "INSERT setting C", values: ["c"] },
  ];

  await assert.rejects(
    executeTransactionWithExecutor(executor, operations),
    /forced failure at mutation 2/,
  );

  assert.deepEqual(executor.committedStatements, []);
});

await runTest("classification batch operations do not leave half-saved writes on transaction failure", async () => {
  const executor = new FakeTransactionalExecutor(2);
  const operations = buildCommitDraftChangePlanOperations(buildClassificationDraftChangePlan({
    overrides: {},
    categoryColorOverrides: {},
    customCategories: [],
    deletedCategories: [],
  }, {
    overrides: {
      "chrome.exe": {
        enabled: true,
        displayName: "Work Browser",
      },
    },
    categoryColorOverrides: {
      development: "#112233",
    },
    customCategories: [],
    deletedCategories: ["music"],
  }));

  assert.ok(operations.length >= 3);
  await assert.rejects(
    executeTransactionWithExecutor(executor, operations),
    /forced failure at mutation 2/,
  );

  assert.deepEqual(executor.committedStatements, []);
});

await runTest("settings batch operations do not leave partial writes on transaction failure", async () => {
  const executor = new FakeTransactionalExecutor(2);
  const operations = buildSaveSettingEntryOperations({
    tracking_paused: true,
    timeline_merge_gap_secs: 180,
    refresh_interval_secs: 2,
  });

  assert.ok(operations.length >= 3);
  await assert.rejects(
    executeTransactionWithExecutor(executor, operations),
    /forced failure at mutation 2/,
  );

  assert.deepEqual(executor.committedStatements, []);
});

await runTest("createSerializedJobRunner keeps writes strictly ordered", async () => {
  const runSerializedJob = createSerializedJobRunner();
  const events: string[] = [];

  const slowJob = runSerializedJob(async () => {
    events.push("slow:start");
    await new Promise((resolve) => setTimeout(resolve, 10));
    events.push("slow:end");
  });

  const fastJob = runSerializedJob(async () => {
    events.push("fast:start");
    events.push("fast:end");
  });

  await Promise.all([slowJob, fastJob]);

  assert.deepEqual(events, [
    "slow:start",
    "slow:end",
    "fast:start",
    "fast:end",
  ]);
});

console.log(`Passed ${passed} persistence transaction tests`);
