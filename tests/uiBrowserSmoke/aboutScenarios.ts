import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";

export async function runAboutScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("About cold navigation renders stable static content without a loading frame", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          localStorage.setItem("patina:last-active-view", "history");
          localStorage.setItem("__time_tracker_settings_query_delay_ms", "900");
          location.reload();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector("[data-history-content-state]") && document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("关于"))} + ']'))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("关于"))} + ']');
          node?.click();
          return Boolean(node);
        })()
      `),
      true,
    );
    const pendingState = JSON.parse(String(await evaluate(client!, sessionId, `JSON.stringify({
      presentedView: document.querySelector("main.qp-canvas")?.getAttribute("data-presented-view") ?? null,
      aboutMounted: Boolean(document.querySelector(".about-center-panel")),
      historyMounted: Boolean(document.querySelector("[data-history-content-state]")),
    })`))) as {
      presentedView: string | null;
      aboutMounted: boolean;
      historyMounted: boolean;
    };
    assert.ok(
      pendingState.presentedView === "history" || pendingState.presentedView === "about",
      `cold About handoff must retain History or present About, got ${pendingState.presentedView}`,
    );
    assert.equal(
      pendingState.presentedView === "about"
        ? pendingState.aboutMounted
        : pendingState.historyMounted,
      true,
    );

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("main.qp-canvas")?.getAttribute("data-presented-view") === "about"
        && Boolean(document.querySelector(".about-center-panel"))`,
      15_000,
      "About static content should present without waiting for shared bootstrap",
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelector("main.qp-canvas")?.innerText.includes("加载中...")`),
      false,
      "the presented About page must not wait on History's independent data read",
    );
    await evaluate(client!, sessionId, `localStorage.removeItem("__time_tracker_settings_query_delay_ms")`);
  });

  await runTest("About page keeps its centered update layout", async () => {
    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("关于"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true, "missing About navigation entry");

    await waitForExpression(
      client!,
      sessionId,
      "Boolean(document.querySelector('.about-center-panel .about-center-profile'))",
    );

    const layout = await evaluate(client!, sessionId, `
      (() => {
        const panel = document.querySelector('.about-center-panel');
        const profile = document.querySelector('.about-center-profile');
        const actions = Array.from(document.querySelectorAll('.about-pill-action'));
        const update = document.querySelector('.about-center-update.update-status-compact');
        if (!panel || !profile || actions.length !== 2 || !update) return null;

        const firstActionRect = actions[0].getBoundingClientRect();
        const actionRects = actions.map((action) => action.getBoundingClientRect());
        return {
          panelDisplay: getComputedStyle(panel).display,
          profileJustifyItems: getComputedStyle(profile).justifyItems,
          actionDisplay: getComputedStyle(actions[0]).display,
          actionMinHeight: parseFloat(getComputedStyle(actions[0]).minHeight),
          actionBorderRadius: getComputedStyle(actions[0]).borderRadius,
          actionsStayInOneRow: actionRects.every((rect) => Math.abs(rect.top - firstActionRect.top) < 2),
          updatePaddingTop: parseFloat(getComputedStyle(update).paddingTop),
        };
      })()
    `) as {
      panelDisplay: string;
      profileJustifyItems: string;
      actionDisplay: string;
      actionMinHeight: number;
      actionBorderRadius: string;
      actionsStayInOneRow: boolean;
      updatePaddingTop: number;
    } | null;

    assert.ok(layout, "About layout hooks should be present");
    assert.equal(layout.panelDisplay, "grid");
    assert.equal(layout.profileJustifyItems, "center");
    assert.equal(["flex", "inline-flex"].includes(layout.actionDisplay), true);
    assert.equal(layout.actionMinHeight, 30);
    assert.equal(layout.actionBorderRadius, "8px");
    assert.equal(layout.actionsStayInOneRow, true);
    assert.equal(layout.updatePaddingTop > 0, true);
  });

  await runTest("About repository link remains retryable after an opening failure", async () => {
    const repository = '.about-pill-action:first-child';
    await evaluate(client, sessionId, `(() => {
      globalThis.__TIME_TRACKER_OPENED_URLS = [];
      globalThis.__TIME_TRACKER_REJECT_OPEN_URL = true;
      globalThis.__TIME_TRACKER_ORIGINAL_CONSOLE_ERROR = console.error;
      console.error = (...args) => {
        if (args[0] !== 'open repository link failed') globalThis.__TIME_TRACKER_ORIGINAL_CONSOLE_ERROR(...args);
      };
      document.querySelector('${repository}').click();
    })()`);
    try {
      await waitForExpression(client, sessionId, `document.body.textContent.includes(${jsonString("未能打开 GitHub 链接。")})`);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('${repository}').disabled`), false);
    } finally {
      await evaluate(client, sessionId, `console.error = globalThis.__TIME_TRACKER_ORIGINAL_CONSOLE_ERROR;
        delete globalThis.__TIME_TRACKER_ORIGINAL_CONSOLE_ERROR;
        globalThis.__TIME_TRACKER_REJECT_OPEN_URL = false;`);
    }
    await evaluate(client, sessionId, `document.querySelector('${repository}').click()`);
    await waitForExpression(client, sessionId, `globalThis.__TIME_TRACKER_OPENED_URLS.includes('https://github.com/Ceceliaee/patina')`);
  });

  await runTest("About page keeps one centered update layout on wide desktop", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1800,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);

    try {
      const clicked = await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("关于"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `);
      assert.equal(clicked, true, "missing About navigation entry");
      await waitForExpression(
        client!,
        sessionId,
        "Boolean(document.querySelector('.about-center-panel .about-center-update'))",
      );

      const wideLayout = await evaluate(client!, sessionId, `
        (async () => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const panel = document.querySelector('.about-center-panel');
          const profile = document.querySelector('.about-center-profile');
          const actions = document.querySelector('.about-pill-row');
          const update = document.querySelector('.about-center-update.update-status-compact');
          if (!panel || !profile || !actions || !update) return null;

          const profileRect = profile.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          const updateRect = update.getBoundingClientRect();
          return {
            panelColumns: getComputedStyle(panel).gridTemplateColumns,
            updateIsBelowActions: updateRect.top > actionsRect.bottom,
            updateIsCenteredWithActions:
              Math.abs((updateRect.left + updateRect.width / 2) - (actionsRect.left + actionsRect.width / 2)) < 2,
            updateStaysWiderThanActions: updateRect.width > actionsRect.width,
            actionsStayBelowProfile: actionsRect.top > profileRect.bottom,
          };
        })()
      `) as {
        panelColumns: string;
        updateIsBelowActions: boolean;
        updateIsCenteredWithActions: boolean;
        updateStaysWiderThanActions: boolean;
        actionsStayBelowProfile: boolean;
      } | null;

      assert.ok(wideLayout, "About wide layout hooks should be present");
      assert.equal(wideLayout.panelColumns.trim().split(/\s+/).length, 1);
      assert.equal(wideLayout.updateIsBelowActions, true);
      assert.equal(wideLayout.updateIsCenteredWithActions, true);
      assert.equal(wideLayout.updateStaysWiderThanActions, true);
      assert.equal(wideLayout.actionsStayBelowProfile, true);
    } finally {
      await client!.command("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 820,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
    }
  });
}
