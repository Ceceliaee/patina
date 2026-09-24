import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";

export async function runLinkedApplicationScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  const stored = await evaluate(client!, sessionId, "JSON.stringify(localStorage)");
  const root = '[data-classification-app="catalog-000.exe"]';
  const child = '[data-classification-app="catalog-001.exe"]';
  const click = async (selector: string) => {
    assert.equal(await evaluate(client!, sessionId, `(() => { const n=document.querySelector(${jsonString(selector)}); n?.click(); return Boolean(n); })()`), true, selector);
  };
  const reload = async () => {
    const origin = await evaluate(client!, sessionId, "performance.timeOrigin");
    await evaluate(client!, sessionId, "location.reload()");
    await waitForExpression(client!, sessionId, `performance.timeOrigin!==${origin} && Boolean(document.querySelector(${jsonString(root)}))`);
  };
  const escape = async () => {
    await client!.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
    await client!.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
    await waitForExpression(client!, sessionId, "!document.querySelector('.qp-app-link-popover')");
  };
  const addChild = async () => {
    await click(`${root} .qp-app-link-trigger`);
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.qp-app-link-popover'))");
    await click('.qp-app-link-action');
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.qp-app-link-popover .qp-search-field input'))");
    assert.equal(await evaluate(client!, sessionId, `['.qp-category-search', '.qp-app-link-popover'].every(selector => {
      const icon=document.querySelector(selector+' .qp-search-field > svg');
      return icon && Math.abs(icon.getBoundingClientRect().width-14)<0.5;
    })`), true);
    await waitForExpression(client!, sessionId, `(() => {
      const panel=document.querySelector('.qp-app-link-popover');
      const list=panel.querySelector('.qp-app-link-list');
      return getComputedStyle(panel).overflowY==='hidden' && panel.scrollHeight<=panel.clientHeight+1
        && list.classList.contains('qp-scroll-region') && list.scrollHeight>list.clientHeight;
    })()`);
    assert.equal(await evaluate(client!, sessionId, `(() => {
      const panel=document.querySelector('.qp-app-link-popover');
      const search=panel.querySelector('input');
      const list=panel.querySelector('.qp-app-link-list');
      const top=search.getBoundingClientRect().top;
      list.scrollTop=list.scrollHeight;
      const valid=list.scrollTop>0 && panel.scrollTop===0 && search.getBoundingClientRect().top===top;
      list.scrollTop=0;
      return valid;
    })()`), true);
    await evaluate(client!, sessionId, `(() => { const n=[...document.querySelectorAll('.qp-app-link-option')].find(n=>n.textContent.includes('catalog-001.exe')); n.click(); })()`);
    await waitForExpression(client!, sessionId, `!document.querySelector(${jsonString(child)})`);
    await escape();
  };
  try {
    await runTest("linked applications support add cancel save reload and unlink without tooltip", async () => {
      await evaluate(client!, sessionId, `(() => {
        localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify({language:'zh-CN',theme_mode:'light'}));
        localStorage.setItem('__time_tracker_enable_classification_catalog_fixture','1');
        localStorage.setItem('patina:classification-object-mode','app');
        localStorage.setItem('patina:last-active-view','mapping');
      })()`);
      await reload();
      assert.equal(await evaluate(client!, sessionId, `Boolean(document.querySelector(${jsonString(`${root} .qp-app-link-trigger svg`)}))`), false);
      await addChild();
      await click(`${root} .qp-app-link-trigger`);
      await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.qp-app-link-popover'))");
      const member = '.qp-app-link-member';
      assert.equal(await evaluate(client!, sessionId, `(() => {
        const row=document.querySelector(${jsonString(member)});
        const name=row.querySelector('span').getBoundingClientRect();
        const buttons=[...row.querySelectorAll('button')];
        const mainIcon=document.querySelector('.qp-app-link-main-icon svg').getBoundingClientRect();
        const unlinkIcon=buttons.at(-1).querySelector('svg').getBoundingClientRect();
        const panel=document.querySelector('.qp-app-link-popover');
        const bounds=panel.getBoundingClientRect();
        const list=panel.querySelector('.qp-app-link-list');
        const heading=panel.querySelector(':scope > strong');
        const headingLeft=heading.getBoundingClientRect().left+parseFloat(getComputedStyle(heading).paddingLeft);
        return Math.abs(mainIcon.right-unlinkIcon.right)<1
          && list.scrollWidth<=list.clientWidth && list.scrollHeight<=list.clientHeight
          && buttons.at(-1).getBoundingClientRect().right<=list.getBoundingClientRect().right
          && Math.abs(headingLeft-name.left)<1
          && Math.abs((name.left-bounds.left)-(bounds.right-unlinkIcon.right))<1
          && getComputedStyle(row.querySelector('.qp-app-link-controls')).gap==='0px'
          && !row.querySelector('input') && buttons.length===3 && buttons.every(button=>{
          const r=button.getBoundingClientRect();
          return Math.abs((r.top+r.bottom)/2-(name.top+name.bottom)/2)<1 && r.width>=24 && r.height>=24;
        });
      })()`), true);
      for (const label of ['记录标题', '匿名统计']) {
        const selector = `${member} [aria-label="${label}"]`;
        const before = await evaluate(client!, sessionId, `document.querySelector(${jsonString(selector)}).getAttribute('aria-pressed')`);
        await click(selector);
        await waitForExpression(client!, sessionId, `document.querySelector(${jsonString(selector)}).getAttribute('aria-pressed')!==${jsonString(String(before))}`);
        await click(selector);
        await waitForExpression(client!, sessionId, `document.querySelector(${jsonString(selector)}).getAttribute('aria-pressed')===${jsonString(String(before))}`);
      }
      await click('[aria-label="解除关联: catalog-001.exe"]');
      await escape();
      await waitForExpression(client!, sessionId, "[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='保存')?.disabled===true");
      await addChild();
      assert.equal(await evaluate(client!, sessionId, `document.activeElement===document.querySelector(${jsonString(`${root} .qp-app-link-trigger`)})`), true);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector(${jsonString(`${root} .qp-app-link-trigger`)}).hasAttribute('title')`), false);
      await evaluate(client!, sessionId, "[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='取消'&&!n.disabled).click()");
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector(${jsonString(child)}))`);
      await addChild();
      await evaluate(client!, sessionId, "[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='保存'&&!n.disabled).click()");
      await waitForExpression(client!, sessionId, "JSON.parse(localStorage.getItem('__time_tracker_smoke_settings')||'{}')['__app_link::catalog-001.exe']==='catalog-000.exe'");
      await reload();
      assert.equal(await evaluate(client!, sessionId, `Boolean(document.querySelector(${jsonString(child)}))`), false);
      for (const [width, scale, theme] of [[800, 1.5, "dark"], [1280, 1, "light"]] as const) {
        await client!.command("Emulation.setDeviceMetricsOverride", { width, height: 700, deviceScaleFactor: scale, mobile: false }, sessionId);
        await evaluate(client!, sessionId, `(() => { const settings=JSON.parse(localStorage.getItem('__time_tracker_smoke_settings')); settings.theme_mode=${jsonString(theme)}; localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify(settings)); })()`);
        await reload();
        await waitForExpression(client!, sessionId, `document.documentElement.dataset.theme===${jsonString(theme)}`);
        await click(`${root} .qp-app-link-trigger`);
        await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.qp-app-link-popover'))");
        await waitForExpression(client!, sessionId, `(() => { const r=document.querySelector('.qp-app-link-popover').getBoundingClientRect(); return r.width>0 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight; })()`);
        await waitForExpression(client!, sessionId, `(() => {
          const panel=document.querySelector('.qp-app-link-popover').getBoundingClientRect();
          const trigger=document.querySelector(${jsonString(`${root} .qp-app-link-trigger`)}).getBoundingClientRect();
          return Math.abs(panel.left-trigger.left)<1 && panel.width<=240;
        })()`);
        const screenshot = await client!.command("Page.captureScreenshot", { format: "png" }, sessionId) as { data: string };
        writeFileSync(join(tmpdir(), `patina-linked-apps-${theme}.png`), Buffer.from(screenshot.data, "base64"));
        await escape();
      }
      await click(`${root} .qp-app-link-trigger`);
      await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.qp-app-link-popover'))");
      await click('[aria-label="解除关联: catalog-001.exe"]');
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector(${jsonString(child)}))`);
      await escape();
      await waitForExpression(client!, sessionId, `document.querySelector(${jsonString(`${child} img`)})?.getAttribute('src')?.includes('blue')===true`);
      await evaluate(client!, sessionId, "[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='保存'&&!n.disabled).click()");
      await waitForExpression(client!, sessionId, "!JSON.parse(localStorage.getItem('__time_tracker_smoke_settings')||'{}')['__app_link::catalog-001.exe']");
    });
    await runTest("linked history list uses parent icon and color for member sessions", async () => {
      await evaluate(client!, sessionId, `(() => {
        localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify({language:'zh-CN',
          '__app_link::cursor.exe':'deep-research-workbench.exe',
          '__app_override::cursor.exe':JSON.stringify({displayName:'Child',color:'#445566',enabled:true}),
          '__app_override::deep-research-workbench.exe':JSON.stringify({displayName:'Linked Parent',color:'#112233',enabled:true})}));
        localStorage.setItem('patina:last-active-view','history');
      })()`);
      const origin = await evaluate(client!, sessionId, 'performance.timeOrigin');
      await evaluate(client!, sessionId, 'location.reload()');
      await waitForExpression(client!, sessionId, `performance.timeOrigin!==${origin} && Boolean(document.querySelector('.history-timeline-open'))`);
      await click('.history-timeline-open');
      await waitForExpression(client!, sessionId, `(() => {
        const rows=[...document.querySelectorAll('.history-timeline-list > div')].filter(n=>n.textContent.includes('Linked Parent'));
        return rows.length>0 && rows.every(n=>n.querySelector('img')?.getAttribute('src')?.includes('257F62')
          && n.firstElementChild.style.backgroundColor==='rgb(17, 34, 51)');
      })()`);
    });
  } finally {
    await client!.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
    await evaluate(client!, sessionId, `(() => { localStorage.clear(); for(const [k,v] of Object.entries(JSON.parse(${jsonString(String(stored))}))) localStorage.setItem(k,v); })()`);
    const origin = await evaluate(client!, sessionId, "performance.timeOrigin");
    await evaluate(client!, sessionId, "location.reload()");
    await waitForExpression(client!, sessionId, `performance.timeOrigin!==${origin} && Boolean(document.querySelector('.qp-app-frame'))`);
  }
}
