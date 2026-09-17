import assert from "node:assert/strict";

export async function deleteWebHistoryRuntime(evaluate: (expression: string) => Promise<unknown>) {
  await evaluate(`window.__TAURI_INTERNALS__.invoke("cmd_commit_classification_settings", {mutations:[{
    key:"__web_domain_override::example.com",value:JSON.stringify({displayName:"Retained deletion preference",captureTitle:false})
  }]})`);
  const count = async (domain: string) => evaluate(`window.__TAURI_INTERNALS__.invoke("plugin:sql|select", {
    db:"sqlite:patina.db", query:"SELECT COUNT(*) AS count FROM web_activity_segments WHERE normalized_domain = ?",values:[${JSON.stringify(domain)}]
  })`) as Promise<Array<{ count: number }>>;
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
  const rule = { members: ["www.example.com"], displayName: "Website runtime fixture" };
  const linked = { members: ["other.com"] };
  const commit = (next: unknown, previous: unknown, parent = "example.com") => evaluate(`window.__TAURI_INTERNALS__.invoke("cmd_commit_classification_settings", {mutations:${JSON.stringify([
    { key: `__web_site::${parent}`, value: JSON.stringify({ next, previous }) },
  ])}})`);
  if (!restart) {
    await commit(rule, null);
    await commit(rule, null);
    await assert.rejects(() => commit({ ...rule, members: ["example.com"] }, rule));
    await assert.rejects(() => commit({ ...rule, members: [] }, null));
    await commit(linked, null, "chat.example.net");
    await commit(linked, null, "chat.example.net");
    await assert.rejects(() => commit({ ...linked, members: ["chat.example.net"] }, linked, "chat.example.net"));
    await commit({ ...linked, members: [] }, linked, "chat.example.net");
    await commit(linked, { ...linked, members: [] }, "chat.example.net");
  }
  const snapshot = await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_get_web_links")') as { rules: Record<string, unknown>; domains: string[] };
  assert.deepEqual(snapshot.rules["example.com"], rule);
  assert.equal(snapshot.domains.includes("example.com"), false, restart ? "deleted history stays absent after process restart" : "rules alone do not create recorded domains before seeding");
  assert.equal(snapshot.domains.includes("chat.example.net"), false, "relationship is not evidence of history");
  assert.deepEqual(snapshot.rules["chat.example.net"], linked);
  if (restart) {
    await commit(null, rule);
    await commit(null, linked, "chat.example.net");
    const cleared = await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_get_web_links")') as { rules: Record<string, unknown> };
    assert.equal(cleared.rules["example.com"], undefined);
  }
  console.log(`PASS real Tauri website grouping ${restart ? "restart and removal" : "atomic save, replay and conflict"}`);
}
