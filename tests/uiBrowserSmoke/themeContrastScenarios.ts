import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { evaluate, waitFor, waitForExpression } from "./browserHarness.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";

function renderedTextContrast(foreground: string, background: string): number {
  const luminance = (color: string) => {
    assert.match(color, /^(rgba?\(|color\(srgb )/, `expected an sRGB computed color: ${color}`);
    const parts = color.match(/[\d.]+/g)!.map(Number);
    assert.ok(parts.length === 3 || (parts.length === 4 && parts[3] === 1), `expected an opaque computed color: ${color}`);
    const channels = parts.slice(0, 3).map(value => color.startsWith("color(") ? value : value / 255);
    return channels.reduce((sum, value, index) => sum + [0.2126, 0.7152, 0.0722][index]
      * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4), 0);
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

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
        const ready = await read(`performance.timeOrigin !== ${previousOrigin} && Boolean(document.documentElement) && (${expression})`);
        return ready ? true : null;
      } catch (error) {
        if (String(error).includes("Inspected target navigated or closed")) return null;
        throw error;
      }
    }, 15_000);
  };
  const stored = `JSON.parse(localStorage.getItem('__time_tracker_smoke_settings') || '{}')`;
  const open = async () => {
    await read(`document.querySelector('.settings-data-action-row button').click()`);
    await wait(`Boolean(document.querySelector('.settings-data-export-dialog-surface'))`);
  };
  const close = async () => {
    await read(`document.querySelector('.settings-data-export-dialog-surface .qp-dialog-actions button').click()`);
    await wait(`!document.querySelector('.settings-data-export-dialog-surface')`);
  };

  await runTest("theme defaults ignore removed overrides across reload, system mode, languages and desktop scales", async () => {
    const initial = await read(`localStorage.getItem('__time_tracker_smoke_settings')`);
    const evidence = join(tmpdir(), "patina-theme-contrast-review");
    mkdirSync(evidence, { recursive: true });
    const primaryContrasts: Array<{ variant: string; scheme: string; locale: string; foreground: string; background: string; hoverBackground: string; normal: number; hover: number }> = [];
    try {
      for (const sample of [
        { variant: "light", locale: "en-US", scheme: "absolutely", contrast: 45, width: 1280, scale: 1 },
        { variant: "light", locale: "zh-CN", scheme: "default", contrast: 45, width: 900, scale: 1 },
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
        })); localStorage.setItem('patina:last-active-view', 'settings');`);
        await client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: sample.variant }] }, sessionId);
        await client.command("Emulation.setDeviceMetricsOverride", { width: sample.width, height: 760, deviceScaleFactor: sample.scale, mobile: false }, sessionId);
        await reloadAndWait(`document.documentElement.dataset.themeContrast === '${sample.contrast}' && Boolean(document.querySelector('.settings-button-preview'))`);
        const hoverTarget = await read(`(() => {
          const button = document.querySelector('[data-sidebar-nav-item]:not(.qp-nav-item-active)');
          const r = button.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
        })()`) as { x: number; y: number; width: number; height: number };
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverTarget.x, y: hoverTarget.y }, sessionId);
        await wait(`(() => {
          const button = document.querySelector('[data-sidebar-nav-item]:not(.qp-nav-item-active)');
          const probe = document.createElement('span');
          probe.style.backgroundColor = 'var(--qp-bg-elevated)';
          button.append(probe);
          try { return getComputedStyle(button).backgroundColor === getComputedStyle(probe).backgroundColor; }
          finally { probe.remove(); }
        })()`);
        assert.equal(await read(`(() => {
          const button = document.querySelector('[data-sidebar-nav-item]:not(.qp-nav-item-active)');
          return button.getBoundingClientRect().width === ${hoverTarget.width}
            && button.getBoundingClientRect().height === ${hoverTarget.height};
        })()`), true, "hover uses the nested surface without changing navigation geometry");
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 }, sessionId);
        await read(`document.querySelector('[data-sidebar-nav-item="history"]').click()`);
        await wait(`Boolean(document.querySelector('.history-timeline-zoom-open'))`);
        await read(`document.querySelector('.history-timeline-zoom-open').click()`);
        await wait(`Boolean(document.querySelector('.history-timeline-hour-slider input[type="range"]'))`);
        const expectedControls = controls.find(row => row.variant === sample.variant && row.scheme === sample.scheme)!.expected;
        assert.equal(await read(`(() => {
          const input = document.querySelector('.history-timeline-hour-slider input[type="range"]');
          const expected = ${JSON.stringify(expectedControls)};
          const probe = document.createElement('div');
          probe.style.backgroundImage = input.style.backgroundImage;
          for (const [key, value] of Object.entries(expected)) probe.style.setProperty(key, value);
          document.body.append(probe);
          try { return getComputedStyle(input).backgroundImage === getComputedStyle(probe).backgroundImage; }
          finally { probe.remove(); }
        })()`), true, "history slider retains the prior foreground and track colors");
        assert.equal(await read(`getComputedStyle(document.querySelector('.history-timeline-hour-slider .qp-button-secondary')).borderRadius`), "10px");
        await read(`document.querySelector('.history-timeline-zoom-dialog-surface .qp-dialog-close-button').click()`);
        await wait(`!document.querySelector('.history-timeline-zoom-dialog-surface')`);
        await read(`document.querySelector('[data-sidebar-nav-item="settings"]').click()`);
        await wait(`Boolean(document.querySelector('.settings-button-preview'))`);
        await open();
        const readPrimaryColors = async () => await read(`(() => {
          const button = document.querySelector('.settings-data-export-dialog-surface .qp-dialog-actions .qp-button-primary');
          const style = getComputedStyle(button), rect = button.getBoundingClientRect();
          return { foreground: style.color, background: style.backgroundColor, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`) as { foreground: string; background: string; x: number; y: number };
        const normal = await readPrimaryColors();
        assert.equal(normal.foreground, "rgb(255, 255, 255)");
        const normalContrast = renderedTextContrast(normal.foreground, normal.background);
        assert.ok(normalContrast >= 4.5, `${sample.variant}/${sample.scheme}: rendered primary text contrast ${normalContrast} must reach 4.5:1`);
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: normal.x, y: normal.y }, sessionId);
        await wait(`(() => {
          const button = document.querySelector('.settings-data-export-dialog-surface .qp-dialog-actions .qp-button-primary');
          return button.matches(':hover') && button.getAnimations().every(animation => animation.playState !== 'running');
        })()`);
        const hovered = await readPrimaryColors();
        const hoverContrast = renderedTextContrast(hovered.foreground, hovered.background);
        assert.ok(hoverContrast >= 4.5, `${sample.variant}/${sample.scheme}: rendered primary hover text contrast ${hoverContrast} must reach 4.5:1`);
        assert.equal(hovered.foreground, normal.foreground);
        assert.equal(await read(`(() => {
          const probe = document.createElement('div');
          probe.style.background = 'color-mix(in srgb, var(--qp-button-primary-bg) 92%, black)';
          document.body.append(probe);
          try { return getComputedStyle(probe).backgroundColor === getComputedStyle(document.querySelector('.settings-data-export-dialog-surface .qp-dialog-actions .qp-button-primary')).backgroundColor; }
          finally { probe.remove(); }
        })()`), true, "primary hover preserves its existing 92% background blend");
        primaryContrasts.push({ variant: sample.variant, scheme: sample.scheme, locale: sample.locale, foreground: normal.foreground, background: normal.background, hoverBackground: hovered.background, normal: normalContrast, hover: hoverContrast });
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 }, sessionId);
        const expectedBorder = borders.find(row => row.variant === sample.variant && row.scheme === sample.scheme)!;
        assert.equal(await read(`(() => {
          const probe = document.createElement('div');
          probe.style.border = '1px solid ' + ${JSON.stringify(expectedBorder.subtle)};
          document.body.append(probe);
          try {
            return getComputedStyle(document.querySelector('.qp-panel')).borderTopColor === getComputedStyle(probe).borderTopColor;
          } finally { probe.remove(); }
        })()`), true, "panel borders preserve the previous theme color");
        await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }, sessionId);
        await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }, sessionId);
        assert.equal(await read(`document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle === 'solid' && getComputedStyle(document.activeElement).outlineWidth === '2px'`), true, "keyboard navigation retains the original visible focus ring");
        assert.equal(await read(`(() => {
          const dialog = document.querySelector('.settings-data-export-dialog-surface');
          const controls = [...dialog.querySelectorAll('button, input')];
          const bounds = dialog.getBoundingClientRect();
          return bounds.left >= 0 && bounds.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth + 1
            && controls.every(e => { const r = e.getBoundingClientRect(); return r.left >= bounds.left && r.right <= bounds.right; });
        })()`), true);
        assert.equal(await read(`getComputedStyle(document.documentElement).getPropertyValue('--color-bg-canvas').trim() === document.documentElement.style.getPropertyValue('--qp-bg-canvas')`), true);
        const screenshot = await client.command("Page.captureScreenshot", { format: "png" }, sessionId) as { data: string };
        writeFileSync(join(evidence, `${sample.variant}-${sample.scheme}-${sample.locale}.png`), Buffer.from(screenshot.data, "base64"));
        await close();
        const opposite = sample.variant === "dark" ? "light" : "dark";
        await client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: opposite }] }, sessionId);
        await wait(`document.documentElement.dataset.theme === '${opposite}' && document.documentElement.dataset.themeContrast === '${sample.scheme === "vercel" ? (opposite === "dark" ? 50 : 40) : (opposite === "dark" ? 60 : 45)}'`);
      }
      writeFileSync(join(evidence, "primary-contrast.json"), JSON.stringify(primaryContrasts, null, 2));
      console.log(`Theme visual evidence: ${evidence}`);
    } finally {
      await read(`localStorage.setItem('__time_tracker_smoke_settings', ${JSON.stringify(initial)}); localStorage.setItem('patina:last-active-view', 'settings');`);
      await client.command("Emulation.setEmulatedMedia", { features: [] }, sessionId);
      await client.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
      await reloadAndWait(`Boolean(document.querySelector('.settings-button-preview')) && document.documentElement.lang === 'zh-CN'`);
    }
  });

}
