import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, sep } from "node:path";
import type { StorageSnapshot } from "../src/platform/storage/storageRuntimeGateway.ts";
import { readRuntimeDatabaseRows } from "./runtimeDatabase.ts";
import { installLinkedRankingClock, seedLinkedApplicationRanking, verifyLinkedApplicationDetailAndTrend, verifyLinkedApplicationRanking, verifyLinkedApplicationsRuntime } from "./tauriLinkedApplicationsRuntime.ts";
import { deleteWebHistoryRuntime, verifyWebLinksRuntime } from "./tauriWebLinksRuntime.ts";
import {
  CdpConnection,
  assertIsolatedTempPath,
  waitFor,
} from "./uiBrowserSmoke/browserHarness.ts";

import { seedWebActivitySegment, verifyDatabase } from "./tauriRuntimeFixtures.ts";
import { RuntimeSession, evaluate, findMainTarget } from "./tauriRuntimeHarness.ts";

const WEBVIEW_STARTUP_TIMEOUT_MS = 30_000;
export async function run(session: RuntimeSession) {
  const { root, logs, devtoolsPort, frontendDistDir } = session;
  let client = session.client!;
  try {
    await session.show();
    const runtimeDatabasePath = join(root, "data", "patina.db");
    await verifyLinkedApplicationsRuntime(expression => evaluate(client, expression));
    await verifyWebLinksRuntime(expression => evaluate(client, expression));
    seedWebActivitySegment(runtimeDatabasePath);
    await deleteWebHistoryRuntime(expression => evaluate(client, expression));
    await evaluate(client, installLinkedRankingClock(frontendDistDir));
    await seedLinkedApplicationRanking((expression) => evaluate(client!, expression), runtimeDatabasePath);
    await client.command("Page.reload");
    await verifyLinkedApplicationRanking((expression) => evaluate(client!, expression), true);

    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", { mutations: [
    { key: "theme_mode", value: "dark" },
    { key: "color_scheme_dark", value: "catppuccin" },
    { key: "refresh_interval_secs", value: "77" },
    { key: "show_tray_icon", value: "0" }
  ] })`);
    await session.stop();
    const restartLogStart = logs.join("").length;
    await session.start();
    const restartedTarget = await waitFor("theme cold restart WebView", () => findMainTarget(devtoolsPort), WEBVIEW_STARTUP_TIMEOUT_MS);
    client = await CdpConnection.connect(restartedTarget.webSocketDebuggerUrl!);
    await waitFor("theme survives full process restart", async () => {
      try {
        return await evaluate(client!, `document.documentElement.dataset.theme === 'dark'
        && document.documentElement.dataset.colorScheme === 'catppuccin'
        && document.documentElement.dataset.themeContrast === '60'
        && document.documentElement.style.getPropertyValue('--qp-bg-canvas') === '#1e1e2e'`);
      } catch { return false; }
    }, 10_000);
    await waitFor("cold restart suppresses tray creation", () => logs.join("").slice(restartLogStart)
      .includes("visibility-applied visible=false created=false"), 10_000);
    assert.doesNotMatch(logs.join("").slice(restartLogStart), /visibility-applied visible=true/);
    const hiddenPreference = await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT value FROM settings WHERE key = ?", ["show_tray_icon"]);
    assert.deepEqual(hiddenPreference, [{ value: "0" }]);
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [{ key: "show_tray_icon", value: "1" }, { key: "close_behavior", value: "tray" }],
  })`);
    await waitFor("first enable creates native tray", () => logs.join("").slice(restartLogStart)
      .includes("visibility-applied visible=true created=true"), 10_000);
    console.log("PATINA_TRAY_COLD_RESTART_REPORT", JSON.stringify({ hiddenPreferencePersisted: true, hiddenStartupCreatesNoIcon: true, firstEnableCreatesIcon: true }));
    console.log("PATINA_THEME_COLD_RESTART_REPORT", JSON.stringify({ processRestart: true, presetContrast: 60, savedScheme: "catppuccin" }));

    console.log("PASS real Tauri runtime command/event/SQLite/capability smoke");
    await verifyLinkedApplicationRanking((expression) => evaluate(client!, expression), true);
    await verifyLinkedApplicationDetailAndTrend((expression) => evaluate(client!, expression));
    await verifyLinkedApplicationsRuntime((expression) => evaluate(client!, expression), true);
    await verifyWebLinksRuntime((expression) => evaluate(client!, expression), true);
    assert.equal(await evaluate(client!, `localStorage.getItem("patina-storage-migration-proof")`), null);
    await evaluate(client!, `localStorage.setItem("patina-storage-migration-proof", "persistent-profile")`);
    const proofStorage = await evaluate(client!, `window.__TAURI_INTERNALS__.invoke("cmd_get_storage_snapshot")`) as StorageSnapshot;
    assert.ok(realpathSync(proofStorage.paths.webviewRoot).toLowerCase().startsWith(realpathSync(root).toLowerCase() + sep));
    const localStoragePath = join(proofStorage.paths.webviewRoot, "EBWebView", "Default", "Local Storage", "leveldb");
    // The migration preserves persisted profile state. A renderer-side setItem
    // acknowledgement alone does not establish that the fixture reached disk.
    await waitFor("profile migration proof reaches its backing store", () => {
      if(!existsSync(localStoragePath)) return false;
      return readdirSync(localStoragePath).filter(name => /\.(log|ldb)$/.test(name)).some(name => {
        const bytes = readFileSync(join(localStoragePath, name));
        return ["utf8", "utf16le"].some(encoding => bytes.includes(Buffer.from("persistent-profile", encoding as BufferEncoding)));
      });
    }, 30_000);
    const storageState = () => {
      const value = spawnSync("reg.exe", ["query", `HKCU\\Software\\Patina\\Storage\\tests\\${basename(root)}`, "/v", "State"],
        { encoding: "utf8", windowsHide: true });
      assert.equal(value.status, 0, value.stderr);
      const binary = value.stdout.match(/State\s+REG_BINARY\s+([a-fA-F0-9]+)/)?.[1];
      assert.ok(binary);
      return JSON.parse(Buffer.from(binary, "hex").toString("utf8")) as {
        dataRoot: string | null; pending: { state: string; sourceDataRoot: string; targetDataRoot: string } | null;
      };
    };
    const storageRestart = async (command: string, args: Record<string, string> = {}, stopAt?: string) => {
      const oldTarget = (await findMainTarget(devtoolsPort))?.webSocketDebuggerUrl;
      if(stopAt) writeFileSync(join(root, "storage-pause-request"), stopAt, "utf8");
      try {
        await evaluate(client!, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
      } catch(error) {
        // WebView2 may leave the old CDP socket open after destroying its renderer.
        // A missing reply is not success: require a different target and validate
        // the persisted state below before accepting the requested restart.
        if(!/CDP WebSocket|closed|disconnect|Timed out after \d+ms waiting for CDP command Runtime\.evaluate/i.test(String(error))) {
          throw new Error(`Storage restart command failed: ${command}`, { cause: error });
        }
      }
      client?.close();
      client = null;
      if(stopAt) {
        const paused = await waitFor(`migration reaches ${stopAt}`, () => {
          const path = join(root, "storage-paused");
          if(!existsSync(path)) return null;
          try { return JSON.parse(readFileSync(path, "utf8")) as { pid: number; phase: string }; } catch { return null; }
        }, 30_000);
        assert.equal(paused.phase, stopAt);
        assert.ok(Number.isSafeInteger(paused.pid) && paused.pid > 0);
        const interrupted = storageState();
        assert.ok(interrupted.pending);
        const committed = ["locations-committed", "partial-source-cleanup", "source-cleaned"].includes(stopAt);
        assert.equal(interrupted.pending.state, committed ? "locations-committed" : "preparing-target");
        if(committed) assert.equal(interrupted.dataRoot, interrupted.pending.targetDataRoot);
        else assert.notEqual(interrupted.dataRoot, interrupted.pending.targetDataRoot);
        assert.equal(existsSync(join(interrupted.pending.sourceDataRoot, "patina.db")), !["partial-source-cleanup", "source-cleaned"].includes(stopAt));
        await session.stop();
        rmSync(join(root, "storage-paused"));
        await session.start();
      }
      const next = await waitFor("storage operation process restart", async () => {
        const target = await findMainTarget(devtoolsPort);
        return target?.webSocketDebuggerUrl !== oldTarget ? target : null;
      }, WEBVIEW_STARTUP_TIMEOUT_MS);
      client = await CdpConnection.connect(next.webSocketDebuggerUrl!);
      await waitFor("storage restart IPC ready", async () => {
        try { return await evaluate(client!, `Boolean(window.__TAURI_INTERNALS__)`); } catch { return false; }
      }, 10_000);
      const snapshot = await evaluate(client!, `window.__TAURI_INTERNALS__.invoke("cmd_get_storage_snapshot")`) as StorageSnapshot;
      const rows = await readRuntimeDatabaseRows(expression => evaluate(client!, expression), "SELECT value FROM settings WHERE key = ?", ["color_scheme_dark"]);
      assert.deepEqual(rows, [{ value: "catppuccin" }]);
      assert.deepEqual(await readRuntimeDatabaseRows(expression => evaluate(client!, expression), "PRAGMA quick_check", []), [{ quick_check: "ok" }]);
      assert.equal(storageState().pending, null);
      assert.equal(await evaluate(client!, `localStorage.getItem("patina-storage-migration-proof")`), "persistent-profile");
      assert.ok(existsSync(join(snapshot.paths.webviewRoot, "EBWebView")));
      return snapshot;
    };
    const selectedData = join(root, "relocated-data");
    let selected = await storageRestart("cmd_restart_and_apply_storage_migration", { targetDataRoot: selectedData });
    await verifyLinkedApplicationRanking((expression) => evaluate(client!, expression), false);
    assert.equal(selected.paths.isCustomDataRoot, true);
    assert.ok(selected.paths.databasePath.toLowerCase().startsWith(selectedData.toLowerCase()));
    selected = await storageRestart("cmd_restart_and_apply_webview_cache_migration", { targetWebviewRoot: join(root, "relocated-cache") });
    assert.equal(selected.paths.isCustomDataRoot, true);
    assert.equal(selected.paths.isCustomWebviewRoot, true);
    for(const obsolete of [join(root, "data"), join(root, "webview")]) {
      assertIsolatedTempPath(root, "patina-tauri-e2e-");
      if(existsSync(obsolete)) {
        assert.ok(realpathSync(obsolete).toLowerCase().startsWith(realpathSync(root).toLowerCase() + sep));
        rmSync(obsolete, { recursive: true, force: true });
      }
    }
    selected = await storageRestart("cmd_restart_and_clear_webview_cache");
    assert.equal(selected.paths.isCustomDataRoot, true);
    assert.equal(selected.paths.isCustomWebviewRoot, true);
    selected = await storageRestart("cmd_restart_and_apply_restore_default_storage_migration");
    assert.equal(selected.paths.isCustomDataRoot, false);
    assert.equal(selected.paths.isCustomWebviewRoot, true);
    selected = await storageRestart("cmd_restart_and_apply_restore_default_webview_cache_migration");
    assert.equal(selected.paths.isCustomWebviewRoot, false);
    assert.equal(realpathSync(selected.paths.databasePath).toLowerCase(), realpathSync(join(root, "data", "patina.db")).toLowerCase());
    console.log("PASS registry storage locations survive directory removal and repeated real process restarts");
    for(const phase of ["copied-db", "validated-target", "promoted-target", "locations-committed", "partial-source-cleanup", "source-cleaned"]) {
      const before = selected.paths.databasePath;
      const target = join(root, `interrupted-${phase}`);
      selected = await storageRestart("cmd_restart_and_apply_storage_migration", { targetDataRoot: target }, phase);
      assert.ok(selected.paths.databasePath.toLowerCase().startsWith(target.toLowerCase() + sep));
      if(phase === "locations-committed") {
        assert.ok(existsSync(before), "commit recovery must preserve the uncleaned source");
      } else {
        assert.equal(existsSync(before), false, "successful recovery must finish source cleanup");
      }
      console.log(`PASS real process termination and storage recovery at ${phase}`);
    }
    selected = await storageRestart("cmd_restart_and_apply_restore_default_storage_migration");
    assert.equal(selected.paths.isCustomDataRoot, false);
    await session.stop();
    client?.close();
    client = null;
    verifyDatabase(selected.paths.databasePath);
  } finally { session.client = client; }
}
