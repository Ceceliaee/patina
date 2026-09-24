import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import Database from "@tauri-apps/plugin-sql";
import {
  getSessionsInRange,
  getSessionsInRangeWithoutTitleSamples,
} from "../src/platform/persistence/sessionReadRepository.ts";
import {
  createSerializedJobRunner,
  executeWriteBatchWithExecutor,
  type SqlWriteOperation,
} from "../src/platform/persistence/sqliteTransactions.ts";
import {
  isRetryableCommandError,
  invokeWithCommandErrorUsing,
  parseCommandError,
} from "../src/platform/persistence/commandError.ts";
import {
  buildAppSettingMutations,
  buildRawAppSettingsPatch,
} from "../src/platform/persistence/appSettingsStore.ts";

class FakeWriteExecutor {
  executedStatements: Array<{ query: string; values?: unknown[] }> = [];
  private mutationCount = 0;
  private readonly failAtMutationNumber: number | null;

  constructor(failAtMutationNumber: number | null = null) {
    this.failAtMutationNumber = failAtMutationNumber;
  }

  async execute(query: string, values?: unknown[]): Promise<void> {
    this.mutationCount += 1;
    if (this.failAtMutationNumber !== null && this.mutationCount === this.failAtMutationNumber) {
      throw new Error(`forced failure at mutation ${this.mutationCount}`);
    }

    this.executedStatements.push({ query, values });
  }
}

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function assertNoTransactionControlStatements(executor: FakeWriteExecutor) {
  const transactionControlStatements = new Set(["BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"]);
  assert.equal(
    executor.executedStatements.some((statement) => transactionControlStatements.has(statement.query)),
    false,
  );
}

await runTest("History SQL preserves open and half-open boundaries with native import precedence", async () => {
  const db = new DatabaseSync(":memory:");
  const originalSelect = Database.prototype.select;
  const originalNow = Date.now;
  try {
    db.exec(`
      CREATE TABLE sessions(id INTEGER PRIMARY KEY, app_name TEXT, exe_name TEXT, window_title TEXT,
        start_time INTEGER, end_time INTEGER, duration INTEGER, continuity_group_start_time INTEGER);
      CREATE TABLE import_exact_sessions(id INTEGER PRIMARY KEY, app_name TEXT, exe_name TEXT,
        window_title TEXT, start_time INTEGER, end_time INTEGER, duration INTEGER);
      CREATE TABLE session_title_samples(id INTEGER PRIMARY KEY,session_id INTEGER,title TEXT,start_time INTEGER,end_time INTEGER);
      CREATE TABLE anonymous_activity(id TEXT PRIMARY KEY,start_time INTEGER,end_time INTEGER,observed_until INTEGER,is_web INTEGER);
      CREATE INDEX idx_sessions_date ON sessions(start_time);
      CREATE INDEX idx_sessions_end_start ON sessions(end_time,start_time);
      INSERT INTO sessions VALUES
        (1,'Editor','editor.exe','before',-1000,0,1000,-1000),
        (2,'Editor','editor.exe','closed',0,1000,1000,0),
        (3,'Editor','editor.exe','at end',3000,4000,1000,3000),
        (4,'Editor','editor.exe','open',8000,NULL,NULL,8000);
      INSERT INTO import_exact_sessions VALUES(1,'Imported','imported.exe','imported',500,3500,3000);
      INSERT INTO session_title_samples VALUES(1,2,'closed title',0,1000);
    `);
    Date.now = () => 10_000;
    Database.prototype.select = async function <T>(query: string, values?: unknown[]): Promise<T> {
      return db.prepare(query).all(...(values ?? []) as SQLInputValue[]) as T;
    };
    for (const load of [getSessionsInRangeWithoutTitleSamples, getSessionsInRange]) {
      const rows = await load(0, 3000);
      assert.deepEqual(rows.map(row => [row.exeName, row.startTime, row.endTime, row.duration]), [
        ["editor.exe", 0, 1000, 1000],
        ["imported.exe", 1000, 3500, 2500],
      ]);
      assert.deepEqual((await load(8000, 9000)).map(row => [row.startTime, row.endTime, row.duration]), [[8000, null, 2000]]);
      assert.deepEqual(await load(10_000, 11_000), []);
      assert.deepEqual((await load(-1000, 0)).map(row => row.id), [1]);
    }
    assert.deepEqual((await getSessionsInRange(0, 3000))[0]?.titleSampleDetails, [
      { title: "closed title", startTime: 0, endTime: 1000 },
    ]);
    db.exec("INSERT INTO anonymous_activity VALUES('opaque',1000,2000,2000,1)");
    const anonymous = (await getSessionsInRange(0,3000)).filter(row => row.exeName === "activity:anonymous");
    assert.equal(anonymous.length,1);
    assert.deepEqual([anonymous[0].startTime,anonymous[0].endTime,anonymous[0].duration],[1000,2000,1000]);
    assert.equal(anonymous[0].windowTitle,"");
    assert.deepEqual(anonymous[0].titleSampleDetails,[]);
  } finally {
    Database.prototype.select = originalSelect;
    Date.now = originalNow;
    db.close();
  }
});

await runTest("executeWriteBatchWithExecutor executes all operations in order", async () => {
  const executor = new FakeWriteExecutor();
  const operations: SqlWriteOperation[] = [
    { query: "INSERT setting A", values: ["a"] },
    { query: "INSERT setting B", values: ["b"] },
  ];

  await executeWriteBatchWithExecutor(executor, operations);

  assert.deepEqual(executor.executedStatements, operations);
  assertNoTransactionControlStatements(executor);
});

await runTest("executeWriteBatchWithExecutor stops after the first failed operation", async () => {
  const executor = new FakeWriteExecutor(2);
  const operations: SqlWriteOperation[] = [
    { query: "INSERT setting A", values: ["a"] },
    { query: "INSERT setting B", values: ["b"] },
    { query: "INSERT setting C", values: ["c"] },
  ];

  await assert.rejects(
    executeWriteBatchWithExecutor(executor, operations),
    /forced failure at mutation 2/,
  );

  assert.deepEqual(executor.executedStatements, [operations[0]]);
  assertNoTransactionControlStatements(executor);
});

await runTest("settings raw patch persists theme mode with snake case key", () => {
  assert.deepEqual(buildRawAppSettingsPatch({
    backgroundOptimization: true,
    themeMode: "system",
    language: "en-US",
    hourlyActivityChartMode: "category",
    dynamicEffects: false,
    colorSchemeLight: "rose-pine",
    colorSchemeDark: "gruvbox",
  }), {
    background_optimization: true,
    theme_mode: "system",
    language: "en-US",
    hourly_activity_chart_mode: "category",
    dynamic_effects: false,
    color_scheme_light: "rose-pine",
    color_scheme_dark: "gruvbox",
  });
});

await runTest("app setting mutations serialize values for backend transaction command", () => {
  assert.deepEqual(buildAppSettingMutations(buildRawAppSettingsPatch({
    trackingPaused: true,
    timelineMergeGapSecs: 180,
    backgroundOptimization: true,
    themeMode: "system",
    language: "en-US",
    hourlyActivityChartMode: "category",
    dynamicEffects: false,
  })), [
    { key: "tracking_paused", value: "1" },
    { key: "timeline_merge_gap_secs", value: "180" },
    { key: "background_optimization", value: "1" },
    { key: "theme_mode", value: "system" },
    { key: "language", value: "en-US" },
    { key: "hourly_activity_chart_mode", value: "category" },
    { key: "dynamic_effects", value: "0" },
  ]);
});

await runTest("command retryability uses structured fields rather than message text", () => {
  const busy = { code: "SQLITE_BUSY", message: "write unavailable", retryable: true };
  assert.deepEqual(parseCommandError(busy), busy);
  assert.equal(isRetryableCommandError(busy), true);
  assert.equal(
    isRetryableCommandError({
      code: "SQLITE_OPERATION_FAILED",
      message: "database is locked",
      retryable: false,
    }),
    false,
  );
  assert.deepEqual(parseCommandError({ message: "partial" }), {
    code: "UNKNOWN_COMMAND_ERROR",
    message: "The operation could not be completed.",
    retryable: false,
  });
  assert.deepEqual(parseCommandError(new Error("native failure")), {
    code: "UNKNOWN_COMMAND_ERROR",
    message: "native failure",
    retryable: false,
  });
});

await runTest("command wrapper preserves success and normalizes rejection", async () => {
  const invokeSuccess = async <T>(_command: string, _args?: Record<string, unknown>) => 42 as T;
  assert.equal(await invokeWithCommandErrorUsing(invokeSuccess, "cmd_ok"), 42);

  const structured = { code: "SQLITE_BUSY", message: "try later", retryable: true };
  const invokeFailure = async <T>(_command: string, _args?: Record<string, unknown>) => {
    throw structured;
  };
  await assert.rejects(
    invokeWithCommandErrorUsing(invokeFailure, "cmd_fail"),
    (error) => {
      assert.deepEqual(error, structured);
      return true;
    },
  );
});

await runTest("createSerializedJobRunner keeps writes strictly ordered", async () => {
  const runSerializedJob = createSerializedJobRunner();
  const events: string[] = [];
  let releaseSlowJob!: () => void;
  const slowJobGate = new Promise<void>((resolve) => {
    releaseSlowJob = resolve;
  });

  const slowJob = runSerializedJob(async () => {
    events.push("slow:start");
    await slowJobGate;
    events.push("slow:end");
  });

  const fastJob = runSerializedJob(async () => {
    events.push("fast:start");
    events.push("fast:end");
  });

  await Promise.resolve();
  assert.deepEqual(events, ["slow:start"]);
  releaseSlowJob();
  await Promise.all([slowJob, fastJob]);

  assert.deepEqual(events, [
    "slow:start",
    "slow:end",
    "fast:start",
    "fast:end",
  ]);
});

console.log(`Passed ${passed} persistence transaction tests`);
