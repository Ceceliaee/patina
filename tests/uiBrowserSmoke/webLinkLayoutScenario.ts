import assert from "node:assert/strict";
import { webGroupKey } from "../../src/shared/classification/webLinks.ts";
import { evaluate, jsonString, waitForExpression, waitForStableExpression } from "./browserHarness.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";

export async function runWebLinkLayoutScenario({ client, sessionId, runTest }: BrowserSmokeContext) {
  const stored=await evaluate(client,sessionId,'JSON.stringify(localStorage)');
  const domains=Array.from({length:30},(_,index)=>`site${index}.com`);
  const rows=domains.map((domain,index)=>({id:3900+index,browser_client_id:'layout',browser_kind:'chrome',browser_exe_name:'chrome.exe',domain,normalized_domain:domain,url:`https://${domain}/page`,title:domain,favicon_url:null,start_time:Date.now()-600000,end_time:Date.now()-300000,duration:300000}));
  const fixture=await client.command('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.__PATINA_CLASSIFICATION_WEB_ROWS=${JSON.stringify(rows)};globalThis.__PATINA_WEB_ROOTS=${JSON.stringify(Object.fromEntries(domains.map(domain=>[domain,domain])))};`},sessionId) as {identifier:string};
  try {
    await runTest('web regrouping restores the real target when the sole-member group disappears',async()=>{
      const origin=await evaluate(client,sessionId,'performance.timeOrigin');
      await evaluate(client,sessionId,`(() => {
        localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify({language:'zh-CN',web_activity_enabled:'1'}));
        localStorage.setItem('patina:classification-object-mode','web');localStorage.setItem('patina:last-active-view','mapping');location.reload();
      })()`);
      await waitForExpression(client,sessionId,`performance.timeOrigin!==${origin} && document.querySelectorAll('[data-classification-web]').length===30`);
      const group=`[data-classification-web='${webGroupKey('site20.com')}']`;
      const exact='[data-classification-web="site20.com"]';
      await evaluate(client,sessionId,`document.querySelector(${jsonString(group)}).scrollIntoView({block:'center'})`);
      await waitForStableExpression(client,sessionId,`document.querySelector(${jsonString(group)}).getBoundingClientRect().bottom<innerHeight`);
      const top=await evaluate(client,sessionId,`document.querySelector(${jsonString(group)}).getBoundingClientRect().top`);
      await evaluate(client,sessionId,`document.querySelector(${jsonString(group+' .qp-app-link-trigger')}).click()`);
      await waitForExpression(client,sessionId,`!!document.querySelector('[aria-label="独立显示: site20.com"]')`);
      await evaluate(client,sessionId,`document.querySelector('[aria-label="独立显示: site20.com"]').click()`);
      await waitForExpression(client,sessionId,`!!document.querySelector(${jsonString(exact)}) && !document.querySelector(${jsonString(group)}) && !document.querySelector('.qp-app-link-popover')`);
      assert.equal(await evaluate(client,sessionId,`document.querySelector(${jsonString(exact)}).contains(document.activeElement)`),true);
      assert.ok(Math.abs(Number(await evaluate(client,sessionId,`document.querySelector(${jsonString(exact)}).getBoundingClientRect().top`))-Number(top))<=1);
      await evaluate(client,sessionId,`document.querySelector(${jsonString(exact+' [aria-label="合并到 site20.com"]')}).click()`);
      await waitForExpression(client,sessionId,`!!document.querySelector(${jsonString(group)}) && !document.querySelector(${jsonString(exact)})`);
      assert.ok(Math.abs(Number(await evaluate(client,sessionId,`document.querySelector(${jsonString(group)}).getBoundingClientRect().top`))-Number(top))<=1);
      assert.equal(await evaluate(client,sessionId,`document.activeElement===document.querySelector(${jsonString(group+' .qp-app-link-trigger')})`),true);
      assert.equal(await evaluate(client,sessionId,`document.querySelectorAll('.qp-app-mapping-list > [aria-hidden="true"]').length`),0);
    });
  } finally {
    await client.command('Page.removeScriptToEvaluateOnNewDocument',{identifier:fixture.identifier},sessionId);
    const origin=await evaluate(client,sessionId,'performance.timeOrigin');
    await evaluate(client,sessionId,`(() => {localStorage.clear();for(const [key,value] of Object.entries(JSON.parse(${jsonString(String(stored))})))localStorage.setItem(key,value);location.reload();})()`);
    await waitForExpression(client,sessionId,`performance.timeOrigin!==${origin} && !!document.querySelector('main')`);
  }
}
