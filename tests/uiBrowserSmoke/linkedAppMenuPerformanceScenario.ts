import assert from 'node:assert/strict';
import { evaluate, waitForExpression } from './browserHarness.ts';
import type { BrowserSmokeContext } from './scenarioTypes.ts';

export async function runLinkedAppMenuPerformanceScenario({ client, sessionId, runTest }: BrowserSmokeContext) {
  const module = `import('/tests/uiBrowserSmoke/linkedAppMenuProbe.ts')`;
  await runTest('closed linked menu avoids candidate name work and opens fresh draft candidates', async () => {
    try {
      await evaluate(client, sessionId, `${module}.then(m=>m.mount())`);
      await waitForExpression(client, sessionId, `!!document.querySelector('#linked-menu-probe button')`);
      assert.equal(await evaluate(client, sessionId, `${module}.then(m=>m.nameCalls())`), 0);
      assert.equal(await evaluate(client, sessionId, `${module}.then(m=>m.candidateReads())`), 0);
      await evaluate(client, sessionId, `document.querySelector('#linked-menu-probe button').click();true`);
      await waitForExpression(client, sessionId, `!!document.querySelector('.qp-app-link-popover')`);
      assert.equal(await evaluate(client, sessionId, `${module}.then(m=>m.nameCalls())`), 0);
      await evaluate(client, sessionId, `document.querySelector('.qp-app-link-action').click();true`);
      await waitForExpression(client, sessionId, `document.querySelectorAll('button.qp-app-link-option').length===49`);
      assert.ok(Number(await evaluate(client, sessionId, `${module}.then(m=>m.nameCalls())`)) >= 49);
      await client.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
      await client.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
      await waitForExpression(client, sessionId, `!document.querySelector('.qp-app-link-popover')`);
      assert.equal(await evaluate(client, sessionId, `document.activeElement===document.querySelector('#linked-menu-probe button')`), true);
      await evaluate(client, sessionId, `${module}.then(m=>m.mount({'probe-1.exe':'probe-2.exe'},' renamed'))`);
      await evaluate(client, sessionId, `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      assert.equal(await evaluate(client, sessionId, `${module}.then(m=>m.nameCalls())`), 0);
      await evaluate(client, sessionId, `document.querySelector('#linked-menu-probe button').click();true`);
      await waitForExpression(client, sessionId, `!!document.querySelector('.qp-app-link-action')`);
      await evaluate(client, sessionId, `document.querySelector('.qp-app-link-action').click();true`);
      await waitForExpression(client, sessionId, `document.querySelectorAll('button.qp-app-link-option').length===47`);
      assert.equal(await evaluate(client, sessionId, `[...document.querySelectorAll('button.qp-app-link-option')].some(n=>['probe-1.exe','probe-2.exe'].includes(n.textContent.trim()))`), false);
      await evaluate(client, sessionId, `(() => {const el=document.querySelector('.qp-app-link-popover input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'renamed');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await evaluate(client, sessionId, `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      assert.equal(await evaluate(client, sessionId, `document.querySelectorAll('button.qp-app-link-option').length`), 47);
      await evaluate(client, sessionId, `${module}.then(m=>m.mount({},'renamed',true))`);
      await waitForExpression(client, sessionId, `document.querySelector('#linked-menu-probe button')?.disabled && !document.querySelector('.qp-app-link-popover')`);
      assert.equal(await evaluate(client, sessionId, `${module}.then(m=>m.nameCalls())`), 0);
      // React's development render logger inspects changed props, so subsequent renders
      // count the explicit name callback rather than incidental property reads.
    } finally { await evaluate(client, sessionId, `${module}.then(m=>m.cleanup())`); }
  });
}
