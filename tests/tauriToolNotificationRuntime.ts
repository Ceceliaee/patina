import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { RuntimeSession, evaluate } from "./tauriRuntimeHarness.ts";
import { connectMini } from "./tauriMiniWindowRuntime.ts";
import { startMiniNativeProbe } from "./miniNativeProbe.ts";
import { waitFor, type CdpConnection } from "./uiBrowserSmoke/browserHarness.ts";

export async function verifyToolNotificationRuntime(session: RuntimeSession) {
  await session.stop();
  const path = join(session.root, "data", "patina.db");
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout=5000; DELETE FROM tool_reminders; DELETE FROM tool_activity_reminder_rules; DELETE FROM settings WHERE key='tools_notification_preferences';");
  } finally { db.close(); }
  await session.start();
  let main = await session.connect();
  const invoke = (command: string, payload: unknown = {}) => evaluate(main, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(payload)})`);
  const initial = await invoke("cmd_get_tool_presentation") as { preferences: unknown };
  assert.deepEqual(initial.preferences, { delivery: "notification", sound: "default" });
  await invoke("cmd_save_tool_notification_preferences", { patch: { sound: "none" } });
  const { process_id: pid } = await invoke("cmd_get_resource_diagnostics") as { process_id: number };
  const probe = startMiniNativeProbe(pid, session.cancellation.signal, "Patina Notification");
  session.ownCleanup(probe.close);
  let notification: CdpConnection | null = null;
  const read = (sql: string) => {
    const database = new DatabaseSync(path, { readOnly: true, timeout: 5_000 });
    try { return database.prepare(sql).all(); } finally { database.close(); }
  };
  const connect = async () => {
    notification = await waitFor("notification WebView", () => connectMini(session.devtoolsPort, "tool-notification"), 30_000);
    await waitFor("notification content", () => evaluate(notification!, "Boolean(document.querySelector('.tools-usage-alert-surface'))"), 20_000);
    return notification;
  };
  try {
    await probe.request("focus");
    await invoke("cmd_create_reminder", { input: { label: "Passive notification", scheduledAt: Date.now() + 3000 } });
    // Startup main is hidden. Release it before the due event to prove independence.
    await invoke("cmd_e2e_destroy_hidden_main_window").catch(() => {});
    main.close();
    await waitFor("main released before notification", async () => {
      const found = await connectMini(session.devtoolsPort, "main");
      found?.close(); return !found;
    }, 10_000);
    await connect();
    const first = await waitFor("native passive notification visibility", async () => {
      const sample = await probe.request("sample"); return sample.visible ? sample : null;
    });
    assert.equal(first.foreground, first.inputTarget, "arrival must keep the previous foreground window");
    assert.ok(first.x >= first.workRect.Left && first.y >= first.workRect.Top);
    assert.ok(first.x + first.width <= first.workRect.Right && first.y + first.height <= first.workRect.Bottom);
    assert.equal(await evaluate(notification!, "!!document.querySelector('main.qp-canvas,.qp-app-frame,.mini-tools')"), false);
    assert.equal(await evaluate(notification!, "document.activeElement === document.body"), true, "passive notification must not autofocus its dialog");
    const assigned = await evaluate(notification!, "window.__TAURI_INTERNALS__.invoke('cmd_get_tool_presentation')") as { alert: { id: string } };
    for (const command of ["cmd_get_tools_snapshot", "cmd_commit_app_settings", "cmd_save_tool_notification_preferences", "cmd_create_reminder", "cmd_get_setting_rows", "cmd_restore_backup", "cmd_classification_object_deletion", "cmd_reveal_webdav_backup_secret", "plugin:sql|load", "cmd_show_main_window", "cmd_e2e_destroy_hidden_main_window"]) {
      const error = await evaluate(notification!, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},{}).then(()=>null,e=>String(e))`);
      assert.match(String(error), /not allowed|permission|denied/i);
    }
    const stale = await evaluate(notification!, `window.__TAURI_INTERNALS__.invoke('cmd_tool_presentation_action',{alertId:'forged',action:{kind:'resolve',delay:null}}).then(()=>null,e=>String(e))`);
    assert.match(String(stale), /no longer current/);
    assert.equal(read("SELECT status FROM tool_reminders WHERE label='Passive notification'")[0].status, "pending_confirmation");
    // Reloading the carrier does not resolve the event or transfer it to main.
    await evaluate(notification!, "location.reload()");
    await waitFor("notification reload", async () => {
      try { return await evaluate(notification!, "document.querySelector('.tools-usage-alert-surface')?.textContent.includes('Passive notification')"); } catch { return false; }
    });
    assert.equal(read("SELECT status FROM tool_reminders WHERE label='Passive notification'")[0].status, "pending_confirmation");
    assert.equal(await connectMini(session.devtoolsPort, "main"), null);
    const button = await evaluate(notification!, `(() => { const r=document.querySelector('.tools-usage-alert-surface button').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth}; })()`) as {x:number;y:number;width:number};
    const surface = await probe.request("sample");
    const x = Math.round(surface.canvas.x + button.x * surface.canvas.width / button.width);
    const y = Math.round(surface.canvas.y + button.y * surface.canvas.width / button.width);
    const hit = await probe.request("move", x, y);
    assert.equal(hit.hitMini, true, "native pointer must target the owned notification");
    await probe.request("down", x, y); await probe.request("up", x, y);
    await waitFor("native click opens snooze choices", () => evaluate(notification!, "document.activeElement?.value==='5'"));
    const expanded = await waitFor("snooze expands upward from the same bottom edge", async () => {
      const sample = await probe.request("sample");
      return sample.height > surface.height && sample.y + sample.height === surface.y + surface.height ? sample : null;
    });
    assert.equal(expanded.foreground, surface.mini);
    assert.deepEqual(expanded.canvas, surface.canvas, "the WebView canvas stays fixed as the visible card grows");
    await notification!.command("Input.dispatchKeyEvent", {type:"keyDown",key:"Escape",windowsVirtualKeyCode:27});
    await notification!.command("Input.dispatchKeyEvent", {type:"keyUp",key:"Escape",windowsVirtualKeyCode:27});
    await waitFor("Escape returns from snooze without confirmation", () => evaluate(notification!, "!!document.querySelector('input[name=\"reminder-delay\"]')?.closest('[inert]') && document.activeElement === document.querySelector('.qp-dialog-actions button')"));
    await waitFor("cancelling snooze restores the original notification bounds", async () => {
      const sample = await probe.request("sample");
      return sample.visible && sample.height === surface.height && sample.y === surface.y;
    });
    await probe.request("focus");
    for (let failure = 0; failure < 3; failure++) {
      const crashStart = session.logs.length;
      void notification!.command("Page.crash").catch(() => {});
      await waitFor("notification renderer failure observed", () => session.logs.slice(crashStart).join("").includes("observed=RendererExited"), 15_000);
      notification!.close(); notification = null;
      if (failure < 2) {
        await connect();
        assert.equal((await evaluate(notification!, "window.__TAURI_INTERNALS__.invoke('cmd_get_tool_presentation')") as typeof assigned).alert.id, assigned.alert.id);
      } else {
        await waitFor("notification recovery is bounded", async () => { const found = await connectMini(session.devtoolsPort,"tool-notification"); found?.close(); return !found; }, 20_000);
      }
      assert.equal(read("SELECT status FROM tool_reminders WHERE label='Passive notification'")[0].status, "pending_confirmation");
      assert.equal(await connectMini(session.devtoolsPort, "main"), null);
    }
    // An explicit application launch restores main; changing the preference cannot move this event.
    await session.start();
    main = await waitFor("main restored explicitly", () => connectMini(session.devtoolsPort, "main"), 30_000);
    session.client = main;
    const failed = await invoke("cmd_get_tool_presentation") as {error:string|null};
    assert.ok(failed.error, "notification recovery exhaustion must be visible to the tools owner");
    await invoke("cmd_get_tool_presentation", {retry:true});
    await connect();
    await waitFor("explicit retry clears the notification failure", async () => !(await invoke("cmd_get_tool_presentation") as {error:string|null}).error);
    await invoke("cmd_save_tool_notification_preferences", { patch: { delivery: "dialog" } });
    assert.equal((await invoke("cmd_get_tool_presentation") as { alert: unknown }).alert, null);
    assert.equal((await evaluate(notification!, "window.__TAURI_INTERNALS__.invoke('cmd_get_tool_presentation')") as typeof assigned).alert.id, assigned.alert.id);
    await evaluate(notification!, `window.__TAURI_INTERNALS__.invoke('cmd_tool_presentation_action',{alertId:${JSON.stringify(assigned.alert.id)},action:{kind:'resolve',delay:5}})`).catch(() => {});
    notification.close(); notification = null;
    await waitFor("snooze committed and notification released", async () => {
      const found = await connectMini(session.devtoolsPort, "tool-notification"); found?.close();
      return !found && read("SELECT status FROM tool_reminders WHERE label='Passive notification'")[0].status === "scheduled";
    });
    await invoke("plugin:window|close", { label: "main" });
    await invoke("cmd_create_reminder", { input: { label: "Modal delivery", scheduledAt: Date.now() + 1500 } });
    await waitFor("modal delivery restores main", () => invoke("plugin:window|is_visible", { label: "main" }));
    await waitFor("modal content", () => evaluate(main, "document.querySelector('.tools-usage-alert-surface')?.textContent.includes('Modal delivery')"));
    assert.equal(await connectMini(session.devtoolsPort, "tool-notification"), null);
    const modal = await invoke("cmd_get_tool_presentation") as typeof assigned;
    await invoke("cmd_tool_presentation_action", { alertId: modal.alert.id, action: { kind: "resolve", delay: null } });
    assert.equal(read("SELECT status FROM tool_reminders WHERE label='Modal delivery'")[0].status, "fired");
    await probe.close();
    await session.stop(); await session.start(); main = await session.connect();
    assert.deepEqual((await invoke("cmd_get_tool_presentation") as { preferences: unknown }).preferences, { delivery: "dialog", sound: "none" });
    console.log("PASS native software notification: no main recreation or focus theft, work-area placement, scoped IPC, reload, snooze, delivery switch and restart persistence");
  } finally { notification?.close(); await probe.close(); }
}
