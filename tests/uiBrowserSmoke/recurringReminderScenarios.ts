import assert from "node:assert/strict";
import { loadLocaleText } from "../../src/shared/i18n/runtime.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, waitForExpression } from "./browserHarness.ts";

export async function runRecurringReminderScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  await runTest("Recurring reminder draft applies directly, persists its rule and exposes unframed state icons in every locale", async () => {
    const storage = String(await evaluate(client, sessionId, `JSON.stringify({...localStorage})`));
    const click = async (selector: string) => {
      const { x, y } = await evaluate(client, sessionId, `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`) as { x: number; y: number };
      await client.command("Input.dispatchMouseEvent", {type:"mousePressed",x,y,button:"left",clickCount:1}, sessionId);
      await client.command("Input.dispatchMouseEvent", {type:"mouseReleased",x,y,button:"left",clickCount:1}, sessionId);
    };
    const key = async (value: string, code: number) => {
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: value, code: value,
        ...(value === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}), windowsVirtualKeyCode: code }, sessionId);
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: value, code: value, windowsVirtualKeyCode: code }, sessionId);
    };
    try {
      for (const locale of ["zh-CN", "en-US", "es", "ru-RU"] as const) {
        const text = await loadLocaleText(locale);
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1100, height: 820, deviceScaleFactor: 1.25, mobile: false }, sessionId);
        await evaluate(client, sessionId, `(() => {
          localStorage.clear(); localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify({language:${JSON.stringify(locale)}}));
          localStorage.setItem('patina:last-active-view','tools'); localStorage.setItem('patina:tools-section','reminders');
          localStorage.setItem('__time_tracker_tools_snapshot_override',JSON.stringify({
            settings:{pomodoro_focus_minutes:25,pomodoro_short_break_minutes:5,pomodoro_long_break_minutes:15,pomodoro_long_break_every:4},
            reminders:[{id:1,label:'Completed',scheduled_at:Date.now()-60000,created_at:Date.now()-120000,status:'fired',fired_at:Date.now()-30000,cancelled_at:null}],
            activity_reminder_rules: [], free_focus_tasks: [], pomodoro_tasks: [], current_pomodoro:null,today_completed_pomodoros:0,next_reminder_at:null,sampled_at_ms:Date.now()}));
          document.documentElement.dataset.recurringReload='pending';location.reload();
        })()`);
        await waitForExpression(client, sessionId, `document.documentElement?.dataset.recurringReload!=='pending' && !!document.querySelector('.tools-event-reminder-form') && document.documentElement.lang===${JSON.stringify(locale)}`);
        await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_CASE=JSON.parse(localStorage.getItem('__time_tracker_tools_snapshot_override'))`);
        assert.equal(await evaluate(client, sessionId, `document.querySelector('[data-timed-reminder-id="1"] .tools-reminder-status-icon').getAttribute('aria-label')`), text.tools.reminderCompleted);
        assert.equal(await evaluate(client, sessionId, `document.querySelectorAll('.tools-reminder-time-filter, .tools-event-reminder-main .qp-badge').length`), 0);
        assert.equal(await evaluate(client, sessionId, `document.querySelectorAll('.tools-event-reminder-form input[type="date"], .tools-event-reminder-form input[type="time"], .tools-repeat-option').length`), 0);
        await click('.tools-event-reminder-form .qp-select-trigger');
        await waitForExpression(client, sessionId, `document.activeElement?.matches('.qp-select-menu')`);
        assert.equal(await evaluate(client, sessionId, `(() => {
          const input=getComputedStyle(document.querySelector('.tools-event-reminder-form input'));
          return [...document.querySelectorAll('.tools-event-reminder-form .tools-reminder-time-trigger,.tools-event-reminder-form .qp-select-trigger,.qp-select-option')]
            .every(el=>{const s=getComputedStyle(el);return s.fontSize===input.fontSize&&s.fontWeight===input.fontWeight&&s.lineHeight===input.lineHeight;});
        })()`), true);
        assert.deepEqual(await evaluate(client, sessionId, `[...document.querySelectorAll('.qp-select-option')].map(option=>option.textContent)`), [
          text.tools.reminderRepeatNone, text.tools.reminderRepeatDaily, text.tools.reminderRepeatWeekly,
          text.tools.reminderRepeatMonthly, text.tools.reminderRepeatYearly,
        ]);
        assert.equal(await evaluate(client, sessionId, `(() => {const menu=document.querySelector('.qp-select-menu').getBoundingClientRect();const trigger=document.querySelector('.tools-event-reminder-form .qp-select-trigger').getBoundingClientRect();return Math.abs(menu.width-Math.max(trigger.width,120))<1 && menu.right<=innerWidth && menu.bottom<=innerHeight;})()`), true);
        await key('ArrowDown', 40);
        await key('ArrowDown', 40);
        await key('Enter', 13);
        await waitForExpression(client, sessionId, `!document.querySelector('.qp-select-menu') && document.activeElement?.matches('.qp-select-trigger')`);
        assert.equal(await evaluate(client, sessionId, `document.querySelectorAll('.tools-repeat-weekdays, .tools-repeat-weekday-popover').length`), 0);
        assert.equal(await evaluate(client, sessionId, `document.querySelectorAll('.tools-event-reminder-form .tools-action-button svg').length`), 0);
        assert.equal(await evaluate(client, sessionId, `(() => {const form=document.querySelector('.tools-event-reminder-form');const widths=[form.querySelector('input'),form.querySelector('.tools-reminder-time-trigger'),form.querySelector('.qp-select-trigger')].map(el=>el.getBoundingClientRect().width);return widths[0]>widths[1]&&Math.abs(widths[1]-widths[2])<1;})()`), true);
        await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE={error:'injected create failure'}`);
        await click('.tools-event-reminder-form .tools-action-button');
        await waitForExpression(client, sessionId, `!document.querySelector('.tools-event-reminder-form .tools-action-button').disabled`);
        assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_CASE.reminders.length`), 1);
        await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_ACTION_CASE={}`);
        await click('.tools-event-reminder-form .tools-action-button');
        await waitForExpression(client, sessionId, `!!document.querySelector('[data-timed-reminder-id="2"] .lucide-repeat')`);
        const created = await evaluate(client, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.filter(item=>item.command==='cmd_create_reminder').at(-1).payload.input`) as { scheduledAt: number; recurrence: unknown };
        assert.deepEqual(created.recurrence, { kind: 'weekly', weekdays: [new Date(created.scheduledAt).getDay() || 7] });
        await click('[data-timed-reminder-id="2"] button:has(.lucide-pencil-line)');
        await waitForExpression(client, sessionId, `document.activeElement?.matches('.tools-reminder-editor input')`);
        await click('.tools-reminder-editor .tools-reminder-time-trigger');
        await waitForExpression(client, sessionId, `document.activeElement?.matches('.qp-calendar-day')`);
        assert.equal(await evaluate(client, sessionId, `document.querySelectorAll('.tools-reminder-time-trigger svg, .tools-reminder-time-popover input, .tools-reminder-time-popover .qp-date-picker-trigger, .tools-reminder-time-popover .qp-time-picker-trigger').length`), 0);
        assert.equal(await evaluate(client, sessionId, `document.querySelectorAll('.tools-reminder-time-popover [role="listbox"]').length`), 2);
        assert.equal(await evaluate(client, sessionId, `(() => {
          const calendar=document.querySelector('.tools-reminder-calendar');
          const time=document.querySelector('.tools-reminder-time-popover .qp-time-picker-content');
          const a=calendar.getBoundingClientRect(),b=time.getBoundingClientRect();
          const trigger=document.querySelector('.tools-reminder-editor .tools-reminder-time-trigger').getBoundingClientRect();
          return a.height>230&&a.height<290&&Math.abs(a.top-b.top)<1&&Math.abs(a.bottom-b.bottom)<1&&b.left-a.right>=10
            &&Math.abs((a.left+b.right)/2-(trigger.left+trigger.width/2))<1
            &&[calendar,time].every(el=>getComputedStyle(el).borderTopWidth==='1px')
            &&getComputedStyle(calendar.parentElement.parentElement).backgroundColor==='rgba(0, 0, 0, 0)'
            &&Array.from(time.querySelectorAll('[role="listbox"]')).every(el=>el.clientHeight>170&&el.clientHeight<240&&el.scrollHeight>el.clientHeight);
        })()`), true);
        const originalDay = await evaluate(client, sessionId, `document.activeElement?.getAttribute('data-calendar-date')`);
        await key('ArrowUp', 38);
        await waitForExpression(client, sessionId, `document.activeElement?.matches('.qp-calendar-day') && document.activeElement.getAttribute('data-calendar-date')!==${JSON.stringify(originalDay)}`);
        await key('ArrowDown', 40);
        await waitForExpression(client, sessionId, `document.activeElement?.getAttribute('data-calendar-date')===${JSON.stringify(originalDay)}`);
        await key('ArrowRight', 39);
        await waitForExpression(client, sessionId, `document.activeElement?.matches('.qp-calendar-day:not([data-selected])')`);
        await click('.qp-calendar-day:focus');
        await waitForExpression(client, sessionId, `document.activeElement?.matches('.qp-calendar-day[data-selected]')`);
        await key('Tab', 9);
        await waitForExpression(client, sessionId, `document.activeElement?.getAttribute('data-time-picker-part')==='hour'`);
        const originalHour = await evaluate(client, sessionId, `document.activeElement?.getAttribute('data-time-picker-value')`);
        await key('ArrowDown', 40);
        await waitForExpression(client, sessionId, `document.activeElement?.matches('[data-selected-time-part="hour"]') && document.activeElement.getAttribute('data-time-picker-value')!==${JSON.stringify(originalHour)}`);
        await key('Tab', 9);
        assert.equal(await evaluate(client, sessionId, `document.activeElement?.getAttribute('data-time-picker-part')`), 'minute');
        await key('ArrowDown', 40);
        await waitForExpression(client, sessionId, `(() => {
          const option=document.activeElement;
          if(!option?.matches('[data-selected-time-part="minute"]'))return false;
          const r=option.getBoundingClientRect(),list=option.closest('[role="listbox"]').getBoundingClientRect();
          return r.top>=list.top&&r.bottom<=list.bottom;
        })()`);
        await click('[data-selected-time-part="minute"]');
        assert.equal(await evaluate(client, sessionId, `!!document.querySelector('.tools-reminder-time-popover .qp-calendar-month')`), true);
        await key('Tab', 9);
        assert.equal(await evaluate(client, sessionId, `document.activeElement?.matches('.qp-calendar-nav')`), true);
        assert.equal(await evaluate(client, sessionId, `(() => {const r=document.querySelector('.tools-reminder-time-popover').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`), true);
        await client.command("Emulation.setDeviceMetricsOverride", { width: 840, height: 640, deviceScaleFactor: 1.5, mobile: false }, sessionId);
        await waitForExpression(client, sessionId, `Array.from(document.querySelectorAll('.tools-reminder-calendar,.tools-reminder-time-popover .qp-time-picker-content')).every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})`);
        await key('Escape', 27);
        await waitForExpression(client, sessionId, `!!document.querySelector('.tools-reminder-editor') && !document.querySelector('.tools-reminder-time-popover') && document.activeElement?.matches('.tools-reminder-time-trigger')`);
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1100, height: 820, deviceScaleFactor: 1.25, mobile: false }, sessionId);
        await click('.qp-dialog-actions button[type="submit"]');
        await waitForExpression(client, sessionId, `!document.querySelector('.tools-reminder-editor')`);
        const updated = await evaluate(client, sessionId, `globalThis.__PATINA_TIMED_REMINDER_CASE.reminders.find(item=>item.id===2)`) as { scheduled_at: number; recurrence: unknown };
        assert.deepEqual(updated.recurrence, { kind: 'weekly', weekdays: [new Date(updated.scheduled_at).getDay() || 7] });
        await click('[data-timed-reminder-id="2"] button:has(.lucide-pencil-line)');
        await waitForExpression(client, sessionId, `document.activeElement?.matches('.tools-reminder-editor input')`);
        await click('.tools-reminder-editor .qp-select-trigger');
        await waitForExpression(client, sessionId, `document.activeElement?.matches('.qp-select-menu')`);
        await key('Escape', 27);
        await waitForExpression(client, sessionId, `!!document.querySelector('.tools-reminder-editor') && !document.querySelector('.qp-select-menu')`);
        await key('Escape', 27);
        await waitForExpression(client, sessionId, `!document.querySelector('.tools-reminder-editor')`);
        for (const [index, kind] of [[3, 'monthly'], [4, 'yearly']] as const) {
          await click('.tools-event-reminder-form .qp-select-trigger');
          await waitForExpression(client, sessionId, `!!document.querySelector('.qp-select-menu')`);
          await click(`.qp-select-menu li:nth-child(${index + 1}) button`);
          await click('.tools-event-reminder-form .tools-action-button');
          await waitForExpression(client, sessionId, `!!document.querySelector('[data-timed-reminder-id="${index}"] .lucide-repeat')`);
          assert.deepEqual(await evaluate(client, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.filter(item=>item.command==='cmd_create_reminder').at(-1).payload.input.recurrence`), { kind });
        }
        await evaluate(client, sessionId, `document.documentElement.dataset.recurringReload='persist';location.reload()`);
        await waitForExpression(client, sessionId, `document.documentElement.dataset.recurringReload!=='persist' && !!document.querySelector('[data-timed-reminder-id="2"] .lucide-repeat')`);
      }
    } finally {
      await client.command("Emulation.setDeviceMetricsOverride", { width:1280,height:820,deviceScaleFactor:1,mobile:false }, sessionId);
      await evaluate(client, sessionId, `localStorage.clear();for(const [key,value]of Object.entries(${storage}))localStorage.setItem(key,value);document.documentElement.dataset.recurringReload='restore';location.reload()`);
      await waitForExpression(client, sessionId, `document.documentElement.dataset.recurringReload!=='restore' && !!document.querySelector('main.qp-canvas')`);
    }
  });
}
