import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { getLocaleText } from "../../src/shared/i18n/runtime.ts";
import {
  evaluate,
  jsonString,
  waitFor,
  waitForAnimationFrames,
  waitForExpression,
} from "./browserHarness.ts";

export async function runDashboardReadFailureScenarios(context: BrowserSmokeContext) {
  const { appUrl, client, sessionId, runTest } = context;
  await runTest("requested icon snapshots evict old batches and ignore superseded and unmounted requests", async () => {
    await evaluate(client, sessionId, `import('/tests/uiBrowserSmoke/requestedIconsFixture.ts').then(module => {
      globalThis.__patinaRequestedIconsProbe = module.createRequestedIconsProbe();
    })`);
    const probe = "globalThis.__patinaRequestedIconsProbe";
    try {
      for (const [index, name] of ["first.exe", "second.exe"].entries()) {
        await evaluate(client, sessionId, `${probe}.render([${jsonString(name)}])`);
        await waitForExpression(client, sessionId, `${probe}.read().requests.length === ${index + 1}`);
        await evaluate(client, sessionId, `${probe}.resolve(${index}, { [${jsonString(name)}]: 'icon' })`);
        await waitForExpression(client, sessionId, `${probe}.read().icons[${jsonString(name)}] === 'icon'`);
        assert.deepEqual(await evaluate(client, sessionId, `Object.keys(${probe}.read().icons).sort()`), ["base.exe", name].sort());
      }
      await evaluate(client, sessionId, `${probe}.render(['slow.exe'])`);
      await waitForExpression(client, sessionId, `${probe}.read().requests.length === 3`);
      await evaluate(client, sessionId, `${probe}.render(['current.exe'])`);
      await waitForExpression(client, sessionId, `${probe}.read().requests.length === 4`);
      await evaluate(client, sessionId, `${probe}.resolve(3, { 'current.exe': 'current' })`);
      await waitForExpression(client, sessionId, `${probe}.read().icons['current.exe'] === 'current'`);
      await evaluate(client, sessionId, `${probe}.resolve(2, { 'slow.exe': 'obsolete' })`);
      await waitForAnimationFrames(client, sessionId, 2);
      assert.deepEqual(await evaluate(client, sessionId, `Object.keys(${probe}.read().icons).sort()`), ["base.exe", "current.exe"]);
      await evaluate(client, sessionId, `${probe}.change('unrelated.exe')`);
      await waitForAnimationFrames(client, sessionId, 2);
      assert.equal(await evaluate(client, sessionId, `${probe}.read().requests.length`), 4);
      await evaluate(client, sessionId, `${probe}.change('CURRENT.EXE')`);
      await waitForExpression(client, sessionId, `${probe}.read().requests.length === 5`);
      assert.equal(await evaluate(client, sessionId, `${probe}.read().icons['current.exe']`), 'current');
      await evaluate(client, sessionId, `${probe}.resolve(4, { 'current.exe': 'refreshed' })`);
      await waitForExpression(client, sessionId, `${probe}.read().icons['current.exe'] === 'refreshed'`);
      await evaluate(client, sessionId, `${probe}.render(['unmounted.exe'])`);
      await waitForExpression(client, sessionId, `${probe}.read().requests.length === 6`);
      const commits = await evaluate(client, sessionId, `${probe}.read().commits`);
      await evaluate(client, sessionId, `${probe}.dispose(); ${probe}.reject(5)`);
      await waitForAnimationFrames(client, sessionId, 2);
      assert.equal(await evaluate(client, sessionId, `${probe}.read().commits`), commits);
      assert.deepEqual(await evaluate(client, sessionId, `${probe}.read().errors`), []);
    } finally {
      await evaluate(client, sessionId, `${probe}?.dispose(); delete globalThis.__patinaRequestedIconsProbe`);
    }
  });
  const copy = getLocaleText("zh-CN");
  const total = `document.querySelector('.dashboard-focus-total-center span')?.textContent?.trim()`;
  const showDashboard = async () => {
    const previousDocument = await evaluate(client, sessionId, `performance.timeOrigin`);
    await client.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(client, sessionId, `performance.timeOrigin !== ${previousDocument} && document.readyState === 'complete'`);
    await waitForExpression(client, sessionId, `Boolean(document.querySelector('[aria-label="今天"]'))`);
    await evaluate(client, sessionId, `document.querySelector('[aria-label="今天"]').click()`);
    await waitForExpression(client, sessionId, `Boolean(document.querySelector('[data-dashboard-read-state]'))`);
    await waitForExpression(client, sessionId, `Boolean(document.querySelector('[data-presented-view="dashboard"][data-view-transition-state="settled"]'))`);
  };

  await runTest("dashboard distinguishes cold read failure, retry success, and successful empty data", async () => {
    await evaluate(client, sessionId, `localStorage.setItem('__patina_reject_aggregate_kind', 'dashboard')`);
    try {
      await showDashboard();
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('[data-dashboard-read-error]'))`);
      const visible = await evaluate(client, sessionId, `document.querySelector('[data-dashboard-read-state]')?.innerText`) as string;
      assert.ok(visible.includes(copy.common.readFailed));
      assert.ok(!visible.includes(copy.dashboard.emptyState), "unknown data must not claim no records");
      assert.ok(!visible.includes("0m"), "unknown data must not claim zero duration");
      await evaluate(client, sessionId, `
        localStorage.removeItem('__patina_reject_aggregate_kind');
        document.querySelector('[data-dashboard-read-error] button')?.focus();
      `);
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId);
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, sessionId);
      await waitForExpression(client, sessionId, `document.querySelector('[data-dashboard-read-state]')?.dataset.dashboardReadState === 'ready'`);
      assert.equal(await evaluate(client, sessionId, total), "1h 0m");
      assert.equal(await evaluate(client, sessionId, `document.activeElement?.hasAttribute('data-dashboard-read-state')`), true);
      await evaluate(client, sessionId, `localStorage.setItem('__patina_empty_aggregate', '1')`);
      await showDashboard();
      await waitForExpression(client, sessionId, `document.querySelector('[data-dashboard-read-state]')?.dataset.dashboardReadState === 'ready'`);
      assert.equal(await evaluate(client, sessionId, total), "0m");
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.dashboard-workspace')?.innerText.includes(${jsonString(copy.dashboard.emptyState)})`), true);
    } finally {
      await evaluate(client, sessionId, `localStorage.removeItem('__patina_reject_aggregate_kind'); localStorage.removeItem('__patina_empty_aggregate')`);
      await showDashboard();
    }
  });

  await runTest("dashboard retains its valid snapshot through failed refreshes and ignores superseded reads", async () => {
    await waitForExpression(client, sessionId, `document.querySelector('[data-dashboard-read-state]')?.dataset.dashboardReadState === 'ready'`);
    const before = await evaluate(client, sessionId, total);
    await evaluate(client, sessionId, `
      globalThis.__PATINA_AGGREGATE_HOOK = async (request) => {
        if (request.bucketCount === 0) throw new Error('Injected dashboard refresh failure');
      };
      globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed', { reason: 'session-transition', changed_at_ms: Date.now() });
    `);
    await waitForExpression(client, sessionId, `Boolean(document.querySelector('[data-dashboard-read-error]'))`);
    assert.equal(await evaluate(client, sessionId, total), before);
    assert.ok(String(await evaluate(client, sessionId, `document.querySelector('[data-dashboard-read-error]')?.textContent`)).includes(copy.common.refreshFailed));
    await evaluate(client, sessionId, `document.querySelector('[data-dashboard-read-error] button').click()`);
    await waitForExpression(client, sessionId, `Boolean(document.querySelector('[data-dashboard-read-error]'))`);
    assert.equal(await evaluate(client, sessionId, total), before);
    await evaluate(client, sessionId, `
      globalThis.__PATINA_PENDING_AGGREGATES = [];
      globalThis.__PATINA_AGGREGATE_HOOK = (request) => request.bucketCount === 0
        ? new Promise((resolve, reject) => globalThis.__PATINA_PENDING_AGGREGATES.push({ request, resolve, reject }))
        : undefined;
      document.querySelector('[data-dashboard-read-error] button').click();
    `);
    await waitForExpression(client, sessionId, `globalThis.__PATINA_PENDING_AGGREGATES.length >= 2`);
    await evaluate(client, sessionId, `
      globalThis.__PATINA_AGGREGATE_HOOK = undefined;
      globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed', { reason: 'session-transition', changed_at_ms: Date.now() });
    `);
    await waitForExpression(client, sessionId, `document.querySelector('[data-dashboard-read-state]')?.dataset.dashboardReadState === 'ready'`);
    await evaluate(client, sessionId, `globalThis.__PATINA_PENDING_AGGREGATES.forEach((entry) => entry.reject(new Error('Superseded dashboard read')))`);
    await waitForAnimationFrames(client, sessionId, 2);
    assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('[data-dashboard-read-error]'))`), false);
    assert.equal(await evaluate(client, sessionId, total), before);

    await showDashboard();
    await waitForExpression(client, sessionId, `document.querySelector('[data-dashboard-read-state]')?.dataset.dashboardReadState === 'ready'`);
    const sidebarMode = await evaluate(client, sessionId, `localStorage.getItem('patina:sidebar-navigation-mode')`);
    try {
      await evaluate(client, sessionId, `(() => {
        const NativeDate = Date;
        const nextDay = new NativeDate();
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(12, 0, 0, 0);
        const now = nextDay.getTime();
        nextDay.setHours(0, 0, 0, 0);
        const startMs = nextDay.getTime();
        globalThis.__PATINA_RESTORE_DASHBOARD_DATE = () => { globalThis.Date = NativeDate; };
        globalThis.Date = new Proxy(NativeDate, {
          construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [now], newTarget); },
          get(target, key) { return key === 'now' ? () => now : Reflect.get(target, key); }
        });
        globalThis.__PATINA_ROLLOVER_READS = [];
        globalThis.__PATINA_AGGREGATE_HOOK = (request) => request.bucketCount === 0 && request.startMs === startMs
          ? new Promise(resolve => globalThis.__PATINA_ROLLOVER_READS.push({ request, resolve }))
          : undefined;
        document.querySelector('[data-sidebar-footer] button').click();
      })()`);
      await waitForExpression(client, sessionId, `globalThis.__PATINA_ROLLOVER_READS.length >= 1`, 5_000,
        "dashboard new local-date read after unrelated sidebar render");
      assert.equal(await evaluate(client, sessionId, `document.querySelector('[data-dashboard-read-state]')?.dataset.dashboardReadState`), "loading",
        "dashboard must start its own next-day snapshot read after an unrelated render");
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('.dashboard-workspace:not([hidden])'))`), false,
        "a new local day must not show yesterday's snapshot while its own read is pending");
      await evaluate(client, sessionId, `globalThis.__PATINA_ROLLOVER_READS.forEach(entry => entry.resolve({ records: [], readPath: 'projection', fallbackReason: null, sourceRevision: 5, projectionRowCount: 0, factRowCount: 0, hasActiveSession: false }))`);
      await waitForExpression(client, sessionId, `document.querySelector('[data-dashboard-read-state]')?.dataset.dashboardReadState === 'ready' && Boolean(document.querySelector('.dashboard-workspace:not([hidden])')) && ${total} === '0m'`);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('[data-presented-view="dashboard"]'))`), true);
    } finally {
      await evaluate(client, sessionId, `globalThis.__PATINA_RESTORE_DASHBOARD_DATE?.();
        delete globalThis.__PATINA_RESTORE_DASHBOARD_DATE;
        globalThis.__PATINA_AGGREGATE_HOOK = undefined;
        ${sidebarMode === null ? "localStorage.removeItem('patina:sidebar-navigation-mode')" : `localStorage.setItem('patina:sidebar-navigation-mode', ${JSON.stringify(sidebarMode)})`};`);
      await showDashboard();
    }
  });
}

export async function runDashboardScenarios(context: BrowserSmokeContext) {
  const { appUrl, client, sessionId, runTest } = context;
  const captureDashboardScreenshot = async (fileName: string) => {
    const captureDir = process.env.PATINA_DASHBOARD_SCREENSHOT_DIR?.trim();
    if (!captureDir) return;
    const result = await client!.command("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    }, sessionId) as { data: string };
    await mkdir(captureDir, { recursive: true });
    await writeFile(resolve(captureDir, fileName), Buffer.from(result.data, "base64"));
  };

  await runTest("anonymous activity ranks once with EyeOff and unique chart patterns without a classification menu", async () => {
    const navigate = async () => {
      await client.command("Page.navigate", { url: appUrl }, sessionId);
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('[aria-label="今天"]'))`);
      await evaluate(client, sessionId, `document.querySelector('[aria-label="今天"]').click()`);
      await waitForExpression(client, sessionId, `document.querySelector('[data-dashboard-read-state]')?.dataset.dashboardReadState === 'ready'`);
    };
    try {
      await evaluate(client, sessionId, `localStorage.setItem('__patina_anonymous_activity','1')`);
      await navigate();
      const result = await evaluate(client, sessionId, `(() => {
        const root = document.querySelector('.dashboard-workspace');
        const icon = root.querySelector('svg.lucide-eye-off');
        const trigger = icon?.closest('button');
        const patterns = [...root.querySelectorAll('pattern')].map(node => node.id);
        return { icons: root.querySelectorAll('svg.lucide-eye-off').length, menu: trigger?.getAttribute('aria-haspopup'),
          total: root.querySelector('.dashboard-focus-total-center span')?.textContent?.trim(),
          patterns, hasPattern: !!root.querySelector('[stroke^="url(#"]'), text: root.innerText };
      })()` ) as { icons: number; menu: string | null; total: string; patterns: string[]; hasPattern: boolean; text: string };
      assert.equal(result.icons, 1);
      assert.equal(result.menu, null);
      assert.equal(result.total, '1h 0m');
      assert.equal(new Set(result.patterns).size, result.patterns.length);
      assert(result.hasPattern);
      assert.equal(await evaluate(client, sessionId, `(() => {
        const patterns = [...document.querySelectorAll('.dashboard-workspace pattern')];
        return patterns.length > 0 && patterns.every(pattern => !!pattern.querySelector('circle') && !pattern.querySelector('path'));
      })()`), true, 'anonymous SVG patterns use sparse dots');
      assert(result.text.includes('匿名') && !result.text.includes('匿名活动') && !result.text.includes('activity:anonymous'));
        await captureDashboardScreenshot('anonymous-dashboard.png');
        await evaluate(client, sessionId, `document.querySelector('[aria-label="数据"]').click()`);
        await waitForExpression(client, sessionId, `Boolean(document.querySelector('.data-app-option[data-destination-key="activity:anonymous"]'))`);
        const anonymousOption = `.data-app-option[data-destination-key="activity:anonymous"]`;
        assert.equal(await evaluate(client, sessionId, `document.querySelector(${jsonString(anonymousOption)}).getAttribute('aria-haspopup')`), null);
        assert.equal(await evaluate(client, sessionId, `document.querySelector(${jsonString(anonymousOption)}).querySelectorAll('svg.lucide-eye-off').length`), 1);
        await evaluate(client, sessionId, `document.querySelector(${jsonString(anonymousOption)}).click()`);
        await waitForExpression(client, sessionId, `Boolean(document.querySelector('.data-app-selected-icon[data-selection-key="activity:anonymous"]'))`);
        assert.equal(await evaluate(client, sessionId, `document.querySelector('.data-app-selected-icon[data-selection-key="activity:anonymous"]').getAttribute('aria-haspopup')`), null);
        await waitForExpression(client, sessionId, `Boolean(document.querySelector('.data-app-panel .qp-native-trend-line'))`);
        assert.equal(await evaluate(client, sessionId, `getComputedStyle(document.querySelector(${jsonString(anonymousOption)})).getPropertyValue('--data-series-color').trim()`), '#8F98A8');
        assert.equal(await evaluate(client, sessionId, `document.querySelector('.data-app-panel .qp-native-trend-line').getAttribute('stroke')`), '#8F98A8');
        await evaluate(client, sessionId, `document.querySelector('.data-app-panel').scrollIntoView({ block: 'start' })`);
        await captureDashboardScreenshot('anonymous-data.png');
        await evaluate(client, sessionId, `localStorage.setItem('__patina_anonymous_activity','all')`);
        await navigate();
        assert.equal(await evaluate(client, sessionId, `document.querySelectorAll('.dashboard-workspace svg.lucide-eye-off').length`), 1);
        assert.equal(await evaluate(client, sessionId, `document.querySelector('.dashboard-focus-total-center span')?.textContent?.trim()`), '1h 0m');
        assert.equal(await evaluate(client, sessionId, `document.querySelector('.dashboard-workspace').innerText.includes('Cursor')`), false);
    } finally {
      await evaluate(client, sessionId, `localStorage.removeItem('__patina_anonymous_activity')`);
      await navigate();
    }
  });

  await runTest("dashboard viewport has no horizontal overflow", async () => {
    for (const width of [900, 1100, 1280]) {
      await client!.command("Emulation.setDeviceMetricsOverride", {
        width,
        height: 820,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
      const clicked = await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `);
      assert.equal(clicked, true);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".dashboard-pulse-card"))`);
      await waitForExpression(client!, sessionId, `
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      `);
    }
  });

  await runTest("dashboard keeps card gutters consistent at compact desktop heights", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1102,
      height: 738,
      deviceScaleFactor: 1.25,
      mobile: false,
    }, sessionId);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".dashboard-pulse-card"))`);
    await captureDashboardScreenshot("dashboard-compact-125-percent.png");

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const focus = document.querySelector(".dashboard-focus-card")?.getBoundingClientRect();
          const pulse = document.querySelector(".dashboard-pulse-card")?.getBoundingClientRect();
          const right = document.querySelector(".dashboard-top-apps-list")
            ?.parentElement?.getBoundingClientRect();
          if (!focus || !pulse || !right) return false;
          const columnGap = right.left - focus.right;
          const rowGap = pulse.top - focus.bottom;
          return Math.abs(columnGap - rowGap) <= 0.5;
        })()
      `),
      true,
      "visible card gutters should use the same Quiet Pro spacing rhythm",
    );

    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await waitForAnimationFrames(client!, sessionId, 2);
    await captureDashboardScreenshot("dashboard-default.png");
  });

  await runTest("dashboard app ranking only reserves space for a real scrollbar", async () => {
    const fits = await evaluate(client!, sessionId, `
      (() => {
        const list = document.querySelector(".dashboard-top-apps-list");
        const row = list?.firstElementChild;
        if (!(list instanceof HTMLElement) || !(row instanceof HTMLElement)) return null;
        const listRect = list.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        return {
          fits: list.scrollHeight <= list.clientHeight + 1,
          lane: list.offsetWidth - list.clientWidth,
          paddingRight: Number.parseFloat(getComputedStyle(list).paddingRight),
          rightGap: listRect.right - rowRect.right,
        };
      })()
    `) as {
      fits: boolean;
      lane: number;
      paddingRight: number;
      rightGap: number;
    } | null;
    assert.ok(fits, "dashboard app ranking should expose a measurable row");
    assert.equal(fits.fits, true, "browser fixture should cover the no-overflow state");
    assert.equal(fits.lane, 0, "a fitting app ranking must return the scrollbar lane");
    assert.equal(fits.paddingRight, 0, "feature padding must not recreate a returned scrollbar lane");
    assert.ok(Math.abs(fits.rightGap) <= 0.5, "fitting rows should reach the list content edge");

    try {
      await evaluate(client!, sessionId, `
        (() => {
          const list = document.querySelector(".dashboard-top-apps-list");
          if (!(list instanceof HTMLElement)) return false;
          list.style.flex = "0 0 100px";
          list.style.height = "100px";
          return true;
        })()
      `);
      await waitForExpression(client!, sessionId, `
        (() => {
          const list = document.querySelector(".dashboard-top-apps-list");
          return list instanceof HTMLElement
            && list.scrollHeight > list.clientHeight
            && Number.parseFloat(getComputedStyle(list).paddingRight) === 8;
        })()
      `);
      const overflow = await evaluate(client!, sessionId, `
        (() => {
          const list = document.querySelector(".dashboard-top-apps-list");
          const row = list?.firstElementChild;
          if (!(list instanceof HTMLElement) || !(row instanceof HTMLElement)) return null;
          const listRect = list.getBoundingClientRect();
          const rowRect = row.getBoundingClientRect();
          return {
            lane: list.offsetWidth - list.clientWidth,
            paddingRight: Number.parseFloat(getComputedStyle(list).paddingRight),
            rightGap: listRect.right - rowRect.right,
          };
        })()
      `) as { lane: number; paddingRight: number; rightGap: number } | null;
      assert.ok(overflow, "overflowing app ranking should expose scrollbar geometry");
      assert.equal(overflow.lane, 6, "overflow should consume the canonical scrollbar lane");
      assert.equal(overflow.paddingRight, 8, "overflowing cards should keep their content breathing room");
      assert.ok(
        Math.abs(overflow.rightGap - overflow.lane - overflow.paddingRight) <= 0.5,
        "overflowing rows should reserve one scrollbar lane plus content breathing room",
      );
    } finally {
      await evaluate(client!, sessionId, `
        (() => {
          const list = document.querySelector(".dashboard-top-apps-list");
          if (!(list instanceof HTMLElement)) return;
          list.style.removeProperty("flex");
          list.style.removeProperty("height");
        })()
      `);
      await waitForExpression(client!, sessionId, `
        (() => {
          const list = document.querySelector(".dashboard-top-apps-list");
          return list instanceof HTMLElement
            && list.scrollHeight <= list.clientHeight + 1
            && Number.parseFloat(getComputedStyle(list).paddingRight) === 0;
        })()
      `);
    }
  });

  await runTest("dashboard focus donut keeps a restrained ring weight", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const ring = document.querySelector(
            '.dashboard-focus-chart svg[aria-label="专注分布"] > circle',
          );
          if (!(ring instanceof SVGCircleElement)) return false;
          const radius = Number(ring.getAttribute("r"));
          const strokeWidth = Number(ring.getAttribute("stroke-width"));
          const innerRadius = radius - strokeWidth / 2;
          return strokeWidth === 16 && innerRadius >= radius * 0.8;
        })()
      `),
      true,
      "focus donut should keep a generous center opening",
    );
  });

  await runTest("dashboard hourly chart toggles category layers", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const card = document.querySelector(".dashboard-pulse-card");
          const icon = document.querySelector(".dashboard-pulse-mode-toggle svg");
          if (!card || !icon) return false;
          const cardRect = card.getBoundingClientRect();
          const iconRect = icon.getBoundingClientRect();
          const contentRight = cardRect.right - parseFloat(getComputedStyle(card).paddingRight);
          return Math.abs(contentRight - iconRect.right) <= 1;
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const bars = Array.from(document.querySelectorAll(
            '.dashboard-pulse-chart [data-hourly-activity-chart-mode="total"] .qp-hourly-chart-bar',
          )).filter((bar) => bar.getBoundingClientRect().height > 0);
          return bars.length > 0 && bars.every((bar) => {
            if (!(bar instanceof SVGPathElement)) return false;
            const tokens = (bar.getAttribute("d") ?? "").trim().split(/\\s+/);
            const firstBaseline = Number(tokens[2]);
            const finalBaseline = Number(tokens.at(-2));
            return Number.isFinite(firstBaseline)
              && Math.abs(firstBaseline - finalBaseline) <= 0.001;
          });
        })()
      `),
      true,
      "total hourly bars should round only their top corners and keep a flat baseline",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".dashboard-pulse-mode-toggle");
          if (!toggle || toggle.getAttribute("aria-pressed") !== "false") return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-label")`,
      ),
      "显示总活动",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-chart [data-hourly-activity-chart-mode]")
        ?.getAttribute("data-hourly-activity-chart-mode") === "category"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        Array.from(document.querySelectorAll(".dashboard-pulse-chart svg g"))
          .filter((group) => group.querySelector(".qp-hourly-chart-bar"))
          .every((group) => {
            const segments = Array.from(group.querySelectorAll(".qp-hourly-chart-bar"));
            return segments.at(-1) instanceof SVGPathElement
              && segments.slice(0, -1).every((segment) =>
                segment instanceof SVGRectElement
                && Number(segment.getAttribute("rx") ?? 0) === 0
              );
          })
      `),
      true,
      "stacked hourly bars should round only the outer top edge",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".dashboard-pulse-chart [data-hourly-activity-chart-mode]")
          ?.getAttribute("data-hourly-activity-chart-mode")`,
      ),
      "category",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".dashboard-pulse-mode-toggle");
          if (!toggle) return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "false"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-label")`,
      ),
      "按分类显示",
    );
    await waitForAnimationFrames(client!, sessionId, 4);
    const readBarPoint = () => evaluate(client!, sessionId, `
      (() => {
        const bar = Array.from(document.querySelectorAll(".dashboard-pulse-chart .qp-hourly-chart-bar"))
          .find((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        if (!bar) return null;
        const rect = bar.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height / 2, 2) };
      })()
    `) as Promise<{ x: number; y: number } | null>;
    const barPoint = await readBarPoint();
    assert.ok(barPoint);
    await waitFor(
      "contained hourly chart tooltip",
      async () => {
        const visible = await evaluate(
          client!,
          sessionId,
          `Boolean(document.querySelector('.dashboard-pulse-chart .qp-chart-tooltip[role="tooltip"]'))`,
        );
        if (visible) return true;

        const currentBarPoint = await readBarPoint();
        if (!currentBarPoint) return null;
        await client!.command("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: 1,
          y: 1,
        }, sessionId);
        await client!.command("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: currentBarPoint.x,
          y: currentBarPoint.y,
        }, sessionId);
        return null;
      },
    );
    const hourlyTooltipGeometry = await evaluate(client!, sessionId, `
      (() => {
        const chart = document.querySelector(".dashboard-pulse-chart [data-hourly-activity-chart-mode]");
        const tooltip = chart?.querySelector('.qp-chart-tooltip[role="tooltip"]');
        if (!(chart instanceof HTMLElement) || !(tooltip instanceof HTMLElement)) return null;
        const chartRect = chart.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const axisTop = Math.min(
          ...Array.from(chart.querySelectorAll("svg text"))
            .map((node) => node.getBoundingClientRect().top),
        );
        const barBaseline = Math.max(
          ...Array.from(chart.querySelectorAll(".qp-hourly-chart-bar"))
            .map((node) => node.getBoundingClientRect().bottom),
        );
        return {
          axisTop,
          barBaseline,
          chartBottom: chartRect.bottom,
          chartTop: chartRect.top,
          left: tooltipRect.left,
          right: tooltipRect.right,
          tooltipBottom: tooltipRect.bottom,
          tooltipTop: tooltipRect.top,
        };
      })()
    `) as {
      axisTop: number;
      barBaseline: number;
      chartBottom: number;
      chartTop: number;
      left: number;
      right: number;
      tooltipBottom: number;
      tooltipTop: number;
    } | null;
    assert.ok(hourlyTooltipGeometry);
    assert.equal(
      hourlyTooltipGeometry.left >= barPoint.x + 8
        || hourlyTooltipGeometry.right <= barPoint.x - 8,
      true,
      "hourly tooltip should stay beside the active bar instead of covering it",
    );
    assert.equal(
      hourlyTooltipGeometry.tooltipTop >= hourlyTooltipGeometry.chartTop - 0.5
        && hourlyTooltipGeometry.tooltipBottom <= hourlyTooltipGeometry.chartBottom + 0.5,
      true,
      "hourly tooltip should stay within the chart container",
    );
    assert.equal(
      hourlyTooltipGeometry.tooltipBottom <= hourlyTooltipGeometry.axisTop - 4,
      true,
      "hourly tooltip should stop above the time-axis labels",
    );
    assert.ok(
      Math.abs(hourlyTooltipGeometry.tooltipBottom - hourlyTooltipGeometry.barBaseline) <= 0.5,
      "hourly tooltip bottom should align with the bar baseline",
    );
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 1,
      y: 1,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector('.dashboard-pulse-chart .qp-chart-tooltip[role="tooltip"]')`,
    );
  });

  await runTest("dashboard hourly chart supports keyboard toggle and keeps category mode across views", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".dashboard-pulse-mode-toggle");
          if (!toggle) return false;
          toggle.focus();
          return document.activeElement === toggle;
        })()
      `),
      true,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: " ",
      code: "Space",
      text: " ",
      unmodifiedText: " ",
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: " ",
      code: "Space",
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "false"`,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
  });

  await runTest("dashboard application icon opens shared detail without changing single-click behavior", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const navigation = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!navigation) return false;
          navigation.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".dashboard-top-app-detail-trigger"))`,
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
          if (!trigger) return false;
          trigger.click();
          return !document.querySelector(".destination-detail-dialog");
        })()
      `),
      true,
      "a normal click should remain inert",
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
          if (!trigger) return false;
          trigger.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-dialog"))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        const content = document.querySelector(
          ".destination-detail-dialog .destination-detail-day-content",
        );
        if (!content) return false;
        const now = new Date();
        const todayKey = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-");
        return content.getAttribute("data-destination-detail-requested-date") === todayKey;
      })()`,
    );
    await evaluate(
      client!,
      sessionId,
      `document.querySelector('.destination-detail-dialog [aria-label="关闭详情"]')?.click()`,
    );
    await waitForExpression(client!, sessionId, `!document.querySelector(".destination-detail-dialog")`);

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
          if (!trigger) return false;
          trigger.focus();
          trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          return document.activeElement === trigger;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-dialog"))`,
    );
    await evaluate(
      client!,
      sessionId,
      `document.querySelector('.destination-detail-dialog [aria-label="关闭详情"]')?.click()`,
    );
    await waitForExpression(client!, sessionId, `!document.querySelector(".destination-detail-dialog")`);
  });

  await runTest("dashboard app icon supports quick rename and category context actions", async () => {
    const settingsBefore = await evaluate(client!, sessionId, `localStorage.getItem('__time_tracker_smoke_settings')`);
    try {
      await waitForExpression(
        client!,
        sessionId,
        `Boolean(document.querySelector(".dashboard-top-app-detail-trigger"))`,
      );
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
            if (!(trigger instanceof HTMLElement)) return false;
            const rect = trigger.getBoundingClientRect();
            trigger.dispatchEvent(new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              button: 2,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
            }));
            return !trigger.hasAttribute("title");
          })()
        `),
        true,
        "the icon must not rely on a native title tooltip",
      );
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const menu = document.querySelector('.quick-classification-menu[role="menu"]');
            if (!(menu instanceof HTMLElement)) return false;
            const rect = menu.getBoundingClientRect();
            const items = Array.from(menu.querySelectorAll(':scope > .quick-classification-menu-item'));
            return rect.width <= 149
              && rect.height <= 66
              && menu.querySelector(':scope > .quick-classification-menu-item svg') === null
              && items.every((item) => item.getBoundingClientRect().height <= 29);
          })()
        `),
        true,
        "quick actions should use compact desktop-menu density",
      );
      assert.deepEqual(
        await evaluate(client!, sessionId, `
          Array.from(document.querySelectorAll('.quick-classification-menu[role="menu"] > .quick-classification-menu-item'))
            .map((item) => item.textContent?.trim())
        `),
        ["更改名称", "更改分类"],
      );

      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll('.quick-classification-menu-item'))
            .find((item) => item.textContent?.includes("更改分类"));
          trigger?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
        })()
      `);
      await waitForAnimationFrames(client!, sessionId, 2);
      assert.equal(
        await evaluate(client!, sessionId, `Boolean(document.querySelector('.quick-classification-category-menu'))`),
        false,
        "hovering the category action must not open the submenu",
      );

      await evaluate(client!, sessionId, `
        Array.from(document.querySelectorAll('.quick-classification-menu-item'))
          .find((item) => item.textContent?.includes("更改分类"))?.click()
      `);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-category-menu'))`);
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const menu = document.querySelector('.quick-classification-category-menu');
            if (!(menu instanceof HTMLElement)) return false;
            const rect = menu.getBoundingClientRect();
            const firstItemRect = menu.querySelector('.quick-classification-menu-item')?.getBoundingClientRect();
            return rect.left >= 11 && rect.top >= 11
              && rect.right <= window.innerWidth - 11
              && rect.bottom <= window.innerHeight - 11
              && rect.width <= 185
              && rect.height <= 273
              && Boolean(firstItemRect && firstItemRect.height <= 29);
          })()
        `),
        true,
        "the category submenu should remain inside the viewport",
      );
      // The submenu focuses its selected item on the next frame. Let that
      // focus scroll finish before sending real wheel input.
      await waitForExpression(client!, sessionId, `document.activeElement?.matches('.quick-classification-category-menu [aria-checked="true"]')`);
      await waitForAnimationFrames(client!, sessionId, 2);
      const categoryMenuCenter = await evaluate(client!, sessionId, `
        (() => {
          const menu = document.querySelector('.quick-classification-category-menu');
          if (!(menu instanceof HTMLElement)) return null;
          const rect = menu.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            canScroll: menu.scrollHeight > menu.clientHeight,
          };
        })()
      `) as { x: number; y: number; canScroll: boolean } | null;
      assert.equal(categoryMenuCenter?.canScroll, true, "the category submenu fixture should overflow");
      assert.equal(await evaluate(client!, sessionId, `(() => {
        const menu = document.querySelector('.quick-classification-category-menu');
        return menu?.contains(document.elementFromPoint(${categoryMenuCenter!.x}, ${categoryMenuCenter!.y}));
      })()`), true, "wheel coordinates should hit the category submenu");
      await client!.command("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: categoryMenuCenter!.x,
        y: categoryMenuCenter!.y,
        deltaX: 0,
        deltaY: 180,
      }, sessionId);
      await waitForExpression(client!, sessionId, `
        (() => {
          const menu = document.querySelector('.quick-classification-category-menu');
          return menu instanceof HTMLElement && menu.scrollTop > 0;
        })()
      `);
      assert.equal(
        await evaluate(client!, sessionId, `Boolean(document.querySelector('.quick-classification-category-menu'))`),
        true,
        "wheel-scrolling the category submenu must not close it",
      );
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const options = Array.from(document.querySelectorAll('.quick-classification-category-menu [role="menuitemradio"]'));
            const unclassified = options.find((item) => item.textContent?.includes("未分类"));
            if (!(unclassified instanceof HTMLElement)) return false;
            unclassified.click();
            return true;
          })()
        `),
        true,
      );
      await waitForExpression(client!, sessionId, `
        Boolean(document.querySelector('.dashboard-top-app-name-row .qp-badge')?.textContent?.includes("未分类"))
      `);
      assert.equal(
        await evaluate(client!, sessionId, `Boolean(document.querySelector('.dashboard-top-app-meta .qp-badge'))`),
        false,
        "the unclassified badge belongs beside the app name, not in the share row",
      );
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const badge = document.querySelector('.dashboard-top-app-name-row .qp-badge');
            const nameRow = document.querySelector('.dashboard-top-app-name-row');
            const duration = document.querySelector('.dashboard-top-app-duration');
            if (
              !(badge instanceof HTMLElement)
              || !(nameRow instanceof HTMLElement)
              || !(duration instanceof HTMLElement)
            ) return false;
            const badgeRect = badge.getBoundingClientRect();
            const nameRowRect = nameRow.getBoundingClientRect();
            const durationRect = duration.getBoundingClientRect();
            const badgeStyle = getComputedStyle(badge);
            return badge.classList.contains('qp-badge-regular')
              && badge.classList.contains('qp-badge-neutral')
              && Math.abs(nameRowRect.height - badgeRect.height) <= 2
              && badgeStyle.fontSize === '11px'
              && badgeStyle.fontWeight === '500'
              && badgeRect.right + 8 <= durationRect.left;
          })()
        `),
        true,
        "the badge should match the app-name line height without crowding duration",
      );
      assert.equal(
        await evaluate(client!, sessionId, `
          globalThis.__TIME_TRACKER_CLASSIFICATION_MUTATIONS?.some((mutation) =>
            mutation.key === "__app_override::cursor.exe" && mutation.value === null
          ) ?? false
        `),
        true,
        "choosing unclassified should clear only the manual category",
      );

      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
          if (!(trigger instanceof HTMLElement)) return false;
          const rect = trigger.getBoundingClientRect();
          trigger.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          }));
          return true;
        })()
      `);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
      assert.deepEqual(
        await evaluate(client!, sessionId, `
          Array.from(document.querySelectorAll('.quick-classification-menu[role="menu"] > .quick-classification-menu-item'))
            .map((item) => item.textContent?.trim())
        `),
        ["更改名称", "设置分类"],
        "clearing the category should switch the action back to set category",
      );
      await evaluate(client!, sessionId, `
        Array.from(document.querySelectorAll('.quick-classification-menu-item'))
          .find((item) => item.textContent?.includes("更改名称"))?.click()
      `);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('#quick-classification-rename-form'))`);
      await waitForExpression(client!, sessionId, `document.activeElement?.matches('.quick-classification-rename-input')`);
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const dialog = document.querySelector('.quick-classification-rename-dialog');
            const input = document.querySelector('.quick-classification-rename-input');
            if (!(dialog instanceof HTMLElement) || !(input instanceof HTMLElement)) return false;
            const dialogRect = dialog.getBoundingClientRect();
            const inputRect = input.getBoundingClientRect();
            return dialogRect.width <= 421 && inputRect.height <= 39;
          })()
        `),
        true,
        "quick rename should use compact task-dialog proportions",
      );
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const input = document.querySelector('.quick-classification-rename-input');
            if (!(input instanceof HTMLInputElement)) return false;
            const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            valueSetter?.call(input, "Smoke Alias");
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return document.activeElement === input;
          })()
        `),
        true,
        "rename dialog should focus its input without a native hover surface",
      );
      await evaluate(client!, sessionId, `
        document.querySelector('#quick-classification-rename-form')?.dispatchEvent(
          new SubmitEvent("submit", { bubbles: true, cancelable: true }),
        )
      `);
      await waitForExpression(client!, sessionId, `
        (() => {
          const settings = JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}");
          const raw = settings["__app_override::cursor.exe"];
          return raw ? JSON.parse(raw).displayName === "Smoke Alias" : false;
        })()
      `);
      await waitForExpression(client!, sessionId, `
        Array.from(document.querySelectorAll('.dashboard-top-app-detail-trigger + div span'))
          .some((node) => node.textContent?.trim() === "Smoke Alias")
      `);

      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
            if (!(trigger instanceof HTMLElement)) return false;
            trigger.focus();
            trigger.dispatchEvent(new KeyboardEvent("keydown", {
              key: "F10",
              shiftKey: true,
              bubbles: true,
              cancelable: true,
            }));
            return true;
          })()
        `),
        true,
      );
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
      await evaluate(client!, sessionId, `
        document.querySelector('.quick-classification-menu[role="menu"]')?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        )
      `);
      await waitForExpression(client!, sessionId, `!document.querySelector('.quick-classification-menu[role="menu"]')`);
      await waitForExpression(client!, sessionId, `document.activeElement?.matches('.dashboard-top-app-detail-trigger')`);

      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
          if (!(trigger instanceof HTMLElement)) return false;
          trigger.focus();
          trigger.dispatchEvent(new KeyboardEvent("keydown", {
            key: "F10",
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }));
          return true;
        })()
      `);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
      await evaluate(client!, sessionId, `
        document.querySelector('.dashboard-top-apps-list')?.dispatchEvent(new Event("scroll", { bubbles: false }))
      `);
      await waitForExpression(client!, sessionId, `!document.querySelector('.quick-classification-menu[role="menu"]')`);

      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".dashboard-top-app-detail-trigger");
          if (!(trigger instanceof HTMLElement)) return false;
          trigger.focus();
          trigger.dispatchEvent(new KeyboardEvent("keydown", {
            key: "F10",
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }));
          return true;
        })()
      `);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
      await waitForExpression(client!, sessionId, `document.activeElement?.matches('.quick-classification-menu-item')`);
      await evaluate(client!, sessionId, `
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
        )
      `);
      await waitForExpression(client!, sessionId, `!document.querySelector('.quick-classification-menu[role="menu"]')`);
      await waitForExpression(client!, sessionId, `
        document.activeElement?.matches('.dashboard-top-app-detail-trigger')
          && document.activeElement !== document.querySelector('.dashboard-top-app-detail-trigger')
      `);
    } finally {
      const origin = await evaluate(client!, sessionId, "performance.timeOrigin");
      await evaluate(client!, sessionId, `(() => {
        const settings = ${JSON.stringify(settingsBefore)};
        if (settings === null) localStorage.removeItem('__time_tracker_smoke_settings');
        else localStorage.setItem('__time_tracker_smoke_settings', settings);
        location.reload();
      })()`);
      await waitForExpression(client!, sessionId, `performance.timeOrigin !== ${origin} && Boolean(document.querySelector('main'))`,
        15_000, "restore classification settings after quick-action persistence assertions");
    }
  });
}
