import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForAnimationFrames, waitForExpression } from "./browserHarness.ts";

export async function runTypographyScenarios({ client, sessionId, appUrl, runTest }: BrowserSmokeContext) {
  await runTest("seven pages preserve typography roles across locales themes and desktop scales", async () => {
    const stored = await evaluate(client, sessionId, "localStorage.getItem('__time_tracker_smoke_settings')") as string | null;
    try {
      for (const [locale, width, theme, scale] of [
        ["zh-CN", 1280, "light", 1], ["zh-CN", 900, "dark", 1.25],
        ["en-US", 900, "light", 1.5], ["en-US", 1280, "dark", 2],
        ["es", 900, "dark", 1], ["es", 1280, "light", 1.25],
        ["ru-RU", 900, "light", 2], ["ru-RU", 1280, "dark", 1.5],
      ] as const) {
        await evaluate(client, sessionId, `localStorage.setItem('__time_tracker_smoke_settings', JSON.stringify({ ...JSON.parse(${jsonString(stored ?? "{}")}), language: ${jsonString(locale)}, theme_mode: ${jsonString(theme)} }))`);
        await client.command("Emulation.setDeviceMetricsOverride", { width, height: width === 900 ? 700 : 820, deviceScaleFactor: scale, mobile: false }, sessionId);
        const previousOrigin = await evaluate(client, sessionId, "performance.timeOrigin");
        await client.command("Page.navigate", { url: appUrl }, sessionId);
        await waitForExpression(client, sessionId, `performance.timeOrigin !== ${previousOrigin}`);
        await waitForExpression(client, sessionId, "document.querySelectorAll('[data-sidebar-nav-item]').length === 7 && Boolean(document.querySelector('.qp-page-header-title'))");
        await waitForExpression(client, sessionId, `document.documentElement.lang === ${jsonString(locale)} && document.documentElement.dataset.theme === ${jsonString(theme)}`);
        const pages = await evaluate(client, sessionId, "[...document.querySelectorAll('[data-sidebar-nav-item]')].map(n=>({id:n.dataset.sidebarNavItem,title:n.getAttribute('aria-label')}))") as Array<{ id: string; title: string }>;
        for (const page of pages) {
          await evaluate(client, sessionId, `document.querySelector('[data-sidebar-nav-item="${page.id}"]').click()`);
          await waitForExpression(client, sessionId, `document.querySelector('.qp-page-header-title')?.textContent === ${jsonString(page.title)}`);
          await waitForAnimationFrames(client, sessionId, 3);
          const state = await evaluate(client, sessionId, `(() => {
            const main = document.querySelector('main');
            const header = main.querySelector('.qp-page-header-title');
            const sections = [...main.querySelectorAll('.dashboard-card-header h3,.data-trend-header h3,.tools-panel-title h2')];
            const rows = [...main.querySelectorAll('.settings-preference-title,.qp-app-mapping-name')];
            const badges = [...main.querySelectorAll('.qp-badge')];
            const compact = [...main.querySelectorAll('.dashboard-top-app-count,.history-horizontal-timeline-legend-item,.qp-segmented-filter-compact .qp-segmented-filter-item')];
            const rect = main.getBoundingClientRect();
            return {
              weights: [...new Set([...main.querySelectorAll('*')].filter(n=>[...n.childNodes].some(c=>c.nodeType===3 && c.textContent.trim())).map(n=>getComputedStyle(n).fontWeight))],
              roleWeights: {
                badges: badges.map(n=>getComputedStyle(n).fontWeight),
                buttons: [...main.querySelectorAll('.qp-button')].map(n=>getComputedStyle(n).fontWeight),
                rows: rows.map(n=>getComputedStyle(n).fontWeight),
                meta: [...main.querySelectorAll('.qp-app-mapping-exe,.data-app-option-meta')].map(n=>getComputedStyle(n).fontWeight),
              },
              header: getComputedStyle(header).fontSize,
              sections: sections.map(n=>getComputedStyle(n).fontSize),
              rows: rows.map(n=>getComputedStyle(n).fontSize),
              compact: compact.map(n=>getComputedStyle(n).fontSize),
              headerMetrics: { lineHeight: getComputedStyle(header).lineHeight, weight: getComputedStyle(header).fontWeight, family: getComputedStyle(header).fontFamily, width: header.getBoundingClientRect().width, height: header.getBoundingClientRect().height },
              badgeClipped: badges.some(n=>n.scrollWidth>n.clientWidth),
              horizontalOverflow: main.scrollWidth>main.clientWidth+1,
              headerContained: header.getBoundingClientRect().right<=rect.right+1,
              textSizes: [...new Set([...main.querySelectorAll('*')].filter(n=>[...n.childNodes].some(c=>c.nodeType===3 && c.textContent.trim())).map(n=>getComputedStyle(n).fontSize))],
            };
          })()` ) as { weights: string[]; roleWeights: { badges: string[]; buttons: string[]; rows: string[]; meta: string[] }; header: string; sections: string[]; rows: string[]; compact: string[]; headerMetrics: { lineHeight: string; weight: string }; badgeClipped: boolean; horizontalOverflow: boolean; headerContained: boolean; textSizes: string[] };
          const report = { locale, width, theme, scale, page: page.id, ...state };
          assert.ok(state.weights.every(weight => ["450", "550", "650"].includes(weight)), JSON.stringify(report));
          for (const [role, weights] of Object.entries(state.roleWeights)) {
            assert.ok(weights.every(weight => weight === (role === "rows" || role === "meta" ? "550" : "650")), JSON.stringify({ role, ...report }));
          }
          if (page.id === "mapping" || page.id === "settings") assert.ok(state.roleWeights.rows.length > 0);
          if (page.id === "about") assert.ok(state.roleWeights.buttons.length >= 4);
          assert.equal(state.header, "18px", JSON.stringify(report));
          assert.ok(state.sections.every(size => size === "16px"), JSON.stringify(report));
          assert.ok(state.rows.every(size => size === "14px"), JSON.stringify(report));
          assert.ok(state.compact.every(size => size === "10px"), JSON.stringify(report));
          assert.equal(state.headerMetrics.lineHeight, "24px");
          assert.equal(state.headerMetrics.weight, "650");
          assert.equal(state.badgeClipped, false, JSON.stringify(report));
          assert.equal(state.horizontalOverflow, false, JSON.stringify(report));
          assert.equal(state.headerContained, true, JSON.stringify(report));
          assert.ok(state.textSizes.every(size => ["10px", "12px", "14px", "15px", "16px", "18px", "24px"].includes(size)), JSON.stringify(report));
        }
      }
    } finally {
      await evaluate(client, sessionId, stored === null ? "localStorage.removeItem('__time_tracker_smoke_settings')" : `localStorage.setItem('__time_tracker_smoke_settings', ${jsonString(stored)})`);
      await client.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
      await client.command("Page.navigate", { url: appUrl }, sessionId);
      await waitForExpression(client, sessionId, "Boolean(document.querySelector('.qp-page-header-title'))");
    }
  });
}
