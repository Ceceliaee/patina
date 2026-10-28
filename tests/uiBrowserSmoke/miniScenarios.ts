import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, waitForExpression } from "./browserHarness.ts";

export async function runMiniScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, appUrl, runTest } = context;
  const toolsEvent = JSON.stringify({
    settings: { default_countdown_minutes: 25, pomodoro_focus_minutes: 25, pomodoro_short_break_minutes: 5, pomodoro_long_break_minutes: 15, pomodoro_long_break_every: 4 },
    reminders: [], activity_reminder_rules: [], current_timer: null, timer_laps: [], current_pomodoro: null,
    today_completed_pomodoros: 0, next_reminder_at: null, sampled_at_ms: Date.now(),
  });
  const read = (expression: string) => evaluate(client, sessionId, expression);
  const wait = (expression: string) => waitForExpression(client, sessionId, expression, 15_000, "mini interaction");
  const key = async (value: string) => {
    await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: value }, sessionId);
    await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: value }, sessionId);
  };
  await runTest("mini titlebar entry uses AppWindow immediately before minimize", async () => {
    assert.equal(await read(`Boolean(document.querySelector('[data-titlebar-mini-entry] .lucide-app-window'))`), true);
    assert.equal(await read(`Boolean(document.querySelector('.app-titlebar-controls > button .lucide-minus'))`), true);
    await read(`{ const key='__time_tracker_smoke_settings';const value=JSON.parse(localStorage.getItem(key)||'{}');value.language='zh-CN';localStorage.setItem(key,JSON.stringify(value)); }`);
  });
  await runTest("mini titlebar matches neighboring hit areas without hover or focus tooltips", async () => {
    const bounds = await read(`(() => {
      const mini = document.querySelector('[data-titlebar-mini-entry]').getBoundingClientRect();
      const minimize = document.querySelector('.app-titlebar-controls .lucide-minus').closest('button').getBoundingClientRect();
      return { mini: mini.toJSON(), minimize: minimize.toJSON() };
    })()`) as { mini: DOMRect; minimize: DOMRect };
    assert.equal(bounds.mini.height, bounds.minimize.height, "Mini entry must preserve the full titlebar hit area");
    assert.equal(bounds.mini.top, bounds.minimize.top);
    assert.equal(bounds.mini.width, bounds.minimize.width);
    try {
      await client.command("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: bounds.mini.x + bounds.mini.width / 2, y: bounds.minimize.bottom - 2,
      }, sessionId);
      await wait(`(() => {
        const button = document.querySelector('[data-titlebar-mini-entry]');
        return button.matches(':hover') && button.getAnimations().every(animation => animation.playState !== 'running');
      })()`);
      const miniHover = await read(`getComputedStyle(document.querySelector('[data-titlebar-mini-entry]')).backgroundColor`);
      await read(`document.querySelector('[data-titlebar-mini-entry]').focus();new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      assert.equal(await read(`Boolean(document.querySelector('[role="tooltip"]'))`), false);
      assert.equal(await read(`document.querySelector('[data-titlebar-mini-entry]').hasAttribute('title')`), false);
      assert.equal(await read(`Boolean(document.querySelector('[data-titlebar-mini-entry]').getAttribute('aria-label'))`), true);
      await read(`document.querySelector('[data-titlebar-mini-entry]').blur()`);
      await client.command("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: bounds.minimize.x + bounds.minimize.width / 2, y: bounds.minimize.bottom - 2,
      }, sessionId);
      await wait(`(() => {
        const button = document.querySelector('.app-titlebar-controls .lucide-minus').closest('button');
        return button.matches(':hover') && button.getAnimations().every(animation => animation.playState !== 'running');
      })()`);
      assert.equal(await read(`getComputedStyle(document.querySelector('.app-titlebar-controls .lucide-minus').closest('button')).backgroundColor`), miniHover);
    } finally {
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 }, sessionId);
      await read(`document.querySelector('[data-titlebar-mini-entry]').blur()`);
    }
  });
  await runTest("mini failed titlebar open returns keyboard focus to its entry", async () => {
    await read(`globalThis.__PATINA_MINI_OPEN_HOOK=()=>new Promise((resolve,reject)=>{globalThis.__PATINA_MINI_OPEN_REJECT=reject});const entry=document.querySelector('[data-titlebar-mini-entry]');entry.focus();entry.click()`);
    await wait(`document.querySelector('[data-titlebar-mini-entry]').disabled`);
    await read(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await read(`globalThis.__PATINA_MINI_OPEN_REJECT(new Error('injected mini creation failure'))`);
    await wait(`!document.querySelector('[data-titlebar-mini-entry]').disabled && Boolean(document.querySelector('.app-titlebar-mini-error[role="alert"]'))`);
    assert.equal(await read(`document.activeElement?.hasAttribute('data-titlebar-mini-entry')`), true);
    await read(`document.querySelector('[data-titlebar-mini-entry]').click()`);
    await wait(`document.querySelector('[data-titlebar-mini-entry]').disabled`);
    await read(`document.querySelector('.app-titlebar-controls .lucide-minus').closest('button').focus();
      globalThis.__PATINA_MINI_OPEN_REJECT(new Error('injected failure after focus moved'))`);
    await wait(`!document.querySelector('[data-titlebar-mini-entry]').disabled && Boolean(document.querySelector('.app-titlebar-mini-error[role="alert"]'))`);
    assert.equal(await read(`document.activeElement === document.querySelector('.app-titlebar-controls .lucide-minus').closest('button')`), true, "failure must not steal focus from another control");
    await read(`delete globalThis.__PATINA_MINI_OPEN_HOOK;delete globalThis.__PATINA_MINI_OPEN_REJECT`);
  });
  await runTest("mini first frame waits for its window snapshot and opens directly as a panel", async () => {
    const heldKey = "__patina_navigation_held_commands";
    const stored = await read(`localStorage.getItem(${JSON.stringify(heldKey)})`) as string | null;
    try {
      await read(`localStorage.setItem(${JSON.stringify(heldKey)}, JSON.stringify(['cmd_get_mini_window_snapshot']))`);
      const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini");
      await client.command("Page.navigate", { url: url.href }, sessionId);
      await wait(`globalThis.__PATINA_NAVIGATION_PENDING?.length > 0`);
      await read(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      assert.equal(await read(`Boolean(document.querySelector('.mini-shell,.mini-handle,.mini-panel'))`), false,
        "unknown window state must not paint a collapsed handle before the panel");
      await read(`globalThis.__PATINA_NAVIGATION_PENDING.splice(0).forEach(resolve => resolve())`);
      await wait(`Boolean(document.querySelector('.mini-panel'))`);
      assert.deepEqual(await read(`(() => {
        const shell = document.querySelector('.mini-shell');
        const panel = document.querySelector('.mini-panel');
        return { expanded: shell.dataset.expanded, transitioning: shell.dataset.transitioning,
          width: panel.getBoundingClientRect().width, height: panel.getBoundingClientRect().height,
          handle: getComputedStyle(document.querySelector('.mini-handle')).visibility,
          animations: panel.getAnimations({subtree:true}).length };
      })()`), { expanded: "true", transitioning: "false", width: 304, height: 240, handle: "hidden", animations: 0 });
    } finally {
      await read(stored === null ? `localStorage.removeItem(${JSON.stringify(heldKey)})`
        : `localStorage.setItem(${JSON.stringify(heldKey)}, ${JSON.stringify(stored)})`);
      await read(`globalThis.__PATINA_NAVIGATION_PENDING?.splice(0).forEach(resolve => resolve())`);
      await client.command("Page.navigate", { url: appUrl }, sessionId);
      await wait(`Boolean(document.querySelector('[data-titlebar-mini-entry]'))`);
    }
  });
  await runTest("collapsed mini updates its status color from events without hover, content or polling", async () => {
    const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini"); url.searchParams.set("miniTools", "2");
    await client.command("Page.navigate", { url: url.href }, sessionId);
    await wait(`Boolean(document.querySelector('.mini-tools'))`);
    try {
      await key("Escape");
      await wait(`document.querySelector('.mini-shell').dataset.expanded === 'false' && document.querySelector('.mini-shell').dataset.transitioning === 'false' && !document.querySelector('.mini-content')`);
      for (const [tone, event] of [["idle", "tracking-data-changed"], ["tracking", "active-window-changed"],
        ["tracking-sustained", "tracking-data-changed"], ["paused", "app-settings-changed"],
        ["error", "tracking-data-changed"], ["tracking", "active-window-changed"]]) {
        await read(`globalThis.__PATINA_COMPACT_PRESENTATION_HOOK = snapshot => {
          globalThis.__miniStatusWindow = snapshot.window;
          return {...snapshot, tracking_paused:${tone === "paused"},
            tracking_probe_status:${JSON.stringify(tone === "error" ? "hard-degraded-inactive" : "ok")},
            tracking_status:{...snapshot.tracking_status,is_tracking_active:${tone !== "idle"},sustained_participation_active:${tone === "tracking-sustained"}}};
        };
          globalThis.__PATINA_EMIT_TAURI_EVENT(${JSON.stringify(event)}, ${event === "active-window-changed" ? "globalThis.__miniStatusWindow" : "{reason:'tracking-status-changed',changed_at_ms:Date.now()}"})`);
        await wait(`document.querySelector('.mini-shell').dataset.tone === ${JSON.stringify(tone)}`);
        assert.equal(await read(`document.querySelector('.mini-shell').dataset.expanded`), "false");
        assert.equal(await read(`Boolean(document.querySelector('.mini-content'))`), false);
      }
      const reads = () => read(`globalThis.__PATINA_INVOKED_COMMANDS.filter(entry => ['cmd_get_mini_presentation_snapshot','cmd_get_tracker_health_snapshot'].includes(entry.command)).length`);
      const before = await reads();
      await read(`globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed', ${toolsEvent});new Promise(resolve => setTimeout(resolve,1100))`);
      assert.equal(await reads(), before, "collapsed status must not restart tool subscriptions or periodic IPC reads");
    } finally {
      await read(`delete globalThis.__PATINA_COMPACT_PRESENTATION_HOOK;delete globalThis.__miniStatusWindow`);
      await client.command("Page.navigate", { url: appUrl }, sessionId);
      await wait(`Boolean(document.querySelector('[data-titlebar-mini-entry]'))`);
    }
  });
  await runTest("mini surfaces and header actions follow saved themes", async () => {
    const stored = await read(`localStorage.getItem('__time_tracker_smoke_settings')`) as string | null;
    const samples = [
      { theme: "light", scheme: "default" }, { theme: "dark", scheme: "default" },
      { theme: "light", scheme: "catppuccin" }, { theme: "dark", scheme: "catppuccin" },
    ];
    const applyTheme = async ({ theme, scheme }: typeof samples[number]) => {
      await read(`{
        const key = '__time_tracker_smoke_settings';
        const value = JSON.parse(localStorage.getItem(key) || '{}');
        value.theme_mode = ${JSON.stringify(theme)};
        value['color_scheme_' + ${JSON.stringify(theme)}] = ${JSON.stringify(scheme)};
        localStorage.setItem(key, JSON.stringify(value));
        globalThis.__PATINA_EMIT_TAURI_EVENT('app-settings-changed', {});
      }`);
      await wait(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}
        && document.documentElement.dataset.colorScheme === ${JSON.stringify(scheme)}`);
    };
    const readActionFeedback = async (selector: string) => {
      const button = `document.querySelector(${JSON.stringify(selector)})`;
      const colors = () => read(`(() => {
        const style = getComputedStyle(${button});
        return { background: style.backgroundColor, foreground: style.color };
      })()`);
      const bounds = await read(`${button}.getBoundingClientRect().toJSON()`) as DOMRect;
      const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      try {
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, sessionId);
        await wait(`${button}.matches(':hover') && ${button}.getAnimations().every(animation => animation.playState !== 'running')`);
        const hover = await colors();
        await client.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 }, sessionId);
        await wait(`${button}.matches(':active') && ${button}.getAnimations().every(animation => animation.playState !== 'running')`);
        return { hover, active: await colors() };
      } finally {
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0, buttons: 1 }, sessionId);
        await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: 0, y: 0, button: "left", buttons: 0, clickCount: 1 }, sessionId);
        await wait(`!${button}.matches(':hover, :active') && ${button}.getAnimations().every(animation => animation.playState !== 'running')`);
      }
    };
    const expected: Array<{ surfaces: unknown; close: Awaited<ReturnType<typeof readActionFeedback>> }> = [];
    try {
      await client.command("Page.navigate", { url: appUrl }, sessionId);
      await wait(`document.querySelector('main.qp-canvas')?.dataset.viewTransitionState === 'settled'`);
      await read(`document.querySelector('[data-sidebar-nav-item="dashboard"]').click()`);
      await wait(`document.querySelector('main.qp-canvas')?.dataset.presentedView === 'dashboard'
        && document.querySelector('main.qp-canvas')?.dataset.viewTransitionState === 'settled'`);
      for (const sample of samples) {
        await applyTheme(sample);
        expected.push({
          surfaces: await read(`({
            titlebar: getComputedStyle(document.querySelector('.app-titlebar')).backgroundColor,
            sidebar: getComputedStyle(document.querySelector('[data-sidebar-navigation-mode]')).backgroundColor,
          })`),
          close: await readActionFeedback('.app-titlebar-close'),
        });
      }
      const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini");
      await client.command("Page.navigate", { url: url.href }, sessionId);
      await wait(`Boolean(document.querySelector('.mini-tools'))`);
      for (const [index, sample] of samples.entries()) {
        await applyTheme(sample);
        assert.deepEqual(await read(`({
          titlebar: getComputedStyle(document.querySelector('.mini-header')).backgroundColor,
          sidebar: getComputedStyle(document.querySelector('.mini-panel')).backgroundColor,
        })`), expected[index].surfaces, `${sample.theme} ${sample.scheme}: Mini must match the main window surfaces`);
        assert.deepEqual(await readActionFeedback('[data-mini-close]'), expected[index].close, `${sample.theme} ${sample.scheme}: close feedback must match the main window`);
        assert.equal(await read(`getComputedStyle(document.querySelector('.mini-content')).backgroundColor`), "rgba(0, 0, 0, 0)", "content must retain the panel background");
        assert.equal(await read(`Boolean(document.querySelector('.mini-content .mini-status'))`), false, "the redundant visible status row must be absent");
        assert.equal(await read(`document.querySelector('.mini-status').getBoundingClientRect().height <= 1`), true, "the status label remains available to screen readers without a visible row");
        const neutralFeedback = await readActionFeedback('.mini-header button:first-of-type');
        const neutral = await read(`(() => {
          const style = getComputedStyle(document.querySelector('.mini-header button:first-of-type'));
          return { color: style.color, background: style.backgroundColor };
        })()`) as { color: string; background: string };
        for (const held of [true, false]) {
          await read(`document.querySelector('.mini-header [aria-pressed]').click()`);
          await wait(`document.querySelector('.mini-header [aria-pressed]').getAttribute('aria-pressed') === '${held}'`);
          assert.deepEqual(await read(`(() => {
            const button = document.querySelector('.mini-header [aria-pressed]');
            const style = getComputedStyle(button);
            return { color: style.color, background: style.backgroundColor, fill: getComputedStyle(button.querySelector('svg')).fill };
          })()`), { ...neutral, fill: held ? neutral.color : "none" }, `${sample.theme} ${sample.scheme}: hold must use a neutral filled or outlined pin`);
          assert.deepEqual(await readActionFeedback('.mini-header [aria-pressed]'), neutralFeedback, "hold feedback must remain neutral in either state");
        }
        for (const [tone, token] of [
          ["tracking", "--qp-success"], ["tracking-sustained", "--qp-participation"],
          ["idle", "--qp-text-tertiary"], ["paused", "--qp-warning"], ["error", "--qp-danger"],
        ]) {
          await read(`globalThis.__PATINA_COMPACT_PRESENTATION_HOOK = snapshot => ({ ...snapshot,
            tracking_paused: ${tone === "paused"},
            tracking_probe_status: ${JSON.stringify(tone === "error" ? "hard-degraded-inactive" : "ok")},
            tracking_status: { ...snapshot.tracking_status,
              is_tracking_active: ${tone !== "idle"}, sustained_participation_active: ${tone === "tracking-sustained"} },
          }); globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed', ${toolsEvent})`);
          await wait(`document.querySelector('.mini-shell')?.dataset.tone === ${JSON.stringify(tone)}`);
          const readColors = () => read(`(() => {
            const probe = document.createElement('span');
            probe.style.backgroundColor = ${JSON.stringify(`var(${token})`)};
            document.body.append(probe);
            const expected = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return { icon: getComputedStyle(document.querySelector('.mini-drag-region svg')).color,
              handle: getComputedStyle(document.querySelector('.mini-handle > span')).backgroundColor, expected };
          })()`) as Promise<{ icon: string; handle: string; expected: string }>;
          const colors = await readColors();
          assert.equal(colors.icon, colors.expected, `${sample.theme} ${sample.scheme}: ${tone} must color the header icon`);
          assert.equal(colors.handle, colors.expected, `${sample.theme} ${sample.scheme}: ${tone} must color the handle line`);
          await key("Escape");
          await wait(`document.querySelector('.mini-shell').dataset.expanded === 'false'
            && document.querySelector('.mini-shell').dataset.transitioning === 'false' && !document.querySelector('.mini-content')`);
          assert.deepEqual(await readColors(), colors, "the collapsed handle must retain the confirmed status without mounted content");
          assert.equal(await read(`document.querySelector('.mini-shell').dataset.tone`), tone);
          await read(`document.querySelector('.mini-handle').click()`);
          await wait(`Boolean(document.querySelector('.mini-tools')) && document.querySelector('.mini-shell').dataset.tone === ${JSON.stringify(tone)} && document.querySelector('.mini-shell').dataset.transitioning === 'false'`);
        }
        await read(`delete globalThis.__PATINA_COMPACT_PRESENTATION_HOOK;globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed', ${toolsEvent})`);
        await wait(`document.querySelector('.mini-shell')?.dataset.tone === 'tracking'`);
      }
    } finally {
      await read(stored === null
        ? `localStorage.removeItem('__time_tracker_smoke_settings')`
        : `localStorage.setItem('__time_tracker_smoke_settings', ${JSON.stringify(stored)})`);
      await client.command("Page.navigate", { url: appUrl }, sessionId);
      await wait(`Boolean(document.querySelector('[data-titlebar-mini-entry]'))`);
    }
  });
  await runTest("mini explicit open focuses its container before Tab enters the buttons", async () => {
    await client.command("Emulation.setDeviceMetricsOverride", { width: 304, height: 240, deviceScaleFactor: 1, mobile: false }, sessionId);
    const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini");
    await client.command("Page.navigate", { url: url.href }, sessionId);
    await wait(`Boolean(document.querySelector('.mini-tools'))`);
    await read(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    assert.equal(await read(`document.activeElement === document.querySelector('.mini-shell')`), true, "explicit open must focus the window container");
    assert.equal(await read(`getComputedStyle(document.querySelector('.mini-shell')).outlineStyle`), "none");
    assert.equal(await read(`getComputedStyle(document.querySelector('.mini-drag-region')).cursor`), "grab");
    assert.equal(await read(`Boolean(document.querySelector('[role="tooltip"]'))`), false, "opening must not trigger a button tooltip");
    await key("Tab");
    await wait(`document.activeElement === document.querySelector('.mini-header button')`);
    assert.equal(await read(`document.activeElement.matches(':focus-visible')`), true);
    assert.equal(await read(`Boolean(document.querySelector('.qp-tooltip-anchor,.qp-tooltip,[role="tooltip"]'))`), false);
    await read(`globalThis.__PATINA_EMIT_TAURI_EVENT('mini-window-state', {epoch:1,revision:100,expanded:true,suppressed:false,edge:'top',held:false,failed:false,transition_id:0,transitioning:false,visual:{width:304,height:240,anchor:0.5},focus_request:1})`);
    await read(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    assert.equal(await read(`document.activeElement === document.querySelector('.mini-header button')`), true, "ordinary revisions must preserve the selected control");
    await read(`globalThis.__PATINA_EMIT_TAURI_EVENT('mini-window-state', {epoch:1,revision:101,expanded:true,suppressed:false,edge:'top',held:false,failed:false,transition_id:0,transitioning:false,visual:{width:304,height:240,anchor:0.5},focus_request:2})`);
    await wait(`document.activeElement === document.querySelector('.mini-shell') && !document.querySelector('[role="tooltip"]')`);
    await key("Tab");
    await wait(`document.activeElement === document.querySelector('.mini-header button')`);
    await key("Tab");
    await wait(`document.activeElement === document.querySelectorAll('.mini-header button')[1]`);
  });
  await runTest("mini passive edge reveal leaves existing DOM focus untouched", async () => {
    const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini");
    await client.command("Page.navigate", { url: url.href }, sessionId);
    await wait(`Boolean(document.querySelector('.mini-tools'))`);
    try {
      await read(`document.body.tabIndex = -1; document.body.focus();
        globalThis.__PATINA_EMIT_TAURI_EVENT('mini-window-state', {epoch:1,revision:100,expanded:false,suppressed:false,edge:'top',held:false,failed:false,transition_id:0,transitioning:false,visual:{width:304,height:240,anchor:0.5},focus_request:1})`);
      await wait(`Boolean(document.querySelector('.mini-handle'))`);
      await read(`globalThis.__PATINA_EMIT_TAURI_EVENT('mini-window-state', {epoch:1,revision:101,expanded:true,suppressed:false,edge:'top',held:false,failed:false,transition_id:0,transitioning:false,visual:{width:304,height:240,anchor:0.5},focus_request:1})`);
      await wait(`Boolean(document.querySelector('.mini-header'))`);
      await read(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      assert.equal(await read(`document.activeElement === document.body`), true, "passive reveal must not move DOM focus");
      assert.equal(await read(`Boolean(document.querySelector('[role="tooltip"]'))`), false);
    } finally {
      await read(`document.body.removeAttribute('tabindex')`);
    }
  });
  for (const edge of ["top", "left", "right"]) {
    await runTest(`mini ${edge} morph reverses continuously with one opaque surface and stable content`, async () => {
      const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini"); url.searchParams.set("miniEdge", edge);
      await client.command("Page.navigate", { url: url.href }, sessionId);
      await wait(`Boolean(document.querySelector('.mini-tools'))`);
      const result = await read(`(async () => {
        const shell = document.querySelector('.mini-shell');
        const panel = document.querySelector('.mini-panel');
        const handle = document.querySelector('.mini-handle');
        const content = document.querySelector('.mini-content');
        const body = document.querySelector('.mini-panel-body');
        const expandedBounds = panel.getBoundingClientRect().toJSON();
        const handleBounds = handle.getBoundingClientRect().toJSON();
        const bodyWidth = body.getBoundingClientRect().width;
        const value = () => { const rect = panel.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height]; };
        const toggle = expanded => new Promise(resolve => {
          const observer = new MutationObserver(() => {
            if (shell.dataset.expanded === String(expanded)) { observer.disconnect(); resolve(value()); }
          });
          observer.observe(shell, { attributes: true, attributeFilter: ['data-expanded'] });
          if (expanded) handle.click();
          else shell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await toggle(false);
        const samples = [];
        for (let turn = 0; turn < 9; turn++) {
          const animations = [...panel.getAnimations({subtree:true}), ...handle.getAnimations()];
          if (!animations.length) throw new Error('missing shape transition');
          for (const animation of animations) { animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration) * 0.35; }
          const before = value();
          const opacity = Number(getComputedStyle(panel).opacity);
          const expanded = shell.dataset.expanded !== 'true';
          const after = await toggle(expanded);
          samples.push({before, after, opacity, bodyWidth: body.getBoundingClientRect().width, sameContent: content === document.querySelector('.mini-content'), pending: shell.dataset.transitioning});
        }
        for (const animation of [...panel.getAnimations({subtree:true}), ...handle.getAnimations()]) animation.finish();
        return {samples, expandedBounds, handleBounds, bodyWidth};
      })()` ) as { samples: Array<{ before: number[]; after: number[]; opacity: number; bodyWidth: number; sameContent: boolean; pending: string }>; expandedBounds: DOMRect; handleBounds: DOMRect; bodyWidth: number };
      assert.equal(result.samples.length, 9);
      for (const sample of result.samples) {
        assert.ok(sample.before.every((value, index) => Math.abs(value - sample.after[index]) < 1), `${edge} reversal jumped: ${JSON.stringify(sample)}`);
        assert.equal(sample.opacity, 1, "the shared surface must remain opaque throughout the transition");
        assert.equal(sample.bodyWidth, result.bodyWidth, "content must not stretch or reflow with the surface");
        assert.equal(sample.sameContent, true, "reversal must preserve the rendered content");
        assert.equal(sample.pending, "true", "cancelled completion must not settle a newer transition");
      }
      const intermediate = result.samples[0].before;
      assert.ok(intermediate[2] > result.handleBounds.width && intermediate[2] < result.expandedBounds.width, "width must morph between handle and panel");
      assert.ok(intermediate[3] > result.handleBounds.height && intermediate[3] < result.expandedBounds.height, "height must morph between handle and panel");
      await wait(`document.querySelector('.mini-shell').dataset.transitioning === 'false' && document.querySelector('.mini-shell').dataset.expanded === 'true'`);
      await key("Escape");
      await wait(`document.querySelector('.mini-shell').dataset.transitioning === 'false' && !document.querySelector('.mini-content')`);
      assert.equal(await read(`document.querySelector('.mini-panel').inert && !document.querySelector('.mini-handle').inert`), true);
      assert.equal(await read(`(() => {
        const panel = document.querySelector('.mini-panel').getBoundingClientRect();
        const handle = document.querySelector('.mini-handle').getBoundingClientRect();
        return ['x','y','width','height'].every(key => Math.abs(panel[key] - handle[key]) < 1);
      })()`), true, "collapsed background and hit target must match on every edge");
    });
  }
  await runTest("mini completes only after the shape, content and handle transitions finish", async () => {
    const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini");
    await client.command("Page.navigate", { url: url.href }, sessionId);
    await wait(`Boolean(document.querySelector('.mini-tools'))`);
    const pending = await read(`(async () => {
      const shell = document.querySelector('.mini-shell');
      const panel = document.querySelector('.mini-panel');
      const handle = document.querySelector('.mini-handle');
      const body = document.querySelector('.mini-panel-body');
      await new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (shell.dataset.expanded === 'false') {
            observer.disconnect();
            for (const animation of handle.getAnimations()) { animation.pause(); animation.currentTime = 60; }
            for (const animation of body.getAnimations()) { animation.pause(); animation.currentTime = 60; }
            for (const animation of panel.getAnimations()) animation.finish();
            resolve();
          }
        });
        observer.observe(shell, {attributes:true});
        shell.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { pending: shell.dataset.transitioning, opacity: Number(getComputedStyle(handle).opacity) };
    })()`) as { pending: string; opacity: number };
    assert.equal(pending.pending, "true", "panel completion must not cancel the unfinished handle fade");
    assert.ok(pending.opacity > 0 && pending.opacity < 1);
    await read(`document.querySelector('.mini-handle').getAnimations().forEach(animation => animation.finish())`);
    await read(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    assert.equal(await read(`document.querySelector('.mini-shell').dataset.transitioning`), "true", "content fade must also finish before native clipping");
    await read(`document.querySelector('.mini-panel-body').getAnimations().forEach(animation => animation.finish())`);
    await wait(`document.querySelector('.mini-shell').dataset.transitioning === 'false' && !document.querySelector('.mini-content')`);
  });
  for (const tools of [0, 1, 2]) for (const scale of [1, 1.25, 1.5, 2]) {
    await runTest(`mini panel retains content with ${tools} tools at ${scale} scale`, async () => {
      await client.command("Emulation.setDeviceMetricsOverride", { width: 304, height: 240, deviceScaleFactor: scale, mobile: false }, sessionId);
      const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini"); url.searchParams.set("miniTools", String(tools));
      await client.command("Page.navigate", { url: url.href }, sessionId);
      await wait(`document.querySelectorAll('.mini-tool').length === ${tools} && Boolean(document.querySelector('.mini-tools'))`);
      assert.equal(await read(`document.documentElement.dataset.windowLabel`), "mini");
      assert.equal(await read(`Boolean(document.querySelector('.qp-app-frame'))`), false);
      assert.equal(await read(`Array.from(document.querySelectorAll('.mini-header button,.mini-tool')).every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})`), true);
      assert.equal(await read(`Array.from(document.querySelectorAll('.mini-shell button')).filter(button => !button.closest('[inert]')).length`), 3);
      assert.equal(await read(`Boolean(document.querySelector('.mini-shell footer'))`), false);
      assert.equal(await read(`Boolean(document.querySelector('.mini-activity,.mini-time,.mini-content img'))`), false, "Mini must not render current-app identity or duration");
      if (tools === 0) assert.equal(await read(`document.querySelector('.mini-content').textContent.trim()`), "");
      await wait(`document.querySelector('.mini-content').getAnimations().every(animation => animation.playState !== 'running')`);
      const geometry = await read(`({ content:document.querySelector('.mini-content').getBoundingClientRect().toJSON(), shell:document.querySelector('.mini-shell').getBoundingClientRect().toJSON() })`) as { content: DOMRect; shell: DOMRect };
      assert.ok(Math.abs(geometry.content.bottom - geometry.shell.bottom) <= 1, JSON.stringify(geometry));
    });
  }
  await runTest("mini header buttons have no tooltip containers and retain keyboard order and Escape", async () => {
    assert.deepEqual(await read(`Array.from(document.querySelectorAll('.mini-header button'), button => button.getAttribute('aria-label'))`), ["打开主窗口", "保持展开", "关闭窗口"]);
    assert.equal(await read(`Boolean(document.querySelector('[aria-haspopup="menu"],[role="menu"]'))`), false);
    await read(`document.querySelector('.mini-shell').focus()`);
    for (const label of ["打开主窗口", "保持展开", "关闭窗口"]) {
      await key("Tab");
      await wait(`document.activeElement?.getAttribute('aria-label') === ${JSON.stringify(label)}`);
      assert.equal(await read(`document.activeElement.matches(':focus-visible')`), true);
      const point = await read(`(() => { const rect=document.activeElement.getBoundingClientRect();return { x:rect.x+rect.width/2,y:rect.y+rect.height/2 }; })()`) as { x: number; y: number };
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, sessionId);
      await wait(`document.activeElement?.matches(':hover')`);
      assert.equal(await read(`Boolean(document.querySelector('.qp-tooltip-anchor,.qp-tooltip,[role="tooltip"],.mini-shell [title],.mini-shell [aria-describedby]'))`), false);
    }
    await key("Escape");
    await wait(`document.querySelector('.mini-shell').dataset.expanded === 'false' && document.querySelector('.mini-shell').dataset.transitioning === 'false'`);
    assert.equal(await read(`document.querySelector('.mini-content')`), null);
    await read(`document.querySelector('.mini-handle').click()`);
    await wait(`document.querySelector('.mini-shell').dataset.expanded === 'true'`);
  });
  await runTest("mini hold and float keep Escape from collapsing and use the window action owner", async () => {
    await read(`document.querySelector('[aria-label="保持展开"]').click()`);
    await wait(`document.querySelector('[aria-label="保持展开"]').getAttribute('aria-pressed') === 'true'`);
    await key("Escape");
    assert.equal(await read(`document.querySelector('.mini-shell').dataset.expanded`), "true");
    const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini"); url.searchParams.set("miniEdge", "floating");
    await client.command("Page.navigate", { url: url.href }, sessionId);
    await wait(`Boolean(document.querySelector('.mini-tools')) && document.querySelector('.mini-shell').dataset.edge === 'floating'`);
    await key("Escape");
    assert.equal(await read(`document.querySelector('.mini-shell').dataset.expanded`), "true");
    assert.equal(await read(`Array.from(document.querySelectorAll('.mini-shell button')).filter(button => !button.closest('[inert]')).length`), 3);
    assert.equal(await read(`globalThis.__PATINA_INVOKED_COMMANDS.some(({command})=>command.startsWith('cmd_')&&!command.startsWith('cmd_get_')&&command!=='cmd_mini_window_action')`), false);
  });
  await runTest("mini accepts current native revisions and ignores late old window events", async () => {
    await read(`globalThis.__PATINA_EMIT_TAURI_EVENT('mini-window-state', {epoch:2,revision:200,expanded:true,suppressed:false,edge:'left',held:false,failed:false,transition_id:0,transitioning:false,visual:{width:304,height:240,anchor:0.5},focus_request:0})`);
    await wait(`document.querySelector('.mini-shell').dataset.edge === 'left'`);
    await read(`globalThis.__PATINA_EMIT_TAURI_EVENT('mini-window-state', {epoch:1,revision:999,expanded:false,suppressed:false,edge:'top',held:false,failed:false,transition_id:0,transitioning:false,visual:{width:304,height:240,anchor:0.5},focus_request:0})`);
    await read(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    assert.equal(await read(`document.querySelector('.mini-shell').dataset.edge`), "left");
    assert.equal(await read(`document.querySelector('.mini-shell').dataset.expanded`), "true");
  });
  for (const locale of ["zh-CN", "en-US", "es", "ru-RU"]) for (const theme of ["light", "dark"]) {
    await runTest(`mini tools remain usable in ${locale} ${theme}`, async () => {
      await read(`{const key='__time_tracker_smoke_settings';const value=JSON.parse(localStorage.getItem(key)||'{}');value.language=${JSON.stringify(locale)};value.theme_mode=${JSON.stringify(theme)};localStorage.setItem(key,JSON.stringify(value));}`);
      const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini"); url.searchParams.set("miniTools", "2");
      await client.command("Page.navigate", { url: url.href }, sessionId);
      await wait(`Boolean(document.querySelector('.mini-tools')) && document.documentElement.dataset.theme === ${JSON.stringify(theme)}`);
      assert.equal(await read(`document.querySelectorAll('.mini-tool').length`), 2);
      assert.equal(await read(`Array.from(document.querySelectorAll('.mini-header button,.mini-tool')).every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})`), true);
    });
  }
  await runTest("mini reveal stays blank until content is ready", async () => {
    await key("Escape");
    await wait(`document.querySelector('.mini-shell').dataset.transitioning === 'false' && !document.querySelector('.mini-content')`);
    try {
      await read(`globalThis.__PATINA_COMPACT_PRESENTATION_HOOK = snapshot => new Promise(resolve => {
        globalThis.__miniResolvePresentation = () => resolve(snapshot);
      }); document.querySelector('.mini-handle').click()`);
      await wait(`typeof globalThis.__miniResolvePresentation === 'function' && document.querySelector('.mini-shell').dataset.expanded === 'true'
        && document.querySelector('.mini-shell').dataset.transitioning === 'false'`);
      assert.equal(await read(`document.querySelector('.mini-panel-body').innerText.trim()`), "");
      assert.equal(await read(`Boolean(document.querySelector('.mini-content'))`), false);
      await read(`globalThis.__miniResolvePresentation()`);
      await wait(`document.querySelectorAll('.mini-tool').length === 2`);
    } finally {
      await read(`globalThis.__miniResolvePresentation?.();delete globalThis.__miniResolvePresentation;delete globalThis.__PATINA_COMPACT_PRESENTATION_HOOK`);
    }
  });
  for (const command of ["cmd_get_mini_bootstrap_snapshot", "cmd_get_mini_presentation_snapshot"]) {
    await runTest(`mini initial ${command} failure stays blank and recovers`, async () => {
      const script = await client.command("Page.addScriptToEvaluateOnNewDocument", { source: `
        globalThis.__PATINA_COMPACT_FAILURES = [${JSON.stringify(command)}];
        const key = '__time_tracker_smoke_settings';
        const settings = JSON.parse(localStorage.getItem(key) || '{}');
        settings.language = 'zh-CN';
        localStorage.setItem(key, JSON.stringify(settings));
      ` }, sessionId) as { identifier: string };
      try {
        const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini"); url.searchParams.set("miniTools", "2");
        await client.command("Page.navigate", { url: url.href }, sessionId);
        await wait(`Boolean(document.querySelector('.mini-panel-body')) && globalThis.__PATINA_INVOKED_COMMANDS.some(entry => entry.command === ${JSON.stringify(command)})`);
        await read(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
        assert.equal(await read(`document.querySelector('.mini-panel-body').innerText.trim()`), "");
        assert.equal(await read(`Boolean(document.querySelector('.mini-content'))`), false);
        assert.equal(await read(`document.querySelector('.mini-tools')`), null, "tool content must wait for the first confirmed snapshot");
        await read(`globalThis.__PATINA_COMPACT_FAILURES=[];globalThis.__PATINA_EMIT_TAURI_EVENT('app-settings-changed',{})`);
        await wait(`Boolean(document.querySelector('.mini-tools')) && document.querySelector('.mini-shell')?.dataset.tone === 'tracking'`);
        assert.equal(await read(`Boolean(document.querySelector('.mini-tools'))`), true);
      } finally {
        await client.command("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier }, sessionId);
        await read(`delete globalThis.__PATINA_COMPACT_FAILURES`);
      }
    });
  }
  await runTest("mini snapshot failures retain confirmed content and recover silently", async () => {
    const content = () => read(`({ status: document.querySelector('.mini-status').textContent,
      tone: document.querySelector('.mini-shell').dataset.tone })`);
    const before = await content();
    const settleRefresh = () => read(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await read(`globalThis.__PATINA_COMPACT_FAILURES=['cmd_get_mini_presentation_snapshot'];globalThis.__PATINA_EMIT_TAURI_EVENT('app-settings-changed',{})`);
    await settleRefresh();
    assert.deepEqual(await content(), before);
    assert.equal(await read(`Boolean(document.querySelector('.mini-tools'))`), true);
    await read(`globalThis.__PATINA_COMPACT_FAILURES=['cmd_get_mini_bootstrap_snapshot'];globalThis.__PATINA_EMIT_TAURI_EVENT('app-settings-changed',{})`);
    await wait(`globalThis.__PATINA_INVOKED_COMMANDS.filter(x=>x.command==='cmd_get_mini_bootstrap_snapshot').length >= 3`);
    await read(`globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed', ${toolsEvent})`);
    await settleRefresh();
    assert.deepEqual(await content(), before);
    await read(`globalThis.__PATINA_COMPACT_FAILURES=[];globalThis.__PATINA_EMIT_TAURI_EVENT('app-settings-changed',{})`);
    const toolTime = await read(`document.querySelector('.mini-tool-time').textContent`);
    await wait(`document.querySelector('.mini-tool-time').textContent !== ${JSON.stringify(toolTime)}`);
    assert.deepEqual(await content(), before);
  });
  await runTest("mini tools continue across foreground changes without an application display", async () => {
    for (const exeName of ["chrome.exe", "patina.exe"]) {
      await read(`globalThis.__PATINA_COMPACT_PRESENTATION_HOOK=snapshot=>({...snapshot,window:{...snapshot.window,exe_name:${JSON.stringify(exeName)},title:'Foreground window'}});globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed', ${toolsEvent})`);
      await read(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      assert.equal(await read(`Boolean(document.querySelector('.mini-activity,.mini-time,.mini-content img'))`), false);
      assert.equal(await read(`document.querySelectorAll('.mini-tool').length`), 2);
      const before = await read(`document.querySelector('.mini-tool-time').textContent`);
      await wait(`document.querySelector('.mini-tool-time').textContent !== ${JSON.stringify(before)}`);
    }
    await read(`delete globalThis.__PATINA_COMPACT_PRESENTATION_HOOK;globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed', ${toolsEvent})`);
  });
  await runTest("mini reduced motion removes reveal animation and hidden content leaves no controls", async () => {
    await client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, sessionId);
    await key("Escape");
    await wait(`document.querySelector('.mini-shell').dataset.expanded === 'false' && document.querySelector('.mini-shell').dataset.transitioning === 'false'`);
    assert.equal(await read(`document.querySelector('.mini-panel').getAnimations().length`), 0);
    assert.equal(await read(`document.querySelector('.mini-content')`), null);
    assert.equal(await read(`Array.from(document.querySelectorAll('.mini-shell button')).filter(button => !button.closest('[inert]')).length`), 1);
    await read(`document.querySelector('.mini-handle').click()`);
    await wait(`document.querySelector('.mini-shell').dataset.expanded === 'true' && document.querySelector('.mini-shell').dataset.transitioning === 'false'`);
    assert.equal(await read(`getComputedStyle(document.querySelector('.mini-panel')).transform`), "none");
    await client.command("Emulation.setEmulatedMedia", { features: [] }, sessionId);
    await read(`{const key='__time_tracker_smoke_settings';const value=JSON.parse(localStorage.getItem(key)||'{}');value.language='zh-CN';value.theme_mode='light';localStorage.setItem(key,JSON.stringify(value));}`);
  });
}
