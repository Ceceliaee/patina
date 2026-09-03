import assert from "node:assert/strict";
import { CdpConnection, waitFor } from "../uiBrowserSmoke/browserHarness.ts";

type Snapshot = {
  sampled_at_ms: number;
  window: { idle_time_ms: number };
  status: { sustained_participation_active: boolean };
  active_session: { id: number } | null;
};

export async function verifyMediaTimeout(
  page: CdpConnection,
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
) {
  await invoke("cmd_commit_app_settings", { mutations: [{ key: "idle_timeout_secs", value: "86400" }] });
  const audio = await page.command("Runtime.evaluate", {
    expression: `(async()=>{
      const context=new AudioContext();
      const oscillator=context.createOscillator();
      const gain=context.createGain();
      gain.gain.value=0.000001;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      await context.resume();
      window.__timingAudio=context;
      return context.state;
    })()`, userGesture: true, awaitPromise: true, returnByValue: true,
  });
  assert.equal(audio.exceptionDetails, undefined);
  try {
    const matched = await waitFor("real Chrome audio session matches sustained participation", async () => {
      const snapshot = await invoke("get_current_tracking_snapshot") as Snapshot;
      if (!snapshot.status.sustained_participation_active) return null;
      const rows=await invoke("plugin:sql|select",{db:"sqlite:patina.db",query:"SELECT id FROM sessions WHERE end_time IS NULL",values:[]}) as Array<{id:number}>;
      return rows[0] ? {...snapshot,active_session:rows[0]} : null;
    }, 15_000).catch(async error=>{
      const snapshot=await invoke("get_current_tracking_snapshot") as Snapshot;
      console.error("TIMING_MEDIA_DIAGNOSTIC",JSON.stringify(snapshot.status));
      throw error;
    });
    const threshold = Math.floor(matched.window.idle_time_ms / 1000) + 3;
    const expectedEnd = matched.sampled_at_ms - matched.window.idle_time_ms + threshold * 1000;
    await invoke("cmd_set_afk_threshold", { thresholdSecs: 0 });
    await invoke("cmd_commit_app_settings", { mutations: [{ key: "idle_timeout_secs", value: String(threshold) }] });
    const ended = await waitFor("real sustained-participation timeout", async () => {
      const rows = await invoke("plugin:sql|select", { db: "sqlite:patina.db", query: "SELECT end_time FROM sessions WHERE id=?", values: [matched.active_session!.id] }) as Array<{end_time:number|null}>;
      return rows[0]?.end_time === null ? null : rows[0];
    }, 15_000);
    assert.ok(Math.abs(ended.end_time! - expectedEnd) < 250,
      `media cutoff must use its own threshold, expected ${expectedEnd}, got ${ended.end_time}`);
    const overhang = await invoke("plugin:sql|select", { db: "sqlite:patina.db", query: "SELECT w.id FROM web_activity_segments w JOIN web_activity_native_sessions r ON r.segment_id=w.id WHERE r.session_id=? AND w.end_time>w.start_time AND w.end_time>?", values: [matched.active_session!.id, ended.end_time] });
    assert.deepEqual(overhang, []);
    console.log("PASS real silent Chrome audio session: sustained timeout uses its own cutoff and clips webpage children");
  } finally {
    await page.command("Runtime.evaluate", { expression: "window.__timingAudio?.close()", awaitPromise: true });
    await invoke("cmd_set_afk_threshold", { thresholdSecs: 86400 });
    await invoke("cmd_commit_app_settings", { mutations: [{ key: "idle_timeout_secs", value: "900" }] });
  }
}
