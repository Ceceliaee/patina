import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitFor } from "./uiBrowserSmoke/browserHarness.ts";

type Evaluate = (expression: string) => Promise<unknown>;

export function installLinkedRankingClock(frontendDistDir: string): string {
  // Keep this historical day across full process restarts, including midnight.
  // Only the isolated frontend clock changes; native time and timers stay real.
  const now = new Date();
  now.setDate(now.getDate() - 1);
  now.setHours(12, 0, 0, 0);
  const source = `(() => {
    const NativeDate = Date, now = ${now.getTime()};
    window.Date = new Proxy(NativeDate, {
      construct(target, args) { return Reflect.construct(target, args.length ? args : [now]); },
      apply() { return new NativeDate(now).toString(); },
      get(target, key) { return key === 'now' ? () => now : Reflect.get(target, key); }
    });
  })();`;
  writeFileSync(join(frontendDistDir, "linked-ranking-clock.js"), source, "utf8");
  const entry = join(frontendDistDir, "index.html");
  const html = readFileSync(entry, "utf8");
  assert.ok(html.includes("<head>"));
  writeFileSync(entry, html.replace("<head>", '<head><script src="/linked-ranking-clock.js"></script>'), "utf8");
  return source;
}

export async function seedLinkedApplicationRanking(evaluate: Evaluate, dbPath: string) {
  const start = await evaluate(`(() => { const day = new Date(); day.setHours(0, 0, 0, 0); return day.getTime(); })()`) as number;
  const seeded = spawnSync("python", ["-c", [
    "import sqlite3, sys",
    "db = sqlite3.connect(sys.argv[1])",
    "start = int(sys.argv[2])",
    "rows = [('Runtime Linked Parent', 'linked-parent.exe', start, 780000), ('Runtime Linked Child', 'linked-child.exe', start + 3600000, 60000)]",
    "db.executemany('INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration, continuity_group_start_time) VALUES (?, ?, ?, ?, ?, ?, ?)', [(name, exe, '', time, time + duration, duration, time) for name, exe, time, duration in rows])",
    "db.commit()",
    "db.close()",
  ].join("; "), dbPath, String(start)], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(seeded.status, 0, `linked ranking fixture failed: ${seeded.stderr || seeded.stdout}`);
  await evaluate(`window.__TAURI_INTERNALS__.invoke("cmd_commit_classification_settings", { mutations: [
    {key: "__app_override::linked-parent.exe", value: JSON.stringify({displayName: "Runtime Linked Parent", category: "office"})}
  ] })`);
}

export async function verifyLinkedApplicationRanking(evaluate: Evaluate, linked: boolean) {
  await waitFor("linked ranking dashboard navigation", async () => evaluate(`(() => {
    const nav = document.querySelector('[data-sidebar-nav-item="dashboard"]');
    if (!nav) return false; nav.click(); return true;
  })()`).catch(() => false), 10000);
  let lastRows: unknown;
  await waitFor(`linked ranking ${linked ? "merged" : "unlinked"} after restart`, async () => {
    lastRows = await evaluate(`Array.from(document.querySelectorAll('.dashboard-top-app-name-row')).map(name => ({
      name: name.querySelector('span')?.textContent,
      duration: name.parentElement.parentElement.parentElement.querySelector('.dashboard-top-app-duration span')?.textContent
    })).filter(row => row.name?.startsWith('Runtime Linked'))`);
    try {
      assert.deepEqual(lastRows, linked
        ? [{ name: "Runtime Linked Parent", duration: "14m" }]
        : [{ name: "Runtime Linked Parent", duration: "13m" }, { name: "Runtime Linked Child", duration: "1m" }]);
      return true;
    } catch { return false; }
  }, 15000).catch(error => { throw new Error(`${String(error)}; ranking=${JSON.stringify(lastRows)}`); });
  console.log(`PASS real startup linked ranking: ${JSON.stringify(lastRows)}`);
}

export async function verifyLinkedApplicationDetailAndTrend(evaluate: Evaluate) {
  await evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('.dashboard-top-app-name-row')).find(node => node.textContent.includes('Runtime Linked Parent'));
    row.parentElement.parentElement.querySelector('.dashboard-top-app-detail-trigger').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
  })()`);
  await waitFor("linked detail includes both original activities", async () => evaluate(`(() => {
    const durations = Array.from(document.querySelectorAll('.destination-detail-record-duration')).map(node => node.textContent);
    return durations.length === 2 && durations.some(value => value.includes('13')) && durations.some(value => /^1\\D/.test(value));
  })()`), 15000);
  await evaluate(`document.querySelector('.destination-detail-dialog .qp-dialog-close-button').click()`);
  await evaluate(`document.querySelector('[data-sidebar-nav-item="data"]').click()`);
  await waitFor("Data uses persisted application link", async () => evaluate(`(() => {
    const parent = document.querySelector('.data-app-option[data-destination-key="linked-parent.exe"]');
    const child = document.querySelector('.data-app-option[data-destination-key="linked-child.exe"]');
    return Boolean(parent && !child && parent.querySelector('.data-app-option-duration')?.textContent.includes('14'));
  })()`), 20000);
  console.log("PASS linked detail members and Data total after cold restart");
}

export async function verifyLinkedApplicationsRuntime(evaluate: (expression: string) => Promise<unknown>, restart = false) {
  const commitTimings: unknown[] = [];
  const read = () => evaluate(`window.__TAURI_INTERNALS__.invoke("plugin:sql|select", {
    db: "sqlite:patina.db", query: "SELECT key,value FROM settings WHERE key LIKE '__app_link::%' ORDER BY key", values: []
  })`);
  const commit = async (member: string, parent: string | null, previous: string | null) => {
    const duration = await evaluate(
    `(async () => { const start = performance.now(); await window.__TAURI_INTERNALS__.invoke("cmd_commit_classification_settings", {mutations: ${JSON.stringify([
      { key: `__app_link::${member}`, value: JSON.stringify({parent, previous}) },
    ])}}); return performance.now() - start; })()`);
    commitTimings.push({ member, parent, durationMs: duration });
  };
  if (!restart) {
    await commit("linked-child.exe", "linked-parent.exe", null);
    await commit("linked-child.exe", "linked-parent.exe", null);
    await assert.rejects(() => commit("linked-parent.exe", "linked-child.exe", null));
    await assert.rejects(() => commit("linked-child.exe", "other.exe", null));
  }
  assert.deepEqual(await read(), [{key: "__app_link::linked-child.exe", value: "linked-parent.exe"}]);
  if (restart) {
    await commit("linked-child.exe", null, "linked-parent.exe");
    assert.deepEqual(await read(), []);
  }
  console.log(`PASS real Tauri linked application ${restart ? "restart and unlink" : "save, replay and rejection"}`);
  console.log("PATINA_CLASSIFICATION_COMMIT_TIMINGS", JSON.stringify({ restart, commitTimings }));
}
