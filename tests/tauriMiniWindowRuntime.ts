import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { CdpConnection, waitFor } from "./uiBrowserSmoke/browserHarness.ts";
import { startMiniNativeProbe } from "./miniNativeProbe.ts";
import { installDesktopResourceIntervalProbe } from "./tauriResourceLifecycle.ts";
import { parseMiniSnapshot, type MiniAction } from "../src/platform/desktop/miniWindowRuntimeGateway.ts";
import { normalizeSettingsRecord } from "../src/shared/settings/appSettingsNormalization.ts";
import { miniFeedbackSamples } from "./tauriRuntimeOptions.ts";

interface Diagnostics {
  process_id: number;
  webview_window_labels: string[];
  mini_window: { detector_ticks: number; workers: number };
  process_resources: { handle_count: number; thread_count: number; private_usage_bytes: number; gdi_objects: number; user_objects: number };
  webview_recovery: Array<{ label: string; registration: number; last_failure: string | null }>;
}

async function evaluate(client: CdpConnection, expression: string) {
  const response = await client.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return (response.result as { value?: unknown } | undefined)?.value;
}

export async function connectMini(port: number, label = "mini"): Promise<CdpConnection | null> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await response.json() as Array<{ type: string; webSocketDebuggerUrl?: string }>;
  for (const target of targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl)) {
    const client = await CdpConnection.connect(target.webSocketDebuggerUrl!);
    try {
      if (await evaluate(client, `window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label === ${JSON.stringify(label)}`) === true) return client;
    } catch { /* A target may be closing while enumerated. */ }
    client.close();
  }
  return null;
}

export async function verifyMiniWindowRuntime(main: CdpConnection, port: number, resourceCycles: boolean,
  processTree: (pid: number) => { coverage: string; privateUsageBytes: number; processCount: number; cpuTimeMs: number }, signal?: AbortSignal,
  ownCleanup?: (cleanup: () => Promise<void>) => void, feedback = false) {
  assert.ok(!(feedback && resourceCycles), "Resource acceptance requires full samples");
  const counts = miniFeedbackSamples(feedback);
  const delay = (milliseconds: number) => sleep(milliseconds, undefined, { signal });
  const mainRead = (expression: string) => evaluate(main, expression);
  const diagnostics = async () => await mainRead(`window.__TAURI_INTERNALS__.invoke('cmd_get_resource_diagnostics')`) as Diagnostics;
  const baseline = await diagnostics();
  const resourceSamples: Array<{ phase: string; native: Diagnostics; tree: ReturnType<typeof processTree> }> = [];
  const sampleResources = async (phase: string) => {
    if (!resourceCycles) return;
    const native = await diagnostics();
    const tree = processTree(native.process_id);
    assert.equal(tree.coverage, "root_and_descendants", "mini acceptance requires the complete process tree");
    resourceSamples.push({ phase, native, tree });
    console.log("PATINA_MINI_RESOURCE_SAMPLE", JSON.stringify({ phase, native, tree }));
  };
  await sampleResources("before-open");
  assert.equal(baseline.webview_window_labels.includes("mini"), false, "mini must not start automatically");
  const probe = startMiniNativeProbe(baseline.process_id, signal);
  ownCleanup?.(probe.close);
  let mini: CdpConnection | null = null;
  const open = async () => {
    await waitFor("main mini entry ready", () => mainRead(`Boolean(document.querySelector('[data-titlebar-mini-entry]:not(:disabled)'))`), 15_000);
    await mainRead(`document.querySelector('[data-titlebar-mini-entry]').click()`);
    mini = await waitFor("mini WebView target", () => connectMini(port), 20_000);
    await waitFor("mini content ready", () => evaluate(mini!, `Boolean(document.querySelector('[data-mini-page],.mini-tools'))`), 15_000);
  };
  const state = async () => parseMiniSnapshot(await evaluate(mini!, `window.__TAURI_INTERNALS__.invoke('cmd_get_mini_window_snapshot')`));
  const isCollapsed = async () => { const value = await state(); return !value.expanded && !value.transitioning; };
  const action = async (value: MiniAction) => {
    const snapshot = await state();
    return evaluate(mini!, `window.__TAURI_INTERNALS__.invoke('cmd_mini_window_action',{epoch:${snapshot.epoch},action:${JSON.stringify(value)}})`);
  };
  const close = async () => {
    // Destruction may close the transport before the successful IPC reply.
    try { await evaluate(mini!, `document.querySelector('[data-mini-close]').click()`); } catch { /* Observe the native postcondition below. */ }
    mini?.close(); mini = null;
    await waitFor("mini fully released", async () => {
      const value = await diagnostics();
      return !value.webview_window_labels.includes("mini") && value.mini_window.workers === 0;
    }, 10_000);
  };
  try {
    await probe.request("sample");
    const cold = performance.now();
    await open();
    const coldMs = performance.now() - cold;
    await action({ kind: "hold", held: false });
    await action({ kind: "place", edge: "top" });
    assert.equal(await mainRead(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'})`), true);
    const epoch = (await state()).epoch;
    await mainRead(`Promise.all(Array.from({length:4},()=>window.__TAURI_INTERNALS__.invoke('cmd_open_mini_window')))`);
    assert.equal((await state()).epoch, epoch, "repeated open must reuse the same native window");
    const explicit = await probe.request("sample");
    assert.equal(explicit.foreground, explicit.mini, "explicit open must activate the mini window");
    await sampleResources("expanded");
    const storage = await mainRead(`window.__TAURI_INTERNALS__.invoke('cmd_get_storage_snapshot')`) as { paths: { databasePath: string } };
    const database = new DatabaseSync(storage.paths.databasePath, { allowExtension: false });
    try {
      database.exec("PRAGMA busy_timeout=5000");
      const stableSettings = "SELECT key,value FROM settings WHERE key IN ('language','theme_mode','close_behavior','show_tray_icon') ORDER BY key";
      const settingsBefore = database.prepare(stableSettings).all();
      database.exec("CREATE TRIGGER mini_preferences_failure BEFORE UPDATE ON settings WHEN NEW.key='mini_window_preferences' BEGIN SELECT RAISE(ABORT,'mini save failure'); END");
      try {
        await assert.rejects(() => action({ kind: "hold", held: true }), /mini save failure/);
        const savedPage = (await state()).page;
        await assert.rejects(() => action({ kind: "cycle_page", forward: true }), /mini save failure/);
        assert.equal((await state()).page, savedPage, "failed page persistence must restore the last confirmed page");
      } finally { database.exec("DROP TRIGGER mini_preferences_failure"); }
      assert.equal((await state()).held, false, "failed persistence must restore applied preference");
      assert.equal((await state()).failed, true, "save failure must be visible to the mini UI");
      assert.deepEqual(database.prepare(stableSettings).all(), settingsBefore);
      await action({ kind: "hold", held: false });
    } finally { database.close(); }
    await probe.request("focus");
    const original = await probe.request("sample");
    assert.equal(original.foreground, original.inputTarget, "native input target must receive focus");
    assert.notEqual(original.foreground, original.mini, "native input target must really be foreground");
    await probe.request("move", original.x + 400, original.y + 400);
    await waitFor("native leave collapse", isCollapsed, 3_000);
    let handle = await probe.request("sample");
    assert.deepEqual(handle.canvas, original.canvas, "hover collapse must preserve the WebView canvas position and size");
    assert.ok(handle.width < original.width && handle.height < original.height, "collapsed input region must shrink");
    assert.equal((await probe.request("sample", original.x + 50, original.y + 100)).hitMini, false, "former panel area must pass input to the desktop");
    for (const edge of ["left", "right"] as const) {
      await action({ kind: "place", edge });
      await waitFor("side collapse", isCollapsed, 3_000);
      const side = await probe.request("sample");
      assert.ok(side.width < side.height, "side handle must use a vertical native region");
      await probe.request("move", side.x + 1, side.y + Math.floor(side.height / 2));
      await waitFor("side hover reveal", async () => (await state()).expanded, 3_000);
      await probe.request("move", handle.x + 400, handle.y + 400);
    }
    // Extend only the protocol sampling window; normal timing remains covered by
    // browser transitions and the full native hover budget below.
    await evaluate(mini!, `document.querySelector('.mini-shell').style.setProperty('--qp-motion-base','600ms')`);
    try {
      for (const edge of ["top", "left", "right"] as const) {
        await action({ kind: "place", edge });
        await probe.request("focus");
        const full = await probe.request("sample");
        await evaluate(mini!, `(() => {
          globalThis.__miniResizeCount = 0;
          globalThis.__miniResizeListener = () => { globalThis.__miniResizeCount += 1; };
          window.addEventListener('resize', globalThis.__miniResizeListener);
        })()`);
        await probe.request("move", full.x + Math.floor(full.width / 2), full.y + Math.floor(full.height / 2));
        await waitFor(`${edge} panel ready before reversal`, async () => (await state()).expanded, 3_000);
        await probe.request("move", full.x + full.width + 100, full.y + full.height + 100);
        const closing = await waitFor(`${edge} exit starts`, async () => {
          const value = await state(); return !value.expanded && value.transitioning ? value : null;
        }, 3_000);
        const duringExit = await probe.request("sample");
        assert.deepEqual(duringExit.canvas, full.canvas);
        assert.equal(duringExit.width, full.width, "exit must retain the expanded native width");
        assert.equal(duringExit.height, full.height, "exit must not clip the morphing surface early");
        await action({ kind: "transition_complete", transition_id: closing.transitionId - 1 });
        assert.equal((await state()).transitioning, true, "stale completion must not clip the panel");
        await probe.request("move", full.x + Math.floor(full.width / 2), full.y + Math.floor(full.height / 2));
        const reversed = await waitFor(`${edge} pointer return reverses exit`, async () => {
          const value = await state(); return value.expanded && value.transitionId > closing.transitionId ? value : null;
        }, 3_000);
        await action({ kind: "transition_complete", transition_id: closing.transitionId });
        assert.equal((await state()).transitionId, reversed.transitionId);
        const afterReturn = await probe.request("sample");
        assert.deepEqual(afterReturn.canvas, full.canvas);
        assert.equal(afterReturn.foreground, afterReturn.inputTarget, "reversing a hover transition must not activate mini");
        assert.equal(afterReturn.width, full.width);
        assert.equal(afterReturn.height, full.height);
        await waitFor(`${edge} reverse animation completes`, async () => !(await state()).transitioning, 3_000);
        await probe.request("move", full.x + full.width + 100, full.y + full.height + 100);
        await waitFor(`${edge} native region contracts after exit`, isCollapsed, 3_000);
        const collapsed = await probe.request("sample");
        assert.deepEqual(collapsed.canvas, full.canvas, "settling must not resize or move the WebView");
        assert.equal((await probe.request("sample", collapsed.x + Math.floor(collapsed.width / 2), collapsed.y + Math.floor(collapsed.height / 2))).hitMini, true, "the handle region remains interactive");
        assert.equal((await probe.request("sample", full.x + Math.floor(full.width / 2), full.y + Math.floor(full.height / 2))).hitMini, false, "the clipped panel must release native hit testing");
        await probe.request("move", collapsed.x + Math.floor(collapsed.width / 2), collapsed.y + Math.floor(collapsed.height / 2));
        await waitFor(`${edge} handle opens without resizing`, async () => { const value = await state(); return value.expanded && !value.transitioning; }, 3_000);
        assert.deepEqual((await probe.request("sample")).canvas, full.canvas);
        assert.equal(await evaluate(mini!, `globalThis.__miniResizeCount`), 0, "neither direction may reflow the WebView viewport");
        await evaluate(mini!, `window.removeEventListener('resize', globalThis.__miniResizeListener); delete globalThis.__miniResizeListener; delete globalThis.__miniResizeCount`);
      }
    } finally {
      await evaluate(mini!, `document.querySelector('.mini-shell').style.removeProperty('--qp-motion-base')`);
    }
    console.log("PASS native morph keeps a fixed canvas in both directions, clips hit testing after exit, reverses and rejects stale completions on all three edges");
    // Isolate surface opacity and the handle fade from text and status hues.
    // Geometry, content retention and native clipping are asserted separately.
    await evaluate(mini!, `(() => {
      const style = document.createElement('style');
      style.id = 'mini-compositor-fixture';
      style.textContent = '.mini-panel-body { visibility: hidden !important; } .mini-shell { --mini-status-color: #777 !important; }';
      document.head.append(style);
    })()`);
    try {
    for (const edge of ["top", "left", "right"] as const) {
      await action({ kind: "place", edge });
      await action({ kind: "protect", keyboard: true, menu: false, touch: false });
      await action({ kind: "reveal" });
      await waitFor(`${edge} compositor starting state`, async () => {
        const value = await state();
        return value.edge === edge && value.expanded && !value.transitioning && await evaluate(mini!,
          `document.querySelector('.mini-shell').dataset.edge === ${JSON.stringify(edge)} && document.querySelector('.mini-shell').dataset.expanded === 'true' && document.querySelector('.mini-shell').dataset.transitioning === 'false'`);
      }, 3_000);
      await evaluate(mini!, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      // A blue backdrop exposes transparent gaps that a white desktop masks.
      await probe.request("backdrop");
      const canvas = (await probe.request("sample")).canvas;
      const point = await evaluate(mini!, `(() => {
        const rect = document.querySelector('.mini-handle > span').getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, scale: devicePixelRatio };
      })()`) as { x: number; y: number; scale: number };
      for (const kind of ["collapse", "reveal"] as const) {
        const capture = probe.capture(Math.round(canvas.x + point.x * point.scale), Math.round(canvas.y + point.y * point.scale));
        const sample = await (async () => {
          // Native sampling must observe its starting frame before IPC changes it.
          await capture.ready;
          await action({ kind });
          if (kind === "reveal") await action({ kind: "protect", keyboard: true, menu: false, touch: false });
          return capture.result;
        })().finally(async () => { await capture.result; });
        const colors = sample.pixels.map(color => [color & 255, (color >> 8) & 255, (color >> 16) & 255]);
        const start = colors[0], end = colors.at(-1)!;
        assert.ok((kind === "collapse" ? start : end).every(channel => channel >= 245),
          `the expanded surface must remain opaque: ${JSON.stringify({ edge, kind, start, end })}`);
        assert.ok(colors.every(color => Math.max(...color) - Math.min(...color) < 8),
          `the neutral surface exposed a colored flash during ${edge} ${kind}: ${JSON.stringify(colors)}`);
        const delta = end.map((value, channel) => value - start[channel]);
        const length = delta.reduce((sum, value) => sum + value * value, 0);
        assert.ok(length > 400, `pixel must observe the handle fading: ${JSON.stringify({ edge, kind, start, end })}`);
        let furthest = 0, largestReversal = 0;
        for (const color of colors) {
          const progress = color.reduce((sum, value, channel) => sum + (value - start[channel]) * delta[channel], 0) / length;
          largestReversal = Math.max(largestReversal, furthest - progress);
          furthest = Math.max(furthest, progress);
        }
        console.log("PATINA_MINI_COMPOSITOR_PIXEL", JSON.stringify({ edge, kind, samples: colors.length, start, end, largestReversal }));
        assert.ok(largestReversal < 0.2, `composed handle pixel flashed during ${edge} ${kind}: ${JSON.stringify(sample.pixels)}`);
      }
    }
    } finally {
      await evaluate(mini!, `document.getElementById('mini-compositor-fixture')?.remove()`);
      await probe.request("restore-backdrop");
    }
    await probe.request("focus");
    console.log("PASS shared surface remains opaque and handle pixels fade without flashes over a blue backdrop on all three edges in both directions");
    await action({ kind: "place", edge: "top" });
    await evaluate(mini!, `(() => {
      const panel = document.querySelector('.mini-panel');
      globalThis.__miniBlockedCompletions = 0;
      panel.getAnimations = function () {
        globalThis.__miniBlockedCompletions += 1;
        return [...Element.prototype.getAnimations.call(this), { finished: new Promise(() => {}) }];
      };
    })()`);
    try {
      const started = performance.now();
      await action({ kind: "collapse" });
      assert.equal((await state()).transitioning, true);
      await waitFor("missing animation acknowledgement clips the native input region", isCollapsed, 3_000);
      assert.ok(Number(await evaluate(mini!, `globalThis.__miniBlockedCompletions`)) > 0, "the renderer must wait on the injected unfinished animation");
      assert.ok(performance.now() - started >= 900, "the renderer acknowledgement was not actually withheld");
      const recoveredHandle = await probe.request("sample");
      assert.equal(recoveredHandle.width, handle.width);
      assert.equal(recoveredHandle.height, handle.height);
    } finally {
      await evaluate(mini!, `delete document.querySelector('.mini-panel').getAnimations; delete globalThis.__miniBlockedCompletions`);
    }
    console.log("PASS missing renderer completion cannot leave a permanent expanded input surface");
    for (const edge of ["left", "right", "top"] as const) {
      await action({ kind: "place", edge: null });
      const floating = await probe.request("sample");
      const grip = await evaluate(mini!, `(() => {
        const rect = document.querySelector('.mini-drag-region').getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, viewportWidth: innerWidth };
      })()`) as { x: number; y: number; viewportWidth: number };
      const scale = floating.width / grip.viewportWidth;
      const grabX = Math.round(floating.x + grip.x * scale);
      const grabY = Math.round(floating.y + grip.y * scale);
      const work = floating.workRect;
      const releaseX = edge === "left" ? work.Left + 1 : edge === "right" ? work.Right - 1 : Math.round((work.Left + work.Right) / 2);
      const releaseY = edge === "top" ? work.Top + 1 : Math.round((work.Top + work.Bottom) / 2);
      await probe.request("down", grabX, grabY);
      try {
        await probe.request("move", grabX + Math.round(12 * scale), grabY + Math.round(12 * scale));
        await waitFor("titlebar native move loop", async () => (await probe.request("sample")).moving, 3_000);
        await probe.request("move", releaseX, releaseY);
      } finally {
        await probe.request("up", releaseX, releaseY);
      }
      await waitFor(`native titlebar drag docks ${edge}`, async () => (await state()).edge === edge, 3_000);
      await probe.request("focus");
      const foreground = (await probe.request("sample")).foreground;
      await probe.request("move", Math.round((work.Left + work.Right) / 2), Math.round((work.Top + work.Bottom) / 2));
      await waitFor(`dragged ${edge} panel collapses`, isCollapsed, 3_000);
      const collapsed = await waitFor(`dragged ${edge} native handle reaches its edge`, async () => {
        const sample = await probe.request("sample");
        const atEdge = edge === "left" ? sample.x === work.Left
          : edge === "right" ? sample.x + sample.width === work.Right : sample.y === work.Top;
        return sample.visible && atEdge && (sample.width < sample.height) === (edge !== "top") ? sample : null;
      }, 3_000);
      assert.equal(collapsed.width < collapsed.height, edge !== "top", "side docking must produce a vertical handle");
      await probe.request("move", collapsed.x + Math.floor(collapsed.width / 2), collapsed.y + Math.floor(collapsed.height / 2));
      try {
        await waitFor(`dragged ${edge} handle reveals`, async () => (await state()).expanded, 3_000);
      } catch (error) {
        throw new Error(`${String(error)}; state=${JSON.stringify(await state())}; native=${JSON.stringify(await probe.request("sample"))}`);
      }
      assert.equal((await probe.request("sample")).foreground, foreground, "edge reveal must not activate the mini window");
      await probe.request("move", Math.round((work.Left + work.Right) / 2), Math.round((work.Top + work.Bottom) / 2));
      await waitFor(`leaving dragged ${edge} panel collapses again`, isCollapsed, 3_000);
    }
    console.log("PASS native titlebar drag docks left/right/top, collapses and reveals without activation");
    await action({ kind: "place", edge: "top" });
    for (const guard of ["keyboard", "menu", "touch"] as const) {
      await action({ kind: "reveal" });
      await action({ kind: "protect", keyboard: guard === "keyboard", menu: guard === "menu", touch: guard === "touch" });
      await delay(650);
      assert.equal((await state()).expanded, true, `${guard} interaction must prevent collapse`);
      await action({ kind: "protect", keyboard: false, menu: false, touch: false });
      await waitFor("protection release permits collapse", isCollapsed, 3_000);
    }
    await action({ kind: "place", edge: null });
    await probe.request("move", handle.x + 400, handle.y + 400);
    const floatBefore = await diagnostics(); await delay(600);
    assert.equal((await state()).expanded, true);
    assert.equal((await diagnostics()).mini_window.detector_ticks, floatBefore.mini_window.detector_ticks, "floating must stop proximity detection");
    await sampleResources("floating");
    await action({ kind: "hold", held: true });
    await action({ kind: "dock" });
    assert.equal((await state()).held, false, "dock explicitly releases hold");
    assert.equal((await state()).expanded, false, "dock returns floating panel to its handle");
    await action({ kind: "place", edge: null });
    const fullscreen = await probe.request("fullscreen");
    console.log("PATINA_MINI_FULLSCREEN_INPUT", JSON.stringify(fullscreen));
    assert.equal(fullscreen.foreground, fullscreen.inputTarget, "fullscreen input must be foreground");
    await waitFor("same monitor fullscreen suppression", async () => (await state()).suppressed, 3_000);
    await waitFor("fullscreen hides the actual mini HWND", async () => !(await probe.request("sample")).visible, 3_000);
    await probe.request("normal");
    await waitFor("fullscreen recovery", async () => !(await state()).suppressed, 3_000);
    await waitFor("fullscreen recovery shows the actual mini HWND", async () => (await probe.request("sample")).visible, 3_000);
    await probe.request("lock");
    await waitFor("native lock suppression", async () => (await state()).suppressed, 3_000);
    await probe.request("suspend");
    await probe.request("unlock");
    await delay(500);
    assert.equal((await state()).suppressed, true, "unlock must not override suspension");
    await probe.request("resume");
    await waitFor("native resume recovery", async () => !(await state()).suppressed, 3_000);
    await mainRead(`window.__TAURI_INTERNALS__.invoke('cmd_minimize_main_window')`);
    assert.equal(await mainRead(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_minimized',{label:'main'})`), true);
    assert.equal((await probe.request("sample")).visible, true, "main taskbar minimization must preserve mini");
    await mainRead(`window.__TAURI_INTERNALS__.invoke('cmd_show_main_window')`);
    assert.equal((await probe.request("sample")).visible, true, "main focus must not close mini");
    await action({ kind: "place", edge: "top" });
    await probe.request("move", handle.x + 400, handle.y + 400);
    await waitFor("idle handle", isCollapsed, 3_000);
    const dragHandle = await probe.request("sample");
    const grabX = dragHandle.x + Math.floor(dragHandle.width / 2);
    const grabY = dragHandle.y + Math.floor(dragHandle.height / 2);
    assert.equal((await probe.request("sample", grabX, grabY)).hitMini, true, "drag must start inside the native handle");
    await probe.request("down", grabX, grabY);
    try {
      await probe.request("move", grabX + 12, grabY + 12);
      await waitFor("handle native move loop", async () => (await probe.request("sample")).moving, 3_000);
      await probe.request("move", grabX + 250, grabY + 300);
    } catch (error) {
      throw new Error(`${String(error)}; state=${JSON.stringify(await state())}; native=${JSON.stringify(await probe.request("sample"))}`);
    } finally {
      await probe.request("up", grabX + 250, grabY + 300);
    }
    await waitFor("native handle drag becomes floating", async () => (await state()).edge === null, 3_000);
    assert.equal((await state()).expanded, true);
    await action({ kind: "place", edge: "top" });
    await probe.request("focus");
    await probe.request("move", handle.x + 400, handle.y + 400);
    await waitFor("idle handle after drag", isCollapsed, 3_000);
    await action({ kind: "reveal" });
    await action({ kind: "hold", held: true });
    const oldEpoch = (await state()).epoch;
    const oldRegistration = (await diagnostics()).webview_recovery.find(window => window.label === "mini")!.registration;
    await mini!.command("Page.enable");
    await mini!.command("Inspector.enable");
    let rendererCrashed = false;
    const crashEvents: unknown[] = [];
    const stopCrashObservation = mini!.onMessage(message => {
      if (String(message.method).startsWith("Inspector.")) crashEvents.push(message);
      if (message.method === "Inspector.targetCrashed") rendererCrashed = true;
    });
    let crashResponse = "pending";
    void mini!.command("Page.crash").then(() => { crashResponse = "acknowledged"; }, error => { crashResponse = String(error); });
    try {
      // This browser-side reply confirms that the transport consumed the
      // preceding crash request. A crashing renderer need not acknowledge it
      // or emit Inspector.targetCrashed while its debugger remains attached.
      await mini!.command("Browser.getVersion", {}, undefined, 5_000);
      console.log("PATINA_MINI_CRASH_INJECTION", JSON.stringify({ rendererCrashed, crashResponse, crashEvents }));
    } catch (error) {
      throw new Error(`Mini crash injection ${JSON.stringify({ rendererCrashed, crashResponse, crashEvents })}`, { cause: error });
    } finally {
      stopCrashObservation();
      // Detach before waiting for WebView2's native failure report. The native
      // registration and recovered epoch below establish the actual crash.
      mini!.close(); mini = null;
    }
    try {
      await waitFor("native mini renderer failure observed", async () => {
        const recovery = (await diagnostics()).webview_recovery.find(window => window.label === "mini");
        return Boolean(recovery && (recovery.last_failure || recovery.registration > oldRegistration));
      }, 10_000);
    } catch (error) {
      throw new Error(`Mini crash observation ${JSON.stringify({ crashResponse, oldRegistration, recovery: (await diagnostics()).webview_recovery, native: await probe.request("sample") })}`, { cause: error });
    }
    mini = await waitFor("mini renderer recovery", async () => {
      const candidate = await connectMini(port);
      if (!candidate) return null;
      try {
        const value = parseMiniSnapshot(await evaluate(candidate, `window.__TAURI_INTERNALS__.invoke('cmd_get_mini_window_snapshot')`));
        if (value.epoch > oldEpoch && await evaluate(candidate, `Boolean(document.querySelector('.mini-content'))`)) return candidate;
      } catch { /* Native recovery may be between renderers. */ }
      candidate.close(); return null;
    }, 20_000);
    assert.equal((await state()).held, true, "renderer recovery preserves mini preference");
    await action({ kind: "hold", held: false });
    await probe.request("focus");
    await probe.request("move", handle.x + 400, handle.y + 400);
    await waitFor("recovered mini returns to its handle", isCollapsed, 3_000);
    // The drag workload changed placement and recovery replaced the HWND.
    // Measure hover against its current input region, not the initial position.
    handle = await probe.request("sample");
    assert.equal((await probe.request("sample", handle.x + Math.floor(handle.width / 2), handle.y + 1)).hitMini,
      true, "warm hover must target the recovered native handle");
    console.log("PASS real mini renderer crash recovery preserves preference");
    const hoverForeground = (await probe.request("sample")).foreground;
    const hoverResourcesBefore = await diagnostics();
    const samples: number[] = [];
    for (let i = 0; i < counts.hover; i++) {
      await probe.request("move", handle.x + 400, handle.y + 400);
      await waitFor("warm collapse", isCollapsed, 3_000);
      const started = performance.now();
      await probe.request("move", handle.x + Math.floor(handle.width / 2), handle.y + 1);
      try {
        await waitFor("warm content frame", () => evaluate(mini!, `Boolean(document.querySelector('[data-mini-page],.mini-content .mini-tools'))`), 2_000);
      } catch (error) {
        throw new Error(`Mini reveal observation ${JSON.stringify({ cycle: i, handle, native: await probe.request("sample"), snapshot: await state(), dom: await evaluate(mini!, "document.body.innerText") })}`, { cause: error });
      }
      await evaluate(mini!, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
      samples.push(performance.now() - started);
      assert.equal((await probe.request("sample")).foreground, hoverForeground, "hover must not activate Patina");
    }
    samples.sort((a, b) => a - b);
    if (feedback) {
      console.log("PATINA_MINI_FEEDBACK_REPORT", JSON.stringify({ coldMs, revealObservationsMs: samples, acceptance: false }));
    } else {
      const percentile = (fraction: number) => samples[Math.ceil(samples.length * fraction) - 1];
      const p50 = percentile(0.5), p95 = percentile(0.95);
      console.log("PATINA_MINI_REVEAL_REPORT", JSON.stringify({ coldMs, samples: samples.length, p50, p95, animationMs: 180 }));
      assert.ok(p95 <= 250, "warm reveal p95 exceeds 250 ms");
    }
    await probe.request("move", handle.x + 400, handle.y + 400);
    await waitFor("handle before idle measurement", isCollapsed, 3_000);
    await waitFor("collapsed renderer has released content", () => evaluate(mini!, `!document.querySelector('.mini-content')`), 3_000);
    await probe.request("hide");
    await evaluate(mini!, `globalThis.__miniIdleReveals=0;globalThis.__miniIdleObserver=new MutationObserver(()=>{if(document.querySelector('.mini-shell')?.dataset.expanded==='true')globalThis.__miniIdleReveals++});globalThis.__miniIdleObserver.observe(document.querySelector('.mini-shell'),{attributes:true,attributeFilter:['data-expanded']})`);
    let idleReads = 0;
    const idleRequests: Array<{ url: string; atMs: number }> = [];
    const idleStart = performance.now();
    await mini!.command("Network.enable");
    const stopReads = mini!.onMessage(message => {
      const request = (message.params as { request?: { url?: string; method?: string } } | undefined)?.request;
      if (message.method === "Network.requestWillBeSent" && request?.method === "POST" && request.url
          && /cmd_get_mini_presentation_snapshot|cmd_get_tracker_health_snapshot/.test(request.url)) {
        idleReads++;
        if (idleRequests.length < 40) idleRequests.push({ url: request.url, atMs: performance.now() - idleStart });
      }
    });
    await sampleResources("handle-before");
    const idleBefore = await diagnostics();
    const uncollectedDomBefore = await mini!.command("Memory.getDOMCounters");
    // Event-driven status IPC creates temporary event targets. Compare retained
    // listeners after collection, as the main-window resource check does.
    await mini!.command("HeapProfiler.collectGarbage");
    const domBefore = await mini!.command("Memory.getDOMCounters") as { jsEventListeners: number };
    const idleStarted = performance.now();
    // Status events may read snapshots; the content contract checks timer cleanup.
    await delay(1_000);
    const idleAfter = await diagnostics();
    await sampleResources("handle-after");
    stopReads();
    const idleReveals = await evaluate(mini!, `globalThis.__miniIdleObserver.disconnect();globalThis.__miniIdleReveals`);
    console.log("PATINA_MINI_IDLE_OBSERVATION", JSON.stringify({ reads: idleReads, reveals: idleReveals, requests: idleRequests, native: await probe.request("sample"), state: await state() }));
    assert.equal(idleReveals, 0, "idle resource sample was interrupted by a mini reveal");
    const uncollectedDomAfter = await mini!.command("Memory.getDOMCounters");
    await mini!.command("HeapProfiler.collectGarbage");
    const domAfter = await mini!.command("Memory.getDOMCounters") as { jsEventListeners: number };
    console.log("PATINA_MINI_LISTENER_RETENTION", JSON.stringify({ uncollectedDomBefore, uncollectedDomAfter, retainedBefore: domBefore, retainedAfter: domAfter }));
    assert.ok(domAfter.jsEventListeners <= domBefore.jsEventListeners, "idle mini must not retain additional listeners after collection");
    const idleMs = performance.now() - idleStarted;
    assert.ok(idleAfter.mini_window.detector_ticks - idleBefore.mini_window.detector_ticks <= Math.ceil(idleMs / 70) + 3);
    assert.equal(await evaluate(mini!, `Boolean(document.querySelector('.mini-content'))`), false);
    console.log("PATINA_MINI_IDLE_REPORT", JSON.stringify({ idleMs, before: idleBefore, after: idleAfter }));
    await action({ kind: "reveal" });
    await action({ kind: "hold", held: true });
    const warmBaseline = await diagnostics();
    const heldTicks = warmBaseline.mini_window.detector_ticks;
    await delay(500);
    assert.equal((await diagnostics()).mini_window.detector_ticks, heldTicks, "held mini must stop proximity detection");
    for (let i = 0; i < counts.reopen; i++) {
      await action({ kind: "cycle_page", forward: true });
      const expectedPage = (await state()).page;
      await close(); await open();
      assert.equal((await state()).held, true, "mini hold preference must survive complete window destruction");
      assert.equal((await state()).page, expectedPage, "mini page must survive complete window destruction");
    }
    const finalOpen = await diagnostics();
    assert.equal(finalOpen.webview_window_labels.length, warmBaseline.webview_window_labels.length);
    assert.equal(finalOpen.mini_window.workers, 1);
    assert.ok(finalOpen.process_resources.handle_count <= warmBaseline.process_resources.handle_count + 32, "mini close/reopen leaked handles");
    assert.ok(finalOpen.process_resources.gdi_objects <= warmBaseline.process_resources.gdi_objects + 4, "mini close/reopen leaked native regions");
    console.log("PATINA_MINI_REGION_RESOURCES", JSON.stringify({ hoverBefore: hoverResourcesBefore.process_resources, hoverAfter: idleBefore.process_resources, reopenBefore: warmBaseline.process_resources, reopenAfter: finalOpen.process_resources }));
    assert.ok(idleBefore.process_resources.gdi_objects <= hoverResourcesBefore.process_resources.gdi_objects + 4, `${counts.hover} hover cycles leaked native regions`);
    const mainBeforeRelease = main.url;
    await probe.request("hide");
    const miniEpochBeforeRelease = (await state()).epoch;
    const desktopRows = await mainRead(`window.__TAURI_INTERNALS__.invoke('cmd_get_setting_rows',{key:null,keyPrefix:null}).then(rows=>rows.filter(row=>['close_behavior','show_tray_icon'].includes(row.key)))`) as Array<{ key: string; value: string }>;
    // Fresh profiles may use implicit defaults. Restore their effective behavior
    // through the same normalizer as the application, without requiring seed rows.
    const desktopSettings = normalizeSettingsRecord(Object.fromEntries(desktopRows.map(row => [row.key, row.value])));
    const previousDesktopSettings = [
      { key: "close_behavior", value: desktopSettings.closeBehavior },
      { key: "show_tray_icon", value: desktopSettings.showTrayIcon ? "1" : "0" },
    ];
    await mainRead(`window.__TAURI_INTERNALS__.invoke('cmd_commit_app_settings',{mutations:[{key:'close_behavior',value:'tray'},{key:'show_tray_icon',value:'1'}]})`);
    await mainRead(`window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'})`);
    await waitFor("main WebView released while mini remains usable", async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ webSocketDebuggerUrl?: string }>;
      return !targets.some(target => target.webSocketDebuggerUrl === mainBeforeRelease);
    }, 45_000);
    main.close();
    const survivingTargets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string }>;
    assert.equal(survivingTargets.filter(target => target.type === "page").length, 1, "only the mini WebView may remain");
    assert.equal((await state()).epoch, miniEpochBeforeRelease);
    assert.equal(await evaluate(mini!, `Boolean(document.querySelector('.mini-content')) && !document.querySelector('.qp-app-frame')`), true);
    assert.ok(await evaluate(mini!, `window.__TAURI_INTERNALS__.invoke('cmd_get_mini_presentation_snapshot')`), "mini must read current status and tools without main");
    for (const kind of ["today", "activity"]) {
      assert.ok(await evaluate(mini!, `window.__TAURI_INTERNALS__.invoke('cmd_get_mini_activity_snapshot',{kind:'${kind}'})`), "Mini statistics must remain readable without main");
    }
    const miniOnlyTree = resourceCycles ? processTree(baseline.process_id) : null;
    await evaluate(mini!, `document.querySelector('button[aria-label="打开主窗口"]').click()`);
    main = await waitFor("mini recreates main on explicit request", () => connectMini(port, "main"), 15_000);
    await main.command("Runtime.enable"); await main.command("Page.enable");
    await waitFor("rebuilt main is ready", () => mainRead(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'})`), 15_000);
    await mainRead(`window.__TAURI_INTERNALS__.invoke('cmd_commit_app_settings',{mutations:${JSON.stringify(previousDesktopSettings)}})`);
    console.log("PATINA_MINI_ONLY_REPORT", JSON.stringify({ mainDestroyed: true, miniEpochUnchanged: true, liveReadWithoutMain: true, explicitMainRecreated: true, processTree: miniOnlyTree }));
    await probe.request("native-close");
    mini?.close(); mini = null;
    await waitFor("native close releases mini only", async () => !(await diagnostics()).webview_window_labels.includes("mini"), 5_000);
    assert.equal(await mainRead(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'})`), true);
    await open();
    await action({ kind: "place", edge: null });
    await probe.request("fullscreen");
    await waitFor("fullscreen before explicit close", async () => (await state()).suppressed, 3_000);
    await close();
    await probe.request("normal");
    const closed = await diagnostics(); await delay(250);
    assert.equal((await diagnostics()).mini_window.detector_ticks, closed.mini_window.detector_ticks);
    assert.equal((await probe.request("sample")).found, false, "fullscreen ending cannot resurrect a closed mini window");
    await sampleResources("closed");
    if (resourceCycles) console.log("PATINA_MINI_RESOURCE_REPORT", JSON.stringify(resourceSamples));
    console.log("PATINA_MINI_LIFECYCLE_REPORT", JSON.stringify({ acceptance: !feedback, cycles: counts.reopen, warmBaseline, finalOpen, closed }));
    if (resourceCycles) {
      // The mini-only scenario destroyed main, including its earlier interval probe.
      // Install before application scripts again for the remaining resource suite.
      const script = await installDesktopResourceIntervalProbe(main);
      await main.command("Page.reload", { ignoreCache: true });
      await waitFor("rebuilt main resource observation", () => mainRead(`Boolean(document.querySelector('.qp-app-frame')) && window.__resourceIntervalProbe?.live instanceof Map`), 15_000);
      await main.command("Page.removeScriptToEvaluateOnNewDocument", { identifier: script });
    }
    console.log("PASS real Tauri mini single instance, native hover/focus/hit region, fullscreen and lifecycle");
    return main;
  } finally {
    mini?.close();
    await probe.close();
  }
}
