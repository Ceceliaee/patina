import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, titleDetailsButtonExpression, waitForExpression } from "./browserHarness.ts";

export async function runLocaleScenarios(context: BrowserSmokeContext) {
  const { appUrl, client, sessionId, runTest } = context;

  await runTest("English history title chips do not crowd the duration column", async () => {
    await client!.command("Page.addScriptToEvaluateOnNewDocument", {
      source: "globalThis.__TIME_TRACKER_SMOKE_LANGUAGE = 'en-US';",
    }, sessionId);
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString("Focus share")})`,
    );

    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("History"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("History"))} + ']')?.className.includes("qp-nav-item-active")`,
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
      titleDetailsButtonExpression("title details", ".history-timeline-dialog-surface"),
      45_000,
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
  });
}
