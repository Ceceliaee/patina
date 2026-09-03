import assert from "node:assert/strict";
import { join } from "node:path";
import { waitFor } from "../uiBrowserSmoke/browserHarness.ts";

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type Session = { id: number; start_time: number; end_time: number | null };

export async function verifyRestoreBoundary(invoke: Invoke, isolatedRoot: string) {
  const select = async (query: string, values: unknown[] = []) => await invoke("plugin:sql|select", {
    db: "sqlite:patina.db", query, values,
  }) as Session[];
  const current = () => waitFor("active native session for backup test", async () => {
    await invoke("cmd_show_main_window");
    return (await select("SELECT id,start_time,end_time FROM sessions WHERE end_time IS NULL"))[0] ?? null;
  }, 15_000);
  const archive = join(isolatedRoot, "timing-restore.zip");
  await current();
  await invoke("cmd_export_backup", { backupPath: archive });
  const preview = await invoke("cmd_preview_backup", { backupPath: archive }) as { hash: string };
  assert.ok(preview.hash);
  for (const restoreStrategy of ["merge", "replace"]) {
    const before = await current();
    const started = Date.now();
    await invoke("cmd_restore_backup", { backupPath: archive, hash: preview.hash, restoreStrategy });
    const finished = Date.now();
    const after = await waitFor(`fresh session after ${restoreStrategy} restore`, async () => {
      await invoke("cmd_show_main_window");
      return (await select("SELECT id,start_time,end_time FROM sessions WHERE end_time IS NULL AND start_time>=?", [started]))[0] ?? null;
    }, 20_000);
    assert.ok(after.start_time >= started);
    if (restoreStrategy === "merge") {
      const old = (await select("SELECT id,start_time,end_time FROM sessions WHERE id=?", [before.id]))[0];
      assert.ok(old.end_time !== null && old.end_time >= started && old.end_time <= finished);
      assert.notEqual(after.id, before.id, "merge must not resume the destination's previous open row");
    }
    const crossed = await select("SELECT w.id,w.start_time,w.end_time FROM web_activity_segments w JOIN web_activity_native_sessions r ON r.segment_id=w.id JOIN sessions s ON s.id=r.session_id WHERE w.end_time>w.start_time AND s.end_time IS NOT NULL AND w.end_time>s.end_time");
    assert.equal(crossed.length, 0, "restored webpages remain within their mapped native boundaries");
  }
  console.log("PASS real backup export, merge and replace: fresh tracking identities and bounded restored webpages");
}
