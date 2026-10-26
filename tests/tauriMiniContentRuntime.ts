import assert from "node:assert/strict";
import { CdpConnection, waitFor } from "./uiBrowserSmoke/browserHarness.ts";
import { assertSqlCommandsDenied } from "./tauriSqlBoundaryRuntime.ts";

async function evaluate(client: CdpConnection, expression: string) {
  const response = await client.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return (response.result as { value?: unknown })?.value;
}

export async function verifyMiniContentRuntime(client: CdpConnection, miniClient: CdpConnection) {
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
    tracking_sampled_at_ms?: number;
    status?: { tracking?: unknown; tools?: unknown[]; sampled_at_ms?: number };
  };
  assert.equal(typeof miniPresentation.window?.exe_name, "string");
  assert.equal(
    typeof miniPresentation.tracking_status?.is_tracking_active,
    "boolean",
  );
  assert.equal(typeof miniPresentation.tracking_sampled_at_ms, "number");
  assert.ok(
    miniPresentation.status?.tracking === null
      || typeof miniPresentation.status?.tracking === "object",
  );
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
}
