import assert from "node:assert/strict";
import { connectMini } from "./tauriMiniWindowRuntime.ts";
import { evaluate, type RuntimeSession } from "./tauriRuntimeHarness.ts";
import { waitFor } from "./uiBrowserSmoke/browserHarness.ts";

export async function verifyMiniToolStatusRuntime(session: RuntimeSession) {
  let main = session.client!;
  const port = session.devtoolsPort;
  const invoke = (command: string, payload = {}) => evaluate(main, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(payload)})`);
  await invoke("cmd_open_mini_window");
  const mini = await waitFor("Mini tools WebView", () => connectMini(port), 20_000);
  const invokeMini = (command: string, payload = {}) => evaluate(mini, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(payload)})`);
  const state = await invokeMini("cmd_get_mini_window_snapshot") as { epoch: number };
  const act = (action: object) => invokeMini("cmd_mini_window_action", { epoch: state.epoch, action });
  const reminders: number[] = [];
  let timerId: number | null = null;
  const fit = async (rows: number) => {
    const height = 240;
    await waitFor(`native Mini ${rows} tool rows and height`, () => evaluate(mini, `(() => {
      const main=document.querySelector('.mini-main'),tools=document.querySelector('.mini-tools');
      return main?.getBoundingClientRect().height===240 && document.querySelectorAll('[data-titlebar-tools-status] button').length===${rows}
        && Math.abs(innerHeight-${height})<=1 && !tools;
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
    await waitFor("earliest native reminder only", () => evaluate(mini, `Array.from(document.querySelectorAll('[data-titlebar-tools-status] button')).at(-1)?.getAttribute('aria-label').includes('Mini earliest')`));
    assert.equal(await evaluate(mini, `Boolean(document.querySelector('.mini-navigation,.mini-tool-name svg'))`), false);
    await assert.rejects(() => act({ kind: "tool_control", tool: "pomodoro", id: timerId, resume: false }));
    await assert.rejects(() => invokeMini("cmd_mini_window_action", { epoch: state.epoch + 1, action: { kind: "open_tools", section: "pomodoro" } }));
    await assert.rejects(() => act({ kind: "open_tools", section: "settings" }));
    await assert.rejects(() => invokeMini("cmd_take_main_tools_target"));
    await assert.rejects(() => invokeMini("cmd_pomodoro_task", { action: { kind: "delete", id: timerId } }));
    for (const [index, icon] of [[0,"alarm-clock"],[1,"bell-ring"]] as const) {
      await evaluate(mini, `document.querySelectorAll('[data-titlebar-tools-status] button')[${index}].click()`);
      await waitFor("Mini opens the matching main tools section", () => evaluate(main, `Boolean(document.querySelector('.tools-section-tab[aria-pressed="true"] .lucide-${icon}'))`));
    }
    await invoke("cmd_commit_app_settings", { mutations: [{key:"close_behavior",value:"tray"},{key:"show_tray_icon",value:"1"}] });
    const mainTarget = main.url;
    await invoke("plugin:window|close", {label:"main"});
    await waitFor("main reclaimed while Mini remains", async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{webSocketDebuggerUrl?: string}>;
      return !targets.some(target => target.webSocketDebuggerUrl === mainTarget);
    }, 45_000);
    main.close();
    await act({ kind: "open_tools", section: "pomodoro" });
    main = await waitFor("rebuilt main WebView", () => connectMini(port, "main"), 20_000);
    session.client = main;
    await waitFor("rebuilt main consumes Mini navigation", () => evaluate(main, `Boolean(document.querySelector('.tools-section-tab[aria-pressed="true"] .lucide-alarm-clock'))`), 20_000);
    await invoke("cmd_pomodoro_task", { action: { kind: "pause", id: timerId } });
    await fit(1);
    await invoke("cmd_pomodoro_task", { action: { kind: "resume", id: timerId } });
    await fit(2);
    await invoke("cmd_cancel_reminder", { reminderId: reminders[1] });
    await waitFor("next native reminder replaces earliest", () => evaluate(mini, `Array.from(document.querySelectorAll('[data-titlebar-tools-status] button')).at(-1)?.getAttribute('aria-label').includes('Mini later')`));
    await invoke("cmd_pomodoro_task", { action: { kind: "delete", id: timerId } }); timerId = null;
    await fit(1);
    await invoke("cmd_cancel_reminder", { reminderId: reminders[0] }); reminders.length = 0;
    await fit(0);
    console.log("PASS native Mini status: fixed 320x240, earliest reminder, paused hidden, matching main navigation, stale and forbidden action denial");
  } finally {
    session.client = main;
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
