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

  await runTest("warm navigation records response and blank-frame evidence", async () => {
    const samples: Array<{
      label: string;
      activeMs: number;
      structureMs: number;
      blankFrames: number;
    }> = [];
    const labels = ["今天", "历史", "数据", "分类"];
    for (let cycle = 0; cycle < 5; cycle += 1) {
      for (const label of labels) {
        const sample = await evaluate(client!, sessionId, `
          (async () => {
            const label = ${jsonString(label)};
            const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']');
            if (!node) return null;
            const startedAt = performance.now();
            let activeAt = null;
            let structureAt = null;
            let blankFrames = 0;
            node.click();
            for (let frame = 0; frame < 120; frame += 1) {
              await new Promise((resolve) => requestAnimationFrame(resolve));
              const canvas = document.querySelector("main.qp-canvas");
              if (!canvas || canvas.childElementCount === 0) blankFrames += 1;
              if (structureAt === null && canvas && canvas.childElementCount > 0) {
                structureAt = performance.now();
              }
              if (activeAt === null && node.className.includes("qp-nav-item-active")) {
                activeAt = performance.now();
              }
              if (activeAt !== null && frame >= 4) break;
            }
            return {
              label,
              activeMs: (activeAt ?? performance.now()) - startedAt,
              structureMs: (structureAt ?? performance.now()) - startedAt,
              blankFrames,
            };
          })()
        `) as { label: string; activeMs: number; structureMs: number; blankFrames: number } | null;
        assert.ok(sample, `missing navigation sample for ${label}`);
        samples.push(sample);
      }
    }
    const percentile = (values: number[], fraction: number) => {
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
    };
    const activeValues = samples.map((sample) => sample.activeMs);
    const structureValues = samples.map((sample) => sample.structureMs);
    const maxBlankFrames = Math.max(...samples.map((sample) => sample.blankFrames));
    console.log(`PATINA_NAVIGATION_EXPERIENCE_REPORT:${JSON.stringify({
      environment: "Vite browser smoke with Tauri stubs; recommendation evidence, not a release hard gate",
      sampleCount: samples.length,
      activeP50Ms: percentile(activeValues, 0.5),
      activeP95Ms: percentile(activeValues, 0.95),
      activeMaxMs: Math.max(...activeValues),
      structureP50Ms: percentile(structureValues, 0.5),
      structureP95Ms: percentile(structureValues, 0.95),
      structureMaxMs: Math.max(...structureValues),
      maxBlankFrames,
    })}`);
    assert.equal(maxBlankFrames, 0, "warm navigation should never expose a blank canvas frame");
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

  await runTest("History date changes retain the presented day until the next snapshot is ready", async () => {
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
          const root = document.querySelector("[data-history-content-state]");
          globalThis.__TIME_TRACKER_HISTORY_PRESENTED_BEFORE_CHANGE = {
            date: root?.getAttribute("data-history-content-date") ?? "",
            label: document.querySelector(".history-date-label")?.textContent?.trim() ?? "",
            summary: document.querySelector(".history-day-summary-value")?.textContent?.trim() ?? "",
            segmentCount: document.querySelectorAll(".history-horizontal-timeline-segment").length,
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
      `(() => {
        const root = document.querySelector("[data-history-content-state]");
        return root?.getAttribute("data-history-content-state") === "refreshing"
          && root.getAttribute("data-history-content-date") === globalThis.__TIME_TRACKER_HISTORY_PRESENTED_BEFORE_CHANGE.date;
      })()`,
      undefined,
      "History should retain its presented date while the previous date loads",
    );
    await delay(150);

    const retainedPresentation = await evaluate(client!, sessionId, `
      (() => {
        const root = document.querySelector("[data-history-content-state]");
        return {
          date: root?.getAttribute("data-history-content-date") ?? "",
          label: document.querySelector(".history-date-label")?.textContent?.trim() ?? "",
          summary: document.querySelector(".history-day-summary-value")?.textContent?.trim() ?? "",
          segmentCount: document.querySelectorAll(".history-horizontal-timeline-segment").length,
          loading: document.body.innerText.includes(${jsonString(HISTORY_LOADING_VIEW)}),
        };
      })()
    `) as {
      date: string;
      label: string;
      summary: string;
      segmentCount: number;
      loading: boolean;
    };
    const presentationBeforeChange = await evaluate(
      client!,
      sessionId,
      `globalThis.__TIME_TRACKER_HISTORY_PRESENTED_BEFORE_CHANGE`,
    ) as Omit<typeof retainedPresentation, "loading">;
    assert.deepEqual(
      {
        date: retainedPresentation.date,
        label: retainedPresentation.label,
        summary: retainedPresentation.summary,
        segmentCount: retainedPresentation.segmentCount,
      },
      presentationBeforeChange,
    );
    assert.equal(retainedPresentation.loading, false);

    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        const root = document.querySelector("[data-history-content-state]");
        return root?.getAttribute("data-history-content-state") === "ready"
          && root.getAttribute("data-history-content-date") !== globalThis.__TIME_TRACKER_HISTORY_PRESENTED_BEFORE_CHANGE.date;
      })()`,
      15_000,
      "Previous History date should replace the retained presentation once ready",
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
    await waitForExpression(
      client!,
      sessionId,
      `localStorage.getItem("patina:last-active-view") === "dashboard"`,
      undefined,
      "Dashboard navigation should persist before the simulated WebView reload",
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
        && !["—", "0m"].includes(document.querySelector(".history-day-summary-value")?.textContent?.trim() ?? "")`,
      undefined,
      "History should mount the Dashboard aggregate seed before the delayed detail query settles",
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
    assert.equal(coldState.timelineText, "");
    assert.equal(coldState.segmentCount, 0, JSON.stringify(coldState));

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

  await runTest("rebuilt main window reveals only after saved appearance and destination settle", async () => {
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
      `document.querySelector("main.qp-canvas")?.dataset.presentedView === "data"
        && document.querySelector("main.qp-canvas")?.dataset.viewTransitionState === "settled"`,
    );
    await evaluate(client!, sessionId, `
      (() => {
        const key = "__time_tracker_smoke_settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        settings.theme_mode = "dark";
        settings.color_scheme_dark = "default";
        localStorage.setItem(key, JSON.stringify(settings));
      })()
    `);

    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE)`,
      15_000,
      "rebuilt dark Data window readiness",
    );
    const evidence = await evaluate(
      client!,
      sessionId,
      `globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE`,
    ) as {
      themeMode: string | null;
      theme: string | null;
      presentedView: string | null;
    };
    assert.equal(evidence.themeMode, "dark");
    assert.equal(evidence.theme, "dark");
    assert.equal(evidence.presentedView, "data");

    await evaluate(client!, sessionId, `
      (() => {
        const key = "__time_tracker_smoke_settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        settings.theme_mode = "light";
        localStorage.setItem(key, JSON.stringify(settings));
        localStorage.setItem("patina:last-active-view", "dashboard");
      })()
    `);
    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE?.theme === "light"
        && globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE?.presentedView === "dashboard"`,
      15_000,
      "restore browser smoke appearance and destination",
    );
  });
}
