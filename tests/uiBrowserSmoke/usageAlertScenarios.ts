import assert from "node:assert/strict";
import { getLocaleText } from "../../src/shared/i18n/runtime.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";

export async function runUsageAlertScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  const text = getLocaleText("zh-CN");
  await runTest("usage alert steps preserve choices on failure and extend once without blocking apps", async () => {
    const storage = String(await evaluate(client!, sessionId, `JSON.stringify({ ...localStorage })`));
    const click = async (label: string) => {
      await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.tools-usage-alert-surface button')).find(button => button.textContent.trim() === ${jsonString(label)}).click()`);
    };
    const key = async (key: string, code: number) => {
      await client!.command("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: code }, sessionId);
      await client!.command("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code }, sessionId);
    };
    const waitForMarkedChoice = (expected: string) => waitForExpression(client!, sessionId, `
      (() => {
        const marked = [...document.querySelectorAll('.tools-usage-alert-option')].filter(row =>
          getComputedStyle(row.querySelector('.tools-usage-alert-option-check')).visibility === 'visible');
        return marked.length === 1 && marked[0].querySelector('input:checked')?.value === ${jsonString(expected)};
      })()
    `, undefined, `only the checked ${expected} option shows its checkmark`);
    try {
      await evaluate(client!, sessionId, `localStorage.setItem('__time_tracker_smoke_settings', JSON.stringify({ language: 'zh-CN' })); document.documentElement.dataset.usageReload='pending'; location.reload();`);
      await waitForExpression(client!, sessionId, `document.documentElement.dataset.usageReload !== 'pending' && typeof globalThis.__PATINA_EMIT_TAURI_EVENT === 'function' && !!document.querySelector('main.qp-canvas')`);
      await evaluate(client!, sessionId, `
        (async () => {
        globalThis.__PATINA_USAGE_ALERT_CASE = { calls: [], snapshot: {
          settings: { pomodoro_focus_minutes:25, pomodoro_short_break_minutes:5, pomodoro_long_break_minutes:15, pomodoro_long_break_every:4 },
          reminders:[], activity_reminder_rules:[], free_focus_tasks: [], pomodoro_tasks: [], current_pomodoro:null,
          today_completed_pomodoros:0, next_reminder_at:null, sampled_at_ms:Date.now()
        } };
        globalThis.__PATINA_EMIT_TAURI_EVENT('tools-alert', {
          id: 'usage-first', kind: 'activity_reminder', title: 'App reminder', body: 'Old notification body', occurred_at: 100,
          activity_reminder: { rule_id: 1, date_key: '2026-10-30', target: { kind: 'app', app_name: 'ChatGPT', exe_name: 'chatgpt.exe' },
            target_label: 'ChatGPT', usage_ms: 9780000, limit_ms: 1800000, message: 'Rest a little' }
        });
        })()
      `);
      await waitForExpression(client!, sessionId, `!!document.querySelector('.tools-usage-alert-limit')`);
      const usageBackground = await evaluate(client!, sessionId, `getComputedStyle(document.querySelector('.tools-usage-alert-surface')).backgroundColor`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('.tools-usage-alert-summary').textContent`), "已使用 2 小时 43 分钟，可用时长到达限制");
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('.tools-usage-alert-surface').innerText.includes('Old notification body')`), false);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('.tools-usage-alert-surface').innerText.includes('Rest a little')`), false);
      assert.equal(await evaluate(client!, sessionId, `document.querySelectorAll('.tools-usage-alert-limit .qp-dialog-body p').length`), 1);
      await click(text.tools.usageExtend);
      await waitForExpression(client!, sessionId, `document.activeElement?.value === 'fifteen_minutes'`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelectorAll('.tools-usage-alert-extend .qp-dialog-body p').length`), 0);
      assert.equal(await evaluate(client!, sessionId, `document.querySelectorAll('.tools-usage-alert-option').length`), 3);
      await waitForMarkedChoice("fifteen_minutes");
      assert.equal(await evaluate(client!, sessionId, `getComputedStyle(document.querySelector('.tools-usage-alert-surface')).backgroundColor`), usageBackground);
      await key("ArrowDown", 40);
      await waitForMarkedChoice("one_hour");
      assert.equal(await evaluate(client!, sessionId, `getComputedStyle(document.activeElement.closest('.tools-usage-alert-option')).outlineStyle`), "solid");
      await key("Escape", 27);
      await waitForExpression(client!, sessionId, `!!document.querySelector('.tools-usage-alert-limit') && document.activeElement?.textContent === ${jsonString(text.tools.usageExtend)}`);
      await click(text.tools.usageExtend);
      await waitForExpression(client!, sessionId, `document.querySelector('input[value="fifteen_minutes"]').checked`);
      await evaluate(client!, sessionId, `document.querySelector('.tools-usage-alert-option:has(input[value="today"])').click(); globalThis.__PATINA_USAGE_ALERT_CASE.hold=true; globalThis.__PATINA_USAGE_ALERT_CASE.error='injected failure';`);
      await waitForMarkedChoice("today");
      await click(text.common.confirm);
      await click(text.common.confirm);
      await waitForExpression(client!, sessionId, `globalThis.__PATINA_USAGE_ALERT_CASE.calls.length === 1 && !!globalThis.__PATINA_USAGE_ALERT_CASE.release`);
      await key("Escape", 27);
      assert.equal(await evaluate(client!, sessionId, `!!document.querySelector('.tools-usage-alert-extend') && [...document.querySelectorAll('.tools-usage-alert-surface button')].every(b=>b.disabled)`), true);
      await evaluate(client!, sessionId, `globalThis.__PATINA_USAGE_ALERT_CASE.release()`);
      await waitForExpression(client!, sessionId, `document.querySelector('.tools-usage-alert-error')?.textContent === ${jsonString(text.tools.actionFailed)}`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('input[value="today"]').checked`), true);
      await evaluate(client!, sessionId, `globalThis.__PATINA_USAGE_ALERT_CASE.hold=false; globalThis.__PATINA_USAGE_ALERT_CASE.error=null;`);
      await click(text.common.confirm);
      await waitForExpression(client!, sessionId, `!document.querySelector('.tools-usage-alert-surface')`);
      assert.deepEqual(await evaluate(client!, sessionId, `globalThis.__PATINA_USAGE_ALERT_CASE.calls`), [
        { command: "cmd_extend_activity_reminder", payload: { alertId: "usage-first", extension: "today" } },
        { command: "cmd_extend_activity_reminder", payload: { alertId: "usage-first", extension: "today" } },
      ]);
      for (const kind of ["category", "web"] as const) {
        await evaluate(client!, sessionId, `globalThis.__PATINA_EMIT_TAURI_EVENT('tools-alert', {
          id: 'usage-${kind}', kind: 'activity_reminder', title: '', body: '', occurred_at: 200,
          activity_reminder: { rule_id: 2, date_key: '2026-10-30',
            target: ${kind === "category" ? "{ kind: 'category', category_id: 'development' }" : "{ kind: 'web', normalized_domain: 'example.com' }"},
            target_label: '${kind}', usage_ms: 1800000, limit_ms: 1800000, message: '' }
        });`);
        await waitForExpression(client!, sessionId, `document.querySelector('.tools-usage-alert-name')?.textContent === '${kind}'`);
        assert.equal(await evaluate(client!, sessionId, `!!document.querySelector('.tools-usage-alert-note')`), false);
        await click(text.tools.usageReturnDesktop);
        await waitForExpression(client!, sessionId, `!document.querySelector('.tools-usage-alert-surface')`);
      }
      assert.equal(await evaluate(client!, sessionId, `globalThis.__PATINA_USAGE_ALERT_CASE.calls.filter(c=>c.command==='cmd_show_desktop').length`), 2);
      await evaluate(client!, sessionId, `globalThis.__PATINA_EMIT_TAURI_EVENT('tools-alert', { id: 'plain-reminder', kind:'pomodoro', title:'Reminder', body:'Plain reminder', occurred_at:300 });`);
      await waitForExpression(client!, sessionId, `document.querySelector('.tools-pomodoro-alert-surface .tools-usage-alert-summary')?.textContent === 'Plain reminder'`);
      assert.equal(await evaluate(client!, sessionId, `getComputedStyle(document.querySelector('.tools-pomodoro-alert-surface')).backgroundColor`), usageBackground);
      await waitForExpression(client!, sessionId, `document.activeElement === document.querySelector('.tools-pomodoro-alert-surface .qp-dialog-actions button')`);
      await key("Escape",27);
      await waitForExpression(client!,sessionId,`!document.querySelector('.tools-pomodoro-alert-surface')`);
    } finally {
      await evaluate(client!, sessionId, `localStorage.clear(); for(const [key,value] of Object.entries(${storage})) localStorage.setItem(key,value); document.documentElement.dataset.usageReload='pending'; location.reload();`);
      await waitForExpression(client!,sessionId,`document.documentElement.dataset.usageReload !== 'pending' && !!document.querySelector('main.qp-canvas')`);
    }
  });
}
