import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { evaluate, readPreparedRuntime, RuntimeSession } from "./tauriRuntimeHarness.ts";
import { RuntimeReport } from "./tauriRuntimeReport.ts";
import { connectMini } from "./tauriMiniWindowRuntime.ts";
import { parseMiniSnapshot } from "../src/platform/desktop/miniWindowRuntimeGateway.ts";
import { assertResourceEnvironment } from "./tauriRuntimeOptions.ts";
import { type CdpConnection, waitFor } from "./uiBrowserSmoke/browserHarness.ts";

const [manifest, sampler] = process.argv.slice(2);
assert.ok(manifest && sampler, "Pass the prepared Tauri manifest and the Windows resource sampler executable");
assertResourceEnvironment(process.env);
const prepared = readPreparedRuntime(resolve(manifest));
const report = new RuntimeReport("tauri-tray-mini-baseline");
const run = promisify(execFile);
const foreground = {
  hwnd: "0x42", root_owner_hwnd: "0x42", process_id: 42, window_class: "Fixture",
  title: "Fixture", exe_name: "fixture.exe", process_path: "C:\\fixture\\fixture.exe",
  is_afk: false, idle_time_ms: 0,
};
const invoke = (client: CdpConnection, name: string, args = {}) =>
  evaluate(client, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`);
type Mode = "tray" | "collapsed" | "expanded";

async function measure(mode: Mode, round: number) {
  const session = new RuntimeSession(prepared, report);
  let mini: CdpConnection | null = null;
  try {
    writeFileSync(join(session.root, "native-probe-fixture.json"), JSON.stringify({
      foreground, names: { [foreground.process_path]: "Fixture" },
    }));
    const rootPid = await session.start();
    const main = await session.connect();
    await session.show();
    report.metadata.display = await evaluate(main, "({width:screen.width,height:screen.height,dpr:devicePixelRatio})");
    await invoke(main, "cmd_commit_app_settings", { mutations: [
      { key: "close_behavior", value: "tray" }, { key: "show_tray_icon", value: "1" },
      { key: "web_activity_enabled", value: "0" },
    ] });
    const db = new DatabaseSync(join(session.root, "data", "patina.db"), { readOnly: true });
    try {
      const active = db.prepare("SELECT id FROM sessions WHERE exe_name=? AND end_time IS NULL");
      await waitFor("fixture is being recorded", () => active.get(foreground.exe_name), 20_000);
      if (mode !== "tray") {
        await invoke(main, "cmd_open_mini_window");
        mini = await waitFor("Mini connects", () => connectMini(session.devtoolsPort), 20_000);
        await waitFor("Mini is rendered", () => evaluate(mini!, "Boolean(document.querySelector('[data-mini-page],.mini-tools'))"), 15_000);
        const { epoch } = parseMiniSnapshot(await invoke(mini, "cmd_get_mini_window_snapshot"));
        const action = mode === "collapsed" ? { kind: "dock" } : { kind: "hold", held: true };
        await invoke(mini, "cmd_mini_window_action", { epoch, action });
      }
      await invoke(main, "plugin:window|close", { label: "main" });
      await waitFor("main naturally released", () => session.logs.join("").includes("reason=background-idle"), 50_000);
      const checkWindow = async () => {
        if (mini) {
          const s = parseMiniSnapshot(await invoke(mini, "cmd_get_mini_window_snapshot"));
          assert.equal(s.expanded, mode === "expanded");
          assert.equal(s.transitioning, false);
        }
      };
      await checkWindow();
      const timestamp = db.prepare("SELECT CAST(value AS INTEGER) AS ms FROM settings WHERE key='__tracker_last_successful_sample_ms'");
      const before = Number(timestamp.get()?.ms);
      const path = join(report.output, `${mode}-${round}.jsonl`);
      const result = await run(resolve(sampler), [String(rootPid), path, "600", "5", mode], { windowsHide: true });
      assert.equal(JSON.parse(readFileSync(path, "utf8").trim().split("\n").at(-1)!).complete, true, result.stderr);
      await checkWindow();
      assert.ok(active.get(foreground.exe_name), "tracking must continue with the main window closed");
      const after = Number(timestamp.get()?.ms);
      assert.ok(after - before >= 590_000 && Date.now() - after < 10_000, "successful recording samples must advance throughout the measurement");
      report.results.push({ group: `${mode}-${round}`, status: "passed" });
    } finally { db.close(); }
  } finally {
    mini?.close();
    await session.cleanup();
  }
}

process.env.PATINA_E2E_NATIVE_FIXTURE = "1";
report.metadata.prepared = { fingerprint: prepared.fingerprint, binaryHash: prepared.binaryHash, assetsHash: prepared.assetsHash };
try {
  for (let round = 1; round <= 3; round++) {
    for (const mode of ["tray", "collapsed", "expanded"] as const) {
      report.enter(`${mode}-${round}`);
      await measure(mode, round);
    }
  }
  report.leave("completed");
  report.save("passed");
} catch (error) {
  report.leave("failed");
  report.save("failed", error);
  throw error;
}
