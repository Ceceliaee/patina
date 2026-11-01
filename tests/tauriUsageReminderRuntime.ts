import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { readRuntimeDatabaseRows } from "./runtimeDatabase.ts";
import { waitFor, assertIsolatedTempPath } from "./uiBrowserSmoke/browserHarness.ts";

export async function verifyUsageReminderRuntime(evaluate: (expression: string) => Promise<unknown>, root: string) {
  assertIsolatedTempPath(root, "patina-tauri-e2e-");
  const invoke = (command: string, payload: Record<string, unknown> = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(payload)})`);
  const scheduledAt = Date.now() + 120_000;
  const timed = await invoke("cmd_create_reminder", { input: { label: "Timed fixture", scheduledAt } }) as {
    reminders: Array<{ id: number; label: string; status: string }>;
  };
  const timedId = timed.reminders.find(item => item.label === "Timed fixture")!.id;
  const update = { reminderId: timedId, label: "Revised fixture", scheduledAt: scheduledAt + 60_000, enabled: false };
  const paused = await invoke("cmd_update_reminder", update) as typeof timed;
  assert.equal(paused.reminders.find(item => item.id === timedId)?.status, "paused");
  assert.deepEqual((await readRuntimeDatabaseRows(evaluate,
    "SELECT label, scheduled_at, status FROM tool_reminders WHERE id = ?", [timedId]))[0],
  { label: "Revised fixture", scheduled_at: scheduledAt + 60_000, status: "paused" });
  const invalidTime = await evaluate(`window.__TAURI_INTERNALS__.invoke('cmd_update_reminder',${JSON.stringify({ ...update, scheduledAt: 1, enabled: true })}).then(()=>null,error=>String(error))`);
  assert.match(String(invalidTime), /future/);
  const resumed = await invoke("cmd_update_reminder", { ...update, enabled: true }) as typeof timed;
  assert.equal(resumed.reminders.find(item => item.id === timedId)?.status, "scheduled");
  await invoke("cmd_update_reminder", update);
  await invoke("cmd_cancel_reminder", { reminderId: timedId });
  assert.equal((await readRuntimeDatabaseRows(evaluate, "SELECT status FROM tool_reminders WHERE id = ?", [timedId]))[0].status, "cancelled");
  console.log("PASS native timed reminder pause, edit, resume, deletion and persisted state");
  const firstDeadline = Date.now() + 1500;
  const due = await invoke("cmd_create_reminder", { input: { label: "Confirm fixture", scheduledAt: firstDeadline } }) as typeof timed;
  const dueId = due.reminders.find(item => item.label === "Confirm fixture")!.id;
  const waitForTimedAlert = () => waitFor("native timed alert", async () => {
    const alerts = await invoke("cmd_get_tool_alerts") as Array<{id:string; kind:string}>;
    return alerts.find(item=>item.id.startsWith(`reminder:${dueId}:`));
  }, 20_000);
  const firstTimedAlert = await waitForTimedAlert();
  const snoozeStart = Date.now();
  const snoozed = await invoke("cmd_resolve_reminder_alert", { alertId: firstTimedAlert.id, delayMinutes: 5 }) as typeof timed;
  assert.equal(snoozed.reminders.find(item=>item.id===dueId)?.status, "scheduled");
  const snoozeRow = (await readRuntimeDatabaseRows(evaluate, "SELECT scheduled_at, status FROM tool_reminders WHERE id=?", [dueId]))[0];
  assert.equal(snoozeRow.status, "scheduled");
  assert.ok(Number(snoozeRow.scheduled_at) >= snoozeStart + 300_000 && Number(snoozeRow.scheduled_at) <= Date.now() + 300_000);
  const staleTimed = await evaluate(`window.__TAURI_INTERNALS__.invoke('cmd_resolve_reminder_alert',${JSON.stringify({ alertId: firstTimedAlert.id, delayMinutes: null })}).then(()=>null,error=>String(error))`);
  assert.match(String(staleTimed), /unavailable/);
  await invoke("cmd_update_reminder", { reminderId: dueId, label: "Confirm fixture", scheduledAt: Date.now()+1500, enabled: true });
  const secondTimedAlert = await waitForTimedAlert();
  assert.notEqual(secondTimedAlert.id, firstTimedAlert.id);
  const completed = await invoke("cmd_resolve_reminder_alert", { alertId: secondTimedAlert.id, delayMinutes: null }) as typeof timed;
  assert.equal(completed.reminders.find(item=>item.id===dueId)?.status, "fired");
  assert.equal((await readRuntimeDatabaseRows(evaluate, "SELECT status FROM tool_reminders WHERE id=?", [dueId]))[0].status, "fired");
  assert.ok((await invoke("cmd_get_tool_alerts") as Array<{id:string}>).every(item=>item.id !== secondTimedAlert.id));
  await invoke("cmd_cancel_reminder", { reminderId: dueId });
  const cycleAnchor = Date.now() + 1500;
  const cycle = await invoke("cmd_create_reminder", { input: {
    label: "Recurring fixture", scheduledAt: cycleAnchor, recurrence: { kind: "interval", minutes: 30 },
  } }) as typeof timed;
  const cycleId = cycle.reminders.find(item => item.label === "Recurring fixture")!.id;
  const cycleAlert = await waitFor("native recurring reminder alert", async () => {
    const alerts = await invoke("cmd_get_tool_alerts") as Array<{ id: string }>;
    return alerts.find(item => item.id.startsWith(`reminder:${cycleId}:`));
  }, 20_000);
  await invoke("cmd_resolve_reminder_alert", { alertId: cycleAlert.id, delayMinutes: null });
  const cycleRow = (await readRuntimeDatabaseRows(evaluate,
    "SELECT status, scheduled_at, recurrence, recurrence_anchor_at FROM tool_reminders LEFT JOIN tool_reminder_recurrences ON reminder_id=id WHERE id=?", [cycleId]))[0];
  assert.equal(cycleRow.status, "scheduled");
  assert.equal(cycleRow.scheduled_at, cycleAnchor + 30 * 60_000);
  assert.equal(cycleRow.recurrence_anchor_at, cycleAnchor);
  assert.deepEqual(JSON.parse(String(cycleRow.recurrence)), { kind: "interval", minutes: 30 });
  await invoke("cmd_update_reminder", { reminderId: cycleId, label: "Recurring fixture", scheduledAt: cycleRow.scheduled_at,
    enabled: false, recurrence: { kind: "interval", minutes: 30 } });
  const persistedCycle = (await readRuntimeDatabaseRows(evaluate,
    "SELECT status, recurrence_anchor_at FROM tool_reminders LEFT JOIN tool_reminder_recurrences ON reminder_id=id WHERE id=?", [cycleId]))[0];
  assert.deepEqual(persistedCycle, { status: "paused", recurrence_anchor_at: cycleAnchor });
  console.log("PASS native recurring reminder creation, next occurrence and paused rule persistence");
  // Reload the WebView to clear notifications acknowledged directly through IPC by this test.
  await evaluate("document.documentElement.dataset.timedReload='pending'; location.reload()");
  await waitFor("timed runtime reload", async () => {
    try { return await evaluate("document.documentElement.dataset.timedReload!=='pending' && !!window.__TAURI_INTERNALS__ && !!document.querySelector('main.qp-canvas')"); } catch { return false; }
  }, 20_000);
  const reloadedCycle = await invoke("cmd_get_tools_snapshot") as { reminders: Array<{ id: number; recurrence: unknown }> };
  assert.deepEqual(reloadedCycle.reminders.find(item => item.id === cycleId)?.recurrence, { kind: "interval", minutes: 30 });
  await invoke("cmd_cancel_reminder", { reminderId: cycleId });
  console.log("PASS native timed confirmation, five-minute snooze, re-delivery identity and durable completion");
  const missing = await evaluate(`window.__TAURI_INTERNALS__.invoke('cmd_extend_activity_reminder',{alertId:'missing',extension:'today'}).then(()=>null,error=>String(error))`);
  assert.match(String(missing), /unavailable/);
  const invalid = await evaluate(`window.__TAURI_INTERNALS__.invoke('cmd_extend_activity_reminder',{alertId:'missing',extension:'forever'}).then(()=>null,error=>String(error))`);
  assert.match(String(invalid), /unknown variant|invalid args/);
  const now = await waitFor("usage fixture has one minute in the current local day", async () => {
    const value = await evaluate(`(() => { const now=Date.now(); const start=new Date(); start.setHours(0,0,0,0); return now-start.getTime() > 120000 ? now : null; })()`);
    return typeof value === "number" ? value : null;
  }, 125_000);
  const db = new DatabaseSync(join(root, "data", "patina.db"));
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.prepare("INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration,continuity_group_start_time) VALUES(?,?,?,?,?,?)")
      .run("Usage fixture", "usage-fixture.exe", now - 120_000, now, 120_000, now - 120_000);
  } finally { db.close(); }
  const snapshot = await invoke("cmd_create_activity_reminder_rule", { input: {
    target: { kind: "app", appName: "Usage fixture", exeName: "usage-fixture.exe" }, labelSnapshot: "Usage fixture", limitMs: 60_000, message: "Take a break",
  } }) as { activity_reminder_rules: Array<{ id: number; label_snapshot: string }> };
  const rule = snapshot.activity_reminder_rules.find(rule => rule.label_snapshot === "Usage fixture")!;
  assert.ok(rule);
  const alert = await waitFor("native usage alert", async () => {
    const alerts = await invoke("cmd_get_tool_alerts") as Array<{ id: string; activity_reminder?: { rule_id: number; usage_ms: number; limit_ms: number; message: string } }>;
    return alerts.find(alert => alert.activity_reminder?.rule_id === rule.id);
  }, 20_000);
  assert.equal(alert.activity_reminder?.usage_ms, 120_000);
  assert.equal(alert.activity_reminder?.limit_ms, 60_000);
  assert.equal(alert.activity_reminder?.message, "Take a break");
  await waitFor("native usage dialog renders without legacy reminder text", async () => evaluate(`(() => {
    const dialog = document.querySelector('.tools-usage-alert-limit');
    return dialog?.querySelector('.tools-usage-alert-name')?.textContent === 'Usage fixture'
      && !dialog.innerText.includes('Take a break') && dialog.querySelectorAll('.qp-dialog-body p').length === 1;
  })()`), 10_000);
  await invoke("cmd_extend_activity_reminder", { alertId: alert.id, extension: "fifteen_minutes" });
  const rows = await readRuntimeDatabaseRows(evaluate, "SELECT r.limit_ms,e.extension_limit_ms,e.last_extended_alert_at FROM tool_activity_reminder_rules r JOIN tool_activity_reminder_extensions e ON e.rule_id=r.id WHERE r.id=?", [rule.id]);
  assert.equal(rows[0].limit_ms, 60_000);
  assert.equal(rows[0].extension_limit_ms, 1_020_000);
  assert.equal(typeof rows[0].last_extended_alert_at, "number");
  const remaining = await invoke("cmd_get_tool_alerts") as Array<{ id: string }>;
  assert.ok(remaining.every(item => item.id !== alert.id));
  const stale = await evaluate(`window.__TAURI_INTERNALS__.invoke('cmd_extend_activity_reminder',${JSON.stringify({ alertId: alert.id, extension: "one_hour" })}).then(()=>null,error=>String(error))`);
  assert.match(String(stale), /unavailable/);
  await invoke("cmd_set_activity_reminder_enabled", { ruleId: rule.id, enabled: false });
  const updated = await invoke("cmd_update_activity_reminder_limit", { ruleId: rule.id, limitMs: 2_700_000 }) as {
    activity_reminder_rules: Array<{ id: number; enabled: boolean; limit_ms: number }>;
  };
  assert.deepEqual(updated.activity_reminder_rules.filter(item => item.id === rule.id).map(item => ({ enabled: item.enabled, limit: item.limit_ms })), [{ enabled: false, limit: 2_700_000 }]);
  const persisted = await readRuntimeDatabaseRows(evaluate,
    "SELECT r.limit_ms,s.enabled FROM tool_activity_reminder_rules r JOIN tool_activity_reminder_states s ON s.rule_id=r.id WHERE r.id=?", [rule.id]);
  assert.equal(persisted[0].limit_ms, 2_700_000);
  assert.equal(persisted[0].enabled, 0);
  const invalidLimit = await evaluate(`window.__TAURI_INTERNALS__.invoke('cmd_update_activity_reminder_limit',${JSON.stringify({ ruleId: rule.id, limitMs: 0 })}).then(()=>null,error=>String(error))`);
  assert.match(String(invalidLimit), /between 1 and 1440/);
  await invoke("cmd_set_activity_reminder_enabled", { ruleId: rule.id, enabled: true });
  const deleted = await invoke("cmd_disable_activity_reminder_rule", { ruleId: rule.id }) as { activity_reminder_rules: Array<{ id: number }> };
  assert.ok(deleted.activity_reminder_rules.every(item => item.id !== rule.id));
  console.log("PASS native usage controls, persisted limits, extensions and stale request rejection");
  // Direct IPC assertions bypass the dialog's local dismissal; leave no modal for the next scenario.
  await evaluate("document.documentElement.dataset.usageReload='pending'; location.reload()");
  await waitFor("usage dialog cleanup reload", async () => {
    try { return await evaluate("document.documentElement.dataset.usageReload!=='pending' && !!document.querySelector('main.qp-canvas') && !document.querySelector('.tools-usage-alert-surface')"); } catch { return false; }
  }, 20_000);
}
