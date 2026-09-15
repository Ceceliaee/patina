import assert from "node:assert/strict";

export async function verifyLinkedApplicationsRuntime(evaluate: (expression: string) => Promise<unknown>, restart = false) {
  const read = () => evaluate(`window.__TAURI_INTERNALS__.invoke("plugin:sql|select", {
    db: "sqlite:patina.db", query: "SELECT key,value FROM settings WHERE key LIKE '__app_link::%' ORDER BY key", values: []
  })`);
  const commit = (member: string, parent: string | null, previous: string | null) => evaluate(
    `window.__TAURI_INTERNALS__.invoke("cmd_commit_classification_settings", {mutations: ${JSON.stringify([
      { key: `__app_link::${member}`, value: JSON.stringify({parent, previous}) },
    ])}})`);
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
}
