import assert from "node:assert/strict";
import { CdpConnection, launchBrowser, removeIsolatedBrowserDataDir, resolveBrowserPath, stopBrowser, waitFor } from "../uiBrowserSmoke/browserHarness.ts";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyBrowserExtension } from "./extension.ts";
import { verifyMediaTimeout } from "./media.ts";

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type Session = { id: number; start_time: number; end_time: number | null };

export function focusTimingProcess(pid: number) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-File", fileURLToPath(new URL("./focusProcess.ps1", import.meta.url)), "-TargetProcessId", String(pid)], {encoding:"utf8", windowsHide:true, timeout:15_000});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

export async function verifyTrackingBoundaries(invoke: Invoke, bridgePort: number, evaluateInMain: (expression: string) => Promise<unknown>) {
  // Foreground automation does not create human input. Keep the isolated run
  // active until the explicit AFK boundary scenario below changes the threshold.
  await invoke("cmd_commit_app_settings",{mutations:[{key:"timeline_merge_gap_secs",value:"86400"}]});
  await invoke("cmd_set_afk_threshold",{thresholdSecs:86400});
  const select = async (query: string, values: unknown[] = []) => await invoke("plugin:sql|select", {
    db: "sqlite:patina.db", query, values,
  }) as Session[];
  const diagnose = async (error: unknown): Promise<never> => {
    const snapshot = await invoke("get_current_tracking_snapshot") as { window: { exe_name: string }; status: unknown; probe_status: string };
    console.error("TIMING_ACTIVE_DIAGNOSTIC", JSON.stringify({ exe: snapshot.window.exe_name, status: snapshot.status, probe: snapshot.probe_status,
      rows: await select("SELECT id,start_time,end_time FROM sessions WHERE end_time IS NULL"),
      overrides: await invoke("plugin:sql|select", {db:"sqlite:patina.db",query:"SELECT key,value FROM settings WHERE key LIKE '__app_override::%'",values:[]}) }));
    throw error;
  };
  const active = (focus?: () => Promise<unknown>, exe?: string) => waitFor("fresh native tracking session", async () => {
    if (focus) await focus();
    const snapshot = await invoke("get_current_tracking_snapshot") as {
      window: { exe_name: string }; status: { is_tracking_active: boolean }; probe_status: string;
    };
    if (!snapshot.status.is_tracking_active || snapshot.probe_status !== "ok") return null;
    if (exe && snapshot.window.exe_name.toLowerCase() !== exe) return null;
    return (await select("SELECT id,start_time,end_time FROM sessions WHERE end_time IS NULL"))[0] ?? null;
  }, 15_000).catch(diagnose);

  const browserExe = basename(resolveBrowserPath()).toLowerCase();
  const browserKind = browserExe === "msedge.exe" ? "edge" : "chrome";
  const override = (track: boolean | null) => invoke("cmd_commit_classification_settings", {
    mutations: [{ key: `__app_override::${browserExe}`, value: track === null ? null : JSON.stringify({ category:null, displayName:null, color:null, track, captureTitle:true, enabled:true, updatedAt:Date.now() }) }],
  });
  const nativeProcess = spawnSync("powershell.exe", ["-NoProfile", "-Command", "Get-Process patina -ErrorAction Stop | Where-Object { $_.Path -eq $env:PATINA_TIMING_TEST_BINARY } | Select-Object -ExpandProperty Id"], {
    encoding:"utf8", windowsHide:true, timeout:15_000,
    env:{...process.env,PATINA_TIMING_TEST_BINARY:resolve("src-tauri/target/runtime-smoke/debug/patina.exe")},
  });
  assert.ifError(nativeProcess.error);
  assert.equal(nativeProcess.status,0,nativeProcess.stderr || nativeProcess.stdout);
  assert.match(nativeProcess.stdout.trim(),/^\d+$/,"exactly one isolated runtime binary must exist");
  const mainPid = Number(nativeProcess.stdout.trim());
  const powerWindow = spawnSync("powershell.exe", ["-NoProfile", "-File", fileURLToPath(new URL("./focusProcess.ps1", import.meta.url)), "-TargetProcessId", String(mainPid), "-VerifyPowerWindow"], {encoding:"utf8",windowsHide:true,timeout:15_000});
  assert.ifError(powerWindow.error);
  assert.equal(powerWindow.status, 0, powerWindow.stderr || powerWindow.stdout);
  console.log("PASS native power observer is hidden and receives top-level broadcasts");
  const browser = await launchBrowser({ headless: false, extensionDebugging: Boolean(process.env.PATINA_TIMING_EXTENSION_PATH) });
  const focusMain = async () => { await invoke("cmd_show_main_window"); focusTimingProcess(mainPid); };
  const focusBrowser = async () => {
    focusTimingProcess(browser.browser.pid!);
    await browserClient!.command("Page.bringToFront");
  };
  let browserClient: CdpConnection | null = null;
  try {
    await active(focusMain,"patina.exe");
    const targets = await (await fetch(`http://127.0.0.1:${browser.port}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
    const page = targets.find(target => target.type === "page");
    assert.ok(page);
    browserClient = new CdpConnection(new WebSocket(page.webSocketDebuggerUrl));
    // Classification settings belong to recorded applications; establish B's
    // real catalog record before excluding it, as the product UI does.
    await active(focusBrowser, browserExe);
    const preceding = await active(focusMain, "patina.exe");
    await override(false);
    assert.equal((await select("SELECT id,start_time,end_time FROM sessions WHERE id=?", [preceding.id]))[0].end_time, null,
      "excluding a background browser must not stop the foreground application");
    await browserClient.command("Page.bringToFront");
    await waitFor("excluded browser is the native foreground", async () => {
      await focusBrowser();
      const snapshot = await invoke("get_current_tracking_snapshot") as { window: { exe_name: string }; status: { is_tracking_active: boolean } };
      return snapshot.window.exe_name.toLowerCase() === browserExe && !snapshot.status.is_tracking_active ? snapshot : null;
    }, 15_000).catch(diagnose);
    const ended = (await select("SELECT id,start_time,end_time FROM sessions WHERE id=?", [preceding.id]))[0];
    assert.ok(ended.end_time !== null, "entering excluded B closes A before returning to A");
    assert.equal((await select("SELECT id,start_time,end_time FROM sessions WHERE end_time IS NULL")).length, 0);
    await invoke("cmd_show_main_window");
    const returned = await active(focusMain, "patina.exe");
    assert.notEqual(returned.id, preceding.id, "same application return starts a new interval");
    assert.ok(returned.start_time >= ended.end_time);
    await override(null);
    await browserClient.command("Page.bringToFront");
    await waitFor("enabled browser is tracking", async () => {
      await focusBrowser();
      const snapshot = await invoke("get_current_tracking_snapshot") as { window: { exe_name: string }; status: { is_tracking_active: boolean } };
      return snapshot.window.exe_name.toLowerCase() === browserExe && snapshot.status.is_tracking_active ? snapshot : null;
    }, 15_000).catch(diagnose);
    const native = await active();
    const response = await fetch(`http://127.0.0.1:${bridgePort}/web-activity`, {
      method: "POST", headers: { Authorization: "Bearer runtime-smoke-bridge-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 1, browserKind, browserClientId: "foreground-timing-smoke", url: "https://foreground.example/test", incognito: false }),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.ok, true);
    assert.equal((await response.json() as { changed: boolean }).changed, true);
    const web = await select("SELECT id,start_time,end_time FROM web_activity_segments WHERE browser_client_id='foreground-timing-smoke'");
    assert.equal(web.length, 1);
    assert.equal(web[0].end_time, null);
    assert.ok(web[0].start_time >= native.start_time);
    if (process.env.PATINA_TIMING_MANUAL_POWER === "1") {
      await evaluateInMain(`(async () => {
        window.__patinaTimingPowerEvents = [];
        const handler = window.__TAURI_INTERNALS__.transformCallback(event => {
          if (event.payload?.source === "power_lifecycle_v1") window.__patinaTimingPowerEvents.push(event.payload);
        });
        await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", { event: "power-lifecycle-changed", target: { kind: "Any" }, handler });
      })()`);
      for (const [stop, resume] of [["lock", "unlock"], ["suspend", "resume"]]) {
        if (process.env.PATINA_TIMING_MANUAL_POWER_STAGE && stop !== process.env.PATINA_TIMING_MANUAL_POWER_STAGE) continue;
        const eventsBefore = await evaluateInMain("window.__patinaTimingPowerEvents.length") as number;
        await focusBrowser();
        const old = await active();
        let refreshing = true;
        const refresh = (async () => {
          while (refreshing) {
            await fetch(`http://127.0.0.1:${bridgePort}/web-activity`, {
              method: "POST", headers: { Authorization: "Bearer runtime-smoke-bridge-secret", "Content-Type": "application/json" },
              body: JSON.stringify({ protocolVersion: 1, browserKind, browserClientId: "foreground-timing-smoke", url: "https://foreground.example/test", incognito: false }),
              signal: AbortSignal.timeout(5_000),
            }).catch(() => null);
            await new Promise(resolve => setTimeout(resolve, 1_000));
          }
        })();
        console.log(`PATINA_MANUAL_POWER_READY ${stop}`);
        try {
          const events = await waitFor(`user ${stop} and ${resume}`, async () => {
            const events = await evaluateInMain(`window.__patinaTimingPowerEvents.slice(${eventsBefore})`).catch(error => {
              if (/Timed out|WebView temporarily unavailable|CDP WebSocket/i.test(String(error))) return [];
              throw error;
            }) as Array<{ state: string; timestamp_ms: number }>;
            return events.some(e => e.state === stop) && events.some(e => e.state === resume) ? events : null;
          }, 900_000);
          console.log("PATINA_MANUAL_POWER_EVENTS", JSON.stringify(events));
          const stopAt = events.find(e => e.state === stop)!.timestamp_ms;
          const resumeAt = events.find(e => e.state === resume && e.timestamp_ms >= stopAt)!.timestamp_ms;
          const oldRow = (await select("SELECT id,start_time,end_time FROM sessions WHERE id=?", [old.id]))[0];
          assert.ok(oldRow.end_time !== null && oldRow.end_time <= stopAt);
          const crossed = await select("SELECT id,start_time,end_time FROM sessions WHERE start_time<? AND (end_time IS NULL OR end_time>?)", [resumeAt,stopAt]);
          assert.equal(crossed.length,0,"no native session crosses the actual OS inactive interval");
          const webCrossed = await select("SELECT id,start_time,end_time FROM web_activity_segments WHERE browser_client_id='foreground-timing-smoke' AND start_time<? AND (end_time IS NULL OR end_time>?)", [resumeAt,stopAt]);
          assert.equal(webCrossed.length,0,"no webpage crosses the actual OS inactive interval");
          await focusBrowser();
          const fresh = await active();
          assert.notEqual(fresh.id,old.id);
          assert.ok(fresh.start_time >= resumeAt);
          await waitFor("fresh webpage after actual OS resume", async () => {
            const rows = await select("SELECT id,start_time,end_time FROM web_activity_segments WHERE browser_client_id='foreground-timing-smoke' AND start_time>=? AND end_time IS NULL", [resumeAt]);
            return rows[0] ?? null;
          }, 15_000);
          console.log("PATINA_MANUAL_POWER_PASS", JSON.stringify({stop,stopAt,resumeAt,oldEnd:oldRow.end_time,newStart:fresh.start_time,nativeCrossings:0,webCrossings:0}));
        } finally {
          refreshing = false;
          await refresh;
        }
      }
    }
    await focusMain();
    const closed = await waitFor("switching away closes native browser and web together", async () => {
      const row = (await select("SELECT id,start_time,end_time FROM sessions WHERE id=?", [native.id]))[0];
      return row.end_time === null ? null : row;
    });
    const webAfter = (await select("SELECT id,start_time,end_time FROM web_activity_segments WHERE id=?", [web[0].id]))[0];
    assert.ok(webAfter.end_time !== null && webAfter.end_time <= closed.end_time!);
    if (process.env.PATINA_TIMING_MANUAL_POWER !== "1") assert.equal(webAfter.end_time, closed.end_time);
    console.log("PASS real Windows foreground: excluded browser gap, same-app return, valid HTTP web binding and atomic browser/web stop");
    const beforeExclusion = await active(focusBrowser, browserExe);
    await override(false);
    const excludedSnapshot = await invoke("get_current_tracking_snapshot") as {status:{is_tracking_active:boolean}};
    assert.equal(excludedSnapshot.status.is_tracking_active,false,"excluding the active browser revokes its published activity before returning");
    const excludedRow = (await select("SELECT id,start_time,end_time FROM sessions WHERE id=?",[beforeExclusion.id]))[0];
    assert.ok(excludedRow.end_time!==null);
    await override(null);
    const restoredBrowser = await active(focusBrowser,browserExe);
    assert.notEqual(restoredBrowser.id,beforeExclusion.id);
    assert.ok(restoredBrowser.start_time>=excludedRow.end_time);
    assert.equal((await select("SELECT id,start_time,end_time FROM sessions WHERE id=?",[beforeExclusion.id]))[0].end_time,excludedRow.end_time,"restoring tracking preserves the old closed record");
    console.log("PASS real active-browser exclusion and restore preserve the excluded gap and history");
    for (const [key, disabled, enabled] of [
      ["web_activity_enabled", "0", "1"],
      ["web_activity_token", "", "runtime-smoke-bridge-secret"],
    ]) {
      const observe = async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${bridgePort}/web-activity`, {
            method: "POST", headers: { Authorization: "Bearer runtime-smoke-bridge-secret", "Content-Type": "application/json" },
            body: JSON.stringify({ protocolVersion: 1, browserKind, browserClientId: "disable-timing-smoke", url: "https://disable.example/test", incognito: false }),
            signal: AbortSignal.timeout(2_000),
          });
          return response.ok && (await response.json() as {changed:boolean}).changed || null;
        } catch { return null; }
      };
      await active(focusBrowser,browserExe);
      await waitFor("web activity before disabling",observe,8_000);
      const before = (await select("SELECT id,start_time,end_time FROM web_activity_segments WHERE browser_client_id='disable-timing-smoke' AND end_time IS NULL"))[0];
      assert.ok(before);
      const disabledAt = Date.now();
      await invoke("cmd_commit_app_settings",{mutations:[{key,value:disabled}]});
      const completedAt = Date.now();
      const ended = (await select("SELECT id,start_time,end_time FROM web_activity_segments WHERE id=?",[before.id]))[0];
      assert.ok(ended.end_time!==null && ended.end_time>=disabledAt && ended.end_time<=completedAt,
        "disabling web capture must close its current row during the settings commit");
      await invoke("cmd_commit_app_settings",{mutations:[{key,value:enabled}]});
      await active(focusBrowser,browserExe);
      await waitFor("fresh web activity after re-enabling",observe,8_000);
      const fresh = (await select("SELECT id,start_time,end_time FROM web_activity_segments WHERE browser_client_id='disable-timing-smoke' AND end_time IS NULL"))[0];
      assert.notEqual(fresh.id,before.id);
      assert.ok(fresh.start_time>=completedAt);
      assert.equal((await select("SELECT id,start_time,end_time FROM web_activity_segments WHERE id=?",[before.id]))[0].end_time,ended.end_time);
    }
    console.log("PASS real web disable/token removal: commit closes the webpage and re-enabling starts a fresh interval");
    if (process.env.PATINA_TIMING_EXTENSION_PATH) {
      await verifyBrowserExtension({ browserPort:browser.port, page:browserClient, bridgePort, extensionPath:process.env.PATINA_TIMING_EXTENSION_PATH, focusBrowser, focusMain, invoke });
    }
    await active(focusBrowser,browserExe);
    await verifyMediaTimeout(browserClient,invoke);
    const beforeAfk=await active(focusBrowser,browserExe);
    await invoke("cmd_set_afk_threshold",{thresholdSecs:0});
    try {
      const afk=await waitFor("real Windows idle observation closes native session",async()=>{
        const snapshot=await invoke("get_current_tracking_snapshot") as {window:{is_afk:boolean};status:{is_tracking_active:boolean}};
        const row=(await select("SELECT id,start_time,end_time FROM sessions WHERE id=?",[beforeAfk.id]))[0];
        return snapshot.window.is_afk && !snapshot.status.is_tracking_active && row.end_time!==null ? row : null;
      },15_000);
      assert.ok(afk.end_time!>=afk.start_time);
      const overhang=await select("SELECT w.id,w.start_time,w.end_time FROM web_activity_segments w JOIN web_activity_native_sessions r ON r.segment_id=w.id WHERE r.session_id=? AND w.end_time>w.start_time AND w.end_time>?",[beforeAfk.id,afk.end_time]);
      assert.equal(overhang.length,0,"AFK backdating must clip all positive webpage children");
    } finally { await invoke("cmd_set_afk_threshold",{thresholdSecs:86400}); }
    const afterAfk=await active(focusBrowser,browserExe);
    assert.notEqual(afterAfk.id,beforeAfk.id);
    console.log("PASS real Windows idle sampling with controlled AFK threshold and fresh recovery");
  } finally {
    browserClient?.close();
    await stopBrowser(browser.browser);
    await removeIsolatedBrowserDataDir(browser.userDataDir);
    await override(null);
    await invoke("cmd_show_main_window");
  }

  for (const [stop, resume] of [["lock", "unlock"], ["suspend", "resume"]]) {
    const before = await active();
    const boundary = Date.now();
    await invoke("plugin:event|emit", {
      event: "power-lifecycle-changed",
      payload: { state: stop, timestamp_ms: boundary, source: "isolated-runtime-test" },
    });
    const snapshot = await invoke("get_current_tracking_snapshot") as { status: { is_tracking_active: boolean } };
    assert.equal(snapshot.status.is_tracking_active, false, "the event immediately revokes the published activity");
    const ended = await waitFor("native power boundary committed", async () => {
      const row = (await select("SELECT id,start_time,end_time FROM sessions WHERE id=?", [before.id]))[0];
      return row?.end_time !== null ? row : null;
    });
    assert.equal(ended.end_time, boundary, "the handler uses event time rather than processing time");
    await invoke("plugin:event|emit", {
      event: "power-lifecycle-changed",
      payload: { state: resume, timestamp_ms: Date.now(), source: "isolated-runtime-test" },
    });
    const after = await active();
    assert.notEqual(after.id, before.id);
    assert.ok(after.start_time >= boundary);
  }

  const beforePause = await active();
  await invoke("cmd_commit_app_settings", { mutations: [{ key: "tracking_paused", value: "1" }] });
  assert.equal((await select("SELECT id,start_time,end_time FROM sessions WHERE end_time IS NULL")).length, 0,
    "pause command commits its boundary before returning");
  const paused = await invoke("get_current_tracking_snapshot") as { status: { is_tracking_active: boolean } };
  assert.equal(paused.status.is_tracking_active, false);
  const response = await fetch(`http://127.0.0.1:${bridgePort}/web-activity`, {
    method: "POST", headers: { Authorization: "Bearer runtime-smoke-bridge-secret", "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, browserKind: "chrome", browserClientId: "timing-smoke", url: "https://timing.example/test", incognito: false }),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.ok, true);
  assert.equal((await response.json() as { changed: boolean }).changed, false);
  const inserted = await select("SELECT id,start_time,end_time FROM web_activity_segments WHERE browser_client_id='timing-smoke'");
  assert.equal(inserted.length, 0, "authenticated metadata cannot authorize tracking while paused");
  const closed = (await select("SELECT id,start_time,end_time FROM sessions WHERE id=?", [beforePause.id]))[0];
  await invoke("cmd_commit_app_settings", { mutations: [{ key: "tracking_paused", value: "0" }] });
  const resumed = await active();
  assert.notEqual(resumed.id, beforePause.id);
  assert.ok(resumed.start_time >= closed.end_time!);
  console.log("PASS timing through real Tauri settings, event, snapshot, HTTP and SQLite entry points (power events injected; OS lock/sleep not claimed)");
}
