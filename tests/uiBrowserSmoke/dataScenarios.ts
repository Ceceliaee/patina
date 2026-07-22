import assert from "node:assert/strict";
import { COPY } from "../../src/shared/copy/index.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";

export async function runDataScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

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
          const trigger = document.querySelector(".data-trend-range-trigger");
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
    await waitForExpression(client!, sessionId, `document.querySelector(".data-trend-range-trigger")?.textContent?.trim() === "1天"`);
  });

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
        `document.querySelectorAll('.data-heatmap-weeks [data-heatmap-date][tabindex="0"]').length`,
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
