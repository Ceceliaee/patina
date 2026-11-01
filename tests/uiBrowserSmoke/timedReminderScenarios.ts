import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, waitForExpression } from "./browserHarness.ts";

export async function runTimedReminderScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  await runTest("Timed alert completes durably or snoozes the original item through a compact two-step dialog", async () => {
    const originalStorage = String(await evaluate(client, sessionId, `JSON.stringify({ ...localStorage })`));
    const click = (label: string) => evaluate(client, sessionId, `[...document.querySelectorAll('.tools-timed-alert-surface button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`);
    const key = async (key: string, code: number) => {
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code }, sessionId);
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code }, sessionId);
    };
    const reload = async () => {
      await evaluate(client, sessionId, `document.documentElement.dataset.timedReload = 'pending'; location.reload();`);
      await waitForExpression(client, sessionId, `document.documentElement.dataset.timedReload !== 'pending' && !!document.querySelector('[data-timed-reminder-id="1"]')`);
      await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_CASE = JSON.parse(localStorage.getItem('__time_tracker_tools_snapshot_override'))`);
    };
    const fire = async () => {
      await evaluate(client, sessionId, `(() => {
        const snapshot = globalThis.__PATINA_TIMED_REMINDER_CASE;
        const row = snapshot.reminders[0]; row.status = 'pending_confirmation'; row.fired_at = Date.now();
        globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed', snapshot);
        globalThis.__PATINA_EMIT_TAURI_EVENT('tools-alert', { id: 'reminder:1:' + row.fired_at, kind: 'reminder', title: 'Reminder', body: row.label, occurred_at: row.fired_at });
      })()`);
      await waitForExpression(client, sessionId, `document.activeElement?.textContent === '确认完成'`);
    };
    try {
      await evaluate(client, sessionId, `(() => {
        localStorage.clear();
        localStorage.setItem('__time_tracker_smoke_settings', JSON.stringify({ language: 'zh-CN' }));
        localStorage.setItem('patina:last-active-view', 'tools'); localStorage.setItem('patina:tools-section', 'reminders');
        localStorage.setItem('__time_tracker_tools_snapshot_override', JSON.stringify({
          settings: { default_countdown_minutes: 25, pomodoro_focus_minutes: 25, pomodoro_short_break_minutes: 5, pomodoro_long_break_minutes: 15, pomodoro_long_break_every: 4 },
          reminders: [{ id: 1, label: '起来活动一下', scheduled_at: Date.now()-1000, created_at: Date.now()-10000, status: 'pending_confirmation', fired_at: Date.now(), cancelled_at: null }],
          activity_reminder_rules: [], current_timer: null, timer_laps: [], current_pomodoro: null, today_completed_pomodoros: 0, next_reminder_at: null, sampled_at_ms: Date.now()
        }));
      })()`);
      await reload(); await fire();
      assert.deepEqual(await evaluate(client, sessionId, `(() => {
        const dialog = document.querySelector('.tools-timed-alert-surface');
        return { width: getComputedStyle(dialog).width, heading: dialog.querySelector('.qp-dialog-title').textContent,
          icon: !!dialog.querySelector('svg'), buttons: [...dialog.querySelectorAll('button')].map(b=>b.textContent),
          time: dialog.querySelector('p').textContent.startsWith('提醒时间：') };
      })()`), { width: '400px', heading: '起来活动一下', icon: false, buttons: ['稍后提醒', '确认完成'], time: true });
      await click('稍后提醒');
      await waitForExpression(client, sessionId, `document.activeElement?.value === '5'`);
      assert.deepEqual(await evaluate(client, sessionId, `({ width: getComputedStyle(document.querySelector('.tools-timed-alert-surface')).width,
        options: [...document.querySelectorAll('.tools-usage-alert-option span')].map(item=>item.textContent) })`), { width: '400px', options: ['5 分钟后', '15 分钟后', '30 分钟后'] });
      const point = await evaluate(client, sessionId, `(() => { const r = document.querySelectorAll('.tools-usage-alert-option')[1].getBoundingClientRect(); return { x:r.x+20, y:r.y+20 }; })()`) as {x:number; y:number};
      await client.command('Input.dispatchMouseEvent', { type:'mouseMoved', ...point }, sessionId);
      assert.equal(await evaluate(client, sessionId, `getComputedStyle(document.querySelectorAll('.tools-usage-alert-option')[1]).backgroundColor`), 'rgba(0, 0, 0, 0)');
      await evaluate(client, sessionId, `document.querySelector('input[name="reminder-delay"][value="5"]').focus()`);
      await key('ArrowDown', 40);
      await waitForExpression(client, sessionId, `document.querySelector('input[name="reminder-delay"][value="15"]').checked`);
      await key('Escape', 27);
      await waitForExpression(client, sessionId, `document.activeElement?.textContent === '稍后提醒'`);
      assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_CASE.reminders[0].status`), 'pending_confirmation');
      await click('稍后提醒');
      await waitForExpression(client, sessionId, `document.activeElement?.value === '5'`);
      await evaluate(client, sessionId, `document.querySelector('input[name="reminder-delay"][value="15"]').click(); globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE = { hold:true, error:'injected failure' };`);
      await click('确认'); await click('确认');
      await waitForExpression(client, sessionId, `!!globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE.release`);
      await key('Escape', 27);
      assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.filter(item=>item.command==='cmd_resolve_reminder_alert').length`), 1);
      assert.equal(await evaluate(client, sessionId, `[...document.querySelectorAll('.tools-timed-alert-surface button')].every(b=>b.disabled)`), true);
      await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE.release()`);
      await waitForExpression(client, sessionId, `!!document.querySelector('.tools-timed-alert-surface [role="alert"]')`);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('input[name="reminder-delay"][value="15"]').checked`), true);
      await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE = {}`);
      await click('确认');
      await waitForExpression(client, sessionId, `!document.querySelector('.tools-timed-alert-surface')`);
      assert.equal(await evaluate(client, sessionId, `(() => { const rows=globalThis.__PATINA_TIMED_REMINDER_CASE.reminders; const remaining=rows[0].scheduled_at-Date.now(); return rows.length===1 && rows[0].id===1 && rows[0].status==='scheduled' && remaining>890000 && remaining<=900000; })()`), true);
      await reload();
      assert.equal(await evaluate(client, sessionId, `document.querySelector('[data-timed-reminder-id="1"] [aria-pressed]').getAttribute('aria-pressed')`), 'true');
      await fire(); await click('确认完成');
      await waitForExpression(client, sessionId, `!document.querySelector('.tools-timed-alert-surface') && document.querySelector('[data-timed-reminder-id="1"] .tools-reminder-status-icon')?.getAttribute("aria-label") === '已完成'`);
      await reload();
      assert.equal(await evaluate(client, sessionId, `document.querySelector('[data-timed-reminder-id="1"] .tools-reminder-status-icon')?.getAttribute("aria-label")`), '已完成');
      assert.equal(await evaluate(client, sessionId, `!!document.querySelector('[data-timed-reminder-id="1"] .tools-tabular')`), false);
      await evaluate(client, sessionId, `document.querySelector('[data-timed-reminder-id="1"] [aria-label^="删除:"]').click()`);
      await waitForExpression(client, sessionId, `!document.querySelector('[data-timed-reminder-id="1"]')`);
    } finally {
      await evaluate(client, sessionId, `localStorage.clear(); for(const [key,value] of Object.entries(${originalStorage})) localStorage.setItem(key,value); document.documentElement.dataset.timedReload='restore'; location.reload();`);
      await waitForExpression(client, sessionId, `document.documentElement.dataset.timedReload !== 'restore' && !!document.querySelector('main.qp-canvas')`);
    }
  });

  await runTest("Timed reminder icons toggle without flashing, edit safely and delete paused rows", async () => {
    const originalStorage = String(await evaluate(client, sessionId, `JSON.stringify({ ...localStorage })`));
    const row = `[data-timed-reminder-id="1"]`;
    try {
      await evaluate(client, sessionId, `(() => {
        const now = Date.now();
        localStorage.clear();
        localStorage.setItem("__time_tracker_smoke_settings", JSON.stringify({ language: "zh-CN" }));
        localStorage.setItem("patina:last-active-view", "tools");
        localStorage.setItem("patina:tools-section", "reminders");
        localStorage.setItem("__time_tracker_tools_snapshot_override", JSON.stringify({
          settings: { default_countdown_minutes: 25, pomodoro_focus_minutes: 25,
            pomodoro_short_break_minutes: 5, pomodoro_long_break_minutes: 15, pomodoro_long_break_every: 4 },
          reminders: [
            { id: 1, label: "Review", scheduled_at: now + 172800000, created_at: now, status: "scheduled", fired_at: null, cancelled_at: null },
            { id: 2, label: "Expired", scheduled_at: now - 60000, created_at: now - 120000, status: "paused", fired_at: null, cancelled_at: null },
          ], activity_reminder_rules: [], current_timer: null, timer_laps: [], current_pomodoro: null,
          today_completed_pomodoros: 0, next_reminder_at: now + 172800000, sampled_at_ms: now,
        }));
        document.documentElement.dataset.patinaSmokeReload = "timed-controls";
        location.reload();
      })()`);
      await waitForExpression(client, sessionId, `Boolean(document.documentElement.dataset.patinaSmokeReload !== 'timed-controls' && document.querySelectorAll('[data-timed-reminder-id]').length === 2)`);
      await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_CASE = JSON.parse(localStorage.getItem('__time_tracker_tools_snapshot_override'))`);
      assert.deepEqual(await evaluate(client, sessionId, `(() => {
        const row = document.querySelector('${row}');
        return { icons: [...row.querySelectorAll('button svg')].map(svg => svg.getAttribute('width')),
          widths: [...row.querySelectorAll('button')].map(button => button.getBoundingClientRect().width),
          countdown: Boolean(row.querySelector('.tools-tabular, .tools-status-pill')) };
      })()`), { icons: ["16", "16", "16"], widths: [28, 28, 28], countdown: false });
      await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE = { hold: true };
        { const button = document.querySelector('${row} [aria-pressed]'); button.focus(); button.click(); }`);
      await waitForExpression(client, sessionId, `Boolean(Boolean(globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE.release))`);
      assert.equal(await evaluate(client, sessionId, `(() => {
        const button = document.querySelector('${row} [aria-pressed]');
        button.click(); button.click();
        return button === document.activeElement && button.getAttribute('aria-busy') === 'true'
          && [...document.querySelectorAll('${row} button')].every(item => getComputedStyle(item).opacity === '1')
          && globalThis.__PATINA_INVOKED_COMMANDS.filter(item => item.command === 'cmd_update_reminder').length === 1;
      })()`), true);
      await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE.release()`);
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('${row} [aria-pressed="false"]:not([aria-busy])'))`);
      await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE = {};
        { const button = document.querySelector('${row} [aria-label^="编辑:"]'); button.focus(); button.click(); }`);
      await waitForExpression(client, sessionId, `Boolean(document.activeElement?.matches('.tools-reminder-editor input'))`);
      await evaluate(client, sessionId, `const input = document.querySelector('.tools-reminder-editor input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Revised');
        input.dispatchEvent(new Event('input',{bubbles:true}));
        globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE = { error: 'save failed' };`);
      await evaluate(client, sessionId, `document.querySelector('[role="dialog"] button[type="submit"]').click()`);
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('.tools-reminder-editor input')?.value === 'Revised' && !document.querySelector('.tools-reminder-editor input').disabled)`);
      assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_CASE.reminders[0].label`), "Review");
      await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE = {hold:true}; document.querySelector('[role="dialog"] button[type="submit"]').click()`);
      await waitForExpression(client, sessionId, `Boolean(Boolean(globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE.release))`);
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('.tools-reminder-editor'))`), true);
      await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE.release()`);
      await waitForExpression(client, sessionId, `Boolean(!document.querySelector('.tools-reminder-editor') && document.querySelector('${row} strong')?.textContent === 'Revised')`);
      assert.equal(await evaluate(client, sessionId, `document.activeElement?.getAttribute('aria-label')`), "编辑: Revised");
      assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_CASE.reminders[0].scheduled_at === JSON.parse(localStorage.getItem('__time_tracker_tools_snapshot_override')).reminders[0].scheduled_at`), true, "label edits preserve seconds in the original deadline");
      await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE = {}; document.querySelector('${row} [aria-pressed]').focus()`);
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 }, sessionId);
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, sessionId);
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('${row} [aria-pressed="true"]:not([aria-busy])'))`);
      await evaluate(client, sessionId, `document.querySelector('[data-timed-reminder-id="2"] [aria-pressed]').click()`);
      await waitForExpression(client, sessionId, `Boolean(Boolean(document.querySelector('.tools-reminder-editor [role="alert"]')))`);
      await evaluate(client, sessionId, `document.querySelector('[role="dialog"] button[type="submit"]').click()`);
      assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_CASE.reminders[1].status`), "paused");
      await evaluate(client, sessionId, `document.querySelector('.tools-reminder-editor .tools-reminder-time-trigger').click()`);
      await waitForExpression(client, sessionId, `document.activeElement?.matches('.qp-calendar-day')`);
      await evaluate(client, sessionId, `document.querySelector('.qp-calendar-nav:last-child').click()`);
      await waitForExpression(client, sessionId, `document.activeElement?.matches('.qp-calendar-day:not([data-selected])')`);
      await evaluate(client, sessionId, `document.activeElement.click()`);
      await waitForExpression(client, sessionId, `document.activeElement?.matches('.qp-calendar-day[data-selected]')`);
      await evaluate(client, sessionId, `document.querySelector('[data-time-picker-part="hour"][data-time-picker-value="12"]').click()`);
      await evaluate(client, sessionId, `document.querySelector('[data-time-picker-part="minute"][data-time-picker-value="0"]').click()`);
      await evaluate(client, sessionId, `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
      await waitForExpression(client, sessionId, `!document.querySelector('.tools-reminder-time-popover') && !!document.querySelector('.tools-reminder-editor')`);
      await evaluate(client, sessionId, `document.querySelector('[role="dialog"] button[type="submit"]').click()`);
      await waitForExpression(client, sessionId, `Boolean(!document.querySelector('.tools-reminder-editor') && document.querySelector('[data-timed-reminder-id="2"] [aria-pressed="true"]:not([aria-busy])'))`);
      assert.equal(await evaluate(client, sessionId, `new Date(globalThis.__PATINA_TIMED_REMINDER_CASE.reminders[1].scheduled_at).getHours()`), 12);
      await evaluate(client, sessionId, `document.querySelector('${row} [aria-pressed]').click()`);
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('${row} [aria-pressed="false"]:not([aria-busy])'))`);
      await evaluate(client, sessionId, `document.querySelector('${row} [aria-label^="删除:"]').click()`);
      await waitForExpression(client, sessionId, `Boolean(!document.querySelector('${row}') && document.querySelectorAll('[data-timed-reminder-id]').length === 1)`);
    } finally {
      await evaluate(client, sessionId, `localStorage.clear();
        for(const [key,value] of Object.entries(${originalStorage})) localStorage.setItem(key,value);
        document.documentElement.dataset.patinaSmokeReload = 'timed-controls-restored'; location.reload();`);
      await waitForExpression(client, sessionId, `Boolean(document.documentElement.dataset.patinaSmokeReload !== 'timed-controls-restored' && Boolean(document.querySelector('main.qp-canvas')))`);
    }
  });
}
