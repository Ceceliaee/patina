import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { evaluate, waitFor, waitForExpression } from "./browserHarness.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";

export async function runThemeContrastScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  const borders = JSON.parse(readFileSync(new URL("../fixtures/theme/patina-borders.json", import.meta.url), "utf8")) as Array<{variant: string; scheme: string; subtle: string; strong: string}>;
  const controls = JSON.parse(readFileSync(new URL("../fixtures/theme/patina-controls.json", import.meta.url), "utf8")) as Array<{variant: string; scheme: string; expected: Record<string, string>}>;
  const read = (expression: string) => evaluate(client, sessionId, expression);
  const wait = (expression: string) => waitForExpression(client, sessionId, expression, 15_000, expression);
  const reloadAndWait = async (expression: string) => {
    const previousOrigin = await read("performance.timeOrigin");
    await client.command("Page.reload", {}, sessionId);
    await waitFor("reloaded theme view", async () => {
      try {
        const ready = await read(`performance.timeOrigin !== ${previousOrigin} && (${expression})`);
        return ready ? true : null;
      } catch (error) {
        if (String(error).includes("Inspected target navigated or closed")) return null;
        throw error;
      }
    }, 15_000);
  };
  const open = async (dark = false) => {
    await read(`document.querySelectorAll('.settings-theme-entry')[${dark ? 1 : 0}].click()`);
    await wait(`document.activeElement?.matches('.settings-color-scheme-option[aria-pressed="true"]')`);
  };
  const choose = async (label: string) => {
    await read(`Array.from(document.querySelectorAll('.settings-color-scheme-option')).find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
  };
  const close = async (confirm = false) => {
    await read(`document.querySelectorAll('.qp-dialog-action')[${confirm ? 1 : 0}].click()`);
    await wait(`!document.querySelector('.qp-theme-dialog-surface')`);
  };
  const stored = `JSON.parse(localStorage.getItem('__time_tracker_smoke_settings') || '{}')`;
  const commits = `globalThis.__PATINA_INVOKED_COMMANDS.filter(c => c.command === 'cmd_commit_app_settings')`;

  await runTest("theme previews without writes and confirms only the chosen scheme", async () => {
    const initial = await read(`JSON.stringify(${stored})`);
    await open();
    assert.equal(await read(`document.querySelector('.qp-theme-dialog-surface input[type="range"]')`), null);
    await choose("Catppuccin");
    await wait(`document.documentElement.dataset.colorScheme === 'catppuccin'`);
    assert.equal(await read(`document.documentElement.dataset.themeContrast`), "45");
    assert.equal(await read(`JSON.stringify(${stored})`), initial);
    await close();
    await wait(`document.documentElement.dataset.colorScheme === 'default'`);
    await open();
    await choose("Vercel");
    await close(true);
    assert.deepEqual(await read(`${commits}.at(-1).payload.mutations`), [{ key: "color_scheme_light", value: "vercel" }]);
    await open();
    await choose("Catppuccin");
    await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
    await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
    await wait(`!document.querySelector('.qp-theme-dialog-surface') && document.documentElement.dataset.colorScheme === 'vercel'`);
    await open();
    await choose("Catppuccin");
    await read(`document.querySelector('.qp-dialog-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    await wait(`!document.querySelector('.qp-theme-dialog-surface') && document.documentElement.dataset.colorScheme === 'vercel'`);
  });

  await runTest("theme failure preserves selection and pending save blocks reentry", async () => {
    await open();
    await choose("Catppuccin");
    await read(`(() => {
      globalThis.__PATINA_REJECT_THEME_SAVE = true;
      const original = console.error;
      globalThis.__restoreThemeConsole = () => { console.error = original; };
      console.error = (...args) => { if (args[0] !== 'save color scheme failed') original(...args); };
      document.querySelectorAll('.qp-dialog-action')[1].click();
    })()`);
    try {
      await wait(`document.querySelector('.qp-dialog-action.qp-button-primary')?.disabled === false`);
      assert.equal(await read(`document.documentElement.dataset.colorScheme`), "catppuccin");
      assert.equal(await read(`${stored}.color_scheme_light`), "vercel");
    } finally {
      await read(`globalThis.__PATINA_REJECT_THEME_SAVE = false; globalThis.__restoreThemeConsole(); delete globalThis.__restoreThemeConsole;`);
    }
    await read(`globalThis.__PATINA_HOLD_THEME_SAVE = true; document.querySelectorAll('.qp-dialog-action')[1].click()`);
    await wait(`typeof globalThis.__PATINA_RELEASE_THEME_SAVE === 'function'`);
    const before = await read(`${commits}.length`);
    await read(`document.querySelectorAll('.qp-dialog-action')[1].click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
    assert.equal(await read(`Array.from(document.querySelectorAll('.settings-color-scheme-option')).every(b => b.disabled)`), true);
    assert.equal(await read(`${commits}.length`), before);
    await read(`globalThis.__PATINA_HOLD_THEME_SAVE = false; globalThis.__PATINA_RELEASE_THEME_SAVE(); delete globalThis.__PATINA_RELEASE_THEME_SAVE;`);
    await wait(`!document.querySelector('.qp-theme-dialog-surface')`);
    assert.equal(await read(`${stored}.color_scheme_light`), "catppuccin");
    await open();
    await choose("默认");
    await close(true);
  });
  await runTest("theme defaults ignore removed overrides across reload, system mode, languages and desktop scales", async () => {
    const initial = await read(`localStorage.getItem('__time_tracker_smoke_settings')`);
    const evidence = join(tmpdir(), "patina-theme-contrast-review");
    mkdirSync(evidence, { recursive: true });
    try {
      for (const sample of [
        { variant: "light", locale: "en-US", scheme: "absolutely", contrast: 45, width: 1280, scale: 1 },
        { variant: "light", locale: "zh-CN", scheme: "default", contrast: 45, width: 1280, scale: 1 },
        { variant: "light", locale: "zh-CN", scheme: "catppuccin", contrast: 45, width: 1280, scale: 1 },
        { variant: "dark", locale: "zh-CN", scheme: "default", contrast: 60, width: 1280, scale: 1 },
        { variant: "dark", locale: "en-US", scheme: "catppuccin", contrast: 60, width: 900, scale: 1.5 },
        { variant: "light", locale: "ru-RU", scheme: "vercel", contrast: 40, width: 900, scale: 2 },
        { variant: "dark", locale: "es", scheme: "vercel", contrast: 50, width: 900, scale: 1.25 },
      ]) {
        await read(`localStorage.setItem('__time_tracker_smoke_settings', JSON.stringify({
          ...${stored}, theme_mode: 'system', language: '${sample.locale}',
          color_scheme_light: '${sample.scheme}', color_scheme_dark: '${sample.scheme}',
          theme_contrast_light: '0', theme_contrast_dark: '100'
        })); localStorage.setItem('patina:last-active-view', 'dashboard');`);
        await client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: sample.variant }] }, sessionId);
        await client.command("Emulation.setDeviceMetricsOverride", { width: sample.width, height: 760, deviceScaleFactor: sample.scale, mobile: false }, sessionId);
        await reloadAndWait(`document.documentElement.dataset.themeContrast === '${sample.contrast}' && Boolean(document.querySelector('.dashboard-top-app-progress'))`);
        if (sample.contrast >= 40) {
          const separation = await read(`(() => {
            const row = document.querySelector('.dashboard-top-app-progress').parentElement.parentElement.parentElement;
            const channels = node => getComputedStyle(node).backgroundColor.match(/\\d+/g).slice(0, 3).map(Number);
            const rowColor = channels(row), panelColor = channels(row.closest('.qp-panel'));
            return rowColor.reduce((sum, value, index) => sum + panelColor[index] - value, 0) / 3;
          })()`);
          assert.ok(Number(separation) >= 5, "rendered application rows must be distinct from the panel");
        }
        assert.equal(await read(`(() => {
          const track = document.querySelector('.dashboard-top-app-progress').parentElement;
          const probe = document.createElement('div');
          probe.style.backgroundColor = 'var(--qp-chart-track)';
          document.body.append(probe);
          try { return getComputedStyle(track).backgroundColor === getComputedStyle(probe).backgroundColor; }
          finally { probe.remove(); }
        })()`), true, "statistics use the soft track independently of settings sliders");
        const hoverTarget = await read(`(() => {
          const button = document.querySelector('[data-sidebar-nav-item]:not(.qp-nav-item-active)');
          const r = button.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
        })()`) as { x: number; y: number; width: number; height: number };
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverTarget.x, y: hoverTarget.y }, sessionId);
        await wait(`getComputedStyle(document.querySelector('[data-sidebar-nav-item]:not(.qp-nav-item-active)')).backgroundColor === getComputedStyle(document.querySelector('.dashboard-top-app-progress').parentElement.parentElement.parentElement).backgroundColor`);
        assert.equal(await read(`(() => {
          const button = document.querySelector('[data-sidebar-nav-item]:not(.qp-nav-item-active)');
          const style = getComputedStyle(button);
          const row = document.querySelector('.dashboard-top-app-progress').parentElement.parentElement.parentElement;
          return button.getBoundingClientRect().width === ${hoverTarget.width}
            && button.getBoundingClientRect().height === ${hoverTarget.height}
            && style.backgroundColor === getComputedStyle(row).backgroundColor;
        })()`), true, "hover uses the nested surface without changing navigation geometry");
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 }, sessionId);
        const dashboardScreenshot = await client.command("Page.captureScreenshot", { format: "png" }, sessionId) as { data: string };
        writeFileSync(join(evidence, `${sample.variant}-${sample.scheme}-${sample.locale}-dashboard.png`), Buffer.from(dashboardScreenshot.data, "base64"));
        await read(`localStorage.setItem('patina:last-active-view', 'settings')`);
        await reloadAndWait(`document.documentElement.dataset.themeContrast === '${sample.contrast}' && document.documentElement.dataset.theme === '${sample.variant}' && Boolean(document.querySelector('.settings-theme-entry'))`);
        const expectedControls = controls.find(row => row.variant === sample.variant && row.scheme === sample.scheme)!.expected;
        assert.equal(await read(`(() => {
          const input = document.querySelector('input[type="range"]');
          const expected = ${JSON.stringify(expectedControls)};
          const probe = document.createElement('div');
          probe.style.backgroundImage = input.style.backgroundImage;
          for (const [key, value] of Object.entries(expected)) probe.style.setProperty(key, value);
          document.body.append(probe);
          try { return getComputedStyle(input).backgroundImage === getComputedStyle(probe).backgroundImage; }
          finally { probe.remove(); }
        })()`), true, "settings slider retains the prior foreground and track colors");
        await open(sample.variant === "dark");
        assert.equal(await read(`getComputedStyle(document.querySelector('.qp-dialog-action.qp-button-primary')).color`), "rgb(255, 255, 255)");
        const expectedBorder = borders.find(row => row.variant === sample.variant && row.scheme === sample.scheme)!;
        assert.equal(await read(`(() => {
          const probe = document.createElement('div');
          probe.style.border = '1px solid ' + ${JSON.stringify(expectedBorder.subtle)};
          document.body.append(probe);
          try {
            return getComputedStyle(document.querySelector('.qp-panel')).borderTopColor === getComputedStyle(probe).borderTopColor;
          } finally { probe.remove(); }
        })()`), true, "panel borders preserve the previous theme color");
        assert.equal(await read(`document.querySelector('.qp-theme-dialog-surface input[type="range"]')`), null);
        await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }, sessionId);
        await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }, sessionId);
        assert.equal(await read(`document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle === 'solid' && getComputedStyle(document.activeElement).outlineWidth === '2px'`), true, "keyboard navigation retains the original visible focus ring");
        assert.equal(await read(`(() => {
          const dialog = document.querySelector('.qp-theme-dialog-surface');
          const controls = [...dialog.querySelectorAll('.settings-color-scheme-option, .qp-dialog-action')];
          const bounds = dialog.getBoundingClientRect();
          return bounds.left >= 0 && bounds.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth + 1
            && controls.every(e => { const r = e.getBoundingClientRect(); return r.left >= bounds.left && r.right <= bounds.right; });
        })()`), true);
        assert.equal(await read(`getComputedStyle(document.documentElement).getPropertyValue('--color-bg-canvas').trim() === document.documentElement.style.getPropertyValue('--qp-bg-canvas')`), true);
        const screenshot = await client.command("Page.captureScreenshot", { format: "png" }, sessionId) as { data: string };
        writeFileSync(join(evidence, `${sample.variant}-${sample.locale}.png`), Buffer.from(screenshot.data, "base64"));
        await close();
        const opposite = sample.variant === "dark" ? "light" : "dark";
        await client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: opposite }] }, sessionId);
        await wait(`document.documentElement.dataset.theme === '${opposite}' && document.documentElement.dataset.themeContrast === '${sample.scheme === "vercel" ? (opposite === "dark" ? 50 : 40) : (opposite === "dark" ? 60 : 45)}'`);
      }
      console.log(`Theme visual evidence: ${evidence}`);
    } finally {
      await read(`localStorage.setItem('__time_tracker_smoke_settings', ${JSON.stringify(initial)});`);
      await client.command("Emulation.setEmulatedMedia", { features: [] }, sessionId);
      await client.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
      await reloadAndWait(`Boolean(document.querySelector('.settings-theme-entry')) && document.documentElement.lang === 'zh-CN'`);
    }
  });

}
