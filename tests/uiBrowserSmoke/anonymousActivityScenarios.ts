import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForAnimationFrames, waitForExpression, withFixedBrowserClock } from "./browserHarness.ts";

export async function runAnonymousActivityScenarios(context: BrowserSmokeContext) {
  const { appUrl, client, sessionId, runTest } = context;
  await runTest("anonymous activity has distinct, non-editable entries in Data and History", () => withFixedBrowserClock(context, async () => {
    const navigate = async () => {
      const previousDocument = await evaluate(client, sessionId, `performance.timeOrigin`);
      await client.command("Page.navigate", { url: appUrl }, sessionId);
      await waitForExpression(client, sessionId, `performance.timeOrigin !== ${previousDocument} && document.readyState === 'complete'`);
    };
    try {
      await evaluate(client, sessionId, `localStorage.setItem('__patina_anonymous_activity','1')`);
      await navigate();
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('[data-sidebar-nav-item="data"]'))`);
      assert.equal(await evaluate(client, sessionId, `new Date().getHours()`), 12);
      await evaluate(client, sessionId, `document.querySelector('[aria-label="数据"]').click()`);
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('.data-app-option[data-destination-key="activity:anonymous"]'))`);
      const anonymousOption = `.data-app-option[data-destination-key="activity:anonymous"]`;
      assert.equal(await evaluate(client, sessionId, `document.querySelector(${jsonString(anonymousOption)}).getAttribute('aria-haspopup')`), null);
      assert.equal(await evaluate(client, sessionId, `document.querySelector(${jsonString(anonymousOption)}).querySelectorAll('svg.anonymous-activity-icon').length`), 1);
      assert.equal(await evaluate(client, sessionId, `document.querySelector(${jsonString(anonymousOption)}).innerText.includes('匿名')`), false);
      await evaluate(client, sessionId, `(() => {
        const option = document.querySelector(${jsonString(anonymousOption)});
        option.focus();
      })()`);
      await waitForAnimationFrames(client, sessionId, 2);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('[role="tooltip"]'))`), false);
      await evaluate(client, sessionId, `(() => {
        const option = document.querySelector(${jsonString(anonymousOption)});
        option.querySelector('svg').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await waitForAnimationFrames(client, sessionId, 2);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('.destination-detail-dialog'))`), false);
      await evaluate(client, sessionId, `document.querySelector(${jsonString(anonymousOption)}).click()`);
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('.data-app-selected-icon[data-selection-key="activity:anonymous"]'))`);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.data-app-selected-icon[data-selection-key="activity:anonymous"]').getAttribute('aria-haspopup')`), null);
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('.data-app-panel .qp-native-trend-line'))`);
      assert.equal(await evaluate(client, sessionId, `getComputedStyle(document.querySelector(${jsonString(anonymousOption)})).getPropertyValue('--data-series-color').trim()`), '#8F98A8');
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.data-app-panel .qp-native-trend-line').getAttribute('stroke')`), '#8F98A8');
      await evaluate(client, sessionId, `document.querySelector('.data-app-panel').scrollIntoView({ block: 'start' })`);
      await evaluate(client, sessionId, `document.querySelector('[aria-label="历史"]').click()`);
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('.history-app-distribution-card svg.anonymous-activity-icon'))`);
      assert.equal(await evaluate(client, sessionId, `(() => {
        const icon = document.querySelector('.history-app-distribution-card svg.anonymous-activity-icon');
        return !icon.closest('button') && icon.closest('[role="img"]').getAttribute('aria-label').includes('匿名');
      })()`), true);

      await evaluate(client, sessionId, `[...document.querySelectorAll('.history-day-distribution-mode-switch button')].find(n => n.textContent.trim() === '分类').click()`);
      await waitForExpression(client, sessionId, `(() => {
        const panel = document.querySelector('.history-app-distribution-card');
        return panel?.innerText.includes('匿名') && !panel.querySelector('.anonymous-activity-icon')
          && [...panel.querySelectorAll('.history-day-distribution-name-row')].some(n => n.textContent.trim() === '匿名');
      })()`);
      await evaluate(client, sessionId, `[...document.querySelectorAll('.history-day-distribution-mode-switch button')].find(n => n.textContent.trim() === '应用').click()`);
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('.history-app-distribution-card .anonymous-activity-icon'))`);

    } finally {
      await evaluate(client, sessionId, `localStorage.removeItem('__patina_anonymous_activity')`);
      await navigate();
    }
  }));
}
