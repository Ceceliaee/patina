import assert from "node:assert/strict";
import { evaluate, jsonString, waitForExpression, waitForStableExpression } from "./browserHarness.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";

export async function runClassificationLinkLayoutScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  const stored = await evaluate(client, sessionId, "JSON.stringify(localStorage)");
  const card = '[data-classification-app="catalog-020.exe"]';
  const click = async (selector: string) => {
    assert.equal(await evaluate(client, sessionId, `(() => {const n=document.querySelector(${jsonString(selector)});n?.click();return !!n;})()`), true, selector);
  };
  const frames = () => evaluate(client, sessionId, `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  const escape = async () => {
    for (const type of ["keyDown", "keyUp"]) await client.command("Input.dispatchKeyEvent", { type, key: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
    await waitForExpression(client, sessionId, `!document.querySelector('.qp-app-link-popover')`);
  };
  const bounds = (selector: string) => evaluate(client, sessionId, `(() => {const r=document.querySelector(${jsonString(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`) as Promise<{x:number;y:number;width:number;height:number}>;
  const stablePanel = () => waitForStableExpression(client, sessionId, `(() => {
    const p=document.querySelector('.qp-app-link-popover');
    const trigger=document.querySelector('.qp-app-link-trigger[aria-expanded="true"]');
    if(!p || !trigger)return false;
    const r=p.getBoundingClientRect(), a=trigger.getBoundingClientRect();
    return r.top>=12 && r.bottom<=innerHeight-12
      && (Math.abs(r.top-a.bottom-8)<1 || Math.abs(a.top-r.bottom-8)<1);
  })()`);
  const choose = async (exe: string) => {
    assert.equal(await evaluate(client, sessionId, `(() => {const n=[...document.querySelectorAll('button.qp-app-link-option')].find(n=>n.textContent.trim()===${jsonString(exe)});if(!n||n.disabled)return false;n.click();return true;})()`), true, exe);
    await waitForExpression(client, sessionId, `[...document.querySelectorAll('button.qp-app-link-option')].find(n=>n.textContent.trim()===${jsonString(exe)})?.disabled===true`);
  };
  const openAdding = async () => {
    await click(`${card} .qp-app-link-trigger`);
    await waitForExpression(client, sessionId, `!!document.querySelector('.qp-app-link-action')`);
    await click('.qp-app-link-action');
    await waitForExpression(client, sessionId, `document.activeElement===document.querySelector('.qp-app-link-popover input')`);
    await stablePanel();
  };
  try {
    await runTest("linking a preceding application keeps every frame of the active card and search stable", async () => {
      const origin = await evaluate(client, sessionId, "performance.timeOrigin");
      await evaluate(client, sessionId, `(() => {
        localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify({language:'zh-CN',theme_mode:'light'}));
        localStorage.setItem('__time_tracker_enable_classification_catalog_fixture','1');
        localStorage.setItem('patina:classification-object-mode','app');
        localStorage.setItem('patina:last-active-view','mapping');location.reload();
      })()`);
      await waitForExpression(client, sessionId, `performance.timeOrigin!==${origin} && !!document.querySelector(${jsonString(card)})`);
      await evaluate(client, sessionId, `document.querySelector(${jsonString(card)}).scrollIntoView({block:'center'})`);
      await frames();
      await click(`${card} .qp-app-link-trigger`);
      await waitForExpression(client, sessionId, `!!document.querySelector('.qp-app-link-popover')`);
      await click('.qp-app-link-action');
      await waitForExpression(client, sessionId, `document.activeElement===document.querySelector('.qp-app-link-popover input')`);
      await stablePanel();
      const result = await evaluate(client, sessionId, `new Promise(resolve=>{
        const parent=document.querySelector(${jsonString(card)});
        const search=document.querySelector('.qp-app-link-popover input');
        const region=parent.closest('.qp-scroll-region');
        const read=()=>{const r=parent.getBoundingClientRect(),s=search.getBoundingClientRect();return {x:r.x,y:r.y,sx:s.x,sy:s.y,scroll:region.scrollTop,connected:parent.isConnected,open:!!document.querySelector('.qp-app-link-popover')};};
        const samples=[read()];
        [...document.querySelectorAll('button.qp-app-link-option')].find(n=>n.textContent.includes('catalog-001.exe')).click();
        let remaining=8;
        const sample=()=>{samples.push(read());if(--remaining)requestAnimationFrame(sample);else resolve(samples);};requestAnimationFrame(sample);
      })`) as Array<{x:number;y:number;sx:number;sy:number;scroll:number;connected:boolean;open:boolean}>;
      for (const sample of result) {
        assert.ok(sample.connected && sample.open, JSON.stringify(result));
        for (const axis of ["x", "y", "sx", "sy"] as const) assert.ok(Math.abs(sample[axis]-result[0][axis])<=1, `${axis}: ${JSON.stringify(result)}`);
      }
    });
    await runTest("continuous link unlink and re-link preserve slots, live draft counts and close position", async () => {
      const start = await bounds(card);
      const search = await bounds('.qp-app-link-popover input');
      for (const member of ['catalog-000.exe','catalog-019.exe','catalog-021.exe']) {
        await choose(member);
        assert.deepEqual(await bounds(card), start);
        assert.deepEqual(await bounds('.qp-app-link-popover input'), search);
      }
      assert.equal(await evaluate(client, sessionId, `(() => {
        const holes=[...document.querySelectorAll('.qp-app-mapping-list > [aria-hidden="true"]')];
        const focused=document.activeElement;
        holes[0]?.querySelector('button')?.focus();
        return holes.length===4 && holes.every(n=>n.inert && getComputedStyle(n).filter==='grayscale(1)'
          && Number(getComputedStyle(n).opacity)===0.6 && n.querySelector('.qp-app-mapping-name')?.textContent
          && n.querySelector('.qp-app-mapping-icon') && !n.querySelector('button:not(:disabled),input,.qp-app-link-trigger'))
          && document.activeElement===focused
          && [...document.querySelectorAll('button')].some(n=>n.textContent.trim()==='保存'&&!n.disabled)
          && !document.querySelector('[data-classification-app="catalog-001.exe"]');
      })()`), true);
      await click('.qp-app-link-action');
      await waitForExpression(client, sessionId, `document.querySelectorAll('.qp-app-link-member').length===4`);
      await stablePanel();
      const panel = await bounds('.qp-app-link-popover');
      const add = await bounds('.qp-app-link-action');
      for (const member of ['catalog-000.exe','catalog-001.exe','catalog-019.exe','catalog-021.exe']) {
        await click(`[aria-label="解除关联: ${member}"]`);
        await waitForExpression(client, sessionId, `!document.querySelector('[aria-label="解除关联: ${member}"]')`);
        assert.deepEqual(await bounds(card), start);
        assert.deepEqual(await bounds('.qp-app-link-popover'), panel);
        assert.deepEqual(await bounds('.qp-app-link-action'), add);
      }
      await click('.qp-app-link-action');
      await stablePanel();
      await choose('catalog-001.exe');
      await escape();
      assert.ok(Math.abs((await bounds(card)).y-start.y)<=1);
      assert.equal(await evaluate(client, sessionId, `document.querySelectorAll('.qp-app-mapping-list > [aria-hidden="true"]').length`), 0);
      assert.equal(await evaluate(client, sessionId, `document.activeElement===document.querySelector(${jsonString(card+' .qp-app-link-trigger')})`), true);
    });
    await runTest("outside pointer clicks retain the pressed identity and can transfer to another menu", async () => {
      await openAdding();
      await choose('catalog-000.exe');
      const target = '[data-classification-app="catalog-022.exe"] .qp-app-link-trigger';
      const before = await bounds(target);
      const point = { x:before.x+before.width/2, y:before.y+before.height/2, button:'left', clickCount:1 };
      await client.command('Input.dispatchMouseEvent',{type:'mousePressed',...point},sessionId);
      await waitForExpression(client,sessionId,`!document.querySelector('.qp-app-link-popover')`);
      assert.deepEqual(await bounds(target),before,'pointerdown must not move the click target');
      await client.command('Input.dispatchMouseEvent',{type:'mouseReleased',...point},sessionId);
      await waitForExpression(client,sessionId,`document.querySelector(${jsonString(target)})?.getAttribute('aria-expanded')==='true'`);
      await frames();
      assert.equal(await evaluate(client,sessionId,`document.querySelectorAll('.qp-app-link-popover').length`),1);
      await escape();
      await openAdding();
      await choose('catalog-019.exe');
      const control='[data-classification-app="catalog-022.exe"] [aria-label="记录标题"]';
      const pressed=await evaluate(client,sessionId,`document.querySelector(${jsonString(control)}).getAttribute('aria-pressed')`);
      const rect=await bounds(control);
      const controlPoint={x:rect.x+rect.width/2,y:rect.y+rect.height/2,button:'left',clickCount:1};
      await client.command('Input.dispatchMouseEvent',{type:'mousePressed',...controlPoint},sessionId);
      assert.deepEqual(await bounds(control),rect);
      await client.command('Input.dispatchMouseEvent',{type:'mouseReleased',...controlPoint},sessionId);
      await waitForExpression(client,sessionId,`document.querySelector(${jsonString(control)}).getAttribute('aria-pressed')!==${jsonString(String(pressed))}`);
      assert.equal(await evaluate(client,sessionId,`document.querySelectorAll('.qp-app-mapping-list > [aria-hidden="true"]').length`),0);
    });
    await runTest("user scrolling, filtering, resizing and cancelling release the layout session", async () => {
      await openAdding();
      const scroll=await evaluate(client,sessionId,`(() => {const n=document.querySelector(${jsonString(card)}).closest('.qp-scroll-region');n.scrollTop+=120;return n.scrollTop;})()`);
      await waitForExpression(client,sessionId,`!document.querySelector('.qp-app-link-popover')`);
      assert.equal(await evaluate(client,sessionId,`document.querySelector(${jsonString(card)}).closest('.qp-scroll-region').scrollTop`),scroll);
      await openAdding();
      await client.command('Emulation.setDeviceMetricsOverride',{width:800,height:820,deviceScaleFactor:1.5,mobile:false},sessionId);
      await waitForExpression(client,sessionId,`!document.querySelector('.qp-app-link-popover')`);
      await evaluate(client,sessionId,`[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='取消'&&!n.disabled).click()`);
      await waitForExpression(client,sessionId,`!!document.querySelector('[data-classification-app="catalog-001.exe"]')`);
      await evaluate(client,sessionId,`document.querySelector(${jsonString(card)}).scrollIntoView({block:'center'})`);
      await frames();
      await openAdding();
      await evaluate(client,sessionId,`window.dispatchEvent(new Event('resize'))`);
      await frames();
      assert.equal(await evaluate(client,sessionId,`!!document.querySelector('.qp-app-link-popover input')`),true,'a queued resize for the current dimensions must not close a fresh menu');
      await choose('catalog-001.exe');
      await evaluate(client,sessionId,`(() => {const n=document.querySelector('.qp-category-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'catalog-005');n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await waitForExpression(client,sessionId,`!document.querySelector('.qp-app-link-popover') && document.querySelectorAll('[data-classification-app]').length===1`);
      assert.equal(await evaluate(client,sessionId,`document.querySelectorAll('.qp-app-mapping-list > [aria-hidden="true"]').length`),0);
    });
    await runTest("late catalog refresh and failed saving keep live relations without stale slots", async () => {
      await client.command('Emulation.setDeviceMetricsOverride',{width:1280,height:820,deviceScaleFactor:1,mobile:false},sessionId);
      const origin=await evaluate(client,sessionId,'performance.timeOrigin');
      await evaluate(client,sessionId,`localStorage.setItem('__patina_catalog_size','40');location.reload()`);
      await waitForExpression(client,sessionId,`performance.timeOrigin!==${origin} && document.querySelectorAll('[data-classification-app]').length===40`);
      await evaluate(client,sessionId,`document.querySelector(${jsonString(card)}).scrollIntoView({block:'center'})`);
      await frames();
      await openAdding();
      await choose('catalog-001.exe');
      const before=await bounds(card);
      await evaluate(client,sessionId,`import('/src/features/classification/services/classificationService.ts').then(async ({ClassificationService})=>{
        localStorage.setItem('__patina_catalog_size','45');ClassificationService.invalidateAppCatalog();await ClassificationService.refreshAppCatalog();return true;
      })`);
      await waitForExpression(client,sessionId,`[...document.querySelectorAll('button.qp-app-link-option')].some(n=>n.textContent.trim()==='catalog-044.exe')`);
      assert.deepEqual(await bounds(card),before);
      assert.equal(await evaluate(client,sessionId,`document.querySelectorAll('[data-classification-app]').length`),39);
      await choose('catalog-044.exe');
      await evaluate(client,sessionId,`globalThis.__PATINA_REJECT_CLASSIFICATION_SAVE=true;[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='保存'&&!n.disabled).click()`);
      await waitForExpression(client,sessionId,`!!document.querySelector('.qp-app-mapping-error') && !document.querySelector('.qp-app-link-popover')`);
      assert.equal(await evaluate(client,sessionId,`document.querySelectorAll('[data-classification-app]').length`),43);
      assert.equal(await evaluate(client,sessionId,`document.querySelectorAll('.qp-app-mapping-list > [aria-hidden="true"]').length`),0);
      await openAdding();
      assert.equal(await evaluate(client,sessionId,`[...document.querySelectorAll('button.qp-app-link-option')].find(n=>n.textContent.trim()==='catalog-044.exe')?.disabled`),true);
      await escape();
      await evaluate(client,sessionId,`globalThis.__PATINA_REJECT_CLASSIFICATION_SAVE=false;[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='保存'&&!n.disabled).click()`);
      await waitForExpression(client,sessionId,`JSON.parse(localStorage.getItem('__time_tracker_smoke_settings'))['__app_link::catalog-044.exe']==='catalog-020.exe'`);
      await openAdding();
      const navigation='[aria-label="历史"]';
      const rect=await bounds(navigation);
      const point={x:rect.x+rect.width/2,y:rect.y+rect.height/2,button:'left',clickCount:1};
      await client.command('Input.dispatchMouseEvent',{type:'mousePressed',...point},sessionId);
      await client.command('Input.dispatchMouseEvent',{type:'mouseReleased',...point},sessionId);
      await waitForExpression(client,sessionId,`document.querySelector('main')?.dataset.presentedView==='history'`);
      await frames();
      assert.equal(await evaluate(client,sessionId,`document.querySelectorAll('.qp-app-link-popover').length`),0);
    });
    await runTest("removing the last matching member returns keyboard focus to the search field",async()=>{
      const origin=await evaluate(client,sessionId,'performance.timeOrigin');
      await evaluate(client,sessionId,`(() => {
        localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify({language:'zh-CN',
          '__app_link::catalog-001.exe':'catalog-020.exe',
          '__app_override::catalog-020.exe':JSON.stringify({enabled:true,track:false})}));
        localStorage.setItem('patina:last-active-view','mapping');location.reload();
      })()`);
      await waitForExpression(client,sessionId,`performance.timeOrigin!==${origin} && !!document.querySelector(${jsonString(card)})`);
      await evaluate(client,sessionId,`document.querySelector(${jsonString(card)}).scrollIntoView({block:'center'})`);
      await frames();
      await click(card+' .qp-app-link-trigger');
      await waitForExpression(client,sessionId,`!!document.querySelector('.qp-app-link-member [aria-label="匿名统计"]')`);
      await evaluate(client,sessionId,`const n=document.querySelector('.qp-app-link-member [aria-label="匿名统计"]');n.focus();n.click()`);
      await waitForExpression(client,sessionId,`!document.querySelector(${jsonString(card)}) && !document.querySelector('.qp-app-link-popover')`);
      assert.equal(await evaluate(client,sessionId,`document.activeElement===document.querySelector('.qp-category-search input')`),true);
      assert.equal(await evaluate(client,sessionId,`document.querySelectorAll('.qp-app-mapping-list > [aria-hidden="true"]').length`),0);
    });
  } finally {
    await client.command('Emulation.setDeviceMetricsOverride',{width:1280,height:820,deviceScaleFactor:1,mobile:false},sessionId);
    const origin = await evaluate(client, sessionId, "performance.timeOrigin");
    await evaluate(client, sessionId, `(() => {localStorage.clear();for(const [key,value] of Object.entries(JSON.parse(${jsonString(String(stored))})))localStorage.setItem(key,value);location.reload();})()`);
    await waitForExpression(client, sessionId, `performance.timeOrigin!==${origin} && !!document.querySelector('main')`);
  }
}
