import assert from "node:assert/strict";


export async function verifyLinkedApplicationsRuntime(evaluate: (expression: string) => Promise<unknown>, restart = false) {
  const commitTimings: unknown[] = [];
  const read = () => evaluate(`window.__TAURI_INTERNALS__.invoke("cmd_get_setting_rows", {
    key: null, keyPrefix: "__app_link::"
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
