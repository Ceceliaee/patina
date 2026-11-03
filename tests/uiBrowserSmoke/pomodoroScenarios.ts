import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, waitForExpression } from "./browserHarness.ts";

export function pomodoroFixture() {
  return {
    settings: { pomodoro_focus_minutes: 25, pomodoro_short_break_minutes: 5, pomodoro_long_break_minutes: 15, pomodoro_long_break_every: 4 },
    reminders: [{id:99,label:"Reminder",scheduled_at:Date.now()+60000,created_at:1000,status:"scheduled",fired_at:null,cancelled_at:null}], activity_reminder_rules: [], current_pomodoro: null,
    today_completed_pomodoros: 0, next_reminder_at: null, sampled_at_ms: Date.now(),
    free_focus_tasks: [],
    pomodoro_tasks: [{ label: "Reading", completed_groups: 0, run: {
      id: 42, phase: "focus", status: "idle", cycle_index: 1, focus_ms: 1500000, short_break_ms: 300000,
      long_break_ms: 900000, long_break_every: 4, phase_started_at: null, phase_paused_at: null,
      phase_remaining_ms: 1500000, completed_focus_count: 0, created_at: 1000, updated_at: 1000,
    } }],
  };
}

export async function runPomodoroScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  await runTest("Pomodoro tasks create, switch, retain failed drafts and delete independently", async () => {
    const storage = String(await evaluate(client, sessionId, `JSON.stringify({...localStorage})`));
    try {
      await evaluate(client, sessionId, `
        localStorage.setItem('patina:last-active-view','tools'); localStorage.setItem('patina:tools-section','pomodoro');
        localStorage.setItem('__time_tracker_tools_snapshot_override',JSON.stringify(${JSON.stringify(pomodoroFixture())}));
        document.documentElement.dataset.pomodoroReload='pending'; location.reload();
      `);
      await waitForExpression(client, sessionId, `document.documentElement.dataset.pomodoroReload!=='pending' && Boolean(document.querySelector('[data-pomodoro-task-id="42"]'))`);
      await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_CASE=${JSON.stringify(pomodoroFixture())}; globalThis.__PATINA_POMODORO_CALLS=[];`);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('#tools-pomodoro-focus'))`), false);
      await evaluate(client, sessionId, `document.querySelector('.tools-pomodoro-settings-trigger').click()`);
      await waitForExpression(client, sessionId, `document.activeElement?.id==='tools-pomodoro-focus'`);
      await evaluate(client, sessionId, `(()=>{const i=document.querySelector('#tools-pomodoro-focus');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'45');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await waitForExpression(client, sessionId, `document.querySelector('.tools-pomodoro-settings-trigger').textContent.includes('45')`);
      await client.command('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}, sessionId);
      await waitForExpression(client, sessionId, `!document.querySelector('.tools-pomodoro-settings-popover') && document.activeElement?.matches('.tools-pomodoro-settings-trigger')`);
      await evaluate(client, sessionId, `document.querySelector('.tools-pomodoro-settings-trigger').click()`);
      await waitForExpression(client, sessionId, `document.activeElement?.id==='tools-pomodoro-focus'`);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('#tools-pomodoro-focus').value`), '45');
      await evaluate(client, sessionId, `(()=>{const i=document.querySelector('#tools-pomodoro-focus');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await waitForExpression(client, sessionId, `document.querySelector('#tools-pomodoro-focus').value === '' && document.querySelector('.tools-pomodoro-settings-trigger').textContent.includes('45')`);
      await evaluate(client, sessionId, `document.querySelector('#tools-pomodoro-name').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
      await waitForExpression(client, sessionId, `!document.querySelector('.tools-pomodoro-settings-popover')`);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.tools-pomodoro-settings-trigger').textContent.includes('45')`), true);
      const fill = async (value: string) => evaluate(client, sessionId, `
        (()=>{const input=document.querySelector('#tools-pomodoro-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()
      `);
      await fill("Writing");
      await evaluate(client, sessionId, `document.querySelector('.tools-pomodoro-create button[type="submit"]').click()`);
      await waitForExpression(client, sessionId, `document.querySelectorAll('[data-pomodoro-task-id]').length===2`);
      assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_CALLS.find(a=>a.kind==='save').focusMs`), 2700000);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('.tools-pomodoro-run-button .lucide-play'))`), true);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('.tools-pomodoro-task-row .lucide-alarm-clock'))`), false);
      assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_CASE.pomodoro_tasks.every(t=>t.run.status==='idle')`), true);
      await fill('New task draft');
      await evaluate(client, sessionId, `document.querySelector('[data-pomodoro-task-id="42"] .tools-pomodoro-run-button').click()`);
      await waitForExpression(client, sessionId, `globalThis.__PATINA_POMODORO_CASE.pomodoro_tasks[0].run.status==='running' && !document.querySelector('[data-pomodoro-task-id="42"] .tools-pomodoro-run-button').disabled`);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('[data-pomodoro-task-id="42"] .tools-pomodoro-run-button .lucide-pause'))`), true);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('.tools-pomodoro-task-actions .lucide-fast-forward'))`), false);
      await evaluate(client, sessionId, `document.querySelector('[data-pomodoro-task-id="42"] .tools-pomodoro-run-button').click()`);
      await waitForExpression(client, sessionId, `globalThis.__PATINA_POMODORO_CASE.pomodoro_tasks[0].run.status==='paused' && !document.querySelector('[data-pomodoro-task-id="42"] .tools-pomodoro-run-button').disabled`);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('[data-pomodoro-task-id="42"] .tools-pomodoro-run-button .lucide-play'))`), true);
      const progressBeforeEdit = await evaluate(client, sessionId, `JSON.stringify(globalThis.__PATINA_POMODORO_CASE.pomodoro_tasks[0].run)`);
      const editButton = '[data-pomodoro-task-id="42"] button:has(.lucide-pencil-line)';
      const openEditor = async () => {
        await evaluate(client, sessionId, `(()=>{const b=document.querySelector(${JSON.stringify(editButton)});b.focus();b.click()})()`);
        await waitForExpression(client, sessionId, `document.activeElement?.matches('.tools-pomodoro-editor input')`);
      };
      const escape = async () => client.command('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}, sessionId);
      await openEditor();
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.tools-pomodoro-editor input').value`), 'Reading');
      assert.equal(await evaluate(client, sessionId, `document.querySelector('#tools-pomodoro-name').value`), 'New task draft');
      await evaluate(client, sessionId, `document.querySelector('.tools-pomodoro-editor .tools-pomodoro-settings-trigger').click()`);
      await waitForExpression(client, sessionId, `document.activeElement?.id==='tools-pomodoro-focus'`);
      await evaluate(client, sessionId, `(()=>{const i=document.querySelector('#tools-pomodoro-focus');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'30');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await waitForExpression(client, sessionId, `document.querySelector('.tools-pomodoro-editor .tools-pomodoro-settings-trigger').textContent.includes('30')`);
      await escape();
      await waitForExpression(client, sessionId, `!document.querySelector('.tools-pomodoro-settings-popover') && document.activeElement?.matches('.tools-pomodoro-editor .tools-pomodoro-settings-trigger')`);
      await escape();
      await waitForExpression(client, sessionId, `!document.querySelector('.tools-pomodoro-editor') && document.activeElement?.matches(${JSON.stringify(editButton)})`);
      assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_CASE.pomodoro_tasks[0].run.focus_ms`), 1500000, 'cancel discards edited timing');
      await openEditor();
      await client.command('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8}, sessionId);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.activeElement?.closest('.qp-dialog-surface'))`), true);
      await evaluate(client, sessionId, `(()=>{const i=document.querySelector('.tools-pomodoro-editor input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Edited reading');i.dispatchEvent(new Event('input',{bubbles:true}));globalThis.__PATINA_POMODORO_FAILURE=true;})()`);
      await evaluate(client, sessionId, `document.querySelector('.qp-dialog-actions button[type="submit"]').click()`);
      await waitForExpression(client, sessionId, `globalThis.__PATINA_POMODORO_CALLS.some(a=>a.kind==='save'&&a.id===42) && !document.querySelector('.tools-pomodoro-editor input').disabled`);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.tools-pomodoro-editor input').value`), 'Edited reading', 'failed save retains editor draft');
      assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_CASE.pomodoro_tasks[0].label`), 'Reading');
      await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_FAILURE=false;document.querySelector('.qp-dialog-actions button[type="submit"]').click()`);
      await waitForExpression(client, sessionId, `!document.querySelector('.tools-pomodoro-editor') && document.querySelector('[data-pomodoro-task-id="42"]').textContent.includes('Edited reading')`);
      assert.equal(await evaluate(client, sessionId, `JSON.stringify(globalThis.__PATINA_POMODORO_CASE.pomodoro_tasks[0].run)`), progressBeforeEdit, 'renaming preserves paused progress');
      assert.equal(await evaluate(client, sessionId, `document.querySelector('#tools-pomodoro-name').value`), 'New task draft');
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.tools-pomodoro-create .tools-pomodoro-settings-trigger').textContent.includes('45')`), true);
      await evaluate(client, sessionId, `document.querySelector('[data-pomodoro-task-id="42"] .tools-pomodoro-run-button').click()`);
      await waitForExpression(client, sessionId, `globalThis.__PATINA_POMODORO_CASE.current_pomodoro?.id===42`);
      await evaluate(client, sessionId, `document.querySelector('[data-pomodoro-task-id="43"] .tools-pomodoro-run-button').click()`);
      await waitForExpression(client, sessionId, `globalThis.__PATINA_POMODORO_CASE.current_pomodoro?.id===43`);
      assert.deepEqual(await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_CASE.pomodoro_tasks.map(t=>t.run.status)`), ["paused", "running"]);
      const layout = await evaluate(client, sessionId, `({top:document.querySelector('.tools-pomodoro-create').getBoundingClientRect().bottom,bottom:document.querySelector('.tools-pomodoro-task-section').getBoundingClientRect().top,overflow:[...document.querySelectorAll('[data-pomodoro-task-id]')].some(el=>el.scrollWidth>el.clientWidth+1)})`) as { top: number; bottom: number; overflow: boolean };
      assert.ok(layout.top <= layout.bottom); assert.equal(layout.overflow, false);
      const taskHeight = await evaluate(client, sessionId, `document.querySelector('[data-pomodoro-task-id="42"]').getBoundingClientRect().height`);
      await evaluate(client, sessionId, `document.querySelector('.tools-section-tab[aria-label="提醒"]').click()`);
      await waitForExpression(client, sessionId, `document.querySelector('[data-timed-reminder-id="99"]')?.getBoundingClientRect().height > 0`);
      assert.equal(taskHeight, await evaluate(client, sessionId, `document.querySelector('[data-timed-reminder-id="99"]').getBoundingClientRect().height`), 'pomodoro and reminder rows have the same height');
      await evaluate(client, sessionId, `document.querySelector('.tools-section-tab[aria-label="专注"]').click()`);
      await waitForExpression(client, sessionId, `document.querySelector('.tools-pomodoro-settings-trigger')?.getBoundingClientRect().height > 0`);
      await client.command('Emulation.setDeviceMetricsOverride', {width:760,height:820,deviceScaleFactor:1,mobile:false}, sessionId);
      await evaluate(client, sessionId, `document.querySelector('.tools-pomodoro-settings-trigger').click()`);
      await waitForExpression(client, sessionId, `document.activeElement?.id==='tools-pomodoro-focus'`);
      assert.equal(await evaluate(client, sessionId, `(()=>{const p=document.querySelector('.tools-pomodoro-settings-popover'),r=p.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&p.scrollWidth<=p.clientWidth+1})()`), true);
      await client.command('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8}, sessionId);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.activeElement?.closest('.tools-pomodoro-settings-popover'))`), true);
      await client.command('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}, sessionId);
      await waitForExpression(client, sessionId, `!document.querySelector('.tools-pomodoro-settings-popover')`);
      await client.command('Emulation.setDeviceMetricsOverride', {width:1280,height:820,deviceScaleFactor:1,mobile:false}, sessionId);
      await fill("Keep draft");
      await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_FAILURE=true;document.querySelector('.tools-pomodoro-create button[type="submit"]').click()`);
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('.qp-toast[role="alert"]'))`);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('#tools-pomodoro-name').value`), "Keep draft");
      await evaluate(client, sessionId, `document.querySelector('[data-pomodoro-task-id="42"] .qp-icon-action-danger').click()`);
      await waitForExpression(client, sessionId, `globalThis.__PATINA_POMODORO_CALLS.some(a=>a.kind==='delete') && !document.querySelector('[data-pomodoro-task-id="42"] .qp-icon-action-danger').disabled`);
      assert.equal(await evaluate(client, sessionId, `document.querySelectorAll('[data-pomodoro-task-id]').length`), 2, 'failed direct deletion keeps the task available for retry');
      await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_FAILURE=false; document.querySelector('[data-pomodoro-task-id="42"] .qp-icon-action-danger').click()`);
      await waitForExpression(client, sessionId, `document.querySelectorAll('[data-pomodoro-task-id]').length===1`);
      assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_CASE.current_pomodoro.id`), 43);
      await evaluate(client, sessionId, `(()=>{const s=globalThis.__PATINA_POMODORO_CASE,t=s.pomodoro_tasks[0];t.completed_groups=2;Object.assign(t.run,{status:'completed',phase:'long_break',cycle_index:4,phase_remaining_ms:0,phase_started_at:null,phase_paused_at:null,completed_focus_count:8});s.current_pomodoro=t.run;localStorage.setItem('__time_tracker_tools_snapshot_override',JSON.stringify(s));document.documentElement.dataset.completedReload='1';location.reload()})()`);
      await waitForExpression(client, sessionId, `!document.documentElement.dataset.completedReload && document.querySelector('.tools-pomodoro-completed-badge')?.textContent==='2'`);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.tools-pomodoro-task-time > span').textContent`), '已完成');
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.tools-pomodoro-task-time > strong').textContent`), '00:00');
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('.tools-pomodoro-task-actions .lucide-fast-forward'))`), false);
      await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_CASE=JSON.parse(localStorage.getItem('__time_tracker_tools_snapshot_override'));globalThis.__PATINA_POMODORO_CALLS=[];document.querySelector('.tools-pomodoro-run-button').click()`);
      await waitForExpression(client, sessionId, `globalThis.__PATINA_POMODORO_CASE.current_pomodoro.status==='running' && document.querySelector('.tools-pomodoro-task-time > span').textContent==='专注'`);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.tools-pomodoro-completed-badge').textContent`), '2');
      assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_CASE.current_pomodoro.cycle_index`), 1);
    } finally {
      await client.command('Emulation.setDeviceMetricsOverride', {width:1280,height:820,deviceScaleFactor:1,mobile:false}, sessionId);
      await evaluate(client, sessionId, `localStorage.clear();for(const [k,v]of Object.entries(${storage}))localStorage.setItem(k,v);location.reload();`);
      await waitForExpression(client, sessionId, `!globalThis.__PATINA_POMODORO_CASE && Boolean(document.querySelector('main.qp-canvas'))`);
    }
  });
}
