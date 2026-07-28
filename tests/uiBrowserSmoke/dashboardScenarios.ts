import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";

export async function runDashboardScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("dashboard viewport has no horizontal overflow", async () => {
    for (const width of [900, 1100, 1280]) {
      await client!.command("Emulation.setDeviceMetricsOverride", {
        width,
        height: 820,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
      const clicked = await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `);
      assert.equal(clicked, true);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".dashboard-pulse-card"))`);
      await waitForExpression(client!, sessionId, `
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      `);
    }
  });

  await runTest("dashboard focus donut keeps a restrained ring weight", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const ring = document.querySelector(
            '.dashboard-focus-chart svg[aria-label="专注分布"] circle',
          );
          if (!(ring instanceof SVGCircleElement)) return false;
          const radius = Number(ring.getAttribute("r"));
          const strokeWidth = Number(ring.getAttribute("stroke-width"));
          const innerRadius = radius - strokeWidth / 2;
          return strokeWidth === 16 && innerRadius >= radius * 0.8;
        })()
      `),
      true,
      "focus donut should keep a generous center opening",
    );
  });

  await runTest("dashboard hourly chart toggles category layers", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const card = document.querySelector(".dashboard-pulse-card");
          const icon = document.querySelector(".dashboard-pulse-mode-toggle svg");
          if (!card || !icon) return false;
          const cardRect = card.getBoundingClientRect();
          const iconRect = icon.getBoundingClientRect();
          const contentRight = cardRect.right - parseFloat(getComputedStyle(card).paddingRight);
          return Math.abs(contentRight - iconRect.right) <= 1;
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".dashboard-pulse-mode-toggle");
          if (!toggle || toggle.getAttribute("aria-pressed") !== "false") return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-label")`,
      ),
      "显示总活动",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-chart [data-hourly-activity-chart-mode]")
        ?.getAttribute("data-hourly-activity-chart-mode") === "category"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        Array.from(document.querySelectorAll(".dashboard-pulse-chart svg g"))
          .filter((group) => group.querySelector(".qp-hourly-chart-bar"))
          .every((group) => {
            const segments = Array.from(group.querySelectorAll(".qp-hourly-chart-bar"));
            return segments.at(-1) instanceof SVGPathElement
              && segments.slice(0, -1).every((segment) =>
                segment instanceof SVGRectElement
                && Number(segment.getAttribute("rx") ?? 0) === 0
              );
          })
      `),
      true,
      "stacked hourly bars should round only the outer top edge",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".dashboard-pulse-chart [data-hourly-activity-chart-mode]")
          ?.getAttribute("data-hourly-activity-chart-mode")`,
      ),
      "category",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".dashboard-pulse-mode-toggle");
          if (!toggle) return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "false"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-label")`,
      ),
      "按分类显示",
    );
    const barPoint = await evaluate(client!, sessionId, `
      (() => {
        const bar = Array.from(document.querySelectorAll(".dashboard-pulse-chart .qp-hourly-chart-bar"))
          .find((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        if (!bar) return null;
        const rect = bar.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height / 2, 2) };
      })()
    `) as { x: number; y: number } | null;
    assert.ok(barPoint);
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: barPoint.x,
      y: barPoint.y,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('.dashboard-pulse-chart .qp-chart-tooltip[role="tooltip"]'))`,
      undefined,
      "contained hourly chart tooltip",
    );
    const hourlyTooltipGeometry = await evaluate(client!, sessionId, `
      (() => {
        const chart = document.querySelector(".dashboard-pulse-chart [data-hourly-activity-chart-mode]");
        const tooltip = chart?.querySelector('.qp-chart-tooltip[role="tooltip"]');
        if (!(chart instanceof HTMLElement) || !(tooltip instanceof HTMLElement)) return null;
        const chartRect = chart.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const axisTop = Math.min(
          ...Array.from(chart.querySelectorAll("svg text"))
            .map((node) => node.getBoundingClientRect().top),
        );
        const barBaseline = Math.max(
          ...Array.from(chart.querySelectorAll(".qp-hourly-chart-bar"))
            .map((node) => node.getBoundingClientRect().bottom),
        );
        return {
          axisTop,
          barBaseline,
          chartBottom: chartRect.bottom,
          chartTop: chartRect.top,
          left: tooltipRect.left,
          right: tooltipRect.right,
          tooltipBottom: tooltipRect.bottom,
          tooltipTop: tooltipRect.top,
        };
      })()
    `) as {
      axisTop: number;
      barBaseline: number;
      chartBottom: number;
      chartTop: number;
      left: number;
      right: number;
      tooltipBottom: number;
      tooltipTop: number;
    } | null;
    assert.ok(hourlyTooltipGeometry);
    assert.equal(
      hourlyTooltipGeometry.left >= barPoint.x + 8
        || hourlyTooltipGeometry.right <= barPoint.x - 8,
      true,
      "hourly tooltip should stay beside the active bar instead of covering it",
    );
    assert.equal(
      hourlyTooltipGeometry.tooltipTop >= hourlyTooltipGeometry.chartTop - 0.5
        && hourlyTooltipGeometry.tooltipBottom <= hourlyTooltipGeometry.chartBottom + 0.5,
      true,
      "hourly tooltip should stay within the chart container",
    );
    assert.equal(
      hourlyTooltipGeometry.tooltipBottom <= hourlyTooltipGeometry.axisTop - 4,
      true,
      "hourly tooltip should stop above the time-axis labels",
    );
    assert.ok(
      Math.abs(hourlyTooltipGeometry.tooltipBottom - hourlyTooltipGeometry.barBaseline) <= 0.5,
      "hourly tooltip bottom should align with the bar baseline",
    );
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 1,
      y: 1,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector('.dashboard-pulse-chart .qp-chart-tooltip[role="tooltip"]')`,
    );
  });

  await runTest("dashboard hourly chart supports keyboard toggle and keeps category mode across views", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".dashboard-pulse-mode-toggle");
          if (!toggle) return false;
          toggle.focus();
          return document.activeElement === toggle;
        })()
      `),
      true,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: " ",
      code: "Space",
      text: " ",
      unmodifiedText: " ",
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: " ",
      code: "Space",
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "false"`,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
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
      `document.querySelector(".history-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
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
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
  });
}
