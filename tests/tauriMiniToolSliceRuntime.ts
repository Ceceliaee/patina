import assert from "node:assert/strict";
import { connectMini } from "./tauriMiniWindowRuntime.ts";
import { evaluate } from "./tauriRuntimeHarness.ts";
import { CdpConnection, waitFor } from "./uiBrowserSmoke/browserHarness.ts";

export async function verifyMiniToolSliceRuntime(main: CdpConnection, port: number) {
  const invoke = (command: string, payload = {}) => evaluate(main, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(payload)})`);
  await invoke("cmd_open_mini_window");
  const mini = await waitFor("Mini tools WebView", () => connectMini(port), 20_000);
  const invokeMini = (command: string, payload = {}) => evaluate(mini, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(payload)})`);
  const state = await invokeMini("cmd_get_mini_window_snapshot") as { epoch: number };
  const act = (action: object) => invokeMini("cmd_mini_window_action", { epoch: state.epoch, action });
  const reminders: number[] = [];
  let timerId: number | null = null;
  const fit = async (rows: number) => {
    const height = 240 + (rows ? 6 + rows * 36 : 0);
    await waitFor(`native Mini ${rows} tool rows and height`, () => evaluate(mini, `(() => {
      const main=document.querySelector('.mini-main'),tools=document.querySelector('.mini-tools');
      return main?.getBoundingClientRect().height===240 && document.querySelectorAll('.mini-tool').length===${rows}
        && Math.abs(innerHeight-${height})<=1 && ${rows ? `tools && Math.abs(tools.getBoundingClientRect().bottom-${height})<=1` : "!tools"};
    })()`), 10_000);
  };
  try {
    await act({ kind: "hold", held: true });
    await fit(0);
    const started = await invoke("cmd_start_pomodoro", { input: { focusMs: 1_500_000, shortBreakMs: 300_000, longBreakMs: 900_000, longBreakEvery: 4 } }) as { current_pomodoro: { id: number } };
    timerId = started.current_pomodoro.id;
    await fit(1);
    for (const [label, offset] of [["Mini later", 720_000], ["Mini earliest", 600_000]] as const) {
      const snapshot = await invoke("cmd_create_reminder", { input: { label, scheduledAt: Date.now() + offset } }) as { reminders: Array<{ id: number; label: string }> };
      reminders.push(snapshot.reminders.find(reminder => reminder.label === label)!.id);
    }
    await fit(2);
    await waitFor("earliest native reminder only", () => evaluate(mini, `document.querySelector('.mini-reminder .mini-tool-name')?.textContent==='Mini earliest'`));
    assert.equal(await evaluate(mini, `Boolean(document.querySelector('.mini-navigation,.mini-tool-name svg'))`), false);
    for (const action of [
      { kind: "tool_control", tool: "pomodoro", id: timerId + 10000, resume: false },
      { kind: "tool_control", tool: "free_focus", id: timerId, resume: false },
      { kind: "tool_control", tool: "pomodoro", id: timerId, resume: true },
    ]) await assert.rejects(() => act(action));
    await assert.rejects(() => invokeMini("cmd_mini_window_action", { epoch: state.epoch + 1, action: { kind: "tool_control", tool: "pomodoro", id: timerId, resume: false } }));
    await assert.rejects(() => invokeMini("cmd_pomodoro_task", { action: { kind: "delete", id: timerId } }));
    await evaluate(mini, `document.querySelector('.mini-tool button').click()`);
    await waitFor("Mini pause updates the native tool", async () => {
      const snapshot = await invoke("cmd_get_tools_snapshot") as { current_pomodoro: { status: string } };
      return snapshot.current_pomodoro.status === "paused";
    });
    await waitFor("resume button follows native status", () => evaluate(mini, `Boolean(document.querySelector('.mini-tool button .lucide-play'))`));
    await evaluate(mini, `document.querySelector('.mini-tool button').click()`);
    await waitFor("Mini resumes the native tool", async () => {
      const snapshot = await invoke("cmd_get_tools_snapshot") as { current_pomodoro: { status: string } };
      return snapshot.current_pomodoro.status === "running";
    });
    await invoke("cmd_cancel_reminder", { reminderId: reminders[1] });
    await waitFor("next native reminder replaces earliest", () => evaluate(mini, `document.querySelector('.mini-reminder .mini-tool-name')?.textContent==='Mini later'`));
    await invoke("cmd_pomodoro_task", { action: { kind: "delete", id: timerId } }); timerId = null;
    await fit(1);
    await invoke("cmd_cancel_reminder", { reminderId: reminders[0] }); reminders.length = 0;
    await fit(0);
    console.log("PASS native Mini tool slice: 240/282/318px, earliest reminder, pause/resume, stale and foreign task denial, empty collapse");
  } finally {
    for (const reminderId of reminders) await invoke("cmd_cancel_reminder", { reminderId });
    if (timerId !== null) await invoke("cmd_pomodoro_task", { action: { kind: "delete", id: timerId } });
    try {
      await invoke("plugin:window|close", { label: "mini" });
      await waitFor("tool fixture Mini worker cleanup", async () => {
        const diagnostics = await invoke("cmd_get_resource_diagnostics") as { mini_window: { workers: number }; webview_window_labels: string[] };
        return diagnostics.mini_window.workers === 0 && !diagnostics.webview_window_labels.includes("mini");
      });
    } finally { mini.close(); }
  }
}
