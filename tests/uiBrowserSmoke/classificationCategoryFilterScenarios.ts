import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";

export async function runClassificationCategoryFilterScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  await runTest("category filter keeps maximum-length names usable in a compact multilingual popover", async () => {
    const stored = await evaluate(client!, sessionId, `localStorage.getItem('__time_tracker_smoke_settings')`);
    try {
      for (const [locale, theme] of [["zh-CN", "light"], ["en-US", "dark"], ["es", "light"]]) {
        const previousOrigin = await evaluate(client!, sessionId, "performance.timeOrigin");
        await client!.command("Emulation.setDeviceMetricsOverride", { width: 720, height: 650, deviceScaleFactor: 1.5, mobile: false }, sessionId);
        await client!.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, sessionId);
        await evaluate(client!, sessionId, `(() => {
          const settings = { language: ${jsonString(locale)}, theme_mode: ${jsonString(theme)}, web_activity_enabled: '1' };
          for (let i = 0; i < 30; i++) {
            const category = 'custom:category_filter_' + String(i).padStart(2, '0');
            settings['__app_override::catalog-' + String(i).padStart(3, '0') + '.exe'] = JSON.stringify({category, track:i !== 29, enabled:true});
            settings['__category_label_override::' + category] = ${jsonString(locale)} === 'zh-CN'
              ? '分类' + String(i).padStart(2, '0') + '上限'
              : 'WWWWWWWWWW' + String(i).padStart(2, '0');
          }
          localStorage.setItem('__time_tracker_smoke_settings', JSON.stringify(settings));
          localStorage.setItem('__time_tracker_enable_classification_catalog_fixture', '1');
          localStorage.setItem('patina:classification-object-mode', 'app');
          localStorage.setItem('patina:last-active-view', 'mapping');
          location.reload();
        })()`);
        await waitForExpression(client!, sessionId, `performance.timeOrigin !== ${previousOrigin} && document.documentElement.lang === ${jsonString(locale)} && Boolean(document.querySelector('[data-sidebar-nav-item="mapping"]'))`);
        await evaluate(client!, sessionId, `document.querySelector('[data-sidebar-nav-item="mapping"]').click()`);
        await waitForExpression(client!, sessionId, `document.querySelector('.qp-category-filter-trigger')?.disabled === false`);
        await evaluate(client!, sessionId, `document.querySelector('.qp-category-filter-trigger').click()`);
        await waitForExpression(client!, sessionId, `document.activeElement?.getAttribute('role') === 'listbox' && document.querySelectorAll('.qp-category-filter-option').length === 30`);
        assert.equal(await evaluate(client!, sessionId, `(() => {
          const node = document.querySelector('.qp-category-filter-popover');
          const list = document.querySelector('.qp-category-filter-list');
          const r = node.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
            && node.scrollWidth <= node.clientWidth && list.scrollHeight > list.clientHeight;
        })()`), true);
        await evaluate(client!, sessionId, `document.querySelectorAll('.qp-category-filter-option')[28].click()`);
        await waitForExpression(client!, sessionId, `document.querySelectorAll('[data-classification-app]').length === 1`);
        await evaluate(client!, sessionId, `document.querySelector('.qp-category-filter-trigger').click()`);
        await waitForExpression(client!, sessionId, `document.querySelector('.qp-category-filter-list')?.scrollTop > 0`);
        assert.equal(await evaluate(client!, sessionId, `(() => {
          const selected = document.querySelector('.qp-category-filter-option[aria-selected="true"]').getBoundingClientRect();
          const list = document.querySelector('.qp-category-filter-list').getBoundingClientRect();
          return selected.top >= list.top - 1 && selected.bottom <= list.bottom + 1;
        })()`), true);
        await client!.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
        await client!.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
        await waitForExpression(client!, sessionId, `!document.querySelector('.qp-category-filter-popover')`);
      }
    } finally {
      await client!.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
      await client!.command("Emulation.setEmulatedMedia", { features: [] }, sessionId);
      await evaluate(client!, sessionId, `(() => {
        const stored = ${JSON.stringify(stored)};
        if (stored === null) localStorage.removeItem('__time_tracker_smoke_settings');
        else localStorage.setItem('__time_tracker_smoke_settings', stored);
        localStorage.removeItem('__time_tracker_enable_classification_catalog_fixture');
        localStorage.setItem('patina:last-active-view', 'dashboard');
        location.reload();
      })()`);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('main'))`);
    }
  });
  await runTest("category shortcuts fill the sole search field without an independent filter", async () => {
    const settingsBefore = await evaluate(client!, sessionId, `localStorage.getItem('__time_tracker_smoke_settings')`);
    const script = await client!.command("Page.addScriptToEvaluateOnNewDocument", {
      source: "globalThis.__TIME_TRACKER_ENABLE_WEB_FIXTURE = true;",
    }, sessionId) as { identifier: string };
    const click = async (selector: string) => {
      assert.equal(await evaluate(client!, sessionId, `(() => {
        const node = document.querySelector(${jsonString(selector)}); node?.click(); return Boolean(node);
      })()`), true, selector);
    };
    const button = async (label: string) => {
      assert.equal(await evaluate(client!, sessionId, `(() => {
        const node = Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === ${jsonString(label)});
        node?.click(); return Boolean(node);
      })()`), true, label);
    };
    const input = async (value: string) => {
      await evaluate(client!, sessionId, `(() => {
        const node = document.querySelector('.qp-category-search input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, ${jsonString(value)});
        node.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    };
    const key = async (keyName: string, keyCode: number) => {
      for (const type of ["keyDown", "keyUp"]) await client!.command("Input.dispatchKeyEvent", {
        type, key: keyName, code: keyName, windowsVirtualKeyCode: keyCode,
      }, sessionId);
    };
    const open = async () => {
      await click('.qp-category-filter-trigger');
      await waitForExpression(client!, sessionId, `document.activeElement?.getAttribute('role') === 'listbox'`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelectorAll('.qp-category-filter-popover input').length`), 0);
    };
    const choose = async (label: string) => {
      await button(label);
      await waitForExpression(client!, sessionId, `!document.querySelector('.qp-category-filter-popover')`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('.qp-category-search input').value`), label);
      assert.equal(await evaluate(client!, sessionId, `document.activeElement === document.querySelector('.qp-category-search input')`), true);
    };
    try {
      const origin = await evaluate(client!, sessionId, "performance.timeOrigin");
      await evaluate(client!, sessionId, `(() => {
        const settings = {language:'zh-CN', web_activity_enabled:'1'};
        settings['__app_override::cursor.exe'] = JSON.stringify({category:'development',enabled:true});
        settings['__app_override::deep-research-workbench.exe'] = JSON.stringify({category:'office',displayName:'开发助手',enabled:true});
        settings['__web_domain_override::stable.example'] = JSON.stringify({category:'development',enabled:true});
        settings['__web_domain_override::docs.example'] = JSON.stringify({category:'utility',enabled:true});
        localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify(settings));
        localStorage.setItem('patina:classification-object-mode','app');
        localStorage.setItem('patina:last-active-view','mapping');
        location.reload();
      })()`);
      await waitForExpression(client!, sessionId, `performance.timeOrigin !== ${origin} && document.querySelector('.qp-category-filter-trigger')?.disabled === false`);
      assert.equal(await evaluate(client!, sessionId, `(() => {
        const search=document.querySelector('.qp-category-search').getBoundingClientRect();
        const trigger=document.querySelector('.qp-category-filter-trigger').getBoundingClientRect();
        return trigger.left>=search.left && trigger.right<=search.right && trigger.top>=search.top && trigger.bottom<=search.bottom;
      })()`), true);
      await input('no-match');
      await open();
      assert.deepEqual(await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.qp-category-filter-option')).map(n=>n.textContent.trim())`), ['开发','办公']);
      await key('Enter',13);
      await waitForExpression(client!, sessionId, `document.querySelectorAll('[data-classification-app]').length === 2`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('.qp-category-search input').value`), '开发');
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('.qp-category-filter-reset')`), null);
      assert.equal(await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('button')).find(n=>n.textContent.trim()==='保存')?.disabled`), true);
      await open();
      await choose('办公');
      await waitForExpression(client!, sessionId, `document.querySelectorAll('[data-classification-app]').length === 1`);
      await input('cursor.exe');
      await waitForExpression(client!, sessionId, `document.querySelector('[data-classification-app]')?.dataset.classificationApp === 'cursor.exe'`);
      await input('');
      await waitForExpression(client!, sessionId, `document.querySelectorAll('[data-classification-app]').length === 2`);
      await open();
      await choose('办公');
      await button('网页');
      await open();
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('.qp-category-search input').value`), '办公');
      assert.deepEqual(await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.qp-category-filter-option')).map(n=>n.textContent.trim())`), ['开发','工具']);
      await choose('工具');
      await waitForExpression(client!, sessionId, `document.body.innerText.includes('docs.example') && !document.body.innerText.includes('stable.example')`);
      await button('应用');
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('.qp-category-search input').value`), '工具');
      await input('');
      await waitForExpression(client!, sessionId, `document.querySelectorAll('[data-classification-app]').length === 2`);
      const placements = [
        { width: 720 }, { width: 1024 }, { width: 1280 }, { width: 1920 },
        { width: 720, edge: 'left' }, { width: 720, edge: 'right' },
      ];
      for (const { width, edge } of placements) {
        await client!.command('Emulation.setDeviceMetricsOverride', {width,height:820,deviceScaleFactor:1,mobile:false}, sessionId);
        if (edge) {
          await evaluate(client!, sessionId, `document.querySelector('.qp-category-search').style.cssText =
            ${jsonString(`position: fixed; top: 100px; ${edge}: 0`)};`);
        }
        if (width >= 1024) {
          assert.equal(await evaluate(client!, sessionId, `(() => {
            const search=document.querySelector('.qp-category-search').getBoundingClientRect();
            const filters=document.querySelector('.qp-classification-count-filter').getBoundingClientRect();
            const mode=Array.from(document.querySelectorAll('button')).find(n=>n.textContent.trim()==='应用').getBoundingClientRect();
            const center=r=>r.top+r.height/2;
            return Math.abs(center(search)-center(filters))<1 && Math.abs(center(search)-center(mode))<1;
          })()`), true, `single toolbar row at ${width}`);
        }
        await open();
        await waitForExpression(client!, sessionId, `(() => {
          const popover=document.querySelector('.qp-category-filter-popover').getBoundingClientRect();
          const search=document.querySelector('.qp-category-search').getBoundingClientRect();
          const centeredLeft=search.left+search.width/2-popover.width/2;
          const expectedLeft=Math.max(12, Math.min(innerWidth-popover.width-12, centeredLeft));
          return popover.left>=12 && popover.right<=innerWidth-12 && popover.bottom<=innerHeight-12
            && Math.abs(popover.left-expectedLeft)<1;
        })()`, 15_000, `category popover at viewport ${width}, edge ${edge ?? 'none'}`).catch(async (error: unknown) => {
          const geometry = await evaluate(client!, sessionId, `({
            viewport: [innerWidth, innerHeight],
            popover: document.querySelector('.qp-category-filter-popover')?.getBoundingClientRect().toJSON(),
            search: document.querySelector('.qp-category-search')?.getBoundingClientRect().toJSON(),
            animations: document.getAnimations().map(a => ({state:a.playState, time:a.currentTime})),
          })`);
          throw new Error(`Category popover geometry: ${JSON.stringify(geometry)}`, { cause: error });
        });
        await key('Escape',27);
        await waitForExpression(client!, sessionId, `!document.querySelector('.qp-category-filter-popover')`);
        assert.equal(await evaluate(client!, sessionId, `document.activeElement?.classList.contains('qp-category-filter-trigger')`), true);
        if (edge) await evaluate(client!, sessionId, `document.querySelector('.qp-category-search').style.cssText = ''`);
      }
      await open();
      await key('Tab',9);
      await waitForExpression(client!, sessionId, `!document.querySelector('.qp-category-filter-popover')`);
    } finally {
      await client!.command('Page.removeScriptToEvaluateOnNewDocument', {identifier:script.identifier}, sessionId);
      await client!.command('Emulation.setDeviceMetricsOverride', {width:1280,height:820,deviceScaleFactor:1,mobile:false}, sessionId);
      await evaluate(client!, sessionId, `(() => {
        const settings=${JSON.stringify(settingsBefore)};
        if(settings===null) localStorage.removeItem('__time_tracker_smoke_settings'); else localStorage.setItem('__time_tracker_smoke_settings',settings);
        localStorage.setItem('patina:last-active-view','dashboard');
        location.reload();
      })()`);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('main'))`);
    }
  });
}
