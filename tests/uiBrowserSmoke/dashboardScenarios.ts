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
      await waitForExpression(client!, sessionId, `
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      `);
    }
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
