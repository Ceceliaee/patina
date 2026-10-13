import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { readRuntimeDatabaseRows } from "./runtimeDatabase.ts";

export async function verifyAutomaticGroupingBackupRuntime(evaluate: (expression: string) => Promise<unknown>, root: string) {
  const invoke = (command: string, args: unknown = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`);
  const seed = new DatabaseSync(join(root, 'data', 'patina.db'));
  try {
    seed.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE');
    const setting = seed.prepare('INSERT INTO settings(key,value) VALUES(?,?)');
    setting.run('__web_site::chat.deepseek.com', JSON.stringify({ members: ['other.com'], displayName: 'Legacy group' }));
    setting.run('__web_domain_override::chat.deepseek.com', JSON.stringify({ displayName: 'Raw title', captureTitle: false }));
    const segment = seed.prepare("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at) VALUES('grouping','chrome','chrome.exe',?,?,1000,?,?,1000,?)");
    ['chat.deepseek.com', 'platform.deepseek.com', 'www.deepseek.com', 'deepseek.com'].forEach((domain, index) => {
      const duration = (index + 1) * 1000;
      segment.run(domain, domain, 1000 + duration, duration, 1000 + duration);
    });
    seed.exec('COMMIT');
  } finally {
    seed.close();
  }
  const backupPath = join(root, 'legacy-web-grouping.zip');
  await invoke('cmd_export_backup', { backupPath });
  const preview = await invoke('cmd_preview_backup', { backupPath }) as { hash: string };
  await invoke('cmd_restore_backup', { backupPath, hash: preview.hash, restoreStrategy: 'replace' });
  const snapshot = () => invoke('cmd_get_web_links') as Promise<{ domains: string[]; roots: Record<string,string>; totals: Record<string,number>; rules: Record<string,unknown>; overrides: Record<string,unknown> }>;
  const migrated = await snapshot();
  assert.equal(migrated.rules['chat.deepseek.com'], undefined);
  assert.deepEqual(migrated.overrides['chat.deepseek.com'], { displayName: 'Raw title', captureTitle: false });
  assert.equal(migrated.roots['platform.deepseek.com'], 'deepseek.com');
  assert.equal(migrated.totals['chat.deepseek.com'], 1000);
  const backupRows = await readRuntimeDatabaseRows(evaluate, "SELECT value FROM settings WHERE key='__web_grouping_backup_v2'") as { value:string }[];
  assert.ok(backupRows[0].value.includes('Legacy group'));
  const rule = { version:2, exceptions:['deepseek.com'] };
  const commit = (next: unknown, previous: unknown) => invoke('cmd_commit_classification_settings', { mutations:[{key:'__web_site::deepseek.com',value:JSON.stringify({next,previous})}] });
  await commit(rule,null);
  await invoke('cmd_restore_backup', { backupPath, hash:preview.hash, restoreStrategy:'merge' });
  assert.deepEqual((await snapshot()).rules['deepseek.com'], rule);
  const target = { kind:'group', domain:'deepseek.com', members:['chat.deepseek.com','platform.deepseek.com','www.deepseek.com'] };
  await assert.rejects(() => invoke('cmd_delete_web_activity_segments_by_domain', {normalizedDomain:JSON.stringify({...target,members:['chat.deepseek.com']})}));
  assert.equal((await snapshot()).domains.filter(domain=>domain.endsWith('deepseek.com')).length,4);
  await invoke('cmd_delete_web_activity_segments_by_domain', {normalizedDomain:JSON.stringify(target)});
  assert.deepEqual((await snapshot()).domains.filter(domain=>domain.endsWith('deepseek.com')),['deepseek.com']);
  await invoke('cmd_restore_backup', {backupPath,hash:preview.hash,restoreStrategy:'replace'});
  assert.deepEqual((await snapshot()).totals,migrated.totals);
  await invoke('cmd_delete_web_activity_segments_by_domain', {normalizedDomain:JSON.stringify({...target,members:[...target.members,'deepseek.com']})});
  console.log('PASS real Tauri automatic grouping legacy backup, merge precedence, recovery copy, stale deletion, independent root and conservation');
}

export async function deleteWebHistoryRuntime(evaluate: (expression: string) => Promise<unknown>) {
  await evaluate(`window.__TAURI_INTERNALS__.invoke("cmd_commit_classification_settings", {mutations:[{
    key:"__web_domain_override::example.com",value:JSON.stringify({displayName:"Retained deletion preference",captureTitle:false})
  }]})`);
  const count = (domain: string) => readRuntimeDatabaseRows(evaluate,
    "SELECT COUNT(*) AS count FROM web_activity_segments WHERE normalized_domain = ?", [domain]) as Promise<Array<{ count: number }>>;
  assert.ok((await count("example.com"))[0].count > 0);
  const otherBefore = await count("docs.example");
  await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_delete_web_activity_segments_by_domain", {normalizedDomain:"example.com"})');
  assert.deepEqual(await count("example.com"), [{ count: 0 }]);
  assert.deepEqual(await count("docs.example"), otherBefore);
  const snapshot = await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_get_web_links")') as { domains: string[]; overrides: Record<string, { displayName: string }>; rules: Record<string, unknown> };
  assert.equal(snapshot.domains.includes("example.com"), false);
  assert.equal(snapshot.overrides["example.com"].displayName, "Retained deletion preference");
  assert.ok(snapshot.rules["example.com"]);
  console.log("PASS real Tauri exact web deletion preserves other records, preferences and links");
}

export async function verifyWebLinksRuntime(evaluate: (expression: string) => Promise<unknown>, restart = false) {
  const rule = { version: 2, exceptions: ["www.example.com"], displayName: "Website runtime fixture" };
  const linked = { version: 2, exceptions: ["chat.example.net"] };
  const commit = (next: unknown, previous: unknown, parent = "example.com") => evaluate(`window.__TAURI_INTERNALS__.invoke("cmd_commit_classification_settings", {mutations:${JSON.stringify([
    { key: `__web_site::${parent}`, value: JSON.stringify({ next, previous }) },
  ])}})`);
  if (!restart) {
    await commit(rule, null);
    await commit(rule, null);
    await assert.rejects(() => commit({ ...rule, exceptions: ["other.com"] }, rule));
    await assert.rejects(() => commit({ ...rule, exceptions: [] }, null));
    await commit(linked, null, "example.net");
    await commit(linked, null, "example.net");
    await assert.rejects(() => commit({ ...linked, exceptions: ["other.com"] }, linked, "example.net"));
    await commit(null, linked, "example.net");
    await commit(linked, null, "example.net");
  }
  const snapshot = await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_get_web_links")') as { rules: Record<string, unknown>; domains: string[] };
  assert.deepEqual(snapshot.rules["example.com"], rule);
  assert.equal(snapshot.domains.includes("example.com"), false, restart ? "deleted history stays absent after process restart" : "rules alone do not create recorded domains before seeding");
  assert.equal(snapshot.domains.includes("chat.example.net"), false, "relationship is not evidence of history");
  assert.deepEqual(snapshot.rules["example.net"], linked);
  if (restart) {
    await commit(null, rule);
    await commit(null, linked, "example.net");
    const cleared = await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_get_web_links")') as { rules: Record<string, unknown> };
    assert.equal(cleared.rules["example.com"], undefined);
  }
  console.log(`PASS real Tauri website grouping ${restart ? "restart and removal" : "atomic save, replay and conflict"}`);
}
