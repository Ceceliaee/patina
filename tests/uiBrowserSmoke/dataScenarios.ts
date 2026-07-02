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
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-range-picker"))`);
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
          const apply = Array.from(document.querySelectorAll(".data-range-picker-footer button"))
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
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-range-picker"))`);
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
    await waitForExpression(client!, sessionId, `!document.querySelector(".data-range-picker")`);
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
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-range-picker"))`);
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
          const apply = Array.from(document.querySelectorAll(".data-range-picker-footer button"))
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
    const tooltipLabel = await evaluate(client!, sessionId, `
      (() => {
        const cell = document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + '][data-heatmap-tooltip]');
        if (!cell) return "";
        const label = cell.getAttribute("data-heatmap-tooltip") ?? "";
        cell.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          cancelable: true,
          pointerType: "mouse",
        }));
        return label;
      })()
    `) as string;
    assert.ok(tooltipLabel);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('.qp-tooltip[role="tooltip"]').length === 1 && document.querySelector('.qp-tooltip[role="tooltip"]')?.textContent === ${jsonString(tooltipLabel)}`,
    );
    await evaluate(client!, sessionId, `
      (() => {
        const cell = document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + '][data-heatmap-tooltip]');
        cell?.dispatchEvent(new PointerEvent("pointerout", {
          bubbles: true,
          cancelable: true,
          pointerType: "mouse",
          relatedTarget: document.body,
        }));
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('.qp-tooltip[role="tooltip"]').length === 0`,
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
