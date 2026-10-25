import assert from "node:assert/strict";
import { evaluate, waitForAnimationFrames, waitForExpression } from "./browserHarness.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";

export async function runDataLoadingLayoutScenario({ appUrl, client, sessionId, runTest }: BrowserSmokeContext) {
  await runTest("data cold loading and cached navigation preserve panel and scroll geometry", async () => {
    const { identifier } = await client.command("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        globalThis.__PATINA_DATA_LAYOUT_READS = [];
        globalThis.__PATINA_AGGREGATE_HOOK = request => request.bucketCount > 0
          ? new Promise(resolve => globalThis.__PATINA_DATA_LAYOUT_READS.push(resolve))
          : undefined;
      `,
    }, sessionId) as { identifier: string };
    const startCapture = async () => evaluate(client, sessionId, `(() => {
      const capture = { frames: [], active: true };
      globalThis.__PATINA_DATA_LAYOUT = capture;
      const selectors = [
        '.data-overview', '.data-overview .data-trend-chart',
        '.data-overview .data-heatmap-panel', '.data-app-panel',
      ];
      const sample = () => {
        if (!capture.active) return;
        const root = document.querySelector('[data-data-content-state]');
        if (root && !root.closest('.qp-view-container-outgoing')) {
          const geometry = Object.fromEntries(selectors.map(selector => {
            const rect = root.querySelector(selector).getBoundingClientRect();
            return [selector, [rect.x, rect.y, rect.width, rect.height]];
          }));
          const scroll = root.querySelector('.data-page-scroll');
          geometry.scroll = [scroll.clientWidth, scroll.clientHeight, scroll.scrollHeight, scroll.scrollTop];
          capture.frames.push(geometry);
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      document.querySelector('[aria-label="数据"]').click();
    })()`);
    const assertStable = async (label: string) => {
      await waitForAnimationFrames(client, sessionId, 3);
      const frames = await evaluate(client, sessionId, `(() => {
        globalThis.__PATINA_DATA_LAYOUT.active = false;
        return globalThis.__PATINA_DATA_LAYOUT.frames;
      })()`) as Array<Record<string, number[]>>;
      assert.ok(frames.length >= 3, `${label}: capture must include intermediate frames`);
      const final = frames.at(-1)!;
      for (const [index, frame] of frames.entries()) {
        for (const [selector, values] of Object.entries(frame)) {
          assert.ok(values.every((value, dimension) => Math.abs(value - final[selector][dimension]) <= 1),
            `${label}, frame ${index}, ${selector}: ${JSON.stringify(values)} must match ${JSON.stringify(final[selector])}`);
        }
      }
    };
    try {
      for (const size of [
        { width: 1102, height: 738, deviceScaleFactor: 1.25 },
        { width: 900, height: 700, deviceScaleFactor: 1 },
        { width: 2048, height: 1000, deviceScaleFactor: 1 },
      ]) {
        await client.command("Emulation.setDeviceMetricsOverride", { ...size, mobile: false }, sessionId);
        const previousDocument = await evaluate(client, sessionId, "performance.timeOrigin");
        await client.command("Page.navigate", { url: appUrl }, sessionId);
        await waitForExpression(client, sessionId, `performance.timeOrigin !== ${previousDocument}
          && document.readyState === 'complete' && Boolean(document.querySelector('[aria-label="数据"]'))`);
        await startCapture();
        await waitForExpression(client, sessionId, `globalThis.__PATINA_DATA_LAYOUT_READS.length > 0
          && document.querySelector('.data-trend-panel')?.getAttribute('aria-busy') === 'true'
          && document.querySelector('.data-trend-inline-metric strong')?.textContent === '-'
          && !document.querySelector('.data-overview .data-trend-chart svg')`);
        await waitForAnimationFrames(client, sessionId, 3);
        await evaluate(client, sessionId, `globalThis.__PATINA_AGGREGATE_HOOK = undefined;
          globalThis.__PATINA_DATA_LAYOUT_READS.splice(0).forEach(resolve => resolve())`);
        await waitForExpression(client, sessionId, `Boolean(document.querySelector('[data-data-content-state="complete"]'))`);
        await assertStable(`cold ${size.width}px`);
        assert.equal(await evaluate(client, sessionId,
          `document.querySelector('.data-trend-panel')?.getAttribute('aria-busy')`), "false");

        await evaluate(client, sessionId, `document.querySelector('[aria-label="今天"]').click()`);
        await waitForExpression(client, sessionId, `document.querySelector('main')?.dataset.presentedView === 'dashboard'
          && document.querySelector('main')?.dataset.viewTransitionState === 'settled'`);
        await startCapture();
        await waitForExpression(client, sessionId, `Boolean(document.querySelector('[data-data-content-state="complete"]'))`);
        await assertStable(`cached ${size.width}px`);
      }
    } finally {
      await client.command("Page.removeScriptToEvaluateOnNewDocument", { identifier }, sessionId);
      await evaluate(client, sessionId, `if (globalThis.__PATINA_DATA_LAYOUT) globalThis.__PATINA_DATA_LAYOUT.active = false;
        globalThis.__PATINA_AGGREGATE_HOOK = undefined;
        globalThis.__PATINA_DATA_LAYOUT_READS?.splice(0).forEach(resolve => resolve())`);
      await client.command("Emulation.setDeviceMetricsOverride", {
        width: 1280, height: 820, deviceScaleFactor: 1, mobile: false,
      }, sessionId);
    }
  });
}
