import assert from "node:assert/strict";
import { getLocaleText, loadLocaleText } from "../../src/shared/i18n/runtime.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import {
  delay,
  evaluate,
  jsonString,
  waitForAnimationFrames,
  waitForExpression,
  waitForStableExpression,
} from "./browserHarness.ts";

const COPY = { "zh-CN": getLocaleText("zh-CN") } as const;

export async function runDataReadFailureScenarios(context: BrowserSmokeContext) {
  const { appUrl, client, sessionId, runTest } = context;
  const metric = `document.querySelector('.data-trend-inline-metric strong')?.textContent?.trim()`;
  const openData = async () => {
    const previousDocument = await evaluate(client, sessionId, `performance.timeOrigin`);
    await client.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(client, sessionId, `performance.timeOrigin !== ${previousDocument} && document.readyState === 'complete'`);
    await waitForExpression(client, sessionId, `Boolean(document.querySelector('[aria-label="数据"]'))`);
    await evaluate(client, sessionId, `document.querySelector('[aria-label="数据"]').click()`);
    await waitForExpression(client, sessionId, `Boolean(document.querySelector('.data-trend-panel'))`);
  };
  const refresh = async () => {
    await evaluate(client, sessionId, `globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed', { reason: 'session-transition', changed_at_ms: Date.now() })`);
  };
  const pressEnter = async () => {
    await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId);
    await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, sessionId);
  };

  await runTest("data cold read failures are local, announced, and recover through keyboard retry", async () => {
    await evaluate(client, sessionId, `localStorage.setItem('__patina_reject_aggregate_kind', 'week')`);
    try {
      await openData();
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('[data-trend-read-error]'))`);
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('.data-overview .data-heatmap-weeks'))`);
      assert.ok(String(await evaluate(client, sessionId, `document.querySelector('[data-trend-read-error]')?.textContent`)).includes(COPY["zh-CN"].common.readFailed));
      assert.equal(await evaluate(client, sessionId, metric), "-");
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('.data-app-panel .data-web-error button'))`), true);
      await evaluate(client, sessionId, `localStorage.removeItem('__patina_reject_aggregate_kind')`);
      for (const sample of [
        { panel: ".data-overview", error: "[data-trend-read-error]", ready: `${metric} === '1h 0m'` },
        { panel: ".data-app-panel", error: ".data-web-error", ready: `Boolean(document.querySelector('.data-app-panel .data-app-option'))` },
      ]) {
        await evaluate(client, sessionId, `globalThis.__PATINA_PENDING_AGGREGATES = [];
          globalThis.__PATINA_AGGREGATE_HOOK = (request) => request.bucketCount === 8
            ? new Promise(resolve => globalThis.__PATINA_PENDING_AGGREGATES.push({ resolve }))
            : undefined;
          document.querySelector('${sample.panel} ${sample.error} button').focus()`);
        await pressEnter();
        await waitForExpression(client, sessionId, `globalThis.__PATINA_PENDING_AGGREGATES.length > 0`);
        assert.equal(await evaluate(client, sessionId, `document.activeElement?.matches('${sample.panel} .data-trend-range-trigger')`), true,
          `${sample.panel}: cold keyboard retry must transfer focus before its read completes`);
        await evaluate(client, sessionId, `globalThis.__PATINA_AGGREGATE_HOOK = undefined;
          globalThis.__PATINA_PENDING_AGGREGATES.forEach(entry => entry.resolve())`);
        await waitForExpression(client, sessionId, `${sample.ready} && !document.querySelector('${sample.panel} ${sample.error}')`);
        assert.equal(await evaluate(client, sessionId, `document.activeElement?.matches('${sample.panel} .data-trend-range-trigger')`), true);
      }
    } finally {
      await evaluate(client, sessionId, `localStorage.removeItem('__patina_reject_aggregate_kind');
        globalThis.__PATINA_AGGREGATE_HOOK = undefined;
        globalThis.__PATINA_PENDING_AGGREGATES?.forEach(entry => entry.resolve())`);
    }
  });

  await runTest("data same-query refresh failures retain the last successful metrics", async () => {
    const before = await evaluate(client, sessionId, metric);
    await evaluate(client, sessionId, `globalThis.__PATINA_AGGREGATE_HOOK = async (request) => {
      if (request.bucketCount === 8) throw new Error('Injected data refresh failure');
    }`);
    await refresh();
    await waitForExpression(client, sessionId, `Boolean(document.querySelector('[data-trend-read-error]'))`);
    assert.equal(await evaluate(client, sessionId, metric), before);
    assert.ok(String(await evaluate(client, sessionId, `document.querySelector('[data-trend-read-error]')?.textContent`)).includes(COPY["zh-CN"].common.refreshFailed));
    await evaluate(client, sessionId, `document.querySelector('[data-trend-read-error] button').focus()`);
    await pressEnter();
    await waitForExpression(client, sessionId, `Boolean(document.querySelector('[data-trend-read-error]'))`);
    assert.equal(await evaluate(client, sessionId, metric), before);
    assert.equal(await evaluate(client, sessionId, `document.activeElement?.matches('.data-overview .data-trend-range-trigger')`), true,
      "a failed keyboard retry keeps focus in its trend panel");
    try {
      for (const sample of [
        { panel: ".data-overview", error: "[data-trend-read-error]", other: ".data-app-panel" },
        { panel: ".data-app-panel", error: ".data-app-refresh-status", other: ".data-overview" },
      ]) {
        await waitForExpression(client, sessionId, `Boolean(document.querySelector('${sample.panel} ${sample.error} button'))`);
        await evaluate(client, sessionId, `globalThis.__PATINA_PENDING_AGGREGATES = [];
          globalThis.__PATINA_AGGREGATE_HOOK = (request) => request.bucketCount === 8
            ? new Promise(resolve => globalThis.__PATINA_PENDING_AGGREGATES.push({ resolve }))
            : undefined;
          document.querySelector('${sample.panel} ${sample.error} button').focus()`);
        await pressEnter();
        await waitForExpression(client, sessionId, `globalThis.__PATINA_PENDING_AGGREGATES.length > 0`);
        assert.equal(await evaluate(client, sessionId, `document.activeElement?.matches('${sample.panel} .data-trend-range-trigger')`), true,
          `${sample.panel}: warm keyboard retry must transfer focus before its read completes`);
        await evaluate(client, sessionId, `document.querySelector('${sample.other} .data-trend-range-trigger').focus();
          globalThis.__PATINA_AGGREGATE_HOOK = undefined;
          globalThis.__PATINA_PENDING_AGGREGATES.forEach(entry => entry.resolve())`);
        await waitForExpression(client, sessionId, `!document.querySelector('${sample.panel} ${sample.error}')`);
        assert.equal(await evaluate(client, sessionId, `document.activeElement?.matches('${sample.other} .data-trend-range-trigger')`), true,
          `${sample.panel}: completed retry must not steal focus after the user moves away`);
        assert.equal(await evaluate(client, sessionId, metric), before);
      }
    } finally {
      await evaluate(client, sessionId, `globalThis.__PATINA_AGGREGATE_HOOK = undefined;
        globalThis.__PATINA_PENDING_AGGREGATES?.forEach(entry => entry.resolve())`);
    }
  });

  await runTest("data heatmap refresh failure preserves the current cells and each panel retries independently", async () => {
    await openData();
    await waitForExpression(client, sessionId, `['.data-overview', '.data-app-panel'].every((panel) =>
      document.querySelectorAll(panel + ' [data-heatmap-date]').length > 0
        && !document.querySelector(panel + ' .data-heatmap-loading-state')
        && !document.querySelector(panel + ' .data-heatmap-refresh-status'))`);
    const cells = `Array.from(document.querySelectorAll('.data-overview [data-heatmap-date]')).map((cell) => [cell.dataset.heatmapDate, cell.getAttribute('aria-label'), cell.style.getPropertyValue('--heatmap-intensity')])`;
    const before = await evaluate(client, sessionId, cells);
    await evaluate(client, sessionId, `globalThis.__PATINA_AGGREGATE_HOOK = async (request) => {
      if (request.bucketCount > 100) throw new Error('Injected warm heatmap failure');
    }`);
    await refresh();
    await waitForExpression(client, sessionId, `['.data-overview', '.data-app-panel'].every((panel) =>
      Boolean(document.querySelector(panel + ' .data-heatmap-refresh-status')))`);
    assert.deepEqual(await evaluate(client, sessionId, cells), before);
    assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('[data-trend-read-error]'))`), false);
    await evaluate(client, sessionId, `globalThis.__PATINA_AGGREGATE_HOOK = undefined;
      document.querySelector('.data-overview .data-heatmap-refresh-status button').focus()`);
    await pressEnter();
    await waitForExpression(client, sessionId, `!document.querySelector('.data-overview .data-heatmap-refresh-status') && !document.querySelector('.data-overview .data-heatmap-loading-state')`);
    assert.equal(await evaluate(client, sessionId, `document.activeElement?.matches('.data-overview .data-heatmap-range-control button:not(:disabled), .data-overview .data-heatmap-panel')`), true,
      "keyboard retry must leave focus on its heatmap controls when the retry button disappears");
    assert.deepEqual(await evaluate(client, sessionId, cells), before);
    assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('.data-app-panel .data-heatmap-refresh-status'))`), true,
      "retrying the overview must not silently clear the destination panel's failed read");
    await evaluate(client, sessionId, `document.querySelector('.data-app-panel .data-heatmap-refresh-status button').focus()`);
    await pressEnter();
    await waitForExpression(client, sessionId, `!document.querySelector('.data-app-panel .data-heatmap-refresh-status')`);
    assert.equal(await evaluate(client, sessionId, `document.activeElement?.matches('.data-app-panel .data-heatmap-range-control button:not(:disabled), .data-app-panel .data-heatmap-panel')`), true);

    await evaluate(client, sessionId, `globalThis.__PATINA_AGGREGATE_HOOK = async (request) => {
      if (request.bucketCount > 100) throw new Error('Injected heatmap keyboard retry failure');
    }`);
    await refresh();
    await waitForExpression(client, sessionId, `['.data-overview', '.data-app-panel'].every((panel) =>
      Boolean(document.querySelector(panel + ' .data-heatmap-refresh-status')))`);
    await evaluate(client, sessionId, `globalThis.__PATINA_PENDING_AGGREGATES = [];
      globalThis.__PATINA_AGGREGATE_HOOK = (request) => request.bucketCount > 100
        ? new Promise(resolve => globalThis.__PATINA_PENDING_AGGREGATES.push({ request, resolve }))
        : undefined;
      document.querySelector('.data-overview .data-heatmap-refresh-status button').focus()`);
    await pressEnter();
    await waitForExpression(client, sessionId, `globalThis.__PATINA_PENDING_AGGREGATES.length > 0`);
    await evaluate(client, sessionId, `document.querySelector('.data-overview .data-trend-range-trigger').focus();
      globalThis.__PATINA_AGGREGATE_HOOK = undefined;
      globalThis.__PATINA_PENDING_AGGREGATES.forEach(entry => entry.resolve({ records: [], readPath: 'projection', fallbackReason: null, sourceRevision: 5, projectionRowCount: 0, factRowCount: 0, hasActiveSession: false }))`);
    await waitForExpression(client, sessionId, `(() => {
      const cells = Array.from(document.querySelectorAll('.data-overview [data-heatmap-date]'));
      return cells.length > 0 && cells.every(cell => Number(cell.style.getPropertyValue('--heatmap-intensity')) === 0);
    })()`);
    assert.equal(await evaluate(client, sessionId, `document.activeElement?.matches('.data-overview .data-trend-range-trigger')`), true,
      "a resolved heatmap retry must not steal focus after the user moves to a different control");
  });

  await runTest("data heatmap selection ignores superseded success and failure after returning to recent data", async () => {
    for (const outcome of ["success", "failure"]) {
      await openData();
      await waitForExpression(client, sessionId, `Boolean(document.querySelector('.data-overview .data-heatmap-weeks')) && !document.querySelector('.data-overview .data-heatmap-loading-state')`);
      const cells = `Array.from(document.querySelectorAll('.data-overview [data-heatmap-date]')).map((cell) => [cell.dataset.heatmapDate, cell.getAttribute('aria-label'), cell.style.getPropertyValue('--heatmap-intensity')])`;
      const before = await evaluate(client, sessionId, cells);
      await evaluate(client, sessionId, `
        globalThis.__PATINA_PENDING_AGGREGATES = [];
        const recentStart = globalThis.__PATINA_AGGREGATE_READS.find((request) => request.bucketCount > 100).startMs;
        globalThis.__PATINA_AGGREGATE_HOOK = (request) => request.bucketCount > 100 && request.startMs !== recentStart
          ? new Promise((resolve, reject) => globalThis.__PATINA_PENDING_AGGREGATES.push({ request, resolve, reject }))
          : undefined;
        document.querySelector('.data-overview .data-heatmap-range-control [aria-label="切到更早范围"]').click();
      `);
      await waitForExpression(client, sessionId, `globalThis.__PATINA_PENDING_AGGREGATES.length > 0`);
      assert.notDeepEqual(await evaluate(client, sessionId, cells), before,
        "the pending year must not display the recent range's cells");
      await evaluate(client, sessionId, `document.querySelector('.data-overview .data-heatmap-range-control [aria-label="切到较新范围"]').click()`);
      await waitForExpression(client, sessionId, `document.querySelector('.data-overview .data-heatmap-range-control .qp-range-control-label')?.textContent === '近一年' && !document.querySelector('.data-overview .data-heatmap-loading-state')`);
      await evaluate(client, sessionId, outcome === "failure"
        ? `globalThis.__PATINA_PENDING_AGGREGATES.forEach((entry) => entry.reject(new Error('Superseded heatmap range')))`
        : `globalThis.__PATINA_PENDING_AGGREGATES.forEach((entry) => entry.resolve({ records: [], readPath: 'projection', fallbackReason: null, sourceRevision: 4, projectionRowCount: 0, factRowCount: 0, hasActiveSession: false }))`);
      await waitForAnimationFrames(client, sessionId, 2);
      assert.deepEqual(await evaluate(client, sessionId, cells), before);
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('.data-overview .data-heatmap-panel [role="status"]'))`), false);
      await evaluate(client, sessionId, `globalThis.__PATINA_AGGREGATE_HOOK = undefined`);
    }
  });

  await runTest("data range changes ignore slow successes and late failures from superseded queries", async () => {
    const advance = async () => {
      await evaluate(client, sessionId, `document.querySelector('.data-overview [aria-label="扩大趋势范围"]').click()`);
    };
    for (const outcome of ["success", "failure"]) {
      await openData();
      await waitForExpression(client, sessionId, `${metric} === '1h 0m'`);
      await evaluate(client, sessionId, `
        globalThis.__PATINA_PENDING_AGGREGATES = [];
        globalThis.__PATINA_AGGREGATE_HOOK = (request) => request.bucketCount === 31
          ? new Promise((resolve, reject) => globalThis.__PATINA_PENDING_AGGREGATES.push({ request, resolve, reject }))
          : undefined;
      `);
      await advance();
      await waitForExpression(client, sessionId, `globalThis.__PATINA_PENDING_AGGREGATES.length > 0`);
      assert.equal(await evaluate(client, sessionId, metric), "-", "thirty-day title must not display a seven-day snapshot");
      await advance();
      await waitForExpression(client, sessionId, `document.querySelector('.data-overview .data-trend-range-trigger')?.textContent === '近一年' && ${metric} === '1h 0m'`);
      await evaluate(client, sessionId, outcome === "failure"
        ? `globalThis.__PATINA_PENDING_AGGREGATES.forEach((entry) => entry.reject(new Error('Superseded data range')))`
        : `globalThis.__PATINA_PENDING_AGGREGATES.forEach((entry) => entry.resolve({ records: [], readPath: 'projection', fallbackReason: null, sourceRevision: 4, projectionRowCount: 0, factRowCount: 0, hasActiveSession: false }))`);
      await waitForAnimationFrames(client, sessionId, 2);
      assert.equal(await evaluate(client, sessionId, metric), "1h 0m");
      assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('[data-trend-read-error]'))`), false);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.data-overview .data-trend-range-trigger')?.textContent`), COPY["zh-CN"].data.recentYear);
      await evaluate(client, sessionId, `globalThis.__PATINA_AGGREGATE_HOOK = undefined;
        document.querySelector('.data-overview [aria-label="缩短趋势范围"]').click()`);
      await waitForExpression(client, sessionId, `document.querySelector('.data-overview .data-trend-range-trigger')?.textContent === '近 30 天'`);
      await evaluate(client, sessionId, `document.querySelector('.data-overview [aria-label="缩短趋势范围"]').click()`);
      await waitForExpression(client, sessionId, `document.querySelector('.data-overview .data-trend-range-trigger')?.textContent === '近 7 天' && ${metric} === '1h 0m'`);
    }
    await openData();
  });

  await runTest("data cached ranges follow locale and local-day changes without changing selection", async () => {
    await openData();
    const ready = `document.querySelector('.data-trend-panel')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('.data-app-grid')?.getAttribute('aria-busy') === 'false'
      && Boolean(document.querySelector('.data-overview [data-heatmap-date]'))`;
    const selected = `Array.from(document.querySelectorAll('.data-app-option[aria-pressed="true"]')).map(node => node.getAttribute('data-destination-key'))`;
    const values = `Array.from(document.querySelectorAll('.data-trend-inline-metric strong, .data-app-metric strong')).map(node => node.textContent)`;
    await waitForExpression(client, sessionId, ready);
    const selectedBefore = await evaluate(client, sessionId, selected) as string[];
    const valuesBefore = await evaluate(client, sessionId, values);
    const settingsBefore = await evaluate(client, sessionId, `localStorage.getItem('__time_tracker_smoke_settings')`);
    const sidebarMode = await evaluate(client, sessionId, `localStorage.getItem('patina:sidebar-navigation-mode')`);
    try {
      for (const locale of ["en-US", "zh-CN"] as const) {
        await evaluate(client, sessionId, `(() => {
          const settings = JSON.parse(localStorage.getItem('__time_tracker_smoke_settings') ?? '{}');
          settings.language = ${jsonString(locale)};
          localStorage.setItem('__time_tracker_smoke_settings', JSON.stringify(settings));
          globalThis.__PATINA_EMIT_TAURI_EVENT('app-settings-changed', { language: ${jsonString(locale)} });
        })()`);
        const copy = await loadLocaleText(locale);
        await waitForExpression(client, sessionId, `document.documentElement.lang === ${jsonString(locale)} && ${ready}
          && Array.from(document.querySelectorAll('.data-trend-range-trigger')).every(node => node.textContent === ${jsonString(copy.data.pastSevenDays)})`);
        assert.deepEqual(await evaluate(client, sessionId, values), valuesBefore,
          "changing locale must remap cached labels without changing durations");
        assert.deepEqual(await evaluate(client, sessionId, selected), selectedBefore);
        assert.equal(await evaluate(client, sessionId, `document.querySelector('.data-overview .data-heatmap-range-control .qp-range-control-label')?.textContent`), copy.data.recentYear);
      }
      const nextDay = await evaluate(client, sessionId, `(() => {
        const NativeDate = Date;
        const next = new NativeDate();
        next.setDate(next.getDate() + ((8 - next.getDay()) % 7 || 7));
        next.setHours(12, 0, 0, 0);
        const now = next.getTime();
        const dateKey = [next.getFullYear(), String(next.getMonth() + 1).padStart(2, '0'), String(next.getDate()).padStart(2, '0')].join('-');
        globalThis.__PATINA_RESTORE_DATA_DATE = () => { globalThis.Date = NativeDate; };
        globalThis.Date = new Proxy(NativeDate, {
          construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [now], newTarget); },
          get(target, key) { return key === 'now' ? () => now : Reflect.get(target, key); }
        });
        globalThis.__PATINA_ROLLOVER_READS = [];
        globalThis.__PATINA_AGGREGATE_HOOK = (request) => request.bucketCount > 0
          ? new Promise(resolve => globalThis.__PATINA_ROLLOVER_READS.push({ request, resolve }))
          : undefined;
        document.querySelector('[data-sidebar-footer] button').click();
        return { now, dateKey, tick: dateKey.slice(5) };
      })()`) as { now: number; dateKey: string; tick: string };
      await waitForAnimationFrames(client, sessionId, 2);
      assert.equal(await evaluate(client, sessionId, metric), "-",
        "the new seven-day range must hide the previous local-day metric until its read completes");
      await waitForExpression(client, sessionId, `globalThis.__PATINA_ROLLOVER_READS.some(entry => entry.request.bucketCount === 8)
        && globalThis.__PATINA_ROLLOVER_READS.some(entry => entry.request.bucketCount > 100)`, 5_000,
      "Data must refresh both local-date owners after a sidebar render without a tracking event");
      await waitForExpression(client, sessionId,
        `Boolean(document.querySelector('.data-overview .data-heatmap-loading-state'))`, 5_000,
        "crossing a week boundary must not retain the previous heatmap range after React commits");
      await evaluate(client, sessionId, `globalThis.__PATINA_ROLLOVER_READS.forEach(entry => entry.resolve({
        records: [
          { appName: 'Cursor', exeName: 'cursor.exe', startTime: ${nextDay.now - 1_200_000}, endTime: ${nextDay.now - 600_000} },
          { appName: 'Research', exeName: 'deep-research-workbench.exe', startTime: ${nextDay.now - 600_000}, endTime: ${nextDay.now} }
        ], readPath: 'projection', fallbackReason: null, sourceRevision: 6, projectionRowCount: 2, factRowCount: 0, hasActiveSession: false
      }))`);
      await waitForExpression(client, sessionId, `${ready} && ${metric} === '20m'`);
      assert.deepEqual(await evaluate(client, sessionId, selected), selectedBefore);
      assert.equal(await evaluate(client, sessionId, `document.querySelector('.data-app-metric strong')?.textContent`), `${selectedBefore.length * 10}m`);
      for (const panel of [".data-overview", ".data-app-panel"]) {
        assert.equal(await evaluate(client, sessionId, `Array.from(document.querySelectorAll('${panel} .qp-native-trend-hit')).at(-1)?.getAttribute('aria-label')?.includes(${jsonString(nextDay.tick)})`), true,
          `${panel}: the last chart date must match the new local-day data`);
        assert.equal(await evaluate(client, sessionId, `document.querySelector('${panel} .data-trend-range-trigger')?.textContent`), COPY["zh-CN"].data.pastSevenDays);
        assert.equal(await evaluate(client, sessionId, `document.querySelector('${panel} [data-heatmap-date="${nextDay.dateKey}"]')?.getAttribute('aria-label')?.includes('${panel === ".data-overview" ? 20 : selectedBefore.length * 10}m')`), true,
          `${panel}: the new heatmap date must expose the corresponding duration`);
      }
    } finally {
      await evaluate(client, sessionId, `globalThis.__PATINA_RESTORE_DATA_DATE?.();
        delete globalThis.__PATINA_RESTORE_DATA_DATE;
        globalThis.__PATINA_AGGREGATE_HOOK = undefined;
        globalThis.__PATINA_ROLLOVER_READS?.forEach(entry => entry.resolve());
        localStorage.setItem('__time_tracker_smoke_settings', ${jsonString(String(settingsBefore))});
        ${sidebarMode === null ? "localStorage.removeItem('patina:sidebar-navigation-mode')" : `localStorage.setItem('patina:sidebar-navigation-mode', ${jsonString(String(sidebarMode))})`};`);
      await openData();
    }
  });
}

const VISIBLE_DESTINATION_DETAIL_POPOVER = `(() => {
  const popover = document.querySelector(".destination-detail-record-popover");
  return popover instanceof HTMLElement
    && Boolean(popover.querySelector(".destination-detail-popover-item"))
    && Boolean(popover.dataset.placement)
    && getComputedStyle(popover).visibility === "visible";
})()`;

export async function runDataScenarios(
  context: BrowserSmokeContext,
  options: { continuityOnly?: boolean } = {},
) {
  const { appUrl, client, sessionId, runTest } = context;
  const assertQuickClassificationKeyboard = async (listSelector: string, supported = true) => {
    const selectedKeys = `Array.from(document.querySelectorAll('${listSelector} button[aria-pressed="true"]')).map(button => button.getAttribute('data-destination-key'))`;
    const before = await evaluate(client, sessionId, selectedKeys);
    for (const selector of supported
      ? [`${listSelector} button[aria-haspopup="menu"]`, '.data-app-selected-icon[aria-haspopup="menu"]']
      : [`${listSelector} button`]) {
      for (const shortcut of [
        { key: "ContextMenu", code: "ContextMenu", windowsVirtualKeyCode: 93, modifiers: 0 },
        { key: "F10", code: "F10", windowsVirtualKeyCode: 121, modifiers: 8 },
      ]) {
        await evaluate(client, sessionId, `document.querySelector('${selector}').focus()`);
        await client.command("Input.dispatchKeyEvent", { type: "keyDown", ...shortcut }, sessionId);
        await client.command("Input.dispatchKeyEvent", { type: "keyUp", ...shortcut }, sessionId);
        if (supported) {
          await waitForExpression(client, sessionId, `document.querySelector('.quick-classification-menu[role="menu"]')?.contains(document.activeElement)`);
          assert.equal(await evaluate(client, sessionId, `document.querySelector('${selector}')?.getAttribute('aria-expanded')`), "true");
          assert.deepEqual(await evaluate(client, sessionId, selectedKeys), before, "opening a keyboard menu must not change selection");
          assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('.destination-detail-dialog'))`), false);
          await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
          await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
          await waitForExpression(client, sessionId, `!document.querySelector('.quick-classification-menu[role="menu"]')
            && document.activeElement === document.querySelector('${selector}')`);
        } else {
          await waitForAnimationFrames(client, sessionId, 2);
          assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('.quick-classification-menu, .destination-detail-dialog'))`), false,
            "category shortcuts must not open object classification or details");
          assert.equal(await evaluate(client, sessionId, `document.activeElement === document.querySelector('${selector}')`), true);
        }
        assert.deepEqual(await evaluate(client, sessionId, selectedKeys), before);
      }
    }
  };

  await runTest("data trend range picker applies custom ranges and resets to last seven days", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-trend-range-trigger"))`);
    const stableScrollbarGeometry = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const root = document.querySelector("[data-data-content-state]");
        const scrollOwner = root?.querySelector(".data-page-scroll");
        const chart = root?.querySelector(".data-overview .data-trend-chart");
        const destination = root?.querySelector(".data-app-panel");
        const heatmap = root?.querySelector(".data-overview > .data-heatmap-panel");
        const header = root?.querySelector(":scope > .qp-page-header");
        if (!root || !scrollOwner || !header || !chart || !heatmap) return null;

        const originalDestinationDisplay = destination?.style.display;
        const originalHeatmapDisplay = heatmap.style.display;
        if (destination) destination.style.display = "none";
        heatmap.style.display = "none";
        const widthWithoutOverflow = chart.getBoundingClientRect().width;
        const fitsWithoutOverflow = scrollOwner.scrollHeight <= scrollOwner.clientHeight;
        const headerTopBeforeScroll = header.getBoundingClientRect().top;

        const spacer = document.createElement("div");
        spacer.style.height = (scrollOwner.clientHeight + 1) + "px";
        spacer.setAttribute("aria-hidden", "true");
        scrollOwner.appendChild(spacer);
        const widthWithOverflow = chart.getBoundingClientRect().width;
        const overflowsWithContent = scrollOwner.scrollHeight > scrollOwner.clientHeight;
        scrollOwner.scrollTop = scrollOwner.scrollHeight;
        const contentScrolled = scrollOwner.scrollTop > 0;
        const headerTopAfterScroll = header.getBoundingClientRect().top;
        scrollOwner.scrollTop = 0;
        spacer.remove();

        if (destination) destination.style.display = originalDestinationDisplay ?? "";
        heatmap.style.display = originalHeatmapDisplay;

        return JSON.stringify({
          fitsWithoutOverflow,
          gutter: getComputedStyle(scrollOwner).scrollbarGutter,
          contentScrolled,
          headerTopDelta: headerTopAfterScroll - headerTopBeforeScroll,
          headerOutsideScrollOwner: header.parentElement === root
            && !scrollOwner.contains(header),
          overflowsWithContent,
          widthWithOverflow,
          widthWithoutOverflow,
        });
      })()
    `))) as {
      fitsWithoutOverflow: boolean;
      gutter: string;
      contentScrolled: boolean;
      headerTopDelta: number;
      headerOutsideScrollOwner: boolean;
      overflowsWithContent: boolean;
      widthWithOverflow: number;
      widthWithoutOverflow: number;
    } | null;
    assert.ok(stableScrollbarGeometry, "data page should expose its scroll owner and trend chart");
    assert.equal(stableScrollbarGeometry.gutter, "stable");
    assert.equal(stableScrollbarGeometry.contentScrolled, true);
    assert.ok(Math.abs(stableScrollbarGeometry.headerTopDelta) <= 0.5);
    assert.equal(stableScrollbarGeometry.headerOutsideScrollOwner, true);
    assert.equal(stableScrollbarGeometry.fitsWithoutOverflow, true);
    assert.equal(stableScrollbarGeometry.overflowsWithContent, true);
    assert.ok(
      Math.abs(
        stableScrollbarGeometry.widthWithOverflow
        - stableScrollbarGeometry.widthWithoutOverflow,
      ) <= 0.5,
      `trend width should remain stable when the data page starts overflowing: ${JSON.stringify(stableScrollbarGeometry)}`,
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const trend = document.querySelector(".data-trend-range-trigger");
          const heatmapGroup = document.querySelector(".data-heatmap-range-control");
          const heatmapLabel = heatmapGroup?.querySelector(".qp-range-control-label");
          return {
            trendTag: trend?.tagName ?? null,
            trendHasPopup: trend?.getAttribute("aria-haspopup") ?? null,
            heatmapRole: heatmapGroup?.getAttribute("role") ?? null,
            heatmapLabelTag: heatmapLabel?.tagName ?? null,
            heatmapLabelDisabled: heatmapLabel?.hasAttribute("disabled") ?? null,
          };
        })()
      `),
      {
        trendTag: "BUTTON",
        trendHasPopup: "dialog",
        heatmapRole: "group",
        heatmapLabelTag: "SPAN",
        heatmapLabelDisabled: false,
      },
      "range controls should expose a named group and reserve button semantics for interactive labels",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".data-trend-range-trigger");
          if (!trigger || trigger.textContent?.trim() !== "近 7 天") return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".qp-range-picker"))`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.matches('.qp-range-picker-header strong')`,
      undefined,
      "range picker should focus its heading",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const picker = document.querySelector(".qp-range-picker");
          const header = picker?.querySelector(".qp-calendar-header");
          const navigation = picker?.querySelector(".qp-calendar-nav");
          const weekdays = picker?.querySelector(".qp-calendar-weekdays");
          const days = picker?.querySelector(".qp-calendar-days");
          const day = picker?.querySelector(".qp-calendar-day");
          if (!picker || !header || !navigation || !weekdays || !days || !day) return false;
          const pickerRect = picker.getBoundingClientRect();
          const navigationRect = navigation.getBoundingClientRect();
          const dayRect = day.getBoundingClientRect();
          return Boolean(
            Math.abs(pickerRect.width - 236) <= 0.5
            && Math.abs(navigationRect.width - 28) <= 0.5
            && Math.abs(navigationRect.height - 28) <= 0.5
            && Math.abs(dayRect.height - 26) <= 0.5
            && getComputedStyle(navigation).borderRadius === "10px"
            && getComputedStyle(day).borderRadius === "8px"
            && getComputedStyle(header).marginTop === "10px"
            && getComputedStyle(header).marginBottom === "0px"
            && getComputedStyle(weekdays).marginTop === "10px"
            && getComputedStyle(days).marginTop === "5px"
          );
        })()
      `),
      true,
      "range calendar should preserve its pre-consolidation geometry",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const key = (delta) => {
            const date = new Date();
            date.setDate(date.getDate() + delta);
            return [
              date.getFullYear(),
              String(date.getMonth() + 1).padStart(2, "0"),
              String(date.getDate()).padStart(2, "0"),
            ].join("-");
          };
          const start = document.querySelector('[data-range-picker-date="' + key(0) + '"]');
          if (!start) return false;
          start.click();
          return true;
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
          ].join("-");
          const end = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!end) return false;
          end.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "1天"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const apply = Array.from(document.querySelectorAll(".qp-range-picker-footer button"))
            .find((node) => node.textContent?.trim() === "确定");
          if (!apply) return false;
          apply.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector(".data-trend-range-trigger")?.textContent?.trim() === "1天"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const reset = document.querySelector(".data-trend-range-reset");
          if (!(reset instanceof HTMLButtonElement)
            || reset.getAttribute("aria-label") !== "恢复近 7 天") return false;
          reset.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector(".data-trend-range-trigger")?.textContent?.trim() === "近 7 天"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".data-trend-range-trigger");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".qp-range-picker"))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const next = document.querySelector('[aria-label="下一个范围模式"]');
          if (!next) return false;
          next.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "周"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
          const day = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!day) return false;
          day.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `/^第 \\d+ 周$/.test(document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() ?? "")`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const next = document.querySelector('[aria-label="下一个范围模式"]');
          if (!next) return false;
          next.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "月"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
          const day = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!day) return false;
          day.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `/^\\d+月$/.test(document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() ?? "")`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const next = document.querySelector('[aria-label="下一个范围模式"]');
          if (!next) return false;
          next.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "年"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
          const day = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!day) return false;
          day.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `/^\\d{4}年$/.test(document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() ?? "")`);
    await evaluate(client!, sessionId, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));`);
    await waitForExpression(client!, sessionId, `!document.querySelector(".qp-range-picker")`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.classList.contains('data-trend-range-trigger')`,
      undefined,
      "range picker trigger focus restoration",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".data-trend-range-trigger");
          if (!(trigger instanceof HTMLButtonElement)) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="下一个范围模式"]'))`,
    );
    await evaluate(
      client!,
      sessionId,
      `document.querySelector('[aria-label="下一个范围模式"]')?.click()`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "周"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
          ].join("-");
          const day = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!(day instanceof HTMLButtonElement)) return false;
          day.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `/^第 \\d+ 周$/.test(document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() ?? "")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const apply = Array.from(document.querySelectorAll(".qp-range-picker-footer button"))
            .find((node) => node.textContent?.trim() === "确定");
          if (!(apply instanceof HTMLButtonElement) || apply.disabled) return false;
          apply.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `/^第 \\d+ 周$/.test(document.querySelector(".data-trend-range-trigger")?.textContent?.trim() ?? "")
        && Boolean(document.querySelector(".data-trend-range-reset"))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const control = document.querySelector(".data-trend-period-control");
          const previous = control?.querySelector('[aria-label="切到更早范围"]');
          const next = control?.querySelector('[aria-label="切到较新范围"]');
          if (!(previous instanceof HTMLButtonElement)
            || !(next instanceof HTMLButtonElement)
            || !next.disabled) return false;
          previous.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        const next = document.querySelector('.data-trend-period-control [aria-label="切到较新范围"]');
        return next instanceof HTMLButtonElement && !next.disabled;
      })()`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const reset = document.querySelector(".data-trend-range-reset");
          if (!(reset instanceof HTMLButtonElement)) return false;
          reset.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-trend-range-trigger")?.textContent?.trim() === "近 7 天"
        && !document.querySelector(".data-trend-range-reset")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelectorAll(".data-trend-range-trigger")[1];
          if (!trigger || trigger.textContent?.trim() !== "近 7 天") return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".qp-range-picker"))`);
    for (let clickIndex = 0; clickIndex < 2; clickIndex += 1) {
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const date = new Date();
            const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
            const day = document.querySelector('[data-range-picker-date="' + key + '"]');
            if (!day) return false;
            day.click();
            return true;
          })()
        `),
        true,
      );
    }
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "1天"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const apply = Array.from(document.querySelectorAll(".qp-range-picker-footer button"))
            .find((node) => node.textContent?.trim() === "确定");
          if (!apply) return false;
          apply.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelectorAll(".data-trend-range-trigger")[1]?.textContent?.trim() === "1天"`);
  });

  await runTest("monthly data trend axes show every month", async () => {
    const sevenDayPresentation = `JSON.stringify({
      ranges: Array.from(document.querySelectorAll('.data-trend-range-trigger')).map(node => node.textContent),
      metrics: Array.from(document.querySelectorAll('.data-trend-inline-metric, .data-app-metric')).map(node => node.textContent),
      selection: Array.from(document.querySelectorAll('.data-app-option[aria-pressed="true"]')).map(node => node.getAttribute('data-destination-key')),
      selectedIcons: Array.from(document.querySelectorAll('.data-app-selected-icon')).map(node => node.getAttribute('data-selection-key')),
      series: document.querySelectorAll('.data-app-chart .qp-native-trend-line').length
    })`;
    await evaluate(client!, sessionId, `
      document.querySelector(".data-app-panel .data-trend-range-reset")?.click()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `Array.from(document.querySelectorAll(".data-trend-range-trigger"))
        .every((trigger) => trigger.textContent?.trim() === "近 7 天")`,
    );

    for (const panelSelector of [".data-overview", ".data-app-panel"]) {
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const panel = document.querySelector(${jsonString(panelSelector)});
            const previous = panel?.querySelector(
              ".data-trend-range-control .qp-range-control-arrow:first-child",
            );
            if (!(previous instanceof HTMLButtonElement) || previous.disabled) return false;
            previous.click();
            return true;
          })()
        `),
        true,
      );
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector(${jsonString(panelSelector)})
          ?.querySelector(".data-trend-range-trigger")
          ?.textContent?.trim() === "总计"`,
      );
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const panel = document.querySelector(${jsonString(panelSelector)});
            const previous = panel?.querySelector(
              ".data-trend-range-control .qp-range-control-arrow:first-child",
            );
            const next = panel?.querySelector(
              ".data-trend-range-control .qp-range-control-arrow:last-child",
            );
            if (!(previous instanceof HTMLButtonElement) || !previous.disabled) return false;
            if (!(next instanceof HTMLButtonElement) || next.disabled) return false;
            next.click();
            return true;
          })()
        `),
        true,
      );
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector(${jsonString(panelSelector)})
          ?.querySelector(".data-trend-range-trigger")
          ?.textContent?.trim() === "近 7 天"`,
      );
    }

    await waitForExpression(client, sessionId, `document.querySelector('.data-trend-panel')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('.data-app-grid')?.getAttribute('aria-busy') === 'false'`);
    const before = await evaluate(client, sessionId, sevenDayPresentation);

    for (const panelSelector of [".data-overview", ".data-app-panel"]) {
      for (const expectedLabel of ["近 30 天", "近一年"]) {
        assert.equal(
          await evaluate(client!, sessionId, `
            (() => {
              const panel = document.querySelector(${jsonString(panelSelector)});
              const next = panel?.querySelector(
                ".data-trend-range-control .qp-range-control-arrow:last-child",
              );
              if (!(next instanceof HTMLButtonElement) || next.disabled) return false;
              next.click();
              return true;
            })()
          `),
          true,
        );
        await waitForExpression(
          client!,
          sessionId,
          `document.querySelector(${jsonString(panelSelector)})
            ?.querySelector(".data-trend-range-trigger")
            ?.textContent?.trim() === ${jsonString(expectedLabel)}`,
        );
      }
    }

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".data-overview .qp-native-trend-x-tick").length === 12
        && document.querySelectorAll(".data-app-panel .qp-native-trend-x-tick").length === 12`,
      45_000,
      "all twelve monthly trend ticks",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        [".data-overview", ".data-app-panel"].every((panelSelector) => {
          const labels = Array.from(document.querySelectorAll(
            panelSelector + " .qp-native-trend-x-tick text",
          )).map((node) => node.textContent?.trim() ?? "");
          return labels.length === 12
            && new Set(labels).size === 12
            && labels.every((label) => /^\\d{1,2}月$/.test(label));
        })
      `),
      true,
      "activity and destination trends should render all twelve month labels",
    );
    assert.equal(await evaluate(client, sessionId, `Boolean(document.querySelector('.data-trend-chart.data-chart-openable, .data-app-chart.data-chart-openable'))`), false,
      "monthly aggregates cannot navigate to an invented daily history date");

    for (const panelSelector of [".data-overview", ".data-app-panel"]) {
      for (const expectedLabel of ["近 30 天", "近 7 天"]) {
        assert.equal(
          await evaluate(client!, sessionId, `
            (() => {
              const panel = document.querySelector(${jsonString(panelSelector)});
              const previous = panel?.querySelector(
                ".data-trend-range-control .qp-range-control-arrow:first-child",
              );
              if (!(previous instanceof HTMLButtonElement) || previous.disabled) return false;
              previous.click();
              return true;
            })()
          `),
          true,
        );
        await waitForExpression(
          client!,
          sessionId,
          `document.querySelector(${jsonString(panelSelector)})
            ?.querySelector(".data-trend-range-trigger")
            ?.textContent?.trim() === ${jsonString(expectedLabel)}`,
        );
      }
    }
    await waitForExpression(client, sessionId, `document.querySelector('.data-trend-panel')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('.data-app-grid')?.getAttribute('aria-busy') === 'false'`);
    assert.equal(await evaluate(client, sessionId, sevenDayPresentation), before,
      "seven-day titles, metrics and selected objects must agree after the annual round trip");

    for (const selector of [".data-trend-chart", ".data-app-chart"]) {
      await evaluate(client, sessionId, `document.querySelector('${selector}').scrollIntoView({ block: 'center' })`);
      const point = await evaluate(client, sessionId, `(() => {
        const hits = document.querySelectorAll('${selector} .qp-native-trend-hit');
        const index = 2, hit = hits[index], rect = hit.getBoundingClientRect();
        const date = new Date(); date.setDate(date.getDate() - hits.length + 1 + index);
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, label: hit.getAttribute('aria-label'),
          dateKey: [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'),
          dateLabel: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) };
      })()`) as { x: number; y: number; label: string; dateKey: string; dateLabel: string };
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y }, sessionId);
      await waitForExpression(client, sessionId, `document.querySelector('${selector} .qp-chart-tooltip-label')?.textContent === ${jsonString(point.label)}`);
      for (const clickCount of [1, 2]) {
        await client.command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount, x: point.x, y: point.y }, sessionId);
        await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount, x: point.x, y: point.y }, sessionId);
      }
      await waitForExpression(client, sessionId, `document.querySelector('.history-date-label')?.textContent === ${jsonString(point.dateLabel)}`,
        undefined, `${selector} real double click opens its active date in History`);
      await evaluate(client, sessionId, `document.querySelector('.history-date-label').click()`);
      await waitForExpression(client, sessionId, `document.querySelector('.history-calendar-popover [data-selected="true"]')?.getAttribute('data-calendar-date') === ${jsonString(point.dateKey)}`);
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
      await waitForExpression(client, sessionId, `!document.querySelector('.history-calendar-popover')`);
      await evaluate(client, sessionId, `document.querySelector('[aria-label="数据"]').click()`);
      await waitForExpression(client, sessionId, `document.querySelector('.data-trend-panel')?.getAttribute('aria-busy') === 'false'
        && document.querySelector('.data-app-grid')?.getAttribute('aria-busy') === 'false'`);
      assert.equal(await evaluate(client, sessionId, sevenDayPresentation), before,
        "returning from chart navigation restores matching cached data, range titles and selection");
    }
  });

  await runTest("data web trends keep their geometry and content through slow refreshes", async () => {
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_INVOKED_COMMANDS = [];
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 800;
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = false;
        document.querySelector(".data-app-panel .data-trend-range-reset")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".data-trend-range-trigger")[1]?.textContent?.trim() === "近 7 天"`,
      45_000,
      "app trend range reset before web continuity test",
    );
    const initialPanelHeight = Number(await evaluate(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel")?.getBoundingClientRect().height ?? 0`,
    ));
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const group = document.querySelector('[aria-label="选择时间去向类型"]');
          const web = Array.from(group?.querySelectorAll("button") ?? [])
            .find((node) => node.textContent?.trim() === "网页");
          if (!web) return false;
          web.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Array.from(document.querySelectorAll('[aria-label="选择时间去向类型"] button'))
        .some((node) => node.textContent?.trim() === "网页" && node.getAttribute("aria-pressed") === "true")`,
    );
    const pendingSwitchState = JSON.parse(String(await evaluate(client!, sessionId, `
      JSON.stringify({
        title: document.querySelector(".data-app-panel h3")?.textContent?.trim() ?? "",
        hasAppList: Boolean(document.querySelector('[aria-label="应用列表"]')),
        hasWebInitialStatus: Boolean(document.querySelector(".data-web-initial-status")),
        hasBlockingLoadingCopy:
          document.querySelector(".data-app-panel")?.textContent?.includes("正在加载网页趋势") ?? false,
        panelHeight: document.querySelector(".data-app-panel")?.getBoundingClientRect().height ?? 0,
      })
    `))) as {
      title: string;
      hasAppList: boolean;
      hasWebInitialStatus: boolean;
      hasBlockingLoadingCopy: boolean;
      panelHeight: number;
    };
    assert.equal(pendingSwitchState.title, "应用趋势");
    assert.equal(pendingSwitchState.hasAppList, true);
    assert.equal(pendingSwitchState.hasWebInitialStatus, false);
    assert.equal(pendingSwitchState.hasBlockingLoadingCopy, false);
    assert.ok(
      Math.abs(pendingSwitchState.panelHeight - initialPanelHeight) <= 1,
      `pending web switch height ${pendingSwitchState.panelHeight} should match ready height ${initialPanelHeight}`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "网页趋势"
        && document.querySelector('[aria-label="网页列表"]')?.textContent?.includes("docs.example.com")`,
      45_000,
    );

    const loadedPanelHeight = Number(await evaluate(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel")?.getBoundingClientRect().height ?? 0`,
    ));
    const webCommandsBeforeRuntimeRefresh = Number(await evaluate(
      client!,
      sessionId,
      `globalThis.__PATINA_INVOKED_COMMANDS
        .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length`,
    ));
    await evaluate(client!, sessionId, `
      globalThis.__PATINA_EMIT_TAURI_EVENT?.("tracking-data-changed", {
        reason: "session-transition",
        changed_at_ms: Date.now(),
      })
    `);
    await waitForExpression(
      client!,
      sessionId,
      `globalThis.__PATINA_INVOKED_COMMANDS
        .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length
        > ${webCommandsBeforeRuntimeRefresh}`,
      45_000,
      "tracking refresh starts a new web request",
    );
    const runtimeRefreshFrames = JSON.parse(String(await evaluate(client!, sessionId, `
      new Promise((resolve) => {
        const samples = [];
        const sample = () => {
          const panel = document.querySelector(".data-app-panel");
          const grid = panel?.querySelector(".data-app-grid");
          samples.push({
            title: panel?.querySelector("h3")?.textContent?.trim() ?? "",
            contentVisible: Boolean(
              grid
              && panel?.querySelector('[aria-label="网页列表"]')
              && panel?.querySelectorAll(".data-app-metric").length === 4
              && panel?.querySelector(".data-app-chart")
              && !grid.classList.contains("invisible")
            ),
            panelHeight: panel?.getBoundingClientRect().height ?? 0,
          });
          if (samples.length >= 20) {
            resolve(JSON.stringify(samples));
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      })
    `))) as Array<{
      title: string;
      contentVisible: boolean;
      panelHeight: number;
    }>;
    assert.ok(runtimeRefreshFrames.every((sample) => sample.title === "网页趋势"));
    assert.ok(runtimeRefreshFrames.every((sample) => sample.contentVisible));
    assert.ok(runtimeRefreshFrames.every(
      (sample) => Math.abs(sample.panelHeight - loadedPanelHeight) <= 1,
    ));
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-grid")?.getAttribute("aria-busy") !== "true"`,
      45_000,
      "tracking refresh completes without hiding web content",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const next = document.querySelector(
            ".data-app-panel .data-trend-range-control .qp-range-control-arrow:last-child",
          );
          if (!(next instanceof HTMLButtonElement)) return false;
          next.click();
          return true;
        })()
      `),
      true,
    );
    const frameSamples = JSON.parse(String(await evaluate(client!, sessionId, `
      new Promise((resolve) => {
        const samples = [];
        const sample = () => {
          const panel = document.querySelector(".data-app-panel");
          const grid = panel?.querySelector(".data-app-grid");
          const list = panel?.querySelector('[aria-label="网页列表"]');
          const metrics = panel?.querySelectorAll(".data-app-metric");
          const chart = panel?.querySelector(".data-app-chart");
          samples.push({
            busy: grid?.getAttribute("aria-busy") === "true",
            contentVisible: Boolean(
              grid
              && list
              && metrics?.length === 4
              && chart
              && !grid.classList.contains("invisible")
              && chart.getBoundingClientRect().height > 0
            ),
            panelHeight: panel?.getBoundingClientRect().height ?? 0,
          });
          if (samples.length >= 15) {
            resolve(JSON.stringify(samples));
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      })
    `))) as Array<{
      busy: boolean;
      contentVisible: boolean;
      panelHeight: number;
    }>;
    assert.equal(frameSamples.length, 15);
    assert.equal(frameSamples.filter((sample) => !sample.contentVisible).length, 0);
    assert.ok(frameSamples.some((sample) => sample.busy));
    assert.ok(frameSamples.every(
      (sample) => Math.abs(sample.panelHeight - loadedPanelHeight) <= 1,
    ));
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".data-app-panel")?.textContent?.includes("更新中")`,
      ),
      false,
      "web trend refreshes should stay visually quiet",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-grid")?.getAttribute("aria-busy") !== "true"
        && !document.querySelector(".data-app-panel")?.textContent?.includes("更新中")`,
      45_000,
      "web trend refresh completion",
    );

    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 800;
        document.querySelector(
          ".data-app-panel .data-trend-range-control .qp-range-control-arrow:last-child",
        )?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".data-trend-range-trigger")[1]?.textContent?.trim() === "近一年"`,
      45_000,
      "slow web trend request starts for a different range",
    );
    await evaluate(client!, sessionId, `
      document.querySelector(
        ".data-app-panel .data-trend-range-control .qp-range-control-arrow:first-child",
      )?.click()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".data-trend-range-trigger")[1]?.textContent?.trim() === "近 30 天"`,
      45_000,
      "web trend returns to the cached range",
    );
    const raceFrameSamples = JSON.parse(String(await evaluate(client!, sessionId, `
      new Promise((resolve) => {
        const samples = [];
        const sample = () => {
          const grid = document.querySelector(".data-app-panel .data-app-grid");
          samples.push(Boolean(
            grid
            && document.querySelector('[aria-label="网页列表"]')
            && document.querySelectorAll(".data-app-panel .data-app-metric").length === 4
            && document.querySelector(".data-app-panel .data-app-chart")
          ));
          if (samples.length >= 15) {
            resolve(JSON.stringify(samples));
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      })
    `))) as boolean[];
    assert.deepEqual(raceFrameSamples, Array.from({ length: 15 }, () => true));
    await evaluate(client!, sessionId, `
      new Promise((resolve, reject) => {
        const startedAt = performance.now();
        let lastCount = -1;
        let stableSince = performance.now();
        const sample = () => {
          const count = globalThis.__PATINA_INVOKED_COMMANDS
            .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length;
          if (count !== lastCount) {
            lastCount = count;
            stableSince = performance.now();
          }
          if (performance.now() - stableSince >= 900) {
            resolve();
            return;
          }
          if (performance.now() - startedAt >= 12_000) {
            reject(new Error("web aggregate commands did not become quiescent"));
            return;
          }
          setTimeout(sample, 50);
        };
        sample();
      })
    `);
    assert.deepEqual(
      JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify({
          range: document.querySelectorAll(".data-trend-range-trigger")[1]?.textContent?.trim(),
          busy: document.querySelector(".data-app-panel .data-app-grid")?.getAttribute("aria-busy"),
          hasContent: Boolean(document.querySelector('[aria-label="网页列表"]')),
        })
      `))),
      {
        range: "近 30 天",
        busy: "false",
        hasContent: true,
      },
      "the late one-year request must not replace the restored 30-day result",
    );

    const webCommandCount = Number(await evaluate(
      client!,
      sessionId,
      `globalThis.__PATINA_INVOKED_COMMANDS
        .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length`,
    ));
    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "应用趋势"`,
    );
    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "网页")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "网页趋势"`,
    );
    assert.deepEqual(
      JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify({
          hasContent: Boolean(document.querySelector('[aria-label="网页列表"]')),
          hasInvisibleBody: Boolean(document.querySelector(".data-app-panel .invisible")),
          webCommandCount: globalThis.__PATINA_INVOKED_COMMANDS
            .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length,
        })
      `))),
      {
        hasContent: true,
        hasInvisibleBody: false,
        webCommandCount,
      },
    );
    await evaluate(
      client!,
      sessionId,
      `new Promise((resolve) => setTimeout(resolve, 320))`,
    );
    assert.deepEqual(
      JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify({
          busy: document.querySelector(".data-app-grid")?.getAttribute("aria-busy"),
          hasUpdatingStatus: document.querySelector(".data-app-panel")
            ?.textContent?.includes("更新中") ?? false,
          webCommandCount: globalThis.__PATINA_INVOKED_COMMANDS
            .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length,
        })
      `))),
      {
        busy: "false",
        hasUpdatingStatus: false,
        webCommandCount,
      },
      "a cache-speed refresh must finish before the delayed status becomes visible",
    );
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 0;
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = false;
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "应用趋势"`,
    );
  });

  await runTest("data category mode groups apps without exposing object details", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const group = document.querySelector('[aria-label="选择时间去向类型"]');
          const labels = Array.from(group?.querySelectorAll("button") ?? [])
            .map((node) => node.textContent?.trim());
          if (JSON.stringify(labels) !== JSON.stringify(["应用", "分类", "网页"])) return false;
          const category = Array.from(group?.querySelectorAll("button") ?? [])
            .find((node) => node.textContent?.trim() === "分类");
          if (!(category instanceof HTMLButtonElement)) return false;
          category.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "分类趋势"
        && document.querySelectorAll('[aria-label="应用分类列表"] button').length === 2`,
      45_000,
      "category trend presentation",
    );
    const initialState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const panel = document.querySelector(".data-app-panel");
        const list = document.querySelector('[aria-label="应用分类列表"]');
        const selected = panel?.querySelector(".data-app-selected-status");
        const selectedMarker = selected?.querySelector(".data-category-selected-icon");
        const mode = document.querySelector('[aria-label="选择时间去向类型"]');
        return JSON.stringify({
          modePressed: mode?.querySelector('[aria-pressed="true"]')?.textContent?.trim() ?? null,
          categories: Array.from(list?.querySelectorAll("button") ?? [])
            .map((node) => node.textContent?.replace(/\\s+/g, " ").trim()),
          detailTriggers: list?.querySelectorAll("[data-destination-detail-trigger]").length ?? -1,
          detailButtons: selected?.querySelectorAll("button").length ?? -1,
          selectedMarkers: selected?.querySelectorAll(".data-category-selected-icon").length ?? 0,
          selectedMarkerBorder: selectedMarker ? getComputedStyle(selectedMarker).borderTopWidth : null,
          selectedMarkerBackground: selectedMarker ? getComputedStyle(selectedMarker).backgroundColor : null,
          heatmapTitle: panel?.querySelector(".data-heatmap-panel-compact h3")?.textContent?.trim() ?? null,
          hasTooltipTitle: Boolean(panel?.querySelector('[title]')),
        });
      })()
    `))) as {
      modePressed: string | null;
      categories: string[];
      detailTriggers: number;
      detailButtons: number;
      selectedMarkers: number;
      selectedMarkerBorder: string | null;
      selectedMarkerBackground: string | null;
      heatmapTitle: string | null;
      hasTooltipTitle: boolean;
    };
    assert.equal(initialState.modePressed, "分类");
    assert.equal(initialState.categories.length, 2);
    assert.ok(initialState.categories.every((label) => label.includes("1 个应用")));
    assert.equal(initialState.detailTriggers, 0);
    assert.equal(initialState.detailButtons, 0);
    assert.equal(initialState.selectedMarkers, 1);
    assert.equal(initialState.selectedMarkerBorder, "0px");
    assert.equal(initialState.selectedMarkerBackground, "rgba(0, 0, 0, 0)");
    assert.equal(initialState.heatmapTitle, "分类热力图");
    assert.equal(initialState.hasTooltipTitle, false);
    await assertQuickClassificationKeyboard('[aria-label="应用分类列表"]', false);

    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const buttons = document.querySelectorAll('[aria-label="应用分类列表"] button');
        const second = buttons[1];
        if (!(second instanceof HTMLButtonElement)) return false;
        second.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用分类列表"] button[aria-pressed="true"]').length === 2
        && document.querySelectorAll(".data-category-selected-icon").length === 2`,
    );

    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const marker = document.querySelector('[aria-label="应用分类列表"] [data-category-marker]');
        if (!(marker instanceof HTMLElement)) return false;
        marker.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
        return true;
      })()
    `), true);
    await delay(80);
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector(".destination-detail-dialog"))`),
      false,
    );

    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const input = document.querySelector('input[aria-label="搜索分类"]');
        if (!(input instanceof HTMLInputElement)) return false;
        const firstName = document.querySelector(
          '[aria-label="应用分类列表"] .data-app-option-name',
        )?.textContent?.trim();
        if (!firstName) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, firstName);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用分类列表"] button').length === 1`,
    );

    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "应用趋势"`,
    );
  });

  await runTest("data reuses the destination panel for web trends and its compact annual heatmap", async () => {
    await evaluate(client!, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS = []`);
    assert.equal(
      await evaluate(client!, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.some((entry) => entry.command === "cmd_get_web_activity_aggregate_range")`),
      false,
      "the default app view must not issue a web aggregate query",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const group = document.querySelector('[aria-label="选择时间去向类型"]');
          const web = Array.from(group?.querySelectorAll("button") ?? [])
            .find((node) => node.textContent?.trim() === "网页");
          if (!web) return false;
          web.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "网页趋势"`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label="网页列表"]')?.textContent?.includes("docs.example.com")`,
    );
    const webState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const grid = document.querySelector(".data-dashboard-grid");
        const directPanels = grid ? Array.from(grid.children) : [];
        const mode = document.querySelector('[aria-label="选择时间去向类型"]');
        const list = document.querySelector('[aria-label="网页列表"]');
        const heading = document.querySelector(".data-app-panel-heading");
        const headerActions = document.querySelector(".data-app-header-actions");
        return JSON.stringify({
          directChildren: directPanels.length,
          headingOrder: Array.from(heading?.children ?? []).map((node) => (
            node.tagName === "H3"
              ? "title"
              : node.classList.contains("data-destination-mode")
                ? "mode"
                : node.classList.contains("data-app-selected-status")
                  ? "selected"
                  : node.classList.contains("data-app-refresh-status")
                    ? "status"
                    : "unknown"
          )),
          headerOrder: Array.from(headerActions?.children ?? []).map((node) => (
            node.classList.contains("data-trend-period-control") ? "range" : "unknown"
          )),
          modePressed: mode?.querySelector('[aria-pressed="true"]')?.textContent?.trim() ?? null,
          domains: Array.from(list?.querySelectorAll("button") ?? []).map((node) => node.textContent?.trim()),
          hasHeatmapScope: Boolean(document.querySelector('[aria-label="选择热力图对象"]')),
          destinationHeatmapTitle: document.querySelector(".data-heatmap-panel-compact h3")
            ?.textContent?.trim() ?? null,
          destinationHeatmapHasSubtitle: Boolean(
            document.querySelector(".data-heatmap-panel-compact p"),
          ),
          destinationHeatmapCells: document.querySelectorAll(
            ".data-heatmap-panel-compact .data-heatmap-cell",
          ).length,
          destinationHeatmapTooltips: document.querySelectorAll(
            ".data-heatmap-panel-compact .data-heatmap-cell[data-heatmap-tooltip]",
          ).length,
          destinationHeatmapNotRecordedTooltips: Array.from(document.querySelectorAll(
            ".data-heatmap-panel-compact .data-heatmap-cell[data-heatmap-tooltip]",
          )).filter((cell) => cell.getAttribute("data-heatmap-tooltip")?.includes("未记录")).length,
          destinationHeatmapZeroTooltips: Array.from(document.querySelectorAll(
            ".data-heatmap-panel-compact .data-heatmap-cell[data-heatmap-tooltip]",
          )).filter((cell) => cell.getAttribute("data-heatmap-tooltip")?.endsWith("0s")).length,
        });
      })()
    `))) as {
      directChildren: number;
      headingOrder: string[];
      headerOrder: string[];
      modePressed: string | null;
      domains: string[];
      hasHeatmapScope: boolean;
      destinationHeatmapTitle: string | null;
      destinationHeatmapHasSubtitle: boolean;
      destinationHeatmapCells: number;
      destinationHeatmapTooltips: number;
      destinationHeatmapNotRecordedTooltips: number;
      destinationHeatmapZeroTooltips: number;
    };
    assert.equal(webState.directChildren, 2);
    assert.deepEqual(webState.headingOrder, ["title", "mode", "selected"]);
    assert.deepEqual(webState.headerOrder, ["range"]);
    assert.equal(webState.modePressed, "网页");
    assert.equal(webState.domains.length, 2);
    assert.equal(webState.hasHeatmapScope, false);
    assert.equal(webState.destinationHeatmapTitle, "网页热力图");
    assert.equal(webState.destinationHeatmapHasSubtitle, false);
    assert.ok(webState.destinationHeatmapCells > 0);
    assert.ok(webState.destinationHeatmapTooltips > 0);
    assert.equal(webState.destinationHeatmapNotRecordedTooltips, 0);
    assert.ok(webState.destinationHeatmapZeroTooltips > 0);

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const input = document.querySelector('input[aria-label="搜索网页"]');
          if (!(input instanceof HTMLInputElement)) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(input, "research");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="网页列表"] button').length === 1
        && document.querySelector('[aria-label="网页列表"]')?.textContent?.includes("research.example")`,
    );
    await evaluate(client!, sessionId, `
      (() => {
        const input = document.querySelector('input[aria-label="搜索网页"]');
        if (!(input instanceof HTMLInputElement)) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="网页列表"] button').length === 2`,
    );

    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        const app = Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用");
        app?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "应用趋势"`,
    );
  });

  await runTest("data destination selection follows Ctrl multi-select and keeps each mode in session", async () => {
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button').length >= 2`,
      45_000,
      "app comparison options",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const buttons = document.querySelectorAll('[aria-label="应用列表"] button');
        if (!(buttons[1] instanceof HTMLButtonElement)) return false;
        buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]').length === 2
        && document.querySelectorAll(".data-app-selected-icon").length === 2
        && document.querySelectorAll(".data-app-chart .qp-native-trend-line").length === 2
        && Array.from(document.querySelectorAll(
          '[aria-label="应用列表"] button[aria-pressed="true"]',
        )).every((button) => getComputedStyle(button, "::before").content === "none")
        && document.querySelector(".data-app-legend") === null
        && Array.from(document.querySelectorAll(
          ".data-heatmap-panel-compact [data-heatmap-tooltip]",
        )).every((cell) => !cell.getAttribute("data-heatmap-tooltip")?.includes("个对象"))`,
      45_000,
      "two selected app series",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const selectedKeys = Array.from(
          document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]'),
        ).map((button) => button.getAttribute("data-destination-key"));
        const iconKeys = Array.from(document.querySelectorAll(".data-app-selected-icon"))
          .map((icon) => icon.getAttribute("data-selection-key"));
        return JSON.stringify(iconKeys) === JSON.stringify(selectedKeys);
      })()
    `), true);

    await evaluate(client!, sessionId, `
      (() => {
        const input = document.querySelector('input[aria-label="搜索应用"]');
        const selected = document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]')[0];
        if (!(input instanceof HTMLInputElement) || !(selected instanceof HTMLButtonElement)) return;
        const name = selected.querySelector(".data-app-option-name")?.textContent ?? "";
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, name);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".data-app-selected-icon").length === 2
        && document.querySelectorAll(".data-app-chart .qp-native-trend-line").length === 2
        && document.querySelectorAll('[aria-label="应用列表"] button').length === 1`,
      45_000,
      "search keeps hidden app selection",
    );
    await evaluate(client!, sessionId, `
      (() => {
        const input = document.querySelector('input[aria-label="搜索应用"]');
        if (!(input instanceof HTMLInputElement)) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button').length >= 2`,
    );
    await evaluate(client!, sessionId, `
      document.querySelectorAll('[aria-label="应用列表"] button')[1]?.click()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]').length === 1
        && document.querySelectorAll(".data-app-selected-icon").length === 1
        && document.querySelectorAll(".data-app-chart .qp-native-trend-line").length === 1`,
      45_000,
      "plain click replaces app selection",
    );
    await evaluate(client!, sessionId, `
      document.querySelectorAll('[aria-label="应用列表"] button')[0]
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }))
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]').length === 2`,
    );

    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "网页")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="网页列表"] button').length >= 2`,
      45_000,
      "web comparison options",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(
        ".data-heatmap-panel-compact [data-heatmap-tooltip]",
      ).length > 0
        && !document.querySelector(".data-heatmap-panel-compact .data-heatmap-loading-state")`,
      45_000,
      "initial web heatmap presentation",
    );
    const initialWebHeatmapPresentation = String(await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll(
        ".data-heatmap-panel-compact [data-heatmap-tooltip]",
      )).map((cell) => cell.getAttribute("data-heatmap-tooltip")).join("|")
    `));
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 1_000;
        document.querySelectorAll('[aria-label="网页列表"] button')[1]
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
      })()
    `);
    const pendingWebHeatmapFrames = JSON.parse(String(await evaluate(client!, sessionId, `
      new Promise((resolve) => {
        const samples = [];
        const sample = () => {
          const tooltipCells = Array.from(document.querySelectorAll(
            ".data-heatmap-panel-compact [data-heatmap-tooltip]",
          ));
          samples.push({
            loading: Boolean(document.querySelector(
              ".data-heatmap-panel-compact .data-heatmap-loading-state",
            )),
            presentation: tooltipCells
              .map((cell) => cell.getAttribute("data-heatmap-tooltip"))
              .join("|"),
          });
          if (samples.length >= 20) {
            resolve(JSON.stringify(samples));
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      })
    `))) as Array<{ loading: boolean; presentation: string }>;
    assert.ok(pendingWebHeatmapFrames.some((sample) => sample.loading));
    assert.ok(pendingWebHeatmapFrames.every(
      (sample) => sample.presentation !== initialWebHeatmapPresentation,
    ));
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="网页列表"] button[aria-pressed="true"]').length === 2
        && document.querySelectorAll(".data-app-selected-icon").length === 2
        && document.querySelectorAll(".data-app-chart .qp-native-trend-line").length === 2`,
      45_000,
      "two selected web series",
    );
    await evaluate(
      client!,
      sessionId,
      `new Promise((resolve) => setTimeout(resolve, 1_050))
        .then(() => { globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 0; })`,
    );

    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]').length === 2`,
      45_000,
      "app selection survives mode change",
    );
    await evaluate(client!, sessionId, `
      document.querySelector(
        ".data-app-panel .data-trend-range-control .qp-range-control-arrow:last-child",
      )?.click()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".data-app-selected-icon").length === 2
        && document.querySelectorAll(".data-app-chart .qp-native-trend-line").length === 2
        && document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]').length === 2`,
      45_000,
      "app selection survives range change",
    );
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="设置"]')?.click()`);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".settings-button-preview"))`, 45_000);
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="数据"]')?.click()`);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button[aria-pressed="true"]').length === 2
        && document.querySelectorAll(".data-app-selected-icon").length === 2
        && document.querySelectorAll(".data-app-chart .qp-native-trend-line").length === 2`,
      45_000,
      "app selection survives Data page navigation",
    );
  });

  await runTest("data app icons reuse quick classification without changing selection", async () => {
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="数据"]')?.click()`);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="应用列表"] button[aria-haspopup="menu"]'))`,
      45_000,
      "data quick classification target",
    );
    const metricsBefore = await evaluate(client, sessionId, `Array.from(document.querySelectorAll('.data-app-metric, .data-app-panel .data-trend-range-trigger')).map(node => node.textContent)`);
    const openingState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const list = document.querySelector('[aria-label="应用列表"]');
        const target = list?.querySelector('button[aria-haspopup="menu"]');
        const trigger = target?.querySelector('[data-destination-detail-trigger]');
        if (
          !(list instanceof HTMLElement)
          || !(target instanceof HTMLButtonElement)
          || !(trigger instanceof HTMLElement)
        ) return null;
        list.scrollTop = Math.min(24, Math.max(0, list.scrollHeight - list.clientHeight));
        target.focus();
        const selectedKeys = Array.from(
          list.querySelectorAll('button[aria-pressed="true"]'),
        ).map((button) => button.getAttribute("data-destination-key"));
        const rect = trigger.getBoundingClientRect();
        trigger.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
        return JSON.stringify({
          selectedKeys,
          scrollTop: list.scrollTop,
          targetKey: target.getAttribute("data-destination-key"),
          hasNativeTitle: target.hasAttribute("title") || trigger.hasAttribute("title"),
          unclassified: Boolean(target.querySelector('.qp-badge')),
        });
      })()
    `))) as {
      selectedKeys: Array<string | null>;
      scrollTop: number;
      targetKey: string | null;
      hasNativeTitle: boolean;
      unclassified: boolean;
    };
    assert.ok(openingState);
    assert.ok(openingState.targetKey);
    assert.equal(openingState.hasNativeTitle, false);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const list = document.querySelector('[aria-label="应用列表"]');
          return {
            labels: Array.from(document.querySelectorAll(
              '.quick-classification-menu[role="menu"] > .quick-classification-menu-item',
            )).map((item) => item.textContent?.trim()),
            selectedKeys: Array.from(
              list?.querySelectorAll('button[aria-pressed="true"]') ?? [],
            ).map((button) => button.getAttribute("data-destination-key")),
            scrollTop: list instanceof HTMLElement ? list.scrollTop : -1,
            detailOpen: Boolean(document.querySelector('.destination-detail-dialog')),
            categoryOpen: Boolean(document.querySelector('.quick-classification-category-menu')),
          };
        })()
      `),
      {
        labels: ["更改名称", openingState.unclassified ? "设置分类" : "更改分类"],
        selectedKeys: openingState.selectedKeys,
        scrollTop: openingState.scrollTop,
        detailOpen: false,
        categoryOpen: false,
      },
      "right-clicking a Data icon must not select it, scroll the list, or open details",
    );
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll(
        '.quick-classification-menu[role="menu"] > .quick-classification-menu-item',
      )).find((item) => item.textContent?.includes("分类"))?.click()
    `);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-category-menu'))`);
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll(
        '.quick-classification-category-menu [role="menuitemradio"]',
      )).find((item) => item.textContent?.includes("未分类"))?.click()
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.quick-classification-menu[role="menu"]')`);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('.data-app-option-name-row .qp-badge'))`,
    );
    const dataBadgeMetrics = JSON.parse(String(await evaluate(client!, sessionId, `
        (() => {
          const badge = document.querySelector('.data-app-option-name-row .qp-badge');
          const name = badge?.closest('.data-app-option-name-row')
            ?.querySelector('.data-app-option-name');
          if (!(badge instanceof HTMLElement) || !(name instanceof HTMLElement)) return null;
          const badgeRect = badge.getBoundingClientRect();
          const nameRect = name.getBoundingClientRect();
          const style = getComputedStyle(badge);
          return JSON.stringify({
            regular: badge.classList.contains('qp-badge-regular'),
            neutral: badge.classList.contains('qp-badge-neutral'),
            badgeHeight: badgeRect.height,
            nameHeight: nameRect.height,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
          });
        })()
      `))) as {
      regular: boolean;
      neutral: boolean;
      badgeHeight: number;
      nameHeight: number;
      fontSize: string;
      fontWeight: string;
    };
    assert.ok(dataBadgeMetrics);
    assert.equal(dataBadgeMetrics.regular, true);
    assert.equal(dataBadgeMetrics.neutral, true);
    assert.ok(
      Math.abs(dataBadgeMetrics.badgeHeight - dataBadgeMetrics.nameHeight) <= 2,
      `Data should use the compact name-line badge density: ${JSON.stringify(dataBadgeMetrics)}`,
    );
    assert.equal(dataBadgeMetrics.fontSize, "11px");
    assert.equal(dataBadgeMetrics.fontWeight, "500");
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.getAttribute("data-destination-key") === ${jsonString(openingState.targetKey)}`,
    );
    const selectedKeysBeforeTopIconMenu = await evaluate(client!, sessionId, `
      JSON.stringify(Array.from(document.querySelectorAll(
        '[aria-label="应用列表"] button[aria-pressed="true"]',
      )).map((button) => button.getAttribute("data-destination-key")))
    `) as string;
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('.data-app-selected-icon[aria-haspopup="menu"]');
          if (!(trigger instanceof HTMLButtonElement)) return false;
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
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        ({
          selectedKeys: JSON.stringify(Array.from(document.querySelectorAll(
            '[aria-label="应用列表"] button[aria-pressed="true"]',
          )).map((button) => button.getAttribute("data-destination-key"))),
          detailOpen: Boolean(document.querySelector('.destination-detail-dialog')),
        })
      `),
      { selectedKeys: selectedKeysBeforeTopIconMenu, detailOpen: false },
      "the selected-app icon must reuse the menu without changing selection or opening details",
    );
    await evaluate(client!, sessionId, `
      document.querySelector('.quick-classification-menu[role="menu"]')?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      )
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.quick-classification-menu[role="menu"]')`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.matches('.data-app-selected-icon[aria-haspopup="menu"]')`,
    );
    await assertQuickClassificationKeyboard('[aria-label="应用列表"]');
    assert.deepEqual(await evaluate(client, sessionId, `Array.from(document.querySelectorAll('.data-app-option[aria-pressed="true"]')).map(node => node.getAttribute('data-destination-key'))`), openingState.selectedKeys);
    assert.deepEqual(await evaluate(client, sessionId, `Array.from(document.querySelectorAll('.data-app-metric, .data-app-panel .data-trend-range-trigger')).map(node => node.textContent)`), metricsBefore,
      "app classification changes must preserve the selected objects' metrics and range title");
  });

  await runTest("data web icons reuse quick classification without changing selection", async () => {
    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "网页")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="网页列表"] button[aria-haspopup="menu"]'))`,
      45_000,
      "data web quick classification target",
    );
    const metricsBefore = await evaluate(client, sessionId, `Array.from(document.querySelectorAll('.data-app-metric, .data-app-panel .data-trend-range-trigger')).map(node => node.textContent)`);
    const openingState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const list = document.querySelector('[aria-label="网页列表"]');
        const target = list?.querySelector('button[aria-haspopup="menu"]');
        const trigger = target?.querySelector('[data-destination-detail-trigger]');
        if (
          !(list instanceof HTMLElement)
          || !(target instanceof HTMLButtonElement)
          || !(trigger instanceof HTMLElement)
        ) return null;
        list.scrollTop = Math.min(24, Math.max(0, list.scrollHeight - list.clientHeight));
        const selectedKeys = Array.from(
          list.querySelectorAll('button[aria-pressed="true"]'),
        ).map((button) => button.getAttribute("data-destination-key"));
        const rect = trigger.getBoundingClientRect();
        trigger.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
        return JSON.stringify({
          selectedKeys,
          scrollTop: list.scrollTop,
          targetKey: target.getAttribute("data-destination-key"),
          hasNativeTitle: target.hasAttribute("title") || trigger.hasAttribute("title"),
          unclassified: Boolean(target.querySelector('.qp-badge')),
        });
      })()
    `))) as {
      selectedKeys: Array<string | null>;
      scrollTop: number;
      targetKey: string | null;
      hasNativeTitle: boolean;
      unclassified: boolean;
    };
    assert.ok(openingState?.targetKey);
    assert.equal(openingState.hasNativeTitle, false);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const list = document.querySelector('[aria-label="网页列表"]');
          return {
            labels: Array.from(document.querySelectorAll(
              '.quick-classification-menu[role="menu"] > .quick-classification-menu-item',
            )).map((item) => item.textContent?.trim()),
            selectedKeys: Array.from(
              list?.querySelectorAll('button[aria-pressed="true"]') ?? [],
            ).map((button) => button.getAttribute("data-destination-key")),
            scrollTop: list instanceof HTMLElement ? list.scrollTop : -1,
            detailOpen: Boolean(document.querySelector('.destination-detail-dialog')),
            categoryOpen: Boolean(document.querySelector('.quick-classification-category-menu')),
          };
        })()
      `),
      {
        labels: ["更改名称", openingState.unclassified ? "设置分类" : "更改分类"],
        selectedKeys: openingState.selectedKeys,
        scrollTop: openingState.scrollTop,
        detailOpen: false,
        categoryOpen: false,
      },
      "right-clicking a Data web icon must not select it, scroll the list, or open details",
    );
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll(
        '.quick-classification-menu[role="menu"] > .quick-classification-menu-item',
      )).find((item) => item.textContent?.includes("分类"))?.click()
    `);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-category-menu'))`);
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll(
        '.quick-classification-category-menu [role="menuitemradio"]',
      )).find((item) => item.textContent?.includes("开发"))?.click()
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.quick-classification-menu[role="menu"]')`);
    await waitForExpression(
      client!,
      sessionId,
      `!Array.from(document.querySelectorAll('[aria-label="网页列表"] button'))
        .find((button) => button.getAttribute("data-destination-key") === ${jsonString(openingState.targetKey)})
        ?.querySelector('.qp-badge')`,
    );
    const savedMutation = JSON.parse(String(await evaluate(client!, sessionId, `
      JSON.stringify((globalThis.__TIME_TRACKER_CLASSIFICATION_MUTATIONS ?? [])
        .filter((mutation) => mutation.key === "__web_domain_override::" + ${jsonString(openingState.targetKey)})
        .at(-1) ?? null)
    `))) as { key: string; value: string | null } | null;
    assert.ok(savedMutation);
    assert.equal(savedMutation.key, `__web_domain_override::${openingState.targetKey}`);
    assert.equal(JSON.parse(savedMutation.value ?? "null")?.category, "development");

    const selectedKeysBeforeTopIconMenu = await evaluate(client!, sessionId, `
      JSON.stringify(Array.from(document.querySelectorAll(
        '[aria-label="网页列表"] button[aria-pressed="true"]',
      )).map((button) => button.getAttribute("data-destination-key")))
    `) as string;
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('.data-app-selected-icon[aria-haspopup="menu"]');
          if (!(trigger instanceof HTMLButtonElement)) return false;
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
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.quick-classification-menu[role="menu"]'))`);
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        ({
          selectedKeys: JSON.stringify(Array.from(document.querySelectorAll(
            '[aria-label="网页列表"] button[aria-pressed="true"]',
          )).map((button) => button.getAttribute("data-destination-key"))),
          detailOpen: Boolean(document.querySelector('.destination-detail-dialog')),
        })
      `),
      { selectedKeys: selectedKeysBeforeTopIconMenu, detailOpen: false },
      "the selected-web icon must reuse the menu without changing selection or opening details",
    );
    await evaluate(client!, sessionId, `(() => {
      const request = window.requestAnimationFrame;
      const cancel = window.cancelAnimationFrame;
      const frames = new Map();
      let next = 0;
      window.requestAnimationFrame = (callback) => { const id = --next; frames.set(id, callback); return id; };
      window.cancelAnimationFrame = (id) => { if (id < 0) frames.delete(id); else cancel.call(window, id); };
      globalThis.__PATINA_RELEASE_CLASSIFICATION_CLOSE_FRAMES = () => {
        window.requestAnimationFrame = request;
        window.cancelAnimationFrame = cancel;
        delete globalThis.__PATINA_RELEASE_CLASSIFICATION_CLOSE_FRAMES;
        const count = frames.size;
        for (const callback of frames.values()) callback(performance.now());
        return count;
      };
    })()`);
    try {
      await evaluate(client!, sessionId, `
        document.querySelector('.quick-classification-menu[role="menu"]')?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        )
      `);
      await waitForExpression(client!, sessionId, `!document.querySelector('.quick-classification-menu[role="menu"]')`);
      const focusAfterOldClose = await evaluate(client!, sessionId, `(() => {
        const list = document.querySelector('[aria-label="网页列表"] button[aria-haspopup="menu"]');
        const top = document.querySelector('.data-app-selected-icon[aria-haspopup="menu"]');
        list.focus();
        const queuedFrames = globalThis.__PATINA_RELEASE_CLASSIFICATION_CLOSE_FRAMES();
        return { listConnected: list.isConnected, focusStayedOnList: document.activeElement === list,
          focusMovedToTop: document.activeElement === top, activeClass: document.activeElement?.className,
          listKey: list.dataset.destinationKey, topKey: top.dataset.destinationKey, queuedFrames };
      })()`) as { listConnected: boolean; focusStayedOnList: boolean };
      assert.equal(focusAfterOldClose.listConnected, true);
      assert.equal(focusAfterOldClose.focusStayedOnList, true,
        `closing the previous menu must not steal focus from the next keyboard target: ${JSON.stringify(focusAfterOldClose)}`);
    } finally {
      await evaluate(client!, sessionId, `globalThis.__PATINA_RELEASE_CLASSIFICATION_CLOSE_FRAMES?.()`);
    }

    await assertQuickClassificationKeyboard('[aria-label="网页列表"]');
    assert.deepEqual(await evaluate(client, sessionId, `Array.from(document.querySelectorAll('.data-app-option[aria-pressed="true"]')).map(node => node.getAttribute('data-destination-key'))`), openingState.selectedKeys);
    assert.deepEqual(await evaluate(client, sessionId, `Array.from(document.querySelectorAll('.data-app-metric, .data-app-panel .data-trend-range-trigger')).map(node => node.textContent)`), metricsBefore,
      "web classification changes must preserve the selected objects' metrics and range title");
    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="应用列表"]'))`,
      45_000,
      "restore Data app mode after web quick classification",
    );
  });

  await runTest("data destination details select a double-clicked target and focus on day analysis", async () => {
    await evaluate(
      client!,
      sessionId,
      `localStorage.removeItem("patina:destination-detail-timeline-zoom-hours:v1"); localStorage.removeItem("patina:data-destination-detail-timeline-zoom-hours:v1")`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="应用列表"] button').length >= 2`,
      45_000,
      "app detail candidates",
    );
    await evaluate(client!, sessionId, `
      (() => {
        const buttons = Array.from(document.querySelectorAll('[aria-label="应用列表"] button'));
        if (!buttons.length || buttons.some((button) => button.getAttribute("aria-pressed") !== "true")) {
          return;
        }
        buttons[buttons.length - 1]?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          ctrlKey: true,
        }));
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `Array.from(document.querySelectorAll('[aria-label="应用列表"] button'))
        .some((button) => button.getAttribute("aria-pressed") !== "true")`,
      45_000,
      "unselected app detail candidate",
    );
    const openingState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const list = document.querySelector('[aria-label="应用列表"]');
        const buttons = list?.querySelectorAll("button") ?? [];
        const target = Array.from(buttons).find(
          (button) => button.getAttribute("aria-pressed") !== "true",
        ) ?? buttons[1];
        if (!(list instanceof HTMLElement) || !(target instanceof HTMLButtonElement)) return null;
        list.scrollTop = 40;
        target.focus();
        const selectedKeys = Array.from(
          list.querySelectorAll('button[aria-pressed="true"]'),
        ).map((button) => button.getAttribute("data-destination-key"));
        const backgroundRange = document.querySelector(
          ".data-app-panel > .data-app-panel-header .data-trend-range-trigger",
        )?.textContent?.trim() ?? "";
        window.__dataDetailOpeningTrace = { sawFallback: false };
        window.__dataDetailOpeningObserver = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (!(node instanceof Element)) continue;
              if (
                node.matches(".destination-detail-shell-fallback")
                || node.querySelector(".destination-detail-shell-fallback")
              ) {
                window.__dataDetailOpeningTrace.sawFallback = true;
              }
            }
          }
        });
        window.__dataDetailOpeningObserver.observe(document.body, {
          childList: true,
          subtree: true,
        });
        const trigger = target.querySelector("[data-destination-detail-trigger]");
        if (!(trigger instanceof HTMLElement)) return null;
        const iconSource = target.querySelector("img")?.getAttribute("src") ?? "";
        const targetThemeColor = iconSource.includes("E34A3A")
          ? "#E34A3A"
          : iconSource.includes("257F62")
            ? "#257F62"
            : null;
        const detailTriggerCursor = getComputedStyle(trigger).cursor;
        trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 2 }));
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
        trigger.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
        return JSON.stringify({
          backgroundRange,
          listScrollTop: list.scrollTop,
          selectedKeys,
          targetKey: target.getAttribute("data-destination-key"),
          targetThemeColor,
          detailTriggerCursor,
        });
      })()
    `))) as {
      backgroundRange: string;
      listScrollTop: number;
      selectedKeys: Array<string | null>;
      targetKey: string | null;
      targetThemeColor: string | null;
      detailTriggerCursor: string;
    };
    assert.ok(openingState);
    assert.ok(openingState.targetKey);
    assert.ok(openingState.targetThemeColor);
    assert.ok(!openingState.selectedKeys.includes(openingState.targetKey));
    assert.equal(openingState.detailTriggerCursor, "pointer");
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-dialog"))`,
      45_000,
      "app detail dialog",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          window.__dataDetailOpeningObserver?.disconnect();
          const trace = window.__dataDetailOpeningTrace ?? null;
          delete window.__dataDetailOpeningObserver;
          delete window.__dataDetailOpeningTrace;
          return trace;
        })()
      `),
      { sawFallback: false },
      "detail dialog should mount its real surface directly without a fallback-frame swap",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const dialog = document.querySelector(".destination-detail-dialog");
          const background = document.querySelector("[data-data-content-state]");
          return {
            dialogCount: document.querySelectorAll(".destination-detail-dialog").length,
            hasDescription: Boolean(dialog?.querySelector(".qp-dialog-description")),
            hasHeatmap: Boolean(dialog?.querySelector(".data-heatmap-panel")),
            hasTrend: Boolean(dialog?.querySelector(".destination-detail-chart")),
            hasSummary: Boolean(dialog?.querySelector(".destination-detail-summary")),
            hasModeSwitch: Boolean(dialog?.querySelector(".data-destination-mode")),
            hasNavigation: Boolean(dialog?.querySelector("nav")),
            hasTimelineSubtitle: Boolean(
              dialog?.querySelector(".destination-detail-section-header p"),
            ),
            backgroundConnected: Boolean(background?.isConnected),
            detailColor: getComputedStyle(
              dialog?.querySelector(".destination-detail") ?? document.documentElement,
            ).getPropertyValue("--destination-detail-color").trim().toUpperCase(),
            selectedKeys: Array.from(document.querySelectorAll(
              '[aria-label="应用列表"] button[aria-pressed="true"]',
            )).map((button) => button.getAttribute("data-destination-key")),
          };
        })()
      `),
      {
        dialogCount: 1,
        hasDescription: false,
        hasHeatmap: false,
        hasTrend: false,
        hasSummary: false,
        hasModeSwitch: false,
        hasNavigation: false,
        hasTimelineSubtitle: false,
        backgroundConnected: true,
        detailColor: openingState.targetThemeColor,
        selectedKeys: [openingState.targetKey],
      },
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(
        document.querySelector(".destination-detail-header-actions")
        && document.querySelector(".destination-detail-timeline-track")
      )`,
      45_000,
      "app detail content",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `(() => {
        const timeline = document.querySelector(".destination-detail-timeline");
        const slider = document.querySelector(
          '.destination-detail-timeline-slider input[type="range"]',
        );
        return {
          zoomHours: timeline?.getAttribute("data-destination-detail-timeline-zoom-hours"),
          sliderValue: slider instanceof HTMLInputElement ? slider.value : null,
        };
      })()`),
      { zoomHours: "24", sliderValue: "24" },
      "detail timeline should open with the full 24-hour day",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const interaction = document.querySelector(
          ".destination-detail-timeline-interaction",
        );
        if (!(interaction instanceof HTMLElement)) return false;
        const rect = interaction.getBoundingClientRect();
        const wheel = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width * 0.75,
          clientY: rect.top + rect.height / 2,
          deltaY: -120,
        });
        interaction.dispatchEvent(wheel);
        return wheel.defaultPrevented;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-zoom-hours") === "23.8"`,
      45_000,
      "detail timeline wheel zoom",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const interaction = document.querySelector(
          ".destination-detail-timeline-interaction",
        );
        if (!(interaction instanceof HTMLElement)) return false;
        const rect = interaction.getBoundingClientRect();
        const wheel = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width * 0.75,
          clientY: rect.top + rect.height / 2,
          deltaY: 120,
        });
        interaction.dispatchEvent(wheel);
        return wheel.defaultPrevented;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-zoom-hours") === "24"`,
      45_000,
      "restore detail timeline wheel zoom",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const surface = document.querySelector(".destination-detail-dialog");
          const body = surface?.querySelector(".qp-dialog-body");
          return {
            bodyOwnsScrolling: body
              ? ["auto", "scroll"].includes(getComputedStyle(body).overflowY)
              : false,
            hasRangeControl: Boolean(surface?.querySelector(".data-trend-range-control")),
            hasTrendChart: Boolean(surface?.querySelector(".destination-detail-chart")),
            hasMetricSummary: Boolean(surface?.querySelector(
              ".destination-detail-summary",
            )),
            hasDaySummary: Boolean(surface?.querySelector(
              ".destination-detail-day-summary",
            )),
            hasTimelineZoom: Boolean(surface?.querySelector(
              'input[aria-label="时间轴窗口时长"]',
            )),
            nativeTooltipCount: surface?.querySelectorAll("[title]").length ?? -1,
          };
        })()
      `),
      {
        bodyOwnsScrolling: false,
        hasRangeControl: false,
        hasTrendChart: false,
        hasMetricSummary: false,
        hasDaySummary: false,
        hasTimelineZoom: true,
        nativeTooltipCount: 0,
      },
      "detail should use a compact zoomable day timeline without duplicate summaries or native tooltips",
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-timeline-segment"))`,
      45_000,
      "visible detail timeline segment",
    );
    const detailSegmentPresentation = JSON.parse(String(await evaluate(
      client!,
      sessionId,
      `
        (() => {
          const segment = document.querySelector(
            ".destination-detail-timeline-segment",
          );
          const track = document.querySelector(
            ".destination-detail-timeline-track",
          );
          const axis = document.querySelector(
            ".destination-detail-timeline-axis",
          );
          const firstAxisLabel = axis?.querySelector("span");
          if (!(segment instanceof HTMLElement)) return null;
          if (!(track instanceof HTMLElement)) return null;
          if (!(axis instanceof HTMLElement)) return null;
          if (!(firstAxisLabel instanceof HTMLElement)) return null;
          const rect = segment.getBoundingClientRect();
          const blockStyle = getComputedStyle(segment, "::before");
          const trackLineStyle = getComputedStyle(track, "::before");
          const axisStyle = getComputedStyle(axis);
          const firstAxisLabelStyle = getComputedStyle(firstAxisLabel);
          return JSON.stringify({
            nativeTitle: segment.getAttribute("title"),
            cursor: getComputedStyle(segment).cursor,
            blockHeight: blockStyle.height,
            blockRadius: blockStyle.borderRadius,
            hasGeometry: rect.width > 0 && rect.height > 0,
            trackLineHeight: trackLineStyle.height,
            trackLineTop: trackLineStyle.top,
            axisFontSize: axisStyle.fontSize,
            axisFontWeight: axisStyle.fontWeight,
            axisLabelTop: firstAxisLabelStyle.top,
            hasVerticalGrid: Boolean(document.querySelector(
              ".destination-detail-timeline-grid",
            )),
          });
        })()
      `,
    )));
    assert.deepEqual(
      {
        nativeTitle: detailSegmentPresentation.nativeTitle,
        cursor: detailSegmentPresentation.cursor,
        blockHeight: detailSegmentPresentation.blockHeight,
        blockRadius: detailSegmentPresentation.blockRadius,
        hasGeometry: detailSegmentPresentation.hasGeometry,
        trackLineHeight: detailSegmentPresentation.trackLineHeight,
        trackLineTop: detailSegmentPresentation.trackLineTop,
        axisFontSize: detailSegmentPresentation.axisFontSize,
        axisFontWeight: detailSegmentPresentation.axisFontWeight,
        axisLabelTop: detailSegmentPresentation.axisLabelTop,
        hasVerticalGrid: detailSegmentPresentation.hasVerticalGrid,
      },
      {
        nativeTitle: null,
        cursor: "default",
        blockHeight: "48px",
        blockRadius: "2px",
        hasGeometry: true,
        trackLineHeight: "1px",
        trackLineTop: "31px",
        axisFontSize: "9px",
        axisFontWeight: "700",
        axisLabelTop: "5px",
        hasVerticalGrid: false,
      },
      "detail timeline should reuse the History blocks and centered horizontal track",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const segment = document.querySelector(
          ".destination-detail-timeline-segment",
        );
        if (!(segment instanceof HTMLElement)) return false;
        segment.dispatchEvent(new MouseEvent("mouseover", {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(
        ".qp-tooltip.destination-detail-timeline-tooltip",
      ))`,
      45_000,
      "Quiet Pro detail timeline tooltip",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `(() => {
          const tooltipLabel = document
            .querySelector(
              ".destination-detail-timeline-tooltip-label",
            )
            ?.textContent?.trim();
          const dialogHeading = document
            .querySelector(
              ".destination-detail-dialog .qp-dialog-heading",
            )
            ?.textContent?.trim();

          return Boolean(
            tooltipLabel &&
              dialogHeading &&
              dialogHeading.includes(tooltipLabel),
          );
        })()`,
      ),
      true,
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const segment = document.querySelector(
          ".destination-detail-timeline-segment",
        );
        if (!(segment instanceof HTMLElement)) return false;
        segment.dispatchEvent(new MouseEvent("mouseout", {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
          view: window,
        }));
        return true;
      })()
    `), true);
    const wideDialogGeometry = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const surface = document.querySelector(".destination-detail-dialog");
        const header = surface?.querySelector(".qp-dialog-header");
        const heading = surface?.querySelector(".qp-dialog-heading");
        const actions = surface?.querySelector(".destination-detail-header-actions");
        const timeline = surface?.querySelector(".destination-detail-timeline-track");
        if (!surface || !header || !heading || !actions || !timeline) return null;
        const surfaceRect = surface.getBoundingClientRect();
        const headingRect = heading.getBoundingClientRect();
        const actionsRect = actions.getBoundingClientRect();
        const timelineRect = timeline.getBoundingClientRect();
        return JSON.stringify({
          horizontalOverflow: surface.scrollWidth > surface.clientWidth,
          insideViewport: surfaceRect.left >= 0
            && surfaceRect.right <= innerWidth
            && surfaceRect.top >= 0
            && surfaceRect.bottom <= innerHeight,
          referenceHeight: surfaceRect.height <= 672.5,
          headerOverlap: headingRect.right > actionsRect.left
            && headingRect.bottom > actionsRect.top
            && headingRect.top < actionsRect.bottom,
          timelineInside: timelineRect.left >= surfaceRect.left
            && timelineRect.right <= surfaceRect.right,
        });
      })()
    `))) as {
      horizontalOverflow: boolean;
      insideViewport: boolean;
      referenceHeight: boolean;
      headerOverlap: boolean;
      timelineInside: boolean;
    };
    assert.deepEqual(wideDialogGeometry, {
      horizontalOverflow: false,
      insideViewport: true,
      referenceHeight: true,
      headerOverlap: false,
      timelineInside: true,
    });
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 720,
      height: 720,
      deviceScaleFactor: 1.5,
      mobile: false,
    }, sessionId);
    await waitForAnimationFrames(client!, sessionId, 2);
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const surface = document.querySelector(".destination-detail-dialog");
          const timeline = surface?.querySelector(".destination-detail-timeline-track");
          if (!surface || !timeline) return null;
          const surfaceRect = surface.getBoundingClientRect();
          const timelineRect = timeline.getBoundingClientRect();
          return {
            horizontalOverflow: surface.scrollWidth > surface.clientWidth,
            surfaceInside: surfaceRect.left >= 0 && surfaceRect.right <= innerWidth,
            timelineInside: timelineRect.left >= surfaceRect.left
              && timelineRect.right <= surfaceRect.right,
          };
        })()
      `),
      {
        horizontalOverflow: false,
        surfaceInside: true,
        timelineInside: true,
      },
      "detail dialog should remain contained at the narrow supported width and 150% DPR",
    );
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1.25,
      mobile: false,
    }, sessionId);
    await waitForAnimationFrames(client!, sessionId, 2);
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const surface = document.querySelector(".destination-detail-dialog");
          const actions = surface?.querySelector(".destination-detail-header-actions");
          const heading = surface?.querySelector(".qp-dialog-heading");
          if (!surface || !actions || !heading) return null;
          const surfaceRect = surface.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          const headingRect = heading.getBoundingClientRect();
          return {
            horizontalOverflow: surface.scrollWidth > surface.clientWidth,
            insideViewport: surfaceRect.left >= 0
              && surfaceRect.right <= innerWidth
              && surfaceRect.top >= 0
              && surfaceRect.bottom <= innerHeight,
            headerOverlap: headingRect.right > actionsRect.left
              && headingRect.bottom > actionsRect.top
              && headingRect.top < actionsRect.bottom,
          };
        })()
      `),
      {
        horizontalOverflow: false,
        insideViewport: true,
        headerOverlap: false,
      },
      "detail dialog should remain stable in a 125% DPI full-screen reference viewport",
    );
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await waitForAnimationFrames(client!, sessionId, 2);
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const surface = document.querySelector(".destination-detail-dialog");
          return {
            backgroundRange: document.querySelector(
            ".data-app-panel > .data-app-panel-header .data-trend-range-trigger",
            )?.textContent?.trim() ?? "",
            hasTrendChart: Boolean(surface?.querySelector(
              ".destination-detail-chart",
            )),
            hasMetricSummary: Boolean(surface?.querySelector(
              ".destination-detail-summary",
            )),
          };
        })()
      `),
      {
        backgroundRange: openingState.backgroundRange,
        hasTrendChart: false,
        hasMetricSummary: false,
      },
      "detail should leave the Data trend range untouched and omit duplicate analysis",
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-timeline-track"))
        && Boolean(document.querySelector(
          ".destination-detail-activity-disclosure",
        ))`,
      45_000,
      "detail day analysis",
    );
    const detailBeforeDelayedDayNavigation = JSON.parse(String(await evaluate(
      client!,
      sessionId,
      `
        (() => {
          const content = document.querySelector(
            ".destination-detail-day-content",
          );
          const timeline = document.querySelector(
            ".destination-detail-timeline-track",
          );
          const records = document.querySelector(
            ".destination-detail-records",
          );
          if (!(content instanceof HTMLElement)) return null;
          if (!(timeline instanceof HTMLElement)) return null;
          if (!(records instanceof HTMLElement)) return null;
          const timelineRect = timeline.getBoundingClientRect();
          const recordsRect = records.getBoundingClientRect();
          return JSON.stringify({
            displayedDate: content.dataset.destinationDetailDisplayedDate,
            requestedDate: content.dataset.destinationDetailRequestedDate,
            dateLabel: document.querySelector(".destination-detail-date-trigger")?.textContent,
            timelineRect: {
              width: timelineRect.width,
              height: timelineRect.height,
            },
            recordsRect: {
              width: recordsRect.width,
              height: recordsRect.height,
            },
          });
        })()
      `,
    ))) as {
      displayedDate: string;
      requestedDate: string;
      dateLabel: string;
      timelineRect: { width: number; height: number };
      recordsRect: { width: number; height: number };
    };
    assert.ok(detailBeforeDelayedDayNavigation);
    assert.equal(
      detailBeforeDelayedDayNavigation.displayedDate,
      detailBeforeDelayedDayNavigation.requestedDate,
    );
    await evaluate(
      client!,
      sessionId,
      `localStorage.setItem("__time_tracker_history_query_delay_ms", "900")`,
    );
    try {
      assert.equal(await evaluate(client!, sessionId, `
        (() => {
          const previous = document.querySelector(
            ".destination-detail-day-actions .qp-range-control-arrow",
          );
          if (!(previous instanceof HTMLButtonElement) || previous.disabled) {
            return false;
          }
          previous.click();
          return true;
        })()
      `), true);
      await delay(150);
      const retainedDetailDuringDelayedNavigation = JSON.parse(String(
        await evaluate(client!, sessionId, `
          (() => {
            const content = document.querySelector(
              ".destination-detail-day-content",
            );
            const timeline = document.querySelector(
              ".destination-detail-timeline-track",
            );
            const records = document.querySelector(
              ".destination-detail-records",
            );
            if (!(content instanceof HTMLElement)) return null;
            if (!(timeline instanceof HTMLElement)) return null;
            if (!(records instanceof HTMLElement)) return null;
            const timelineRect = timeline.getBoundingClientRect();
            const recordsRect = records.getBoundingClientRect();
            return JSON.stringify({
              busy: content.getAttribute("aria-busy"),
              displayedDate: content.dataset.destinationDetailDisplayedDate,
              requestedDate: content.dataset.destinationDetailRequestedDate,
              dateLabel: document.querySelector(".destination-detail-date-trigger")?.textContent,
              hasTimelinePlaceholder: Boolean(document.querySelector(
                ".destination-detail-timeline-placeholder",
              )),
              hasRecordsPlaceholder: Boolean(document.querySelector(
                ".destination-detail-records-placeholder",
              )),
              timelineRect: {
                width: timelineRect.width,
                height: timelineRect.height,
              },
              recordsRect: {
                width: recordsRect.width,
                height: recordsRect.height,
              },
            });
          })()
        `),
      )) as {
        busy: string | null;
        displayedDate: string;
        requestedDate: string;
        dateLabel: string;
        hasTimelinePlaceholder: boolean;
        hasRecordsPlaceholder: boolean;
        timelineRect: { width: number; height: number };
        recordsRect: { width: number; height: number };
      };
      assert.ok(retainedDetailDuringDelayedNavigation);
      assert.equal(retainedDetailDuringDelayedNavigation.busy, "true");
      assert.equal(retainedDetailDuringDelayedNavigation.dateLabel, detailBeforeDelayedDayNavigation.dateLabel);
      assert.equal(
        retainedDetailDuringDelayedNavigation.displayedDate,
        detailBeforeDelayedDayNavigation.displayedDate,
      );
      assert.notEqual(
        retainedDetailDuringDelayedNavigation.requestedDate,
        detailBeforeDelayedDayNavigation.requestedDate,
      );
      assert.equal(retainedDetailDuringDelayedNavigation.hasTimelinePlaceholder, false);
      assert.equal(retainedDetailDuringDelayedNavigation.hasRecordsPlaceholder, false);
      assert.ok(
        Math.abs(
          retainedDetailDuringDelayedNavigation.timelineRect.width
            - detailBeforeDelayedDayNavigation.timelineRect.width,
        ) <= 0.5,
      );
      assert.ok(
        Math.abs(
          retainedDetailDuringDelayedNavigation.timelineRect.height
            - detailBeforeDelayedDayNavigation.timelineRect.height,
        ) <= 0.5,
      );
      assert.ok(
        Math.abs(
          retainedDetailDuringDelayedNavigation.recordsRect.width
            - detailBeforeDelayedDayNavigation.recordsRect.width,
        ) <= 0.5,
      );
      assert.ok(
        Math.abs(
          retainedDetailDuringDelayedNavigation.recordsRect.height
            - detailBeforeDelayedDayNavigation.recordsRect.height,
        ) <= 0.5,
      );
      await waitForExpression(
        client!,
        sessionId,
        `(() => {
          const content = document.querySelector(
            ".destination-detail-day-content",
          );
          return content?.getAttribute("aria-busy") === "false"
            && content.getAttribute("data-destination-detail-displayed-date")
              === content.getAttribute("data-destination-detail-requested-date");
        })()`,
        45_000,
        "detail day navigation settles without an intermediate blank frame",
      );
    } finally {
      await evaluate(
        client!,
        sessionId,
        `localStorage.removeItem("__time_tracker_history_query_delay_ms")`,
      );
    }
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const arrows = document.querySelectorAll(
          ".destination-detail-day-actions .qp-range-control-arrow",
        );
        const next = arrows[1];
        if (!(next instanceof HTMLButtonElement) || next.disabled) return false;
        next.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".destination-detail-day-content")
        ?.getAttribute("data-destination-detail-displayed-date")
          === ${jsonString(detailBeforeDelayedDayNavigation.displayedDate)}`,
      45_000,
      "restore detail day after delayed navigation regression",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const slider = document.querySelector(
          '.destination-detail-timeline-slider input[type="range"]',
        );
        if (!(slider instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(slider, "3");
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-zoom-hours") === "3"`,
      45_000,
      "detail timeline first zoom step",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `localStorage.getItem("patina:destination-detail-timeline-zoom-hours:v1")`,
      ),
      "3",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const decrease = document.querySelector(
          '.destination-detail-dialog button[aria-label="缩短时间轴窗口"]',
        );
        if (!(decrease instanceof HTMLButtonElement)) return false;
        decrease.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-zoom-hours") === "2"`,
      45_000,
      "detail timeline zoom",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `localStorage.getItem("patina:destination-detail-timeline-zoom-hours:v1")`,
      ),
      "2",
    );
    const timelineStartBeforePan = Number(await evaluate(client!, sessionId, `
      document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-start-ms")
    `));
    assert.ok(Number.isFinite(timelineStartBeforePan));
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const interaction = document.querySelector(
          ".destination-detail-timeline-interaction",
        );
        if (!(interaction instanceof HTMLElement)) return false;
        interaction.dispatchEvent(new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Number(document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-start-ms")) > ${timelineStartBeforePan}`,
      45_000,
      "detail timeline horizontal pan",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const interaction = document.querySelector(
          ".destination-detail-timeline-interaction",
        );
        if (!(interaction instanceof HTMLElement)) return false;
        interaction.dispatchEvent(new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          bubbles: true,
        }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Number(document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-start-ms")) === ${timelineStartBeforePan}`,
      45_000,
      "restore detail timeline pan",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const interaction = document.querySelector(
            ".destination-detail-timeline-interaction",
          );
          if (!(interaction instanceof HTMLElement)) return false;
          interaction.dispatchEvent(new KeyboardEvent("keydown", {
            key: "End",
            bubbles: true,
          }));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Number(document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-start-ms")) > ${timelineStartBeforePan}`,
      45_000,
      "move detail timeline to day end",
    );
    let reachedRecordedActivities = false;
    for (let index = 0; index < 120; index += 1) {
      reachedRecordedActivities = Boolean(await evaluate(
        client!,
        sessionId,
        `Boolean(document.querySelector(".destination-detail-activity-disclosure"))`,
      ));
      if (reachedRecordedActivities) break;
      const panStart = Number(await evaluate(client!, sessionId, `
        document.querySelector(".destination-detail-timeline")
          ?.getAttribute("data-destination-detail-timeline-start-ms")
      `));
      await evaluate(client!, sessionId, `
        document.querySelector(".destination-detail-timeline-interaction")
          ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
      `);
      await waitForExpression(
        client!,
        sessionId,
        `Number(document.querySelector(".destination-detail-timeline")
          ?.getAttribute("data-destination-detail-timeline-start-ms")) < ${panStart}`,
        45_000,
        "pan detail timeline toward recorded activities",
      );
    }
    reachedRecordedActivities ||= Boolean(await evaluate(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-activity-disclosure"))`,
    ));
    assert.equal(
      reachedRecordedActivities,
      true,
      "keyboard panning should reach recorded activities regardless of the current clock hour",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const surface = document.querySelector(".destination-detail-dialog");
          const body = surface?.querySelector(".qp-dialog-body");
          const records = surface?.querySelector(".destination-detail-records");
          if (!body || !records) return false;

          const bodyOverflowY = getComputedStyle(body).overflowY;
          const recordsOverflowY = getComputedStyle(records).overflowY;
          return !["auto", "scroll"].includes(bodyOverflowY)
            && ["auto", "scroll"].includes(recordsOverflowY);
        })()
      `),
      true,
      "only the application-detail list should own vertical scrolling",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const records = document.querySelector(".destination-detail-records");
          const summaries = Array.from(
            document.querySelectorAll(".destination-detail-activity-summary"),
          );
          if (!(records instanceof HTMLElement) || summaries.length === 0) return false;
          const recordsStyle = getComputedStyle(records);
          const summaryHeights = summaries.map(
            (summary) => summary.getBoundingClientRect().height,
          );
          return recordsStyle.alignContent === "start"
            && recordsStyle.gridAutoRows === "max-content"
            && summaryHeights.every((height) => height >= 46 && height <= 64)
            && summaryHeights.reduce((total, height) => total + height, 0)
              < records.getBoundingClientRect().height;
        })()
      `),
      true,
      "application-detail rows should retain the fixed Quiet Pro summary height",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const meta = document.querySelector(".destination-detail-record-meta");
          if (!(meta instanceof HTMLElement)) return false;
          const style = getComputedStyle(meta);
          const colorProbe = document.createElement("span");
          colorProbe.style.color = "var(--qp-text-primary)";
          document.body.append(colorProbe);
          const expectedColor = getComputedStyle(colorProbe).color;
          colorProbe.remove();
          return style.fontSize === "9px"
            && style.fontWeight === "600"
            && style.color === expectedColor;
        })()
      `),
      true,
      "application-detail metadata should use the shared History color, size, and weight",
    );
    const durationControlState = JSON.parse(String(
      await evaluate(client!, sessionId, `
        (() => {
          const controls = document.querySelector(
            ".destination-detail-duration-controls",
          );
          const decrease = controls?.querySelector(
            '[aria-label="减少显示分钟 1 分钟"]',
          );
          const increase = controls?.querySelector(
            '[aria-label="增加显示分钟 1 分钟"]',
          );
          const value = controls?.querySelector(
            ".destination-detail-duration-value",
          );
          if (
            !(decrease instanceof HTMLButtonElement)
            || !(increase instanceof HTMLButtonElement)
            || !(value instanceof HTMLElement)
          ) return null;
          const initialMinutes = Number.parseInt(value.textContent ?? "", 10);
          const initialActivityCount = document.querySelectorAll(
            ".destination-detail-activity",
          ).length;
          const change = increase.disabled ? -1 : 1;
          const button = change > 0 ? increase : decrease;
          button.click();
          return JSON.stringify({
            change,
            initialActivityCount,
            initialMinutes,
          });
        })()
      `),
    )) as {
      change: number;
      initialActivityCount: number;
      initialMinutes: number;
    };
    assert.ok(durationControlState);
    await waitForExpression(
      client!,
      sessionId,
      `Number.parseInt(
        document.querySelector(".destination-detail-duration-value")
          ?.textContent ?? "",
        10,
      ) === ${durationControlState.initialMinutes + durationControlState.change}`,
      45_000,
      "detail minimum activity duration update",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        document.querySelectorAll(".destination-detail-activity").length
          ${durationControlState.change > 0 ? "<=" : ">="}
          ${durationControlState.initialActivityCount}
      `),
      true,
      "raising the minimum duration should never add fragmented activities",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const controls = document.querySelector(
            ".destination-detail-duration-controls",
          );
          const button = controls?.querySelector(
            ${durationControlState.change > 0
              ? `'[aria-label="减少显示分钟 1 分钟"]'`
              : `'[aria-label="增加显示分钟 1 分钟"]'`}
          );
          if (!(button instanceof HTMLButtonElement)) return false;
          button.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Number.parseInt(
        document.querySelector(".destination-detail-duration-value")
          ?.textContent ?? "",
        10,
      ) === ${durationControlState.initialMinutes}
        && Boolean(document.querySelector(
          ".destination-detail-activity-disclosure",
        ))`,
      45_000,
      "restore detail minimum activity duration",
    );
    const minimumControlSelector = ".destination-detail-duration-controls";
    const originalMinimum = Number(await evaluate(client!, sessionId,
      `parseInt(document.querySelector("${minimumControlSelector}")?.textContent ?? "", 10)`));
    let currentMinimum = originalMinimum;
    for (const targetMinimum of [0, 1, 0, 9, 10, originalMinimum]) {
      while (currentMinimum !== targetMinimum) {
        const direction = currentMinimum < targetMinimum ? 1 : -1;
        await evaluate(client!, sessionId,
          `document.querySelector("${minimumControlSelector}")?.querySelectorAll("button")[${direction > 0 ? 1 : 0}]?.click()`);
        currentMinimum += direction;
        await waitForExpression(client!, sessionId,
          `parseInt(document.querySelector("${minimumControlSelector}")?.textContent ?? "", 10) === ${currentMinimum}`);
      }
      assert.equal(await evaluate(client!, sessionId, `(() => {
        const buttons = document.querySelector("${minimumControlSelector}")?.querySelectorAll("button");
        return buttons?.[0]?.disabled === ${targetMinimum === 0}
          && buttons?.[1]?.disabled === ${targetMinimum === 10};
      })()`), true);
    }
    await evaluate(client!, sessionId, `(() => {
      const barrier = { entered: false, finished: false };
      barrier.promise = new Promise(resolve => { barrier.release = resolve; });
      globalThis.__PATINA_DETAIL_READ_BARRIER = barrier;
      globalThis.__PATINA_DETAIL_TEST_BARRIER = barrier;
      document.querySelectorAll(".destination-detail-day-actions .qp-range-control-arrow")[0].click();
    })()`);
    try {
      await waitForExpression(client!, sessionId, `globalThis.__PATINA_DETAIL_TEST_BARRIER.entered`);
      await evaluate(client!, sessionId,
        `document.querySelectorAll(".destination-detail-day-actions .qp-range-control-arrow")[1].click()`);
      await waitForExpression(client!, sessionId, `(() => {
        const content = document.querySelector(".destination-detail-day-content");
        return content?.getAttribute("aria-busy") === "false"
          && content.dataset.destinationDetailDisplayedDate === ${jsonString(detailBeforeDelayedDayNavigation.displayedDate)};
      })()`);
      await evaluate(client!, sessionId, `globalThis.__PATINA_DETAIL_TEST_BARRIER.release()`);
      await waitForExpression(client!, sessionId, `globalThis.__PATINA_DETAIL_TEST_BARRIER.finished`);
      await waitForAnimationFrames(client!, sessionId, 2);
      assert.equal(await evaluate(client!, sessionId,
        `document.querySelector(".destination-detail-day-content")?.dataset.destinationDetailDisplayedDate`),
      detailBeforeDelayedDayNavigation.displayedDate);
    } finally {
      await evaluate(client!, sessionId, `(() => {
        globalThis.__PATINA_DETAIL_TEST_BARRIER?.release();
        delete globalThis.__PATINA_DETAIL_TEST_BARRIER;
        delete globalThis.__PATINA_DETAIL_READ_BARRIER;
      })()`);
    }
    const detailDayNavigationContract = await evaluate(client!, sessionId, `
        (() => {
          const controls = document.querySelector(
            ".destination-detail-day-actions",
          );
          const arrows = controls?.querySelectorAll(".qp-range-control-arrow");
          const label = controls?.querySelector(".qp-range-control-label");
          const referenceLabel = document.querySelector(
            ".data-app-panel .data-trend-range-control .qp-range-control-label",
          );
          if (!arrows || arrows.length !== 2 || !label || !referenceLabel) {
            return {
              passed: false,
              diagnostics: { reason: "missing controls" },
            };
          }
          const leftRect = arrows[0].getBoundingClientRect();
          const rightRect = arrows[1].getBoundingClientRect();
          const labelRect = label.getBoundingClientRect();
          const labelStyle = getComputedStyle(label);
          const referenceStyle = getComputedStyle(referenceLabel);
          const sharedStyleProperties = [
            "height",
            "minHeight",
            "borderRadius",
            "borderTopWidth",
            "borderTopColor",
            "backgroundColor",
            "paddingLeft",
            "paddingRight",
            "fontSize",
            "fontWeight",
            "lineHeight",
          ];
          const geometryMatches = [leftRect.height, rightRect.height, labelRect.height]
              .every((height) => Math.abs(height - 24) <= 0.5)
            && [leftRect.width, rightRect.width]
              .every((width) => Math.abs(width - 24) <= 0.5)
            && labelRect.width >= 68;
          const ownerMatches = controls?.parentElement?.classList.contains(
              "qp-date-picker-day-navigation",
            );
          const avoidsInputContract = !label.classList.contains("qp-input");
          const clickableCursor = labelStyle.cursor === "pointer";
          const styleDifferences = sharedStyleProperties
            .filter((property) => labelStyle[property] !== referenceStyle[property])
            .map((property) => ({
              property,
              actual: labelStyle[property],
              expected: referenceStyle[property],
            }));
          return {
            passed: geometryMatches
              && ownerMatches
              && avoidsInputContract
              && clickableCursor
              && styleDifferences.length === 0,
            diagnostics: {
              geometryMatches,
              ownerMatches,
              avoidsInputContract,
              clickableCursor,
              rects: {
                left: { width: leftRect.width, height: leftRect.height },
                label: { width: labelRect.width, height: labelRect.height },
                right: { width: rightRect.width, height: rightRect.height },
              },
              styleDifferences,
            },
          };
        })()
      `) as {
        passed: boolean;
        diagnostics: unknown;
      };
    assert.equal(
      detailDayNavigationContract.passed,
      true,
      `detail day navigation should reuse the actual compact range-control contract: ${
        JSON.stringify(detailDayNavigationContract.diagnostics)
      }`,
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const trigger = document.querySelector(
          ".destination-detail-date-trigger",
        );
        if (!(trigger instanceof HTMLButtonElement)) return false;
        trigger.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(
        ".qp-calendar-popover .qp-calendar-days",
      ))`,
      45_000,
      "detail day calendar",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(
            ".destination-detail-date-trigger",
          );
          const arrow = document.querySelector(
            ".destination-detail-day-actions .qp-range-control-arrow",
          );
          const selected = document.querySelector(
            ".qp-calendar-popover .qp-calendar-day[data-selected='true']",
          );
          if (
            !(trigger instanceof HTMLButtonElement)
            || !(arrow instanceof HTMLButtonElement)
            || !(selected instanceof HTMLButtonElement)
          ) return false;
          const selectedKey = selected.dataset.calendarDate;
          if (!selectedKey) return false;
          const outsideButton = Array.from(document.querySelectorAll(
            ".qp-calendar-popover [data-calendar-date]",
          )).find(
            (candidate) => candidate instanceof HTMLButtonElement
              && (candidate.dataset.calendarDate ?? "") < selectedKey
              && !candidate.disabled,
          );
          return trigger.classList.contains("qp-date-picker-range-trigger-open")
            && getComputedStyle(trigger).borderTopColor
              === getComputedStyle(arrow).borderTopColor
            && outsideButton instanceof HTMLButtonElement
            && !outsideButton.disabled;
        })()
      `),
      true,
      "range date picker should keep neutral chrome and allow dates before the initial seven-day range",
    );
    await evaluate(
      client!,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".qp-calendar-popover")
        && Boolean(document.querySelector(".destination-detail-dialog"))`,
      45_000,
      "close detail day calendar",
    );
    const activityDisclosureGeometry = JSON.parse(String(await evaluate(
      client!,
      sessionId,
      `
        (() => {
          const trigger = document.querySelector(
            ".destination-detail-activity-disclosure",
          );
          const records = document.querySelector(
            ".destination-detail-records",
          );
          const row = trigger?.closest(".destination-detail-activity");
          if (!(trigger instanceof HTMLButtonElement)) return null;
          if (!(records instanceof HTMLElement)) return null;
          if (!(row instanceof HTMLElement)) return null;
          const rowRect = row.getBoundingClientRect();
          const recordsRect = records.getBoundingClientRect();
          trigger.click();
          return JSON.stringify({
            rowHeight: rowRect.height,
            recordsHeight: recordsRect.height,
          });
        })()
      `,
    ))) as {
      rowHeight: number;
      recordsHeight: number;
    };
    assert.ok(activityDisclosureGeometry);
    await waitForStableExpression(
      client!,
      sessionId,
      VISIBLE_DESTINATION_DETAIL_POPOVER,
      45_000,
      "detail title popover",
    );
    const activityPopoverContract = JSON.parse(String(await evaluate(
      client!,
      sessionId,
      `
        (() => {
          const trigger = document.querySelector(
            ".destination-detail-activity-disclosure[aria-expanded='true']",
          );
          const popover = document.querySelector(
            ".destination-detail-record-popover",
          );
          const records = document.querySelector(
            ".destination-detail-records",
          );
          const row = trigger?.closest(".destination-detail-activity");
          if (!(trigger instanceof HTMLButtonElement)) return null;
          if (!(popover instanceof HTMLElement)) return null;
          if (!(records instanceof HTMLElement)) return null;
          if (!(row instanceof HTMLElement)) return null;
          return JSON.stringify({
            parentIsBody: popover.parentElement === document.body,
            role: popover.getAttribute("role"),
            itemCount: popover.querySelectorAll(
              ".destination-detail-popover-item",
            ).length,
            hasLegacyDrawer: Boolean(document.querySelector(
              ".destination-detail-fragments",
            )),
            nativeTooltipCount: popover.querySelectorAll("[title]").length,
            rowHeight: row.getBoundingClientRect().height,
            recordsHeight: records.getBoundingClientRect().height,
          });
        })()
      `,
    ))) as {
      parentIsBody: boolean;
      role: string | null;
      itemCount: number;
      hasLegacyDrawer: boolean;
      nativeTooltipCount: number;
      rowHeight: number;
      recordsHeight: number;
    };
    assert.ok(activityPopoverContract);
    assert.equal(activityPopoverContract.parentIsBody, true);
    assert.equal(activityPopoverContract.role, "region");
    assert.ok(activityPopoverContract.itemCount >= 1);
    assert.equal(activityPopoverContract.hasLegacyDrawer, false);
    assert.equal(
      activityPopoverContract.nativeTooltipCount,
      0,
      "title detail popovers should not duplicate visible copy with browser-native tooltips",
    );
    assert.ok(
      Math.abs(
        activityPopoverContract.rowHeight - activityDisclosureGeometry.rowHeight,
      ) < 1,
      "title popover should not change the activity row height",
    );
    assert.ok(
      Math.abs(
        activityPopoverContract.recordsHeight
          - activityDisclosureGeometry.recordsHeight,
      ) < 1,
      "title popover should not change the records viewport height",
    );
    await evaluate(
      client!,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".destination-detail-record-popover")
        && Boolean(document.querySelector(".destination-detail-dialog"))`,
      45_000,
      "close detail title popover without closing the dialog",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const trigger = document.querySelector(
          ".destination-detail-date-trigger",
        );
        if (!(trigger instanceof HTMLButtonElement)) return false;
        trigger.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(
        ".qp-calendar-popover .qp-calendar-day[data-selected='true']",
      ))`,
      45_000,
      "reopen unrestricted detail day calendar",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const selected = document.querySelector(
          ".qp-calendar-popover .qp-calendar-day[data-selected='true']",
        );
        if (!(selected instanceof HTMLButtonElement)) return false;
        const selectedKey = selected.dataset.calendarDate;
        if (!selectedKey) return false;
        const outsideButton = Array.from(document.querySelectorAll(
          ".qp-calendar-popover [data-calendar-date]",
        )).find(
          (candidate) => candidate instanceof HTMLButtonElement
            && (candidate.dataset.calendarDate ?? "") < selectedKey
            && !candidate.disabled,
        );
        if (!(outsideButton instanceof HTMLButtonElement) || outsideButton.disabled) {
          return false;
        }
        outsideButton.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".qp-calendar-popover")
        && document.querySelector(".destination-detail-date-trigger")
          ?.textContent?.trim() !== "今天"`,
      45_000,
      "select a detail date outside the initial seven-day range",
    );

    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const close = document.querySelector(
          '.destination-detail-dialog [aria-label="关闭详情"]',
        );
        if (!(close instanceof HTMLButtonElement)) return false;
        close.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".destination-detail-dialog")`,
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const list = document.querySelector('[aria-label="应用列表"]');
          return {
            backgroundRange: document.querySelector(
              ".data-app-panel > .data-app-panel-header .data-trend-range-trigger",
            )?.textContent?.trim() ?? "",
            focusedKey: document.activeElement?.getAttribute("data-destination-key") ?? null,
            scrollTop: list instanceof HTMLElement ? list.scrollTop : -1,
            selectedKeys: Array.from(document.querySelectorAll(
              '[aria-label="应用列表"] button[aria-pressed="true"]',
            )).map((button) => button.getAttribute("data-destination-key")),
          };
        })()
      `),
      {
        backgroundRange: openingState.backgroundRange,
        focusedKey: openingState.targetKey,
        scrollTop: openingState.listScrollTop,
        selectedKeys: [openingState.targetKey],
      },
    );

    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const icon = document.querySelector(".data-app-selected-icon");
        if (!(icon instanceof HTMLButtonElement)) return false;
        icon.focus();
        icon.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".destination-detail-timeline")
        ?.getAttribute("data-destination-detail-timeline-zoom-hours") === "2"`,
      45_000,
      "detail timeline restores the persisted zoom after reopening",
    );
    await evaluate(
      client!,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".destination-detail-dialog")`,
    );
    await evaluate(
      client!,
      sessionId,
      `localStorage.removeItem("patina:destination-detail-timeline-zoom-hours:v1"); localStorage.removeItem("patina:data-destination-detail-timeline-zoom-hours:v1")`,
    );

    await evaluate(
      client!,
      sessionId,
      `globalThis.__TIME_TRACKER_ENABLE_DATA_WEB_DETAIL_FIXTURE = true`,
    );
    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "网页")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('[aria-label="网页列表"] button').length >= 1`,
      45_000,
      "web detail candidates",
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const target = document.querySelector('[aria-label="网页列表"] button');
        if (!(target instanceof HTMLButtonElement)) return false;
        target.focus();
        const trigger = target.querySelector("[data-destination-detail-trigger]");
        if (!(trigger instanceof HTMLElement)) return false;
        trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 2 }));
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
        trigger.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-dialog"))
        && !document.querySelector(
          ".destination-detail-dialog .qp-dialog-description",
        )`,
      45_000,
      "web detail dialog",
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-timeline-track"))
        && Boolean(document.querySelector(
          ".destination-detail-activity-disclosure",
        ))`,
      45_000,
      "web detail day",
    );
    const webTitlePopoverContract = JSON.parse(String(await evaluate(
      client!,
      sessionId,
      `
        (() => {
          const trigger = document.querySelector(
            ".destination-detail-activity-disclosure",
          );
          const row = trigger?.closest(".destination-detail-activity");
          if (!(trigger instanceof HTMLButtonElement)) return null;
          if (!(row instanceof HTMLElement)) return null;
          const rowHeight = row.getBoundingClientRect().height;
          trigger.click();
          return JSON.stringify({ rowHeight });
        })()
      `,
    ))) as { rowHeight: number };
    assert.ok(webTitlePopoverContract);
    await waitForStableExpression(
      client!,
      sessionId,
      VISIBLE_DESTINATION_DETAIL_POPOVER,
      45_000,
      "web title details popover",
    );
    const webTitlePopoverPresentation = JSON.parse(String(await evaluate(
      client!,
      sessionId,
      `
        (() => {
          const popover = document.querySelector(
            ".destination-detail-record-popover",
          );
          const item = popover?.querySelector(
            ".destination-detail-popover-item",
          );
          const copy = item?.querySelector(
            ".destination-detail-popover-copy",
          );
          const title = copy?.querySelector("strong");
          const url = copy?.querySelector("span");
          const trigger = document.querySelector(
            ".destination-detail-activity-disclosure[aria-expanded='true']",
          );
          const row = trigger?.closest(".destination-detail-activity");
          if (!(popover instanceof HTMLElement)) return null;
          if (!(item instanceof HTMLElement)) return null;
          if (!(title instanceof HTMLElement)) return null;
          if (!(url instanceof HTMLElement)) return null;
          if (!(row instanceof HTMLElement)) return null;
          const style = getComputedStyle(popover);
          const titleStyle = getComputedStyle(title);
          const colorProbe = document.createElement("span");
          colorProbe.style.color = "var(--qp-text-primary)";
          document.body.append(colorProbe);
          const expectedTitleColor = getComputedStyle(colorProbe).color;
          colorProbe.remove();
          const titleRect = title.getBoundingClientRect();
          const urlRect = url.getBoundingClientRect();
          const popoverRect = popover.getBoundingClientRect();
          const triggerRect = trigger?.getBoundingClientRect();
          const anchorCenter = triggerRect
            ? triggerRect.left + triggerRect.width / 2
            : 0;
          return JSON.stringify({
            title: title.textContent?.trim() ?? "",
            url: url.textContent?.trim() ?? "",
            titleAboveUrl: titleRect.bottom <= urlRect.top + 1,
            titleColorMatches: titleStyle.color === expectedTitleColor,
            titleFontSize: titleStyle.fontSize,
            titleFontWeight: titleStyle.fontWeight,
            width: popoverRect.width,
            left: popoverRect.left,
            anchorCenter,
            viewportWidth: window.innerWidth,
            leftShare: (anchorCenter - popoverRect.left) / popoverRect.width,
            rowHeight: row.getBoundingClientRect().height,
            position: style.position,
            parentIsBody: popover.parentElement === document.body,
          });
        })()
      `,
    ))) as {
      title: string;
      url: string;
      titleAboveUrl: boolean;
      titleColorMatches: boolean;
      titleFontSize: string;
      titleFontWeight: string;
      width: number;
      left: number;
      anchorCenter: number;
      viewportWidth: number;
      leftShare: number;
      rowHeight: number;
      position: string;
      parentIsBody: boolean;
    };
    assert.ok(webTitlePopoverPresentation);
    assert.ok(webTitlePopoverPresentation.title.length > 0);
    assert.ok(webTitlePopoverPresentation.url.length > 0);
    assert.equal(webTitlePopoverPresentation.titleAboveUrl, true);
    assert.equal(webTitlePopoverPresentation.titleColorMatches, true);
    assert.equal(webTitlePopoverPresentation.titleFontSize, "11px");
    assert.equal(webTitlePopoverPresentation.titleFontWeight, "620");
    assert.ok(Math.abs(webTitlePopoverPresentation.width - 568) < 1);
    const expectedPopoverLeft = Math.max(
      12,
      Math.min(
        webTitlePopoverPresentation.anchorCenter
          - webTitlePopoverPresentation.width * 0.25,
        webTitlePopoverPresentation.viewportWidth
          - webTitlePopoverPresentation.width
          - 12,
      ),
    );
    assert.ok(
      Math.abs(webTitlePopoverPresentation.left - expectedPopoverLeft) < 1,
      "web title details should keep one quarter of the popover before its anchor, unless clamped to the viewport",
    );
    const isHorizontallyClamped = Math.abs(
      expectedPopoverLeft
        - (
          webTitlePopoverPresentation.anchorCenter
          - webTitlePopoverPresentation.width * 0.25
        ),
    ) >= 1;
    if (!isHorizontallyClamped) {
      assert.ok(Math.abs(webTitlePopoverPresentation.leftShare - 0.25) < 0.02);
    }
    assert.ok(
      Math.abs(
        webTitlePopoverPresentation.rowHeight
          - webTitlePopoverContract.rowHeight,
      ) < 1,
    );
    assert.equal(webTitlePopoverPresentation.position, "fixed");
    assert.equal(webTitlePopoverPresentation.parentIsBody, true);
    await evaluate(
      client!,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".destination-detail-record-popover")
        && Boolean(document.querySelector(".destination-detail-dialog"))`,
      45_000,
      "close web title details popover",
    );
    await evaluate(
      client!,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".destination-detail-dialog")`,
    );
    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "应用趋势"`,
      45_000,
      "restore app destination mode",
    );
    await evaluate(
      client!,
      sessionId,
      `delete globalThis.__TIME_TRACKER_ENABLE_DATA_WEB_DETAIL_FIXTURE`,
    );
  });

  await runTest("data heatmap failures settle explicitly and remain retryable", async () => {
    await evaluate(
      client!,
      sessionId,
      `localStorage.setItem("__time_tracker_reject_heatmap_query", "1")`,
    );
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="数据"]'))`,
      45_000,
    );
    await evaluate(
      client!,
      sessionId,
      `document.querySelector('[aria-label="数据"]')?.click()`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-overview .data-heatmap-panel [role=status]")
        ?.textContent?.includes("热力图暂时不可用")
        && document.querySelector("[data-data-content-state]")
          ?.getAttribute("data-data-content-state") === "complete"`,
      45_000,
      "activity heatmap cold error",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `Boolean(document.querySelector(".data-overview .data-heatmap-panel [role=status] button"))
          && !document.querySelector(".data-overview .data-heatmap-loading-state")
          && document.querySelector("[data-data-content-state]")
            ?.getAttribute("data-data-content-state") === "complete"`,
      ),
      true,
    );

    await evaluate(client!, sessionId, `
      (() => {
        localStorage.removeItem("__time_tracker_reject_heatmap_query");
        document.querySelector(".data-overview .data-heatmap-panel [role=status] button")?.focus();
      })()
    `);
    await client!.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId);
    await client!.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".data-overview .data-heatmap-weeks"))
        && !document.querySelector(".data-overview .data-heatmap-panel [role=status]")
        && !document.querySelector(".data-overview .data-heatmap-loading-state")`,
      45_000,
      "activity heatmap retry success",
    );
    assert.equal(await evaluate(client!, sessionId, `document.activeElement?.matches('.data-overview .data-heatmap-range-control button:not(:disabled), .data-overview .data-heatmap-panel')`), true,
      "cold heatmap keyboard retry must retain a focus target in the same panel");

    const destinationRetry = await evaluate(client!, sessionId, `
      (() => {
        const retry = document.querySelector(
          ".data-app-panel .data-heatmap-panel [role=status] button",
        );
        retry?.click();
        return Boolean(retry);
      })()
    `);
    if (destinationRetry) {
      await waitForExpression(
        client!,
        sessionId,
        `Boolean(document.querySelector(".data-app-panel .data-heatmap-weeks"))
          && !document.querySelector(".data-app-panel .data-heatmap-panel [role=status]")`,
        45_000,
        "destination heatmap retry success",
      );
    }
  });

  await runTest("data web trend failures preserve trustworthy content and remain retryable", async () => {
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="数据"]'))`,
      45_000,
    );
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 0;
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = true;
        globalThis.__PATINA_INVOKED_COMMANDS = [];
        document.querySelector('[aria-label="数据"]')?.click();
      })()
    `);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-app-panel"))`);
    await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "网页")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-web-error")?.textContent?.includes("网页分析暂时不可用")`,
      45_000,
      "blocking web trend error",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `Boolean(document.querySelector(".data-web-error button"))`,
      ),
      true,
    );
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = false;
        document.querySelector(".data-web-error button")?.click();
      })()
    `);
    try {
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector('[aria-label="网页列表"]')?.textContent?.includes("docs.example.com")`,
        45_000,
        "web trend retry success",
      );
    } catch (error) {
      const retryState = await evaluate(client!, sessionId, `JSON.stringify({
        failure: globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE,
        commands: globalThis.__PATINA_INVOKED_COMMANDS,
        panelText: document.querySelector(".data-app-panel")?.textContent ?? null,
      })`);
      throw new Error(`Web trend retry state: ${String(retryState)}`, { cause: error });
    }
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="网页列表"]'))
        && Boolean(document.querySelector(".data-app-chart"))
        && document.querySelectorAll(".data-app-metric").length === 4
        && document.querySelector(".data-app-grid")?.getAttribute("aria-busy") === "false"`,
      45_000,
      "web trend retry presentation commit",
    );

    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = true;
        const next = document.querySelector(
          ".data-app-panel .data-trend-range-control .qp-range-control-arrow:last-child",
        );
        next?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-refresh-status")?.textContent?.includes(${jsonString(COPY["zh-CN"].common.refreshFailed)})`,
      45_000,
      "non-blocking web trend refresh error",
    );
    assert.deepEqual(
      JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify({
          hasList: Boolean(document.querySelector('[aria-label="网页列表"]')),
          hasChart: Boolean(document.querySelector(".data-app-chart")),
          hasMetrics: document.querySelectorAll(".data-app-metric").length === 4,
          busy: document.querySelector(".data-app-grid")?.getAttribute("aria-busy"),
        })
      `))),
      {
        hasList: true,
        hasChart: true,
        hasMetrics: true,
        busy: "false",
      },
    );
    const webCommandsBeforeRefreshRetry = Number(await evaluate(
      client!,
      sessionId,
      `globalThis.__PATINA_INVOKED_COMMANDS
        .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length`,
    ));
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = false;
        const retry = Array.from(document.querySelectorAll(".data-app-refresh-status button"))
          .find((node) => node.textContent?.trim() === "重试");
        if (!(retry instanceof HTMLButtonElement)) return false;
        retry.click();
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `globalThis.__PATINA_INVOKED_COMMANDS
        .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length
        > ${webCommandsBeforeRefreshRetry}`,
      45_000,
      "web trend refresh retry request",
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".data-app-refresh-status")?.textContent?.includes(${jsonString(COPY["zh-CN"].common.refreshFailed)})
        && document.querySelector(".data-app-grid")?.getAttribute("aria-busy") === "false"`,
      45_000,
      "web trend refresh retry success",
    );
    await evaluate(client!, sessionId, `
      (() => {
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS = 0;
        globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE = false;
        const group = document.querySelector('[aria-label="选择时间去向类型"]');
        Array.from(group?.querySelectorAll("button") ?? [])
          .find((node) => node.textContent?.trim() === "应用")?.click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "应用趋势"`,
    );
  });

  await runTest("data removes every web control and web read when Web Sync is disabled", async () => {
    await evaluate(client!, sessionId, `
      (() => {
        const key = "__time_tracker_smoke_settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        settings.web_activity_enabled = "0";
        localStorage.setItem(key, JSON.stringify(settings));
        globalThis.__PATINA_INVOKED_COMMANDS = [];
        globalThis.__PATINA_RELOAD_MARKER = true;
      })()
    `);
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `!globalThis.__PATINA_RELOAD_MARKER && Boolean(document.querySelector('[aria-label="数据"]'))`,
      45_000,
    );
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="数据"]')?.click()`);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-app-panel"))`, 45_000);
    const webSyncDisabledState = JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify({
          modeControl: Boolean(document.querySelector('[aria-label="选择时间去向类型"]')),
          webText: document.querySelector(".data-app-panel")?.textContent?.includes("网页趋势") ?? false,
          headingOrder: Array.from(
            document.querySelector(".data-app-panel-heading")?.children ?? [],
          ).map((node) => (
            node.tagName === "H3"
              ? "title"
              : node.classList.contains("data-destination-mode")
                ? "mode"
              : node.classList.contains("data-app-selected-status")
                ? "selected"
                : node.classList.contains("data-app-refresh-status")
                  ? "status"
                  : "unknown"
          )),
          webCommandCount: globalThis.__PATINA_INVOKED_COMMANDS
            .filter((entry) => entry.command === "cmd_get_web_activity_aggregate_range").length,
        })
      `))) as {
        modeControl: boolean;
        webText: boolean;
        headingOrder: string[];
        webCommandCount: number;
      };
    assert.equal(webSyncDisabledState.modeControl, true);
    assert.equal(webSyncDisabledState.webText, false);
    assert.equal(webSyncDisabledState.webCommandCount, 0);
    assert.ok(
      JSON.stringify(webSyncDisabledState.headingOrder) === JSON.stringify(["title", "mode"])
        || JSON.stringify(webSyncDisabledState.headingOrder) === JSON.stringify(["title", "mode", "selected"]),
      "app and category mode control must remain before selected icons when Web Sync is disabled",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        Array.from(document.querySelector('[aria-label="选择时间去向类型"]')?.querySelectorAll("button") ?? [])
          .map((node) => node.textContent?.trim())
      `),
      ["应用", "分类"],
    );

    await evaluate(client!, sessionId, `
      (() => {
        const key = "__time_tracker_smoke_settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        settings.web_activity_enabled = "1";
        localStorage.setItem(key, JSON.stringify(settings));
        globalThis.__PATINA_RELOAD_MARKER = true;
      })()
    `);
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `!globalThis.__PATINA_RELOAD_MARKER && Boolean(document.querySelector('[aria-label="数据"]'))`,
      45_000,
    );
  });

  await runTest("data combines activity trend and annual heatmap without coupling their controls", async () => {
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="数据"]')?.click()`);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-dashboard-grid"))`, 45_000);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-heatmap-panel-compact"))`, 45_000);
    const layouts: Array<{
      width: number;
      pageOverflows: boolean;
      firstTop: number;
      firstLeft: number;
      firstHeight: number;
      topScrollInset: number;
      secondTop: number;
      secondLeft: number;
      secondHeight: number;
      bottomScrollInset: number;
      directChildren: number;
      panelOrder: string[];
      overviewSectionOrder: string[];
      heatmapTop: number;
      trendTop: number;
      heatmapHasOwnRange: boolean;
      trendHasOwnRange: boolean;
      overviewHeatmapHasSubtitle: boolean;
      destinationSidebarLeft: number;
      destinationSidebarTop: number;
      destinationSidebarBottom: number;
      destinationListBottom: number;
      destinationAnalysisLeft: number;
      destinationAnalysisTop: number;
      destinationAnalysisWidth: number;
      destinationChartBottom: number;
      destinationChartHeight: number;
      destinationChartWidth: number;
      destinationChartViewBoxHeight: number;
      destinationChartViewBoxWidth: number;
      destinationHeatmapTop: number;
      destinationHeatmapCells: number;
    }> = [];
    for (const width of [2048, 1366, 900, 390]) {
      await client!.command("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
      await waitForExpression(client!, sessionId, `window.innerWidth === ${width}`);
      await waitForAnimationFrames(client!, sessionId);
      await waitForStableExpression(
        client!,
        sessionId,
        `
          (() => {
            const dataRoot = document.querySelector('[data-data-content-state="complete"]');
            const sidebar = document
              .querySelector(".data-app-panel .data-app-sidebar")
              ?.getBoundingClientRect();
            const list = document
              .querySelector(".data-app-panel .data-app-trend-list")
              ?.getBoundingClientRect();
            return Boolean(
              dataRoot
              && sidebar
              && list
              && Math.abs(sidebar.bottom - list.bottom - 24) <= 1
            );
          })()
        `,
        45_000,
        `data destination sidebar stable final geometry at ${width}px`,
        8,
      );
      layouts.push(JSON.parse(String(await evaluate(client!, sessionId, `
        (() => {
          const grid = document.querySelector(".data-dashboard-grid");
          const children = grid ? Array.from(grid.children) : [];
          const first = children[0]?.getBoundingClientRect();
          const second = children[1]?.getBoundingClientRect();
          const overview = grid?.querySelector(".data-overview");
          const overviewSections = overview ? Array.from(overview.children) : [];
          const trend = overview?.querySelector(".data-trend-panel");
          const heatmap = overview?.querySelector(".data-heatmap-panel");
          const destinationSidebar = grid?.querySelector(".data-app-panel .data-app-sidebar")?.getBoundingClientRect();
          const destinationList = grid?.querySelector(".data-app-panel .data-app-trend-list")?.getBoundingClientRect();
          const destinationAnalysis = grid?.querySelector(".data-app-panel .data-app-chart-column")?.getBoundingClientRect();
          const destinationChart = grid?.querySelector(".data-app-panel .data-app-chart")?.getBoundingClientRect();
          const destinationChartSvg = grid?.querySelector(
            ".data-app-panel .data-app-chart svg",
          );
          const destinationHeatmap = grid?.querySelector(".data-app-panel .data-heatmap-panel-compact");
          const scrollOwner = document.querySelector(".data-page-scroll");
          let topScrollInset = -1;
          let bottomScrollInset = -1;
          if (scrollOwner instanceof HTMLElement && children.length >= 2) {
            const previousScrollTop = scrollOwner.scrollTop;
            scrollOwner.scrollTop = 0;
            topScrollInset = children[0].getBoundingClientRect().top
              - scrollOwner.getBoundingClientRect().top;
            scrollOwner.scrollTop = scrollOwner.scrollHeight;
            bottomScrollInset = children[1].getBoundingClientRect().top
              - scrollOwner.getBoundingClientRect().top;
            scrollOwner.scrollTop = previousScrollTop;
          }
          return JSON.stringify({
            width: window.innerWidth,
            pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            firstTop: first?.top ?? -1,
            firstLeft: first?.left ?? -1,
            firstHeight: first?.height ?? -1,
            topScrollInset,
            secondTop: second?.top ?? -1,
            secondLeft: second?.left ?? -1,
            secondHeight: second?.height ?? -1,
            bottomScrollInset,
            directChildren: children.length,
            panelOrder: children.map((node) => (
              node.classList.contains("data-overview")
                ? "overview"
                : node.classList.contains("data-app-panel")
                  ? "destination"
                  : "unknown"
            )),
            overviewSectionOrder: overviewSections.map((node) => (
              node.classList.contains("data-trend-panel")
                ? "trend"
                : node.classList.contains("data-heatmap-panel")
                  ? "heatmap"
                  : "unknown"
            )),
            trendTop: trend?.getBoundingClientRect().top ?? -1,
            heatmapTop: heatmap?.getBoundingClientRect().top ?? -1,
            trendHasOwnRange: Boolean(trend?.querySelector(".data-trend-range-trigger")),
            heatmapHasOwnRange: Boolean(heatmap?.querySelector(".data-heatmap-range-control")),
            overviewHeatmapHasSubtitle: Boolean(heatmap?.querySelector("p")),
            destinationSidebarLeft: destinationSidebar?.left ?? -1,
            destinationSidebarTop: destinationSidebar?.top ?? -1,
            destinationSidebarBottom: destinationSidebar?.bottom ?? -1,
            destinationListBottom: destinationList?.bottom ?? -1,
            destinationAnalysisLeft: destinationAnalysis?.left ?? -1,
            destinationAnalysisTop: destinationAnalysis?.top ?? -1,
            destinationAnalysisWidth: destinationAnalysis?.width ?? -1,
            destinationChartBottom: destinationChart?.bottom ?? -1,
            destinationChartHeight: destinationChart?.height ?? -1,
            destinationChartWidth: destinationChart?.width ?? -1,
            destinationChartViewBoxHeight: destinationChartSvg?.viewBox.baseVal.height ?? -1,
            destinationChartViewBoxWidth: destinationChartSvg?.viewBox.baseVal.width ?? -1,
            destinationHeatmapTop: destinationHeatmap?.getBoundingClientRect().top ?? -1,
            destinationHeatmapCells: destinationHeatmap?.querySelectorAll(".data-heatmap-cell").length ?? 0,
          });
        })()
      `))));
    }

    assert.deepEqual(layouts.map((layout) => layout.directChildren), [2, 2, 2, 2]);
    assert.deepEqual(
      layouts.map((layout) => layout.panelOrder),
      Array.from({ length: 4 }, () => ["overview", "destination"]),
    );
    assert.deepEqual(
      layouts.map((layout) => layout.overviewSectionOrder),
      Array.from({ length: 4 }, () => ["trend", "heatmap"]),
    );
    assert.ok(layouts.every((layout) => layout.trendHasOwnRange));
    assert.ok(layouts.every((layout) => layout.heatmapHasOwnRange));
    assert.ok(layouts.every((layout) => !layout.overviewHeatmapHasSubtitle));
    assert.ok(layouts.every((layout) => layout.destinationHeatmapCells > 0));
    assert.ok(layouts.every((layout) => layout.destinationHeatmapTop > layout.destinationChartBottom));
    const destinationSidebarGaps = layouts.map((layout) => ({
      width: layout.width,
      gap: layout.destinationSidebarBottom - layout.destinationListBottom,
    }));
    assert.ok(layouts.every((layout) => (
      Math.abs(layout.destinationSidebarBottom - layout.destinationListBottom - 24) <= 1
    )), `destination sidebar footer gap must be 24px; observed ${JSON.stringify(destinationSidebarGaps)}`);
    assert.deepEqual(layouts.map((layout) => layout.pageOverflows), [false, false, false, false]);
    assert.ok(Math.abs(layouts[0].firstTop - layouts[0].secondTop) <= 1);
    assert.ok(layouts[0].secondLeft > layouts[0].firstLeft);
    assert.ok(layouts[0].heatmapTop > layouts[0].trendTop);
    assert.ok(
      Math.abs(layouts[1].firstHeight - layouts[1].secondHeight) <= 1,
      `stacked Data panels should share one height by adapting only the destination chart; observed ${JSON.stringify(layouts[1])}`,
    );
    assert.ok(layouts[1].destinationChartHeight > 1);
    assert.ok(
      Math.abs(layouts[1].destinationAnalysisWidth - layouts[1].destinationChartWidth) <= 1,
      `adapting destination height must preserve the full chart width; observed ${JSON.stringify(layouts[1])}`,
    );
    assert.ok(
      Math.abs(layouts[1].destinationChartHeight - layouts[1].destinationChartViewBoxHeight) <= 1
        && Math.abs(layouts[1].destinationChartWidth - layouts[1].destinationChartViewBoxWidth) <= 1,
      `destination chart viewBox must track both rendered dimensions; observed ${JSON.stringify(layouts[1])}`,
    );
    assert.ok(
      Math.abs(layouts[1].topScrollInset - layouts[1].bottomScrollInset) <= 1,
      `stacked Data panels should keep the same header inset at both scroll limits; observed ${JSON.stringify(layouts[1])}`,
    );
    for (const layout of layouts.slice(0, 2)) {
      assert.ok(layout.destinationAnalysisLeft > layout.destinationSidebarLeft);
      assert.ok(Math.abs(layout.destinationAnalysisTop - layout.destinationSidebarTop) <= 1);
    }
    for (const layout of layouts.slice(1)) {
      assert.ok(layout.secondTop > layout.firstTop);
      assert.ok(Math.abs(layout.secondLeft - layout.firstLeft) <= 1);
      assert.ok(layout.heatmapTop > layout.trendTop);
    }
    for (const layout of layouts.slice(2)) {
      assert.ok(layout.destinationAnalysisTop > layout.destinationSidebarTop);
      assert.ok(Math.abs(layout.destinationAnalysisLeft - layout.destinationSidebarLeft) <= 1);
    }
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
  });

  await runTest("data web analysis stays readable in English dark mode and restores locale state", async () => {
    await evaluate(client!, sessionId, `
      (() => {
        const key = "__time_tracker_smoke_settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        settings.language = "en-US";
        settings.theme_mode = "dark";
        settings.web_activity_enabled = "1";
        localStorage.setItem(key, JSON.stringify(settings));
        globalThis.__PATINA_RELOAD_MARKER = true;
      })()
    `);
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `!globalThis.__PATINA_RELOAD_MARKER && Boolean(document.querySelector('[aria-label="Data"]'))`,
      45_000,
    );
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 900,
      deviceScaleFactor: 1.5,
      mobile: false,
    }, sessionId);
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="Data"]')?.click()`);
    await waitForExpression(client!, sessionId, `document.body.innerText.includes("Browse long-term trends")`);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="Select time destination type"]'))`,
      45_000,
      "destination panel is ready before switching to web mode",
    );
    await evaluate(client!, sessionId, `
      Array.from(document.querySelectorAll('[aria-label="Select time destination type"] button'))
        .find((node) => node.textContent?.trim() === "Web")?.click()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".data-app-panel h3")?.textContent?.trim() === "Web Trends"`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[aria-label="Website list"]'))`,
    );
    assert.deepEqual(
      JSON.parse(String(await evaluate(client!, sessionId, `
        JSON.stringify({
          theme: document.documentElement.dataset.theme,
          overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          hasScope: Boolean(document.querySelector('[aria-label="Select heatmap item"]')),
          hasWebsiteList: Boolean(document.querySelector('[aria-label="Website list"]')),
        })
      `))),
      {
        theme: "dark",
        overflows: false,
        hasScope: false,
        hasWebsiteList: true,
      },
    );
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const target = document.querySelector('[aria-label="Website list"] button');
        if (!(target instanceof HTMLButtonElement)) return false;
        target.focus();
        target.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }));
        return true;
      })()
    `), true);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".destination-detail-timeline-track"))`,
      45_000,
      "English dark detail dialog",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const surface = document.querySelector(".destination-detail-dialog");
          if (!surface) return null;
          const rect = surface.getBoundingClientRect();
          return {
            theme: document.documentElement.dataset.theme,
            horizontalOverflow: surface.scrollWidth > surface.clientWidth,
            insideViewport: rect.left >= 0 && rect.right <= innerWidth,
            hasHeatmap: Boolean(surface.querySelector(".data-heatmap-panel")),
            hasTrend: Boolean(surface.querySelector(".destination-detail-chart")),
            hasSummary: Boolean(surface.querySelector(
              ".destination-detail-summary",
            )),
            hasDescription: Boolean(surface.querySelector(".qp-dialog-description")),
          };
        })()
      `),
      {
        theme: "dark",
        horizontalOverflow: false,
        insideViewport: true,
        hasHeatmap: false,
        hasTrend: false,
        hasSummary: false,
        hasDescription: false,
      },
      "the detail pilot should stay readable in English dark mode at 150% DPR",
    );
    await evaluate(
      client!,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".destination-detail-dialog")`,
    );

    await evaluate(client!, sessionId, `
      (() => {
        const key = "__time_tracker_smoke_settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        settings.language = "zh-CN";
        settings.theme_mode = "light";
        localStorage.setItem(key, JSON.stringify(settings));
        globalThis.__PATINA_RELOAD_MARKER = true;
      })()
    `);
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `!globalThis.__PATINA_RELOAD_MARKER && Boolean(document.querySelector('[aria-label="数据"]'))`,
      45_000,
    );
  });

  if (options.continuityOnly) return;

  await runTest("data trend chart renders the shared tooltip on real hover", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
          if (!node) return false;
          node.click();
          window.scrollTo(0, 0);
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".data-trend-chart .qp-native-trend-dot"))`,
      45_000,
      "data trend chart point",
    );
    const chartPoint = await evaluate(client!, sessionId, `
      (() => {
        const dots = Array.from(document.querySelectorAll(".data-trend-chart .qp-native-trend-dot"));
        const dot = dots.find((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
        });
        if (!dot) return null;
        const rect = dot.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()
    `) as { x: number; y: number } | null;
    assert.ok(chartPoint);
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: chartPoint.x,
      y: chartPoint.y,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        if (document.querySelector('.qp-chart-tooltip[role="tooltip"]')) return true;
        const dot = Array.from(document.querySelectorAll(".data-trend-chart .qp-native-trend-dot")).find((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
        });
        if (!dot) return false;
        const rect = dot.getBoundingClientRect();
        dot.dispatchEvent(new MouseEvent("mousemove", {
          bubbles: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
        return false;
      })()`,
      undefined,
      "shared chart tooltip",
    );
    const tooltipState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const tooltip = document.querySelector('.qp-chart-tooltip[role="tooltip"]');
        const label = tooltip?.querySelector('.qp-chart-tooltip-label');
        const name = tooltip?.querySelector('.qp-chart-tooltip-name');
        if (!(tooltip instanceof HTMLElement)) return JSON.stringify(null);
        const rect = tooltip.getBoundingClientRect();
        const style = getComputedStyle(tooltip);
        return JSON.stringify({
          text: tooltip.textContent?.trim() ?? "",
          borderRadius: style.borderRadius,
          left: rect.left,
          maxWidth: style.maxWidth,
          right: rect.right,
          withinViewport: rect.left >= -0.5
            && rect.top >= -0.5
            && rect.right <= window.innerWidth + 0.5
            && rect.bottom <= window.innerHeight + 0.5,
          labelOverflow: label ? getComputedStyle(label).textOverflow : null,
          nameOverflow: name ? getComputedStyle(name).textOverflow : null,
        });
      })()
    `))) as {
      text: string;
      borderRadius: string;
      left: number;
      maxWidth: string;
      right: number;
      withinViewport: boolean;
      labelOverflow: string | null;
      nameOverflow: string | null;
    } | null;
    assert.ok(tooltipState?.text);
    assert.equal(tooltipState.borderRadius, "10px");
    assert.notEqual(tooltipState.maxWidth, "none");
    assert.equal(tooltipState.withinViewport, true);
    assert.equal(
      tooltipState.left >= chartPoint.x + 8 || tooltipState.right <= chartPoint.x - 8,
      true,
      "trend tooltip should stay beside the active point instead of covering it",
    );
    assert.equal(tooltipState.labelOverflow, "ellipsis");
    assert.equal(tooltipState.nameOverflow, "ellipsis");
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 1,
      y: 1,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('.qp-chart-tooltip[role="tooltip"]').length === 0`,
    );
  });

  await runTest("data heatmap shows one delegated tooltip on hover", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    const openedData = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(openedData, true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    const yesterdayKey = await evaluate(client!, sessionId, `
      (() => {
        const date = new Date();
        date.setDate(date.getDate() - 1);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day;
      })()
    `) as string;
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + '][data-heatmap-tooltip]'))`,
      45_000,
    );
    const tooltipTarget = await evaluate(client!, sessionId, `
      (() => {
        const cell = document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + '][data-heatmap-tooltip]');
        if (!cell) return null;
        const label = cell.getAttribute("data-heatmap-tooltip") ?? "";
        const rect = cell.getBoundingClientRect();
        return { label, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()
    `) as { label: string; x: number; y: number } | null;
    assert.ok(tooltipTarget?.label);
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: tooltipTarget.x,
      y: tooltipTarget.y,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        const tooltips = document.querySelectorAll('.qp-tooltip[role="tooltip"]');
        if (tooltips.length === 1 && tooltips[0]?.textContent === ${jsonString(tooltipTarget.label)}) {
          return true;
        }
        const cell = document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + '][data-heatmap-tooltip]');
        cell?.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          cancelable: true,
          pointerType: "mouse",
        }));
        return false;
      })()`,
    );
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 1,
      y: 1,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('.qp-tooltip[role="tooltip"]').length === 0`,
    );
  });

  await runTest("data heatmap exposes one keyboard grid entry and opens the focused day", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
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
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    const dates = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const key = (delta) => {
          const date = new Date();
          date.setDate(date.getDate() + delta);
          return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
          ].join("-");
        };
        return JSON.stringify({ start: key(-8), expected: key(-1) });
      })()
    `))) as { start: string; expected: string };
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[data-heatmap-date=' + ${jsonString(JSON.stringify(dates.start))} + ']'))`,
      45_000,
    );
    const entryState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const grid = document.querySelector('.data-heatmap-weeks[role="grid"]');
        const start = document.querySelector('[data-heatmap-date=' + ${jsonString(JSON.stringify(dates.start))} + ']');
        if (!(grid instanceof HTMLElement) || !(start instanceof HTMLElement)) return JSON.stringify(null);
        start.focus();
        return JSON.stringify({
          rowCount: grid.querySelectorAll(':scope > [role="row"]').length,
          tabStopCount: grid.querySelectorAll('[data-heatmap-date][tabindex="0"]').length,
          activeDate: document.activeElement?.getAttribute('data-heatmap-date') ?? null,
          accessibleLabel: start.getAttribute('aria-label'),
          keyShortcuts: start.getAttribute('aria-keyshortcuts'),
        });
      })()
    `))) as {
      rowCount: number;
      tabStopCount: number;
      activeDate: string | null;
      accessibleLabel: string | null;
      keyShortcuts: string | null;
    };
    assert.equal(entryState.rowCount, 7);
    assert.equal(entryState.tabStopCount, 1);
    assert.equal(entryState.activeDate, dates.start);
    assert.equal(entryState.keyShortcuts, "Enter Space");
    assert.ok(entryState.accessibleLabel?.includes(dates.start));
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('.qp-tooltip[role="tooltip"]').length === 1`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const active = document.activeElement;
          if (!(active instanceof HTMLElement)) return false;
          active.dispatchEvent(new KeyboardEvent("keydown", {
            key: "ArrowRight",
            bubbles: true,
            cancelable: true,
          }));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.getAttribute('data-heatmap-date') === ${jsonString(dates.expected)}`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelectorAll('.data-overview .data-heatmap-weeks [data-heatmap-date][tabindex="0"]').length`,
      ),
      1,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    }, sessionId);
    assert.equal(
      await evaluate(client!, sessionId, `document.activeElement?.classList.contains("data-heatmap-cell") ?? false`),
      false,
      "Tab should leave the composite heatmap",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('.qp-tooltip[role="tooltip"]').length === 0`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const cell = document.querySelector('[data-heatmap-date=' + ${jsonString(JSON.stringify(dates.expected))} + ']');
          if (!(cell instanceof HTMLElement)) return false;
          cell.focus();
          cell.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
  });

  await runTest("data heatmap opens the selected day in history", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    const openedData = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(openedData, true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    const yesterdayKey = await evaluate(client!, sessionId, `
      (() => {
        const date = new Date();
        date.setDate(date.getDate() - 1);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day;
      })()
    `) as string;
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + ']'))`,
      45_000,
    );
    const openedHistory = await evaluate(client!, sessionId, `
      (() => {
        const cell = document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + ']');
        if (!cell) return false;
        cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
        return true;
      })()
    `);
    assert.equal(openedHistory, true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(COPY["zh-CN"].date.yesterday)})`,
    );
  });
}
