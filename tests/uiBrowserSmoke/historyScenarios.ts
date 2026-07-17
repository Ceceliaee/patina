import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, titleDetailsButtonExpression, waitForExpression } from "./browserHarness.ts";
import { DATE_TEXT, HISTORY_TITLE_DETAIL_COUNT } from "./constants.ts";

export async function runHistoryScenarios(context: BrowserSmokeContext) {
  const { appUrl, client, sessionId, runTest } = context;

  await runTest("history date picker uses the shared calendar skeleton", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const navigation = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']');
          if (!navigation) return false;
          navigation.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".history-date-label"))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".history-date-label");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".history-calendar-popover.qp-calendar-popover"))`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.matches('.history-calendar-popover .qp-calendar-day[data-selected="true"]')`,
      undefined,
      "history calendar should focus the selected date",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const popover = document.querySelector(".history-calendar-popover");
          if (!popover) return false;
          const days = popover.querySelectorAll(".qp-calendar-day");
          const selected = popover.querySelectorAll('.qp-calendar-day[data-selected="true"]');
          const nextMonth = popover.querySelector('[aria-label=' + ${jsonString(JSON.stringify("下个月"))} + ']');
          const navigation = popover.querySelector(".qp-calendar-nav");
          const day = days[0];
          const grid = popover.querySelector(".qp-calendar-days");
          const popoverRect = popover.getBoundingClientRect();
          const navigationRect = navigation?.getBoundingClientRect();
          const dayRect = day?.getBoundingClientRect();
          const gridStyle = grid ? getComputedStyle(grid) : null;
          return Boolean(
            popover.getAttribute("role") === "dialog"
            && popover.querySelector(".qp-calendar-header")
            && popover.querySelector(".qp-calendar-weekdays")
            && days.length === 42
            && selected.length === 1
            && nextMonth?.disabled === true
            && Math.abs(popoverRect.width - 236) <= 0.5
            && Math.abs((navigationRect?.width ?? 0) - 28) <= 0.5
            && Math.abs((navigationRect?.height ?? 0) - 28) <= 0.5
            && Math.abs((dayRect?.height ?? 0) - 26) <= 0.5
            && gridStyle?.columnGap === "4px"
            && gridStyle?.rowGap === "4px"
          );
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const selected = document.querySelector('.history-calendar-popover .qp-calendar-day[data-selected="true"]');
          if (!selected) return false;
          selected.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `!document.querySelector(".history-calendar-popover")`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.classList.contains('history-date-label')`,
      undefined,
      "history calendar opener focus restoration",
    );
  });

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
    const hoverSegmentRect = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const segment = document.querySelector(".history-horizontal-timeline-segment");
        if (!segment) return JSON.stringify(null);
        const rect = segment.getBoundingClientRect();
        return JSON.stringify({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          tabIndex: segment.tabIndex,
          hasClickHandler: typeof segment.onclick === "function",
        });
      })()
    `))) as { x: number; y: number; tabIndex: number; hasClickHandler: boolean };
    assert.equal(hoverSegmentRect.tabIndex, -1);
    assert.equal(hoverSegmentRect.hasClickHandler, false);
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: hoverSegmentRect.x,
      y: hoverSegmentRect.y,
    }, sessionId);
    await waitForExpression(client!, sessionId, `
      (() => {
        const tooltip = document.querySelector('.history-horizontal-timeline-tooltip');
        if (!(tooltip instanceof HTMLElement)) return false;
        const rect = tooltip.getBoundingClientRect();
        return getComputedStyle(tooltip).visibility === "visible" && rect.width > 0 && rect.height > 0;
      })()
    `);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const tooltip = document.querySelector(".history-horizontal-timeline-tooltip");
          if (!(tooltip instanceof HTMLElement)) return false;
          const rect = tooltip.getBoundingClientRect();
          return Boolean(
            tooltip.textContent?.includes(" - ")
            && tooltip.parentElement === document.body
            && Number(getComputedStyle(tooltip).zIndex) >= 160
            && rect.top >= 0
            && rect.left >= 0
            && rect.right <= window.innerWidth
            && rect.bottom <= window.innerHeight
          );
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
    const wideTimelineMetrics = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const track = document.querySelector(".history-overview-timeline-card .history-horizontal-timeline-track");
        return JSON.stringify({
          trackHeight: track?.getBoundingClientRect().height ?? 0,
          clientWidth: document.documentElement.clientWidth,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
      })()
    `)));
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
          const dialogDateSwitch = document.querySelector(".history-timeline-dialog-date-switch");
          const compactTrack = document.querySelector(".history-overview-timeline-card .history-horizontal-timeline-track");
          return Boolean(
            dialog
            && dialog.getAttribute("role") === "dialog"
            && document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")?.textContent === "时间线"
            && dialogList
            && dialogDurationControls
            && dialogDateSwitch
            && compactTrack
            && !document.querySelector(".history-timeline-dialog-body .history-horizontal-timeline-track")
            && !document.querySelector(".history-timeline-dialog-body .history-timeline-zoom-switch")
          );
        })()
      `),
      true,
    );
    const initialDialogDateState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const previousButton = document.querySelector(".history-timeline-dialog-date-previous");
        const nextButton = document.querySelector(".history-timeline-dialog-date-next");
        return JSON.stringify({
          dialogLabel: document.querySelector(".history-timeline-dialog-date-label")?.textContent?.trim() ?? null,
          outerLabel: document.querySelector(".history-date-label")?.textContent?.trim() ?? null,
          hasPreviousButton: Boolean(previousButton),
          nextDisabled: Boolean(nextButton?.disabled),
        });
      })()
    `))) as {
      dialogLabel: string | null;
      outerLabel: string | null;
      hasPreviousButton: boolean;
      nextDisabled: boolean;
    };
    assert.deepEqual(initialDialogDateState, {
      dialogLabel: DATE_TEXT.today,
      outerLabel: DATE_TEXT.today,
      hasPreviousButton: true,
      nextDisabled: true,
    });
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const previousButton = document.querySelector(".history-timeline-dialog-date-previous");
          if (!previousButton) return false;
          previousButton.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `
        document.querySelector(".history-timeline-dialog-date-label")?.textContent?.trim() === ${jsonString(DATE_TEXT.yesterday)}
        && document.querySelector(".history-date-label")?.textContent?.trim() === ${jsonString(DATE_TEXT.yesterday)}
        && Boolean(document.querySelector(".history-timeline-dialog-surface"))
      `,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const nextButton = document.querySelector(".history-timeline-dialog-date-next");
          if (!nextButton || nextButton.disabled) return false;
          nextButton.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `
        document.querySelector(".history-timeline-dialog-date-label")?.textContent?.trim() === ${jsonString(DATE_TEXT.today)}
        && document.querySelector(".history-date-label")?.textContent?.trim() === ${jsonString(DATE_TEXT.today)}
        && document.querySelector(".history-timeline-dialog-date-next")?.disabled === true
      `,
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
    const initialZoomDialogState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const dialog = document.querySelector(".history-timeline-zoom-dialog-surface");
        const timeline = document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline");
        const laneTimeline = document.querySelector(".history-timeline-lane-track .history-horizontal-timeline");
        const laneScroll = document.querySelector(".history-timeline-lanes-scroll");
        const slider = document.querySelector('.history-timeline-hour-slider input[type="range"]');
        return JSON.stringify({
          hasDialog: Boolean(
            dialog
            && dialog.getAttribute("role") === "dialog"
            && document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")?.textContent === "时间轴缩放"
            && timeline
          ),
          viewportZoomHours: timeline?.getAttribute("data-history-timeline-zoom-hours") ?? null,
          laneZoomHours: laneTimeline?.getAttribute("data-history-timeline-zoom-hours") ?? null,
          hasTrack: Boolean(document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline-track")),
          sliderValue: slider instanceof HTMLInputElement ? slider.value : null,
          hasSelection: Boolean(document.querySelector(".history-timeline-overview-selection")),
          hasList: Boolean(document.querySelector(".history-timeline-zoom-dialog-surface .history-timeline-list")),
          laneCount: Number(document.querySelector(".history-timeline-lanes-scroll")
            ?.getAttribute("data-history-timeline-lane-count") ?? 0),
          laneRows: document.querySelectorAll(".history-timeline-lane-row").length,
          laneTracks: document.querySelectorAll(".history-timeline-lane-track .history-horizontal-timeline-track").length,
          laneAxes: document.querySelectorAll(".history-timeline-lane-track .history-horizontal-timeline-axis").length,
          laneOverflowY: getComputedStyle(
            laneScroll ?? document.body
          ).overflowY,
          laneViewportHeight: laneScroll?.clientHeight ?? 0,
          expectedLaneViewportHeight: 250,
          dialogBottomGap: dialog && laneScroll
            ? Math.round(dialog.getBoundingClientRect().bottom - laneScroll.getBoundingClientRect().bottom)
            : null,
        });
      })()
    `)));
    assert.equal(initialZoomDialogState.hasDialog, true);
    assert.equal(initialZoomDialogState.viewportZoomHours, "4");
    assert.equal(initialZoomDialogState.laneZoomHours, "4");
    assert.equal(initialZoomDialogState.hasTrack, true);
    assert.equal(initialZoomDialogState.sliderValue, "4");
    assert.equal(initialZoomDialogState.hasSelection, false);
    assert.equal(initialZoomDialogState.hasList, false);
    assert.ok(initialZoomDialogState.laneCount > 0);
    assert.equal(initialZoomDialogState.laneRows, initialZoomDialogState.laneCount);
    assert.equal(initialZoomDialogState.laneTracks, initialZoomDialogState.laneCount);
    assert.equal(initialZoomDialogState.laneAxes, 0);
    assert.equal(initialZoomDialogState.laneOverflowY, "auto");
    assert.equal(initialZoomDialogState.laneViewportHeight, initialZoomDialogState.expectedLaneViewportHeight);
    assert.ok(initialZoomDialogState.laneViewportHeight <= 250);
    assert.ok(initialZoomDialogState.dialogBottomGap >= 0 && initialZoomDialogState.dialogBottomGap <= 32);
    const laneHoverPoint = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const viewport = document.querySelector(".history-timeline-lanes-scroll")?.getBoundingClientRect();
        if (!viewport) return JSON.stringify(null);
        const segments = Array.from(document.querySelectorAll(
          ".history-timeline-lane-track .history-horizontal-timeline-segment"
        ));
        for (const segment of segments) {
          if (!(segment instanceof HTMLElement)) continue;
          const rect = segment.getBoundingClientRect();
          const left = Math.max(rect.left, viewport.left);
          const right = Math.min(rect.right, viewport.right);
          const top = Math.max(rect.top, viewport.top);
          const bottom = Math.min(rect.bottom, viewport.bottom);
          if (right - left < 1 || bottom - top < 1) continue;
          const x = left + (right - left) / 2;
          const y = top + (bottom - top) / 2;
          const hit = document.elementFromPoint(x, y);
          if (hit && segment.contains(hit)) return JSON.stringify({ x, y });
        }
        return JSON.stringify(null);
      })()
    `))) as { x: number; y: number } | null;
    assert.ok(laneHoverPoint, "expected a visible lane segment for tooltip hover");
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 1,
      y: 1,
    }, sessionId);
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: laneHoverPoint.x,
      y: laneHoverPoint.y,
    }, sessionId);
    await waitForExpression(client!, sessionId, `
      (() => {
        const tooltip = document.querySelector(".history-horizontal-timeline-tooltip");
        if (!(tooltip instanceof HTMLElement)) return false;
        const rect = tooltip.getBoundingClientRect();
        return getComputedStyle(tooltip).visibility === "visible" && rect.width > 0 && rect.height > 0;
      })()
    `);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const tooltip = document.querySelector(".history-horizontal-timeline-tooltip");
          const laneScroll = document.querySelector(".history-timeline-lanes-scroll");
          return Boolean(
            tooltip
            && laneScroll
            && tooltip.parentElement === document.body
            && !laneScroll.contains(tooltip)
          );
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const slider = document.querySelector('.history-timeline-hour-slider input[type="range"]');
          if (!(slider instanceof HTMLInputElement)) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(slider, "8");
          slider.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline")
        ?.getAttribute("data-history-timeline-zoom-hours") === "8"`,
    );
    const zoomedTimelineState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const timeline = document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline");
        const laneTimeline = document.querySelector(".history-timeline-lane-track .history-horizontal-timeline");
        return JSON.stringify({
          zoomHours: timeline?.getAttribute("data-history-timeline-zoom-hours") ?? null,
          laneZoomHours: laneTimeline?.getAttribute("data-history-timeline-zoom-hours") ?? null,
          windowStart: timeline?.getAttribute("data-history-timeline-window-start") ?? null,
          windowEnd: timeline?.getAttribute("data-history-timeline-window-end") ?? null,
        });
      })()
    `)));
    assert.equal(zoomedTimelineState.zoomHours, "8");
    assert.equal(zoomedTimelineState.laneZoomHours, "8");
    assert.ok(zoomedTimelineState.windowStart);
    assert.ok(zoomedTimelineState.windowEnd);
    const timelineInteractionRect = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const target = document.querySelector(".history-timeline-zoom-dialog-timeline");
        if (!target) return JSON.stringify(null);
        const rect = target.getBoundingClientRect();
        return JSON.stringify({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        });
      })()
    `))) as { left: number; top: number; width: number; height: number };
    assert.ok(timelineInteractionRect.width > 0);
    const zoomAnchorRatio = 0.25;
    const interactionX = timelineInteractionRect.left + timelineInteractionRect.width * zoomAnchorRatio;
    const interactionY = timelineInteractionRect.top + timelineInteractionRect.height / 2;
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: interactionX,
      y: interactionY,
      deltaX: 0,
      deltaY: -120,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline")
        ?.getAttribute("data-history-timeline-zoom-hours") !== "8"`,
    );
    const continuousZoomState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const timeline = document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline");
        const laneTimeline = document.querySelector(".history-timeline-lane-track .history-horizontal-timeline");
        const slider = document.querySelector('.history-timeline-hour-slider input[type="range"]');
        return JSON.stringify({
          zoomHours: Number(timeline?.getAttribute("data-history-timeline-zoom-hours")),
          laneZoomHours: Number(laneTimeline?.getAttribute("data-history-timeline-zoom-hours")),
          windowStart: Number(timeline?.getAttribute("data-history-timeline-window-start")),
          windowEnd: Number(timeline?.getAttribute("data-history-timeline-window-end")),
          sliderValue: slider instanceof HTMLInputElement ? Number(slider.value) : 0,
        });
      })()
    `))) as {
      zoomHours: number;
      laneZoomHours: number;
      windowStart: number;
      windowEnd: number;
      sliderValue: number;
    };
    assert.ok(Math.abs(continuousZoomState.zoomHours - 7.8) < 0.001);
    assert.ok(Math.abs(continuousZoomState.laneZoomHours - continuousZoomState.zoomHours) < 0.001);
    assert.ok(Math.abs(continuousZoomState.sliderValue - continuousZoomState.zoomHours) < 0.001);
    const anchorBefore = Number(zoomedTimelineState.windowStart)
      + (Number(zoomedTimelineState.windowEnd) - Number(zoomedTimelineState.windowStart)) * zoomAnchorRatio;
    const anchorAfter = continuousZoomState.windowStart
      + (continuousZoomState.windowEnd - continuousZoomState.windowStart) * zoomAnchorRatio;
    const anchorErrorPixels = Math.abs(anchorAfter - anchorBefore)
      / (continuousZoomState.windowEnd - continuousZoomState.windowStart)
      * timelineInteractionRect.width;
    assert.ok(anchorErrorPixels < 3);

    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: interactionX,
      y: interactionY,
      deltaX: 120,
      deltaY: 0,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `Number(document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline")
        ?.getAttribute("data-history-timeline-window-start")) > ${continuousZoomState.windowStart}`,
    );
    const wheelPanState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const timeline = document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline");
        return JSON.stringify({
          zoomHours: Number(timeline?.getAttribute("data-history-timeline-zoom-hours")),
          windowStart: Number(timeline?.getAttribute("data-history-timeline-window-start")),
          windowEnd: Number(timeline?.getAttribute("data-history-timeline-window-end")),
        });
      })()
    `))) as { zoomHours: number; windowStart: number; windowEnd: number };
    assert.ok(Math.abs(wheelPanState.zoomHours - continuousZoomState.zoomHours) < 0.001);
    assert.equal(
      wheelPanState.windowEnd - wheelPanState.windowStart,
      continuousZoomState.windowEnd - continuousZoomState.windowStart,
    );

    const dragStartPoint = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const track = document.querySelector(
          ".history-timeline-zoom-dialog-timeline .history-horizontal-timeline-track"
        );
        if (!(track instanceof HTMLElement)) return JSON.stringify(null);
        const rect = track.getBoundingClientRect();
        return JSON.stringify({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      })()
    `))) as { x: number; y: number } | null;
    assert.ok(dragStartPoint, "expected a timeline track for drag interaction");
    const dragStartX = dragStartPoint.x;
    const dragStartY = dragStartPoint.y;
    assert.ok(Number.isFinite(dragStartX));
    assert.ok(Number.isFinite(dragStartY));
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: dragStartX,
      y: dragStartY,
    }, sessionId);
    await client!.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: dragStartX,
      y: dragStartY,
      button: "left",
      clickCount: 1,
    }, sessionId);
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: dragStartX + 2,
      y: dragStartY,
      button: "left",
      buttons: 1,
    }, sessionId);
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: dragStartX + 2,
      y: dragStartY,
      button: "left",
      clickCount: 1,
    }, sessionId);
    assert.equal(
      Number(await evaluate(client!, sessionId, `document.querySelector(".history-timeline-lane-track .history-horizontal-timeline")
        ?.getAttribute("data-history-timeline-window-start")`)),
      wheelPanState.windowStart,
    );

    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: dragStartX,
      y: dragStartY,
    }, sessionId);
    await client!.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: dragStartX,
      y: dragStartY,
      button: "left",
      clickCount: 1,
    }, sessionId);
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: dragStartX + 100,
      y: dragStartY,
      button: "left",
      buttons: 1,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-timeline-zoom-dialog-timeline")
        ?.classList.contains("history-timeline-zoom-dialog-timeline-dragging") === true`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector(
        ".history-horizontal-timeline-tooltip"
      ))`),
      false,
    );
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: dragStartX + 100,
      y: dragStartY,
      button: "left",
      clickCount: 1,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `Number(document.querySelector(".history-timeline-lane-track .history-horizontal-timeline")
        ?.getAttribute("data-history-timeline-window-start")) < ${wheelPanState.windowStart}`,
    );

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const repeatedDragState = JSON.parse(String(await evaluate(client!, sessionId, `
        (() => {
          const timeline = document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline");
          const track = document.querySelector(
            ".history-timeline-zoom-dialog-timeline .history-horizontal-timeline-track"
          );
          if (!(track instanceof HTMLElement)) return JSON.stringify(null);
          const rect = track.getBoundingClientRect();
          return JSON.stringify({
            windowStart: Number(timeline?.getAttribute("data-history-timeline-window-start")),
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
        })()
      `))) as { windowStart: number; x: number; y: number } | null;
      assert.ok(repeatedDragState, "expected a timeline track for repeated drag interaction");
      const dragDeltaX = attempt % 2 === 0 ? -80 : 80;
      assert.ok(Number.isFinite(repeatedDragState.x));
      assert.ok(Number.isFinite(repeatedDragState.y));
      await client!.command("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: repeatedDragState.x,
        y: repeatedDragState.y,
      }, sessionId);
      await client!.command("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: repeatedDragState.x,
        y: repeatedDragState.y,
        button: "left",
        clickCount: 1,
      }, sessionId);
      await client!.command("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: repeatedDragState.x + dragDeltaX,
        y: repeatedDragState.y,
        button: "left",
        buttons: 1,
      }, sessionId);
      await client!.command("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: repeatedDragState.x + dragDeltaX,
        y: repeatedDragState.y,
        button: "left",
        clickCount: 1,
      }, sessionId);
      const comparison = dragDeltaX > 0 ? "<" : ">";
      await waitForExpression(
        client!,
        sessionId,
        `Number(document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline")
          ?.getAttribute("data-history-timeline-window-start")) ${comparison} ${repeatedDragState.windowStart}`,
      );
    }
    const draggedStart = Number(await evaluate(client!, sessionId, `document.querySelector(
      ".history-timeline-lane-track .history-horizontal-timeline"
    )?.getAttribute("data-history-timeline-window-start")`));
    const persistedZoomHours = Number(await evaluate(client!, sessionId, `localStorage.getItem(
      "patina:history-timeline-zoom-hours"
    )`));
    assert.ok(Math.abs(persistedZoomHours - continuousZoomState.zoomHours) < 0.001);
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
      `Math.abs(Number(document.querySelector(".history-timeline-zoom-dialog-timeline .history-horizontal-timeline")
        ?.getAttribute("data-history-timeline-zoom-hours")) - ${persistedZoomHours}) < 0.001`,
    );
    const reopenedTimelineState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const timeline = document.querySelector(".history-timeline-lane-track .history-horizontal-timeline");
        return JSON.stringify({
          zoomHours: Number(timeline?.getAttribute("data-history-timeline-zoom-hours")),
          windowStart: Number(timeline?.getAttribute("data-history-timeline-window-start")),
        });
      })()
    `))) as { zoomHours: number; windowStart: number };
    assert.equal(reopenedTimelineState.zoomHours, persistedZoomHours);
    assert.notEqual(reopenedTimelineState.windowStart, draggedStart);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const button = document.querySelector('.history-timeline-hour-slider button[aria-label="增加一小时"]');
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
        ?.getAttribute("data-history-timeline-zoom-hours") === "8"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelector('.history-timeline-hour-slider input[type="range"]')?.value`),
      "8",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const button = document.querySelector('.history-timeline-hour-slider button[aria-label="减少一小时"]');
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
        ?.getAttribute("data-history-timeline-zoom-hours") === "7"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const slider = document.querySelector('.history-timeline-hour-slider input[type="range"]');
          if (!(slider instanceof HTMLInputElement)) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(slider, "24");
          slider.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-timeline-lane-track .history-horizontal-timeline")
        ?.getAttribute("data-history-timeline-zoom-hours") === "24"`,
    );
    assert.equal(await evaluate(client!, sessionId, `document.querySelector(".history-timeline-viewport-reset")`), null);
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
      `Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']'))`,
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

  await runTest("history web distribution publishes favicon colors as one stable frame", async () => {
    const navigateTo = async (label: string) => {
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
      );
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']')?.className.includes("qp-nav-item-active")`,
      );
    };
    const startSampling = async () => {
      await evaluate(client!, sessionId, `
        (() => {
          globalThis.__TIME_TRACKER_WEB_VISUAL_FRAMES = [];
          const capture = () => {
            const card = document.querySelector(".history-app-distribution-card");
            if (!card) return;
            const rows = Array.from(card.querySelectorAll(".history-day-distribution-progress"))
              .map((progress) => {
                const row = progress.parentElement?.parentElement;
                return {
                  label: row?.querySelector("span.block.truncate")?.textContent?.trim() ?? "",
                  iconSrc: row?.querySelector("img")?.getAttribute("src") ?? null,
                  hasGlobe: Boolean(row?.querySelector("svg")),
                  color: progress instanceof HTMLElement ? progress.style.backgroundColor : "",
                };
              });
            const frames = globalThis.__TIME_TRACKER_WEB_VISUAL_FRAMES;
            const signature = JSON.stringify(rows);
            if (frames[frames.length - 1] !== signature) {
              frames.push(signature);
            }
          };
          capture();
          globalThis.__TIME_TRACKER_WEB_VISUAL_OBSERVER = new MutationObserver(capture);
          globalThis.__TIME_TRACKER_WEB_VISUAL_OBSERVER.observe(document.body, {
            attributes: true,
            childList: true,
            subtree: true,
          });
          globalThis.__TIME_TRACKER_WEB_VISUAL_TIMER = setInterval(capture, 5);
        })()
      `);
    };
    const stopSampling = async () => JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        globalThis.__TIME_TRACKER_WEB_VISUAL_OBSERVER?.disconnect();
        clearInterval(globalThis.__TIME_TRACKER_WEB_VISUAL_TIMER);
        const frames = globalThis.__TIME_TRACKER_WEB_VISUAL_FRAMES ?? [];
        delete globalThis.__TIME_TRACKER_WEB_VISUAL_OBSERVER;
        delete globalThis.__TIME_TRACKER_WEB_VISUAL_TIMER;
        delete globalThis.__TIME_TRACKER_WEB_VISUAL_FRAMES;
        return JSON.stringify(frames.map((frame) => JSON.parse(frame)));
      })()
    `))) as Array<Array<{
      label: string;
      iconSrc: string | null;
      hasGlobe: boolean;
      color: string;
    }>>;

    await navigateTo("数据");
    await evaluate(client!, sessionId, `
      (() => {
        const settings = JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}");
        settings.web_activity_enabled = "1";
        localStorage.setItem("__time_tracker_smoke_settings", JSON.stringify(settings));
        localStorage.setItem("patina:history-day-distribution-mode", "web");
        window.location.reload();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__TIME_TRACKER_ENABLE_WEB_FIXTURE = true;
        globalThis.__TIME_TRACKER_WEB_FAVICON_QUERY_DELAY_MS = 500;
        globalThis.__TIME_TRACKER_WEB_FAVICON_QUERY_COUNT = 0;
      })()
    `);
    await startSampling();
    await navigateTo("历史");
    await waitForExpression(
      client!,
      sessionId,
      `
        document.querySelectorAll(".history-app-distribution-card img").length === 2
        && document.querySelector(".history-app-distribution-card")?.textContent?.includes("stable.example")
        && document.querySelector(".history-app-distribution-card")?.textContent?.includes("docs.example")
      `,
      15_000,
      "History web visuals should settle",
    );
    const coldFrames = await stopSampling();
    const coldNonEmptyFrames = coldFrames.filter((frame) => frame.length > 0);
    const coldFinalFrame = coldNonEmptyFrames[coldNonEmptyFrames.length - 1];
    assert.ok(coldFinalFrame, JSON.stringify(coldFrames));
    assert.ok(coldFinalFrame.every((row) => row.iconSrc && !row.hasGlobe && row.color));
    assert.ok(
      coldNonEmptyFrames.every((frame) => JSON.stringify(frame) === JSON.stringify(coldFinalFrame)),
      `web visuals exposed an intermediate frame: ${JSON.stringify(coldFrames)}`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_WEB_FAVICON_QUERY_COUNT`),
      1,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes("加载中")`),
      false,
    );

    await navigateTo("数据");
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__TIME_TRACKER_WEB_FAVICON_QUERY_COUNT = 0;
        globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: false, focused: false });
        globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: true, focused: false });
      })()
    `);
    await startSampling();
    await navigateTo("历史");
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".history-app-distribution-card img").length === 2`,
    );
    const returnFrames = await stopSampling();
    assert.ok(returnFrames.length > 0, JSON.stringify(returnFrames));
    assert.ok(
      returnFrames.every((frame) => (
        frame.length === 2
        && frame.every((row) => row.iconSrc && !row.hasGlobe && row.color)
      )),
      `cached web visuals were not present on the first frame: ${JSON.stringify(returnFrames)}`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_WEB_FAVICON_QUERY_COUNT`),
      0,
    );

    await evaluate(client!, sessionId, `
      (() => {
        localStorage.setItem("patina:history-day-distribution-mode", "app");
        delete globalThis.__TIME_TRACKER_ENABLE_WEB_FIXTURE;
        delete globalThis.__TIME_TRACKER_WEB_FAVICON_QUERY_DELAY_MS;
      })()
    `);
  });
}
