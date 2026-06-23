import assert from "node:assert/strict";
import { COPY } from "../../src/shared/copy/uiText.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";
import { TOOLS_TEXT } from "./constants.ts";

export async function runToolsScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("Tools page renders its tool sections", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']');
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
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.subtitle)})`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.reminderEmpty)})`,
    );

    for (const marker of [
      TOOLS_TEXT.remindersTitle,
      TOOLS_TEXT.timerTitle,
      TOOLS_TEXT.pomodoroTitle,
    ] as const) {
      assert.equal(
        await evaluate(client!, sessionId, `
          Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(marker))} + ']'))
        `),
        true,
        `missing Tools section ${marker}`,
      );
    }

    assert.equal(
      await evaluate(client!, sessionId, "document.querySelectorAll('.tools-section-tab-copy').length"),
      0,
      "Tools section rail should stay icon-only",
    );
    assert.equal(
      await evaluate(client!, sessionId, "Boolean(document.querySelector('.tools-section-label-toggle'))"),
      false,
      "Tools section rail should not expose a label toggle",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const workspace = document.querySelector('.tools-workspace');
          if (!workspace) return false;
          const railWidth = parseFloat(getComputedStyle(workspace).gridTemplateColumns.split(' ')[0] ?? "0");
          return railWidth > 0 && railWidth <= 80;
        })()
      `),
      true,
    );

    for (const marker of [
      TOOLS_TEXT.remindersTitle,
      TOOLS_TEXT.reminderModeEvent,
      TOOLS_TEXT.reminderModeSoftware,
    ] as const) {
      assert.equal(
        await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(marker)})`),
        true,
        `missing visible Tools panel marker ${marker}`,
      );
    }

    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('.tools-reminder-form input[type="number"][max="1440"]');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return input.value === '';
        })()
      `),
      true,
      "relative reminder minutes should be clearable while editing",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('.tools-reminder-form input[type="number"][max="1440"]');
          const create = document.querySelector('.tools-reminder-form .tools-action-button');
          if (!input || !create) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '0');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return Boolean(create.disabled)
            && !document.body.innerText.includes(${jsonString(TOOLS_TEXT.reminderTimeInvalid)});
        })()
      `),
      true,
      "relative reminder should disable create for zero minutes",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const absolute = Array.from(document.querySelectorAll('button'))
            .find((node) => node.textContent?.trim() === ${jsonString(TOOLS_TEXT.reminderModeAbsolute)});
          if (!absolute) return false;
          absolute.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const create = document.querySelector('.tools-reminder-form .tools-action-button');
          return Boolean(create?.disabled)
            && !document.body.innerText.includes(${jsonString(TOOLS_TEXT.reminderTimeInvalid)});
        })()
      `),
      true,
      "absolute reminder should disable create for the current minute",
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const software = Array.from(document.querySelectorAll('button'))
            .find((node) => node.textContent?.trim() === ${jsonString(TOOLS_TEXT.reminderModeSoftware)});
          if (!software) return false;
          software.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.softwareReminderEmpty)})`,
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const timer = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.timerTitle))} + ']');
          if (!timer) return false;
          timer.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.timerModeStopwatch)})`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const countdown = Array.from(document.querySelectorAll('button'))
            .find((node) => node.textContent?.trim() === ${jsonString(TOOLS_TEXT.timerModeCountdown)});
          if (!countdown) return false;
          countdown.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const input = document.querySelector('#tools-countdown-duration');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return input.value === '';
        })()
      `),
      true,
      "countdown duration should be clearable while editing",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('#tools-countdown-duration');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '0');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const start = document.querySelector('[data-tools-section="timer"] .tools-action-row .qp-button-primary');
          return Boolean(start?.disabled);
        })()
      `),
      true,
      "countdown duration should reject zero minutes",
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const pomodoro = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.pomodoroTitle))} + ']');
          if (!pomodoro) return false;
          pomodoro.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.pomodoroTitle)})`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('#tools-pomodoro-focus');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return input.value === '';
        })()
      `),
      true,
      "pomodoro duration should be clearable while editing",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('#tools-pomodoro-focus');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '0');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const start = document.querySelector('[data-tools-section="pomodoro"] .tools-action-row .qp-button-primary');
          return Boolean(start?.disabled);
        })()
      `),
      true,
      "pomodoro duration should reject zero minutes",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const fields = [
            ['#tools-pomodoro-focus', '25'],
            ['#tools-pomodoro-short-break', '5'],
            ['#tools-pomodoro-long-break', '15'],
            ['#tools-pomodoro-long-break-every', '4'],
          ];
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          for (const [selector, value] of fields) {
            const input = document.querySelector(selector);
            if (!input) return false;
            setter?.call(input, value === '25' ? '0' : '');
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const restore = document.querySelector(
            '[aria-label=' + ${jsonString(JSON.stringify(COPY["zh-CN"].accessibility.tools.restorePomodoroDefaults))} + ']'
          );
          if (!restore || restore.textContent?.trim() || restore.hasAttribute('title')) return false;
          const titleGroup = restore.closest('.tools-subpanel-title-action');
          const title = titleGroup?.querySelector('h3');
          if (!title || title.textContent?.trim() !== ${jsonString(TOOLS_TEXT.pomodoroSettings)}) return false;
          const titleRect = title.getBoundingClientRect();
          const restoreRect = restore.getBoundingClientRect();
          if (restoreRect.left < titleRect.right || restoreRect.left - titleRect.right > 12) return false;
          restore.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const start = document.querySelector('[data-tools-section="pomodoro"] .tools-action-row .qp-button-primary');
          return fields.every(([selector, value]) => document.querySelector(selector)?.value === value)
            && !start?.disabled;
        })()
      `),
      true,
      "pomodoro default icon restores editable durations",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dashboard = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!dashboard) return false;
          dashboard.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const tools = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']');
          if (!tools) return false;
          tools.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `
        document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.pomodoroTitle))} + ']')
          ?.getAttribute('aria-pressed') === 'true'
      `,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        document.querySelector('[data-tools-section="pomodoro"]')?.className.includes('tools-section-pane-hidden') === false
      `),
      true,
      "Tools section rail should restore the last selected section",
    );
    assert.equal(
      await evaluate(client!, sessionId, "document.querySelectorAll('.tools-section-tab-copy').length"),
      0,
      "Tools section rail should stay icon-only after switching sections",
    );
  });
}
