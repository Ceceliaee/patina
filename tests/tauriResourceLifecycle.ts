import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { waitFor, type CdpConnection } from "./uiBrowserSmoke/browserHarness.ts";

interface NativeResources {
  webview_window_count: number;
  process_resources: { handle_count: number; thread_count: number; private_usage_bytes: number; working_set_bytes: number; gdi_objects: number; user_objects: number };
  icon_negative_cache: { entries: number; limit: number };
  tool_alerts: { entries: number; limit: number };
  web_activity_bridge: { active_clients: number; active_client_limit: number };
  native_probes: Array<{ kind: string; last_error: string | null }>;
}

interface IntervalSnapshot {
  id: number;
  intervalMs: number;
  createdAtMs: number;
  stack: string;
}

export async function installDesktopResourceIntervalProbe(client: CdpConnection): Promise<string> {
  const result = await client.command("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const live = new Map();
    const set = window.setInterval, clear = window.clearInterval, clearTimeout = window.clearTimeout;
    window.setInterval = (...args) => {
      const id = set(...args);
      live.set(id, { id, intervalMs: Number(args[1] ?? 0), createdAtMs: performance.now(),
        stack: new Error().stack?.slice(0, 1024) ?? "" });
      return id;
    };
    window.clearInterval = id => { live.delete(id); clear(id); };
    window.clearTimeout = id => { live.delete(id); clearTimeout(id); };
    window.__resourceIntervalProbe = { live, restore: () => {
      window.setInterval = set; window.clearInterval = clear; window.clearTimeout = clearTimeout;
    } };
  })()` }) as { identifier: string };
  return result.identifier;
}

export async function verifyDesktopResourceLifecycle(
  client: CdpConnection,
  evaluate: (expression: string) => Promise<unknown>,
  processTree: () => { coverage: string; privateUsageBytes: number; processCount: number },
  collectionMode: "forced" | "natural" = "forced",
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const pause = (milliseconds: number) => delay(milliseconds, undefined, { signal });
  const started = Date.now();
  const samples: Array<{ cycle: number | "idle"; native: NativeResources; dom: { documents: number; nodes: number; jsEventListeners: number }; connectedListeners: unknown; intervals: number; intervalDetails: IntervalSnapshot[]; documentVisibility: string; processTree: ReturnType<typeof processTree> }> = [];
  assert.equal(await evaluate("window.__resourceIntervalProbe?.live instanceof Map"), true,
    "Interval observation must start before application scripts");
  const initialIntervals = await evaluate("[...window.__resourceIntervalProbe.live.values()]") as IntervalSnapshot[];
  let healthRequests = 0;
  const stopHealthObservation = client.onMessage(message => {
    if (message.method !== "Network.requestWillBeSent") return;
    const request = (message.params as { request?: { url?: string; method?: string } } | undefined)?.request;
    if (request?.method === "POST" && request.url
      && new URL(request.url).pathname === "/cmd_get_tracker_health_snapshot") healthRequests++;
  });
  const sample = async (cycle: number | "idle") => {
    signal?.throwIfAborted();
    // Another desktop window can occlude the WebView during the quiet interval.
    // Restore the real foreground before comparing visible-page resources.
    await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")');
    await client.command("Page.bringToFront");
    // Native visibility can precede React's visibility effects. Sample only
    // after the visible page has resumed its ordinary health polling.
    const before = healthRequests;
    await waitFor("visible resource sample with health polling resumed", async () => {
      signal?.throwIfAborted();
      return healthRequests > before && await evaluate("document.visibilityState === 'visible'") === true;
    }, 10_000);
    const native = await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")') as NativeResources;
    // Native IPC creates temporary event targets. Collect after that call so
    // retained DOM counts do not include the measurement's own request objects.
    if (collectionMode === "forced") await client.command("HeapProfiler.collectGarbage");
    const dom = await client.command("Memory.getDOMCounters") as typeof samples[number]["dom"];
    const listeners = await client.command("Runtime.evaluate", {
      expression: `(() => [window, document, ...document.querySelectorAll('*')].flatMap(target => {
        const events = getEventListeners(target);
        const types = Object.fromEntries(Object.entries(events).map(([type, values]) => [type, values.length]));
        return Object.keys(types).length ? [{ target: target === window ? 'window' : target === document ? 'document'
          : target.tagName + '.' + String(target.className).slice(0, 160), types }] : [];
      }))()`, includeCommandLineAPI: true, returnByValue: true,
    });
    assert.equal(listeners.exceptionDetails, undefined, "Connected listener diagnostics must be available");
    const connectedListeners = (listeners.result as { value?: unknown }).value;
    const intervalDetails = await evaluate("[...window.__resourceIntervalProbe.live.values()]") as IntervalSnapshot[];
    const intervals = intervalDetails.length;
    const documentVisibility = await evaluate("document.visibilityState") as string;
    assert.equal(documentVisibility, "visible");
    for (const value of Object.values(native.process_resources)) assert.equal(typeof value, "number", "Missing native resource counter");
    assert.equal(typeof native.webview_window_count, "number");
    assert.equal(typeof intervals, "number");
    assert.ok(native.icon_negative_cache.entries <= native.icon_negative_cache.limit);
    assert.ok(native.tool_alerts.entries <= native.tool_alerts.limit);
    assert.ok(native.web_activity_bridge.active_clients <= native.web_activity_bridge.active_client_limit);
    for (const probe of native.native_probes) {
      assert.notEqual(probe.last_error, "pipe", `${probe.kind} helper lost its transport without an injected fault`);
    }
    const tree = processTree();
    assert.equal(tree.coverage, "root_and_descendants", "resource acceptance requires the complete process tree");
    samples.push({ cycle, native, dom, connectedListeners, intervals, intervalDetails, documentVisibility, processTree: tree });
    console.log(`Desktop resource sample ${cycle} (${collectionMode} GC): handles=${native.process_resources.handle_count}, listeners=${dom.jsEventListeners}, intervals=${intervals}`);
  };
  try {
    await client.command("Network.enable");
    for (let cycle = 1; cycle <= 15; cycle += 1) {
      for (const view of ["data", "history", "settings", "about", "dashboard"]) {
        signal?.throwIfAborted();
        assert.equal(await evaluate(`(() => {
          const button = document.querySelector('[data-sidebar-nav-item="${view}"]');
          if (!button) return false; button.click(); return true;
        })()`), true);
        await waitFor(`${view} presentation`, async () => await evaluate(
          `document.querySelector('main.qp-canvas')?.getAttribute('data-presented-view') === '${view}'`) === true);
        // A fixed dwell is the input workload, after observable navigation completion.
        await pause(450);
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
      await waitFor("Main minimizes to taskbar", async () => await evaluate(
        'window.__TAURI_INTERNALS__.invoke("plugin:window|is_minimized", { label: "main" })') === true);
      await evaluate('window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")');
      await waitFor("Main window returns", async () => await evaluate(
        'window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })') === true);
      if ([3, 8, 15].includes(cycle)) await sample(cycle);
    }
    console.log("Desktop resource experiment: 60-second quiet interval");
    await pause(60_000);
    await sample("idle");
    const baseline = samples[0];
    const final = samples.at(-1)!;
    // Fixed before measurement: after three warmup rounds allow allocator noise,
    // but reject per-round accumulation of windows, timers, listeners or handles.
    assert.ok(final.native.process_resources.private_usage_bytes <= baseline.native.process_resources.private_usage_bytes + 64 * 1024 * 1024);
    assert.ok(final.processTree.privateUsageBytes <= baseline.processTree.privateUsageBytes + 128 * 1024 * 1024, "Complete process-tree private memory retention grew");
    assert.ok(final.processTree.processCount <= baseline.processTree.processCount, "Descendant processes accumulated across window cycles");
    assert.ok(final.native.process_resources.handle_count <= baseline.native.process_resources.handle_count + 24);
    assert.ok(final.native.process_resources.thread_count <= baseline.native.process_resources.thread_count + 2, "Native thread retention grew");
    assert.ok(final.native.process_resources.gdi_objects <= baseline.native.process_resources.gdi_objects + 10, "GDI object retention grew");
    assert.ok(final.native.process_resources.user_objects <= baseline.native.process_resources.user_objects + 10, "USER object retention grew");
    // DOM counters include unreachable objects awaiting collection. Only the
    // forced-GC run can apply the retained-object budget to those counters.
    if (collectionMode === "forced") {
      assert.ok(final.dom.jsEventListeners <= baseline.dom.jsEventListeners + 10);
      assert.ok(final.dom.nodes <= baseline.dom.nodes + 100);
    }
    assert.ok(final.intervals <= baseline.intervals);
    assert.equal(final.native.webview_window_count, baseline.native.webview_window_count);
  } finally {
    stopHealthObservation();
    const output = "artifacts/quality-9plus";
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, `desktop-lifecycle-${collectionMode}-${started}.json`), JSON.stringify({ measuredAt: new Date().toISOString(), elapsedMs: Date.now() - started, collectionMode,
      workload: "15 synthetic navigation/dialog/main taskbar cycles; samples after 3/8/15 plus 60 seconds idle", initialIntervals, samples,
      limitations: [collectionMode === "forced" ? "DOM samples follow explicit GC to measure retention, not natural GC latency." : "No explicit GC was requested; short-run heap use includes garbage awaiting collection.", "Bounded workload; not a proof of unlimited uptime or a real-user long history."] }, null, 2), "utf8");
  }
}
