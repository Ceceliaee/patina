import assert from "node:assert/strict";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { verifySqlBoundaryRuntime } from "./tauriSqlBoundaryRuntime.ts";
import {
  waitFor
} from "./uiBrowserSmoke/browserHarness.ts";

import { assertMiniHasNoNativeCaption, verifyMiniContentRuntime } from "./tauriMiniContentRuntime.ts";
import { connectMini } from "./tauriMiniWindowRuntime.ts";
import { RuntimeSession, evaluate } from "./tauriRuntimeHarness.ts";
async function occupyPort(port = 0) {
  return new Promise<NetServer>((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function closeNetServer(server: NetServer | null) {
  if(!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}


export async function run(session: RuntimeSession) {
  const { root, devtoolsPort } = session;
  let client = session.client!;
  try {
    await session.show();
    await verifySqlBoundaryRuntime(expression => evaluate(client, expression), root);
    await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_open_mini_window")');
    let mini = await waitFor("permission mini WebView", () => connectMini(devtoolsPort), 20_000);
    try {
      await waitFor("permission mini ready", () => evaluate(mini, "Boolean(document.querySelector('.mini-tools'))"));
      await verifyMiniContentRuntime(client, mini);
      for (const command of ["cmd_commit_app_settings", "cmd_get_setting_rows", "cmd_install_update", "cmd_restore_backup", "cmd_open_mini_window"]) {
        const denied = await evaluate(mini, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},{}).then(()=>null,e=>String(e))`);
        assert.match(String(denied), /not allowed|permission|denied/i, `${command} must be rejected before argument parsing`);
      }
      await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("plugin:window|close",{label:"mini"})');
      mini.close();
      await waitFor("Mini destroyed before recreating its native frame", () => evaluate(client,
        `window.__TAURI_INTERNALS__.invoke('cmd_get_resource_diagnostics').then(value => !value.webview_window_labels.includes('mini') && value.mini_window.workers === 0)`));
      await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_open_mini_window")');
      mini = await waitFor("recreated Mini WebView", () => connectMini(devtoolsPort), 20_000);
      await waitFor("recreated Mini content ready", () => evaluate(mini, "Boolean(document.querySelector('.mini-tools'))"));
      const { process_id: processId } = await evaluate(client,
        `window.__TAURI_INTERNALS__.invoke('cmd_get_resource_diagnostics')`) as { process_id: number };
      assertMiniHasNoNativeCaption(processId);
      console.log("PASS recreated Mini installs caption protection before its first show");
      await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("plugin:window|close",{label:"mini"})');
    } finally { mini.close(); }
    let bridgePortBlocker = await occupyPort();
    try {
      const bridgeBlockerAddress = bridgePortBlocker.address();
      assert.ok(bridgeBlockerAddress && typeof bridgeBlockerAddress === "object");
      const webActivityBridgePort = bridgeBlockerAddress.port;
      await evaluate(client, `
    window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
      mutations: [
        {
          key: "web_activity_enabled",
          value: "1",
        },
        {
          key: "web_activity_port",
          value: "${webActivityBridgePort}",
        },
        {
          key: "web_activity_token",
          value: "runtime-smoke-bridge-secret",
        },
      ],
    })
  `);
      const retryingBridgeDiagnostics = await waitFor(
        "web activity bridge retry wait",
        async () => {
          const diagnostics = await evaluate(
            client!,
            `window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")`,
          ) as {
            web_activity_bridge?: {
              runtime?: {
                status?: string;
                port?: number | null;
                last_error_category?: string | null;
                retry_count?: number;
              };
            };
          };
          return diagnostics.web_activity_bridge?.runtime?.status === "retry-wait"
            ? diagnostics
            : null;
        },
        10_000,
      );
      assert.equal(
        retryingBridgeDiagnostics.web_activity_bridge?.runtime?.port,
        webActivityBridgePort,
      );
      assert.equal(
        retryingBridgeDiagnostics.web_activity_bridge?.runtime?.last_error_category,
        "address-in-use",
      );
      assert.ok(
        Number(retryingBridgeDiagnostics.web_activity_bridge?.runtime?.retry_count) >= 1,
      );
      assert.doesNotMatch(JSON.stringify(retryingBridgeDiagnostics), /token/i);

      await closeNetServer(bridgePortBlocker);
      bridgePortBlocker = null;
      const listeningBridgeDiagnostics = await waitFor(
        "web activity bridge automatic port recovery",
        async () => {
          const diagnostics = await evaluate(
            client!,
            `window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")`,
          ) as {
            web_activity_bridge?: {
              runtime?: {
                status?: string;
                retry_count?: number;
                last_error_category?: string | null;
              };
            };
          };
          return diagnostics.web_activity_bridge?.runtime?.status === "listening"
            ? diagnostics
            : null;
        },
        35_000,
      );
      assert.equal(listeningBridgeDiagnostics.web_activity_bridge?.runtime?.retry_count, 0);
      assert.equal(
        listeningBridgeDiagnostics.web_activity_bridge?.runtime?.last_error_category,
        null,
      );


    } finally { await closeNetServer(bridgePortBlocker); }

  } finally { session.client = client; }
}
