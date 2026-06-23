import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, titleDetailsButtonExpression, waitForExpression } from "./browserHarness.ts";
import { HISTORY_TITLE_DETAIL_COUNT } from "./constants.ts";

export async function runHistoryScenarios(context: BrowserSmokeContext) {
  const { appUrl, client, sessionId, runTest } = context;

  await runTest("history hourly chart toggles category layers", async () => {
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
      `Boolean(document.querySelector(".history-pulse-mode-toggle"))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".history-horizontal-timeline"))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".history-horizontal-timeline-segment").length >= 1`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-app-distribution-card")?.textContent?.includes("当日分布")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const card = document.querySelector(".history-app-distribution-card");
          if (!card) return false;
          const buttons = Array.from(card.querySelectorAll(".history-day-distribution-mode-switch button"));
          const appButton = buttons.find((button) => button.textContent?.trim() === "应用");
          const categoryButton = buttons.find((button) => button.textContent?.trim() === "分类");
          return Boolean(
            appButton
            && categoryButton
            && appButton.getAttribute("aria-pressed") === "true"
            && categoryButton.getAttribute("aria-pressed") === "false"
            && card.textContent?.includes("Extremely Long Research Workbench Application Name")
          );
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const categoryButton = Array.from(document.querySelectorAll(".history-app-distribution-card .history-day-distribution-mode-switch button"))
            .find((button) => button.textContent?.trim() === "分类");
          if (!categoryButton) return false;
          categoryButton.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Array.from(document.querySelectorAll(".history-app-distribution-card .history-day-distribution-mode-switch button"))
        .some((button) => button.textContent?.trim() === "分类" && button.getAttribute("aria-pressed") === "true")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const card = document.querySelector(".history-app-distribution-card");
          return Boolean(card?.textContent?.includes("办公") && card.textContent?.includes("开发"));
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const appButton = Array.from(document.querySelectorAll(".history-app-distribution-card .history-day-distribution-mode-switch button"))
            .find((button) => button.textContent?.trim() === "应用");
          if (!appButton) return false;
          appButton.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Array.from(document.querySelectorAll(".history-app-distribution-card .history-day-distribution-mode-switch button"))
        .some((button) => button.textContent?.trim() === "应用" && button.getAttribute("aria-pressed") === "true")`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".history-horizontal-timeline")?.getAttribute("data-history-timeline-mode")`,
      ),
      "app",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const card = document.querySelector(".history-pulse-card");
          const icon = document.querySelector(".history-pulse-mode-toggle svg");
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
          const toggle = document.querySelector(".history-pulse-mode-toggle");
          if (!toggle || toggle.getAttribute("aria-pressed") !== "true") return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-pulse-mode-toggle")?.getAttribute("aria-pressed") === "false"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".history-horizontal-timeline")?.getAttribute("data-history-timeline-mode")`,
      ),
      "app",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".history-pulse-mode-toggle")?.getAttribute("aria-label")`,
      ),
      "按分类显示",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const segment = document.querySelector(".history-horizontal-timeline-segment");
          if (!segment) return false;
          segment.focus();
          return document.activeElement === segment;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.history-horizontal-timeline-tooltip'))");
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const tooltip = document.querySelector(".history-horizontal-timeline-tooltip");
          return Boolean(tooltip?.textContent?.includes(" - "));
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const segment = document.querySelector(".history-horizontal-timeline-segment");
          if (!segment) return false;
          segment.click();
          return !document.querySelector(".history-activity-popover");
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".history-pulse-mode-toggle");
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
      `document.querySelector(".history-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".history-pulse-mode-toggle")?.getAttribute("aria-label")`,
      ),
      "显示总活动",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".history-horizontal-timeline")?.getAttribute("data-history-timeline-mode")`,
      ),
      "app",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-pulse-chart [data-hourly-activity-chart-mode]")
        ?.getAttribute("data-hourly-activity-chart-mode") === "category"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".history-pulse-chart [data-hourly-activity-chart-mode]")
          ?.getAttribute("data-hourly-activity-chart-mode")`,
      ),
      "category",
    );
  });

  await runTest("history timeline opens list dialog from timeline axis", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 2048,
      height: 1152,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
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
      `Boolean(document.querySelector(".history-timeline-open"))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          window.dispatchEvent(new Event("resize"));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `(
        document.querySelector(".history-overview-timeline-card .history-horizontal-timeline-track")
          ?.getBoundingClientRect().height ?? 0
      ) >= 68`,
    );
    const wideTimelineMetrics = JSON.parse(await evaluate(client!, sessionId, `
      (() => {
        const track = document.querySelector(".history-overview-timeline-card .history-horizontal-timeline-track");
        return JSON.stringify({
          trackHeight: track?.getBoundingClientRect().height ?? 0,
          clientWidth: document.documentElement.clientWidth,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
      })()
    `));
    assert.ok(
      wideTimelineMetrics.trackHeight >= 68,
      `wide timeline track height should scale, got ${JSON.stringify(wideTimelineMetrics)}`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const header = document.querySelector(".history-horizontal-timeline-header");
          const actions = document.querySelector(".history-horizontal-timeline-actions");
          if (!header || !actions) return false;
          const headerRect = header.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          return Math.abs(headerRect.right - actionsRect.right) <= 4;
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const button = document.querySelector(".history-timeline-open");
          if (!button) return false;
          button.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".history-timeline-dialog-surface"))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dialog = document.querySelector(".history-timeline-dialog-surface");
          const dialogList = document.querySelector(".history-timeline-dialog-body .history-timeline-list");
          const dialogDurationControls = document.querySelector(".history-timeline-dialog-duration-controls");
          const compactTrack = document.querySelector(".history-overview-timeline-card .history-horizontal-timeline-track");
          return Boolean(
            dialog
            && dialog.getAttribute("role") === "dialog"
            && dialog.getAttribute("aria-label") === "时间线"
            && dialogList
            && dialogDurationControls
            && compactTrack
            && !document.querySelector(".history-timeline-dialog-body .history-horizontal-timeline-track")
            && !document.querySelector(".history-timeline-dialog-body .history-timeline-zoom-switch")
          );
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const rows = document.querySelectorAll(".history-timeline-dialog-body .history-timeline-list > div");
          return rows.length >= 1;
        })()
      `),
      true,
    );
    const openedDialogDetails = await evaluate(client!, sessionId, `
      (() => {
        const detailButton = document.querySelector(".history-timeline-dialog-body .history-timeline-list button[aria-expanded]");
        if (!detailButton) return "missing";
        detailButton.click();
        return "clicked";
      })()
    `);
    if (openedDialogDetails === "clicked") {
      await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.history-activity-popover'))");
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const popover = document.querySelector(".history-activity-popover");
            const backdrop = document.querySelector(".qp-dialog-backdrop");
            if (!popover || !backdrop) return false;
            return Number(getComputedStyle(popover).zIndex) > Number(getComputedStyle(backdrop).zIndex);
          })()
        `),
        true,
      );
    }
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const closeButton = document.querySelector(".history-timeline-dialog-surface .history-timeline-dialog-close");
          if (!closeButton) return false;
          closeButton.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".history-timeline-dialog-surface")`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".history-activity-popover")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const button = document.querySelector(".history-timeline-zoom-open");
          if (!button) return false;
          button.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".history-timeline-zoom-dialog-surface"))`,
    );
    const initialZoomDialogState = JSON.parse(await evaluate(client!, sessionId, `
      (() => {
        const dialog = document.querySelector(".history-timeline-zoom-dialog-surface");
        const timeline = document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline");
        return JSON.stringify({
          hasDialog: Boolean(
            dialog
            && dialog.getAttribute("role") === "dialog"
            && dialog.getAttribute("aria-label") === "时间轴缩放"
            && timeline
          ),
          zoomHours: timeline?.getAttribute("data-history-timeline-zoom-hours") ?? null,
          hasTrack: Boolean(document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline-track")),
          hasZoomSwitch: Boolean(document.querySelector(".history-timeline-zoom-dialog-surface .history-timeline-zoom-switch")),
          hasList: Boolean(document.querySelector(".history-timeline-zoom-dialog-surface .history-timeline-list")),
        });
      })()
    `));
    assert.equal(initialZoomDialogState.hasDialog, true);
    assert.equal(initialZoomDialogState.zoomHours, "24");
    assert.equal(initialZoomDialogState.hasTrack, true);
    assert.equal(initialZoomDialogState.hasZoomSwitch, true);
    assert.equal(initialZoomDialogState.hasList, false);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const button = Array.from(document.querySelectorAll(".history-timeline-zoom-dialog-surface .history-timeline-zoom-switch button"))
            .find((candidate) => candidate.textContent?.trim() === "4h");
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
      `document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline")
        ?.getAttribute("data-history-timeline-zoom-hours") === "4"`,
    );
    const zoomedTimelineState = JSON.parse(await evaluate(client!, sessionId, `
      (() => {
        const timeline = document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline");
        const axisLabels = Array.from(document.querySelectorAll(
          ".history-timeline-zoom-dialog-timeline .history-horizontal-timeline-axis span"
        )).map((label) => label.textContent?.trim() ?? "");
        return JSON.stringify({
          zoomHours: timeline?.getAttribute("data-history-timeline-zoom-hours") ?? null,
          windowStart: timeline?.getAttribute("data-history-timeline-window-start") ?? null,
          windowEnd: timeline?.getAttribute("data-history-timeline-window-end") ?? null,
          axisLabels,
        });
      })()
    `));
    assert.equal(zoomedTimelineState.zoomHours, "4");
    assert.equal(zoomedTimelineState.axisLabels.length, 5);
    assert.equal(
      (zoomedTimelineState.axisLabels as string[]).every((label) => (
        label === "24:00" || /:(00|30)$/.test(label)
      )),
      true,
    );
    assert.ok(zoomedTimelineState.windowStart);
    assert.ok(zoomedTimelineState.windowEnd);
    const panStartBefore = zoomedTimelineState.windowStart;
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const target = document.querySelector(".history-timeline-zoom-dialog-timeline");
          if (!target) return false;
          target.dispatchEvent(new WheelEvent("wheel", {
            deltaY: 120,
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
      `document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline")
        ?.getAttribute("data-history-timeline-window-start") !== ${jsonString(panStartBefore)}`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const closeButton = document.querySelector(".history-timeline-zoom-dialog-surface .history-timeline-dialog-close");
          if (!closeButton) return false;
          closeButton.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".history-timeline-zoom-dialog-surface")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const button = document.querySelector(".history-timeline-zoom-open");
          if (!button) return false;
          button.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline")
        ?.getAttribute("data-history-timeline-zoom-hours") === "4"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const closeButton = document.querySelector(".history-timeline-zoom-dialog-surface .history-timeline-dialog-close");
          if (!closeButton) return false;
          closeButton.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".history-timeline-zoom-dialog-surface")`,
    );
  });

  await runTest("hourly category mode survives an app reload", async () => {
    await waitForExpression(
      client!,
      sessionId,
      `JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}").hourly_activity_chart_mode === "category"`,
    );
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
  });

  await runTest("history title details stay readable at narrow and default widths", async () => {
    for (const width of [900, 1100]) {
      await client!.command("Emulation.setDeviceMetricsOverride", {
        width,
        height: 760,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
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
      await waitForExpression(
        client!,
        sessionId,
        `Boolean(document.querySelector(".history-timeline-open"))`,
      );
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const button = document.querySelector(".history-timeline-open");
            if (!button) return false;
            button.click();
            return true;
          })()
        `),
        true,
      );
      await waitForExpression(
        client!,
        sessionId,
        `Boolean(document.querySelector(".history-timeline-dialog-surface"))`,
      );
      await waitForExpression(
        client!,
        sessionId,
        titleDetailsButtonExpression("标题详情", ".history-timeline-dialog-surface"),
        45_000,
      );
      assert.equal(
        await evaluate(client!, sessionId, `
          document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
        `),
        true,
        `History viewport overflowed at ${width}px`,
      );
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const closeButton = document.querySelector(".history-timeline-dialog-surface .history-timeline-dialog-close");
            if (!closeButton) return false;
            closeButton.click();
            return true;
          })()
        `),
        true,
      );
      await waitForExpression(
        client!,
        sessionId,
        `!document.querySelector(".history-timeline-dialog-surface")`,
      );
    }

    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".history-timeline-open"))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const button = document.querySelector(".history-timeline-open");
          if (!button) return false;
          button.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".history-timeline-dialog-surface"))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      titleDetailsButtonExpression("标题详情", ".history-timeline-dialog-surface"),
      45_000,
    );
    const opened = await evaluate(client!, sessionId, `
      (() => {
        const trigger = Array.from(document.querySelectorAll('.history-timeline-dialog-surface button[aria-label]'))
          .find((node) => node.getAttribute('aria-label')?.includes('标题详情'));
        if (!trigger) return false;
        trigger.click();
        return true;
      })()
    `);
    assert.equal(opened, true);
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.history-activity-popover'))");
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const list = document.querySelector('.history-activity-popover-list');
          const popover = document.querySelector('.history-activity-popover');
          return Boolean(
            list
            && popover
            && list.children.length === ${HISTORY_TITLE_DETAIL_COUNT}
            && popover.scrollHeight > popover.clientHeight
          );
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const closeButton = document.querySelector(".history-timeline-dialog-surface .history-timeline-dialog-close");
          if (!closeButton) return false;
          closeButton.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".history-timeline-dialog-surface") && !document.querySelector(".history-activity-popover")`,
    );
  });
}
