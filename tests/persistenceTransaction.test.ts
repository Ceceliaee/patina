import assert from "node:assert/strict";
import {
  getSessionsInRange,
  getSessionsInRangeWithoutTitleSamples,
} from "../src/platform/persistence/sessionReadRepository.ts";
import {
  createSerializedJobRunner,
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

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("History typed reads preserve native precedence, titles and anonymous identities", async () => {
  const host = globalThis as unknown as { window?: unknown };
  const originalWindow = host.window;
  const originalNow = Date.now;
  const native = { id: 2, origin: "native", app_name: "Editor", exe_name: "editor.exe",
    window_title: "closed", start_time: 0, end_time: 1000, duration: 1000, continuity_group_start_time: 0 };
  const imported = { ...native, id: 1, origin: "import_exact", app_name: "Imported", exe_name: "imported.exe",
    start_time: 500, end_time: 3500, duration: 3000, continuity_group_start_time: 500 };
  const anonymous = { ...native, id: -7000000000000001, app_name: "", exe_name: "activity:anonymous",
    window_title: "", start_time: 1000, end_time: 2000, duration: 1000, continuity_group_start_time: 1000 };
  let rows = [native, imported];
  host.window = { __TAURI_INTERNALS__: { invoke: async (command: string, args: Record<string, unknown>) => {
    assert.equal(command, "cmd_get_history_range_rows");
    assert.deepEqual(args, { startMs: 0, endMs: 3000, nowMs: 10000, includeTitleSamples: args.includeTitleSamples });
    return {
      sessions: rows,
      titleSamples: args.includeTitleSamples ? [{ session_id: 2, title: "closed title", start_time: 0, end_time: 1000 }] : [],
    };
  } } };
  try {
    Date.now = () => 10000;
    for (const load of [getSessionsInRangeWithoutTitleSamples, getSessionsInRange]) {
      const result = await load(0, 3000);
      assert.deepEqual(result.map(row => [row.exeName, row.startTime, row.endTime, row.duration]), [
        ["editor.exe", 0, 1000, 1000], ["imported.exe", 1000, 3500, 2500],
      ]);
    }
    assert.deepEqual((await getSessionsInRange(0, 3000))[0].titleSampleDetails,
      [{ title: "closed title", startTime: 0, endTime: 1000 }]);
    rows = [native, imported, anonymous];
    const core = await getSessionsInRangeWithoutTitleSamples(0, 3000);
    const detailed = await getSessionsInRange(0, 3000);
    assert.deepEqual(core, detailed.map(row => ({ ...row, titleSampleDetails: [] })));
    const privateRow = detailed.find(row => row.exeName === "activity:anonymous")!;
    assert.equal(privateRow.windowTitle, "");
    assert.deepEqual(privateRow.titleSampleDetails, []);
    assert.deepEqual([privateRow.startTime, privateRow.endTime, privateRow.duration], [1000, 2000, 1000]);
    assert.deepEqual(detailed.filter(row => row.exeName === "imported.exe").map(row => [row.startTime, row.endTime]),
      [[2000, 3500]], "anonymous native occupancy also takes precedence over imports");
  } finally {
    host.window = originalWindow;
    Date.now = originalNow;
  }
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
