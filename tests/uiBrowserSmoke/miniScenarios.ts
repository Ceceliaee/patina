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
  await runTest("mini explicit open focuses its container before Tab enters the buttons", async () => {
    await client.command("Emulation.setDeviceMetricsOverride", { width: 304, height: 240, deviceScaleFactor: 1, mobile: false }, sessionId);
    const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini");
    await client.command("Page.navigate", { url: url.href }, sessionId);
    await wait(`Boolean(document.querySelector('.mini-time'))`);
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
    await wait(`Boolean(document.querySelector('.mini-time'))`);
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
    await runTest(`mini ${edge} slide reverses in place without replacing its content or flashing the handle`, async () => {
      const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini"); url.searchParams.set("miniEdge", edge);
      await client.command("Page.navigate", { url: url.href }, sessionId);
      await wait(`Boolean(document.querySelector('.mini-time'))`);
      const result = await read(`(async () => {
        const shell = document.querySelector('.mini-shell');
        const panel = document.querySelector('.mini-panel');
        const handle = document.querySelector('.mini-handle');
        const content = document.querySelector('.mini-content');
        const value = () => { const matrix = new DOMMatrixReadOnly(getComputedStyle(panel).transform); return ${JSON.stringify(edge)} === 'top' ? matrix.m42 : matrix.m41; };
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
          const animations = [...panel.getAnimations(), ...handle.getAnimations()];
          if (!animations.length) throw new Error('missing slide transition');
          for (const animation of animations) { animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration) * 0.35; }
          const before = value();
          const opacity = Number(getComputedStyle(panel).opacity) + Number(getComputedStyle(handle).opacity);
          const expanded = shell.dataset.expanded !== 'true';
          const after = await toggle(expanded);
          samples.push({before, after, opacity, sameContent: content === document.querySelector('.mini-content'), pending: shell.dataset.transitioning});
        }
        for (const animation of [...panel.getAnimations(), ...handle.getAnimations()]) animation.finish();
        return samples;
      })()` ) as Array<{ before: number; after: number; opacity: number; sameContent: boolean; pending: string }>;
      assert.equal(result.length, 9);
      for (const sample of result) {
        assert.ok(Math.abs(sample.before - sample.after) < 1, `${edge} reversal jumped: ${JSON.stringify(sample)}`);
        assert.ok(sample.opacity >= 0.99, `bar and panel both disappeared: ${JSON.stringify(sample)}`);
        assert.equal(sample.sameContent, true, "reversal must preserve the rendered content");
        assert.equal(sample.pending, "true", "cancelled completion must not settle a newer transition");
      }
      assert.ok(edge === "right" ? result[0].before > 0 : result[0].before < 0, "slide must follow the docked edge");
      await wait(`document.querySelector('.mini-shell').dataset.transitioning === 'false' && document.querySelector('.mini-shell').dataset.expanded === 'true'`);
      await key("Escape");
      await wait(`document.querySelector('.mini-shell').dataset.transitioning === 'false' && !document.querySelector('.mini-content')`);
      assert.equal(await read(`document.querySelector('.mini-panel').inert && !document.querySelector('.mini-handle').inert`), true);
    });
  }
  await runTest("mini completes only after both the panel slide and handle fade finish", async () => {
    const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini");
    await client.command("Page.navigate", { url: url.href }, sessionId);
    await wait(`Boolean(document.querySelector('.mini-time'))`);
    const pending = await read(`(async () => {
      const shell = document.querySelector('.mini-shell');
      const panel = document.querySelector('.mini-panel');
      const handle = document.querySelector('.mini-handle');
      await new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (shell.dataset.expanded === 'false') {
            observer.disconnect();
            for (const animation of handle.getAnimations()) { animation.pause(); animation.currentTime = 60; }
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
    await wait(`document.querySelector('.mini-shell').dataset.transitioning === 'false' && !document.querySelector('.mini-content')`);
  });
  for (const tools of [0, 1, 2]) for (const scale of [1, 1.25, 1.5, 2]) {
    await runTest(`mini panel retains content with ${tools} tools at ${scale} scale`, async () => {
      await client.command("Emulation.setDeviceMetricsOverride", { width: 304, height: 240, deviceScaleFactor: scale, mobile: false }, sessionId);
      const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini"); url.searchParams.set("miniTools", String(tools));
      await client.command("Page.navigate", { url: url.href }, sessionId);
      await wait(`document.querySelectorAll('.mini-tool').length === ${tools} && Boolean(document.querySelector('.mini-time'))`);
      assert.equal(await read(`document.documentElement.dataset.windowLabel`), "mini");
      assert.equal(await read(`Boolean(document.querySelector('.qp-app-frame'))`), false);
      assert.equal(await read(`Array.from(document.querySelectorAll('.mini-header button,.mini-tool')).every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})`), true);
      assert.equal(await read(`Array.from(document.querySelectorAll('.mini-shell button')).filter(button => !button.closest('[inert]')).length`), 3);
      assert.equal(await read(`Boolean(document.querySelector('.mini-shell footer'))`), false);
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
    await wait(`Boolean(document.querySelector('.mini-time')) && document.querySelector('.mini-shell').dataset.edge === 'floating'`);
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
    await runTest(`mini long content remains usable in ${locale} ${theme}`, async () => {
      await read(`{const key='__time_tracker_smoke_settings';const value=JSON.parse(localStorage.getItem(key)||'{}');value.language=${JSON.stringify(locale)};value.theme_mode=${JSON.stringify(theme)};value['__app_override::chrome.exe']=JSON.stringify({enabled:true,displayName:'A very long application name for compact window layout verification'});localStorage.setItem(key,JSON.stringify(value));}`);
      const url = new URL(appUrl); url.searchParams.set("__patinaWindow", "mini"); url.searchParams.set("miniTools", "2");
      await client.command("Page.navigate", { url: url.href }, sessionId);
      await wait(`Boolean(document.querySelector('.mini-time')) && document.documentElement.dataset.theme === ${JSON.stringify(theme)}`);
      assert.equal(await read(`document.querySelector('.mini-activity span').textContent.includes('very long')`), true);
      assert.equal(await read(`Array.from(document.querySelectorAll('.mini-header button,.mini-tool')).every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})`), true);
    });
  }
  await runTest("mini snapshot failures stay visible until each failed source recovers", async () => {
    await read(`globalThis.__PATINA_COMPACT_FAILURES=['cmd_get_mini_presentation_snapshot'];globalThis.__PATINA_EMIT_TAURI_EVENT('app-settings-changed',{})`);
    await wait(`document.querySelector('.mini-status')?.dataset.tone === 'unavailable'`);
    assert.equal(await read(`Boolean(document.querySelector('.mini-time'))`), true);
    await read(`globalThis.__PATINA_COMPACT_FAILURES=['cmd_get_mini_bootstrap_snapshot'];globalThis.__PATINA_EMIT_TAURI_EVENT('app-settings-changed',{})`);
    await wait(`globalThis.__PATINA_INVOKED_COMMANDS.filter(x=>x.command==='cmd_get_mini_bootstrap_snapshot').length >= 3`);
    await read(`globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed', ${toolsEvent})`);
    await read(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    assert.equal(await read(`document.querySelector('.mini-status')?.dataset.tone`), "unavailable");
    await read(`globalThis.__PATINA_COMPACT_FAILURES=[];globalThis.__PATINA_EMIT_TAURI_EVENT('app-settings-changed',{})`);
    await wait(`document.querySelector('.mini-status')?.dataset.tone !== 'unavailable'`);
  });
  await runTest("mini stale activity stops extrapolating while valid tool clocks continue", async () => {
    await read(`globalThis.__PATINA_COMPACT_PRESENTATION_HOOK=snapshot=>({...snapshot,tracking_sampled_at_ms:Date.now()-20000});globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed', ${toolsEvent})`);
    await wait(`document.querySelector('.mini-time')?.textContent === '01:42' && document.querySelector('.mini-status')?.dataset.tone === 'unavailable'`);
    const before = await read(`document.querySelector('.mini-tool-time').textContent`);
    await wait(`document.querySelector('.mini-tool-time').textContent !== ${JSON.stringify(before)}`);
    await read(`delete globalThis.__PATINA_COMPACT_PRESENTATION_HOOK;globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed', ${toolsEvent})`);
    await wait(`document.querySelector('.mini-status')?.dataset.tone !== 'unavailable'`);
  });
  await runTest("mini never attributes Patina foreground time to the previous application", async () => {
    await read(`globalThis.__PATINA_COMPACT_PRESENTATION_HOOK=snapshot=>({...snapshot,window:{...snapshot.window,exe_name:'patina.exe',title:'Patina Mini'}});globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed', ${toolsEvent})`);
    await wait(`document.querySelector('.mini-time')?.textContent === '—'`);
    assert.equal(await read(`document.querySelectorAll('.mini-tool').length`), 2);
    await read(`delete globalThis.__PATINA_COMPACT_PRESENTATION_HOOK;globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed', ${toolsEvent})`);
    await wait(`document.querySelector('.mini-time')?.textContent !== '—'`);
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
    assert.equal(await read(`getComputedStyle(document.querySelector('.mini-panel')).transform`), "matrix(1, 0, 0, 1, 0, 0)");
    await client.command("Emulation.setEmulatedMedia", { features: [] }, sessionId);
    await read(`{const key='__time_tracker_smoke_settings';const value=JSON.parse(localStorage.getItem(key)||'{}');value.language='zh-CN';value.theme_mode='light';delete value['__app_override::chrome.exe'];localStorage.setItem(key,JSON.stringify(value));}`);
  });
}
