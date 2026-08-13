import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { build as buildVite, preview as previewVite, type PreviewServer } from "vite";
import {
  CdpConnection,
  assertIsolatedTempPath,
  waitFor,
} from "./uiBrowserSmoke/browserHarness.ts";

// Keep cold compilation separate from actual WebView startup so a slow hosted
// runner cannot consume the runtime readiness budget before Patina launches.
const COLD_BUILD_TIMEOUT_MS = 480_000;
const WEBVIEW_STARTUP_TIMEOUT_MS = 30_000;
const RUNTIME_TARGET_DIR = join(process.cwd(), "src-tauri", "target", "runtime-smoke");
const RUNTIME_BINARY_PATH = join(RUNTIME_TARGET_DIR, "debug", "patina.exe");
async function reservePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function occupyPort(port = 0) {
  return new Promise<NetServer>((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function closeNetServer(server: NetServer | null) {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function findMainTarget(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return null;
    const targets = await response.json() as Array<{
      title?: string;
      type?: string;
      url?: string;
      webSocketDebuggerUrl?: string;
    }>;
    return targets.find((target) => target.type === "page"
      && target.url
      && target.url !== "about:blank"
      && target.webSocketDebuggerUrl) ?? null;
  } catch {
    return null;
  }
}

async function findWidgetTarget(port: number, mainWebSocketDebuggerUrl: string) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return null;
    const targets = await response.json() as Array<{
      title?: string;
      type?: string;
      url?: string;
      webSocketDebuggerUrl?: string;
    }>;
    return targets.find((target) => target.type === "page"
      && target.url
      && target.url !== "about:blank"
      && target.webSocketDebuggerUrl !== mainWebSocketDebuggerUrl
      && target.webSocketDebuggerUrl) ?? null;
  } catch {
    return null;
  }
}

async function evaluate(client: CdpConnection, expression: string) {
  const response = await client.command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return (response.result as { value?: unknown } | undefined)?.value;
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopProcessTree(child: ChildProcess) {
  if (!child.pid) return null;
  const pid = child.pid;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      encoding: "utf8",
    });
    if ((result.error || result.status !== 0) && isProcessRunning(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // The process may have exited between the liveness check and the fallback.
      }
    }
  } else {
    child.kill("SIGTERM");
  }
  return pid;
}

function runRuntimeBinaryProcessCommand(command: string) {
  if (process.platform !== "win32") return null;
  return spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATINA_RUNTIME_SMOKE_BINARY: RUNTIME_BINARY_PATH,
    },
  });
}

function stopResidualRuntimeBinary() {
  const result = runRuntimeBinaryProcessCommand(`
    $target = [IO.Path]::GetFullPath($env:PATINA_RUNTIME_SMOKE_BINARY)
    $processes = @(Get-Process patina -ErrorAction SilentlyContinue)
    foreach ($process in $processes) {
      try {
        $path = [IO.Path]::GetFullPath($process.Path)
        if ($path -ieq $target) {
          Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
      } catch {
        # The process may exit while PowerShell resolves its executable path.
      }
    }
    exit 0
  `);
  if (result?.error) {
    throw new Error(`failed to stop residual runtime-smoke binary: ${result.stderr || result.stdout}`);
  }
}

function isResidualRuntimeBinaryRunning() {
  const result = runRuntimeBinaryProcessCommand(`
    $target = [IO.Path]::GetFullPath($env:PATINA_RUNTIME_SMOKE_BINARY)
    $processes = @(Get-Process patina -ErrorAction SilentlyContinue)
    foreach ($process in $processes) {
      try {
        if ($process.Path -and [IO.Path]::GetFullPath($process.Path) -ieq $target) {
          Write-Output 'running'
          break
        }
      } catch {
        # Treat an exiting process with an unreadable path as already gone.
      }
    }
    exit 0
  `);
  if (result?.error) {
    throw new Error(`failed to inspect residual runtime-smoke binary: ${result.stderr || result.stdout}`);
  }
  return result?.stdout.trim() === "running";
}

function measureRuntimeProcessTree() {
  const result = runRuntimeBinaryProcessCommand(`
    $target = [IO.Path]::GetFullPath($env:PATINA_RUNTIME_SMOKE_BINARY)
    $rootProcess = @(Get-Process patina -ErrorAction SilentlyContinue) | Where-Object {
      try { $_.Path -and [IO.Path]::GetFullPath($_.Path) -ieq $target } catch { $false }
    } | Select-Object -First 1
    if (-not $rootProcess) { throw 'runtime smoke root process not found' }
    $ids = [Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add([int]$rootProcess.Id)
    $coverage = 'root_only'
    try {
      $processRows = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId -ErrorAction Stop)
      do {
        $added = $false
        foreach ($row in $processRows) {
          if ($ids.Contains([int]$row.ParentProcessId) -and $ids.Add([int]$row.ProcessId)) {
            $added = $true
          }
        }
      } while ($added)
      $coverage = 'root_and_descendants'
    } catch {
      # Process-tree enumeration is a diagnostic enhancement. Some Windows
      # sessions stop CIM while the test is running; retain the exact root
      # measurement instead of failing unrelated runtime assertions.
    }
    $workingSet = 0L
    $privateUsage = 0L
    $measured = 0
    foreach ($id in $ids) {
      try {
        $process = Get-Process -Id $id -ErrorAction Stop
        $workingSet += [long]$process.WorkingSet64
        $privateUsage += [long]$process.PrivateMemorySize64
        $measured += 1
      } catch {}
    }
    [pscustomobject]@{
      rootPid = [int]$rootProcess.Id
      processCount = $measured
      workingSetBytes = $workingSet
      privateUsageBytes = $privateUsage
      coverage = $coverage
    } | ConvertTo-Json -Compress
  `);
  assert.ok(result && !result.error && result.status === 0, result?.stderr || result?.stdout);
  return JSON.parse(result.stdout.trim()) as {
    rootPid: number;
    processCount: number;
    workingSetBytes: number;
    privateUsageBytes: number;
    coverage: "root_only" | "root_and_descendants";
  };
}

function verifyDatabase(dbPath: string) {
  const script = [
    "import os, sqlite3, sys",
    "db = sqlite3.connect(sys.argv[1])",
    "integrity = db.execute('PRAGMA integrity_check').fetchone()[0]",
    "value = db.execute(\"SELECT value FROM settings WHERE key='refresh_interval_secs'\").fetchone()",
    "migration = db.execute('SELECT MAX(version) FROM _sqlx_migrations').fetchone()",
    "widget_sessions = db.execute(\"SELECT COUNT(*) FROM sessions WHERE lower(exe_name) = 'patina.exe' AND window_title = 'Patina Widget'\").fetchone()[0]",
    "states = dict(db.execute('SELECT model_name, state FROM read_model_state'))",
    "scheduled = db.execute('SELECT enabled, cadence, weekday, local_time_minutes, retention_count FROM scheduled_backup_config WHERE id = 1').fetchone()",
    "scheduled_columns = {row[1] for row in db.execute('PRAGMA table_info(scheduled_backup_config)')}",
    "run_columns = {row[1] for row in db.execute('PRAGMA table_info(scheduled_backup_runs)')}",
    "scheduled_export = db.execute('SELECT enabled, cadence, weekday, local_time_minutes, format, target_dir FROM scheduled_export_config WHERE id = 1').fetchone()",
    "scheduled_export_columns = {row[1] for row in db.execute('PRAGMA table_info(scheduled_export_config)')}",
    "scheduled_export_run_columns = {row[1] for row in db.execute('PRAGMA table_info(scheduled_export_runs)')}",
    "tables = {row[0] for row in db.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")}",
    "db.close()",
    "assert integrity == 'ok', integrity",
    "assert value == ('77',), value",
    "assert widget_sessions == 0, widget_sessions",
    "assert migration == (13,), migration",
    "assert states == {'app_catalog': 'ready', 'activity_hourly': 'ready'}, states",
    "assert scheduled == (0, 'weekly', 5, 1260, 1), scheduled",
    "assert {'target_kind', 'target_identity'} <= scheduled_columns, scheduled_columns",
    "assert {'target_kind', 'remote_etag'} <= run_columns, run_columns",
    "assert scheduled_export[:5] == (0, 'daily', None, 1260, 'csv'), scheduled_export",
    "normalize_path = lambda value: value.replace('\\\\', '/').lower().removeprefix('//?/')",
    "scheduled_export_target = normalize_path(scheduled_export[5])",
    "expected_export_target = normalize_path(os.path.join(os.path.dirname(sys.argv[1]), 'exports'))",
    "assert scheduled_export_target == expected_export_target, (scheduled_export_target, expected_export_target)",
    "assert {'format', 'selected_fields_json', 'plan_generation', 'schedule_anchor_at_ms'} <= scheduled_export_columns, scheduled_export_columns",
    "assert {'logical_start_date', 'logical_end_date', 'phase', 'status', 'sha256'} <= scheduled_export_run_columns, scheduled_export_run_columns",
    "assert {'recorded_app_catalog', 'activity_hourly_effective', 'activity_summary_dirty_ranges', 'app_catalog_dirty_keys', 'web_activity_revision', 'scheduled_backup_config', 'scheduled_backup_runs', 'scheduled_export_config', 'scheduled_export_runs'} <= tables, tables",
  ].join("; ");
  const result = spawnSync("python", ["-c", script, dbPath], { encoding: "utf8" });
  assert.equal(result.status, 0, `database verification failed: ${result.stderr || result.stdout}`);
}

function seedWebActivitySegment(dbPath: string) {
  const script = [
    "import sqlite3, sys",
    "db = sqlite3.connect(sys.argv[1])",
    "db.execute(\"INSERT INTO web_activity_segments (browser_client_id, browser_kind, browser_exe_name, domain, normalized_domain, start_time, end_time, duration, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\", ('runtime-smoke', 'chromium', 'chrome.exe', 'Example.COM', 'example.com', 1000, 3500, 2500, 'runtime-smoke', 1000, 3500))",
    "db.execute(\"INSERT INTO web_activity_segments (browser_client_id, browser_kind, browser_exe_name, domain, normalized_domain, start_time, end_time, duration, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\", ('runtime-smoke-2', 'chromium', 'chrome.exe', 'Docs.EXAMPLE', 'docs.example', 2000, 3000, 1000, 'runtime-smoke', 2000, 3000))",
    "db.commit()",
    "db.close()",
  ].join("; ");
  const result = spawnSync("python", ["-c", script, dbPath], { encoding: "utf8" });
  assert.equal(result.status, 0, `web activity seed failed: ${result.stderr || result.stdout}`);
}

const frontendPort = await reservePort();
const devtoolsPort = await reservePort();
const root = mkdtempSync(join(tmpdir(), "patina-tauri-e2e-"));
assertIsolatedTempPath(root, "patina-tauri-e2e-");
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const frontendDistDir = join(root, "frontend-dist");
const logs: string[] = [];
const webviewDiagnostics: string[] = [];
let appLaunchObserved = false;
let appLogTail = "";
let appProcess: ChildProcess | null = null;
let viteServer: PreviewServer | null = null;
let client: CdpConnection | null = null;
let widgetClient: CdpConnection | null = null;
let bridgePortBlocker: NetServer | null = null;
let webActivityBridgePort: number | null = null;
let primaryError: unknown = null;
const cleanupErrors: unknown[] = [];
let databaseMutationCompleted = false;

try {
  // Exercise the WebView against production-shaped static assets. A Vite dev
  // server sends hundreds of transformed modules and can exceed the product
  // readiness watchdog on a busy hosted runner even after graph warmup.
  await buildVite({
    configFile: "vite.config.ts",
    logLevel: "error",
    build: {
      outDir: frontendDistDir,
      emptyOutDir: true,
    },
  });
  viteServer = await previewVite({
    configFile: "vite.config.ts",
    logLevel: "error",
    build: {
      outDir: frontendDistDir,
    },
    preview: {
      host: "127.0.0.1",
      port: frontendPort,
      strictPort: true,
    },
  });
  await waitFor("Vite static preview", async () => {
    try {
      return (await fetch(frontendUrl, { signal: AbortSignal.timeout(1_000) })).ok;
    } catch {
      return null;
    }
  }, 30_000);
  console.log("PATINA_FRONTEND_SERVE_REPORT", JSON.stringify({
    mode: "production-static-preview",
    output: "isolated",
  }));

  const tauriConfigOverride = {
    identifier: "com.ceceliaee.patina.runtime-smoke",
    build: {
      beforeDevCommand: "",
      devUrl: frontendUrl,
    },
  };
  const tauriConfigOverrideJson = JSON.stringify(tauriConfigOverride);
  const tauriConfigOverridePath = join(root, "tauri.runtime-smoke.conf.json");
  writeFileSync(tauriConfigOverridePath, tauriConfigOverrideJson, "utf8");
  appProcess = spawn(process.execPath, [
    join(process.cwd(), "node_modules", "@tauri-apps", "cli", "tauri.js"),
    "dev",
    "--no-watch",
    "--config",
    tauriConfigOverridePath,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATINA_E2E: "1",
      PATINA_E2E_SINGLE_INSTANCE: "1",
      PATINA_E2E_DATA_ROOT: root,
      PATINA_E2E_FRONTEND_URL: frontendUrl,
      PATINA_E2E_DEVTOOLS_PORT: String(devtoolsPort),
      PATINA_E2E_WIDGET_SHOW_FAILURES: "3",
      CARGO_TARGET_DIR: RUNTIME_TARGET_DIR,
      TAURI_CONFIG: tauriConfigOverrideJson,
      WEBVIEW2_USER_DATA_FOLDER: join(root, "webview-user-data"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const captureAppLog = (chunk: unknown) => {
    const text = String(chunk);
    logs.push(text);
    appLogTail = `${appLogTail}${text}`.slice(-4_096);
    if (/Running[\s\S]*patina\.exe/i.test(appLogTail)) {
      appLaunchObserved = true;
    }
  };
  appProcess.stdout?.on("data", captureAppLog);
  appProcess.stderr?.on("data", captureAppLog);

  await waitFor(
    "Tauri cold build and process launch",
    () => {
      if (appLaunchObserved) return true;
      if (appProcess && appProcess.exitCode !== null) {
        throw new Error(`Tauri dev exited before launching Patina (exit ${appProcess.exitCode})`);
      }
      return null;
    },
    COLD_BUILD_TIMEOUT_MS,
  );

  const target = await waitFor(
    "Patina main WebView CDP target",
    () => findMainTarget(devtoolsPort),
    WEBVIEW_STARTUP_TIMEOUT_MS,
  );
  assert.ok(
    target.url?.startsWith(frontendUrl),
    `Tauri runtime loaded unexpected frontend URL: ${target.url ?? "missing URL"}`,
  );
  client = await CdpConnection.connect(target.webSocketDebuggerUrl!);
  await client.command("Runtime.enable");
  await client.command("Page.enable");
  await client.command("Log.enable");
  client.onMessage((message) => {
    const method = String(message.method ?? "");
    if (
      method === "Runtime.consoleAPICalled"
      || method === "Runtime.exceptionThrown"
      || method === "Log.entryAdded"
    ) {
      webviewDiagnostics.push(JSON.stringify(message).slice(0, 4_096));
    }
  });
  await waitFor(
    "real Tauri runtime",
    async () => evaluate(client!, "Boolean(window.__TAURI_INTERNALS__ && document.querySelector('#root')?.children.length)"),
    30_000,
  );

  bridgePortBlocker = await occupyPort();
  const bridgeBlockerAddress = bridgePortBlocker.address();
  assert.ok(bridgeBlockerAddress && typeof bridgeBlockerAddress === "object");
  webActivityBridgePort = bridgeBlockerAddress.port;
  await evaluate(client, `
    window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
      mutations: [
        {
          key: "web_activity_enabled",
          value: "1",
        },
        {
          key: "web_activity_port",
          value: "${webActivityBridgePort}",
        },
        {
          key: "web_activity_token",
          value: "runtime-smoke-bridge-secret",
        },
      ],
    })
  `);
  const retryingBridgeDiagnostics = await waitFor(
    "web activity bridge retry wait",
    async () => {
      const diagnostics = await evaluate(
        client!,
        `window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")`,
      ) as {
        web_activity_bridge?: {
          runtime?: {
            status?: string;
            port?: number | null;
            last_error_category?: string | null;
            retry_count?: number;
          };
        };
      };
      return diagnostics.web_activity_bridge?.runtime?.status === "retry-wait"
        ? diagnostics
        : null;
    },
    10_000,
  );
  assert.equal(
    retryingBridgeDiagnostics.web_activity_bridge?.runtime?.port,
    webActivityBridgePort,
  );
  assert.equal(
    retryingBridgeDiagnostics.web_activity_bridge?.runtime?.last_error_category,
    "address-in-use",
  );
  assert.ok(
    Number(retryingBridgeDiagnostics.web_activity_bridge?.runtime?.retry_count) >= 1,
  );
  assert.doesNotMatch(JSON.stringify(retryingBridgeDiagnostics), /token/i);

  await closeNetServer(bridgePortBlocker);
  bridgePortBlocker = null;
  const listeningBridgeDiagnostics = await waitFor(
    "web activity bridge automatic port recovery",
    async () => {
      const diagnostics = await evaluate(
        client!,
        `window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")`,
      ) as {
        web_activity_bridge?: {
          runtime?: {
            status?: string;
            retry_count?: number;
            last_error_category?: string | null;
          };
        };
      };
      return diagnostics.web_activity_bridge?.runtime?.status === "listening"
        ? diagnostics
        : null;
    },
    35_000,
  );
  assert.equal(listeningBridgeDiagnostics.web_activity_bridge?.runtime?.retry_count, 0);
  assert.equal(
    listeningBridgeDiagnostics.web_activity_bridge?.runtime?.last_error_category,
    null,
  );

  let mainWindowReadinessObservation: unknown = null;
  let mainWindowGeneration: number;
  try {
    mainWindowGeneration = await waitFor(
      "frontend main-window readiness handshake",
      async () => {
        mainWindowReadinessObservation = await evaluate(client!, `(async () => {
          const frame = document.querySelector(".qp-app-frame");
          const frameStyle = frame ? getComputedStyle(frame) : null;
          let renderToken = null;
          let renderTokenError = null;
          try {
            renderToken = await window.__TAURI_INTERNALS__.invoke(
              "cmd_get_main_window_render_token",
            );
          } catch (error) {
            renderTokenError = String(error);
          }
          return {
            generation: window.__PATINA_MAIN_WINDOW_GENERATION__ ?? null,
            windowLabel: window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null,
            documentWindowLabel: document.documentElement.dataset.windowLabel ?? null,
            frameConnected: Boolean(frame?.isConnected),
            frameWidth: frame?.getBoundingClientRect().width ?? null,
            frameHeight: frame?.getBoundingClientRect().height ?? null,
            frameDisplay: frameStyle?.display ?? null,
            frameVisibility: frameStyle?.visibility ?? null,
            frameBackground: frameStyle?.backgroundColor ?? null,
            themeMode: document.documentElement.dataset.themeMode ?? null,
            theme: document.documentElement.dataset.theme ?? null,
            colorScheme: document.documentElement.dataset.colorScheme ?? null,
            cssColorScheme: document.documentElement.style.colorScheme || null,
            renderToken,
            renderTokenError,
          };
        })()`);
        const observation = mainWindowReadinessObservation as {
          generation?: unknown;
        } | null;
        return typeof observation?.generation === "number"
          && logs.join("").includes("event=frontend-ready")
          ? observation.generation
          : null;
      },
      10_000,
    );
  } catch (error) {
    throw new AggregateError([
      error,
      new Error(
        `main-window readiness observation: ${JSON.stringify(mainWindowReadinessObservation)}`,
      ),
      ...(webviewDiagnostics.length > 0
        ? [new Error(`WebView diagnostics:\n${webviewDiagnostics.join("\n")}`)]
        : []),
    ], "frontend main-window readiness handshake failed");
  }
  assert.ok(Number.isSafeInteger(mainWindowGeneration) && mainWindowGeneration > 0);
  const mainWindowRenderToken = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_main_window_render_token")`,
  ) as {
    generation: number;
    loadEpoch: number;
  };
  assert.equal(mainWindowRenderToken.generation, mainWindowGeneration);
  assert.ok(
    Number.isSafeInteger(mainWindowRenderToken.loadEpoch)
      && mainWindowRenderToken.loadEpoch > 0,
  );
  const duplicateReady = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("cmd_mark_main_window_ready", {
      generation: ${mainWindowGeneration},
      loadEpoch: ${mainWindowRenderToken.loadEpoch},
    })`,
  );
  assert.deepEqual(duplicateReady, {
    outcome: "duplicate",
    generation: mainWindowGeneration,
    loadEpoch: mainWindowRenderToken.loadEpoch,
  });

  const initialMainWindowVisible = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
  );
  assert.equal(initialMainWindowVisible, false, "fresh-install start minimized should keep the main window hidden");
  assert.match(logs.join(""), /\[startup\] source=manual strategy=start-in-tray-optimized/);

  let destroyCommandError: string | null = null;
  try {
    await evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("cmd_e2e_destroy_hidden_main_window")`,
    );
  } catch (error) {
    // Destroying the WebView can close CDP before the command response arrives.
    destroyCommandError = String(error);
  }
  client.close();
  client = null;
  try {
    await waitFor(
      "destroyed main WebView target to disappear",
      async () => (await findMainTarget(devtoolsPort)) ? null : true,
      10_000,
    );
  } catch (error) {
    throw new AggregateError([
      error,
      new Error(`E2E destroy command error: ${destroyCommandError ?? "none"}`),
      new Error(`main-window log tail: ${logs.join("").slice(-4_096)}`),
    ], "hidden main WebView destruction was not observed");
  }

  const secondaryInstance = spawnSync(RUNTIME_BINARY_PATH, [], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      PATINA_E2E: "1",
      PATINA_E2E_SINGLE_INSTANCE: "1",
      PATINA_E2E_DATA_ROOT: root,
      PATINA_E2E_FRONTEND_URL: frontendUrl,
      PATINA_E2E_DEVTOOLS_PORT: String(devtoolsPort),
      CARGO_TARGET_DIR: RUNTIME_TARGET_DIR,
      TAURI_CONFIG: tauriConfigOverrideJson,
      WEBVIEW2_USER_DATA_FOLDER: join(root, "webview-user-data"),
    },
  });
  assert.equal(
    secondaryInstance.status,
    0,
    `secondary instance failed: ${secondaryInstance.stderr || secondaryInstance.stdout}`,
  );

  const recoveredTarget = await waitFor(
    "single-instance main WebView recreation",
    () => findMainTarget(devtoolsPort),
    WEBVIEW_STARTUP_TIMEOUT_MS,
  );
  client = await CdpConnection.connect(recoveredTarget.webSocketDebuggerUrl!);
  await client.command("Runtime.enable");
  await client.command("Page.enable");
  await client.command("Log.enable");
  await waitFor(
    "single-instance recreated main window bridge",
    async () => evaluate(
      client!,
      "Boolean(window.__TAURI_INTERNALS__?.invoke && document.querySelector('#root')?.children.length)",
    ),
    WEBVIEW_STARTUP_TIMEOUT_MS,
  );
  await waitFor(
    "single-instance recreated main window visibility",
    async () => evaluate(
      client!,
      `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
    ),
    10_000,
  );
  mainWindowGeneration = Number(await evaluate(
    client,
    `window.__PATINA_MAIN_WINDOW_GENERATION__`,
  ));
  assert.match(logs.join(""), /reason=single-instance[\s\S]*result=visible/);

  const trayRevealStartedAt = Date.now();
  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")`);
  await waitFor(
    "main window recovery from hidden startup",
    async () => evaluate(
      client!,
      `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
    ),
    10_000,
  );
  const trayRevealElapsedMs = Date.now() - trayRevealStartedAt;
  assert.ok(
    trayRevealElapsedMs < 2_000,
    `a preloaded tray reveal should complete near-immediately, got ${trayRevealElapsedMs}ms`,
  );
  assert.doesNotMatch(
    logs.join(""),
    /event=ready-timeout/,
    "normal startup and tray reveal must not depend on the readiness watchdog",
  );
  const firstVisibleAppearance = await evaluate(client, `({
    frameConnected: Boolean(document.querySelector(".qp-app-frame")?.isConnected),
    frameWidth: document.querySelector(".qp-app-frame")?.getBoundingClientRect().width ?? 0,
    frameHeight: document.querySelector(".qp-app-frame")?.getBoundingClientRect().height ?? 0,
    frameBackground: document.querySelector(".qp-app-frame")
      ? getComputedStyle(document.querySelector(".qp-app-frame")).backgroundColor
      : "transparent",
    themeMode: document.documentElement.dataset.themeMode,
    theme: document.documentElement.dataset.theme,
    colorScheme: document.documentElement.dataset.colorScheme,
    cssColorScheme: document.documentElement.style.colorScheme,
  })`) as {
    frameConnected: boolean;
    frameWidth: number;
    frameHeight: number;
    frameBackground: string;
    themeMode?: string;
    theme?: string;
    colorScheme?: string;
    cssColorScheme?: string;
  };
  assert.equal(firstVisibleAppearance.frameConnected, true);
  assert.ok(firstVisibleAppearance.frameWidth > 0);
  assert.ok(firstVisibleAppearance.frameHeight > 0);
  assert.notEqual(firstVisibleAppearance.frameBackground, "transparent");
  assert.notEqual(firstVisibleAppearance.frameBackground, "rgba(0, 0, 0, 0)");
  assert.deepEqual({
    themeMode: firstVisibleAppearance.themeMode,
    theme: firstVisibleAppearance.theme,
    colorScheme: firstVisibleAppearance.colorScheme,
    cssColorScheme: firstVisibleAppearance.cssColorScheme,
  }, {
    themeMode: "light",
    theme: "light",
    colorScheme: "default",
    cssColorScheme: "light",
  });

  await evaluate(
    client,
    `localStorage.setItem("patina:last-active-view", "data")`,
  );
  const logsBeforeReload = logs.join("");
  await client.command("Page.reload", { ignoreCache: true });
  await waitFor(
    "main window reload readiness recovery",
    async () => {
      try {
        const visible = await evaluate(
          client!,
          `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
        );
        const reloadLogs = logs.join("").slice(logsBeforeReload.length);
        return visible === true
          && reloadLogs.includes("event=page-load-started")
          && reloadLogs.includes("result=hidden-until-ready")
          && reloadLogs.includes("event=frontend-ready")
          && reloadLogs.includes("result=accepted-reveal")
          && reloadLogs.includes("event=show-succeeded")
          ? true
          : null;
      } catch {
        return null;
      }
    },
    15_000,
  );
  const reloadAppearance = await evaluate(client, `({
    frameConnected: Boolean(document.querySelector(".qp-app-frame")?.isConnected),
    htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    rootBackground: getComputedStyle(document.querySelector("#root")).backgroundColor,
    presentedView: document.querySelector("main.qp-canvas")?.dataset.presentedView ?? null,
    transitionState: document.querySelector("main.qp-canvas")?.dataset.viewTransitionState ?? null,
  })`) as {
    frameConnected: boolean;
    htmlBackground: string;
    bodyBackground: string;
    rootBackground: string;
    presentedView: string | null;
    transitionState: string | null;
  };
  assert.equal(reloadAppearance.frameConnected, true);
  assert.equal(reloadAppearance.presentedView, "data");
  assert.equal(reloadAppearance.transitionState, "settled");
  for (const background of [
    reloadAppearance.htmlBackground,
    reloadAppearance.bodyBackground,
    reloadAppearance.rootBackground,
  ]) {
    assert.notEqual(background, "transparent");
    assert.notEqual(background, "rgba(0, 0, 0, 0)");
  }

  const firstMinimizeError = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("cmd_minimize_main_window")
      .then(() => null, (error) => error)`,
  ) as {
    code?: string;
    message?: string;
    retryable?: boolean;
  };
  assert.equal(firstMinimizeError.code, "MAIN_WINDOW_MINIMIZE_FAILED");
  assert.equal(firstMinimizeError.retryable, true);
  assert.match(firstMinimizeError.message ?? "", /failed to show widget after 2 attempts/);
  const mainVisibleAfterColdFailure = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
  );
  assert.equal(
    mainVisibleAfterColdFailure,
    true,
    "a cold widget creation failure must preserve the visible main window",
  );

  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_minimize_main_window")`);
  await waitFor(
    "cold widget creation after transient retry",
    async () => {
      const [mainVisible, widgetVisible] = await Promise.all([
        evaluate(
          client!,
          `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
        ),
        evaluate(
          client!,
          `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "widget" })`,
        ),
      ]);
      return mainVisible === false && widgetVisible === true ? true : null;
    },
    10_000,
  );

  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")`);
  await waitFor(
    "main window recovery after cold widget creation",
    async () => {
      const [mainVisible, widgetVisible] = await Promise.all([
        evaluate(
          client!,
          `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
        ),
        evaluate(
          client!,
          `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "widget" })`,
        ),
      ]);
      return mainVisible === true && widgetVisible === false ? true : null;
    },
    10_000,
  );

  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_minimize_main_window")`);
  await waitFor(
    "warm widget reuse",
    async () => {
      const [mainVisible, widgetVisible] = await Promise.all([
        evaluate(
          client!,
          `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
        ),
        evaluate(
          client!,
          `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "widget" })`,
        ),
      ]);
      return mainVisible === false && widgetVisible === true ? true : null;
    },
    10_000,
  );
  const finalizedWidgetPlacement = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("cmd_finalize_widget_drag", {
      releasePosition: null,
      expanded: false,
      toolSlotCount: 0
    })`,
  ) as {
    monitor?: {
      name?: string | null;
      work_area?: { x?: number; y?: number; width?: number; height?: number };
    } | null;
    side?: string;
    anchor_y?: number;
  };
  assert.ok(finalizedWidgetPlacement.monitor, "finalized widget placement must retain a monitor");
  assert.ok((finalizedWidgetPlacement.monitor.work_area?.width ?? 0) > 0);
  assert.ok((finalizedWidgetPlacement.monitor.work_area?.height ?? 0) > 0);
  assert.match(finalizedWidgetPlacement.side ?? "", /^(left|right)$/);
  assert.ok(
    typeof finalizedWidgetPlacement.anchor_y === "number"
      && finalizedWidgetPlacement.anchor_y >= 0
      && finalizedWidgetPlacement.anchor_y <= 1,
  );
  const [finalizedWidgetPosition, finalizedWidgetSize] = await Promise.all([
    evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("plugin:window|outer_position", { label: "widget" })`,
    ) as Promise<{ x?: number; y?: number }>,
    evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("plugin:window|outer_size", { label: "widget" })`,
    ) as Promise<{ width?: number; height?: number }>,
  ]);
  const finalizedWorkArea = finalizedWidgetPlacement.monitor.work_area;
  assert.ok(Number.isInteger(finalizedWidgetPosition.x));
  assert.ok(Number.isInteger(finalizedWidgetPosition.y));
  assert.ok((finalizedWidgetSize.width ?? 0) > 0);
  assert.ok((finalizedWidgetSize.height ?? 0) > 0);
  if (finalizedWidgetPlacement.side === "left") {
    assert.equal(finalizedWidgetPosition.x, finalizedWorkArea?.x);
  } else {
    assert.equal(
      (finalizedWidgetPosition.x ?? 0) + (finalizedWidgetSize.width ?? 0),
      (finalizedWorkArea?.x ?? 0) + (finalizedWorkArea?.width ?? 0),
    );
  }
  assert.ok((finalizedWidgetPosition.y ?? 0) >= (finalizedWorkArea?.y ?? 0));
  assert.ok(
    (finalizedWidgetPosition.y ?? 0) + (finalizedWidgetSize.height ?? 0)
      <= (finalizedWorkArea?.y ?? 0) + (finalizedWorkArea?.height ?? 0),
  );
  const leftWidgetPlacement = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("cmd_finalize_widget_drag", {
      releasePosition: {
        x: ${finalizedWorkArea?.x ?? 0},
        y: ${(finalizedWidgetPosition.y ?? 0) + Math.floor((finalizedWidgetSize.height ?? 1) / 2)}
      },
      expanded: false,
      toolSlotCount: 0
    })`,
  ) as typeof finalizedWidgetPlacement;
  assert.equal(leftWidgetPlacement.side, "left");
  const leftWidgetPosition = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("plugin:window|outer_position", { label: "widget" })`,
  ) as { x?: number; y?: number };
  assert.equal(leftWidgetPosition.x, finalizedWorkArea?.x);
  const reloadedWidgetPlacement = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_widget_placement")`,
  );
  assert.deepEqual(reloadedWidgetPlacement, leftWidgetPlacement);
  const widgetTarget = await waitFor(
    "Patina widget WebView CDP target",
    () => findWidgetTarget(devtoolsPort, target.webSocketDebuggerUrl!),
    10_000,
  );
  widgetClient = await CdpConnection.connect(widgetTarget.webSocketDebuggerUrl!);
  await widgetClient.command("Runtime.enable");
  await waitFor(
    "real Tauri widget runtime",
    async () => evaluate(
      widgetClient!,
      "Boolean(window.__TAURI_INTERNALS__ && document.querySelector('.widget-shell'))",
    ),
    10_000,
  );
  await waitFor(
    "widget DOM side matches the native left-edge placement",
    async () => evaluate(
      widgetClient!,
      `document.querySelector('.widget-shell')?.classList.contains('widget-shell-left') === true`,
    ),
    10_000,
  );
  assert.equal(
    await evaluate(
      widgetClient,
      `(() => {
        const rect = document.querySelector('.widget-pill-anchor-collapsed')?.getBoundingClientRect();
        return Boolean(rect && rect.left < 0 && rect.right > 0);
      })()`,
    ),
    true,
    "the collapsed anchor must straddle the widget window's left edge",
  );
  await evaluate(
    widgetClient,
    `document.querySelector('.widget-pill-anchor')?.click()`,
  );
  await waitFor(
    "real widget expanded status bar",
    async () => evaluate(
      widgetClient!,
      `document.querySelector('.widget-shell')?.classList.contains('widget-shell-expanded') === true
        && document.querySelectorAll('.widget-pill-actions button').length === 2`,
    ),
    10_000,
  );
  const expandedLeftWidgetSize = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("plugin:window|outer_size", { label: "widget" })`,
  ) as { width?: number; height?: number };
  assert.ok(
    (expandedLeftWidgetSize.width ?? 0) > (finalizedWidgetSize.width ?? 0),
    "expanded Widget must allocate the stable tracking and action bar",
  );
  const expandedLeftEvidence = await evaluate(
    widgetClient,
    `(() => {
      const tray = document.querySelector('.widget-pill-tray')?.getBoundingClientRect();
      const tracking = document.querySelector('.widget-pill-tracking-core')?.getBoundingClientRect();
      const actions = document.querySelector('.widget-pill-actions')?.getBoundingClientRect();
      const anchor = document.querySelector('.widget-pill-anchor')?.getBoundingClientRect();
      const pinIconElement = document.querySelector('.widget-pin-icon');
      const pinIcon = pinIconElement?.getBoundingClientRect();
      const trackingText = document.querySelector('.widget-pill-tracking-time')?.textContent?.trim() ?? '';
      return {
        trayVisible: Boolean(tray && tray.left >= 0 && tray.right <= innerWidth),
        pinIconVisible: Boolean(pinIcon && pinIcon.left >= 0 && pinIcon.right <= innerWidth
          && pinIcon.top >= 0 && pinIcon.bottom <= innerHeight),
        pinIconIsCanonical: pinIconElement?.classList.contains('lucide-pin') === true,
        orderedInward: Boolean(anchor && actions && tracking
          && anchor.right <= actions.left + 0.5
          && actions.right <= tracking.left + 0.5),
        trackingText,
        pauseButtonCount: Array.from(document.querySelectorAll('button')).filter(
          (button) => /pause|暂停/i.test(button.getAttribute('aria-label') ?? '')
        ).length,
      };
    })()` ,
  ) as {
    trayVisible?: boolean;
    pinIconVisible?: boolean;
    pinIconIsCanonical?: boolean;
    orderedInward?: boolean;
    trackingText?: string;
    pauseButtonCount?: number;
  };
  assert.equal(expandedLeftEvidence.trayVisible, true);
  assert.equal(expandedLeftEvidence.pinIconVisible, true);
  assert.equal(expandedLeftEvidence.pinIconIsCanonical, true);
  assert.equal(expandedLeftEvidence.orderedInward, true);
  assert.match(expandedLeftEvidence.trackingText ?? "", /^(?:—|\d{2}:\d{2})$/);
  assert.equal(expandedLeftEvidence.pauseButtonCount, 0);

  const expandedDragPlacement = await evaluate(
    widgetClient,
    `window.__TAURI_INTERNALS__.invoke("cmd_finalize_widget_drag", {
      releasePosition: {
        x: ${(finalizedWorkArea?.x ?? 0) + (finalizedWorkArea?.width ?? 1) - 1},
        y: ${(finalizedWidgetPosition.y ?? 0) + Math.floor((expandedLeftWidgetSize.height ?? 1) / 2)}
      },
      expanded: true,
      toolSlotCount: 0
    })`,
  ) as typeof finalizedWidgetPlacement;
  assert.equal(expandedDragPlacement.side, "right");
  const [expandedDragPosition, expandedDragSize] = await Promise.all([
    evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("plugin:window|outer_position", { label: "widget" })`,
    ) as Promise<{ x?: number; y?: number }>,
    evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("plugin:window|outer_size", { label: "widget" })`,
    ) as Promise<{ width?: number; height?: number }>,
  ]);
  assert.equal(
    (expandedDragPosition.x ?? 0) + (expandedDragSize.width ?? 0),
    (finalizedWorkArea?.x ?? 0) + (finalizedWorkArea?.width ?? 0),
    "expanded widget drag must snap its native window back to the chosen screen edge",
  );
  await waitFor(
    "expanded widget DOM mirrors native drag side",
    async () => evaluate(
      widgetClient!,
      `document.querySelector('.widget-shell')?.classList.contains('widget-shell-right') === true`,
    ),
    10_000,
  );

  await evaluate(widgetClient, `document.querySelector('.widget-pill-pin-action')?.click()`);
  await waitFor(
    "native widget pin persistence",
    async () => {
      const bootstrap = await evaluate(
        widgetClient!,
        `window.__TAURI_INTERNALS__.invoke("cmd_get_widget_bootstrap_snapshot")`,
      ) as { pinned?: boolean };
      return bootstrap.pinned === true ? true : null;
    },
    10_000,
  );
  assert.equal(
    await evaluate(widgetClient, `document.querySelector('.widget-pill-pin-action')?.classList.contains('qp-icon-action-pressed')`),
    false,
    "pinned state must not add persistent selected chrome",
  );
  await evaluate(widgetClient, `document.querySelector('.widget-pill-pin-action')?.click()`);
  await waitFor(
    "native widget unpin persistence",
    async () => {
      const bootstrap = await evaluate(
        widgetClient!,
        `window.__TAURI_INTERNALS__.invoke("cmd_get_widget_bootstrap_snapshot")`,
      ) as { pinned?: boolean };
      return bootstrap.pinned === false ? true : null;
    },
    10_000,
  );
  await evaluate(widgetClient, `document.querySelector('.widget-pill-anchor')?.click()`);
  await waitFor(
    "real widget collapse after unpin",
    async () => evaluate(
      widgetClient!,
      `document.querySelector('.widget-shell')?.classList.contains('widget-shell-collapsed') === true`,
    ),
    10_000,
  );
  const rightWidgetPlacement = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("cmd_finalize_widget_drag", {
      releasePosition: {
        x: ${(finalizedWorkArea?.x ?? 0) + (finalizedWorkArea?.width ?? 1) - 1},
        y: ${(finalizedWidgetPosition.y ?? 0) + Math.floor((finalizedWidgetSize.height ?? 1) / 2)}
      },
      expanded: false,
      toolSlotCount: 0
    })`,
  ) as typeof finalizedWidgetPlacement;
  assert.equal(rightWidgetPlacement.side, "right");
  const [rightWidgetPosition, rightWidgetSize] = await Promise.all([
    evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("plugin:window|outer_position", { label: "widget" })`,
    ) as Promise<{ x?: number; y?: number }>,
    evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("plugin:window|outer_size", { label: "widget" })`,
    ) as Promise<{ width?: number; height?: number }>,
  ]);
  assert.equal(
    (rightWidgetPosition.x ?? 0) + (rightWidgetSize.width ?? 0),
    (finalizedWorkArea?.x ?? 0) + (finalizedWorkArea?.width ?? 0),
  );
  await waitFor(
    "widget DOM side follows a native right-edge placement update",
    async () => evaluate(
      widgetClient!,
      `document.querySelector('.widget-shell')?.classList.contains('widget-shell-right') === true`,
    ),
    10_000,
  );
  assert.equal(
    await evaluate(
      widgetClient,
      `(() => {
        const rect = document.querySelector('.widget-pill-anchor-collapsed')?.getBoundingClientRect();
        return Boolean(rect && rect.left < window.innerWidth && rect.right > window.innerWidth);
      })()`,
    ),
    true,
    "the collapsed anchor must straddle the widget window's right edge",
  );
  const restoredLeftWidgetPlacement = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("cmd_finalize_widget_drag", {
      releasePosition: {
        x: ${finalizedWorkArea?.x ?? 0},
        y: ${(finalizedWidgetPosition.y ?? 0) + Math.floor((finalizedWidgetSize.height ?? 1) / 2)}
      },
      expanded: false,
      toolSlotCount: 0
    })`,
  ) as typeof finalizedWidgetPlacement;
  assert.equal(restoredLeftWidgetPlacement.side, "left");
  await waitFor(
    "widget DOM side follows the restored native left-edge placement",
    async () => evaluate(
      widgetClient!,
      `document.querySelector('.widget-shell')?.classList.contains('widget-shell-left') === true`,
    ),
    10_000,
  );
  assert.equal(
    await evaluate(
      widgetClient,
      `(() => {
        const rect = document.querySelector('.widget-pill-anchor-collapsed')?.getBoundingClientRect();
        return Boolean(rect && rect.left < 0 && rect.right > 0);
      })()`,
    ),
    true,
    "restoring the left placement must restore the left-edge visible crescent",
  );
  const widgetBootstrap = await evaluate(
    widgetClient,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_widget_bootstrap_snapshot")`,
  ) as {
    settings?: Record<string, string | null>;
    pinned?: boolean;
    app_overrides?: unknown[];
  };
  assert.equal(typeof widgetBootstrap.settings, "object");
  assert.equal(typeof widgetBootstrap.pinned, "boolean");
  assert.ok(Array.isArray(widgetBootstrap.app_overrides));
  const widgetPresentation = await evaluate(
    widgetClient,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_widget_status_snapshot")`,
  ) as {
    window?: { exe_name?: string };
    tracking_status?: { is_tracking_active?: boolean };
    tracking_sampled_at_ms?: number;
    status?: { tracking?: unknown; tools?: unknown[]; sampled_at_ms?: number };
  };
  assert.equal(typeof widgetPresentation.window?.exe_name, "string");
  assert.equal(
    typeof widgetPresentation.tracking_status?.is_tracking_active,
    "boolean",
  );
  assert.equal(typeof widgetPresentation.tracking_sampled_at_ms, "number");
  assert.ok(
    widgetPresentation.status?.tracking === null
      || typeof widgetPresentation.status?.tracking === "object",
  );
  assert.ok(Array.isArray(widgetPresentation.status?.tools));
  assert.equal(typeof widgetPresentation.status?.sampled_at_ms, "number");

  for (const deniedExpression of [
    `window.__TAURI_INTERNALS__.invoke("plugin:sql|select", {
      db: "sqlite:patina.db",
      query: "SELECT key FROM settings",
      values: [],
    })`,
    `window.__TAURI_INTERNALS__.invoke("plugin:sql|load", {
      db: "sqlite:patina.db",
    })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_storage_snapshot")`,
    `window.__TAURI_INTERNALS__.invoke("cmd_restore_backup", {
      backupPath: "permission-probe.zip",
      hash: "permission-probe",
      restoreStrategy: "replace",
    })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_reveal_webdav_backup_secret")`,
    `window.__TAURI_INTERNALS__.invoke("cmd_delete_sessions_before", {
      cutoffTime: 0,
    })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_install_update")`,
  ]) {
    const denied = await evaluate(
      widgetClient,
      `${deniedExpression}.then(() => null, (error) => String(error))`,
    );
    assert.match(String(denied), /not allowed|permission|denied/i);
  }
  widgetClient.close();
  widgetClient = null;
  console.log("PATINA_FIRST_MINIMIZE_RECOVERY_REPORT", JSON.stringify({
    environment: "isolated real Tauri/WebView2 runtime",
    hardFailurePreservedMain: true,
    transientFailureRetried: true,
    coldWidgetCreationSucceeded: true,
    warmWidgetReuseSucceeded: true,
  }));

  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")`);
  await waitFor(
    "main window recovery after warm widget reuse",
    async () => evaluate(
      client!,
      `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
    ),
    10_000,
  );

  const startupVisibilityLogs = logs.join("");
  const createdLogIndex = startupVisibilityLogs.indexOf("event=created");
  const readyLogIndex = startupVisibilityLogs.indexOf("event=frontend-ready");
  const showLogIndex = startupVisibilityLogs.indexOf("event=show-succeeded");
  assert.ok(createdLogIndex >= 0, "main-window creation log is missing");
  assert.ok(readyLogIndex > createdLogIndex, "frontend-ready must follow hidden creation");
  assert.ok(showLogIndex > readyLogIndex, "show must follow frontend readiness");
  assert.doesNotMatch(startupVisibilityLogs, /event=ready-timeout/);
  const eventElapsedMs = (event: string) => {
    const match = startupVisibilityLogs.match(
      new RegExp(`\\[main-window\\] event=${event}[^\\r\\n]*elapsed_ms=(\\d+)`),
    );
    assert.ok(match, `${event} elapsed time is missing`);
    return Number(match[1]);
  };
  console.log("PATINA_MAIN_WINDOW_READINESS_REPORT", JSON.stringify({
    sampleCount: 1,
    environment: "isolated real Tauri/WebView2 runtime",
    generation: mainWindowGeneration,
    createdElapsedMs: eventElapsedMs("created"),
    frontendReadyElapsedMs: eventElapsedMs("frontend-ready"),
    showSucceededElapsedMs: eventElapsedMs("show-succeeded"),
    trayRevealElapsedMs,
    watchdogUsed: false,
    firstVisibleAppearance,
  }));

  const storage = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_get_storage_snapshot")`);
  assert.equal(typeof storage, "object");

  // Freeze the isolated tracker before asserting read-model contents. A live
  // foreground sample is valid here, so the test waits for projections to
  // drain instead of assuming the source revision will remain zero.
  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [{ key: "tracking_paused", value: "1" }],
  })`);

  let readySourceRevision: number | null = null;
  let readySourceRevisionPolls = 0;
  const readModelStatus = await waitFor(
    "activity read models ready",
    async () => {
      const value = await evaluate(
        client!,
        `window.__TAURI_INTERNALS__.invoke("cmd_get_activity_read_model_status")`,
      ) as {
        sourceRevision?: number;
        appCatalogState?: string;
        activityHourlyState?: string;
        dirtyAppCount?: number;
        dirtyRangeCount?: number;
      };
      const isReady = Number.isSafeInteger(value.sourceRevision)
        && value.appCatalogState === "ready"
        && value.activityHourlyState === "ready"
        && value.dirtyAppCount === 0
        && value.dirtyRangeCount === 0;
      if (!isReady) {
        readySourceRevision = null;
        readySourceRevisionPolls = 0;
        return null;
      }
      if (value.sourceRevision === readySourceRevision) {
        readySourceRevisionPolls += 1;
      } else {
        readySourceRevision = value.sourceRevision!;
        readySourceRevisionPolls = 1;
      }
      return readySourceRevisionPolls >= 3 ? value : null;
    },
    10_000,
  ) as {
    sourceRevision: number;
    appCatalogState: string;
    activityHourlyState: string;
    activityCoverageStartMs: number | null;
    activityCoverageEndMs: number | null;
    dirtyAppCount: number;
    dirtyRangeCount: number;
  };
  assert.ok(Number.isSafeInteger(readModelStatus.sourceRevision));
  assert.ok(readModelStatus.sourceRevision >= 0);
  assert.equal(readModelStatus.appCatalogState, "ready");
  assert.equal(readModelStatus.activityHourlyState, "ready");
  assert.equal(readModelStatus.dirtyAppCount, 0);
  assert.equal(readModelStatus.dirtyRangeCount, 0);

  const catalogPage = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_recorded_app_catalog_page", {
      cursor: null,
      searchQuery: "",
      limit: 50,
    })`,
  ) as {
    rows: unknown[];
    nextCursor: unknown;
    hasMore: boolean;
    readPath: string;
    fallbackReason: unknown;
    sourceRevision: number;
  };
  assert.ok(Array.isArray(catalogPage.rows));
  assert.equal(catalogPage.hasMore, false);
  if (catalogPage.nextCursor !== null) {
    assert.equal(typeof catalogPage.nextCursor, "object");
    assert.equal(
      typeof (catalogPage.nextCursor as { lastSeenMs?: unknown }).lastSeenMs,
      "number",
    );
    assert.equal(
      typeof (catalogPage.nextCursor as { rawExeName?: unknown }).rawExeName,
      "string",
    );
  }
  assert.equal(catalogPage.readPath, "projection");
  assert.equal(catalogPage.fallbackReason, null);
  assert.equal(catalogPage.sourceRevision, readModelStatus.sourceRevision);

  const aggregateRange = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_activity_aggregate_range", {
      startMs: 0,
      endMs: 3600000,
      bucketBoundariesMs: [0, 3600000],
    })`,
  ) as {
    records: unknown[];
    readPath: string;
    fallbackReason: string;
    sourceRevision: number;
    projectionRowCount: number;
    factRowCount: number;
    hasActiveSession: boolean;
  };
  assert.deepEqual(aggregateRange.records, []);
  assert.equal(aggregateRange.readPath, "facts");
  assert.equal(aggregateRange.fallbackReason, "outside_projection_coverage");
  assert.equal(aggregateRange.sourceRevision, readModelStatus.sourceRevision);
  assert.equal(aggregateRange.projectionRowCount, 0);
  assert.equal(aggregateRange.factRowCount, 0);
  assert.equal(aggregateRange.hasActiveSession, false);

  const runtimeDatabasePath = join(root, "data", "patina.db");
  seedWebActivitySegment(runtimeDatabasePath);
  const webAggregateRange = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_web_activity_aggregate_range", {
      startMs: 0,
      endMs: 4000,
      bucketBoundariesMs: [0, 2000, 4000],
      normalizedDomain: "Example.COM.",
    })`,
  ) as {
    records: Array<{
      normalizedDomain: string;
      bucketStartMs: number;
      durationMs: number;
    }>;
    domainCoverage: Array<{
      normalizedDomain: string;
      earliestRecordedStartMs: number;
    }>;
    sourceRevision: string;
    snapshotNowMs: number;
  };
  assert.deepEqual({
    records: webAggregateRange.records,
    domainCoverage: webAggregateRange.domainCoverage,
  }, {
    records: [
      { normalizedDomain: "example.com", bucketStartMs: 0, durationMs: 1000 },
      { normalizedDomain: "example.com", bucketStartMs: 2000, durationMs: 1500 },
    ],
    domainCoverage: [
      { normalizedDomain: "example.com", earliestRecordedStartMs: 1000 },
    ],
  });
  assert.match(webAggregateRange.sourceRevision, /^(0|[1-9]\d*)$/);
  assert.equal(Number.isSafeInteger(webAggregateRange.snapshotNowMs), true);
  const multiWebAggregateRange = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_web_activity_aggregate_range", {
      startMs: 0,
      endMs: 4000,
      bucketBoundariesMs: [0, 2000, 4000],
      normalizedDomains: ["docs.example", "example.com"],
    })`,
  ) as typeof webAggregateRange;
  assert.deepEqual({
    records: multiWebAggregateRange.records,
    domainCoverage: multiWebAggregateRange.domainCoverage,
  }, {
    records: [
      { normalizedDomain: "docs.example", bucketStartMs: 2000, durationMs: 1000 },
      { normalizedDomain: "example.com", bucketStartMs: 0, durationMs: 1000 },
      { normalizedDomain: "example.com", bucketStartMs: 2000, durationMs: 1500 },
    ],
    domainCoverage: [
      { normalizedDomain: "docs.example", earliestRecordedStartMs: 2000 },
      { normalizedDomain: "example.com", earliestRecordedStartMs: 1000 },
    ],
  });
  assert.equal(multiWebAggregateRange.sourceRevision, webAggregateRange.sourceRevision);
  const conflictingWebAggregateRange = await evaluate(client, `
    window.__TAURI_INTERNALS__.invoke("cmd_get_web_activity_aggregate_range", {
      startMs: 0,
      endMs: 4000,
      bucketBoundariesMs: [0, 2000, 4000],
      normalizedDomain: "example.com",
      normalizedDomains: ["docs.example"],
    }).then(() => null, (error) => error)
  `) as { code?: string; retryable?: boolean };
  assert.equal(conflictingWebAggregateRange.code, "WEB_ACTIVITY_ANALYSIS_FAILED");
  assert.equal(conflictingWebAggregateRange.retryable, true);
  const invalidWebAggregateRange = await evaluate(client, `
    window.__TAURI_INTERNALS__.invoke("cmd_get_web_activity_aggregate_range", {
      startMs: 0,
      endMs: 4000,
      bucketBoundariesMs: [0, 3000, 2000, 4000],
      normalizedDomain: null,
    }).then(() => null, (error) => error)
  `) as { code?: string; retryable?: boolean };
  assert.equal(invalidWebAggregateRange.code, "WEB_ACTIVITY_ANALYSIS_FAILED");
  assert.equal(invalidWebAggregateRange.retryable, true);

  const resourceDiagnostics = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")`,
  ) as {
    process_resources?: {
      working_set_bytes?: number | null;
      private_usage_bytes?: number | null;
    };
  };
  assert.equal(typeof resourceDiagnostics.process_resources, "object");
  console.log("PATINA_RUNTIME_MEMORY_REPORT", JSON.stringify({
    scope: "isolated real Tauri main process after read-model initialization",
    workingSetBytes: resourceDiagnostics.process_resources?.working_set_bytes ?? null,
    privateUsageBytes: resourceDiagnostics.process_resources?.private_usage_bytes ?? null,
    comparison: "absolute diagnostic only; before/after payload retention is measured by perf:activity-read-model",
  }));
  const processTreeMemory = measureRuntimeProcessTree();
  assert.ok(processTreeMemory.processCount >= 1);
  assert.ok(processTreeMemory.workingSetBytes > 0);
  assert.ok(processTreeMemory.privateUsageBytes > 0);
  console.log("PATINA_RUNTIME_PROCESS_TREE_MEMORY_REPORT", JSON.stringify({
    scope: processTreeMemory.coverage === "root_and_descendants"
      ? "isolated real Tauri root process and descendant WebView2 process tree"
      : "isolated real Tauri root process; Windows CIM descendant enumeration unavailable",
    ...processTreeMemory,
    comparison: "absolute diagnostic only; before/after payload retention is measured by perf:activity-read-model",
  }));

  await evaluate(client, `
    (async () => {
      window.__patinaE2eEvents = [];
      const handler = window.__TAURI_INTERNALS__.transformCallback(
        (event) => window.__patinaE2eEvents.push(event.event),
      );
      await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
        event: "app-settings-changed",
        target: { kind: "Any" },
        handler,
      });
      return true;
    })()
  `);
  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [{ key: "refresh_interval_secs", value: "77" }],
  })`);
  await waitFor(
    "Rust to frontend settings event",
    async () => evaluate(client!, "window.__patinaE2eEvents?.includes('app-settings-changed')"),
    10_000,
  );

  const rows = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("plugin:sql|select", {
    db: "sqlite:patina.db",
    query: "SELECT value FROM settings WHERE key = ?",
    values: ["refresh_interval_secs"],
  })`);
  assert.deepEqual(rows, [{ value: "77" }]);

  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [
      { key: "language", value: "zh-CN" },
      { key: "tracking_paused", value: "1" },
      { key: "title_recording_enabled", value: "0" },
      { key: "language", value: "en-US" },
    ],
  })`);
  const englishTraySettingRows = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("plugin:sql|select", {
    db: "sqlite:patina.db",
    query: "SELECT key, value FROM settings WHERE key IN (?, ?, ?) ORDER BY key",
    values: ["language", "tracking_paused", "title_recording_enabled"],
  })`);
  assert.deepEqual(englishTraySettingRows, [
    { key: "language", value: "en-US" },
    { key: "title_recording_enabled", value: "0" },
    { key: "tracking_paused", value: "1" },
  ]);
  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [
      { key: "language", value: "zh-CN" },
      { key: "tracking_paused", value: "0" },
      { key: "title_recording_enabled", value: "1" },
    ],
  })`);
  const restoredTraySettingRows = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("plugin:sql|select", {
    db: "sqlite:patina.db",
    query: "SELECT key, value FROM settings WHERE key IN (?, ?, ?) ORDER BY key",
    values: ["language", "tracking_paused", "title_recording_enabled"],
  })`);
  assert.deepEqual(restoredTraySettingRows, [
    { key: "language", value: "zh-CN" },
    { key: "title_recording_enabled", value: "1" },
    { key: "tracking_paused", value: "0" },
  ]);
  const widgetPlacementRows = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("plugin:sql|select", {
    db: "sqlite:patina.db",
    query: "SELECT key, value FROM settings WHERE key IN (?, ?, ?) ORDER BY key",
    values: ["widget_placement", "widget_side", "widget_anchor_y"],
  })`) as Array<{ key?: string; value?: string }>;
  assert.equal(widgetPlacementRows.length, 1);
  assert.equal(widgetPlacementRows[0]?.key, "widget_placement");
  assert.deepEqual(
    JSON.parse(widgetPlacementRows[0]?.value ?? "null"),
    leftWidgetPlacement,
  );

  const historyBootstrapPayload = JSON.stringify({ version: 1, smoke: true });
  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_save_history_bootstrap_snapshot_payload", {
    payload: ${JSON.stringify(historyBootstrapPayload)},
  })`);
  const historyBootstrapRows = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("plugin:sql|select", {
    db: "sqlite:patina.db",
    query: "SELECT value FROM settings WHERE key = ?",
    values: ["history.bootstrap_snapshot.v1"],
  })`);
  assert.deepEqual(historyBootstrapRows, [{ value: historyBootstrapPayload }]);
  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_clear_history_bootstrap_snapshot_payload")`);
  const clearedHistoryBootstrapRows = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("plugin:sql|select", {
    db: "sqlite:patina.db",
    query: "SELECT value FROM settings WHERE key = ?",
    values: ["history.bootstrap_snapshot.v1"],
  })`);
  assert.deepEqual(clearedHistoryBootstrapRows, []);
  databaseMutationCompleted = true;

  const deniedWrite = await evaluate(client, `
    window.__TAURI_INTERNALS__.invoke("plugin:sql|execute", {
      db: "sqlite:patina.db",
      query: "DELETE FROM settings",
      values: [],
    }).then(() => null, (error) => String(error))
  `);
  assert.match(String(deniedWrite), /not allowed|permission|denied/i);

  const structuredError = await evaluate(client, `
    window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
      mutations: [{ key: "not_allowed", value: "1" }],
    }).then(() => null, (error) => error)
  `) as { code?: string; retryable?: boolean };
  assert.equal(structuredError.code, "SQLITE_INVALID_INPUT");
  assert.equal(structuredError.retryable, false);

  console.log("PASS real Tauri runtime command/event/SQLite/capability smoke");
} catch (error) {
  console.error(logs.join(""));
  primaryError = error;
} finally {
  try {
    await closeNetServer(bridgePortBlocker);
    bridgePortBlocker = null;
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    widgetClient?.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    client?.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  let appPid: number | null = null;
  try {
    appPid = appProcess ? stopProcessTree(appProcess) : null;
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    stopResidualRuntimeBinary();
  } catch (error) {
    cleanupErrors.push(error);
  }
  for (const [label, pid] of [["Tauri app", appPid]] as const) {
    if (!pid) continue;
    try {
      await waitFor(`${label} process exit`, () => isProcessRunning(pid) ? null : true, 10_000);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (process.platform === "win32") {
    try {
      await waitFor(
        "runtime-smoke Patina binary exit",
        () => {
          stopResidualRuntimeBinary();
          return isResidualRuntimeBinaryRunning() ? null : true;
        },
        10_000,
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    const httpServer = viteServer?.httpServer ?? null;
    await viteServer?.close();
    if (httpServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => error ? reject(error) : resolve());
      });
    }
    if (httpServer?.listening) {
      throw new Error(`Vite HTTP server still listening on ${frontendPort} after close`);
    }
  } catch (error) {
    cleanupErrors.push(error);
  }
  const dbPath = join(root, "data", "patina.db");
  try {
    if (databaseMutationCompleted && existsSync(dbPath)) verifyDatabase(dbPath);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await waitFor("isolated runtime directory cleanup", () => {
      try {
        assertIsolatedTempPath(root, "patina-tauri-e2e-");
        rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
        return !existsSync(root);
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "";
        if (code === "EPERM" || code === "EBUSY" || code === "ENOTEMPTY") return null;
        throw error;
      }
    }, 20_000);
  } catch (error) {
    cleanupErrors.push(error);
  }
}

const failures = [...(primaryError ? [primaryError] : []), ...cleanupErrors];
if (failures.length > 0) {
  throw new AggregateError(failures, "Tauri runtime smoke failed");
}
