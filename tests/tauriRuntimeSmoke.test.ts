import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createNetServer } from "node:net";
import { createServer as createViteServer, type ViteDevServer } from "vite";
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

async function findMainTarget(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return null;
    const targets = await response.json() as Array<{
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

function verifyDatabase(dbPath: string) {
  const script = [
    "import sqlite3, sys",
    "db = sqlite3.connect(sys.argv[1])",
    "integrity = db.execute('PRAGMA integrity_check').fetchone()[0]",
    "value = db.execute(\"SELECT value FROM settings WHERE key='refresh_interval_secs'\").fetchone()",
    "db.close()",
    "assert integrity == 'ok', integrity",
    "assert value == ('77',), value",
  ].join("; ");
  const result = spawnSync("python", ["-c", script, dbPath], { encoding: "utf8" });
  assert.equal(result.status, 0, `database verification failed: ${result.stderr || result.stdout}`);
}

const frontendPort = await reservePort();
const devtoolsPort = await reservePort();
const root = mkdtempSync(join(tmpdir(), "patina-tauri-e2e-"));
assertIsolatedTempPath(root, "patina-tauri-e2e-");
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const logs: string[] = [];
let appLaunchObserved = false;
let appLogTail = "";
let appProcess: ChildProcess | null = null;
let viteServer: ViteDevServer | null = null;
let client: CdpConnection | null = null;
let primaryError: unknown = null;
const cleanupErrors: unknown[] = [];
let databaseMutationCompleted = false;

try {
  viteServer = await createViteServer({
    configFile: "vite.config.ts",
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: frontendPort,
      strictPort: true,
      hmr: false,
    },
  });
  await viteServer.listen();
  await waitFor("Vite dev server", async () => {
    try {
      return (await fetch(frontendUrl, { signal: AbortSignal.timeout(1_000) })).ok;
    } catch {
      return null;
    }
  }, 30_000);

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
      PATINA_E2E_DATA_ROOT: root,
      PATINA_E2E_FRONTEND_URL: frontendUrl,
      PATINA_E2E_DEVTOOLS_PORT: String(devtoolsPort),
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
  await waitFor(
    "real Tauri runtime",
    async () => evaluate(client!, "Boolean(window.__TAURI_INTERNALS__ && document.querySelector('#root')?.children.length)"),
    30_000,
  );

  const initialMainWindowVisible = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
  );
  assert.equal(initialMainWindowVisible, false, "fresh-install start minimized should keep the main window hidden");
  assert.match(logs.join(""), /\[startup\] source=manual strategy=start-in-tray-optimized/);

  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")`);
  await waitFor(
    "main window recovery from hidden startup",
    async () => evaluate(
      client!,
      `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
    ),
    10_000,
  );

  const storage = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_get_storage_snapshot")`);
  assert.equal(typeof storage, "object");

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
