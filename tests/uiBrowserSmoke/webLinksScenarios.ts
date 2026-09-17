import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";

export async function runWebLinksScenarios({ client, sessionId, runTest }: BrowserSmokeContext) {
  await runTest("website links mirror applications with manual add and unlink only", async () => {
    const previous = await evaluate(client!, sessionId, "localStorage.getItem('__time_tracker_smoke_settings')") as string | null;
    const domains = ["www.example.com", "mail.example.com", "a-long-domain-label-for-complete-readable-member-controls.mail.example.com", "other.com"];
    const memberIcon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#236CC7"/></svg>')}`;
    const rows = domains.map((domain, index) => ({ id: 2900 + index, browser_client_id: "links", browser_kind: "chrome", browser_exe_name: "chrome.exe", domain, normalized_domain: domain, url: `https://${domain}/page`, title: domain, favicon_url: index === 0 ? memberIcon : null, start_time: Date.now() - 600000, end_time: Date.now() - 300000, duration: 300000 }));
    let fixture = await client!.command("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.__PATINA_CLASSIFICATION_WEB_ROWS=${JSON.stringify(rows)};` }, sessionId) as { identifier: string };
    const click = async (selector: string) => {
      assert.equal(await evaluate(client!, sessionId, `(() => {const n=document.querySelector(${jsonString(selector)});n?.focus();n?.click();return Boolean(n && !n.disabled);})()`), true, selector);
    };
    const button = async (label: string) => {
      assert.equal(await evaluate(client!, sessionId, `(() => {const matches=n=>n.textContent.trim()===${jsonString(label)};const n=[...document.querySelectorAll('.qp-web-grouping-popover button')].find(matches)??[...document.querySelectorAll('button')].find(matches);n?.click();return Boolean(n);})()`), true, label);
    };
    const escape = async () => {
      for (const type of ["keyDown", "keyUp"]) await client!.command("Input.dispatchKeyEvent", { type, key: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
    };
    const reload = async (count: number) => {
      const origin = await evaluate(client!, sessionId, "performance.timeOrigin");
      await evaluate(client!, sessionId, "location.reload()");
      await waitForExpression(client!, sessionId, `performance.timeOrigin!==${origin} && document.querySelectorAll('[data-classification-web]').length===${count}`);
    };
    const site = '[data-classification-web="site:www.example.com"]';
    try {
      await evaluate(client!, sessionId, `localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify({language:'zh-CN',web_activity_enabled:'1',title_recording_enabled:'1'}));localStorage.setItem('patina:classification-object-mode','web');localStorage.setItem('patina:last-active-view','mapping')`);
      await reload(4);
      await click('[data-classification-web="www.example.com"] .qp-app-link-trigger');
      await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.qp-web-grouping-popover'))");
      assert.equal(await evaluate(client!, sessionId, "Boolean(document.querySelector('.qp-web-grouping-popover [role=switch]'))"), false);
      assert.equal(await evaluate(client!, sessionId, "document.querySelector('.qp-web-grouping-popover > strong')?.textContent==='关联网页' && getComputedStyle(document.querySelector('.qp-web-grouping-popover')).width==='240px' && document.querySelectorAll('.qp-app-link-member').length===0"), true);
      await button("添加网页");
      await waitForExpression(client!, sessionId, "document.activeElement===document.querySelector('.qp-web-grouping-popover input')");
      await button("other.com");
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector(${jsonString(site)})) && document.querySelectorAll('[data-classification-web]').length===3`);
      await button("mail.example.com");
      await button(domains[2]);
      await click('.qp-web-grouping-popover [aria-label="返回关联网页"]');
      await waitForExpression(client!, sessionId, "document.querySelectorAll('[data-classification-web]').length===1 && document.querySelectorAll('.qp-app-link-member').length===3");
      await waitForExpression(client!, sessionId, `document.querySelector(${jsonString(site + " .qp-color-trigger-swatch")})?.style.backgroundColor==='rgb(35, 108, 199)'`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector(${jsonString(site + " .qp-app-mapping-icon img")})?.getAttribute('src')`), memberIcon);
      assert.equal(await evaluate(client!, sessionId, `Boolean(document.querySelector(${jsonString(site + " .qp-app-mapping-delete")}))`), true, "parent keeps the same card controls as applications");
      await click('.qp-web-grouping-popover [aria-label="解除关联: mail.example.com"]');
      await waitForExpression(client!, sessionId, "document.querySelectorAll('[data-classification-web]').length===2 && document.querySelectorAll('.qp-app-link-member').length===2");
      await escape();
      await waitForExpression(client!, sessionId, `document.activeElement===document.querySelector(${jsonString(site + " .qp-app-link-trigger")})`);
      await evaluate(client!, sessionId, "globalThis.__PATINA_REJECT_CLASSIFICATION_SAVE=true");
      await button("保存");
      await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.qp-app-mapping-error'))");
      await evaluate(client!, sessionId, "globalThis.__PATINA_REJECT_CLASSIFICATION_SAVE=false");
      await click(site + " .qp-color-trigger");
      await button("HEX");
      await evaluate(client!, sessionId, `(() => {const input=document.querySelector('.qp-color-popover input[aria-label="十六进制颜色值"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'#123456');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await escape();
      await button("保存");
      await waitForExpression(client!, sessionId, "Boolean(JSON.parse(localStorage.getItem('__time_tracker_smoke_settings'))['__web_site::www.example.com'])");
      await reload(2);
      await waitForExpression(client!, sessionId, `document.querySelector(${jsonString(site + " .qp-color-trigger-swatch")})?.style.backgroundColor==='rgb(18, 52, 86)'`);
      const future = { ...rows[1], id: 3100, domain: "future.example.com", normalized_domain: "future.example.com" };
      await client!.command("Page.removeScriptToEvaluateOnNewDocument", { identifier: fixture.identifier }, sessionId);
      fixture = await client!.command("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.__PATINA_CLASSIFICATION_WEB_ROWS=${JSON.stringify([...rows, future])};` }, sessionId) as { identifier: string };
      await reload(3);
      await click(site + " .qp-app-link-trigger");
      assert.equal(await evaluate(client!, sessionId, "Boolean(document.querySelector('[data-classification-web=\"future.example.com\"]'))"), true, "new subdomains remain separate");
      await button("添加网页");
      await button("future.example.com");
      await waitForExpression(client!, sessionId, "document.querySelectorAll('[data-classification-web]').length===2");
      assert.equal(await evaluate(client!, sessionId, "Boolean(document.querySelector('[data-classification-web=\"mail.example.com\"]'))"), true, "unlinked members remain separate");
      await escape();
      await button("取消");
      await waitForExpression(client!, sessionId, "document.querySelectorAll('[data-classification-web]').length===3");
      for (const locale of ["en-US", "ru-RU", "es", "zh-CN"]) {
        for (const theme of ["dark", "light"]) {
          await evaluate(client!, sessionId, `(() => {const settings=JSON.parse(localStorage.getItem('__time_tracker_smoke_settings'));settings.language=${jsonString(locale)};settings.theme_mode=${jsonString(theme)};localStorage.setItem('__time_tracker_smoke_settings',JSON.stringify(settings));})()`);
          await reload(3);
          await click(site + " .qp-app-link-trigger");
          for (const width of [720, 1280]) {
            await client!.command("Emulation.setDeviceMetricsOverride", { width, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
            await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.qp-web-grouping-popover'))");
            assert.equal(await evaluate(client!, sessionId, "(() => {const panel=document.querySelector('.qp-web-grouping-popover'),r=panel.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && panel.scrollWidth<=panel.clientWidth && [...panel.querySelectorAll('.qp-app-link-member > span')].every(n=>n.scrollWidth<=n.clientWidth);})()"), true, `${locale} ${theme} ${width}`);
          }
        }
      }
      await click('.qp-web-grouping-popover [aria-label="解除关联: other.com"]');
      await click(`.qp-web-grouping-popover [aria-label="解除关联: ${domains[2]}"]`);
      await waitForExpression(client!, sessionId, "Boolean(document.querySelector('[data-classification-web=\"www.example.com\"]')) && document.querySelectorAll('[data-classification-web]').length===5");
      await escape();
      await click('[data-classification-web="mail.example.com"] .qp-app-link-trigger');
      await button("添加网页");
      await button("www.example.com");
      await waitForExpression(client!, sessionId, "Boolean(document.querySelector('[data-classification-web=\"site:mail.example.com\"]'))");
      await escape();
      await button("保存");
      await waitForExpression(client!, sessionId, "Boolean(JSON.parse(localStorage.getItem('__time_tracker_smoke_settings'))['__web_site::mail.example.com'])");
      await client!.command("Page.removeScriptToEvaluateOnNewDocument", { identifier: fixture.identifier }, sessionId);
      const withoutParent = [...rows, future].filter(row => row.normalized_domain !== "mail.example.com");
      fixture = await client!.command("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.__PATINA_CLASSIFICATION_WEB_ROWS=${JSON.stringify(withoutParent)};` }, sessionId) as { identifier: string };
      await reload(4);
      await click('[data-classification-web="site:mail.example.com"] .qp-app-mapping-delete');
      await waitForExpression(client!, sessionId, "Boolean(document.querySelector('[role=dialog]'))");
      assert.equal(await evaluate(client!, sessionId, "document.querySelector('[role=dialog]').textContent.includes('mail.example.com')"), true);
      await button("继续");
      await waitForExpression(client!, sessionId, "globalThis.__PATINA_WEB_DELETE_CALLS?.length===1 && !document.querySelector('[data-classification-web=\"site:mail.example.com\"] .qp-app-mapping-delete')?.disabled");
      assert.deepEqual(await evaluate(client!, sessionId, "globalThis.__PATINA_WEB_DELETE_CALLS"), ["mail.example.com"], "missing parent never retargets deletion to the remaining member");
      assert.equal(await evaluate(client!, sessionId, "globalThis.__PATINA_CLASSIFICATION_WEB_ROWS.some(row=>row.normalized_domain==='www.example.com')"), true);
      await client!.command("Page.removeScriptToEvaluateOnNewDocument", { identifier: fixture.identifier }, sessionId);
      fixture = await client!.command("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.__PATINA_CLASSIFICATION_WEB_ROWS=${JSON.stringify(withoutParent.filter(row => row.normalized_domain !== "www.example.com"))};` }, sessionId) as { identifier: string };
      await reload(4);
      await click('[data-classification-web="site:mail.example.com"] .qp-app-link-trigger');
      await click('.qp-web-grouping-popover [aria-label="解除关联: www.example.com"]');
      await waitForExpression(client!, sessionId, "document.querySelectorAll('[data-classification-web]').length===3");
    } finally {
      await client!.command("Page.removeScriptToEvaluateOnNewDocument", { identifier: fixture.identifier }, sessionId);
      await evaluate(client!, sessionId, `${previous === null ? "localStorage.removeItem('__time_tracker_smoke_settings')" : `localStorage.setItem('__time_tracker_smoke_settings',${jsonString(previous)})`};localStorage.setItem('patina:classification-object-mode','app')`);
    }
  });
}
