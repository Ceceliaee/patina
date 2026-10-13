import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { waitFor, type CdpConnection } from "./uiBrowserSmoke/browserHarness.ts";

interface NativeResources {
  webview_window_count: number;
  process_resources: { handle_count: number; thread_count: number; private_usage_bytes: number; working_set_bytes: number };
  icon_negative_cache: { entries: number; limit: number };
  tool_alerts: { entries: number; limit: number };
  web_activity_bridge: { active_clients: number; active_client_limit: number };
}

export async function verifyDesktopResourceLifecycle(
  client: CdpConnection,
  evaluate: (expression: string) => Promise<unknown>,
  processTree: () => unknown,
) {
  const started = Date.now();
  const samples: Array<{ cycle: number | "idle"; native: NativeResources; dom: { documents: number; nodes: number; jsEventListeners: number }; intervals: number; processTree: unknown }> = [];
  await evaluate(`(() => {
    const live = new Set();
    const set = window.setInterval, clear = window.clearInterval;
    window.setInterval = (...args) => { const id = set(...args); live.add(id); return id; };
    window.clearInterval = id => { live.delete(id); clear(id); };
    window.__resourceIntervalProbe = { live, restore: () => { window.setInterval = set; window.clearInterval = clear; } };
  })()`);
  const sample = async (cycle: number | "idle") => {
    await client.command("HeapProfiler.collectGarbage");
    const native = await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")') as NativeResources;
    const dom = await client.command("Memory.getDOMCounters") as typeof samples[number]["dom"];
    const intervals = await evaluate("window.__resourceIntervalProbe.live.size") as number;
    for (const value of Object.values(native.process_resources)) assert.equal(typeof value, "number", "Missing native resource counter");
    assert.equal(typeof native.webview_window_count, "number");
    assert.equal(typeof intervals, "number");
    assert.ok(native.icon_negative_cache.entries <= native.icon_negative_cache.limit);
    assert.ok(native.tool_alerts.entries <= native.tool_alerts.limit);
    assert.ok(native.web_activity_bridge.active_clients <= native.web_activity_bridge.active_client_limit);
    samples.push({ cycle, native, dom, intervals, processTree: processTree() });
    console.log(`Desktop resource sample ${cycle}: handles=${native.process_resources.handle_count}, listeners=${dom.jsEventListeners}, intervals=${intervals}`);
  };
  try {
    for (let cycle = 1; cycle <= 30; cycle += 1) {
      for (const view of ["data", "history", "settings", "about", "dashboard"]) {
        assert.equal(await evaluate(`(() => {
          const button = document.querySelector('[data-sidebar-nav-item="${view}"]');
          if (!button) return false; button.click(); return true;
        })()`), true);
        await waitFor(`${view} presentation`, async () => await evaluate(
          `document.querySelector('main.qp-canvas')?.getAttribute('data-presented-view') === '${view}'`) === true);
        // A fixed dwell is the input workload, after observable navigation completion.
        await delay(450);
        if (view === "settings") {
          assert.equal(await evaluate(`(() => {
            const button = Array.from(document.querySelectorAll('button')).find(button => /^(配置|编辑)$/.test(button.textContent?.trim() ?? ''));
            if (!button) return false; button.click(); return true;
          })()`), true, "Missing WebDAV dialog trigger");
          await waitFor("WebDAV dialog opens", async () => await evaluate(`document.querySelector('[role="dialog"]') !== null`) === true);
          // Escape follows the real dialog focus/cleanup path.
          await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
          await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
          await waitFor("WebDAV dialog closes", async () => await evaluate(`document.querySelector('[role="dialog"]') === null`) === true);
        }
      }
      await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_minimize_main_window")');
      await waitFor("Widget becomes visible", async () => await evaluate(
        'window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "widget" })') === true);
      await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")');
      await waitFor("Main window returns", async () => await evaluate(
        'window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })') === true);
      if ([5, 15, 30].includes(cycle)) await sample(cycle);
    }
    console.log("Desktop resource experiment: 60-second quiet interval");
    await delay(60_000);
    await sample("idle");
    const baseline = samples[0];
    const final = samples.at(-1)!;
    // Fixed before measurement: after five warmup rounds allow allocator noise,
    // but reject per-round accumulation of windows, timers, listeners or handles.
    assert.ok(final.native.process_resources.private_usage_bytes <= baseline.native.process_resources.private_usage_bytes + 64 * 1024 * 1024);
    assert.ok(final.native.process_resources.handle_count <= baseline.native.process_resources.handle_count + 24);
    assert.ok(final.dom.jsEventListeners <= baseline.dom.jsEventListeners + 10);
    assert.ok(final.dom.nodes <= baseline.dom.nodes + 100);
    assert.ok(final.intervals <= baseline.intervals);
    assert.equal(final.native.webview_window_count, baseline.native.webview_window_count);
  } finally {
    await evaluate("window.__resourceIntervalProbe.restore(); delete window.__resourceIntervalProbe;");
    const output = "artifacts/quality-9plus";
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "desktop-lifecycle.json"), JSON.stringify({ measuredAt: new Date().toISOString(), elapsedMs: Date.now() - started,
      workload: "30 synthetic navigation/dialog/main-widget cycles; samples after 5/15/30 plus 60 seconds idle", samples,
      limitations: ["DOM samples follow explicit GC to measure retention, not natural GC latency.", "Bounded workload; not a proof of unlimited uptime or a real-user long history."] }, null, 2), "utf8");
  }
}
