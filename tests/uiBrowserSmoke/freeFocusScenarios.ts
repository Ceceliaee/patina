import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, waitForExpression } from "./browserHarness.ts";
import { pomodoroFixture } from "./pomodoroScenarios.ts";

export async function runFreeFocusScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  await runTest("Free focus modes, draft recovery, compact rows and modal editing", async () => {
    const storage = String(await evaluate(client, sessionId, `JSON.stringify({...localStorage})`));
    const snapshot = pomodoroFixture();
    const task = { id: 1, label: "Reading", rest_mode: "ratio", rest_minutes: 5, rest_ratio: 4,
      phase: "focus", status: "paused", elapsed_ms: 23000, rest_remaining_ms: 0, started_at: null, created_at: 1000, updated_at: 2000 };
    const fill = (selector: string, value: string) => evaluate(client, sessionId, `(()=>{const i=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const click = (selector: string) => evaluate(client, sessionId, `document.querySelector(${JSON.stringify(selector)}).click()`);
    const escape = () => client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
    try {
      await evaluate(client, sessionId, `localStorage.removeItem('patina:free-focus-rest-settings')`);
      await evaluate(client, sessionId, `localStorage.setItem('patina:last-active-view','tools');localStorage.setItem('patina:tools-section','pomodoro');localStorage.setItem('__time_tracker_tools_snapshot_override',JSON.stringify(${JSON.stringify(snapshot)}));document.documentElement.dataset.freeReload='1';location.reload()`);
      await waitForExpression(client, sessionId, `!document.documentElement.dataset.freeReload && Boolean(document.querySelector('[data-pomodoro-task-id="42"]'))`);
      await evaluate(client, sessionId, `globalThis.__PATINA_FREE_FOCUS_CASE={calls:[],snapshot:${JSON.stringify(snapshot)}};[...document.querySelectorAll('.tools-focus-header button')].find(b=>b.textContent==='自由专注').click()`);
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('.tools-free-focus-content'))`);
      const layout = await evaluate(client, sessionId, `(()=>{const row=document.querySelector('.tools-free-focus-content .tools-pomodoro-name-row');return [...row.children].slice(0,2).map(e=>e.getBoundingClientRect().width)})()`) as number[];
      assert.ok(Math.abs(layout[0] - layout[1]) < 1, 'name and rest mode are equal width');
      await click('.tools-free-rest-trigger');
      await waitForExpression(client, sessionId, `document.activeElement?.matches('.tools-free-rest-choice input:checked')`);
      assert.equal(await evaluate(client, sessionId, `Math.round(document.querySelector('.tools-free-rest-popover').getBoundingClientRect().width)`), 260);
      assert.equal(await evaluate(client, sessionId, `([...document.querySelectorAll('.tools-free-rest-option')].every(row=>{const r=row.getBoundingClientRect(),i=row.querySelector('input[type="number"]').getBoundingClientRect(),u=row.querySelector('.tools-duration-unit').getBoundingClientRect();return r.height===parseFloat(getComputedStyle(row).minHeight)&&i.top>r.top&&i.bottom<r.bottom&&Math.abs((i.top+i.bottom-u.top-u.bottom)/2)<1}))`), true, 'rest options retain standard dropdown row height with centered, contained inputs and units');
      assert.deepEqual(await evaluate(client, sessionId, `[...document.querySelectorAll('.tools-free-rest-choice span')].map(e=>e.textContent)`), ['固定时长', '比例时长']);
      assert.equal(await evaluate(client, sessionId, `document.querySelectorAll('.tools-free-rest-popover input[type="number"]').length`), 2);
      await client.command('Input.dispatchKeyEvent', {type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40}, sessionId);
      await waitForExpression(client, sessionId, `document.querySelector('.tools-free-rest-choice input[value="ratio"]').checked`);
      await fill('.tools-free-rest-option:has(input[value="ratio"]) input[type="number"]', '4');
      await waitForExpression(client, sessionId, `document.querySelector('.tools-free-rest-trigger').textContent.includes('4:1')`);
      await escape();
      await waitForExpression(client, sessionId, `!document.querySelector('.tools-free-rest-popover') && document.activeElement?.matches('.tools-free-rest-trigger')`);
      await fill('.tools-free-focus-content form input', 'Reading');
      await evaluate(client, sessionId, `globalThis.__PATINA_FREE_FOCUS_CASE.error='synthetic failure'`);
      await click('.tools-free-focus-content button[type="submit"]');
      await waitForExpression(client, sessionId, `globalThis.__PATINA_FREE_FOCUS_CASE.calls.length===1 && !document.querySelector('.tools-free-focus-content form input').disabled`);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.tools-free-focus-content form input').value`), 'Reading');
      assert.deepEqual(await evaluate(client, sessionId, `globalThis.__PATINA_FREE_FOCUS_CASE.calls[0]`), { kind: 'save', id: null, label: 'Reading', restMode: 'ratio', restMinutes: 5, restRatio: 4 });
      await evaluate(client, sessionId, `globalThis.__PATINA_FREE_FOCUS_CASE.error=null;globalThis.__PATINA_FREE_FOCUS_CASE.snapshot.free_focus_tasks=[${JSON.stringify(task)}]`);
      await click('.tools-free-focus-content button[type="submit"]');
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('[data-free-focus-id="1"]'))`);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('[data-free-focus-id] .tools-pomodoro-task-time strong').textContent`), '00:23');
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.tools-free-focus-content form input').value`), '');
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('[data-free-focus-id] .lucide-fast-forward'))`), false);
      for (const error of ['synthetic action failure', null]) {
        await evaluate(client, sessionId, `(()=>{const f=globalThis.__PATINA_FREE_FOCUS_CASE;f.hold=true;f.error=${JSON.stringify(error)};f.release=null;f.calls=[];
          globalThis.__PATINA_FREE_BUTTONS=[...document.querySelectorAll('[data-free-focus-id] button')].map(button=>({button,x:button.getBoundingClientRect().x}));
          const b=document.querySelector('[data-free-focus-id] button:has(.lucide-play)');b.focus();b.click()})()`);
        await waitForExpression(client, sessionId, `Boolean(globalThis.__PATINA_FREE_FOCUS_CASE.release) && document.activeElement?.getAttribute('aria-busy')==='true'`);
        assert.equal(await evaluate(client, sessionId, `(()=>{const items=globalThis.__PATINA_FREE_BUTTONS;items.forEach(({button})=>button.click());return items.every(({button,x})=>button.isConnected&&!button.disabled&&getComputedStyle(button).opacity==='1'&&button.getBoundingClientRect().x===x)&&document.activeElement===items[0].button&&!document.querySelector('.tools-pomodoro-editor')&&globalThis.__PATINA_FREE_FOCUS_CASE.calls.length===1})()`), true, 'pending free focus controls retain focus and appearance without duplicate writes');
        await evaluate(client, sessionId, `globalThis.__PATINA_FREE_FOCUS_CASE.hold=false;globalThis.__PATINA_FREE_FOCUS_CASE.release()`);
        await waitForExpression(client, sessionId, `!document.querySelector('[data-free-focus-id] button[aria-busy]')`);
        assert.equal(await evaluate(client, sessionId, `document.querySelector('[data-free-focus-id] .tools-pomodoro-task-time strong').textContent`), '00:23');
      }
      await fill('.tools-free-focus-content form input', 'Keep draft');
      await click('[data-free-focus-id] button:has(.lucide-pencil-line)');
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('.tools-pomodoro-editor input'))`);
      await fill('.tools-pomodoro-editor input', 'Writing');
      await evaluate(client, sessionId, `globalThis.__PATINA_FREE_FOCUS_CASE.snapshot.free_focus_tasks[0].label='Writing'`);
      await click('.qp-dialog-actions button[type="submit"]');
      await waitForExpression(client, sessionId, `!document.querySelector('.tools-pomodoro-editor') && document.querySelector('[data-free-focus-id]').textContent.includes('Writing')`);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('[data-free-focus-id] .tools-pomodoro-task-time strong').textContent`), '00:23');
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.tools-free-focus-content form input').value`), 'Keep draft');
      await client.command('Emulation.setDeviceMetricsOverride', {width:760,height:820,deviceScaleFactor:1,mobile:false}, sessionId);
      await click('.tools-free-rest-trigger');
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('.tools-free-rest-popover'))`);
      assert.equal(await evaluate(client, sessionId, `(()=>{const p=document.querySelector('.tools-free-rest-popover'),r=p.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&p.scrollWidth<=p.clientWidth+1})()`), true);
      await escape();
      for (const [phase, status, label, icon] of [
        ['focus', 'idle', '开始专注', 'play'], ['focus', 'paused', '继续专注', 'play'],
        ['break', 'running', '暂停', 'pause'], ['break', 'paused', '继续', 'play'],
        ['focus', 'completed', '开始下一次专注', 'play'],
      ]) {
        await evaluate(client, sessionId, `(()=>{const s=globalThis.__PATINA_FREE_FOCUS_CASE.snapshot;Object.assign(s.free_focus_tasks[0],{phase:${JSON.stringify(phase)},status:${JSON.stringify(status)},rest_remaining_ms:5000});s.sampled_at_ms=Date.now();globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed',s)})()`);
        await waitForExpression(client, sessionId, `document.querySelector('[data-free-focus-id] button:has(.lucide-${icon})')?.getAttribute('aria-label')===${JSON.stringify(label)}`);
        if (phase === 'break') {
          const callsBeforeAction = await evaluate(client, sessionId, `globalThis.__PATINA_FREE_FOCUS_CASE.calls.length`);
          const actionSettled = `globalThis.__PATINA_FREE_FOCUS_CASE.calls.length===${callsBeforeAction}+1 && Boolean(document.querySelector('[data-free-focus-id="1"] button:has(.lucide-${icon}):not([aria-busy="true"]):not(:disabled)'))`;
          assert.equal(await evaluate(client, sessionId, actionSettled), false, 'idle controls must not count as a completed action');
          await evaluate(client, sessionId, `globalThis.__PATINA_FREE_FOCUS_CASE.hold=true;globalThis.__PATINA_FREE_FOCUS_CASE.release=null`);
          await click(`[data-free-focus-id] button:has(.lucide-${icon})`);
          await waitForExpression(client, sessionId, `Boolean(globalThis.__PATINA_FREE_FOCUS_CASE.release) && Boolean(document.querySelector('[data-free-focus-id="1"] button[aria-busy="true"]'))`);
          assert.equal(await evaluate(client, sessionId, actionSettled), false, 'a held break action must not satisfy the completion gate');
          await evaluate(client, sessionId, `globalThis.__PATINA_FREE_FOCUS_CASE.hold=false;globalThis.__PATINA_FREE_FOCUS_CASE.release()`);
          await waitForExpression(client, sessionId, actionSettled, undefined, 'free focus break action settles');
          assert.deepEqual(await evaluate(client, sessionId, `globalThis.__PATINA_FREE_FOCUS_CASE.calls.at(-1)`), { kind: status === 'running' ? 'pause' : 'resume', id: 1 });
          assert.equal(await evaluate(client, sessionId, `document.querySelector('[data-free-focus-id] .tools-pomodoro-task-time strong').textContent`), '00:05');
        }
      }
      await evaluate(client, sessionId, `(()=>{const s=globalThis.__PATINA_FREE_FOCUS_CASE.snapshot;Object.assign(s.free_focus_tasks[0],{phase:'focus',status:'running'});s.sampled_at_ms=Date.now();globalThis.__PATINA_EMIT_TAURI_EVENT('tools-runtime-changed',s)})()`);
      await waitForExpression(client, sessionId, `!!document.querySelector('[data-free-focus-id] .lucide-square') && !document.querySelector('[data-free-focus-id] .lucide-play')`);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('[data-free-focus-id] .lucide-pause, [data-free-focus-id] .lucide-rotate-ccw'))`), false, 'running focus keeps only its finish control');
      await evaluate(client, sessionId, `globalThis.__PATINA_FREE_FOCUS_CASE.snapshot.free_focus_tasks=[]`);
      await click('[data-free-focus-id] .qp-icon-action-danger');
      await waitForExpression(client, sessionId, `!document.querySelector('[data-free-focus-id]')`);
      assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_FREE_FOCUS_CASE.calls.at(-1).kind`), 'delete');
      await click('.tools-free-rest-trigger');
      await fill('.tools-free-rest-option:has(input[value="fixed"]) input[type="number"]', '12');
      await fill('.tools-free-rest-option:has(input[value="ratio"]) input[type="number"]', '7');
      await escape();
      await evaluate(client, sessionId, `[...document.querySelectorAll('.tools-focus-header button')].find(b=>b.textContent==='番茄计时').click()`);
      await waitForExpression(client, sessionId, `!document.querySelector('.tools-free-focus-content')`);
      await evaluate(client, sessionId, `[...document.querySelectorAll('.tools-focus-header button')].find(b=>b.textContent==='自由专注').click()`);
      await waitForExpression(client, sessionId, `document.querySelector('.tools-free-rest-trigger')?.textContent.includes('7:1')`);
      await evaluate(client, sessionId, `document.documentElement.dataset.freeReload='1';location.reload()`);
      await waitForExpression(client, sessionId, `!document.documentElement.dataset.freeReload && Boolean(document.querySelector('.tools-focus-header'))`);
      await evaluate(client, sessionId, `[...document.querySelectorAll('.tools-focus-header button')].find(b=>b.textContent==='自由专注').click()`);
      await waitForExpression(client, sessionId, `document.querySelector('.tools-free-rest-trigger')?.textContent.includes('7:1')`);
      await click('.tools-free-rest-trigger');
      assert.deepEqual(await evaluate(client, sessionId, `[...document.querySelectorAll('.tools-free-rest-value')].map(i=>i.value)`), ['12', '7']);
      await click('.tools-free-rest-choice input[value="fixed"]');
      await waitForExpression(client, sessionId, `document.querySelector('.tools-free-rest-trigger').textContent.includes('12')`);
      await escape();
    } finally {
      await client.command('Emulation.setDeviceMetricsOverride', {width:1280,height:820,deviceScaleFactor:1,mobile:false}, sessionId);
      await evaluate(client, sessionId, `localStorage.clear();for(const[k,v]of Object.entries(${storage}))localStorage.setItem(k,v);location.reload()`);
      await waitForExpression(client, sessionId, `!globalThis.__PATINA_FREE_FOCUS_CASE && Boolean(document.querySelector('main.qp-canvas'))`);
    }
  });
}
