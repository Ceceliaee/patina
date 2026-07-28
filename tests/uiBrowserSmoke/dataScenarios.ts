import assert from "node:assert/strict";
import { COPY } from "../../src/shared/copy/index.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import {
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
          const control = document.querySelector(".data-trend-range-trigger")?.parentElement;
          const reset = control?.querySelector("button:last-of-type");
          if (!reset || reset.getAttribute("aria-label") !== "恢复近 7 天") return false;
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
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "一周"`);
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
    await waitForExpression(client!, sessionId, `/^\\d+周$/.test(document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() ?? "")`);
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
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "一月"`);
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
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "一年"`);
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

  await runTest("data web trends keep their geometry and content through slow refreshes", async () => {
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_INVOKED_COMMANDS = [];
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 800;
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = false;
        const next = document.querySelector(
          ".data-app-panel .data-trend-range-control .qp-range-control-arrow:last-child",
        );
        next?.click();
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
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel")?.textContent?.includes("更新中")`,
      45_000,
      "delayed web trend refresh status",
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
    await evaluate(client!, sessionId, `new Promise((resolve) => setTimeout(resolve, 900))`);
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
        })
      `))),
      {
        busy: "false",
        hasUpdatingStatus: false,
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
        const headerActions = document.querySelector(".data-app-header-actions");
        return JSON.stringify({
          directChildren: directPanels.length,
          headerOrder: Array.from(headerActions?.children ?? []).map((node) => (
            node.classList.contains("data-app-selected-status")
              ? "selected"
              : node.classList.contains("data-destination-mode")
                ? "mode"
                : node.classList.contains("data-trend-range-control")
                  ? "range"
                  : "unknown"
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
    assert.deepEqual(webState.headerOrder, ["selected", "mode", "range"]);
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
        && document.querySelectorAll(".data-app-chart .recharts-area-curve").length === 2
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
        && document.querySelectorAll(".data-app-chart .recharts-area-curve").length === 2
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
        && document.querySelectorAll(".data-app-chart .recharts-area-curve").length === 1`,
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
    assert.ok(pendingWebHeatmapFrames.every((sample) => !sample.loading));
    assert.ok(pendingWebHeatmapFrames.every(
      (sample) => sample.presentation === initialWebHeatmapPresentation,
    ));
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="网页列表"] button[aria-pressed="true"]').length === 2
        && document.querySelectorAll(".data-app-selected-icon").length === 2
        && document.querySelectorAll(".data-app-chart .recharts-area-curve").length === 2`,
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
        && document.querySelectorAll(".data-app-chart .recharts-area-curve").length === 2
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
        && document.querySelectorAll(".data-app-chart .recharts-area-curve").length === 2`,
      45_000,
      "app selection survives Data page navigation",
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
    assert.deepEqual(
      JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify({
          modeControl: Boolean(document.querySelector('[aria-label="选择时间去向类型"]')),
          webText: document.querySelector(".data-app-panel")?.textContent?.includes("网页趋势") ?? false,
          webCommandCount: globalThis.__PATINA_INVOKED_COMMANDS
            .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length,
        })
      `))),
      {
        modeControl: false,
        webText: false,
        webCommandCount: 0,
      },
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
    assert.ok(layouts.every((layout) => layout.destinationHeatmapCells > 0));
    assert.ok(layouts.every((layout) => layout.destinationHeatmapTop > layout.destinationChartBottom));
    assert.ok(layouts.every((layout) => (
      Math.abs(layout.destinationSidebarBottom - layout.destinationListBottom - 24) <= 1
    )));
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
      `Boolean(document.querySelector(".data-trend-chart .recharts-dot"))`,
      45_000,
      "data trend chart point",
    );
    const chartPoint = await evaluate(client!, sessionId, `
      (() => {
        const dots = Array.from(document.querySelectorAll(".data-trend-chart .recharts-dot"));
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
        const dot = Array.from(document.querySelectorAll(".data-trend-chart .recharts-dot")).find((node) => {
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
          maxWidth: style.maxWidth,
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
      maxWidth: string;
      withinViewport: boolean;
      labelOverflow: string | null;
      nameOverflow: string | null;
    } | null;
    assert.ok(tooltipState?.text);
    assert.equal(tooltipState.borderRadius, "10px");
    assert.notEqual(tooltipState.maxWidth, "none");
    assert.equal(tooltipState.withinViewport, true);
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
