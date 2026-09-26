import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";

export async function runClassificationAppLayoutScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  const row = '[data-classification-app="catalog-000.exe"]';
  const title = `${row} [aria-label="记录标题"]`;
  const color = `${row} .qp-color-trigger`;
  const key = async (key: string, code: number) => {
    for (const type of ["keyDown", "keyUp"]) {
      await client!.command("Input.dispatchKeyEvent", { type, key, windowsVirtualKeyCode: code, text: type === "keyDown" && key === "Enter" ? "\r" : undefined }, sessionId);
    }
  };
  const click = async (selector: string) => {
    assert.equal(await evaluate(client!, sessionId, `(() => { const n=document.querySelector(${jsonString(selector)}); n?.focus(); n?.click(); return Boolean(n); })()`), true, selector);
  };
  const button = async (text: string) => {
    assert.equal(await evaluate(client!, sessionId, `(() => { const n=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${jsonString(text)}); n?.click(); return Boolean(n); })()`), true, text);
  };
  const reload = async (locale: string, theme: string, globalTitle = true) => {
    const origin = await evaluate(client!, sessionId, "performance.timeOrigin");
    await evaluate(client!, sessionId, `(() => {
      const settings = { language:${jsonString(locale)},theme_mode:${jsonString(theme)},title_recording_enabled:${jsonString(globalTitle ? "1" : "0")}};
      settings['__app_override::catalog-000.exe']=JSON.stringify({category:'development',enabled:true,color:'#123456'});
      settings['__app_override::catalog-001.exe']=JSON.stringify({category:'office',enabled:true,captureTitle:false});
      localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify(settings));
      localStorage.setItem('__time_tracker_enable_classification_catalog_fixture','1');
      localStorage.setItem('patina:classification-object-mode','app');
      localStorage.setItem('patina:sidebar-navigation-mode','icons');
      localStorage.setItem('patina:last-active-view','mapping');
      location.reload();
    })()`);
    await waitForExpression(client!, sessionId, `performance.timeOrigin!==${origin} && document.documentElement.lang===${jsonString(locale)} && document.querySelectorAll('[data-classification-app]').length>5`);
  };
  const stored = await evaluate(client!, sessionId, "JSON.stringify(localStorage)");
  try {
    await runTest("compact application rows retain density, geometry and accessible icon controls", async () => {
      for (const [locale, theme] of [["zh-CN", "light"], ["en-US", "dark"], ["es", "light"]]) {
        await reload(locale, theme);
        for (const width of [720, 1024, 1100, 1280, 1600, 1920, 2560, 3840]) {
          await client!.command("Emulation.setDeviceMetricsOverride", { width, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
          await waitForExpression(client!, sessionId, `innerWidth===${width}`);
          const geometry = await evaluate(client!, sessionId, `(() => {
            const rows=[...document.querySelectorAll('[data-classification-app]')];
            const region=rows[0].parentElement.parentElement.getBoundingClientRect();
            const first=rows[0].getBoundingClientRect(), second=rows[1].getBoundingClientRect();
            return {
              height:first.height, gap:second.top-first.bottom,
              columns:getComputedStyle(rows[0].parentElement).gridTemplateColumns.split(' ').length,
              visible:rows.filter(n=>{const r=n.getBoundingClientRect();return r.top>=region.top&&r.bottom<=region.bottom}).length,
              contained:rows.every(n=>{const r=n.getBoundingClientRect();return n.scrollWidth<=n.clientWidth && [...n.querySelectorAll('button')].every(b=>{const x=b.getBoundingClientRect();return x.left>=r.left&&x.right<=r.right&&x.top>=r.top&&x.bottom<=r.bottom;});}),
              codes:document.querySelectorAll('[data-classification-app] .qp-color-trigger-value').length,
              iconLabels:rows.every(n=>[...n.querySelectorAll('.qp-app-mapping-controls .qp-icon-action')].every(b=>b.getAttribute('aria-label')&&b.textContent.trim()===''&&b.getBoundingClientRect().width>=28)),
              centered:rows.every(n=>{const icon=n.querySelector('.qp-app-mapping-icon').getBoundingClientRect(),details=n.querySelector('.qp-app-mapping-details').getBoundingClientRect();return Math.abs(icon.top+icon.height/2-details.top-details.height/2)<1;}),
            };
          })()` ) as { height: number; gap: number; columns: number; visible: number; contained: boolean; codes: number; iconLabels: boolean; centered: boolean };
          assert.equal(geometry.contained, true, `${locale} ${width}`);
          assert.equal(geometry.codes, 0);
          assert.equal(geometry.iconLabels, true);
          assert.equal(geometry.centered, true);
          assert.equal(await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('[data-classification-app]')).every(row => {
            const category = row.querySelector('.qp-app-mapping-category').getBoundingClientRect();
            const actions = row.querySelector('.qp-app-mapping-actions').getBoundingClientRect();
            const identity = row.querySelector('.qp-app-mapping-identity').getBoundingClientRect();
            return category.bottom <= actions.top && identity.right <= category.left;
          })`), true, `stack only the controls: ${locale} ${width}`);
          assert.equal(await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('[data-classification-app]')).every(row => {
            const textLeft = selector => {
              const node = row.querySelector(selector);
              const style = getComputedStyle(node);
              return node.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
            };
            return Math.abs(textLeft('.qp-app-mapping-name') - textLeft('.qp-app-mapping-exe')) < 1;
          })`), true, `identity text alignment: ${locale} ${width}`);
          if (width === 1280) {
            assert.equal(geometry.columns, 2);
            assert.ok(geometry.height <= 96, JSON.stringify(geometry));
            assert.ok(geometry.visible >= 6, JSON.stringify(geometry));
            console.log(`Application layout ${locale} 1280x820: ${JSON.stringify(geometry)}`);
          }
          if (width === 1100) assert.equal(geometry.columns, 2);
          if (width === 1920) assert.equal(geometry.columns, 3);
          if (width >= 2560) assert.equal(geometry.columns, 3);
        }
        for (const [listWidth, expectedColumns] of [[807, 1], [808, 2], [1215, 2], [1216, 3], [2800, 3]]) {
          const chromeWidth = await evaluate(client!, sessionId, `innerWidth-document.querySelector('.qp-app-mapping-list').getBoundingClientRect().width`) as number;
          const width = Math.round(listWidth + chromeWidth);
          await client!.command("Emulation.setDeviceMetricsOverride", { width, height: 820, deviceScaleFactor: 1.5, mobile: false }, sessionId);
          await waitForExpression(client!, sessionId, `innerWidth===${width}`);
          const layout = await evaluate(client!, sessionId, `(() => {const n=document.querySelector('.qp-app-mapping-list');const s=getComputedStyle(n);return {width:n.getBoundingClientRect().width,columns:s.gridTemplateColumns.split(' ').length,gap:s.columnGap};})()`) as { width: number; columns: number; gap: string };
          assert.equal(layout.width, listWidth);
          assert.equal(layout.columns, expectedColumns, `${locale} ${JSON.stringify(layout)}`);
          assert.equal(layout.gap, "8px");
        }
      }
    });
    await runTest("application swatches and title icons preserve drafts, reset, keyboard and global limits", async () => {
      await client!.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
      await reload("zh-CN", "light");
      const initialMutations = await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_CLASSIFICATION_MUTATIONS.length`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector(${jsonString(title)}).getAttribute('aria-pressed')`), "true");
      await evaluate(client!, sessionId, `document.querySelector(${jsonString(title)}).focus()`);
      await key(" ", 32);
      await waitForExpression(client!, sessionId, `document.querySelector(${jsonString(title)}).getAttribute('aria-pressed')==='false'`);
      assert.equal(await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_CLASSIFICATION_MUTATIONS.length`), initialMutations);
      await button("取消");
      await waitForExpression(client!, sessionId, `document.querySelector(${jsonString(title)}).getAttribute('aria-pressed')==='true'`);
      await evaluate(client!, sessionId, `document.querySelector(${jsonString(color)}).focus()`);
      await key("Enter", 13);
      await waitForExpression(client!, sessionId, `document.activeElement?.classList.contains('qp-color-popover-title')`);
      assert.equal(await evaluate(client!, sessionId, `(() => {const reset=document.querySelector('.qp-color-popover-head [aria-label="恢复默认颜色"]');return Boolean(reset)&&reset.textContent.trim()==='';})()`), true);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('input[aria-label="十六进制颜色值"]').value`), "#123456");
      await click('.qp-color-popover [aria-label="恢复默认颜色"]');
      await waitForExpression(client!, sessionId, `document.querySelector('input[aria-label="十六进制颜色值"]').value!=='#123456'`);
      await key("Escape", 27);
      await waitForExpression(client!, sessionId, `document.activeElement===document.querySelector(${jsonString(color)}) && !document.querySelector('.qp-color-popover')`);
      await button("取消");
      await click(color);
      await waitForExpression(client!, sessionId, `document.querySelector('input[aria-label="十六进制颜色值"]')?.value==='#123456'`);
      await click('.qp-color-popover [aria-label="恢复默认颜色"]');
      await key("Escape", 27);
      await button("保存");
      await waitForExpression(client!, sessionId, `globalThis.__TIME_TRACKER_CLASSIFICATION_MUTATIONS.some(n=>n.key==='__app_override::catalog-000.exe')`);
      assert.equal(await evaluate(client!, sessionId, `JSON.parse(JSON.parse(localStorage.getItem('__time_tracker_smoke_settings'))['__app_override::catalog-000.exe']).color ?? null`), null);
      await reload("zh-CN", "dark", false);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector(${jsonString(title)}).disabled`), true);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector(${jsonString(title)}).getAttribute('aria-pressed')`), "true");
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('#classification-global-title-disabled')?.textContent`), "全局标题已关闭");
      assert.equal(await evaluate(client!, sessionId, `document.querySelector(${jsonString(title)}).getAttribute('aria-describedby')?.includes('classification-global-title-disabled')`), true);
      await click(`${row} .qp-app-mapping-delete`);
      await waitForExpression(client!, sessionId, `document.querySelector('.qp-dialog-surface') && document.activeElement?.textContent==='取消'`);
      await key("Escape", 27);
      await waitForExpression(client!, sessionId, `!document.querySelector('.qp-dialog-surface')`);
      await waitForExpression(client!, sessionId, `document.activeElement===document.querySelector(${jsonString(row + ' .qp-app-mapping-delete')})`);
      assert.equal(await evaluate(client!, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.filter(n=>n.command==='cmd_delete_sessions_by_exe_names').length`), 0);
    });
    await runTest("application actions keep failed drafts retryable and guard repeated deletion", async () => {
      await reload("zh-CN", "light");
      await click(title);
      await evaluate(client!, sessionId, `globalThis.__PATINA_REJECT_CLASSIFICATION_SAVE=true`);
      await button("保存");
      await waitForExpression(client!, sessionId, `document.querySelector('[role="alert"]')?.textContent==='保存失败，请重试。'`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector(${jsonString(title)}).getAttribute('aria-pressed')`), "false");
      await evaluate(client!, sessionId, `globalThis.__PATINA_REJECT_CLASSIFICATION_SAVE=false`);
      await button("保存");
      await waitForExpression(client!, sessionId, `JSON.parse(JSON.parse(localStorage.getItem('__time_tracker_smoke_settings'))['__app_override::catalog-000.exe']).captureTitle===false`);
      await evaluate(client!, sessionId, `globalThis.__PATINA_REJECT_APP_DELETE=true`);
      await click(`${row} .qp-app-mapping-delete`);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.qp-dialog-surface'))`);
      await button("继续");
      await waitForExpression(client!, sessionId, `document.querySelector('[role="alert"]')?.textContent==='删除记录未完成，请重试。'`);
      assert.equal(await evaluate(client!, sessionId, `Boolean(document.querySelector(${jsonString(row)}))`), true);
      await evaluate(client!, sessionId, `globalThis.__PATINA_REJECT_APP_DELETE=false; globalThis.__PATINA_HOLD_APP_DELETE=true`);
      await click(`${row} .qp-app-mapping-delete`);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.qp-dialog-surface'))`);
      await evaluate(client!, sessionId, `(() => {const confirm=[...document.querySelectorAll('.qp-dialog-surface button')].find(n=>n.textContent==='继续');confirm.click();confirm.click();})()`);
      await waitForExpression(client!, sessionId, `typeof globalThis.__PATINA_RELEASE_APP_DELETE==='function'`);
      await evaluate(client!, sessionId, `document.querySelector(${jsonString(row + ' .qp-app-mapping-delete')}).click()`);
      assert.equal(await evaluate(client!, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.filter(n=>n.command==='cmd_delete_sessions_by_exe_names').length`), 2);
      await evaluate(client!, sessionId, `globalThis.__PATINA_RELEASE_APP_DELETE()`);
      await waitForExpression(client!, sessionId, `document.querySelector(${jsonString(row + ' .qp-app-mapping-delete')})?.disabled===false`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('[role="alert"]')`), null);
    });
    await runTest("application identity keeps plain filename typography and icon tint with keyboard-safe editing and exclusion", async () => {
      await reload("zh-CN", "light");
      assert.equal(await evaluate(client!, sessionId, `getComputedStyle(document.querySelector(${jsonString(row + ' .qp-app-mapping-icon')})).boxShadow.includes('18, 52, 86')`), true);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector(${jsonString(row + ' .qp-app-mapping-exe')}).classList.contains('qp-badge')`), false);
      assert.deepEqual(await evaluate(client!, sessionId, `(() => {const s=getComputedStyle(document.querySelector(${jsonString(row + ' .qp-app-mapping-exe')}));return [s.fontSize,s.fontWeight,s.borderTopWidth,s.borderTopLeftRadius,s.backgroundColor];})()`), ["12px", "550", "0px", "8px", "rgba(0, 0, 0, 0)"]);
      assert.equal(await evaluate(client!, sessionId, `getComputedStyle(document.querySelector(${jsonString(color)})).borderTopColor`), "rgba(0, 0, 0, 0)");
      await click(`${row} [aria-label="修改应用名称"]`);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector(${jsonString(row + ' input')}))`);
      const originalName = await evaluate(client!, sessionId, `document.querySelector(${jsonString(row + ' input')}).value`);
      const longName = "Application with a deliberately long identity 应用名称".repeat(4);
      const inputName = async () => evaluate(client!, sessionId, `(() => { const n=document.querySelector(${jsonString(row + ' input')});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${jsonString(longName)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await inputName();
      await key("Escape", 27);
      await waitForExpression(client!, sessionId, `document.querySelector(${jsonString(row + ' .qp-app-mapping-name')})?.textContent===${jsonString(String(originalName))}`);
      await click(`${row} [aria-label="修改应用名称"]`);
      await inputName();
      await key("Enter", 13);
      await waitForExpression(client!, sessionId, `document.querySelector(${jsonString(row + ' .qp-app-mapping-name')})?.tabIndex===0`);
      await evaluate(client!, sessionId, `document.querySelector(${jsonString(row + ' .qp-app-mapping-name')}).focus()`);
      await waitForExpression(client!, sessionId, `document.querySelector('[role="tooltip"]')?.textContent===${jsonString(longName)}`);
      await key("Escape", 27);
      await button("取消");
      await click(`${row} [aria-label="匿名统计"]`);
      await waitForExpression(client!, sessionId, `!document.querySelector(${jsonString(row)}) && document.activeElement!==document.body`);
      await click('.qp-classification-count-filter [aria-label="匿名统计"]');
      await waitForExpression(client!, sessionId, `document.querySelector(${jsonString(row + ' [aria-label="匿名统计"]')})?.getAttribute('aria-pressed')==='true'`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector(${jsonString(row)}).textContent.includes('匿名统计')`), true);
      await click(`${row} [aria-label="修改应用名称"]`);
      await inputName();
      await key("Enter", 13);
      assert.equal(await evaluate(client!, sessionId, `(() => {
        const line = document.querySelector(${jsonString(row + ' .qp-app-mapping-name-line')});
        const badge = line.querySelector('.qp-badge');
        const name = line.querySelector('.qp-app-mapping-name');
        return badge.scrollWidth <= badge.clientWidth
          && badge.getBoundingClientRect().right <= line.getBoundingClientRect().right + 1
          && name.scrollWidth > name.clientWidth;
      })()`), true, 'long names truncate while the status badge remains fully visible');
      await click(`${row} [aria-label="匿名统计"]`);
      await waitForExpression(client!, sessionId, `!document.querySelector(${jsonString(row)})`);
      await client!.command("Emulation.setDeviceMetricsOverride", { width: 1100, height: 820, deviceScaleFactor: 1.5, mobile: false }, sessionId);
      const origin = await evaluate(client!, sessionId, "performance.timeOrigin");
      await evaluate(client!, sessionId, `localStorage.removeItem('__time_tracker_enable_classification_catalog_fixture');location.reload()`);
      await waitForExpression(client!, sessionId, `performance.timeOrigin!==${origin} && Boolean(document.querySelector('.qp-app-mapping-exe'))`);
      // Give the existing filename a deterministic overflow constraint, independent of column breakpoints.
      await evaluate(client!, sessionId, `document.querySelector('[data-classification-app="deep-research-workbench.exe"] .qp-app-mapping-details').style.maxWidth='100px'`);
      const filename = await evaluate(client!, sessionId, `(() => {const n=document.querySelector('[data-classification-app="deep-research-workbench.exe"] .qp-app-link-trigger');n.focus();return n.textContent;})()`);
      await key("Enter", 13);
      await waitForExpression(client!, sessionId, `document.querySelector('.qp-app-link-popover')?.textContent.includes(${jsonString(String(filename))})`);
      assert.equal(await evaluate(client!, sessionId, `Boolean(document.querySelector('[role="tooltip"]'))`), false);
      await key("Escape", 27);
      await waitForExpression(client!, sessionId, `!document.querySelector('.qp-app-link-popover') && document.activeElement.classList.contains('qp-app-link-trigger')`);
    });
  } catch (error) {
    console.error("Application layout failure state", await evaluate(client!, sessionId, `({text:document.body.innerText.slice(-500),focus:document.activeElement?.outerHTML.slice(0,700),expanded:document.querySelector(${jsonString(color)})?.outerHTML})`));
    throw error;
  } finally {
    await client!.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
    const origin = await evaluate(client!, sessionId, "performance.timeOrigin");
    await evaluate(client!, sessionId, `(() => { localStorage.clear(); for(const [key,value] of Object.entries(JSON.parse(${jsonString(String(stored))}))) localStorage.setItem(key,value); location.reload(); })()`);
    await waitForExpression(client!, sessionId, `performance.timeOrigin!==${origin} && Boolean(document.querySelector('main'))`);
  }
}
