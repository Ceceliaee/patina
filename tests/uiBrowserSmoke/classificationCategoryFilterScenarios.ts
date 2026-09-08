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
        await waitForExpression(client!, sessionId, `document.activeElement?.getAttribute('role') === 'combobox' && document.querySelectorAll('.qp-category-filter-option').length === 30`);
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
  await runTest("classification category filter composes with drafts, search, modes and keyboard", async () => {
    const settingsBefore = await evaluate(client!, sessionId, `localStorage.getItem('__time_tracker_smoke_settings')`);
    const modeBefore = await evaluate(client!, sessionId, `localStorage.getItem('patina:classification-object-mode')`);
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
    const input = async (selector: string, value: string) => {
      await evaluate(client!, sessionId, `(() => {
        const node = document.querySelector(${jsonString(selector)});
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, ${jsonString(value)});
        node.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    };
    const key = async (keyName: string, keyCode: number, modifiers = 0) => {
      for (const type of ["keyDown", "keyUp"]) {
        await client!.command("Input.dispatchKeyEvent", {
          type, key: keyName, code: keyName, windowsVirtualKeyCode: keyCode, modifiers,
        }, sessionId);
      }
    };
    const open = async () => {
      await click(".qp-category-filter-trigger");
      await waitForExpression(client!, sessionId, `document.activeElement?.getAttribute('aria-label') === '搜索分类'`);
    };
    const option = async (label: string) => {
      assert.equal(await evaluate(client!, sessionId, `(() => {
        const node = Array.from(document.querySelectorAll('.qp-category-filter-option'))
          .find(n => n.textContent.trim() === ${jsonString(label)});
        node?.click(); return Boolean(node);
      })()`), true, label);
      await waitForExpression(client!, sessionId, `!document.querySelector('.qp-category-filter-popover')`);
    };
    try {
      await evaluate(client!, sessionId, `(() => {
        const settings = JSON.parse(localStorage.getItem('__time_tracker_smoke_settings') ?? '{}');
        settings.language = 'zh-CN'; settings.web_activity_enabled = '1';
        settings['__app_override::cursor.exe'] = JSON.stringify({category:'development', enabled:true});
        settings['__app_override::deep-research-workbench.exe'] = JSON.stringify({category:'office', enabled:true});
        settings['__web_domain_override::stable.example'] = JSON.stringify({category:'development', enabled:true});
        settings['__web_domain_override::docs.example'] = JSON.stringify({category:'utility', enabled:true});
        localStorage.setItem('__time_tracker_smoke_settings', JSON.stringify(settings));
        localStorage.setItem('patina:last-active-view', 'dashboard');
        location.reload();
      })()`);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[aria-label="分类"]'))`);
      await click('[aria-label="分类"]');
      await waitForExpression(client!, sessionId, `document.querySelector('[data-classification-content-state]')?.dataset.classificationContentState === 'ready'`);
      await button("应用");
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[data-classification-app="cursor.exe"]'))`);
      await open();
      assert.deepEqual(await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.qp-category-filter-option')).map(n => n.textContent.trim())`),
        ["开发", "办公"]);
      await key("ArrowDown", 40);
      await key("ArrowUp", 38);
      await key("Enter", 13);
      await waitForExpression(client!, sessionId, `document.querySelectorAll('[data-classification-app]').length === 1`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('[data-classification-app]')?.dataset.classificationApp`), "cursor.exe");
      assert.equal(await evaluate(client!, sessionId, `document.activeElement?.classList.contains('qp-category-filter-trigger')`), true);
      assert.equal(await evaluate(client!, sessionId, `(() => {
        const trigger = document.querySelector('.qp-category-filter-trigger');
        const reset = document.querySelector('.qp-category-filter-reset');
        return !trigger.classList.contains('qp-icon-action-pressed') && Boolean(reset)
          && reset.getBoundingClientRect().right <= trigger.getBoundingClientRect().left;
      })()`), true);
      assert.equal(await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === '保存')?.disabled`), true);

      await input('input[placeholder="搜索应用"]', "no-match-needle");
      await waitForExpression(client!, sessionId, `document.body.innerText.includes('没有找到匹配的应用')`);
      await open();
      assert.equal(await evaluate(client!, sessionId, `document.querySelectorAll('.qp-category-filter-option').length`), 2);
      await input('.qp-category-filter-popover input', "missing category");
      await waitForExpression(client!, sessionId, `document.querySelectorAll('.qp-category-filter-option').length === 0`);
      await key("ArrowDown", 40);
      await key("Enter", 13);
      await key("Escape", 27);
      await click(".qp-category-filter-reset");
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('.qp-category-filter-reset') === null`), true);
      assert.equal(await evaluate(client!, sessionId, `document.activeElement?.classList.contains('qp-category-filter-trigger')`), true);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('input[placeholder="搜索应用"]').value`), "no-match-needle");
      await input('input[placeholder="搜索应用"]', "");
      await open();
      await option("开发");

      // Editing the sole member must leave a clearable selected empty category.
      await click('[data-classification-app="cursor.exe"] .qp-select-trigger');
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.qp-select-menu'))`);
      await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.qp-select-menu [role="option"]')).find(n => n.textContent.trim() === '办公')?.click()`);
      await waitForExpression(client!, sessionId, `document.body.innerText.includes('当前筛选暂无应用')`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('.qp-category-filter-trigger')?.getAttribute('aria-label')`), "筛选分类 · 开发");
      await open();
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('.qp-category-filter-option[aria-selected="true"]')?.textContent.trim()`), "开发");
      await key("Escape", 27);
      await button("取消");
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[data-classification-app="cursor.exe"]'))`);

      await button("管理分类");
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[aria-label="重命名分类：开发"]'))`);
      await click('[aria-label="重命名分类：开发"]');
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.qp-dialog-input'))`);
      await input('.qp-dialog-input', "研发分类");
      await button("确认");
      await waitForExpression(client!, sessionId, `!document.querySelector('.qp-dialog-input')`);
      await button("关闭");
      await waitForExpression(client!, sessionId, `document.querySelector('.qp-category-filter-trigger')?.getAttribute('aria-label') === '筛选分类 · 研发分类'`);
      await button("管理分类");
      await button("新建分类");
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.qp-dialog-input'))`);
      await input('.qp-dialog-input', "空分类");
      await button("确认");
      await waitForExpression(client!, sessionId, `!document.querySelector('.qp-dialog-input')`);
      await button("关闭");
      await open();
      assert.equal(await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.qp-category-filter-option')).some(n => n.textContent.includes('空分类'))`), false);
      await key("Escape", 27);
      await button("管理分类");
      await click('[aria-label="删除分类：研发分类"]');
      await waitForExpression(client!, sessionId, `Array.from(document.querySelectorAll('button')).some(n => n.textContent.trim() === '继续')`);
      await button("继续");
      await button("关闭");
      await waitForExpression(client!, sessionId, `document.querySelector('.qp-category-filter-trigger')?.getAttribute('aria-pressed') === 'false'`);
      await button("取消");
      await open();
      await option("开发");

      await button("网页");
      await waitForExpression(client!, sessionId, `document.body.innerText.includes('stable.example') && !document.body.innerText.includes('docs.example')`);
      await open();
      assert.deepEqual(await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.qp-category-filter-option')).map(n => n.textContent.trim())`),
        ["开发", "工具"]);
      await option("工具");
      await waitForExpression(client!, sessionId, `document.body.innerText.includes('docs.example') && !document.body.innerText.includes('stable.example')`);
      await button("应用");
      await waitForExpression(client!, sessionId, `document.querySelector('.qp-category-filter-trigger')?.getAttribute('aria-pressed') === 'false'`);
      await open();
      await option("开发");
      await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.qp-classification-count-filter button')).find(n => n.textContent.startsWith('未分类'))?.click()`);
      await waitForExpression(client!, sessionId, `document.querySelector('.qp-category-filter-trigger')?.disabled === true`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('.qp-category-filter-trigger')?.getAttribute('aria-pressed')`), "false");
      await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.qp-classification-count-filter button')).find(n => n.textContent.startsWith('全部'))?.click()`);

      for (const width of [720, 1280, 1920]) {
        await client!.command("Emulation.setDeviceMetricsOverride", { width, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
        await open();
        await waitForExpression(client!, sessionId, `(() => {
          const rect = document.querySelector('.qp-category-filter-popover')?.getBoundingClientRect();
          return rect && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
        })()`);
        await key("Escape", 27);
        await waitForExpression(client!, sessionId, `!document.querySelector('.qp-category-filter-popover')`);
      }
      await open();
      await key("Tab", 9);
      await waitForExpression(client!, sessionId, `!document.querySelector('.qp-category-filter-popover')`);
      assert.equal(await evaluate(client!, sessionId, `document.activeElement?.isConnected && !document.activeElement?.classList.contains('qp-category-filter-trigger')`), true);
    } finally {
      await client!.command("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier }, sessionId);
      await client!.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
      await evaluate(client!, sessionId, `(() => {
        const settings = ${JSON.stringify(settingsBefore)};
        if (settings === null) localStorage.removeItem('__time_tracker_smoke_settings');
        else localStorage.setItem('__time_tracker_smoke_settings', settings);
        const mode = ${JSON.stringify(modeBefore)};
        if (mode === null) localStorage.removeItem('patina:classification-object-mode');
        else localStorage.setItem('patina:classification-object-mode', mode);
        localStorage.setItem('patina:last-active-view', 'dashboard');
        location.reload();
      })()`);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[aria-label="分类"]'))`);
    }
  });
}
