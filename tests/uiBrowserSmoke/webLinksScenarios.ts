import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";
import { webGroupKey } from "../../src/shared/classification/webLinks.ts";

export async function runWebLinksScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  await runTest("automatic websites support exact independent exceptions, merge, cancel, save and group deletion", async () => {
    const previous = await evaluate(client, sessionId, "localStorage.getItem('__time_tracker_smoke_settings')") as string | null;
    const domains = ["chat.deepseek.com", "platform.deepseek.com", "www.deepseek.com", "other.com", "deepseek.com"];
    const icon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#236CC7"/></svg>')}`;
    const rows = domains.map((domain,index)=>({id:2900+index,browser_client_id:'grouping',browser_kind:'chrome',browser_exe_name:'chrome.exe',domain,normalized_domain:domain,url:`https://${domain}/page`,title:domain,favicon_url:index===0?icon:null,start_time:Date.now()-600000,end_time:Date.now()-300000,duration:index===0?300000:50000}));
    let fixture = await client.command('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.__PATINA_CLASSIFICATION_WEB_ROWS=${JSON.stringify(rows)};`},sessionId) as {identifier:string};
    const site = `[data-classification-web='${webGroupKey('deepseek.com')}']`;
    const raw = '[data-classification-web="platform.deepseek.com"]';
    const click = async(selector:string)=>{
      assert.equal(await evaluate(client,sessionId,`(()=>{const n=document.querySelector(${jsonString(selector)});if(!n||n.disabled)return false;n.focus();n.click();return true;})()`),true,selector);
    };
    const button = async(label:string)=>{
      assert.equal(await evaluate(client,sessionId,`(()=>{const n=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${jsonString(label)}&&!n.disabled);n?.click();return !!n;})()`),true,label);
    };
    const reload=async(count:number)=>{
      const origin=await evaluate(client,sessionId,'performance.timeOrigin');
      await evaluate(client,sessionId,'location.reload()');
      await waitForExpression(client,sessionId,`performance.timeOrigin!==${origin} && document.querySelectorAll('[data-classification-web]').length===${count}`);
    };
    const split=async()=>{
      await click(site+' .qp-app-link-trigger');
      await waitForExpression(client,sessionId,`document.querySelectorAll('.qp-app-link-member').length===4`);
      assert.equal(await evaluate(client,sessionId,`document.querySelector('.qp-web-grouping-popover').textContent.includes('添加网页')`),false);
      await click('.qp-web-grouping-popover [aria-label="独立显示: platform.deepseek.com"]');
      await waitForExpression(client,sessionId,`!!document.querySelector(${jsonString(raw)}) && document.querySelectorAll('[data-classification-web]').length===3`);
    };
    try {
      await evaluate(client,sessionId,`localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify({language:'zh-CN',web_activity_enabled:'1',title_recording_enabled:'1'}));localStorage.setItem('patina:classification-object-mode','web');localStorage.setItem('patina:last-active-view','mapping')`);
      await reload(2);
      assert.equal(await evaluate(client,sessionId,`document.querySelector(${jsonString(site+' .qp-app-mapping-name')}).textContent`),'deepseek.com');
      assert.equal(await evaluate(client,sessionId,`document.querySelector(${jsonString(site+' img')}).src`),icon);
      await click(site+' .qp-app-link-trigger');
      await click('.qp-web-grouping-popover [aria-label="记录标题: platform.deepseek.com"]');
      for(const type of ['keyDown','keyUp'])await client.command('Input.dispatchKeyEvent',{type,key:'Escape',windowsVirtualKeyCode:27},sessionId);
      await waitForExpression(client,sessionId,`document.querySelector(${jsonString(site+' [aria-label="记录标题"]')})?.getAttribute('aria-pressed')==='mixed'`);
      await click(site+' [aria-label="记录标题"]');
      await waitForExpression(client,sessionId,`document.querySelector(${jsonString(site+' [aria-label="记录标题"]')})?.getAttribute('aria-pressed')==='true'`);
      await click(site+' .qp-app-link-trigger');
      await click('.qp-web-grouping-popover [aria-label="匿名统计: platform.deepseek.com"]');
      for(const type of ['keyDown','keyUp'])await client.command('Input.dispatchKeyEvent',{type,key:'Escape',windowsVirtualKeyCode:27},sessionId);
      await waitForExpression(client,sessionId,`document.querySelector(${jsonString(site+' [aria-label="匿名统计"]')})?.getAttribute('aria-pressed')==='mixed'`);
      await click(site+' [aria-label="匿名统计"]');
      await waitForExpression(client,sessionId,`!document.querySelector(${jsonString(site)})`);
      await button('取消');
      await waitForExpression(client,sessionId,`!!document.querySelector(${jsonString(site)})`);
      await split();
      assert.equal(await evaluate(client,sessionId,`document.querySelectorAll(${jsonString(raw+' .qp-app-mapping-actions button')}).length`),5);
      await waitForExpression(client,sessionId,`document.querySelector(${jsonString(raw)})?.contains(document.activeElement)`);
      for (const scale of [1, 1.25, 1.5]) {
        await client.command('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:scale,mobile:false},sessionId);
        assert.equal(await evaluate(client,sessionId,`(()=>{const row=document.querySelector(${jsonString(raw)}).getBoundingClientRect();const buttons=[...document.querySelectorAll(${jsonString(raw+' .qp-app-mapping-actions button')})].map(n=>n.getBoundingClientRect());return buttons.every((b,i)=>b.width>=24&&b.left>=row.left&&b.right<=row.right&&(!i||b.left>=buttons[i-1].right));})()`),true);
      }
      await client.command('Emulation.setDeviceMetricsOverride',{width:1280,height:820,deviceScaleFactor:1,mobile:false},sessionId);
      await button('取消');
      await waitForExpression(client,sessionId,`!document.querySelector(${jsonString(raw)})`);
      await split();
      await evaluate(client,sessionId,'globalThis.__PATINA_REJECT_CLASSIFICATION_SAVE=true');
      await button('保存');
      await waitForExpression(client,sessionId,`!!document.querySelector('.qp-app-mapping-error')`);
      assert.equal(await evaluate(client,sessionId,`!!document.querySelector(${jsonString(raw)})`),true);
      await evaluate(client,sessionId,'globalThis.__PATINA_REJECT_CLASSIFICATION_SAVE=false');
      await button('保存');
      await waitForExpression(client,sessionId,`JSON.parse(JSON.parse(localStorage.getItem('__time_tracker_smoke_settings'))['__web_site::deepseek.com']||'{}').exceptions?.includes('platform.deepseek.com')`);
      await reload(3);
      await click(raw+' [aria-label="合并到 deepseek.com"]');
      await waitForExpression(client,sessionId,`!document.querySelector(${jsonString(raw)})`);
      await waitForExpression(client,sessionId,`document.querySelector(${jsonString(site+' .qp-app-link-trigger')})===document.activeElement`);
      await button('保存');
      await waitForExpression(client,sessionId,`!JSON.parse(localStorage.getItem('__time_tracker_smoke_settings'))['__web_site::deepseek.com']`);
      await reload(2);
      await click(site+' .qp-app-link-trigger');
      await click('.qp-web-grouping-popover [aria-label="独立显示: deepseek.com"]');
      await waitForExpression(client,sessionId,`!!document.querySelector('[data-classification-web="deepseek.com"]') && !!document.querySelector(${jsonString(site)})`);
      assert.equal(await evaluate(client,sessionId,`document.querySelector('[data-classification-web="deepseek.com"]').textContent.includes('独立显示')`),false);
      await button('取消');
      await waitForExpression(client,sessionId,`!document.querySelector('[data-classification-web="deepseek.com"]')`);
      await client.command('Page.removeScriptToEvaluateOnNewDocument',{identifier:fixture.identifier},sessionId);
      fixture=await client.command('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.__PATINA_CLASSIFICATION_WEB_ROWS=${JSON.stringify([...rows,{...rows[1],id:2999,domain:'new.deepseek.com',normalized_domain:'new.deepseek.com'}])};`},sessionId) as {identifier:string};
      await reload(2);
      await click(site+' .qp-app-link-trigger');
      await waitForExpression(client,sessionId,`document.querySelectorAll('.qp-app-link-member').length===5`);
      for(const type of ['keyDown','keyUp'])await client.command('Input.dispatchKeyEvent',{type,key:'Escape',windowsVirtualKeyCode:27},sessionId);
      await click(site+' .qp-app-mapping-delete');
      await waitForExpression(client,sessionId,`!!document.querySelector('[role=dialog]')`);
      assert.equal(await evaluate(client,sessionId,`document.querySelector('[role=dialog]').textContent.includes('5 个域名')`),true);
      await button('继续');
      await waitForExpression(client,sessionId,`document.querySelectorAll('[data-classification-web]').length===1`);
      assert.deepEqual(await evaluate(client,sessionId,`globalThis.__PATINA_CLASSIFICATION_WEB_ROWS.map(row=>row.normalized_domain)`),['other.com']);
    } finally {
      await client.command('Page.removeScriptToEvaluateOnNewDocument',{identifier:fixture.identifier},sessionId);
      await evaluate(client,sessionId,`${previous===null?"localStorage.removeItem('__time_tracker_smoke_settings')":`localStorage.setItem('__time_tracker_smoke_settings',${jsonString(previous)})`};localStorage.setItem('patina:classification-object-mode','app');globalThis.__PATINA_REJECT_CLASSIFICATION_SAVE=false`);
    }
  });
}
