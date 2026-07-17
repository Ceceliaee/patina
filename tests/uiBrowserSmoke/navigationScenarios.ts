import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { delay, evaluate, jsonString, waitForAnimationFrames, waitForExpression } from "./browserHarness.ts";
import { APP_LOADING_VIEW, EXPECTED_NAV_LABELS, HISTORY_LOADING_VIEW, LONG_BACKGROUND_DELAY_MS } from "./constants.ts";

export async function runNavigationScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("warm primary navigation avoids app loading after startup warmup", async () => {
    // This is the behavior under test: the time-budgeted startup warmup should
    // have completed before navigation. Other synchronization uses conditions.
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
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']')?.className.includes("qp-nav-item-active")`,
      );
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
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
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
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
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

  await runTest("History date changes keep the cold placeholder blank", async () => {
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") === "ready"`,
      15_000,
      "History should be ready before changing dates",
    );
    await evaluate(
      client!,
      sessionId,
      `localStorage.setItem("__time_tracker_history_query_delay_ms", "900")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const samples = [];
          const sample = () => {
            samples.push({
              loading: document.body.innerText.includes(${jsonString(HISTORY_LOADING_VIEW)}),
              distribution: document.querySelector(".history-app-distribution-card [role=status]")?.textContent?.trim() ?? null,
              timeline: document.querySelector(".history-horizontal-timeline-empty")?.textContent?.trim() ?? null,
            });
          };
          const observer = new MutationObserver(sample);
          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
          const timer = window.setInterval(sample, 1);
          globalThis.__TIME_TRACKER_STOP_HISTORY_PLACEHOLDER_SAMPLING = () => {
            window.clearInterval(timer);
            observer.disconnect();
            sample();
            return samples;
          };
          const dateLabel = document.querySelector(".history-date-label");
          const previousButton = dateLabel?.parentElement?.parentElement?.querySelector("button");
          previousButton?.click();
          return Boolean(previousButton);
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") === "cold-loading"`,
      undefined,
      "History should expose the blank cold frame while the previous date loads",
    );
    await delay(150);

    const samples = await evaluate(
      client!,
      sessionId,
      `globalThis.__TIME_TRACKER_STOP_HISTORY_PLACEHOLDER_SAMPLING()`,
    ) as Array<{ loading: boolean; distribution: string | null; timeline: string | null }>;
    assert.ok(samples.length > 0, "expected History placeholder samples");
    assert.equal(samples.some((sample) => sample.loading), false, JSON.stringify(samples));
    for (const sample of samples) {
      assert.ok(sample.distribution === null || sample.distribution === "", JSON.stringify(samples));
      assert.ok(sample.timeline === null || sample.timeline === "", JSON.stringify(samples));
    }

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") === "ready"`,
      15_000,
      "Previous History date should settle",
    );
    await evaluate(client!, sessionId, `
      (() => {
        localStorage.removeItem("__time_tracker_history_query_delay_ms");
        const dateLabel = document.querySelector(".history-date-label");
        const buttons = dateLabel?.parentElement?.parentElement?.querySelectorAll("button");
        buttons?.item(buttons.length - 1).click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") === "ready"`,
      15_000,
      "History should return to today",
    );
  });

  await runTest("History reuses its compact first-screen snapshot during a slow refresh", async () => {
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}")["history.bootstrap_snapshot.v1"])`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!node) return false;
          node.click();
          localStorage.setItem("__time_tracker_history_query_delay_ms", "900");
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']')?.className.includes("qp-nav-item-active")`,
    );

    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']');
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
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        const state = document.querySelector("[data-history-content-state]")
          ?.getAttribute("data-history-content-state");
        return (state === "bootstrap" || state === "refreshing")
          && document.querySelectorAll(".history-horizontal-timeline-segment").length >= 1;
      })()`,
      undefined,
      "History reusable snapshot should render before the delayed refresh settles",
    );

    const slowRefreshState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const root = document.querySelector("[data-history-content-state]");
        return JSON.stringify({
          state: root?.getAttribute("data-history-content-state") ?? null,
          segmentCount: document.querySelectorAll(".history-horizontal-timeline-segment").length,
          showsLoadingCopy: document.body.innerText.includes(${jsonString(HISTORY_LOADING_VIEW)}),
        });
      })()
    `))) as { state: string | null; segmentCount: number; showsLoadingCopy: boolean };
    assert.ok(
      slowRefreshState.state === "bootstrap" || slowRefreshState.state === "refreshing",
      `expected reusable History content during delayed refresh, got ${JSON.stringify(slowRefreshState)}`,
    );
    assert.ok(slowRefreshState.segmentCount >= 1, JSON.stringify(slowRefreshState));
    assert.equal(slowRefreshState.showsLoadingCopy, false);

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") === "ready"`,
      15_000,
      "History delayed refresh should settle",
    );
    await evaluate(client!, sessionId, `localStorage.removeItem("__time_tracker_history_query_delay_ms")`);
  });

  await runTest("History cold bootstrap reuses today's ready Dashboard sessions", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!node) return false;
          node.click();
          const settings = JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}");
          delete settings["history.bootstrap_snapshot.v1"];
          localStorage.setItem("__time_tracker_smoke_settings", JSON.stringify(settings));
          localStorage.removeItem("__time_tracker_history_query_delay_ms");
          return true;
        })()
      `),
      true,
    );
    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".dashboard-top-app-progress").length >= 1`,
    );
    await evaluate(
      client!,
      sessionId,
      `localStorage.setItem("__time_tracker_history_query_delay_ms", "900")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']');
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
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") === "bootstrap"
        && document.querySelectorAll(".history-horizontal-timeline-segment").length >= 1`,
      undefined,
      "History should mount the Dashboard seed before the delayed query settles",
    );

    const coldState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => JSON.stringify({
        state: document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") ?? null,
        activeDuration: document.querySelector(".history-day-summary-value")?.textContent?.trim() ?? null,
        statusText: document.querySelector(".history-app-distribution-card [role=status]")?.textContent?.trim() ?? null,
        timelineText: document.querySelector(".history-horizontal-timeline-empty")?.textContent?.trim() ?? null,
        segmentCount: document.querySelectorAll(".history-horizontal-timeline-segment").length,
      }))()
    `))) as {
      state: string | null;
      activeDuration: string | null;
      statusText: string | null;
      timelineText: string | null;
      segmentCount: number;
    };
    assert.equal(coldState.state, "bootstrap");
    assert.notEqual(coldState.activeDuration, "—");
    assert.notEqual(coldState.activeDuration, "0m");
    assert.equal(coldState.statusText, null);
    assert.equal(coldState.timelineText, null);
    assert.ok(coldState.segmentCount >= 1, JSON.stringify(coldState));

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") === "ready"`,
      15_000,
      "History cold query should settle",
    );
    await evaluate(client!, sessionId, `localStorage.removeItem("__time_tracker_history_query_delay_ms")`);
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
    await waitForAnimationFrames(client!, sessionId);
    await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: true, focused: false });`);
    await waitForAnimationFrames(client!, sessionId);
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
      ),
      true,
    );
  });

  await runTest("long background return preserves the active browsing view", async () => {
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
      await waitForAnimationFrames(client!, sessionId);
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
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']')?.className.includes("qp-nav-item-active")`,
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
