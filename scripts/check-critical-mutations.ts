import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";

const TEMP_ROOT = resolve(".tmp/critical-mutations");
const SQLITE_SOURCE = "src/platform/persistence/sqliteTransactions.ts";
const ERROR_SOURCE = "src/platform/persistence/commandError.ts";
const WEB_AGGREGATE_SOURCE = "src/platform/persistence/webActivityAnalysisGateway.ts";
const WINDOW_PERMISSIONS_SOURCE = "src-tauri/permissions/window-commands.toml";
const WIDGET_CAPABILITY_SOURCE = "src-tauri/capabilities/widget.json";
const WINDOW_GUARD_SOURCE = "src-tauri/src/commands/window_guard.rs";
const WEB_HEATMAP_RUNTIME_SOURCE = "src/features/data/hooks/useDataWebActivityRuntime.ts";
const WEB_BRIDGE_SOURCE = "src-tauri/src/platform/web_activity_bridge.rs";

function normalizeSourceNewlines(source: string) {
  return source.replace(/\r\n?/g, "\n");
}

function readSource(sourcePath: string) {
  return normalizeSourceNewlines(readFileSync(sourcePath, "utf8"));
}

interface Mutant {
  name: string;
  source: typeof SQLITE_SOURCE | typeof ERROR_SOURCE;
  search: string;
  replacement: string;
}

const MUTANTS: Mutant[] = [
  {
    name: "batch stops awaiting writes",
    source: SQLITE_SOURCE,
    search: "await executor.execute(operation.query, operation.values);",
    replacement: "void executor.execute(operation.query, operation.values);",
  },
  {
    name: "batch executes only first write",
    source: SQLITE_SOURCE,
    search: "for (const operation of operations) {",
    replacement: "for (const operation of operations.slice(0, 1)) {",
  },
  {
    name: "serialized runner skips predecessor",
    source: SQLITE_SOURCE,
    search: "await previous;",
    replacement: "await Promise.resolve();",
  },
  {
    name: "serialized runner never releases successor",
    source: SQLITE_SOURCE,
    search: "releaseCurrent();",
    replacement: "void 0;",
  },
  {
    name: "retryability is inverted",
    source: ERROR_SOURCE,
    search: "return parseCommandError(error).retryable;",
    replacement: "return !parseCommandError(error).retryable;",
  },
  {
    name: "malformed structured errors are accepted",
    source: ERROR_SOURCE,
    search: "typeof (value as Record<string, unknown>).retryable === \"boolean\"",
    replacement: "true",
  },
  {
    name: "native error message is discarded",
    source: ERROR_SOURCE,
    search: "value instanceof Error ? value.message : UNKNOWN_COMMAND_ERROR.message",
    replacement: "UNKNOWN_COMMAND_ERROR.message",
  },
  {
    name: "invoke rejection bypasses normalization",
    source: ERROR_SOURCE,
    search: "throw parseCommandError(error);",
    replacement: "throw error;",
  },
];

interface SourceContractMutant {
  name: string;
  source: string;
  search: string;
  replacement: string;
  verify: (source: string) => void;
}

const SOURCE_CONTRACT_MUTANTS: SourceContractMutant[] = [
  {
    name: "main-only command is reclassified as widget-shared",
    source: WINDOW_PERMISSIONS_SOURCE,
    search: '  "cmd_toggle_tracking_paused",\n  "cmd_is_primary_mouse_button_down",\n]',
    replacement: '  "cmd_toggle_tracking_paused",\n  "cmd_is_primary_mouse_button_down",\n  "cmd_restore_backup",\n]',
    verify: verifyWindowPermissionContract,
  },
  {
    name: "widget regains raw SQL select permission",
    source: WIDGET_CAPABILITY_SOURCE,
    search: '    "widget-window-commands"\n  ]',
    replacement: '    "widget-window-commands",\n    "sql:allow-select"\n  ]',
    verify: verifyWidgetCapabilityContract,
  },
  {
    name: "main-window caller guard comparison is inverted",
    source: WINDOW_GUARD_SOURCE,
    search: "if label == crate::app::tray::MAIN_WINDOW_LABEL {",
    replacement: "if label != crate::app::tray::MAIN_WINDOW_LABEL {",
    verify: verifyMainWindowGuardContract,
  },
  {
    name: "web heatmap retry dependency is removed",
    source: WEB_HEATMAP_RUNTIME_SOURCE,
    search: "    retryKey,\n    selectedDomains,",
    replacement: "    selectedDomains,",
    verify: verifyWebHeatmapRetryContract,
  },
  {
    name: "bridge stops instead of retrying after backoff",
    source: WEB_BRIDGE_SOURCE,
    search: [
      "                    _ = sleep(retry_delay) => {",
      "                        lock_inner(&lifecycle).mark_starting_retry(generation);",
      "                    }",
    ].join("\n"),
    replacement: [
      "                    _ = sleep(retry_delay) => {",
      "                        return None;",
      "                    }",
    ].join("\n"),
    verify: verifyWebBridgeRetryContract,
  },
];

function widgetCommandPermissions(source: string) {
  const block = source.match(
    /\[\[permission\]\]\s*identifier\s*=\s*"widget-window-commands"(?<body>[\s\S]*?)commands\.allow\s*=\s*\[(?<commands>[\s\S]*?)\]/,
  );
  assert.ok(block?.groups?.commands, "widget-window permission block must remain parseable");
  return new Set(
    [...block.groups.commands.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)]
      .map((match) => match[1]),
  );
}

function verifyWindowPermissionContract(source: string) {
  const widgetCommands = widgetCommandPermissions(source);
  for (const sensitive of [
    "cmd_restore_backup",
    "cmd_save_webdav_backup_secret",
    "cmd_delete_sessions_before",
    "cmd_install_update",
  ]) {
    assert.ok(!widgetCommands.has(sensitive), `widget permission exposed main-only command ${sensitive}`);
  }
}

function verifyWidgetCapabilityContract(source: string) {
  const capability = JSON.parse(source) as {
    windows?: string[];
    permissions?: Array<string | { identifier?: string }>;
  };
  assert.deepEqual(capability.windows, ["widget"]);
  const permissionIds = (capability.permissions ?? []).map((permission) => (
    typeof permission === "string" ? permission : permission.identifier ?? ""
  ));
  assert.ok(permissionIds.includes("widget-window-commands"));
  assert.ok(
    permissionIds.every((permission) => !permission.startsWith("sql:")),
    "widget capability exposed raw SQL",
  );
}

function verifyMainWindowGuardContract(source: string) {
  const guard = source.match(
    /fn require_main_window_label\(label: &str\)[\s\S]*?\n\}/,
  )?.[0] ?? "";
  assert.match(guard, /if label == crate::app::tray::MAIN_WINDOW_LABEL \{/);
  assert.match(guard, /return Ok\(\(\)\);/);
  assert.match(guard, /Err\(CommandErrorDto::new\(/);
  assert.doesNotMatch(guard, /if label != crate::app::tray::MAIN_WINDOW_LABEL/);
}

function verifyWebHeatmapRetryContract(source: string) {
  const heatmapEffect = source.match(
    /void loadDataWebHeatmapSnapshot\([\s\S]*?\}, \[(?<dependencies>[\s\S]*?)\]\);/,
  );
  assert.ok(heatmapEffect?.groups?.dependencies, "web heatmap effect dependencies must be parseable");
  assert.match(heatmapEffect.groups.dependencies, /\bretryKey\b/);
}

function verifyWebBridgeRetryContract(source: string) {
  const retryArm = source.match(
    /_ = sleep\(retry_delay\) => \{(?<body>[\s\S]*?)\n\s*\}\n\s*changed = shutdown_rx\.changed\(\)/,
  );
  assert.ok(retryArm?.groups?.body, "bridge retry select arm must be parseable");
  assert.match(retryArm.groups.body, /mark_starting_retry\(generation\)/);
  assert.doesNotMatch(retryArm.groups.body, /return None/);
}

function transpile(sourcePath: string, mutation?: Mutant) {
  let source = readSource(sourcePath);
  if (sourcePath === ERROR_SOURCE) {
    source = source.replace(
      'import { invoke } from "@tauri-apps/api/core";',
      "const invoke = async () => { throw new Error('unconfigured invoke'); };",
    );
  }
  if (mutation) {
    assert(source.includes(mutation.search), `stale mutant search: ${mutation.name}`);
    source = source.replace(mutation.search, mutation.replacement);
  }
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

async function importMutant(sourcePath: string, mutation?: Mutant) {
  const suffix = mutation ? MUTANTS.indexOf(mutation).toString() : "baseline";
  const outputPath = resolve(TEMP_ROOT, `${sourcePath.includes("sqlite") ? "sqlite" : "error"}-${suffix}.mjs`);
  writeFileSync(outputPath, transpile(sourcePath, mutation), "utf8");
  return import(`${pathToFileURL(outputPath).href}?run=${Date.now()}`);
}

const WEB_AGGREGATE_REVISION_MUTANT = {
  name: "web aggregate silently merges different source revisions",
  search: "if (sourceRevision !== null && chunk.sourceRevision !== sourceRevision) {",
  replacement: "if (false) {",
};

async function importWebAggregateMutation(mutated: boolean) {
  let source = readSource(WEB_AGGREGATE_SOURCE).replace(
    'import { invokeWithCommandError } from "./commandError.ts";',
    "const invokeWithCommandError = async () => { throw new Error('unconfigured invoke'); };",
  );
  if (mutated) {
    assert(
      source.includes(WEB_AGGREGATE_REVISION_MUTANT.search),
      `stale mutant search: ${WEB_AGGREGATE_REVISION_MUTANT.name}`,
    );
    source = source.replace(
      WEB_AGGREGATE_REVISION_MUTANT.search,
      WEB_AGGREGATE_REVISION_MUTANT.replacement,
    );
  }
  const outputPath = resolve(TEMP_ROOT, `web-aggregate-${mutated ? "mutant" : "baseline"}.mjs`);
  writeFileSync(outputPath, ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText, "utf8");
  return import(`${pathToFileURL(outputPath).href}?run=${Date.now()}`);
}

async function verifyWebAggregateRevision(module: Record<string, unknown>) {
  const load = module.loadWebActivityAggregateRange as (
    startMs: number,
    endMs: number,
    boundaries: number[],
    filter: null,
    reader: (
      startMs: number,
      endMs: number,
      boundaries: number[],
      filter: null,
      snapshotNowMs: number,
    ) => Promise<{
      records: unknown[];
      domainCoverage: unknown[];
      sourceRevision: string;
      snapshotNowMs: number;
    }>,
  ) => Promise<{ sourceRevision: string }>;
  const boundaries = Array.from({ length: 403 }, (_, index) => index * 1_000);
  let calls = 0;
  const result = await load(
    boundaries[0],
    boundaries.at(-1) ?? 0,
    boundaries,
    null,
    async (_startMs, _endMs, _chunkBoundaries, _filter, snapshotNowMs) => {
      const attemptIndex = Math.floor(calls / 2);
      const chunkIndex = calls % 2;
      calls += 1;
      return {
        records: [],
        domainCoverage: [],
        sourceRevision: attemptIndex === 0
          ? (chunkIndex === 0 ? "1" : "2")
          : "3",
        snapshotNowMs,
      };
    },
  );

  assert.equal(calls, 4);
  assert.equal(result.sourceRevision, "3");
}

async function withTimeout<T>(promise: Promise<T>, milliseconds = 200): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("mutation timeout")), milliseconds)),
  ]);
}

async function verifySqlite(module: Record<string, unknown>) {
  const executeBatch = module.executeWriteBatchWithExecutor as (
    executor: { execute(query: string): Promise<void> },
    operations: Array<{ query: string }>,
  ) => Promise<void>;
  const createRunner = module.createSerializedJobRunner as () => <T>(job: () => Promise<T>) => Promise<T>;

  const writes: string[] = [];
  await executeBatch({ execute: async (query) => { writes.push(query); } }, [{ query: "a" }, { query: "b" }]);
  assert.deepEqual(writes, ["a", "b"]);

  await assert.rejects(executeBatch({
    execute: async (query) => {
      if (query === "b") throw new Error("stop");
      writes.push(query);
    },
  }, [{ query: "a" }, { query: "b" }, { query: "c" }]), /stop/);

  const run = createRunner();
  const order: string[] = [];
  let releaseSlowJob!: () => void;
  const slowJobGate = new Promise<void>((resolve) => {
    releaseSlowJob = resolve;
  });
  const slowJob = run(async () => {
    order.push("slow:start");
    await slowJobGate;
    order.push("slow:end");
  });
  const fastJob = run(async () => { order.push("fast"); });
  await Promise.resolve();
  assert.deepEqual(order, ["slow:start"]);
  releaseSlowJob();
  await withTimeout(Promise.all([slowJob, fastJob]));
  assert.deepEqual(order, ["slow:start", "slow:end", "fast"]);
}

async function verifyError(module: Record<string, unknown>) {
  const parse = module.parseCommandError as (value: unknown) => { code: string; message: string; retryable: boolean };
  const retryable = module.isRetryableCommandError as (value: unknown) => boolean;
  const invokeUsing = module.invokeWithCommandErrorUsing as (
    invokeCommand: () => Promise<never>,
    command: string,
  ) => Promise<unknown>;

  const busy = { code: "SQLITE_BUSY", message: "later", retryable: true };
  assert.equal(retryable(busy), true);
  assert.equal(retryable({ ...busy, retryable: false }), false);
  assert.deepEqual(parse({ message: "partial" }), {
    code: "UNKNOWN_COMMAND_ERROR",
    message: "The operation could not be completed.",
    retryable: false,
  });
  assert.deepEqual(parse({ code: "SQLITE_BUSY", message: "later", retryable: "yes" }), {
    code: "UNKNOWN_COMMAND_ERROR",
    message: "The operation could not be completed.",
    retryable: false,
  });
  assert.equal(parse(new Error("native failure")).message, "native failure");
  await assert.rejects(
    invokeUsing(async () => { throw new Error("backend failure"); }, "cmd_fail"),
    (error) => {
      const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown };
      return candidate.code === "UNKNOWN_COMMAND_ERROR"
        && candidate.message === "backend failure"
        && candidate.retryable === false;
    },
  );
}

async function verify(module: Record<string, unknown>, source: Mutant["source"]) {
  if (source === SQLITE_SOURCE) await verifySqlite(module);
  else await verifyError(module);
}

async function verifyMutant(mutant: Mutant) {
  const detachedRejections: unknown[] = [];
  const captureDetachedRejection = (reason: unknown) => detachedRejections.push(reason);
  process.on("unhandledRejection", captureDetachedRejection);
  try {
    await verify(await importMutant(mutant.source, mutant), mutant.source);
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (detachedRejections.length > 0) {
      throw new Error(`mutant created ${detachedRejections.length} detached rejection(s)`);
    }
  } finally {
    process.off("unhandledRejection", captureDetachedRejection);
  }
}

function verifySourceContractMutant(mutant: SourceContractMutant) {
  const source = readSource(mutant.source);
  assert(source.includes(mutant.search), `stale mutant search: ${mutant.name}`);
  mutant.verify(source.replace(mutant.search, mutant.replacement));
}

rmSync(TEMP_ROOT, { recursive: true, force: true });
mkdirSync(TEMP_ROOT, { recursive: true });
try {
  await verify(await importMutant(SQLITE_SOURCE), SQLITE_SOURCE);
  await verify(await importMutant(ERROR_SOURCE), ERROR_SOURCE);
  await verifyWebAggregateRevision(await importWebAggregateMutation(false));
  for (const mutant of SOURCE_CONTRACT_MUTANTS) {
    const source = readSource(mutant.source);
    mutant.verify(source);
    mutant.verify(normalizeSourceNewlines(source.replace(/\n/g, "\r\n")));
  }

  let killed = 0;
  for (const mutant of MUTANTS) {
    try {
      await verifyMutant(mutant);
      console.error(`SURVIVED ${mutant.name}`);
    } catch {
      killed += 1;
      console.log(`KILLED ${mutant.name}`);
    }
  }

  try {
    await verifyWebAggregateRevision(await importWebAggregateMutation(true));
    console.error(`SURVIVED ${WEB_AGGREGATE_REVISION_MUTANT.name}`);
  } catch {
    killed += 1;
    console.log(`KILLED ${WEB_AGGREGATE_REVISION_MUTANT.name}`);
  }

  for (const mutant of SOURCE_CONTRACT_MUTANTS) {
    try {
      verifySourceContractMutant(mutant);
      console.error(`SURVIVED ${mutant.name}`);
    } catch {
      killed += 1;
      console.log(`KILLED ${mutant.name}`);
    }
  }

  const total = MUTANTS.length + 1 + SOURCE_CONTRACT_MUTANTS.length;
  const score = (killed / total) * 100;
  console.log(`Critical mutation score: ${killed}/${total} (${score.toFixed(1)}%)`);
  if (killed !== total) process.exitCode = 1;
} finally {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
}
