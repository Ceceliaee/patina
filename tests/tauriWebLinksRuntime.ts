import assert from "node:assert/strict";

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
  assert.ok(snapshot.domains.includes("example.com"));
  assert.deepEqual(snapshot.rules["chat.example.net"], linked);
  if (restart) {
    await commit(null, rule);
    await commit(null, linked, "chat.example.net");
    const cleared = await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_get_web_links")') as { rules: Record<string, unknown> };
    assert.equal(cleared.rules["example.com"], undefined);
  }
  console.log(`PASS real Tauri website grouping ${restart ? "restart and removal" : "atomic save, replay and conflict"}`);
}
