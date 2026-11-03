import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RuntimeSession, evaluate } from "./tauriRuntimeHarness.ts";
import { assertIsolatedTempPath, waitFor } from "./uiBrowserSmoke/browserHarness.ts";

interface Alert {
  kind: string;
  body: string;
  activity_reminder: { target_label: string; usage_ms: number } | null;
}

export async function run(session: RuntimeSession) {
  assertIsolatedTempPath(session.root, "patina-tauri-e2e-");
  await session.stop();
  const databasePath = join(session.root, "data", "patina.db");
  const now = Date.now();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(20, 0, 0, 0);
  const start = yesterday.getTime();
  const lastSample = start + 120_000;
  const todayUsage = Math.min(120_000, now - today.getTime());
  const underLimitUsage = Math.min(900_000, now - today.getTime());
  const dateKey = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    // The first launch can record a foreground sample before it is stopped.
    // Replace those incidental facts in this isolated profile with the fixture.
    db.exec("DELETE FROM web_activity_segments; DELETE FROM sessions;");
    db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('tracking_paused', '1'), ('web_activity_enabled', '1'), ('__tracker_last_successful_sample_ms', ?)").run(String(lastSample));
    db.prepare(`INSERT INTO sessions(app_name, exe_name, window_title, start_time, continuity_group_start_time)
      VALUES ('Overnight App', 'overnight.exe', '', ?, ?)`).run(start, start);
    db.prepare(`INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time, duration, continuity_group_start_time)
      VALUES ('Today App', 'today.exe', '', ?, ?, ?, ?)`).run(now - todayUsage, now, todayUsage, now - todayUsage);
    db.prepare(`INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time, duration, continuity_group_start_time)
      VALUES ('Under Limit App', 'under-limit.exe', '', ?, ?, ?, ?)`).run(now - underLimitUsage, now, underLimitUsage, now - underLimitUsage);
    db.prepare(`INSERT INTO web_activity_segments(browser_client_id, browser_kind, browser_exe_name,
      domain, normalized_domain, start_time, source, created_at, updated_at)
      VALUES ('startup-fixture', 'chromium', 'chrome.exe', 'overnight.example', 'overnight.example', ?, 'browser_extension', ?, ?)`)
      .run(start, start, lastSample);
    const rule = db.prepare(`INSERT INTO tool_activity_reminder_rules(target_kind, app_name, exe_name, normalized_domain,
      label_snapshot, limit_ms, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 60000, '', ?, ?)`);
    rule.run("app", "Overnight App", "overnight.exe", null, "Overnight App", start, start);
    rule.run("app", "Today App", "today.exe", null, "Today App", start, start);
    rule.run("web", null, null, "overnight.example", "Overnight Web", start, start);
    const underLimitRule = db.prepare(`INSERT INTO tool_activity_reminder_rules(target_kind, app_name, exe_name,
      label_snapshot, limit_ms, message, created_at, updated_at)
      VALUES ('app', 'Under Limit App', 'under-limit.exe', 'Under Limit App', 1800000, '', ?, ?)`).run(start, start);
    // A saved extension below the configured daily allowance must not fire on restart.
    db.prepare(`INSERT INTO tool_activity_reminder_extensions(rule_id, extension_date_key, extension_limit_ms)
      VALUES (?, ?, ?)`).run(underLimitRule.lastInsertRowid, dateKey, Math.max(1, underLimitUsage));
    db.prepare("INSERT INTO tool_reminders(label, scheduled_at, created_at, status) VALUES ('Startup reminder', ?, ?, 'scheduled')")
      .run(now - 1000, start);
    // Hold recovery at a real persistence failure. Retry logs are the barrier;
    // no scheduler timing or arbitrary delay can make tools safe to start.
    db.exec(`CREATE TRIGGER hold_startup_native BEFORE UPDATE OF end_time ON sessions
      WHEN OLD.exe_name = 'overnight.exe' AND OLD.end_time IS NULL
      BEGIN SELECT RAISE(ABORT, 'startup recovery held'); END;
      CREATE TRIGGER hold_startup_web BEFORE UPDATE OF end_time ON web_activity_segments
      WHEN OLD.browser_client_id = 'startup-fixture' AND OLD.end_time IS NULL
      BEGIN SELECT RAISE(ABORT, 'startup recovery held'); END;`);
  } finally { db.close(); }

  const logStart = session.logs.length;
  await session.start();
  const client = await session.connect();
  const alerts = () => evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_get_tool_alerts")') as Promise<Alert[]>;
  await waitFor("tracking startup retries while recovery is held", () =>
    session.logs.slice(logStart).join("").split("tracker initialization failed:").length >= 3, 20_000);
  assert.deepEqual(await alerts(), [], "tools must not consume unrecovered overnight usage or pending reminders");

  const release = new DatabaseSync(databasePath);
  try {
    release.exec("PRAGMA busy_timeout = 5000; DROP TRIGGER hold_startup_native; DROP TRIGGER hold_startup_web;");
  } finally { release.close(); }
  const recovered = await waitFor("tools start after tracking recovery succeeds", async () => {
    const result = await alerts();
    return result.some(alert => alert.body === "Startup reminder") ? result : null;
  }, 30_000);
  const usageAlerts = recovered.filter(alert => alert.activity_reminder).map(alert => alert.activity_reminder!);
  assert.deepEqual(usageAlerts.map(alert => [alert.target_label, alert.usage_ms]),
    todayUsage >= 60_000 ? [["Today App", todayUsage]] : [], "only real usage above the daily allowance may trigger a limit alert");
  const verify = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.deepEqual({ ...verify.prepare("SELECT end_time, duration FROM sessions WHERE exe_name = 'overnight.exe'").get() },
      { end_time: lastSample, duration: 120_000 });
    const web = verify.prepare("SELECT end_time, duration FROM web_activity_segments WHERE browser_client_id = 'startup-fixture'").get()!;
    // Observation expiry may win the race with startup sealing, but never adds
    // the overnight gap to the segment or to the current day's usage.
    assert.ok(Number(web.end_time) >= lastSample && Number(web.end_time) < today.getTime());
    assert.ok(Number(web.duration) >= 120_000 && Number(web.duration) < 180_000);
    assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM tool_activity_reminder_rules WHERE label_snapshot LIKE 'Overnight %' AND last_fired_date_key IS NOT NULL").get()!.count, 0);
    assert.equal(verify.prepare("SELECT last_fired_date_key FROM tool_activity_reminder_rules WHERE exe_name = 'under-limit.exe'").get()!.last_fired_date_key, null);
  } finally { verify.close(); }
  console.log("PASS tools startup waits for recovery; overnight downtime and shortened extensions cannot trigger early alerts; due reminders still fire");
}
