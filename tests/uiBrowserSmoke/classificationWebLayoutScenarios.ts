import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";
import { runWebLinksScenarios } from "./webLinksScenarios.ts";

export async function runClassificationWebLayoutScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;
  await runWebLinksScenarios(context);
  await runTest("web classification shares compact cards, responsive spacing and accessible actions", async () => {
    const previousSettings = await evaluate(client!, sessionId, `localStorage.getItem('__time_tracker_smoke_settings')`) as string | null;
    const domains = ['stable.example', 'docs.example', 'long-domain-name-for-classification.example'];
    const rows = domains.map((domain, index) => ({id:1901+index,browser_client_id:'smoke-browser',browser_kind:'chrome',browser_exe_name:'chrome.exe',domain,normalized_domain:domain,url:`https://${domain}/work`,title:'Work',favicon_url:null,start_time:Date.now()-600000,end_time:Date.now()-300000,duration:300000}));
    let fixture = await client!.command("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.__PATINA_CLASSIFICATION_WEB_ROWS = ${JSON.stringify(rows)};` }, sessionId) as { identifier: string };
    const origin = await evaluate(client!, sessionId, "performance.timeOrigin");
    await evaluate(client!, sessionId, `(() => {
      const settings = {language:'zh-CN',web_activity_enabled:'1',title_recording_enabled:'1'};
      settings['__web_domain_override::deleted.example'] = JSON.stringify({displayName:'Previously deleted',category:'office',captureTitle:false});
      for (const domain of ['stable.example','docs.example','long-domain-name-for-classification.example']) {
        settings['__web_domain_override::'+domain] = JSON.stringify({category:'development',enabled:true,color:'#123456'});
      }
      localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify(settings));
      localStorage.setItem('patina:classification-object-mode','web');
      localStorage.setItem('patina:last-active-view','mapping');
      location.reload();
    })()`);
    await waitForExpression(client!, sessionId, `performance.timeOrigin !== ${origin} && document.querySelectorAll('[data-classification-web]').length === 3`);
    for (const locale of ['en-US','es','ru-RU','zh-CN']) {
    for (const theme of ['dark','light']) {
    const previousOrigin=await evaluate(client!,sessionId,'performance.timeOrigin');
    await evaluate(client!,sessionId,`(() => {const settings=JSON.parse(localStorage.getItem('__time_tracker_smoke_settings'));settings.language=${jsonString(locale)};settings.theme_mode=${jsonString(theme)};settings['__web_domain_override::long-domain-name-for-classification.example']=JSON.stringify({category:'development',enabled:true,displayName:'Long classification name for multilingual geometry verification'});localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify(settings));location.reload();})()`);
    await waitForExpression(client!,sessionId,`performance.timeOrigin !== ${previousOrigin} && document.querySelectorAll('[data-classification-web]').length===3`);
    for (const [width, columns] of [[760,1],[1280,2],[1920,3]]) {
      await client!.command("Emulation.setDeviceMetricsOverride", {width,height:820,deviceScaleFactor:1,mobile:false}, sessionId);
      await waitForExpression(client!, sessionId, `getComputedStyle(document.querySelector('.qp-app-mapping-list')).gridTemplateColumns.split(' ').filter(value=>parseFloat(value)>0).length === ${columns}`);
      assert.equal(await evaluate(client!, sessionId, `(() => {
        const grid=document.querySelector('.qp-app-mapping-list'),style=getComputedStyle(grid);
        return style.rowGap==='8px' && style.columnGap==='8px' && [...grid.children].every(row=>{
          const category=row.querySelector('.qp-app-mapping-category').getBoundingClientRect();
          const actions=row.querySelector('.qp-app-mapping-actions').getBoundingClientRect();
          return row.scrollWidth<=row.clientWidth && category.bottom<=actions.top &&
            !row.querySelector('.qp-color-trigger-value') &&
            !row.querySelector('.qp-app-mapping-exe-line .qp-badge') &&
            [...row.querySelectorAll('.qp-app-mapping-actions button')].every(b=>b.getAttribute('aria-label') && !b.textContent.trim());
        });
      })()`), true, `web layout ${locale} ${theme} ${width}`);
      assert.equal(await evaluate(client!,sessionId,`[...document.querySelectorAll('.qp-app-mapping-name,.qp-app-mapping-exe')].every(n=>n.scrollWidth<=n.clientWidth || n.tabIndex===0)`),true,'truncated identities remain keyboard readable');
    }
    }
    }
    await client!.command("Emulation.setDeviceMetricsOverride", {width:1280,height:820,deviceScaleFactor:1,mobile:false}, sessionId);
    const row='[data-classification-web="stable.example"]';
    const click = async (selector: string) => {
      assert.equal(await evaluate(client!, sessionId, `(() => {const n=document.querySelector(${jsonString(selector)});n?.focus();n?.click();return Boolean(n);})()`),true);
    };
    const escape = async () => {
      for (const type of ['keyDown','keyUp']) await client!.command('Input.dispatchKeyEvent',{type,key:'Escape',windowsVirtualKeyCode:27},sessionId);
    };
    const input = async (selector: string,value: string) => {
      await evaluate(client!,sessionId,`(() => {const n=document.querySelector(${jsonString(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${jsonString(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    };
    const button = async (label: string) => {
      assert.equal(await evaluate(client!,sessionId,`(() => {const n=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${jsonString(label)});n?.click();return Boolean(n);})()`),true,label);
    };
    await evaluate(client!,sessionId,`document.querySelector(${jsonString(row+' .qp-app-mapping-category button')}).focus()`);
    for (const selector of ['.qp-color-trigger','[aria-label="记录标题"]','[aria-label="排除统计"]','.qp-app-mapping-delete']) {
      for (const type of ['keyDown','keyUp']) await client!.command('Input.dispatchKeyEvent',{type,key:'Tab',windowsVirtualKeyCode:9},sessionId);
      assert.equal(await evaluate(client!,sessionId,`document.activeElement===document.querySelector(${jsonString(row+' '+selector)}) && parseFloat(getComputedStyle(document.activeElement).outlineWidth)>0`),true,`web keyboard order ${selector}`);
    }
    await evaluate(client!,sessionId,`document.querySelector('[data-classification-web="long-domain-name-for-classification.example"] .qp-app-mapping-name').focus()`);
    await waitForExpression(client!,sessionId,`[...document.querySelectorAll('[role="tooltip"]')].some(n=>n.textContent==='Long classification name for multilingual geometry verification')`);
    await click(`${row} .qp-color-trigger`);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.qp-color-popover [aria-label="恢复默认颜色"]'))`);
    await button('HEX');
    await waitForExpression(client!,sessionId,`document.querySelector('.qp-color-popover input[aria-label="十六进制颜色值"]')?.value.toUpperCase()==='#123456'`);
    await click('.qp-color-popover [aria-label="恢复默认颜色"]');
    await waitForExpression(client!,sessionId,`(() => {const n=document.querySelector('.qp-color-popover input[aria-label="十六进制颜色值"]');return Boolean(n && n.value.toUpperCase()!=='#123456');})()`);
    await escape();
    await waitForExpression(client!, sessionId, `!document.querySelector('.qp-color-popover')`);
    await waitForExpression(client!, sessionId, `document.activeElement===document.querySelector(${jsonString(row+' .qp-color-trigger')})`);
    await click(`${row} .qp-app-mapping-name-line button`);
    await waitForExpression(client!, sessionId, `document.activeElement?.id === 'web-domain-name-stable.example'`);
    await escape();
    await waitForExpression(client!, sessionId, `document.activeElement === document.querySelector(${jsonString(row+' .qp-app-mapping-name-line button')})`);
    await click(`${row} [aria-label="记录标题"]`);
    await waitForExpression(client!, sessionId, `document.querySelector(${jsonString(row+' [aria-label="记录标题"]')}).getAttribute('aria-pressed') === 'false'`);
    await click(`${row} [aria-label="排除统计"]`);
    await waitForExpression(client!, sessionId, `!document.querySelector(${jsonString(row)})`);
    await click('.qp-classification-count-filter [aria-label="排除统计"]');
    await waitForExpression(client!, sessionId, `document.querySelector(${jsonString(row)}).textContent.includes('已排除')`);
    await click(`${row} [aria-label="排除统计"]`);
    await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.qp-classification-count-filter button')).find(n=>n.textContent.startsWith('全部'))?.click()`);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(${jsonString(row)}))`);
    await click(`${row} .qp-app-mapping-delete`);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[role="dialog"]'))`);
    await escape();
    await waitForExpression(client!, sessionId, `!document.querySelector('[role="dialog"]') && Boolean(document.querySelector(${jsonString(row)}))`);
    assert.equal(await evaluate(client!,sessionId,`document.querySelector(${jsonString(row+' [aria-label="记录标题"]')}).getAttribute('aria-pressed')`),'false','title survives exclusion and cancelled deletion');
    await click(`${row} .qp-app-mapping-name-line button`);
    await input(`${row} input`,'Renamed website');
    for (const type of ['keyDown','keyUp']) await client!.command('Input.dispatchKeyEvent',{type,key:'Enter',windowsVirtualKeyCode:13},sessionId);
    assert.equal(await evaluate(client!,sessionId,`document.querySelector(${jsonString(row+' [aria-label="记录标题"]')}).getAttribute('aria-pressed')`),'false','title survives rename');
    await click(`${row} .qp-color-trigger`);
    await button('HEX');
    await input('.qp-color-popover input[aria-label="十六进制颜色值"]','#ABCDEF');
    await escape();
    assert.equal(await evaluate(client!,sessionId,`document.querySelector(${jsonString(row+' [aria-label="记录标题"]')}).getAttribute('aria-pressed')`),'false','title survives color');
    await click(`${row} .qp-app-mapping-category button`);
    await waitForExpression(client!,sessionId,`Boolean(document.querySelector('[role="option"]'))`);
    await evaluate(client!,sessionId,`[...document.querySelectorAll('[role="option"]')].find(n=>n.textContent.trim()==='办公')?.click()`);
    await evaluate(client!,sessionId,'globalThis.__PATINA_REJECT_CLASSIFICATION_SAVE=true');
    await button('保存');
    await waitForExpression(client!,sessionId,`Boolean(document.querySelector('.qp-app-mapping-error')) && [...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='保存')?.disabled===false`);
    await evaluate(client!,sessionId,'globalThis.__PATINA_REJECT_CLASSIFICATION_SAVE=false');
    await button('保存');
    await waitForExpression(client!,sessionId,`[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='保存')?.disabled===true`);
    const saved=await evaluate(client!,sessionId,`JSON.parse(JSON.parse(localStorage.getItem('__time_tracker_smoke_settings'))['__web_domain_override::stable.example'])`) as Record<string,unknown>;
    assert.equal(saved.displayName,'Renamed website');
    assert.equal(String(saved.color).toUpperCase(),'#ABCDEF');
    assert.equal(saved.category,'office');
    assert.equal(saved.captureTitle,false);
    const reloadOrigin=await evaluate(client!,sessionId,'performance.timeOrigin');
    await evaluate(client!,sessionId,'location.reload()');
    await waitForExpression(client!,sessionId,`performance.timeOrigin!==${reloadOrigin} && document.querySelector(${jsonString(row+' .qp-app-mapping-name')})?.textContent==='Renamed website'`);
    assert.equal(await evaluate(client!,sessionId,`document.querySelector(${jsonString(row+' [aria-label="记录标题"]')}).getAttribute('aria-pressed')`),'false');
    await evaluate(client!,sessionId,'globalThis.__PATINA_REJECT_WEB_DELETE=true');
    await click(`${row} .qp-app-mapping-delete`);
    await button('继续');
    await waitForExpression(client!,sessionId,`Boolean(document.querySelector('.qp-app-mapping-error')) && document.querySelector(${jsonString(row+' .qp-app-mapping-delete')})?.disabled===false`);
    assert.deepEqual(await evaluate(client!,sessionId,'globalThis.__PATINA_WEB_DELETE_CALLS'),['stable.example']);
    await evaluate(client!,sessionId,'globalThis.__PATINA_REJECT_WEB_DELETE=false;globalThis.__PATINA_HOLD_WEB_DELETE=true');
    await click(`${row} .qp-app-mapping-delete`);
    await button('继续');
    await waitForExpression(client!,sessionId,`typeof globalThis.__PATINA_RELEASE_WEB_DELETE==='function'`);
    await evaluate(client!,sessionId,`document.querySelector(${jsonString(row+' .qp-app-mapping-delete')}).click()`);
    assert.deepEqual(await evaluate(client!,sessionId,'globalThis.__PATINA_WEB_DELETE_CALLS'),['stable.example','stable.example']);
    await evaluate(client!,sessionId,'globalThis.__PATINA_RELEASE_WEB_DELETE()');
    await waitForExpression(client!,sessionId,`!document.querySelector(${jsonString(row)})`);
    await waitForExpression(client!,sessionId,`document.body.textContent.includes('历史记录已清理。')`);
    assert.equal(await evaluate(client!,sessionId,`document.activeElement===document.querySelector('.qp-category-search input')`), true, 'deleting the focused card returns keyboard navigation to classification search');
    assert.equal(await evaluate(client!,sessionId,`Boolean(JSON.parse(localStorage.getItem('__time_tracker_smoke_settings'))['__web_domain_override::stable.example'])`), true);
    assert.equal(await evaluate(client!,sessionId,`document.querySelector('.qp-classification-count-filter').textContent.includes('全部 (2)')`), true);
    await client!.command("Page.removeScriptToEvaluateOnNewDocument", {identifier:fixture.identifier}, sessionId);
    fixture = await client!.command("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.__PATINA_CLASSIFICATION_WEB_ROWS = ${JSON.stringify(rows.slice(1))};` }, sessionId) as { identifier: string };
    const disabledOrigin=await evaluate(client!,sessionId,'performance.timeOrigin');
    await evaluate(client!,sessionId,`(() => {const settings=JSON.parse(localStorage.getItem('__time_tracker_smoke_settings'));settings.title_recording_enabled='0';localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify(settings));location.reload();})()`);
    await waitForExpression(client!,sessionId,`performance.timeOrigin!==${disabledOrigin} && document.querySelectorAll('[data-classification-web]').length===2`);
    assert.equal(await evaluate(client!,sessionId,`Boolean(document.querySelector(${jsonString(row)}))`), false, 'deleted preferences stay invisible after reload');
    assert.equal(await evaluate(client!,sessionId,`[...document.querySelectorAll('[data-classification-web] [aria-label="记录标题"]')].every(n=>n.disabled && document.getElementById(n.getAttribute('aria-describedby'))?.textContent)`),true);
    await evaluate(client!,sessionId,'globalThis.__PATINA_REJECT_WEB_LINKS_READ=true');
    await click('[data-classification-web="docs.example"] .qp-app-mapping-delete');
    await button('继续');
    await waitForExpression(client!,sessionId,`document.querySelector('.qp-app-mapping-error')?.textContent.includes('刷新失败')`);
    assert.equal(await evaluate(client!,sessionId,`globalThis.__PATINA_CLASSIFICATION_WEB_ROWS.some(r=>r.normalized_domain==='docs.example')`), false, 'delete committed despite refresh failure');
    await evaluate(client!,sessionId,'globalThis.__PATINA_REJECT_WEB_LINKS_READ=false');
    await button('重试');
    await waitForExpression(client!,sessionId,`!document.querySelector('.qp-app-mapping-error') && document.querySelectorAll('[data-classification-web]').length===1`);
    await client!.command("Page.removeScriptToEvaluateOnNewDocument", {identifier:fixture.identifier}, sessionId);
    await evaluate(client!, sessionId, `localStorage.setItem('patina:classification-object-mode','app')`);
    await evaluate(client!, sessionId, `${previousSettings === null ? "localStorage.removeItem('__time_tracker_smoke_settings')" : `localStorage.setItem('__time_tracker_smoke_settings',${jsonString(previousSettings)})`}`);
  });
}
