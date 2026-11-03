import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, waitForExpression } from "./browserHarness.ts";
import { pomodoroFixture } from "./pomodoroScenarios.ts";

export async function runPomodoroAlertScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  await runTest("Focus notifications wait for explicit start and preserve the prompt on failure", async () => {
    const storage = String(await evaluate(client, sessionId, `JSON.stringify({...localStorage})`));
    const dialog = '.tools-pomodoro-alert-surface';
    const click = (index: number) => evaluate(client, sessionId, `document.querySelectorAll('${dialog} .qp-dialog-actions button')[${index}].click()`);
    const escape = () => client.command('Input.dispatchKeyEvent', { type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27 }, sessionId);
    try {
      await evaluate(client, sessionId, `localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify({language:'zh-CN'}));document.documentElement.dataset.focusNoticeReload='pending';location.reload()`);
      await waitForExpression(client, sessionId, `!document.documentElement.dataset.focusNoticeReload && !!globalThis.__PATINA_EMIT_TAURI_EVENT && !!document.querySelector('main.qp-canvas')`);
      for (const [index, phase, completed, button] of [
        [0,'short_break',false,'开始休息'],[1,'long_break',false,'开始休息'],
        [2,'focus',false,'开始专注'],[3,'long_break',true,'开始下一组'],
      ] as const) {
        await evaluate(client, sessionId, `
          (() => {
          globalThis.__PATINA_POMODORO_CASE=${JSON.stringify(pomodoroFixture())};
          globalThis.__PATINA_POMODORO_CALLS=[];
          globalThis.__PATINA_POMODORO_FAILURE=false;
          globalThis.__PATINA_POMODORO_HOLD=false;
          const task=globalThis.__PATINA_POMODORO_CASE.pomodoro_tasks[0];
          task.label='${completed ? '' : '阅读文献'}';task.completed_groups=${completed ? 1 : 0};
          Object.assign(task.run,{phase:'${phase}',status:'${completed ? 'completed' : 'paused'}',phase_started_at:null,updated_at:12345,phase_remaining_ms:${completed ? 0 : 60000}});
          globalThis.__PATINA_FOCUS_ALERT={id:'focus-notice-${index}',kind:'pomodoro',title:'阅读文献 · ${completed ? '本组已完成' : phase === 'focus' ? '休息结束' : '专注结束'}',body:'Fallback',occurred_at:12345,pomodoro:structuredClone(task)};
          globalThis.__PATINA_EMIT_TAURI_EVENT('tools-alert',globalThis.__PATINA_FOCUS_ALERT);
          })()
        `);
        await waitForExpression(client, sessionId, `document.querySelector('${dialog} .qp-dialog-actions button:last-child')?.textContent === '${button}' && document.activeElement?.textContent === '${button}'`);
        assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('${dialog} svg'))`), false);
        assert.equal(await evaluate(client, sessionId, `document.querySelector('${dialog} .qp-dialog-title').textContent`), completed ? '番茄任务' : '阅读文献');
        assert.equal(await evaluate(client, sessionId, `getComputedStyle(document.querySelector('${dialog} .qp-dialog-header')).textAlign`), 'center');
        assert.equal(await evaluate(client, sessionId, `Math.abs(document.querySelectorAll('${dialog} .qp-dialog-actions button')[0].getBoundingClientRect().width-document.querySelectorAll('${dialog} .qp-dialog-actions button')[1].getBoundingClientRect().width)<1`), true);
        if (index === 0) {
          await click(0);
          await waitForExpression(client, sessionId, `!document.querySelector('${dialog}')`);
          assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_CALLS.length`), 0);
          await evaluate(client, sessionId, `globalThis.__PATINA_FOCUS_ALERT.id+='-again';globalThis.__PATINA_EMIT_TAURI_EVENT('tools-alert',globalThis.__PATINA_FOCUS_ALERT)`);
          await waitForExpression(client, sessionId, `!!document.querySelector('${dialog}')`);
          await escape();
          await waitForExpression(client, sessionId, `!document.querySelector('${dialog}')`);
          assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_CASE.pomodoro_tasks[0].run.status`), 'paused');
          await evaluate(client, sessionId, `globalThis.__PATINA_FOCUS_ALERT.id+='-retry';globalThis.__PATINA_EMIT_TAURI_EVENT('tools-alert',globalThis.__PATINA_FOCUS_ALERT);globalThis.__PATINA_POMODORO_FAILURE=true;globalThis.__PATINA_POMODORO_HOLD=true;`);
          await waitForExpression(client, sessionId, `!!document.querySelector('${dialog}')`);
          await click(1); await click(1);
          await waitForExpression(client, sessionId, `!!globalThis.__PATINA_POMODORO_RELEASE`);
          await escape();
          assert.equal(await evaluate(client, sessionId, `!!document.querySelector('${dialog}') && [...document.querySelectorAll('${dialog} button')].every(b=>b.disabled) && globalThis.__PATINA_POMODORO_CALLS.length===1`), true);
          await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_RELEASE()`);
          await waitForExpression(client, sessionId, `!!document.querySelector('${dialog} [role="alert"]') && !document.querySelector('${dialog} button').disabled`);
          assert.equal(await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_CASE.pomodoro_tasks[0].run.status`), 'paused');
          await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_FAILURE=false;globalThis.__PATINA_POMODORO_HOLD=false;globalThis.__PATINA_POMODORO_CALLS=[];`);
        }
        await click(1);
        await waitForExpression(client, sessionId, `!document.querySelector('${dialog}') && globalThis.__PATINA_POMODORO_CASE.pomodoro_tasks[0].run.status==='running'`);
        assert.deepEqual(await evaluate(client, sessionId, `globalThis.__PATINA_POMODORO_CALLS`), [{kind:'start_next',id:42,expectedUpdatedAt:12345}]);
      }
    } finally {
      await evaluate(client, sessionId, `localStorage.clear();for(const [k,v] of Object.entries(${storage}))localStorage.setItem(k,v);document.documentElement.dataset.focusNoticeReload='pending';location.reload()`);
      await waitForExpression(client, sessionId, `!document.documentElement.dataset.focusNoticeReload && !!document.querySelector('main.qp-canvas')`);
    }
  });
}
