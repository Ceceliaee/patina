import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { CdpConnection, waitFor } from "./uiBrowserSmoke/browserHarness.ts";

async function evaluate(client: CdpConnection, expression: string) {
  const response = await client.command("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return (response.result as { value?: unknown })?.value;
}

export function readTrackerProgress(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false });
  try {
    database.exec("PRAGMA busy_timeout=5000");
    return Number(database.prepare("SELECT value FROM settings WHERE key='__tracker_last_successful_sample_ms'").get()?.value ?? 0);
  } finally { database.close(); }
}

export async function verifyRestoredBackgroundPolicy(
  initialClient: CdpConnection,
  port: number,
  databasePath: string,
  readLogs: () => string,
) {
  let client = initialClient;
  const generation = Number(await evaluate(client, "window.__PATINA_MAIN_WINDOW_GENERATION__"));
  await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_open_mini_window")');
  const hide = () => evaluate(client, 'window.__TAURI_INTERNALS__.invoke("plugin:window|close", {label:"main"})');
  const visible = () => evaluate(client, 'window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })');
  await hide();
  assert.equal(await visible(), false);
  const firstHide = Date.now();
  // These real waits are the boundary workload: the old task must lose its
  // authority when the same window is shown at 29 seconds.
  await delay(Math.max(0, firstHide + 29_000 - Date.now()));
  assert.equal(Number(await evaluate(client, "window.__PATINA_MAIN_WINDOW_GENERATION__")), generation);
  await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")');
  await waitFor("29-second reopen becomes visible", visible, 2_000);
  await delay(Math.max(0, firstHide + 31_000 - Date.now()));
  assert.equal(await visible(), true);
  assert.equal(Number(await evaluate(client, "window.__PATINA_MAIN_WINDOW_GENERATION__")), generation);

  await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("plugin:window|minimize", { label: "main" })');
  await delay(31_000);
  assert.equal(await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("plugin:window|is_minimized", { label: "main" })'), true);
  assert.equal(Number(await evaluate(client, "window.__PATINA_MAIN_WINDOW_GENERATION__")), generation,
    "taskbar minimization must not be reclassified as native background hiding");
  await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")');
  await waitFor("taskbar minimized main returns", () => evaluate(client,
    'window.__TAURI_INTERNALS__.invoke("plugin:window|is_minimized", { label: "main" }).then(value => !value)'), 2_000);

  const secondHide = Date.now();
  const logStart = readLogs().length;
  await hide();
  await delay(29_000);
  assert.equal(await visible(), false);
  assert.equal(Number(await evaluate(client, "window.__PATINA_MAIN_WINDOW_GENERATION__")), generation,
    "a new hide must receive the full delay instead of inheriting the old deadline");
  client.close();
  await waitFor("restored legacy-disabled database naturally releases main", () =>
    new RegExp(`event=destroyed generation=${generation}[^\\r\\n]*reason=background-idle`).test(readLogs().slice(logStart)), 16_000);
  const destroyElapsedMs = Date.now() - secondHide;
  assert.ok(destroyElapsedMs >= 30_000 && destroyElapsedMs < 45_000, `natural hide delay was ${destroyElapsedMs}ms`);
  const destroyedAt = Date.now();
  await waitFor("tracker commits after restored main is released", () => readTrackerProgress(databasePath) > destroyedAt, 10_000);

  const mini = await waitFor("surviving mini can reopen main", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) });
    const targets = await response.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
    for (const target of targets) {
      if (target.type !== "page" || !target.webSocketDebuggerUrl) continue;
      const candidate = await CdpConnection.connect(target.webSocketDebuggerUrl);
      try {
        if (await evaluate(candidate, "Boolean(document.querySelector('.mini-shell'))")) return candidate;
      } catch { /* A disappearing main target can still be listed briefly. */ }
      candidate.close();
    }
    return null;
  }, 10_000);
  const openAction = 'document.querySelector(\'button[aria-label="打开主窗口"]\')';
  let reopenStarted: number;
  try {
    await evaluate(mini, `window.__TAURI_INTERNALS__.invoke('cmd_get_mini_window_snapshot').then(s => window.__TAURI_INTERNALS__.invoke('cmd_mini_window_action',{epoch:s.epoch,action:{kind:'hold',held:true}}))`);
    await waitFor("mini main-window action is enabled", () => evaluate(mini,
      `Boolean(${openAction} && !${openAction}.disabled)`), 5_000);
    reopenStarted = Date.now();
    await evaluate(mini, `(() => { ${openAction}.click(); ${openAction}.click(); })()`);
  } finally { mini.close(); }
  client = await waitFor("restored main rebuilds with a new generation", async () => {
    let targets: Array<{ type?: string; webSocketDebuggerUrl?: string }>;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) });
      targets = await response.json();
    } catch { return null; }
    for (const target of targets) {
      if (target.type !== "page" || !target.webSocketDebuggerUrl) continue;
      let candidate: CdpConnection | null = null;
      try {
        candidate = await CdpConnection.connect(target.webSocketDebuggerUrl);
        if (Number(await evaluate(candidate, "window.__PATINA_MAIN_WINDOW_GENERATION__ ?? 0")) > generation) return candidate;
      } catch { /* A target may still be initializing. */ }
      candidate?.close();
    }
    return null;
  }, 10_000);
  try {
    await waitFor("restored main is interactive after ready", () => evaluate(client,
      'window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })'), 10_000);
    assert.equal(Number(await evaluate(client, "window.__PATINA_MAIN_WINDOW_GENERATION__")), generation + 1,
      "repeated Mini requests must share one new main-window generation");
    const snapshot = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_get_history_range_rows", {
      startMs: 0, endMs: ${Date.now()}, nowMs: ${Date.now()}, includeTitleSamples: false,
    })`) as { sessions: Array<{ exe_name: string; duration: number | null }> };
    assert.deepEqual(snapshot.sessions.filter(row => row.exe_name.startsWith("runtime-restore-"))
      .map(row => ({ exe: row.exe_name, duration: row.duration })),
    [{ exe: "runtime-restore-original.exe", duration: 120_000 }],
    "rebuilt IPC must read the restored fact rather than pre-restore cached data");
    const readyElapsedMs = Date.now() - reopenStarted;
    assert.ok(readyElapsedMs < 10_000, `rebuild and authoritative read took ${readyElapsedMs}ms`);
    console.log("PATINA_RESTORED_BACKGROUND_POLICY_REPORT", JSON.stringify({
      oldGeneration: generation,
      newGeneration: await evaluate(client, "window.__PATINA_MAIN_WINDOW_GENERATION__"),
      cancellationAt29Seconds: true, survivedOldDeadlineAt31Seconds: true, taskbarMinimizedAt31SecondsPreserved: true,
      repeatedMiniReopen: true,
      destroyElapsedMs, readyElapsedMs, trackerPersistedAfterDestruction: true,
    }));
    return client;
  } catch (error) { client.close(); throw error; }
}
