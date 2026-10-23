import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import type { StorageSnapshot } from "../src/platform/storage/storageRuntimeGateway.ts";
import { CdpConnection, waitFor } from "./uiBrowserSmoke/browserHarness.ts";

async function evaluate(client: CdpConnection, expression: string, timeoutMs?: number) {
  const response = await client.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, undefined, timeoutMs);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return (response.result as { value?: unknown })?.value;
}

function committedSample(path: string) {
  const database = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  try {
    database.exec("PRAGMA busy_timeout=5000");
    return Number(database.prepare("SELECT value FROM settings WHERE key='__tracker_last_successful_sample_ms'").get()?.value ?? 0);
  } finally { database.close(); }
}

function stopOwnedBrowser(rootPid: number, browserPid: number) {
  assert.ok(Number.isSafeInteger(rootPid) && rootPid > 0);
  assert.ok(Number.isSafeInteger(browserPid) && browserPid > 0 && browserPid !== rootPid);
  // Keep a process handle open across identity verification and termination.
  // Never select a browser by executable name or affect another profile.
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference = 'Stop'
    $owner = Get-Process -Id ${rootPid}
    $browser = Get-Process -Id ${browserPid}
    $handle = $browser.Handle
    $entry = Get-CimInstance Win32_Process -Filter 'ProcessId = ${browserPid}'
    if ($entry.ParentProcessId -ne $owner.Id -or $browser.StartTime.ToUniversalTime() -lt $owner.StartTime.ToUniversalTime() -or $browser.ProcessName -ne 'msedgewebview2') {
      throw 'WebView browser ownership was not established'
    }
    if ([Math]::Abs($entry.CreationDate.ToUniversalTime().Ticks - $browser.StartTime.ToUniversalTime().Ticks) -gt 10) {
      throw 'WebView browser PID changed during verification'
    }
    $browser.Kill()
    if (-not $browser.WaitForExit(5000)) { throw 'WebView browser exit unconfirmed' }
    Write-Output 'owned-browser-exited'
  `], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stdout, /owned-browser-exited/);
}

async function reconnect(port: number, oldGeneration: number, oldUrl: string, timeoutMs: number) {
  return waitFor("new main WebView generation after native failure", async () => {
    let targets: Array<{ type?: string; webSocketDebuggerUrl?: string }>;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) });
      targets = await response.json();
    } catch { return null; }
    for (const target of targets) {
      if (target.type !== "page" || !target.webSocketDebuggerUrl || target.webSocketDebuggerUrl === oldUrl) continue;
      let candidate: CdpConnection | null = null;
      try {
        candidate = await CdpConnection.connect(target.webSocketDebuggerUrl);
        const generation = Number(await evaluate(candidate, "window.__PATINA_MAIN_WINDOW_GENERATION__ ?? 0", 1_000));
        if (generation > oldGeneration) return candidate;
      } catch { /* A disappearing renderer is expected while native recovery runs. */ }
      candidate?.close();
    }
    return null;
  }, timeoutMs);
}

export async function verifyWebviewRecovery(initialClient: CdpConnection, port: number) {
  let client = initialClient;
  const storage = await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_get_storage_snapshot")') as StorageSnapshot;
  const events: unknown[] = [];
  try {
    for (const fault of ["renderer-exit", "renderer-unresponsive", "browser-exit"] as const) {
      const subscribed = await waitFor("WebView native failure subscription", async () => {
        const diagnostics = await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")') as {
          process_id: number;
          webview_recovery: Array<{ label: string; subscribed: boolean; engine_version: string | null; browser_process_id: number | null }>;
        };
        const main = diagnostics.webview_recovery.find(window => window.label === "main" && window.subscribed && window.engine_version && window.browser_process_id);
        return main ? { rootPid: diagnostics.process_id, browserPid: main.browser_process_id! } : null;
      });
      const generation = Number(await evaluate(client, "window.__PATINA_MAIN_WINDOW_GENERATION__"));
      const before = committedSample(storage.paths.databasePath);
      assert.ok(before > 0, "tracker must have a committed sample before fault injection");
      const startedAt = Date.now();
      const oldUrl = client.url;
      const windowState = await evaluate(client, 'Promise.all([window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" }), window.__TAURI_INTERNALS__.invoke("plugin:window|is_minimized", { label: "main" })])');
      assert.deepEqual(windowState, [true, false], "fault recovery fixture must have a visible, non-minimized main window");
      console.log("PATINA_WEBVIEW_FAULT", fault, generation, new Date().toISOString(), windowState);
      const failure = fault === "browser-exit"
        ? Promise.resolve(stopOwnedBrowser(subscribed.rootPid, subscribed.browserPid))
        : fault === "renderer-unresponsive"
        ? client.command("Runtime.evaluate", { expression: "setTimeout(() => { for (;;) {} }, 0); true" })
        : client.command("Page.crash");
      // Only this isolated profile's CDP endpoint receives the fault. Native
      // database reads remain available while the renderer cannot answer IPC.
      void failure.catch(() => undefined);
      if (fault === "renderer-unresponsive") {
        await failure;
        // Chromium's hang monitor observes input acknowledgements. Drive only
        // this isolated page, then detach the debugger while native monitoring
        // detects the unresponsive renderer.
        void client.command("Input.dispatchMouseEvent", {
          type: "mouseWheel", x: 300, y: 300, deltaX: 0, deltaY: 1,
        }).catch(() => undefined);
      }
      const progressed = await waitFor("tracker commits across renderer failure", () => {
        const sample = committedSample(storage.paths.databasePath);
        return sample > before ? sample : null;
      }, 10_000);
      client.close();
      if (fault === "renderer-unresponsive") {
        assert.ok(Date.now() - startedAt < 10_000, "recording must progress before sustained-unresponsive recovery is eligible");
      }
      // A native hang report can arrive after 45 s. Sustained confirmation on
      // the 15 s observer cadence and the second recovery's 4 s backoff must
      // also fit. Recording still has the separate 10 s deadline above.
      client = await reconnect(port, generation, oldUrl, fault === "renderer-unresponsive" ? 90_000 : 20_000);
      await client.command("Runtime.enable");
      await client.command("Page.enable");
      await waitFor("recovered main presentation and invoke", async () => evaluate(client,
        'document.querySelector("main.qp-canvas") && window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })'));
      // Later smoke assertions also verify event delivery from this new window.
      const diagnostics = await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")');
      const event = { fault, generation, elapsedMs: Date.now() - startedAt, committedBefore: before, committedDuringRecovery: progressed, diagnostics };
      events.push(event);
      console.log("PATINA_WEBVIEW_FAULT_RESULT", JSON.stringify(event));
    }
    console.log("PATINA_WEBVIEW_FAILURE_RECOVERY_REPORT", JSON.stringify(events));
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

export async function verifyWebviewRecoveryLimit(client: CdpConnection, port: number, readLogs: () => string) {
  const storage = await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_get_storage_snapshot")') as StorageSnapshot;
  const diagnostics = await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")') as { process_id: number };
  const before = committedSample(storage.paths.databasePath);
  const logStart = readLogs().length;
  void client.command("Page.crash").catch(() => undefined);
  await waitFor("fourth renderer failure stops automatic rebuilding", () =>
    readLogs().slice(logStart).includes("automatic-recovery-exhausted stopped=true"), 10_000);
  const progressed = await waitFor("tracker commits after the recovery budget is exhausted", () => {
    const sample = committedSample(storage.paths.databasePath);
    return sample > before ? sample : null;
  }, 10_000);
  const dialog = await waitFor("one native recovery failure dialog from the isolated app", () => {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
      [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
      Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class PatinaDialogRead {
  delegate bool Visit(IntPtr window, IntPtr state);
  [DllImport("user32.dll")] static extern bool EnumWindows(Visit callback, IntPtr state);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Visit callback, IntPtr state);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  public static string[] Read(uint owner) {
    var found = new List<string>();
    EnumWindows((window, state) => {
      uint pid; GetWindowThreadProcessId(window, out pid);
      var kind = new StringBuilder(128); GetClassName(window, kind, kind.Capacity);
      if (pid != owner || kind.ToString() != "#32770" || !IsWindowVisible(window)) return true;
      var text = new StringBuilder(2048); GetWindowText(window, text, text.Capacity);
      var combined = new StringBuilder(text.ToString());
      EnumChildWindows(window, (child, unused) => {
        var message = new StringBuilder(2048); GetWindowText(child, message, message.Capacity);
        combined.Append("\\n").Append(message.ToString()); return true;
      }, IntPtr.Zero);
      found.Add(combined.ToString()); return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }
}
'@
      ConvertTo-Json -Compress -InputObject @([PatinaDialogRead]::Read(${diagnostics.process_id}))
    `], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const dialogs = JSON.parse(result.stdout.trim()) as string[];
    assert.ok(dialogs.length <= 1, "native failure notices must not accumulate");
    return dialogs.length === 1 ? dialogs[0] : null;
  }, 15_000);
  assert.match(dialog, /Patina/);
  assert.match(dialog, /窗口多次恢复失败，已停止自动重试/);
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) })
    .then(response => response.json() as Promise<Array<{ webSocketDebuggerUrl?: string }>>)
    .catch((error: unknown) => {
      if (error instanceof TypeError && (error.cause as { code?: string })?.code === "ECONNREFUSED") return [];
      throw error;
    });
  assert.ok(!targets.some(target => target.webSocketDebuggerUrl === client.url), "broken renderer must be removed");
  assert.doesNotMatch(readLogs().slice(logStart), /event=creation-started/, "exhausted recovery must not rebuild again");
  console.log("PATINA_WEBVIEW_RECOVERY_LIMIT_REPORT", JSON.stringify({ nativeDialog: true, dialogCount: 1, committedBefore: before, committedAfter: progressed }));
}
