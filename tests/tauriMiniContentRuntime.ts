import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { CdpConnection, waitFor } from "./uiBrowserSmoke/browserHarness.ts";
import { assertSqlCommandsDenied } from "./tauriSqlBoundaryRuntime.ts";
import { installDesktopResourceIntervalProbe } from "./tauriResourceLifecycle.ts";

async function evaluate(client: CdpConnection, expression: string) {
  const response = await client.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return (response.result as { value?: unknown })?.value;
}

export function assertMiniHasNoNativeCaption(processId: number) {
  assert.ok(Number.isSafeInteger(processId) && processId > 0);
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference = 'Stop'
    Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class MiniFrameRead {
  delegate bool Visit(IntPtr window, IntPtr state);
  [DllImport("user32.dll")] static extern bool EnumWindows(Visit visit, IntPtr state);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern uint GetWindowStyle(IntPtr window, int index);
  public static uint Read(uint owner) {
    uint style = 0; int count = 0;
    EnumWindows((window, state) => {
      uint pid; GetWindowThreadProcessId(window, out pid);
      if (pid != owner) return true;
      var title = new StringBuilder(128); GetWindowText(window, title, title.Capacity);
      if (title.ToString() == "Patina Mini") { style = GetWindowStyle(window, -16); count++; }
      return true;
    }, IntPtr.Zero);
    if (count != 1) throw new Exception("Expected exactly one isolated Mini window");
    return style;
  }
}
'@
    [MiniFrameRead]::Read(${processId})
  `], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const style = Number(result.stdout.trim());
  assert.ok(Number.isSafeInteger(style) && style > 0, "native Mini style must be readable");
  assert.equal(style & 0x00c00000, 0, "framework visibility updates must not restore WS_CAPTION");
}

export async function verifyMiniContentRuntime(client: CdpConnection, miniClient: CdpConnection) {
  const invokeMini = (command: string, payload = {}) => evaluate(miniClient,
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(payload)})`);
  const pageState = () => invokeMini("cmd_get_mini_window_snapshot") as Promise<{ epoch: number; page: string; held: boolean }>;
  const original = await pageState();
  const originalPage = original.page;
  // Cross-window reads must not depend on where the real desktop pointer happens to be.
  await invokeMini("cmd_mini_window_action", { epoch: original.epoch, action: { kind: "hold", held: true } });
  const selectPage = async (page: string) => {
    for (let index = 0; index < 3; index++) {
      const state = await pageState();
      if (state.page === page) return;
      await invokeMini("cmd_mini_window_action", { epoch: state.epoch, action: { kind: "cycle_page", forward: true } });
    }
    assert.equal((await pageState()).page, page);
  };
  await selectPage("today");
  for (const mode of ["total", "category"]) {
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke('cmd_commit_app_settings', {mutations:[{key:'hourly_activity_chart_mode',value:'${mode}'}]})`);
    await waitFor("Mini follows the saved hourly chart mode", () => evaluate(miniClient,
      `Boolean(document.querySelector('[data-mini-page="today"][data-display-mode="${mode}"]'))`), 10_000);
  }
  await selectPage("activity");
  for (const mode of ["category", "app"]) {
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke('cmd_commit_app_settings', {mutations:[{key:'history_timeline_mode',value:'${mode}'}]})`);
    await waitFor("Mini follows the saved timeline mode", () => evaluate(miniClient,
      `Boolean(document.querySelector('[data-mini-page="activity"][data-display-mode="${mode}"]'))`), 10_000);
  }
  await miniClient.command("Page.reload", { ignoreCache: true });
  await waitFor("Mini page survives WebView restart", () => evaluate(miniClient,
    `Boolean(document.querySelector('[data-mini-page="activity"]'))`), 10_000);
  for (const kind of ["today", "activity"]) {
    const snapshot = await invokeMini("cmd_get_mini_activity_snapshot", { kind }) as { kind: string; sampled_at_ms: number; bootstrap: unknown };
    assert.equal(snapshot.kind, kind);
    assert.ok(Number.isSafeInteger(snapshot.sampled_at_ms));
    assert.ok(snapshot.bootstrap);
  }
  await assert.rejects(() => evaluate(client, `window.__TAURI_INTERNALS__.invoke('cmd_get_mini_activity_snapshot',{kind:'today'})`));
  await assert.rejects(() => invokeMini("cmd_commit_app_settings", { mutations: [{ key: "history_timeline_mode", value: "app" }] }));
  await assert.rejects(() => invokeMini("cmd_migrate_history_timeline_mode", { legacyMode: "app" }));
  await selectPage(originalPage);
  console.log("PATINA_MINI_PAGES_RUNTIME_REPORT", JSON.stringify({ modesSync: true, restoredPage: true, readOnlyBoundary: true }));
  const appearanceRead = `({
    contrast: document.documentElement.dataset.themeContrast,
    scheme: document.documentElement.dataset.colorScheme,
    surface: document.documentElement.style.getPropertyValue('--qp-bg-canvas'),
    border: document.documentElement.style.getPropertyValue('--qp-border-subtle'),
  })`;
  for (const [scheme, contrast] of [["catppuccin", "45"], ["vercel", "40"], ["default", "45"]]) {
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
      mutations: [
        { key: "color_scheme_light", value: "${scheme}" }
      ]
    })`);
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
      event: "app-settings-changed", payload: { colorSchemeLight: "${scheme}" }
    })`);
    const expectedContrast = contrast || "45";
    for (const connection of [client, miniClient]) {
      await waitFor("saved theme synchronizes across WebViews", async () => {
        const appearance = await evaluate(connection!, appearanceRead) as { contrast: string; scheme: string };
        return appearance.contrast === expectedContrast && appearance.scheme === scheme;
      }, 10_000);
    }
    assert.deepEqual(await evaluate(miniClient, appearanceRead), await evaluate(client, appearanceRead));
    const previousMiniDocument = await evaluate(miniClient, "performance.timeOrigin");
    await miniClient.command("Page.reload", { ignoreCache: true });
    await waitFor("mini theme restores from the database", async () => {
      try {
        if (!await evaluate(miniClient!, `performance.timeOrigin !== ${previousMiniDocument}
          && Boolean(document.querySelector('.mini-shell'))`)) return false;
        const appearance = await evaluate(miniClient!, appearanceRead) as { contrast: string; scheme: string };
        return appearance.contrast === expectedContrast && appearance.scheme === scheme;
      } catch { return false; }
    }, 10_000);
    assert.deepEqual(await evaluate(miniClient, appearanceRead), await evaluate(client, appearanceRead));
  }
  console.log("PATINA_THEME_RUNTIME_REPORT", JSON.stringify({ savedSync: true, miniReload: true, presetDefault: true }));
  const miniBootstrap = await evaluate(
    miniClient,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_mini_bootstrap_snapshot")`,
  ) as {
    settings?: Record<string, string | null>;
    app_overrides?: unknown[];
  };
  assert.equal(typeof miniBootstrap.settings, "object");
  assert.ok(Array.isArray(miniBootstrap.app_overrides));
  const miniPresentation = await evaluate(
    miniClient,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_mini_presentation_snapshot")`,
  ) as {
    window?: { exe_name?: string };
    tracking_status?: { is_tracking_active?: boolean };
    status?: { tools?: unknown[]; sampled_at_ms?: number };
  };
  assert.equal(typeof miniPresentation.window?.exe_name, "string");
  assert.equal(
    typeof miniPresentation.tracking_status?.is_tracking_active,
    "boolean",
  );
  assert.equal(Object.hasOwn(miniPresentation, "tracking_sampled_at_ms"), false);
  assert.equal(Object.hasOwn(miniPresentation.status ?? {}, "tracking"), false);
  assert.ok(Array.isArray(miniPresentation.status?.tools));
  assert.equal(typeof miniPresentation.status?.sampled_at_ms, "number");

  await assertSqlCommandsDenied(expression => evaluate(miniClient!, expression));
  for (const deniedExpression of [
    `window.__TAURI_INTERNALS__.invoke("cmd_set_widget_pinned", { pinned: true })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_storage_snapshot")`,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_setting_rows", { key: null, keyPrefix: null })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_history_range_rows", { startMs: 0, endMs: 1000, nowMs: 1000, includeTitleSamples: true })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_executable_icon_rows", { exeNames: [] })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_earliest_activity_start_time")`,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_recorded_executable_names")`,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_web_activity_segment_rows", { startMs: 0, endMs: 1000, nowMs: 1000 })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_observed_web_domain_rows", { sinceMs: 0, nowMs: 1000, limit: 1 })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_web_favicon_rows", { domains: [] })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_legacy_classification_apps", { nowMs: 0 })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_web_links")`,
    `window.__TAURI_INTERNALS__.invoke("cmd_restore_backup", {
      backupPath: "permission-probe.zip",
      hash: "permission-probe",
      restoreStrategy: "replace",
    })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_reveal_webdav_backup_secret")`,
    `window.__TAURI_INTERNALS__.invoke("cmd_get_remote_backup_config_snapshot")`,
    `window.__TAURI_INTERNALS__.invoke("cmd_clear_remote_backup_settings")`,
    `window.__TAURI_INTERNALS__.invoke("cmd_save_remote_backup_settings", { patch: {
      url: "http://127.0.0.1:1/dav", username: "permission-probe", remoteDir: "/Patina",
      passwordUpdate: { kind: "replace", password: "permission-probe" },
      operationId: "00000000-0000-4000-8000-000000000001",
    } })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_upload_webdav_backup", {
      config: { url: "http://127.0.0.1:1/dav", username: "permission-probe", remoteDir: "/Patina" },
      fileName: "permission-probe.zip",
    })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_delete_sessions_before", {
      cutoffTime: 0,
    })`,
    `window.__TAURI_INTERNALS__.invoke("cmd_install_update")`,
  ]) {
    const denied = await evaluate(
      miniClient,
      `${deniedExpression}.then(() => null, (error) => String(error))`,
    );
    assert.match(String(denied), /not allowed|permission|denied|not found/i);
  }
  await verifyCollapsedMiniStatus(client, miniClient);
  const { process_id: processId } = await evaluate(client,
    `window.__TAURI_INTERNALS__.invoke('cmd_get_resource_diagnostics')`) as { process_id: number };
  assertMiniHasNoNativeCaption(processId);
  for (let attempt = 0; attempt < 2; attempt++) {
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke('cmd_show_main_window')`);
    await client.command("Page.bringToFront");
    await waitFor("main window owns the explicit Mini request", () => evaluate(client,
      `window.__TAURI_INTERNALS__.invoke('plugin:window|is_focused',{label:'main'})`), 5_000);
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke('cmd_open_mini_window')`);
    await waitFor("explicit mini open settles with keyboard focus", () => evaluate(miniClient, `(() => {
      const shell = document.querySelector('.mini-shell');
      return shell?.dataset.expanded === 'true' && shell.dataset.transitioning === 'false'
        && document.activeElement === shell && Boolean(document.querySelector('.mini-content'));
    })()`), 5_000);
    await waitFor("native Mini activation follows the explicit open", () => evaluate(client,
      `window.__TAURI_INTERNALS__.invoke('plugin:window|is_focused',{label:'mini'})`), 5_000);
    assertMiniHasNoNativeCaption(processId);
    await miniClient.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" });
    await miniClient.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape" });
    await waitFor("mini still collapses after explicit activation", () => evaluate(miniClient,
      `document.querySelector('.mini-shell')?.dataset.expanded === 'false' && document.querySelector('.mini-shell').dataset.transitioning === 'false'`), 5_000);
  }
  console.log("PASS repeated main-window Mini opens stay captionless and retain native focus and keyboard collapse");
}

async function verifyCollapsedMiniStatus(main: CdpConnection, mini: CdpConnection) {
  await evaluate(mini, `(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const snapshot = await invoke('cmd_get_mini_window_snapshot');
    for (const action of [{kind:'hold',held:false},{kind:'place',edge:'top'},{kind:'collapse'}]) {
      await invoke('cmd_mini_window_action',{epoch:snapshot.epoch,action});
    }
  })()`);
  await waitFor("mini collapses before status verification", () => evaluate(mini, `document.querySelector('.mini-shell').dataset.expanded === 'false'
    && document.querySelector('.mini-shell').dataset.transitioning === 'false' && !document.querySelector('.mini-content')`), 5_000);
  await mini.command("Page.enable");
  const intervalScript = await installDesktopResourceIntervalProbe(mini);
  const previousDocument = await evaluate(mini, "performance.timeOrigin");
  const wasPaused = await evaluate(mini, `window.__TAURI_INTERNALS__.invoke('cmd_get_mini_presentation_snapshot').then(snapshot => snapshot.tracking_paused)`);
  assert.equal(typeof wasPaused, "boolean");
  try {
    await mini.command("Page.reload");
    await waitFor("collapsed status initializes without mounting content", () => evaluate(mini, `performance.timeOrigin !== ${previousDocument}
      && document.querySelector('.mini-shell')?.dataset.expanded === 'false'
      && Boolean(document.querySelector('.mini-status')?.textContent) && window.__resourceIntervalProbe?.live instanceof Map`), 10_000).catch(async error => {
        const state = await evaluate(mini, `({origin:performance.timeOrigin,shell:document.querySelector('.mini-shell')?.dataset,
          status:document.querySelector('.mini-status')?.textContent,intervalProbe:typeof window.__resourceIntervalProbe})`);
        throw new Error(`${String(error)}; renderer=${JSON.stringify(state)}`);
      });
    for (const paused of [!wasPaused, wasPaused]) {
      await evaluate(main, `window.__TAURI_INTERNALS__.invoke('cmd_commit_app_settings',{mutations:[{key:'tracking_paused',value:${JSON.stringify(paused ? "1" : "0")}}]})`);
      await waitFor("collapsed status follows native pause changes without hover", () => evaluate(mini, `(() => {
        const shell = document.querySelector('.mini-shell');
        return shell.dataset.expanded === 'false' && !document.querySelector('.mini-content')
          && ${paused ? "shell.dataset.tone === 'paused'" : "['tracking','tracking-sustained','idle'].includes(shell.dataset.tone)"};
      })()`), 5_000);
    }
    await evaluate(mini, "new Promise(resolve => setTimeout(resolve, 1100))");
    assert.equal(await evaluate(mini, "window.__resourceIntervalProbe.live.size"), 0, "collapsed mini must not retain content or health polling timers");
    assert.equal(await evaluate(mini, "Boolean(document.querySelector('.mini-content'))"), false);
    console.log("PASS collapsed status follows native events without hover, restores after reload and keeps zero polling timers");
  } finally {
    await evaluate(main, `window.__TAURI_INTERNALS__.invoke('cmd_commit_app_settings',{mutations:[{key:'tracking_paused',value:${JSON.stringify(wasPaused ? "1" : "0")}}]})`);
    await mini.command("Page.removeScriptToEvaluateOnNewDocument", { identifier: intervalScript });
    await evaluate(mini, "window.__resourceIntervalProbe?.restore()");
  }
}
