import assert from "node:assert/strict";
import { evaluate, jsonString, waitForExpression, waitForStableExpression } from "./browserHarness.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";

export async function runClassificationLinkLayoutMatrix({ client, sessionId, runTest }: BrowserSmokeContext) {
  const stored = await evaluate(client, sessionId, "JSON.stringify(localStorage)");
  try {
    for (const [width, scale, theme, position] of [
      [1280, 1, 'light', 'top'], [1280, 1.25, 'dark', 'middle'], [1280, 1.5, 'light', 'bottom'],
      [760, 1, 'dark', 'bottom'], [760, 1.25, 'light', 'middle'], [760, 1.5, 'dark', 'top'],
    ] as const) {
      await runTest(`link layout stays stable at ${width}px ${scale}x ${theme} ${position}`, async () => {
        await client.command('Emulation.setDeviceMetricsOverride',{width,height:820,deviceScaleFactor:scale,mobile:false},sessionId);
        const origin=await evaluate(client,sessionId,'performance.timeOrigin');
        await evaluate(client,sessionId,`(() => {
          localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify({language:'zh-CN',theme_mode:${jsonString(theme)}}));
          localStorage.setItem('__time_tracker_enable_classification_catalog_fixture','1');localStorage.setItem('__patina_catalog_size','40');
          localStorage.setItem('patina:classification-object-mode','app');localStorage.setItem('patina:last-active-view','mapping');location.reload();
        })()`);
        await waitForExpression(client,sessionId,`performance.timeOrigin!==${origin} && document.querySelectorAll('[data-classification-app]').length===40`);
        const key=await evaluate(client,sessionId,`(() => {
          const cards=[...document.querySelectorAll('[data-classification-app]')];
          const card=cards[${position==='top'?0:position==='middle'?20:39}];card.scrollIntoView({block:'center'});return card.dataset.classificationApp;
        })()`);
        const selector=`[data-classification-app="${key}"]`;
        await waitForStableExpression(client,sessionId,`document.querySelector(${jsonString(selector)}).getBoundingClientRect().bottom<=innerHeight`);
        await evaluate(client,sessionId,`document.querySelector(${jsonString(selector+' .qp-app-link-trigger')}).click()`);
        await waitForExpression(client,sessionId,`!!document.querySelector('.qp-app-link-action')`);
        await evaluate(client,sessionId,`document.querySelector('.qp-app-link-action').click()`);
        await waitForStableExpression(client,sessionId,`(() => {const p=document.querySelector('.qp-app-link-popover');const r=p?.getBoundingClientRect();return document.activeElement===p?.querySelector('input') && r.top>=12 && r.bottom<=innerHeight-12;})()`);
        const results=await evaluate(client,sessionId,`new Promise(resolve=>{
          const card=document.querySelector(${jsonString(selector)}),search=document.querySelector('.qp-app-link-popover input');
          const read=()=>{const c=card.getBoundingClientRect(),s=search.getBoundingClientRect();return {x:c.x,y:c.y,sx:s.x,sy:s.y};};
          const samples=[read()];[...document.querySelectorAll('button.qp-app-link-option')].find(n=>n.textContent.trim()==='catalog-001.exe').click();
          let left=8;const tick=()=>{samples.push(read());if(--left)requestAnimationFrame(tick);else resolve(samples);};requestAnimationFrame(tick);
        })`) as Array<{x:number;y:number;sx:number;sy:number}>;
        for(const sample of results)for(const key of ['x','y','sx','sy'] as const)assert.ok(Math.abs(sample[key]-results[0][key])<=1,JSON.stringify(results));
        for(const type of ['keyDown','keyUp'])await client.command('Input.dispatchKeyEvent',{type,key:'Escape',windowsVirtualKeyCode:27},sessionId);
        await waitForExpression(client,sessionId,`!document.querySelector('.qp-app-link-popover') && document.querySelectorAll('[data-classification-app]').length===39`);
        assert.equal(await evaluate(client,sessionId,`document.querySelectorAll('.qp-app-mapping-list > [aria-hidden="true"]').length`),0);
        const after=await evaluate(client,sessionId,`(() => {const c=document.querySelector(${jsonString(selector)}),s=c.closest('.qp-scroll-region');return {y:c.getBoundingClientRect().y,scroll:s.scrollTop,max:s.scrollHeight-s.clientHeight};})()`) as {y:number;scroll:number;max:number};
        assert.ok(Math.abs(after.y-results[0].y)<=1 || after.scroll===0 || Math.abs(after.scroll-after.max)<=1,JSON.stringify(after));
      });
    }
  } finally {
    await client.command('Emulation.setDeviceMetricsOverride',{width:1280,height:820,deviceScaleFactor:1,mobile:false},sessionId);
    const origin=await evaluate(client,sessionId,'performance.timeOrigin');
    await evaluate(client,sessionId,`(() => {localStorage.clear();for(const [key,value] of Object.entries(JSON.parse(${jsonString(String(stored))})))localStorage.setItem(key,value);location.reload();})()`);
    await waitForExpression(client,sessionId,`performance.timeOrigin!==${origin} && !!document.querySelector('main')`);
  }
}
