import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { delay, evaluate, jsonString, waitForExpression } from "./browserHarness.ts";
import { APP_LOADING_VIEW, EXPECTED_NAV_LABELS, HISTORY_LOADING_VIEW, LONG_BACKGROUND_DELAY_MS } from "./constants.ts";

export async function runNavigationScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("warm primary navigation avoids app loading after startup warmup", async () => {
    await delay(4_000);

    for (const label of EXPECTED_NAV_LABELS.slice(1)) {
      const clicked = await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `);
      assert.equal(clicked, true, `missing navigation entry ${label}`);
      await delay(50);
      assert.equal(
        await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`),
        false,
        `unexpected app loading view after clicking ${label}`,
      );
    }
  });

  await runTest("Data navigation is immediate and avoids visible loading affordances", async () => {
    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true);
    await delay(50);
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
      ),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(HISTORY_LOADING_VIEW)})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector(".data-heatmap-skeleton"))`),
      false,
    );
  });

  await runTest("History navigation is immediate and avoids visible loading copy", async () => {
    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true);
    await delay(50);
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
      ),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(HISTORY_LOADING_VIEW)})`),
      false,
    );
  });

  await runTest("short background return keeps Data active", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: false, focused: false });`);
    await delay(80);
    await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: true, focused: false });`);
    await delay(80);
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
      ),
      true,
    );
  });

  await runTest("long background return from browsing views opens Dashboard", async () => {
    const simulateLongBackgroundReturn = async (label: string) => {
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']');
            if (!node) return false;
            node.click();
            return true;
          })()
        `),
        true,
        `missing navigation entry ${label}`,
      );
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']')?.className.includes("qp-nav-item-active")`,
      );
      await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: false, focused: false });`);
      await delay(80);
      await evaluate(client!, sessionId, `
        (() => {
          const originalNow = Date.now;
          Date.now = () => originalNow() + ${LONG_BACKGROUND_DELAY_MS + 1};
          globalThis.__TIME_TRACKER_RESTORE_NOW = () => {
            Date.now = originalNow;
            delete globalThis.__TIME_TRACKER_RESTORE_NOW;
          };
          globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: true, focused: false });
        })()
      `);
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']')?.className.includes("qp-nav-item-active")`,
      );
      assert.equal(
        await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`),
        false,
      );
      await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_RESTORE_NOW?.();`);
    };

    await simulateLongBackgroundReturn("数据");
    await simulateLongBackgroundReturn("历史");
  });
}
