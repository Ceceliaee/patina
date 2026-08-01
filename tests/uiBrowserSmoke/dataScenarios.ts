import assert from "node:assert/strict";
import { COPY } from "../../src/shared/copy/index.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import {
  delay,
  evaluate,
  jsonString,
  waitForAnimationFrames,
  waitForExpression,
} from "./browserHarness.ts";

export async function runDataScenarios(
  context: BrowserSmokeContext,
  options: { continuityOnly?: boolean } = {},
) {
  const { appUrl, client, sessionId, runTest } = context;

  await runTest("data trend range picker applies custom ranges and resets to last seven days", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
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
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-trend-range-trigger"))`);
    const stableScrollbarGeometry = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const root = document.querySelector("[data-data-content-state]");
        const chart = root?.querySelector(".data-overview .data-trend-chart");
        const destination = root?.querySelector(".data-app-panel");
        const heatmap = root?.querySelector(".data-overview > .data-heatmap-panel");
        if (!root || !chart || !heatmap) return null;

        const originalDestinationDisplay = destination?.style.display;
        const originalHeatmapDisplay = heatmap.style.display;
        if (destination) destination.style.display = "none";
        heatmap.style.display = "none";
        const widthWithoutOverflow = chart.getBoundingClientRect().width;
        const fitsWithoutOverflow = root.scrollHeight <= root.clientHeight;

        const spacer = document.createElement("div");
        spacer.style.flex = "0 0 " + (root.clientHeight + 1) + "px";
        spacer.setAttribute("aria-hidden", "true");
        root.appendChild(spacer);
        const widthWithOverflow = chart.getBoundingClientRect().width;
        const overflowsWithContent = root.scrollHeight > root.clientHeight;
        spacer.remove();

        if (destination) destination.style.display = originalDestinationDisplay ?? "";
        heatmap.style.display = originalHeatmapDisplay;

        return JSON.stringify({
          fitsWithoutOverflow,
          gutter: getComputedStyle(root).scrollbarGutter,
          overflowsWithContent,
          widthWithOverflow,
          widthWithoutOverflow,
        });
      })()
    `))) as {
      fitsWithoutOverflow: boolean;
      gutter: string;
      overflowsWithContent: boolean;
      widthWithOverflow: number;
      widthWithoutOverflow: number;
    } | null;
    assert.ok(stableScrollbarGeometry, "data page should expose its scroll owner and trend chart");
    assert.equal(stableScrollbarGeometry.gutter, "stable");
    assert.equal(stableScrollbarGeometry.fitsWithoutOverflow, true);
    assert.equal(stableScrollbarGeometry.overflowsWithContent, true);
    assert.ok(
      Math.abs(
        stableScrollbarGeometry.widthWithOverflow
        - stableScrollbarGeometry.widthWithoutOverflow,
      ) <= 0.5,
      `trend width should remain stable when the data page starts overflowing: ${JSON.stringify(stableScrollbarGeometry)}`,
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const trend = document.querySelector(".data-trend-range-trigger");
          const heatmapGroup = document.querySelector(".data-heatmap-range-control");
          const heatmapLabel = heatmapGroup?.querySelector(".qp-range-control-label");
          return {
            trendTag: trend?.tagName ?? null,
            trendHasPopup: trend?.getAttribute("aria-haspopup") ?? null,
            heatmapRole: heatmapGroup?.getAttribute("role") ?? null,
            heatmapLabelTag: heatmapLabel?.tagName ?? null,
            heatmapLabelDisabled: heatmapLabel?.hasAttribute("disabled") ?? null,
          };
        })()
      `),
      {
        trendTag: "BUTTON",
        trendHasPopup: "dialog",
        heatmapRole: "group",
        heatmapLabelTag: "SPAN",
        heatmapLabelDisabled: false,
      },
      "range controls should expose a named group and reserve button semantics for interactive labels",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".data-trend-range-trigger");
          if (!trigger || trigger.textContent?.trim() !== "近 7 天") return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".qp-range-picker"))`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.matches('.qp-range-picker-header strong')`,
      undefined,
      "range picker should focus its heading",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const picker = document.querySelector(".qp-range-picker");
          const header = picker?.querySelector(".qp-calendar-header");
          const navigation = picker?.querySelector(".qp-calendar-nav");
          const weekdays = picker?.querySelector(".qp-calendar-weekdays");
          const days = picker?.querySelector(".qp-calendar-days");
          const day = picker?.querySelector(".qp-calendar-day");
          if (!picker || !header || !navigation || !weekdays || !days || !day) return false;
          const pickerRect = picker.getBoundingClientRect();
          const navigationRect = navigation.getBoundingClientRect();
          const dayRect = day.getBoundingClientRect();
          return Boolean(
            Math.abs(pickerRect.width - 236) <= 0.5
            && Math.abs(navigationRect.width - 28) <= 0.5
            && Math.abs(navigationRect.height - 28) <= 0.5
            && Math.abs(dayRect.height - 26) <= 0.5
            && getComputedStyle(navigation).borderRadius === "10px"
            && getComputedStyle(day).borderRadius === "8px"
            && getComputedStyle(header).marginTop === "10px"
            && getComputedStyle(header).marginBottom === "0px"
            && getComputedStyle(weekdays).marginTop === "10px"
            && getComputedStyle(days).marginTop === "5px"
          );
        })()
      `),
      true,
      "range calendar should preserve its pre-consolidation geometry",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const key = (delta) => {
            const date = new Date();
            date.setDate(date.getDate() + delta);
            return [
              date.getFullYear(),
              String(date.getMonth() + 1).padStart(2, "0"),
              String(date.getDate()).padStart(2, "0"),
            ].join("-");
          };
          const start = document.querySelector('[data-range-picker-date="' + key(0) + '"]');
          if (!start) return false;
          start.click();
          return true;
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
          ].join("-");
          const end = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!end) return false;
          end.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "1天"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const apply = Array.from(document.querySelectorAll(".qp-range-picker-footer button"))
            .find((node) => node.textContent?.trim() === "确定");
          if (!apply) return false;
          apply.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector(".data-trend-range-trigger")?.textContent?.trim() === "1天"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const reset = document.querySelector(".data-trend-range-reset");
          if (!(reset instanceof HTMLButtonElement)
            || reset.getAttribute("aria-label") !== "恢复近 7 天") return false;
          reset.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector(".data-trend-range-trigger")?.textContent?.trim() === "近 7 天"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".data-trend-range-trigger");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".qp-range-picker"))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const next = document.querySelector('[aria-label="下一个范围模式"]');
          if (!next) return false;
          next.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "周"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
          const day = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!day) return false;
          day.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `/^第 \\d+ 周$/.test(document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() ?? "")`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const next = document.querySelector('[aria-label="下一个范围模式"]');
          if (!next) return false;
          next.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "月"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
          const day = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!day) return false;
          day.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `/^\\d+月$/.test(document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() ?? "")`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const next = document.querySelector('[aria-label="下一个范围模式"]');
          if (!next) return false;
          next.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "年"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
          const day = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!day) return false;
          day.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `/^\\d{4}年$/.test(document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() ?? "")`);
    await evaluate(client!, sessionId, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));`);
    await waitForExpression(client!, sessionId, `!document.querySelector(".qp-range-picker")`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.classList.contains('data-trend-range-trigger')`,
      undefined,
      "range picker trigger focus restoration",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".data-trend-range-trigger");
          if (!(trigger instanceof HTMLButtonElement)) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="下一个范围模式"]'))`,
    );
    await evaluate(
      client!,
      sessionId,
      `document.querySelector('[aria-label="下一个范围模式"]')?.click()`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "周"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
          ].join("-");
          const day = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!(day instanceof HTMLButtonElement)) return false;
          day.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `/^第 \\d+ 周$/.test(document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() ?? "")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const apply = Array.from(document.querySelectorAll(".qp-range-picker-footer button"))
            .find((node) => node.textContent?.trim() === "确定");
          if (!(apply instanceof HTMLButtonElement) || apply.disabled) return false;
          apply.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `/^第 \\d+ 周$/.test(document.querySelector(".data-trend-range-trigger")?.textContent?.trim() ?? "")
        && Boolean(document.querySelector(".data-trend-range-reset"))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const control = document.querySelector(".data-trend-period-control");
          const previous = control?.querySelector('[aria-label="切到更早范围"]');
          const next = control?.querySelector('[aria-label="切到较新范围"]');
          if (!(previous instanceof HTMLButtonElement)
            || !(next instanceof HTMLButtonElement)
            || !next.disabled) return false;
          previous.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        const next = document.querySelector('.data-trend-period-control [aria-label="切到较新范围"]');
        return next instanceof HTMLButtonElement && !next.disabled;
      })()`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const reset = document.querySelector(".data-trend-range-reset");
          if (!(reset instanceof HTMLButtonElement)) return false;
          reset.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-trend-range-trigger")?.textContent?.trim() === "近 7 天"
        && !document.querySelector(".data-trend-range-reset")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelectorAll(".data-trend-range-trigger")[1];
          if (!trigger || trigger.textContent?.trim() !== "近 7 天") return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".qp-range-picker"))`);
    for (let clickIndex = 0; clickIndex < 2; clickIndex += 1) {
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const date = new Date();
            const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
            const day = document.querySelector('[data-range-picker-date="' + key + '"]');
            if (!day) return false;
            day.click();
            return true;
          })()
        `),
        true,
      );
    }
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "1天"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const apply = Array.from(document.querySelectorAll(".qp-range-picker-footer button"))
            .find((node) => node.textContent?.trim() === "确定");
          if (!apply) return false;
          apply.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelectorAll(".data-trend-range-trigger")[1]?.textContent?.trim() === "1天"`);
  });

  await runTest("monthly data trend axes show every month", async () => {
    await evaluate(client!, sessionId, `
      document.querySelector(".data-app-panel .data-trend-range-reset")?.click()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `Array.from(document.querySelectorAll(".data-trend-range-trigger"))
        .every((trigger) => trigger.textContent?.trim() === "近 7 天")`,
    );

    for (const panelSelector of [".data-overview", ".data-app-panel"]) {
      for (const expectedLabel of ["近 30 天", "近一年"]) {
        assert.equal(
          await evaluate(client!, sessionId, `
            (() => {
              const panel = document.querySelector(${jsonString(panelSelector)});
              const next = panel?.querySelector(
                ".data-trend-range-control .qp-range-control-arrow:last-child",
              );
              if (!(next instanceof HTMLButtonElement) || next.disabled) return false;
              next.click();
              return true;
            })()
          `),
          true,
        );
        await waitForExpression(
          client!,
          sessionId,
          `document.querySelector(${jsonString(panelSelector)})
            ?.querySelector(".data-trend-range-trigger")
            ?.textContent?.trim() === ${jsonString(expectedLabel)}`,
        );
      }
    }

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".data-overview .qp-native-trend-x-tick").length === 12
        && document.querySelectorAll(".data-app-panel .qp-native-trend-x-tick").length === 12`,
      45_000,
      "all twelve monthly trend ticks",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        [".data-overview", ".data-app-panel"].every((panelSelector) => {
          const labels = Array.from(document.querySelectorAll(
            panelSelector + " .qp-native-trend-x-tick text",
          )).map((node) => node.textContent?.trim() ?? "");
          return labels.length === 12
            && new Set(labels).size === 12
            && labels.every((label) => /^\\d{1,2}月$/.test(label));
        })
      `),
      true,
      "activity and destination trends should render all twelve month labels",
    );

    for (const panelSelector of [".data-overview", ".data-app-panel"]) {
      for (const expectedLabel of ["近 30 天", "近 7 天"]) {
        assert.equal(
          await evaluate(client!, sessionId, `
            (() => {
              const panel = document.querySelector(${jsonString(panelSelector)});
              const previous = panel?.querySelector(
                ".data-trend-range-control .qp-range-control-arrow:first-child",
              );
              if (!(previous instanceof HTMLButtonElement) || previous.disabled) return false;
              previous.click();
              return true;
            })()
          `),
          true,
        );
        await waitForExpression(
          client!,
          sessionId,
          `document.querySelector(${jsonString(panelSelector)})
            ?.querySelector(".data-trend-range-trigger")
            ?.textContent?.trim() === ${jsonString(expectedLabel)}`,
        );
      }
    }
  });

  await runTest("data web trends keep their geometry and content through slow refreshes", async () => {
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_INVOKED_COMMANDS = [];
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 800;
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = false;
        document.querySelector(".data-app-panel .data-trend-range-reset")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".data-trend-range-trigger")[1]?.textContent?.trim() === "近 7 天"`,
      45_000,
      "app trend range reset before web continuity test",
    );
    const initialPanelHeight = Number(await evaluate(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel")?.getBoundingClientRect().height ?? 0`,
    ));
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const group = document.querySelector('[aria-label="选择时间去向类型"]');
          const web = Array.from(group?.querySelectorAll("button") ?? [])
            .find((node) => node.textContent?.trim() === "网页");
          if (!web) return false;
          web.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Array.from(document.querySelectorAll('[aria-label="选择时间去向类型"] button'))
        .some((node) => node.textContent?.trim() === "网页" && node.getAttribute("aria-pressed") === "true")`,
    );
    const pendingSwitchState = JSON.parse(String(await evaluate(client!, sessionId, `
      JSON.stringify({
        title: document.querySelector(".data-app-panel h3")?.textContent?.trim() ?? "",
        hasAppList: Boolean(document.querySelector('[aria-label="应用列表"]')),
        hasWebInitialStatus: Boolean(document.querySelector(".data-web-initial-status")),
        hasBlockingLoadingCopy:
          document.querySelector(".data-app-panel")?.textContent?.includes("正在加载网页趋势") ?? false,
        panelHeight: document.querySelector(".data-app-panel")?.getBoundingClientRect().height ?? 0,
      })
    `))) as {
      title: string;
      hasAppList: boolean;
      hasWebInitialStatus: boolean;
      hasBlockingLoadingCopy: boolean;
      panelHeight: number;
    };
    assert.equal(pendingSwitchState.title, "应用趋势");
    assert.equal(pendingSwitchState.hasAppList, true);
    assert.equal(pendingSwitchState.hasWebInitialStatus, false);
    assert.equal(pendingSwitchState.hasBlockingLoadingCopy, false);
    assert.ok(
      Math.abs(pendingSwitchState.panelHeight - initialPanelHeight) <= 1,
      `pending web switch height ${pendingSwitchState.panelHeight} should match ready height ${initialPanelHeight}`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "网页趋势"
        && document.querySelector('[aria-label="网页列表"]')?.textContent?.includes("docs.example.com")`,
      45_000,
    );

    const loadedPanelHeight = Number(await evaluate(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel")?.getBoundingClientRect().height ?? 0`,
    ));
    const webCommandsBeforeRuntimeRefresh = Number(await evaluate(
      client!,
      sessionId,
      `globalThis.__PATINA_INVOKED_COMMANDS
        .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length`,
    ));
    await evaluate(client!, sessionId, `
      globalThis.__PATINA_EMIT_TAURI_EVENT?.("tracking-data-changed", {
        reason: "session-transition",
        changed_at_ms: Date.now(),
      })
    `);
    await waitForExpression(
      client!,
      sessionId,
      `globalThis.__PATINA_INVOKED_COMMANDS
        .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length
        > ${webCommandsBeforeRuntimeRefresh}`,
      45_000,
      "tracking refresh starts a new web request",
    );
    const runtimeRefreshFrames = JSON.parse(String(await evaluate(client!, sessionId, `
      new Promise((resolve) => {
        const samples = [];
        const sample = () => {
          const panel = document.querySelector(".data-app-panel");
          const grid = panel?.querySelector(".data-app-grid");
          samples.push({
            title: panel?.querySelector("h3")?.textContent?.trim() ?? "",
            contentVisible: Boolean(
              grid
              && panel?.querySelector('[aria-label="网页列表"]')
              && panel?.querySelectorAll(".data-app-metric").length === 4
              && panel?.querySelector(".data-app-chart")
              && !grid.classList.contains("invisible")
            ),
            panelHeight: panel?.getBoundingClientRect().height ?? 0,
          });
          if (samples.length >= 20) {
            resolve(JSON.stringify(samples));
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      })
    `))) as Array<{
      title: string;
      contentVisible: boolean;
      panelHeight: number;
    }>;
    assert.ok(runtimeRefreshFrames.every((sample) => sample.title === "网页趋势"));
    assert.ok(runtimeRefreshFrames.every((sample) => sample.contentVisible));
    assert.ok(runtimeRefreshFrames.every(
      (sample) => Math.abs(sample.panelHeight - loadedPanelHeight) <= 1,
    ));
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-grid")?.getAttribute("aria-busy") !== "true"`,
      45_000,
      "tracking refresh completes without hiding web content",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const next = document.querySelector(
            ".data-app-panel .data-trend-range-control .qp-range-control-arrow:last-child",
          );
          if (!(next instanceof HTMLButtonElement)) return false;
          next.click();
          return true;
        })()
      `),
      true,
    );
    const frameSamples = JSON.parse(String(await evaluate(client!, sessionId, `
      new Promise((resolve) => {
        const samples = [];
        const sample = () => {
          const panel = document.querySelector(".data-app-panel");
          const grid = panel?.querySelector(".data-app-grid");
          const list = panel?.querySelector('[aria-label="网页列表"]');
          const metrics = panel?.querySelectorAll(".data-app-metric");
          const chart = panel?.querySelector(".data-app-chart");
          samples.push({
            busy: grid?.getAttribute("aria-busy") === "true",
            contentVisible: Boolean(
              grid
              && list
              && metrics?.length === 4
              && chart
              && !grid.classList.contains("invisible")
              && chart.getBoundingClientRect().height > 0
            ),
            panelHeight: panel?.getBoundingClientRect().height ?? 0,
          });
          if (samples.length >= 15) {
            resolve(JSON.stringify(samples));
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      })
    `))) as Array<{
      busy: boolean;
      contentVisible: boolean;
      panelHeight: number;
    }>;
    assert.equal(frameSamples.length, 15);
    assert.equal(frameSamples.filter((sample) => !sample.contentVisible).length, 0);
    assert.ok(frameSamples.some((sample) => sample.busy));
    assert.ok(frameSamples.every(
      (sample) => Math.abs(sample.panelHeight - loadedPanelHeight) <= 1,
    ));
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".data-app-panel")?.textContent?.includes("更新中")`,
      ),
      false,
      "web trend refreshes should stay visually quiet",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-grid")?.getAttribute("aria-busy") !== "true"
        && !document.querySelector(".data-app-panel")?.textContent?.includes("更新中")`,
      45_000,
      "web trend refresh completion",
    );

    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 800;
        document.querySelector(
          ".data-app-panel .data-trend-range-control .qp-range-control-arrow:last-child",
        )?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".data-trend-range-trigger")[1]?.textContent?.trim() === "近一年"`,
      45_000,
      "slow web trend request starts for a different range",
    );
    await evaluate(client!, sessionId, `
      document.querySelector(
        ".data-app-panel .data-trend-range-control .qp-range-control-arrow:first-child",
      )?.click()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".data-trend-range-trigger")[1]?.textContent?.trim() === "近 30 天"`,
      45_000,
      "web trend returns to the cached range",
    );
    const raceFrameSamples = JSON.parse(String(await evaluate(client!, sessionId, `
      new Promise((resolve) => {
        const samples = [];
        const sample = () => {
          const grid = document.querySelector(".data-app-panel .data-app-grid");
          samples.push(Boolean(
            grid
            && document.querySelector('[aria-label="网页列表"]')
            && document.querySelectorAll(".data-app-panel .data-app-metric").length === 4
            && document.querySelector(".data-app-panel .data-app-chart")
          ));
          if (samples.length >= 15) {
            resolve(JSON.stringify(samples));
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      })
    `))) as boolean[];
    assert.deepEqual(raceFrameSamples, Array.from({ length: 15 }, () => true));
    await evaluate(client!, sessionId, `
      new Promise((resolve, reject) => {
        const startedAt = performance.now();
        let lastCount = -1;
        let stableSince = performance.now();
        const sample = () => {
          const count = globalThis.__PATINA_INVOKED_COMMANDS
            .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length;
          if (count !== lastCount) {
            lastCount = count;
            stableSince = performance.now();
          }
          if (performance.now() - stableSince >= 900) {
            resolve();
            return;
          }
          if (performance.now() - startedAt >= 12_000) {
            reject(new Error("web aggregate commands did not become quiescent"));
            return;
          }
          setTimeout(sample, 50);
        };
        sample();
      })
    `);
    assert.deepEqual(
      JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify({
          range: document.querySelectorAll(".data-trend-range-trigger")[1]?.textContent?.trim(),
          busy: document.querySelector(".data-app-panel .data-app-grid")?.getAttribute("aria-busy"),
          hasContent: Boolean(document.querySelector('[aria-label="网页列表"]')),
        })
      `))),
      {
        range: "近 30 天",
        busy: "false",
        hasContent: true,
      },
      "the late one-year request must not replace the restored 30-day result",
    );

    const webCommandCount = Number(await evaluate(
      client!,
      sessionId,
      `globalThis.__PATINA_INVOKED_COMMANDS
        .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length`,
    ));
    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "应用趋势"`,
    );
    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "网页")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "网页趋势"`,
    );
    assert.deepEqual(
      JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify({
          hasContent: Boolean(document.querySelector('[aria-label="网页列表"]')),
          hasInvisibleBody: Boolean(document.querySelector(".data-app-panel .invisible")),
          webCommandCount: globalThis.__PATINA_INVOKED_COMMANDS
            .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length,
        })
      `))),
      {
        hasContent: true,
        hasInvisibleBody: false,
        webCommandCount,
      },
    );
    await evaluate(
      client!,
      sessionId,
      `new Promise((resolve) => setTimeout(resolve, 320))`,
    );
    assert.deepEqual(
      JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify({
          busy: document.querySelector(".data-app-grid")?.getAttribute("aria-busy"),
          hasUpdatingStatus: document.querySelector(".data-app-panel")
            ?.textContent?.includes("更新中") ?? false,
          webCommandCount: globalThis.__PATINA_INVOKED_COMMANDS
            .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length,
        })
      `))),
      {
        busy: "false",
        hasUpdatingStatus: false,
        webCommandCount,
      },
      "a cache-speed refresh must finish before the delayed status becomes visible",
    );
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 0;
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = false;
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "应用趋势"`,
    );
  });

  await runTest("data reuses the destination panel for web trends and its compact annual heatmap", async () => {
    await evaluate(client!, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS = []`);
    assert.equal(
      await evaluate(client!, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.some((entry) => entry.command === "cmd_get_web_activity_aggregate_range")`),
      false,
      "the default app view must not issue a web aggregate query",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const group = document.querySelector('[aria-label="选择时间去向类型"]');
          const web = Array.from(group?.querySelectorAll("button") ?? [])
            .find((node) => node.textContent?.trim() === "网页");
          if (!web) return false;
          web.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "网页趋势"`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label="网页列表"]')?.textContent?.includes("docs.example.com")`,
    );
    const webState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const grid = document.querySelector(".data-dashboard-grid");
        const directPanels = grid ? Array.from(grid.children) : [];
        const mode = document.querySelector('[aria-label="选择时间去向类型"]');
        const list = document.querySelector('[aria-label="网页列表"]');
        const heading = document.querySelector(".data-app-panel-heading");
        const headerActions = document.querySelector(".data-app-header-actions");
        return JSON.stringify({
          directChildren: directPanels.length,
          headingOrder: Array.from(heading?.children ?? []).map((node) => (
            node.tagName === "H3"
              ? "title"
              : node.classList.contains("data-destination-mode")
                ? "mode"
                : node.classList.contains("data-app-selected-status")
                  ? "selected"
                  : node.classList.contains("data-app-refresh-status")
                    ? "status"
                    : "unknown"
          )),
          headerOrder: Array.from(headerActions?.children ?? []).map((node) => (
            node.classList.contains("data-trend-period-control") ? "range" : "unknown"
          )),
          modePressed: mode?.querySelector('[aria-pressed="true"]')?.textContent?.trim() ?? null,
          domains: Array.from(list?.querySelectorAll("button") ?? []).map((node) => node.textContent?.trim()),
          hasHeatmapScope: Boolean(document.querySelector('[aria-label="选择热力图对象"]')),
          destinationHeatmapTitle: document.querySelector(".data-heatmap-panel-compact h3")
            ?.textContent?.trim() ?? null,
          destinationHeatmapHasSubtitle: Boolean(
            document.querySelector(".data-heatmap-panel-compact p"),
          ),
          destinationHeatmapCells: document.querySelectorAll(
            ".data-heatmap-panel-compact .data-heatmap-cell",
          ).length,
          destinationHeatmapTooltips: document.querySelectorAll(
            ".data-heatmap-panel-compact .data-heatmap-cell[data-heatmap-tooltip]",
          ).length,
          destinationHeatmapNotRecordedTooltips: Array.from(document.querySelectorAll(
            ".data-heatmap-panel-compact .data-heatmap-cell[data-heatmap-tooltip]",
          )).filter((cell) => cell.getAttribute("data-heatmap-tooltip")?.includes("未记录")).length,
          destinationHeatmapZeroTooltips: Array.from(document.querySelectorAll(
            ".data-heatmap-panel-compact .data-heatmap-cell[data-heatmap-tooltip]",
          )).filter((cell) => cell.getAttribute("data-heatmap-tooltip")?.endsWith("0m")).length,
        });
      })()
    `))) as {
      directChildren: number;
      headingOrder: string[];
      headerOrder: string[];
      modePressed: string | null;
      domains: string[];
      hasHeatmapScope: boolean;
      destinationHeatmapTitle: string | null;
      destinationHeatmapHasSubtitle: boolean;
      destinationHeatmapCells: number;
      destinationHeatmapTooltips: number;
      destinationHeatmapNotRecordedTooltips: number;
      destinationHeatmapZeroTooltips: number;
    };
    assert.equal(webState.directChildren, 2);
    assert.deepEqual(webState.headingOrder, ["title", "mode", "selected"]);
    assert.deepEqual(webState.headerOrder, ["range"]);
    assert.equal(webState.modePressed, "网页");
    assert.equal(webState.domains.length, 2);
    assert.equal(webState.hasHeatmapScope, false);
    assert.equal(webState.destinationHeatmapTitle, "网页热力图");
    assert.equal(webState.destinationHeatmapHasSubtitle, false);
    assert.ok(webState.destinationHeatmapCells > 0);
    assert.ok(webState.destinationHeatmapTooltips > 0);
    assert.equal(webState.destinationHeatmapNotRecordedTooltips, 0);
    assert.ok(webState.destinationHeatmapZeroTooltips > 0);

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const input = document.querySelector('input[aria-label="搜索网页"]');
          if (!(input instanceof HTMLInputElement)) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(input, "research");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="网页列表"] button').length === 1
        && document.querySelector('[aria-label="网页列表"]')?.textContent?.includes("research.example")`,
    );
    await evaluate(client!, sessionId, `
      (() => {
        const input = document.querySelector('input[aria-label="搜索网页"]');
        if (!(input instanceof HTMLInputElement)) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="网页列表"] button').length === 2`,
    );

    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        const app = Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用");
        app?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "应用趋势"`,
    );
  });

  await runTest("data destination selection follows Ctrl multi-select and keeps each mode in session", async () => {
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button').length >= 2`,
      45_000,
      "app comparison options",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const buttons = document.querySelectorAll('[aria-label="应用列表"] button');
        if (!(buttons[1] instanceof HTMLButtonElement)) return false;
        buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]').length === 2
        && document.querySelectorAll(".data-app-selected-icon").length === 2
        && document.querySelectorAll(".data-app-chart .qp-native-trend-line").length === 2
        && Array.from(document.querySelectorAll(
          '[aria-label="应用列表"] button[aria-pressed="true"]',
        )).every((button) => getComputedStyle(button, "::before").content === "none")
        && document.querySelector(".data-app-legend") === null
        && Array.from(document.querySelectorAll(
          ".data-heatmap-panel-compact [data-heatmap-tooltip]",
        )).every((cell) => !cell.getAttribute("data-heatmap-tooltip")?.includes("个对象"))`,
      45_000,
      "two selected app series",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const selectedKeys = Array.from(
          document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]'),
        ).map((button) => button.getAttribute("data-destination-key"));
        const iconKeys = Array.from(document.querySelectorAll(".data-app-selected-icon"))
          .map((icon) => icon.getAttribute("data-selection-key"));
        return JSON.stringify(iconKeys) === JSON.stringify(selectedKeys);
      })()
    `), true);

    await evaluate(client!, sessionId, `
      (() => {
        const input = document.querySelector('input[aria-label="搜索应用"]');
        const selected = document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]')[0];
        if (!(input instanceof HTMLInputElement) || !(selected instanceof HTMLButtonElement)) return;
        const name = selected.querySelector(".data-app-option-name")?.textContent ?? "";
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, name);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".data-app-selected-icon").length === 2
        && document.querySelectorAll(".data-app-chart .qp-native-trend-line").length === 2
        && document.querySelectorAll('[aria-label="应用列表"] button').length === 1`,
      45_000,
      "search keeps hidden app selection",
    );
    await evaluate(client!, sessionId, `
      (() => {
        const input = document.querySelector('input[aria-label="搜索应用"]');
        if (!(input instanceof HTMLInputElement)) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button').length >= 2`,
    );
    await evaluate(client!, sessionId, `
      document.querySelectorAll('[aria-label="应用列表"] button')[1]?.click()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]').length === 1
        && document.querySelectorAll(".data-app-selected-icon").length === 1
        && document.querySelectorAll(".data-app-chart .qp-native-trend-line").length === 1`,
      45_000,
      "plain click replaces app selection",
    );
    await evaluate(client!, sessionId, `
      document.querySelectorAll('[aria-label="应用列表"] button')[0]
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }))
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]').length === 2`,
    );

    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "网页")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="网页列表"] button').length >= 2`,
      45_000,
      "web comparison options",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(
        ".data-heatmap-panel-compact [data-heatmap-tooltip]",
      ).length > 0
        && !document.querySelector(".data-heatmap-panel-compact .data-heatmap-loading-state")`,
      45_000,
      "initial web heatmap presentation",
    );
    const initialWebHeatmapPresentation = String(await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll(
        ".data-heatmap-panel-compact [data-heatmap-tooltip]",
      )).map((cell) => cell.getAttribute("data-heatmap-tooltip")).join("|")
    `));
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 1_000;
        document.querySelectorAll('[aria-label="网页列表"] button')[1]
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
      })()
    `);
    const pendingWebHeatmapFrames = JSON.parse(String(await evaluate(client!, sessionId, `
      new Promise((resolve) => {
        const samples = [];
        const sample = () => {
          const tooltipCells = Array.from(document.querySelectorAll(
            ".data-heatmap-panel-compact [data-heatmap-tooltip]",
          ));
          samples.push({
            loading: Boolean(document.querySelector(
              ".data-heatmap-panel-compact .data-heatmap-loading-state",
            )),
            presentation: tooltipCells
              .map((cell) => cell.getAttribute("data-heatmap-tooltip"))
              .join("|"),
          });
          if (samples.length >= 20) {
            resolve(JSON.stringify(samples));
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      })
    `))) as Array<{ loading: boolean; presentation: string }>;
    assert.ok(pendingWebHeatmapFrames.some((sample) => sample.loading));
    assert.ok(pendingWebHeatmapFrames.every(
      (sample) => sample.presentation !== initialWebHeatmapPresentation,
    ));
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="网页列表"] button[aria-pressed="true"]').length === 2
        && document.querySelectorAll(".data-app-selected-icon").length === 2
        && document.querySelectorAll(".data-app-chart .qp-native-trend-line").length === 2`,
      45_000,
      "two selected web series",
    );
    await evaluate(
      client!,
      sessionId,
      `new Promise((resolve) => setTimeout(resolve, 1_050))
        .then(() => { globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 0; })`,
    );

    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]').length === 2`,
      45_000,
      "app selection survives mode change",
    );
    await evaluate(client!, sessionId, `
      document.querySelector(
        ".data-app-panel .data-trend-range-control .qp-range-control-arrow:last-child",
      )?.click()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".data-app-selected-icon").length === 2
        && document.querySelectorAll(".data-app-chart .qp-native-trend-line").length === 2
        && document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]').length === 2`,
      45_000,
      "app selection survives range change",
    );
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="设置"]')?.click()`);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".settings-button-preview"))`, 45_000);
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="数据"]')?.click()`);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]').length === 2
        && document.querySelectorAll(".data-app-selected-icon").length === 2
        && document.querySelectorAll(".data-app-chart .qp-native-trend-line").length === 2`,
      45_000,
      "app selection survives Data page navigation",
    );
  });

  await runTest("data destination details select a double-clicked target and focus on day analysis", async () => {
    await evaluate(
      client!,
      sessionId,
      `localStorage.removeItem("patina:destination-detail-timeline-zoom-hours:v1"); localStorage.removeItem("patina:data-destination-detail-timeline-zoom-hours:v1")`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button').length >= 2`,
      45_000,
      "app detail candidates",
    );
    await evaluate(client!, sessionId, `
      (() => {
        const buttons = Array.from(document.querySelectorAll('[aria-label="应用列表"] button'));
        if (!buttons.length || buttons.some((button) => button.getAttribute("aria-pressed") !== "true")) {
          return;
        }
        buttons[buttons.length - 1]?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          ctrlKey: true,
        }));
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `Array.from(document.querySelectorAll('[aria-label="应用列表"] button'))
        .some((button) => button.getAttribute("aria-pressed") !== "true")`,
      45_000,
      "unselected app detail candidate",
    );
    const openingState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const list = document.querySelector('[aria-label="应用列表"]');
        const buttons = list?.querySelectorAll("button") ?? [];
        const target = Array.from(buttons).find(
          (button) => button.getAttribute("aria-pressed") !== "true",
        ) ?? buttons[1];
        if (!(list instanceof HTMLElement) || !(target instanceof HTMLButtonElement)) return null;
        list.scrollTop = 40;
        target.focus();
        const selectedKeys = Array.from(
          list.querySelectorAll('button[aria-pressed="true"]'),
        ).map((button) => button.getAttribute("data-destination-key"));
        const backgroundRange = document.querySelector(
          ".data-app-panel > .data-app-panel-header .data-trend-range-trigger",
        )?.textContent?.trim() ?? "";
        window.__dataDetailOpeningTrace = { sawFallback: false };
        window.__dataDetailOpeningObserver = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (!(node instanceof Element)) continue;
              if (
                node.matches(".destination-detail-shell-fallback")
                || node.querySelector(".destination-detail-shell-fallback")
              ) {
                window.__dataDetailOpeningTrace.sawFallback = true;
              }
            }
          }
        });
        window.__dataDetailOpeningObserver.observe(document.body, {
          childList: true,
          subtree: true,
        });
        const trigger = target.querySelector("[data-destination-detail-trigger]");
        if (!(trigger instanceof HTMLElement)) return null;
        trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 2 }));
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
        trigger.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
        return JSON.stringify({
          backgroundRange,
          listScrollTop: list.scrollTop,
          selectedKeys,
          targetKey: target.getAttribute("data-destination-key"),
        });
      })()
    `))) as {
      backgroundRange: string;
      listScrollTop: number;
      selectedKeys: Array<string | null>;
      targetKey: string | null;
    };
    assert.ok(openingState);
    assert.ok(openingState.targetKey);
    assert.ok(!openingState.selectedKeys.includes(openingState.targetKey));
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-dialog"))`,
      45_000,
      "app detail dialog",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          window.__dataDetailOpeningObserver?.disconnect();
          const trace = window.__dataDetailOpeningTrace ?? null;
          delete window.__dataDetailOpeningObserver;
          delete window.__dataDetailOpeningTrace;
          return trace;
        })()
      `),
      { sawFallback: false },
      "detail dialog should mount its real surface directly without a fallback-frame swap",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const dialog = document.querySelector(".destination-detail-dialog");
          const background = document.querySelector("[data-data-content-state]");
          return {
            dialogCount: document.querySelectorAll(".destination-detail-dialog").length,
            hasDescription: Boolean(dialog?.querySelector(".qp-dialog-description")),
            hasHeatmap: Boolean(dialog?.querySelector(".data-heatmap-panel")),
            hasTrend: Boolean(dialog?.querySelector(".destination-detail-chart")),
            hasSummary: Boolean(dialog?.querySelector(".destination-detail-summary")),
            hasModeSwitch: Boolean(dialog?.querySelector(".data-destination-mode")),
            hasNavigation: Boolean(dialog?.querySelector("nav")),
            hasTimelineSubtitle: Boolean(
              dialog?.querySelector(".destination-detail-section-header p"),
            ),
            backgroundConnected: Boolean(background?.isConnected),
            selectedKeys: Array.from(document.querySelectorAll(
              '[aria-label="应用列表"] button[aria-pressed="true"]',
            )).map((button) => button.getAttribute("data-destination-key")),
          };
        })()
      `),
      {
        dialogCount: 1,
        hasDescription: false,
        hasHeatmap: false,
        hasTrend: false,
        hasSummary: false,
        hasModeSwitch: false,
        hasNavigation: false,
        hasTimelineSubtitle: false,
        backgroundConnected: true,
        selectedKeys: openingState.selectedKeys,
      },
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(
        document.querySelector(".destination-detail-header-actions")
        && document.querySelector(".destination-detail-timeline-track")
      )`,
      45_000,
      "app detail content",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `(() => {
        const timeline = document.querySelector(".destination-detail-timeline");
        const slider = document.querySelector(
          '.destination-detail-timeline-slider input[type="range"]',
        );
        return {
          zoomHours: timeline?.getAttribute("data-destination-detail-timeline-zoom-hours"),
          sliderValue: slider instanceof HTMLInputElement ? slider.value : null,
        };
      })()`),
      { zoomHours: "24", sliderValue: "24" },
      "detail timeline should open with the full 24-hour day",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const interaction = document.querySelector(
          ".destination-detail-timeline-interaction",
        );
        if (!(interaction instanceof HTMLElement)) return false;
        const rect = interaction.getBoundingClientRect();
        const wheel = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width * 0.75,
          clientY: rect.top + rect.height / 2,
          deltaY: -120,
        });
        interaction.dispatchEvent(wheel);
        return wheel.defaultPrevented;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-zoom-hours") === "23.8"`,
      45_000,
      "detail timeline wheel zoom",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const interaction = document.querySelector(
          ".destination-detail-timeline-interaction",
        );
        if (!(interaction instanceof HTMLElement)) return false;
        const rect = interaction.getBoundingClientRect();
        const wheel = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width * 0.75,
          clientY: rect.top + rect.height / 2,
          deltaY: 120,
        });
        interaction.dispatchEvent(wheel);
        return wheel.defaultPrevented;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-zoom-hours") === "24"`,
      45_000,
      "restore detail timeline wheel zoom",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const surface = document.querySelector(".destination-detail-dialog");
          const body = surface?.querySelector(".qp-dialog-body");
          return {
            bodyOwnsScrolling: body
              ? ["auto", "scroll"].includes(getComputedStyle(body).overflowY)
              : false,
            hasRangeControl: Boolean(surface?.querySelector(".data-trend-range-control")),
            hasTrendChart: Boolean(surface?.querySelector(".destination-detail-chart")),
            hasMetricSummary: Boolean(surface?.querySelector(
              ".destination-detail-summary",
            )),
            hasDaySummary: Boolean(surface?.querySelector(
              ".destination-detail-day-summary",
            )),
            hasTimelineZoom: Boolean(surface?.querySelector(
              'input[aria-label="时间轴窗口时长"]',
            )),
            nativeTooltipCount: surface?.querySelectorAll("[title]").length ?? -1,
          };
        })()
      `),
      {
        bodyOwnsScrolling: false,
        hasRangeControl: false,
        hasTrendChart: false,
        hasMetricSummary: false,
        hasDaySummary: false,
        hasTimelineZoom: true,
        nativeTooltipCount: 0,
      },
      "detail should use a compact zoomable day timeline without duplicate summaries or native tooltips",
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-timeline-segment"))`,
      45_000,
      "visible detail timeline segment",
    );
    const detailSegmentPresentation = JSON.parse(String(await evaluate(
      client!,
      sessionId,
      `
        (() => {
          const segment = document.querySelector(
            ".destination-detail-timeline-segment",
          );
          const track = document.querySelector(
            ".destination-detail-timeline-track",
          );
          const axis = document.querySelector(
            ".destination-detail-timeline-axis",
          );
          const firstAxisLabel = axis?.querySelector("span");
          if (!(segment instanceof HTMLElement)) return null;
          if (!(track instanceof HTMLElement)) return null;
          if (!(axis instanceof HTMLElement)) return null;
          if (!(firstAxisLabel instanceof HTMLElement)) return null;
          const rect = segment.getBoundingClientRect();
          const blockStyle = getComputedStyle(segment, "::before");
          const trackLineStyle = getComputedStyle(track, "::before");
          const axisStyle = getComputedStyle(axis);
          const firstAxisLabelStyle = getComputedStyle(firstAxisLabel);
          return JSON.stringify({
            nativeTitle: segment.getAttribute("title"),
            cursor: getComputedStyle(segment).cursor,
            blockHeight: blockStyle.height,
            blockRadius: blockStyle.borderRadius,
            hasGeometry: rect.width > 0 && rect.height > 0,
            trackLineHeight: trackLineStyle.height,
            trackLineTop: trackLineStyle.top,
            axisFontSize: axisStyle.fontSize,
            axisFontWeight: axisStyle.fontWeight,
            axisLabelTop: firstAxisLabelStyle.top,
            hasVerticalGrid: Boolean(document.querySelector(
              ".destination-detail-timeline-grid",
            )),
          });
        })()
      `,
    )));
    assert.deepEqual(
      {
        nativeTitle: detailSegmentPresentation.nativeTitle,
        cursor: detailSegmentPresentation.cursor,
        blockHeight: detailSegmentPresentation.blockHeight,
        blockRadius: detailSegmentPresentation.blockRadius,
        hasGeometry: detailSegmentPresentation.hasGeometry,
        trackLineHeight: detailSegmentPresentation.trackLineHeight,
        trackLineTop: detailSegmentPresentation.trackLineTop,
        axisFontSize: detailSegmentPresentation.axisFontSize,
        axisFontWeight: detailSegmentPresentation.axisFontWeight,
        axisLabelTop: detailSegmentPresentation.axisLabelTop,
        hasVerticalGrid: detailSegmentPresentation.hasVerticalGrid,
      },
      {
        nativeTitle: null,
        cursor: "default",
        blockHeight: "48px",
        blockRadius: "2px",
        hasGeometry: true,
        trackLineHeight: "1px",
        trackLineTop: "31px",
        axisFontSize: "9px",
        axisFontWeight: "700",
        axisLabelTop: "5px",
        hasVerticalGrid: false,
      },
      "detail timeline should reuse the History blocks and centered horizontal track",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const segment = document.querySelector(
          ".destination-detail-timeline-segment",
        );
        if (!(segment instanceof HTMLElement)) return false;
        segment.dispatchEvent(new MouseEvent("mouseover", {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(
        ".qp-tooltip.destination-detail-timeline-tooltip",
      ))`,
      45_000,
      "Quiet Pro detail timeline tooltip",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `(() => {
          const tooltipLabel = document
            .querySelector(
              ".destination-detail-timeline-tooltip-label",
            )
            ?.textContent?.trim();
          const dialogHeading = document
            .querySelector(
              ".destination-detail-dialog .qp-dialog-heading",
            )
            ?.textContent?.trim();

          return Boolean(
            tooltipLabel &&
              dialogHeading &&
              dialogHeading.includes(tooltipLabel),
          );
        })()`,
      ),
      true,
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const segment = document.querySelector(
          ".destination-detail-timeline-segment",
        );
        if (!(segment instanceof HTMLElement)) return false;
        segment.dispatchEvent(new MouseEvent("mouseout", {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
          view: window,
        }));
        return true;
      })()
    `), true);
    const wideDialogGeometry = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const surface = document.querySelector(".destination-detail-dialog");
        const header = surface?.querySelector(".qp-dialog-header");
        const heading = surface?.querySelector(".qp-dialog-heading");
        const actions = surface?.querySelector(".destination-detail-header-actions");
        const timeline = surface?.querySelector(".destination-detail-timeline-track");
        if (!surface || !header || !heading || !actions || !timeline) return null;
        const surfaceRect = surface.getBoundingClientRect();
        const headingRect = heading.getBoundingClientRect();
        const actionsRect = actions.getBoundingClientRect();
        const timelineRect = timeline.getBoundingClientRect();
        return JSON.stringify({
          horizontalOverflow: surface.scrollWidth > surface.clientWidth,
          insideViewport: surfaceRect.left >= 0
            && surfaceRect.right <= innerWidth
            && surfaceRect.top >= 0
            && surfaceRect.bottom <= innerHeight,
          referenceHeight: surfaceRect.height <= 672.5,
          headerOverlap: headingRect.right > actionsRect.left
            && headingRect.bottom > actionsRect.top
            && headingRect.top < actionsRect.bottom,
          timelineInside: timelineRect.left >= surfaceRect.left
            && timelineRect.right <= surfaceRect.right,
        });
      })()
    `))) as {
      horizontalOverflow: boolean;
      insideViewport: boolean;
      referenceHeight: boolean;
      headerOverlap: boolean;
      timelineInside: boolean;
    };
    assert.deepEqual(wideDialogGeometry, {
      horizontalOverflow: false,
      insideViewport: true,
      referenceHeight: true,
      headerOverlap: false,
      timelineInside: true,
    });
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 720,
      height: 720,
      deviceScaleFactor: 1.5,
      mobile: false,
    }, sessionId);
    await waitForAnimationFrames(client!, sessionId, 2);
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const surface = document.querySelector(".destination-detail-dialog");
          const timeline = surface?.querySelector(".destination-detail-timeline-track");
          if (!surface || !timeline) return null;
          const surfaceRect = surface.getBoundingClientRect();
          const timelineRect = timeline.getBoundingClientRect();
          return {
            horizontalOverflow: surface.scrollWidth > surface.clientWidth,
            surfaceInside: surfaceRect.left >= 0 && surfaceRect.right <= innerWidth,
            timelineInside: timelineRect.left >= surfaceRect.left
              && timelineRect.right <= surfaceRect.right,
          };
        })()
      `),
      {
        horizontalOverflow: false,
        surfaceInside: true,
        timelineInside: true,
      },
      "detail dialog should remain contained at the narrow supported width and 150% DPR",
    );
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1.25,
      mobile: false,
    }, sessionId);
    await waitForAnimationFrames(client!, sessionId, 2);
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const surface = document.querySelector(".destination-detail-dialog");
          const actions = surface?.querySelector(".destination-detail-header-actions");
          const heading = surface?.querySelector(".qp-dialog-heading");
          if (!surface || !actions || !heading) return null;
          const surfaceRect = surface.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          const headingRect = heading.getBoundingClientRect();
          return {
            horizontalOverflow: surface.scrollWidth > surface.clientWidth,
            insideViewport: surfaceRect.left >= 0
              && surfaceRect.right <= innerWidth
              && surfaceRect.top >= 0
              && surfaceRect.bottom <= innerHeight,
            headerOverlap: headingRect.right > actionsRect.left
              && headingRect.bottom > actionsRect.top
              && headingRect.top < actionsRect.bottom,
          };
        })()
      `),
      {
        horizontalOverflow: false,
        insideViewport: true,
        headerOverlap: false,
      },
      "detail dialog should remain stable in a 125% DPI full-screen reference viewport",
    );
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await waitForAnimationFrames(client!, sessionId, 2);
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const surface = document.querySelector(".destination-detail-dialog");
          return {
            backgroundRange: document.querySelector(
            ".data-app-panel > .data-app-panel-header .data-trend-range-trigger",
            )?.textContent?.trim() ?? "",
            hasTrendChart: Boolean(surface?.querySelector(
              ".destination-detail-chart",
            )),
            hasMetricSummary: Boolean(surface?.querySelector(
              ".destination-detail-summary",
            )),
          };
        })()
      `),
      {
        backgroundRange: openingState.backgroundRange,
        hasTrendChart: false,
        hasMetricSummary: false,
      },
      "detail should leave the Data trend range untouched and omit duplicate analysis",
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-timeline-track"))
        && Boolean(document.querySelector(
          ".destination-detail-activity-disclosure",
        ))`,
      45_000,
      "detail day analysis",
    );
    const detailBeforeDelayedDayNavigation = JSON.parse(String(await evaluate(
      client!,
      sessionId,
      `
        (() => {
          const content = document.querySelector(
            ".destination-detail-day-content",
          );
          const timeline = document.querySelector(
            ".destination-detail-timeline-track",
          );
          const records = document.querySelector(
            ".destination-detail-records",
          );
          if (!(content instanceof HTMLElement)) return null;
          if (!(timeline instanceof HTMLElement)) return null;
          if (!(records instanceof HTMLElement)) return null;
          const timelineRect = timeline.getBoundingClientRect();
          const recordsRect = records.getBoundingClientRect();
          return JSON.stringify({
            displayedDate: content.dataset.destinationDetailDisplayedDate,
            requestedDate: content.dataset.destinationDetailRequestedDate,
            timelineRect: {
              width: timelineRect.width,
              height: timelineRect.height,
            },
            recordsRect: {
              width: recordsRect.width,
              height: recordsRect.height,
            },
          });
        })()
      `,
    ))) as {
      displayedDate: string;
      requestedDate: string;
      timelineRect: { width: number; height: number };
      recordsRect: { width: number; height: number };
    };
    assert.ok(detailBeforeDelayedDayNavigation);
    assert.equal(
      detailBeforeDelayedDayNavigation.displayedDate,
      detailBeforeDelayedDayNavigation.requestedDate,
    );
    await evaluate(
      client!,
      sessionId,
      `localStorage.setItem("__time_tracker_history_query_delay_ms", "900")`,
    );
    try {
      assert.equal(await evaluate(client!, sessionId, `
        (() => {
          const previous = document.querySelector(
            ".destination-detail-day-actions .qp-range-control-arrow",
          );
          if (!(previous instanceof HTMLButtonElement) || previous.disabled) {
            return false;
          }
          previous.click();
          return true;
        })()
      `), true);
      await delay(150);
      const retainedDetailDuringDelayedNavigation = JSON.parse(String(
        await evaluate(client!, sessionId, `
          (() => {
            const content = document.querySelector(
              ".destination-detail-day-content",
            );
            const timeline = document.querySelector(
              ".destination-detail-timeline-track",
            );
            const records = document.querySelector(
              ".destination-detail-records",
            );
            if (!(content instanceof HTMLElement)) return null;
            if (!(timeline instanceof HTMLElement)) return null;
            if (!(records instanceof HTMLElement)) return null;
            const timelineRect = timeline.getBoundingClientRect();
            const recordsRect = records.getBoundingClientRect();
            return JSON.stringify({
              busy: content.getAttribute("aria-busy"),
              displayedDate: content.dataset.destinationDetailDisplayedDate,
              requestedDate: content.dataset.destinationDetailRequestedDate,
              hasTimelinePlaceholder: Boolean(document.querySelector(
                ".destination-detail-timeline-placeholder",
              )),
              hasRecordsPlaceholder: Boolean(document.querySelector(
                ".destination-detail-records-placeholder",
              )),
              timelineRect: {
                width: timelineRect.width,
                height: timelineRect.height,
              },
              recordsRect: {
                width: recordsRect.width,
                height: recordsRect.height,
              },
            });
          })()
        `),
      )) as {
        busy: string | null;
        displayedDate: string;
        requestedDate: string;
        hasTimelinePlaceholder: boolean;
        hasRecordsPlaceholder: boolean;
        timelineRect: { width: number; height: number };
        recordsRect: { width: number; height: number };
      };
      assert.ok(retainedDetailDuringDelayedNavigation);
      assert.equal(retainedDetailDuringDelayedNavigation.busy, "true");
      assert.equal(
        retainedDetailDuringDelayedNavigation.displayedDate,
        detailBeforeDelayedDayNavigation.displayedDate,
      );
      assert.notEqual(
        retainedDetailDuringDelayedNavigation.requestedDate,
        detailBeforeDelayedDayNavigation.requestedDate,
      );
      assert.equal(retainedDetailDuringDelayedNavigation.hasTimelinePlaceholder, false);
      assert.equal(retainedDetailDuringDelayedNavigation.hasRecordsPlaceholder, false);
      assert.ok(
        Math.abs(
          retainedDetailDuringDelayedNavigation.timelineRect.width
            - detailBeforeDelayedDayNavigation.timelineRect.width,
        ) <= 0.5,
      );
      assert.ok(
        Math.abs(
          retainedDetailDuringDelayedNavigation.timelineRect.height
            - detailBeforeDelayedDayNavigation.timelineRect.height,
        ) <= 0.5,
      );
      assert.ok(
        Math.abs(
          retainedDetailDuringDelayedNavigation.recordsRect.width
            - detailBeforeDelayedDayNavigation.recordsRect.width,
        ) <= 0.5,
      );
      assert.ok(
        Math.abs(
          retainedDetailDuringDelayedNavigation.recordsRect.height
            - detailBeforeDelayedDayNavigation.recordsRect.height,
        ) <= 0.5,
      );
      await waitForExpression(
        client!,
        sessionId,
        `(() => {
          const content = document.querySelector(
            ".destination-detail-day-content",
          );
          return content?.getAttribute("aria-busy") === "false"
            && content.getAttribute("data-destination-detail-displayed-date")
              === content.getAttribute("data-destination-detail-requested-date");
        })()`,
        45_000,
        "detail day navigation settles without an intermediate blank frame",
      );
    } finally {
      await evaluate(
        client!,
        sessionId,
        `localStorage.removeItem("__time_tracker_history_query_delay_ms")`,
      );
    }
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const arrows = document.querySelectorAll(
          ".destination-detail-day-actions .qp-range-control-arrow",
        );
        const next = arrows[1];
        if (!(next instanceof HTMLButtonElement) || next.disabled) return false;
        next.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".destination-detail-day-content")
        ?.getAttribute("data-destination-detail-displayed-date")
          === ${jsonString(detailBeforeDelayedDayNavigation.displayedDate)}`,
      45_000,
      "restore detail day after delayed navigation regression",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const slider = document.querySelector(
          '.destination-detail-timeline-slider input[type="range"]',
        );
        if (!(slider instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(slider, "3");
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-zoom-hours") === "3"`,
      45_000,
      "detail timeline first zoom step",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `localStorage.getItem("patina:destination-detail-timeline-zoom-hours:v1")`,
      ),
      "3",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const decrease = document.querySelector(
          '.destination-detail-dialog button[aria-label="缩短时间轴窗口"]',
        );
        if (!(decrease instanceof HTMLButtonElement)) return false;
        decrease.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-zoom-hours") === "2"`,
      45_000,
      "detail timeline zoom",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `localStorage.getItem("patina:destination-detail-timeline-zoom-hours:v1")`,
      ),
      "2",
    );
    const timelineStartBeforePan = Number(await evaluate(client!, sessionId, `
      document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-start-ms")
    `));
    assert.ok(Number.isFinite(timelineStartBeforePan));
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const interaction = document.querySelector(
          ".destination-detail-timeline-interaction",
        );
        if (!(interaction instanceof HTMLElement)) return false;
        interaction.dispatchEvent(new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Number(document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-start-ms")) > ${timelineStartBeforePan}`,
      45_000,
      "detail timeline horizontal pan",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const interaction = document.querySelector(
          ".destination-detail-timeline-interaction",
        );
        if (!(interaction instanceof HTMLElement)) return false;
        interaction.dispatchEvent(new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          bubbles: true,
        }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Number(document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-start-ms")) === ${timelineStartBeforePan}`,
      45_000,
      "restore detail timeline pan",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const interaction = document.querySelector(
            ".destination-detail-timeline-interaction",
          );
          if (!(interaction instanceof HTMLElement)) return false;
          interaction.dispatchEvent(new KeyboardEvent("keydown", {
            key: "End",
            bubbles: true,
          }));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Number(document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-start-ms")) > ${timelineStartBeforePan}`,
      45_000,
      "move detail timeline to day end",
    );
    let reachedRecordedActivities = false;
    for (let index = 0; index < 120; index += 1) {
      reachedRecordedActivities = Boolean(await evaluate(
        client!,
        sessionId,
        `Boolean(document.querySelector(".destination-detail-activity-disclosure"))`,
      ));
      if (reachedRecordedActivities) break;
      const panStart = Number(await evaluate(client!, sessionId, `
        document.querySelector(".destination-detail-timeline")
          ?.getAttribute("data-destination-detail-timeline-start-ms")
      `));
      await evaluate(client!, sessionId, `
        document.querySelector(".destination-detail-timeline-interaction")
          ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
      `);
      await waitForExpression(
        client!,
        sessionId,
        `Number(document.querySelector(".destination-detail-timeline")
          ?.getAttribute("data-destination-detail-timeline-start-ms")) < ${panStart}`,
        45_000,
        "pan detail timeline toward recorded activities",
      );
    }
    reachedRecordedActivities ||= Boolean(await evaluate(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-activity-disclosure"))`,
    ));
    assert.equal(
      reachedRecordedActivities,
      true,
      "keyboard panning should reach recorded activities regardless of the current clock hour",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const surface = document.querySelector(".destination-detail-dialog");
          const body = surface?.querySelector(".qp-dialog-body");
          const records = surface?.querySelector(".destination-detail-records");
          if (!body || !records) return false;

          const bodyOverflowY = getComputedStyle(body).overflowY;
          const recordsOverflowY = getComputedStyle(records).overflowY;
          return !["auto", "scroll"].includes(bodyOverflowY)
            && ["auto", "scroll"].includes(recordsOverflowY);
        })()
      `),
      true,
      "only the application-detail list should own vertical scrolling",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const records = document.querySelector(".destination-detail-records");
          const summaries = Array.from(
            document.querySelectorAll(".destination-detail-activity-summary"),
          );
          if (!(records instanceof HTMLElement) || summaries.length === 0) return false;
          const recordsStyle = getComputedStyle(records);
          const summaryHeights = summaries.map(
            (summary) => summary.getBoundingClientRect().height,
          );
          return recordsStyle.alignContent === "start"
            && recordsStyle.gridAutoRows === "max-content"
            && summaryHeights.every((height) => height >= 46 && height <= 64)
            && summaryHeights.reduce((total, height) => total + height, 0)
              < records.getBoundingClientRect().height;
        })()
      `),
      true,
      "application-detail rows should retain the fixed Quiet Pro summary height",
    );
    const durationControlState = JSON.parse(String(
      await evaluate(client!, sessionId, `
        (() => {
          const controls = document.querySelector(
            ".destination-detail-duration-controls",
          );
          const decrease = controls?.querySelector(
            '[aria-label="减少显示分钟 1 分钟"]',
          );
          const increase = controls?.querySelector(
            '[aria-label="增加显示分钟 1 分钟"]',
          );
          const value = controls?.querySelector(
            ".destination-detail-duration-value",
          );
          if (
            !(decrease instanceof HTMLButtonElement)
            || !(increase instanceof HTMLButtonElement)
            || !(value instanceof HTMLElement)
          ) return null;
          const initialMinutes = Number.parseInt(value.textContent ?? "", 10);
          const initialActivityCount = document.querySelectorAll(
            ".destination-detail-activity",
          ).length;
          const change = increase.disabled ? -1 : 1;
          const button = change > 0 ? increase : decrease;
          button.click();
          return JSON.stringify({
            change,
            initialActivityCount,
            initialMinutes,
          });
        })()
      `),
    )) as {
      change: number;
      initialActivityCount: number;
      initialMinutes: number;
    };
    assert.ok(durationControlState);
    await waitForExpression(
      client!,
      sessionId,
      `Number.parseInt(
        document.querySelector(".destination-detail-duration-value")
          ?.textContent ?? "",
        10,
      ) === ${durationControlState.initialMinutes + durationControlState.change}`,
      45_000,
      "detail minimum activity duration update",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        document.querySelectorAll(".destination-detail-activity").length
          ${durationControlState.change > 0 ? "<=" : ">="}
          ${durationControlState.initialActivityCount}
      `),
      true,
      "raising the minimum duration should never add fragmented activities",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const controls = document.querySelector(
            ".destination-detail-duration-controls",
          );
          const button = controls?.querySelector(
            ${durationControlState.change > 0
              ? `'[aria-label="减少显示分钟 1 分钟"]'`
              : `'[aria-label="增加显示分钟 1 分钟"]'`}
          );
          if (!(button instanceof HTMLButtonElement)) return false;
          button.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Number.parseInt(
        document.querySelector(".destination-detail-duration-value")
          ?.textContent ?? "",
        10,
      ) === ${durationControlState.initialMinutes}
        && Boolean(document.querySelector(
          ".destination-detail-activity-disclosure",
        ))`,
      45_000,
      "restore detail minimum activity duration",
    );
    const detailDayNavigationContract = await evaluate(client!, sessionId, `
        (() => {
          const controls = document.querySelector(
            ".destination-detail-day-actions",
          );
          const arrows = controls?.querySelectorAll(".qp-range-control-arrow");
          const label = controls?.querySelector(".qp-range-control-label");
          const referenceLabel = document.querySelector(
            ".data-app-panel .data-trend-range-control .qp-range-control-label",
          );
          if (!arrows || arrows.length !== 2 || !label || !referenceLabel) {
            return {
              passed: false,
              diagnostics: { reason: "missing controls" },
            };
          }
          const leftRect = arrows[0].getBoundingClientRect();
          const rightRect = arrows[1].getBoundingClientRect();
          const labelRect = label.getBoundingClientRect();
          const labelStyle = getComputedStyle(label);
          const referenceStyle = getComputedStyle(referenceLabel);
          const sharedStyleProperties = [
            "height",
            "minHeight",
            "borderRadius",
            "borderTopWidth",
            "borderTopColor",
            "backgroundColor",
            "paddingLeft",
            "paddingRight",
            "fontSize",
            "fontWeight",
            "lineHeight",
          ];
          const geometryMatches = [leftRect.height, rightRect.height, labelRect.height]
              .every((height) => Math.abs(height - 24) <= 0.5)
            && [leftRect.width, rightRect.width]
              .every((width) => Math.abs(width - 24) <= 0.5)
            && labelRect.width >= 68;
          const ownerMatches = controls?.parentElement?.classList.contains(
              "qp-date-picker-day-navigation",
            );
          const avoidsInputContract = !label.classList.contains("qp-input");
          const clickableCursor = labelStyle.cursor === "pointer";
          const styleDifferences = sharedStyleProperties
            .filter((property) => labelStyle[property] !== referenceStyle[property])
            .map((property) => ({
              property,
              actual: labelStyle[property],
              expected: referenceStyle[property],
            }));
          return {
            passed: geometryMatches
              && ownerMatches
              && avoidsInputContract
              && clickableCursor
              && styleDifferences.length === 0,
            diagnostics: {
              geometryMatches,
              ownerMatches,
              avoidsInputContract,
              clickableCursor,
              rects: {
                left: { width: leftRect.width, height: leftRect.height },
                label: { width: labelRect.width, height: labelRect.height },
                right: { width: rightRect.width, height: rightRect.height },
              },
              styleDifferences,
            },
          };
        })()
      `) as {
        passed: boolean;
        diagnostics: unknown;
      };
    assert.equal(
      detailDayNavigationContract.passed,
      true,
      `detail day navigation should reuse the actual compact range-control contract: ${
        JSON.stringify(detailDayNavigationContract.diagnostics)
      }`,
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const trigger = document.querySelector(
          ".destination-detail-date-trigger",
        );
        if (!(trigger instanceof HTMLButtonElement)) return false;
        trigger.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(
        ".qp-calendar-popover .qp-calendar-days",
      ))`,
      45_000,
      "detail day calendar",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(
            ".destination-detail-date-trigger",
          );
          const arrow = document.querySelector(
            ".destination-detail-day-actions .qp-range-control-arrow",
          );
          const selected = document.querySelector(
            ".qp-calendar-popover .qp-calendar-day[data-selected='true']",
          );
          if (
            !(trigger instanceof HTMLButtonElement)
            || !(arrow instanceof HTMLButtonElement)
            || !(selected instanceof HTMLButtonElement)
          ) return false;
          const selectedKey = selected.dataset.calendarDate;
          if (!selectedKey) return false;
          const outsideButton = Array.from(document.querySelectorAll(
            ".qp-calendar-popover [data-calendar-date]",
          )).find(
            (candidate) => candidate instanceof HTMLButtonElement
              && (candidate.dataset.calendarDate ?? "") < selectedKey
              && !candidate.disabled,
          );
          return trigger.classList.contains("qp-date-picker-range-trigger-open")
            && getComputedStyle(trigger).borderTopColor
              === getComputedStyle(arrow).borderTopColor
            && outsideButton instanceof HTMLButtonElement
            && !outsideButton.disabled;
        })()
      `),
      true,
      "range date picker should keep neutral chrome and allow dates before the initial seven-day range",
    );
    await evaluate(
      client!,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".qp-calendar-popover")
        && Boolean(document.querySelector(".destination-detail-dialog"))`,
      45_000,
      "close detail day calendar",
    );
    const activityDisclosureGeometry = JSON.parse(String(await evaluate(
      client!,
      sessionId,
      `
        (() => {
          const trigger = document.querySelector(
            ".destination-detail-activity-disclosure",
          );
          const records = document.querySelector(
            ".destination-detail-records",
          );
          const row = trigger?.closest(".destination-detail-activity");
          if (!(trigger instanceof HTMLButtonElement)) return null;
          if (!(records instanceof HTMLElement)) return null;
          if (!(row instanceof HTMLElement)) return null;
          const rowRect = row.getBoundingClientRect();
          const recordsRect = records.getBoundingClientRect();
          trigger.click();
          return JSON.stringify({
            rowHeight: rowRect.height,
            recordsHeight: recordsRect.height,
          });
        })()
      `,
    ))) as {
      rowHeight: number;
      recordsHeight: number;
    };
    assert.ok(activityDisclosureGeometry);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(
        ".destination-detail-record-popover "
          + ".destination-detail-popover-item",
      ))`,
      45_000,
      "detail title popover",
    );
    const activityPopoverContract = JSON.parse(String(await evaluate(
      client!,
      sessionId,
      `
        (() => {
          const trigger = document.querySelector(
            ".destination-detail-activity-disclosure[aria-expanded='true']",
          );
          const popover = document.querySelector(
            ".destination-detail-record-popover",
          );
          const records = document.querySelector(
            ".destination-detail-records",
          );
          const row = trigger?.closest(".destination-detail-activity");
          if (!(trigger instanceof HTMLButtonElement)) return null;
          if (!(popover instanceof HTMLElement)) return null;
          if (!(records instanceof HTMLElement)) return null;
          if (!(row instanceof HTMLElement)) return null;
          return JSON.stringify({
            parentIsBody: popover.parentElement === document.body,
            role: popover.getAttribute("role"),
            itemCount: popover.querySelectorAll(
              ".destination-detail-popover-item",
            ).length,
            hasLegacyDrawer: Boolean(document.querySelector(
              ".destination-detail-fragments",
            )),
            nativeTooltipCount: popover.querySelectorAll("[title]").length,
            rowHeight: row.getBoundingClientRect().height,
            recordsHeight: records.getBoundingClientRect().height,
          });
        })()
      `,
    ))) as {
      parentIsBody: boolean;
      role: string | null;
      itemCount: number;
      hasLegacyDrawer: boolean;
      nativeTooltipCount: number;
      rowHeight: number;
      recordsHeight: number;
    };
    assert.ok(activityPopoverContract);
    assert.equal(activityPopoverContract.parentIsBody, true);
    assert.equal(activityPopoverContract.role, "region");
    assert.ok(activityPopoverContract.itemCount >= 1);
    assert.equal(activityPopoverContract.hasLegacyDrawer, false);
    assert.equal(
      activityPopoverContract.nativeTooltipCount,
      0,
      "title detail popovers should not duplicate visible copy with browser-native tooltips",
    );
    assert.ok(
      Math.abs(
        activityPopoverContract.rowHeight - activityDisclosureGeometry.rowHeight,
      ) < 1,
      "title popover should not change the activity row height",
    );
    assert.ok(
      Math.abs(
        activityPopoverContract.recordsHeight
          - activityDisclosureGeometry.recordsHeight,
      ) < 1,
      "title popover should not change the records viewport height",
    );
    await evaluate(
      client!,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".destination-detail-record-popover")
        && Boolean(document.querySelector(".destination-detail-dialog"))`,
      45_000,
      "close detail title popover without closing the dialog",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const trigger = document.querySelector(
          ".destination-detail-date-trigger",
        );
        if (!(trigger instanceof HTMLButtonElement)) return false;
        trigger.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(
        ".qp-calendar-popover .qp-calendar-day[data-selected='true']",
      ))`,
      45_000,
      "reopen unrestricted detail day calendar",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const selected = document.querySelector(
          ".qp-calendar-popover .qp-calendar-day[data-selected='true']",
        );
        if (!(selected instanceof HTMLButtonElement)) return false;
        const selectedKey = selected.dataset.calendarDate;
        if (!selectedKey) return false;
        const outsideButton = Array.from(document.querySelectorAll(
          ".qp-calendar-popover [data-calendar-date]",
        )).find(
          (candidate) => candidate instanceof HTMLButtonElement
            && (candidate.dataset.calendarDate ?? "") < selectedKey
            && !candidate.disabled,
        );
        if (!(outsideButton instanceof HTMLButtonElement) || outsideButton.disabled) {
          return false;
        }
        outsideButton.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".qp-calendar-popover")
        && document.querySelector(".destination-detail-date-trigger")
          ?.textContent?.trim() !== "今天"`,
      45_000,
      "select a detail date outside the initial seven-day range",
    );

    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const close = document.querySelector(
          '.destination-detail-dialog [aria-label="关闭详情"]',
        );
        if (!(close instanceof HTMLButtonElement)) return false;
        close.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".destination-detail-dialog")`,
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const list = document.querySelector('[aria-label="应用列表"]');
          return {
            backgroundRange: document.querySelector(
              ".data-app-panel > .data-app-panel-header .data-trend-range-trigger",
            )?.textContent?.trim() ?? "",
            focusedKey: document.activeElement?.getAttribute("data-destination-key") ?? null,
            scrollTop: list instanceof HTMLElement ? list.scrollTop : -1,
            selectedKeys: Array.from(document.querySelectorAll(
              '[aria-label="应用列表"] button[aria-pressed="true"]',
            )).map((button) => button.getAttribute("data-destination-key")),
          };
        })()
      `),
      {
        backgroundRange: openingState.backgroundRange,
        focusedKey: openingState.targetKey,
        scrollTop: openingState.listScrollTop,
        selectedKeys: openingState.selectedKeys,
      },
    );

    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const icon = document.querySelector(".data-app-selected-icon");
        if (!(icon instanceof HTMLButtonElement)) return false;
        icon.focus();
        icon.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-zoom-hours") === "2"`,
      45_000,
      "detail timeline restores the persisted zoom after reopening",
    );
    await evaluate(
      client!,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".destination-detail-dialog")`,
    );
    await evaluate(
      client!,
      sessionId,
      `localStorage.removeItem("patina:destination-detail-timeline-zoom-hours:v1"); localStorage.removeItem("patina:data-destination-detail-timeline-zoom-hours:v1")`,
    );

    await evaluate(
      client!,
      sessionId,
      `globalThis.__TIME_TRACKER_ENABLE_DATA_WEB_DETAIL_FIXTURE = true`,
    );
    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "网页")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="网页列表"] button').length >= 1`,
      45_000,
      "web detail candidates",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const target = document.querySelector('[aria-label="网页列表"] button');
        if (!(target instanceof HTMLButtonElement)) return false;
        target.focus();
        const trigger = target.querySelector("[data-destination-detail-trigger]");
        if (!(trigger instanceof HTMLElement)) return false;
        trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 2 }));
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
        trigger.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-dialog"))
        && !document.querySelector(
          ".destination-detail-dialog .qp-dialog-description",
        )`,
      45_000,
      "web detail dialog",
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-timeline-track"))
        && Boolean(document.querySelector(
          ".destination-detail-activity-disclosure",
        ))`,
      45_000,
      "web detail day",
    );
    const webTitlePopoverContract = JSON.parse(String(await evaluate(
      client!,
      sessionId,
      `
        (() => {
          const trigger = document.querySelector(
            ".destination-detail-activity-disclosure",
          );
          const row = trigger?.closest(".destination-detail-activity");
          if (!(trigger instanceof HTMLButtonElement)) return null;
          if (!(row instanceof HTMLElement)) return null;
          const rowHeight = row.getBoundingClientRect().height;
          trigger.click();
          return JSON.stringify({ rowHeight });
        })()
      `,
    ))) as { rowHeight: number };
    assert.ok(webTitlePopoverContract);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(
        ".destination-detail-record-popover "
          + ".destination-detail-popover-item",
      ))`,
      45_000,
      "web title details popover",
    );
    const webTitlePopoverPresentation = JSON.parse(String(await evaluate(
      client!,
      sessionId,
      `
        (() => {
          const popover = document.querySelector(
            ".destination-detail-record-popover",
          );
          const item = popover?.querySelector(
            ".destination-detail-popover-item",
          );
          const copy = item?.querySelector(
            ".destination-detail-popover-copy",
          );
          const title = copy?.querySelector("strong");
          const url = copy?.querySelector("span");
          const trigger = document.querySelector(
            ".destination-detail-activity-disclosure[aria-expanded='true']",
          );
          const row = trigger?.closest(".destination-detail-activity");
          if (!(popover instanceof HTMLElement)) return null;
          if (!(item instanceof HTMLElement)) return null;
          if (!(title instanceof HTMLElement)) return null;
          if (!(url instanceof HTMLElement)) return null;
          if (!(row instanceof HTMLElement)) return null;
          const style = getComputedStyle(popover);
          const titleRect = title.getBoundingClientRect();
          const urlRect = url.getBoundingClientRect();
          return JSON.stringify({
            title: title.textContent?.trim() ?? "",
            url: url.textContent?.trim() ?? "",
            titleAboveUrl: titleRect.bottom <= urlRect.top + 1,
            width: popover.getBoundingClientRect().width,
            rowHeight: row.getBoundingClientRect().height,
            position: style.position,
            parentIsBody: popover.parentElement === document.body,
          });
        })()
      `,
    ))) as {
      title: string;
      url: string;
      titleAboveUrl: boolean;
      width: number;
      rowHeight: number;
      position: string;
      parentIsBody: boolean;
    };
    assert.ok(webTitlePopoverPresentation);
    assert.ok(webTitlePopoverPresentation.title.length > 0);
    assert.ok(webTitlePopoverPresentation.url.length > 0);
    assert.equal(webTitlePopoverPresentation.titleAboveUrl, true);
    assert.ok(Math.abs(webTitlePopoverPresentation.width - 284) < 1);
    assert.ok(
      Math.abs(
        webTitlePopoverPresentation.rowHeight
          - webTitlePopoverContract.rowHeight,
      ) < 1,
    );
    assert.equal(webTitlePopoverPresentation.position, "fixed");
    assert.equal(webTitlePopoverPresentation.parentIsBody, true);
    await evaluate(
      client!,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".destination-detail-record-popover")
        && Boolean(document.querySelector(".destination-detail-dialog"))`,
      45_000,
      "close web title details popover",
    );
    await evaluate(
      client!,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".destination-detail-dialog")`,
    );
    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "应用趋势"`,
      45_000,
      "restore app destination mode",
    );
    await evaluate(
      client!,
      sessionId,
      `delete globalThis.__TIME_TRACKER_ENABLE_DATA_WEB_DETAIL_FIXTURE`,
    );
  });

  await runTest("data web trend failures preserve trustworthy content and remain retryable", async () => {
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="数据"]'))`,
      45_000,
    );
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 0;
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = true;
        globalThis.__PATINA_INVOKED_COMMANDS = [];
        document.querySelector('[aria-label="数据"]')?.click();
      })()
    `);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-app-panel"))`);
    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "网页")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-web-error")?.textContent?.includes("网页分析暂时不可用")`,
      45_000,
      "blocking web trend error",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `Boolean(document.querySelector(".data-web-error button"))`,
      ),
      true,
    );
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = false;
        document.querySelector(".data-web-error button")?.click();
      })()
    `);
    try {
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector('[aria-label="网页列表"]')?.textContent?.includes("docs.example.com")`,
        45_000,
        "web trend retry success",
      );
    } catch (error) {
      const retryState = await evaluate(client!, sessionId, `JSON.stringify({
        failure: globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE,
        commands: globalThis.__PATINA_INVOKED_COMMANDS,
        panelText: document.querySelector(".data-app-panel")?.textContent ?? null,
      })`);
      throw new Error(`Web trend retry state: ${String(retryState)}`, { cause: error });
    }
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="网页列表"]'))
        && Boolean(document.querySelector(".data-app-chart"))
        && document.querySelectorAll(".data-app-metric").length === 4
        && document.querySelector(".data-app-grid")?.getAttribute("aria-busy") === "false"`,
      45_000,
      "web trend retry presentation commit",
    );

    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = true;
        const next = document.querySelector(
          ".data-app-panel .data-trend-range-control .qp-range-control-arrow:last-child",
        );
        next?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel")?.textContent?.includes("更新失败，显示上次结果")`,
      45_000,
      "non-blocking web trend refresh error",
    );
    assert.deepEqual(
      JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify({
          hasList: Boolean(document.querySelector('[aria-label="网页列表"]')),
          hasChart: Boolean(document.querySelector(".data-app-chart")),
          hasMetrics: document.querySelectorAll(".data-app-metric").length === 4,
          busy: document.querySelector(".data-app-grid")?.getAttribute("aria-busy"),
        })
      `))),
      {
        hasList: true,
        hasChart: true,
        hasMetrics: true,
        busy: "false",
      },
    );
    const webCommandsBeforeRefreshRetry = Number(await evaluate(
      client!,
      sessionId,
      `globalThis.__PATINA_INVOKED_COMMANDS
        .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length`,
    ));
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = false;
        const retry = Array.from(document.querySelectorAll(".data-app-refresh-status button"))
          .find((node) => node.textContent?.trim() === "重试");
        if (!(retry instanceof HTMLButtonElement)) return false;
        retry.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `globalThis.__PATINA_INVOKED_COMMANDS
        .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length
        > ${webCommandsBeforeRefreshRetry}`,
      45_000,
      "web trend refresh retry request",
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".data-app-panel")?.textContent?.includes("更新失败，显示上次结果")
        && document.querySelector(".data-app-grid")?.getAttribute("aria-busy") === "false"`,
      45_000,
      "web trend refresh retry success",
    );
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 0;
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = false;
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "应用趋势"`,
    );
  });

  await runTest("data removes every web control and web read when Web Sync is disabled", async () => {
    await evaluate(client!, sessionId, `
      (() => {
        const key = "__time_tracker_smoke_settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        settings.web_activity_enabled = "0";
        localStorage.setItem(key, JSON.stringify(settings));
        globalThis.__PATINA_INVOKED_COMMANDS = [];
        globalThis.__PATINA_RELOAD_MARKER = true;
      })()
    `);
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `!globalThis.__PATINA_RELOAD_MARKER && Boolean(document.querySelector('[aria-label="数据"]'))`,
      45_000,
    );
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="数据"]')?.click()`);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-app-panel"))`, 45_000);
    const webSyncDisabledState = JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify({
          modeControl: Boolean(document.querySelector('[aria-label="选择时间去向类型"]')),
          webText: document.querySelector(".data-app-panel")?.textContent?.includes("网页趋势") ?? false,
          headingOrder: Array.from(
            document.querySelector(".data-app-panel-heading")?.children ?? [],
          ).map((node) => (
            node.tagName === "H3"
              ? "title"
              : node.classList.contains("data-app-selected-status")
                ? "selected"
                : node.classList.contains("data-app-refresh-status")
                  ? "status"
                  : "unknown"
          )),
          webCommandCount: globalThis.__PATINA_INVOKED_COMMANDS
            .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length,
        })
      `))) as {
        modeControl: boolean;
        webText: boolean;
        headingOrder: string[];
        webCommandCount: number;
      };
    assert.equal(webSyncDisabledState.modeControl, false);
    assert.equal(webSyncDisabledState.webText, false);
    assert.equal(webSyncDisabledState.webCommandCount, 0);
    assert.ok(
      JSON.stringify(webSyncDisabledState.headingOrder) === JSON.stringify(["title"])
        || JSON.stringify(webSyncDisabledState.headingOrder) === JSON.stringify(["title", "selected"]),
      "selected icons must immediately follow the title when present, without a hidden placeholder",
    );

    await evaluate(client!, sessionId, `
      (() => {
        const key = "__time_tracker_smoke_settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        settings.web_activity_enabled = "1";
        localStorage.setItem(key, JSON.stringify(settings));
        globalThis.__PATINA_RELOAD_MARKER = true;
      })()
    `);
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `!globalThis.__PATINA_RELOAD_MARKER && Boolean(document.querySelector('[aria-label="数据"]'))`,
      45_000,
    );
  });

  await runTest("data combines activity trend and annual heatmap without coupling their controls", async () => {
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="数据"]')?.click()`);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-dashboard-grid"))`, 45_000);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-heatmap-panel-compact"))`, 45_000);
    const layouts: Array<{
      width: number;
      pageOverflows: boolean;
      firstTop: number;
      firstLeft: number;
      secondTop: number;
      secondLeft: number;
      directChildren: number;
      panelOrder: string[];
      overviewSectionOrder: string[];
      heatmapTop: number;
      trendTop: number;
      heatmapHasOwnRange: boolean;
      trendHasOwnRange: boolean;
      overviewHeatmapHasSubtitle: boolean;
      destinationSidebarLeft: number;
      destinationSidebarTop: number;
      destinationSidebarBottom: number;
      destinationListBottom: number;
      destinationAnalysisLeft: number;
      destinationAnalysisTop: number;
      destinationChartBottom: number;
      destinationHeatmapTop: number;
      destinationHeatmapCells: number;
    }> = [];
    for (const width of [2048, 1366, 900, 390]) {
      await client!.command("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
      await waitForExpression(client!, sessionId, `window.innerWidth === ${width}`);
      await waitForAnimationFrames(client!, sessionId);
      await waitForExpression(
        client!,
        sessionId,
        `
          (() => {
            const sidebar = document
              .querySelector(".data-app-panel .data-app-sidebar")
              ?.getBoundingClientRect();
            const list = document
              .querySelector(".data-app-panel .data-app-trend-list")
              ?.getBoundingClientRect();
            return Boolean(
              sidebar
              && list
              && Math.abs(sidebar.bottom - list.bottom - 24) <= 1
            );
          })()
        `,
        45_000,
        `data destination sidebar final geometry at ${width}px`,
      );
      layouts.push(JSON.parse(String(await evaluate(client!, sessionId, `
        (() => {
          const grid = document.querySelector(".data-dashboard-grid");
          const children = grid ? Array.from(grid.children) : [];
          const first = children[0]?.getBoundingClientRect();
          const second = children[1]?.getBoundingClientRect();
          const overview = grid?.querySelector(".data-overview");
          const overviewSections = overview ? Array.from(overview.children) : [];
          const trend = overview?.querySelector(".data-trend-panel");
          const heatmap = overview?.querySelector(".data-heatmap-panel");
          const destinationSidebar = grid?.querySelector(".data-app-panel .data-app-sidebar")?.getBoundingClientRect();
          const destinationList = grid?.querySelector(".data-app-panel .data-app-trend-list")?.getBoundingClientRect();
          const destinationAnalysis = grid?.querySelector(".data-app-panel .data-app-chart-column")?.getBoundingClientRect();
          const destinationChart = grid?.querySelector(".data-app-panel .data-app-chart")?.getBoundingClientRect();
          const destinationHeatmap = grid?.querySelector(".data-app-panel .data-heatmap-panel-compact");
          return JSON.stringify({
            width: window.innerWidth,
            pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            firstTop: first?.top ?? -1,
            firstLeft: first?.left ?? -1,
            secondTop: second?.top ?? -1,
            secondLeft: second?.left ?? -1,
            directChildren: children.length,
            panelOrder: children.map((node) => (
              node.classList.contains("data-overview")
                ? "overview"
                : node.classList.contains("data-app-panel")
                  ? "destination"
                  : "unknown"
            )),
            overviewSectionOrder: overviewSections.map((node) => (
              node.classList.contains("data-trend-panel")
                ? "trend"
                : node.classList.contains("data-heatmap-panel")
                  ? "heatmap"
                  : "unknown"
            )),
            trendTop: trend?.getBoundingClientRect().top ?? -1,
            heatmapTop: heatmap?.getBoundingClientRect().top ?? -1,
            trendHasOwnRange: Boolean(trend?.querySelector(".data-trend-range-trigger")),
            heatmapHasOwnRange: Boolean(heatmap?.querySelector(".data-heatmap-range-control")),
            overviewHeatmapHasSubtitle: Boolean(heatmap?.querySelector("p")),
            destinationSidebarLeft: destinationSidebar?.left ?? -1,
            destinationSidebarTop: destinationSidebar?.top ?? -1,
            destinationSidebarBottom: destinationSidebar?.bottom ?? -1,
            destinationListBottom: destinationList?.bottom ?? -1,
            destinationAnalysisLeft: destinationAnalysis?.left ?? -1,
            destinationAnalysisTop: destinationAnalysis?.top ?? -1,
            destinationChartBottom: destinationChart?.bottom ?? -1,
            destinationHeatmapTop: destinationHeatmap?.getBoundingClientRect().top ?? -1,
            destinationHeatmapCells: destinationHeatmap?.querySelectorAll(".data-heatmap-cell").length ?? 0,
          });
        })()
      `))));
    }

    assert.deepEqual(layouts.map((layout) => layout.directChildren), [2, 2, 2, 2]);
    assert.deepEqual(
      layouts.map((layout) => layout.panelOrder),
      Array.from({ length: 4 }, () => ["overview", "destination"]),
    );
    assert.deepEqual(
      layouts.map((layout) => layout.overviewSectionOrder),
      Array.from({ length: 4 }, () => ["trend", "heatmap"]),
    );
    assert.ok(layouts.every((layout) => layout.trendHasOwnRange));
    assert.ok(layouts.every((layout) => layout.heatmapHasOwnRange));
    assert.ok(layouts.every((layout) => !layout.overviewHeatmapHasSubtitle));
    assert.ok(layouts.every((layout) => layout.destinationHeatmapCells > 0));
    assert.ok(layouts.every((layout) => layout.destinationHeatmapTop > layout.destinationChartBottom));
    const destinationSidebarGaps = layouts.map((layout) => ({
      width: layout.width,
      gap: layout.destinationSidebarBottom - layout.destinationListBottom,
    }));
    assert.ok(layouts.every((layout) => (
      Math.abs(layout.destinationSidebarBottom - layout.destinationListBottom - 24) <= 1
    )), `destination sidebar footer gap must be 24px; observed ${JSON.stringify(destinationSidebarGaps)}`);
    assert.deepEqual(layouts.map((layout) => layout.pageOverflows), [false, false, false, false]);
    assert.ok(Math.abs(layouts[0].firstTop - layouts[0].secondTop) <= 1);
    assert.ok(layouts[0].secondLeft > layouts[0].firstLeft);
    assert.ok(layouts[0].heatmapTop > layouts[0].trendTop);
    for (const layout of layouts.slice(0, 2)) {
      assert.ok(layout.destinationAnalysisLeft > layout.destinationSidebarLeft);
      assert.ok(Math.abs(layout.destinationAnalysisTop - layout.destinationSidebarTop) <= 1);
    }
    for (const layout of layouts.slice(1)) {
      assert.ok(layout.secondTop > layout.firstTop);
      assert.ok(Math.abs(layout.secondLeft - layout.firstLeft) <= 1);
      assert.ok(layout.heatmapTop > layout.trendTop);
    }
    for (const layout of layouts.slice(2)) {
      assert.ok(layout.destinationAnalysisTop > layout.destinationSidebarTop);
      assert.ok(Math.abs(layout.destinationAnalysisLeft - layout.destinationSidebarLeft) <= 1);
    }
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
  });

  await runTest("data web analysis stays readable in English dark mode and restores locale state", async () => {
    await evaluate(client!, sessionId, `
      (() => {
        const key = "__time_tracker_smoke_settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        settings.language = "en-US";
        settings.theme_mode = "dark";
        settings.web_activity_enabled = "1";
        localStorage.setItem(key, JSON.stringify(settings));
        globalThis.__PATINA_RELOAD_MARKER = true;
      })()
    `);
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `!globalThis.__PATINA_RELOAD_MARKER && Boolean(document.querySelector('[aria-label="Data"]'))`,
      45_000,
    );
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 900,
      deviceScaleFactor: 1.5,
      mobile: false,
    }, sessionId);
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="Data"]')?.click()`);
    await waitForExpression(client!, sessionId, `document.body.innerText.includes("Browse long-term trends")`);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="Select time destination type"]'))`,
      45_000,
      "destination panel is ready before switching to web mode",
    );
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll('[aria-label="Select time destination type"] button'))
        .find((node) => node.textContent?.trim() === "Web")?.click()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "Web Trends"`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="Website list"]'))`,
    );
    assert.deepEqual(
      JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify({
          theme: document.documentElement.dataset.theme,
          overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          hasScope: Boolean(document.querySelector('[aria-label="Select heatmap item"]')),
          hasWebsiteList: Boolean(document.querySelector('[aria-label="Website list"]')),
        })
      `))),
      {
        theme: "dark",
        overflows: false,
        hasScope: false,
        hasWebsiteList: true,
      },
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const target = document.querySelector('[aria-label="Website list"] button');
        if (!(target instanceof HTMLButtonElement)) return false;
        target.focus();
        target.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-timeline-track"))`,
      45_000,
      "English dark detail dialog",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const surface = document.querySelector(".destination-detail-dialog");
          if (!surface) return null;
          const rect = surface.getBoundingClientRect();
          return {
            theme: document.documentElement.dataset.theme,
            horizontalOverflow: surface.scrollWidth > surface.clientWidth,
            insideViewport: rect.left >= 0 && rect.right <= innerWidth,
            hasHeatmap: Boolean(surface.querySelector(".data-heatmap-panel")),
            hasTrend: Boolean(surface.querySelector(".destination-detail-chart")),
            hasSummary: Boolean(surface.querySelector(
              ".destination-detail-summary",
            )),
            hasDescription: Boolean(surface.querySelector(".qp-dialog-description")),
          };
        })()
      `),
      {
        theme: "dark",
        horizontalOverflow: false,
        insideViewport: true,
        hasHeatmap: false,
        hasTrend: false,
        hasSummary: false,
        hasDescription: false,
      },
      "the detail pilot should stay readable in English dark mode at 150% DPR",
    );
    await evaluate(
      client!,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".destination-detail-dialog")`,
    );

    await evaluate(client!, sessionId, `
      (() => {
        const key = "__time_tracker_smoke_settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        settings.language = "zh-CN";
        settings.theme_mode = "light";
        localStorage.setItem(key, JSON.stringify(settings));
        globalThis.__PATINA_RELOAD_MARKER = true;
      })()
    `);
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `!globalThis.__PATINA_RELOAD_MARKER && Boolean(document.querySelector('[aria-label="数据"]'))`,
      45_000,
    );
  });

  if (options.continuityOnly) return;

  await runTest("data trend chart renders the shared tooltip on real hover", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
          if (!node) return false;
          node.click();
          window.scrollTo(0, 0);
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".data-trend-chart .qp-native-trend-dot"))`,
      45_000,
      "data trend chart point",
    );
    const chartPoint = await evaluate(client!, sessionId, `
      (() => {
        const dots = Array.from(document.querySelectorAll(".data-trend-chart .qp-native-trend-dot"));
        const dot = dots.find((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
        });
        if (!dot) return null;
        const rect = dot.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()
    `) as { x: number; y: number } | null;
    assert.ok(chartPoint);
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: chartPoint.x,
      y: chartPoint.y,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        if (document.querySelector('.qp-chart-tooltip[role="tooltip"]')) return true;
        const dot = Array.from(document.querySelectorAll(".data-trend-chart .qp-native-trend-dot")).find((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
        });
        if (!dot) return false;
        const rect = dot.getBoundingClientRect();
        dot.dispatchEvent(new MouseEvent("mousemove", {
          bubbles: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
        return false;
      })()`,
      undefined,
      "shared chart tooltip",
    );
    const tooltipState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const tooltip = document.querySelector('.qp-chart-tooltip[role="tooltip"]');
        const label = tooltip?.querySelector('.qp-chart-tooltip-label');
        const name = tooltip?.querySelector('.qp-chart-tooltip-name');
        if (!(tooltip instanceof HTMLElement)) return JSON.stringify(null);
        const rect = tooltip.getBoundingClientRect();
        const style = getComputedStyle(tooltip);
        return JSON.stringify({
          text: tooltip.textContent?.trim() ?? "",
          borderRadius: style.borderRadius,
          left: rect.left,
          maxWidth: style.maxWidth,
          right: rect.right,
          withinViewport: rect.left >= -0.5
            && rect.top >= -0.5
            && rect.right <= window.innerWidth + 0.5
            && rect.bottom <= window.innerHeight + 0.5,
          labelOverflow: label ? getComputedStyle(label).textOverflow : null,
          nameOverflow: name ? getComputedStyle(name).textOverflow : null,
        });
      })()
    `))) as {
      text: string;
      borderRadius: string;
      left: number;
      maxWidth: string;
      right: number;
      withinViewport: boolean;
      labelOverflow: string | null;
      nameOverflow: string | null;
    } | null;
    assert.ok(tooltipState?.text);
    assert.equal(tooltipState.borderRadius, "10px");
    assert.notEqual(tooltipState.maxWidth, "none");
    assert.equal(tooltipState.withinViewport, true);
    assert.equal(
      tooltipState.left >= chartPoint.x + 8 || tooltipState.right <= chartPoint.x - 8,
      true,
      "trend tooltip should stay beside the active point instead of covering it",
    );
    assert.equal(tooltipState.labelOverflow, "ellipsis");
    assert.equal(tooltipState.nameOverflow, "ellipsis");
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 1,
      y: 1,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('.qp-chart-tooltip[role="tooltip"]').length === 0`,
    );
  });

  await runTest("data heatmap shows one delegated tooltip on hover", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    const openedData = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(openedData, true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    const yesterdayKey = await evaluate(client!, sessionId, `
      (() => {
        const date = new Date();
        date.setDate(date.getDate() - 1);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day;
      })()
    `) as string;
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + '][data-heatmap-tooltip]'))`,
      45_000,
    );
    const tooltipTarget = await evaluate(client!, sessionId, `
      (() => {
        const cell = document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + '][data-heatmap-tooltip]');
        if (!cell) return null;
        const label = cell.getAttribute("data-heatmap-tooltip") ?? "";
        const rect = cell.getBoundingClientRect();
        return { label, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()
    `) as { label: string; x: number; y: number } | null;
    assert.ok(tooltipTarget?.label);
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: tooltipTarget.x,
      y: tooltipTarget.y,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        const tooltips = document.querySelectorAll('.qp-tooltip[role="tooltip"]');
        if (tooltips.length === 1 && tooltips[0]?.textContent === ${jsonString(tooltipTarget.label)}) {
          return true;
        }
        const cell = document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + '][data-heatmap-tooltip]');
        cell?.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          cancelable: true,
          pointerType: "mouse",
        }));
        return false;
      })()`,
    );
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 1,
      y: 1,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('.qp-tooltip[role="tooltip"]').length === 0`,
    );
  });

  await runTest("data heatmap exposes one keyboard grid entry and opens the focused day", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
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
    const dates = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const key = (delta) => {
          const date = new Date();
          date.setDate(date.getDate() + delta);
          return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
          ].join("-");
        };
        return JSON.stringify({ start: key(-8), expected: key(-1) });
      })()
    `))) as { start: string; expected: string };
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[data-heatmap-date=' + ${jsonString(JSON.stringify(dates.start))} + ']'))`,
      45_000,
    );
    const entryState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const grid = document.querySelector('.data-heatmap-weeks[role="grid"]');
        const start = document.querySelector('[data-heatmap-date=' + ${jsonString(JSON.stringify(dates.start))} + ']');
        if (!(grid instanceof HTMLElement) || !(start instanceof HTMLElement)) return JSON.stringify(null);
        start.focus();
        return JSON.stringify({
          rowCount: grid.querySelectorAll(':scope > [role="row"]').length,
          tabStopCount: grid.querySelectorAll('[data-heatmap-date][tabindex="0"]').length,
          activeDate: document.activeElement?.getAttribute('data-heatmap-date') ?? null,
          accessibleLabel: start.getAttribute('aria-label'),
          keyShortcuts: start.getAttribute('aria-keyshortcuts'),
        });
      })()
    `))) as {
      rowCount: number;
      tabStopCount: number;
      activeDate: string | null;
      accessibleLabel: string | null;
      keyShortcuts: string | null;
    };
    assert.equal(entryState.rowCount, 7);
    assert.equal(entryState.tabStopCount, 1);
    assert.equal(entryState.activeDate, dates.start);
    assert.equal(entryState.keyShortcuts, "Enter Space");
    assert.ok(entryState.accessibleLabel?.includes(dates.start));
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('.qp-tooltip[role="tooltip"]').length === 1`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const active = document.activeElement;
          if (!(active instanceof HTMLElement)) return false;
          active.dispatchEvent(new KeyboardEvent("keydown", {
            key: "ArrowRight",
            bubbles: true,
            cancelable: true,
          }));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.getAttribute('data-heatmap-date') === ${jsonString(dates.expected)}`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelectorAll('.data-overview .data-heatmap-weeks [data-heatmap-date][tabindex="0"]').length`,
      ),
      1,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    }, sessionId);
    assert.equal(
      await evaluate(client!, sessionId, `document.activeElement?.classList.contains("data-heatmap-cell") ?? false`),
      false,
      "Tab should leave the composite heatmap",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('.qp-tooltip[role="tooltip"]').length === 0`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const cell = document.querySelector('[data-heatmap-date=' + ${jsonString(JSON.stringify(dates.expected))} + ']');
          if (!(cell instanceof HTMLElement)) return false;
          cell.focus();
          cell.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }));
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
  });

  await runTest("data heatmap opens the selected day in history", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    const openedData = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(openedData, true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    const yesterdayKey = await evaluate(client!, sessionId, `
      (() => {
        const date = new Date();
        date.setDate(date.getDate() - 1);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day;
      })()
    `) as string;
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + ']'))`,
      45_000,
    );
    const openedHistory = await evaluate(client!, sessionId, `
      (() => {
        const cell = document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + ']');
        if (!cell) return false;
        cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
        return true;
      })()
    `);
    assert.equal(openedHistory, true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(COPY["zh-CN"].date.yesterday)})`,
    );
  });
}
