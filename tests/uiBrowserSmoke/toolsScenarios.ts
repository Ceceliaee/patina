import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLocaleText, loadLocaleText } from "../../src/shared/i18n/runtime.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { delay, evaluate, jsonString, waitForExpression } from "./browserHarness.ts";
import { TOOLS_TEXT } from "./constants.ts";
import { runTimedReminderScenarios } from "./timedReminderScenarios.ts";
import { runUsageAlertScenarios } from "./usageAlertScenarios.ts";
import { runRecurringReminderScenarios } from "./recurringReminderScenarios.ts";
import { pomodoroFixture, runPomodoroScenarios } from "./pomodoroScenarios.ts";
import { runPomodoroAlertScenarios } from "./pomodoroAlertScenarios.ts";
import { runFreeFocusScenarios } from "./freeFocusScenarios.ts";
import { runToolNotificationScenarios } from "./toolNotificationScenarios.ts";

const COPY = { "zh-CN": getLocaleText("zh-CN") } as const;

export async function runToolsScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;
  await runToolNotificationScenarios(context);
  await runUsageAlertScenarios(context);
  await runTimedReminderScenarios(context);
  await runRecurringReminderScenarios(context);
  await runPomodoroScenarios(context);
  await runPomodoroAlertScenarios(context);
  await runFreeFocusScenarios(context);

  await runTest("Tools pending mutation discourages repeated writes and recovers from a runtime event", async () => {
    const originalStorage = String(await evaluate(client!, sessionId, `JSON.stringify({ ...localStorage })`));
    try {
      await evaluate(client!, sessionId, `
        localStorage.clear();
        localStorage.setItem("__time_tracker_smoke_settings", JSON.stringify({ language: "zh-CN" }));
        localStorage.setItem("patina:last-active-view", "tools");
        localStorage.setItem("patina:tools-section", "pomodoro");
        localStorage.setItem("__time_tracker_tools_snapshot_override", JSON.stringify(${JSON.stringify(pomodoroFixture())}));
        document.documentElement.dataset.patinaSmokeReload = "tools-action-recovery";
        location.reload();
      `);
      const startSelector = `[aria-label=${JSON.stringify(COPY["zh-CN"].accessibility.tools.startPomodoro)}]`;
      const pauseSelector = `[aria-label=${JSON.stringify(COPY["zh-CN"].accessibility.tools.pausePomodoro)}]`;
      await waitForExpression(client!, sessionId, `
        document.documentElement.dataset.patinaSmokeReload !== "tools-action-recovery"
          && Boolean(document.querySelector(${jsonString(startSelector)}))
      `);
      await evaluate(client!, sessionId, `
        (() => {
          globalThis.__PATINA_TOOLS_ACTION_CASE = {
            error: "TOOLS_STATE_REFRESH_PENDING: private database reconciliation detail",
            calls: [],
          };
          document.querySelector(${jsonString(startSelector)}).focus();
        })()
      `);
      await client!.command("Input.dispatchKeyEvent", {
        type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r",
        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      }, sessionId);
      await client!.command("Input.dispatchKeyEvent", {
        type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
      }, sessionId);
      await waitForExpression(client!, sessionId, `
        globalThis.__PATINA_TOOLS_ACTION_CASE.calls.length === 1
          && Boolean(document.querySelector('.qp-toast[role="alert"]'))
      `, 10_000, "keyboard start must reach the gateway and present its failure");
      assert.equal(await evaluate(client!, sessionId, `
        document.querySelector('.qp-toast[role="alert"] .qp-toast-message')?.textContent
      `), COPY["zh-CN"].tools.stateRefreshPending, "a pending Tools mutation must not invite another write");
      assert.deepEqual(await evaluate(client!, sessionId, `({
        calls: globalThis.__PATINA_TOOLS_ACTION_CASE.calls,
        retryAdvice: document.body.innerText.includes(${jsonString(COPY["zh-CN"].tools.actionFailed)}),
        diagnostic: document.body.innerText.includes("private database reconciliation detail"),
        hasStart: Boolean(document.querySelector(${jsonString(startSelector)})),
        hasPause: Boolean(document.querySelector(${jsonString(pauseSelector)})),
      })`), { calls: ["cmd_pomodoro_task"], retryAdvice: false, diagnostic: false, hasStart: true, hasPause: false });
      await evaluate(client!, sessionId, `
        (() => {
          const now = Date.now();
          const snapshot = {
            settings: {
              pomodoro_focus_minutes: 25,
              pomodoro_short_break_minutes: 5, pomodoro_long_break_minutes: 15, pomodoro_long_break_every: 4,
            },
            reminders: [], activity_reminder_rules: [], free_focus_tasks: [], pomodoro_tasks: [], current_pomodoro: {
              id: 42, phase: "focus", status: "running", cycle_index: 1,
              focus_ms: 1500000, short_break_ms: 300000, long_break_ms: 900000,
              long_break_every: 4, phase_started_at: now, phase_paused_at: null,
              phase_remaining_ms: null, completed_focus_count: 0, created_at: now, updated_at: now,
            },
            today_completed_pomodoros: 0, next_reminder_at: null, sampled_at_ms: now + 1000,
          };
          snapshot.pomodoro_tasks = [{ label: "Reading", completed_groups: 0, run: snapshot.current_pomodoro }];
          globalThis.__PATINA_EMIT_TAURI_EVENT("tools-runtime-changed", snapshot);
        })()
      `);
      await waitForExpression(client!, sessionId, `
        Boolean(document.querySelector(${jsonString(pauseSelector)}))
          && !document.querySelector(${jsonString(startSelector)})
          && document.querySelector('.tools-pomodoro-task-time > span')?.textContent === ${jsonString(COPY["zh-CN"].tools.pomodoroPhase.focus)}
      `, 10_000, "the backend reconciliation event must restore the actual running Pomodoro");
      await evaluate(client!, sessionId, `
        globalThis.__PATINA_TOOLS_ACTION_CASE.error = "ordinary database write failed";
        document.querySelector(${jsonString(pauseSelector)}).click();
      `);
      await waitForExpression(client!, sessionId, `
        [...document.querySelectorAll('.qp-toast[role="alert"]')]
          .some((node) => node.textContent.includes(${jsonString(COPY["zh-CN"].tools.actionFailed)}))
      `, 10_000, "ordinary Tools write failure must retain the existing retry advice");
      assert.deepEqual(await evaluate(client!, sessionId, `({
        calls: globalThis.__PATINA_TOOLS_ACTION_CASE.calls,
        running: document.querySelector('.tools-pomodoro-task-time > span')?.textContent,
        diagnostic: document.body.innerText.includes("ordinary database write failed"),
      })`), { calls: ["cmd_pomodoro_task", "cmd_pomodoro_task"], running: COPY["zh-CN"].tools.pomodoroPhase.focus, diagnostic: false });
    } finally {
      await evaluate(client!, sessionId, `
        localStorage.clear();
        for (const [key, value] of Object.entries(${originalStorage})) localStorage.setItem(key, value);
        document.documentElement.dataset.patinaSmokeReload = "tools-action-restored";
        location.reload();
      `);
      await waitForExpression(client!, sessionId, `
        document.documentElement.dataset.patinaSmokeReload !== "tools-action-restored"
          && Boolean(document.querySelector('main.qp-canvas'))
      `);
    }
  });

  await runTest("Tools cold navigation keeps the current view until a runtime snapshot is ready", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          localStorage.setItem("patina:last-active-view", "dashboard");
          localStorage.setItem("__patina_navigation_held_commands", JSON.stringify(["cmd_get_tools_snapshot"]));
          document.documentElement.dataset.patinaSmokeReload = "tools-cold";
          location.reload();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.documentElement.dataset.patinaSmokeReload !== "tools-cold"
        && Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']'))
        && document.querySelector('[data-dashboard-read-state]')?.getAttribute('data-dashboard-read-state') === 'ready'`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']');
          node?.click();
          return Boolean(node);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `globalThis.__PATINA_NAVIGATION_PENDING?.length > 0`);
    const pendingState = JSON.parse(String(await evaluate(client!, sessionId, `JSON.stringify({
      presentedView: document.querySelector("main.qp-canvas")?.getAttribute("data-presented-view") ?? null,
      toolsMounted: Boolean(document.querySelector(".tools-page")),
      showsLoadingCopy: document.body.innerText.includes("加载中..."),
      dashboardActive: document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']')
        ?.className.includes("qp-nav-item-active") ?? false,
      toolsActive: document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']')
        ?.className.includes("qp-nav-item-active") ?? false,
    })`))) as {
      presentedView: string | null;
      toolsMounted: boolean;
      showsLoadingCopy: boolean;
      dashboardActive: boolean;
      toolsActive: boolean;
    };
    assert.equal(pendingState.presentedView, "dashboard");
    assert.equal(pendingState.toolsMounted, false);
    assert.equal(pendingState.showsLoadingCopy, false);
    assert.equal(pendingState.dashboardActive, true);
    assert.equal(pendingState.toolsActive, false);

    await evaluate(client!, sessionId, `localStorage.removeItem('__patina_navigation_held_commands');
      for (const release of globalThis.__PATINA_NAVIGATION_PENDING.splice(0)) release();`);

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("main.qp-canvas")?.getAttribute("data-presented-view") === "tools"
        && Boolean(document.querySelector(".tools-page-body"))`,
      15_000,
      "Tools runtime snapshot should settle before presentation",
    );
    await evaluate(client!, sessionId, `localStorage.removeItem("__time_tracker_tools_snapshot_delay_ms")`);
  });

  await runTest("a stale Tools ensure cannot override a newer navigation request", async () => {
    await evaluate(client!, sessionId, `
      (() => {
        localStorage.setItem("patina:last-active-view", "dashboard");
        localStorage.setItem("__time_tracker_tools_snapshot_delay_ms", "900");
        document.documentElement.dataset.patinaSmokeReload = "tools-stale-ensure";
        location.reload();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.documentElement.dataset.patinaSmokeReload !== "tools-stale-ensure"
        && Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']'))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const tools = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']');
          const dashboard = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!tools || !dashboard) return false;
          tools.click();
          await new Promise((resolve) => setTimeout(resolve, 50));
          dashboard.click();
          return true;
        })()
      `),
      true,
    );
    await delay(1_050);
    const finalState = JSON.parse(String(await evaluate(client!, sessionId, `JSON.stringify({
      presentedView: document.querySelector("main.qp-canvas")?.getAttribute("data-presented-view") ?? null,
      toolsMounted: Boolean(document.querySelector(".tools-page")),
    })`))) as { presentedView: string | null; toolsMounted: boolean };
    assert.equal(finalState.presentedView, "dashboard");
    assert.equal(finalState.toolsMounted, false);
    await evaluate(client!, sessionId, `localStorage.removeItem("__time_tracker_tools_snapshot_delay_ms")`);
  });

  await runTest("Tools cold snapshot failure is explicit and retryable", async () => {
    await evaluate(client!, sessionId, `
      (() => {
        localStorage.setItem("patina:last-active-view", "dashboard");
        localStorage.setItem("__time_tracker_reject_tools_snapshot", "1");
        document.documentElement.dataset.patinaSmokeReload = "tools-cold-failure";
        location.reload();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.documentElement.dataset.patinaSmokeReload !== "tools-cold-failure"
        && Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']'))`,
    );
    await evaluate(client!, sessionId, `
      document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']')?.click()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("main.qp-canvas")?.getAttribute("data-presented-view") === "tools"
        && document.body.innerText.includes(${jsonString("工具状态加载失败。")})
        && !document.querySelector(".tools-page-body")`,
      15_000,
      "Tools cold failure should expose recovery without fake runtime data",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          localStorage.removeItem("__time_tracker_reject_tools_snapshot");
          const retry = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === ${jsonString("重试")});
          retry?.click();
          return Boolean(retry);
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".tools-page-body"))
        && !document.body.innerText.includes(${jsonString("工具状态加载失败。")})`,
      15_000,
      "Tools retry should restore the requested page",
    );
  });

  await runTest("Tools page renders its tool sections", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']');
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
      `document.querySelector('.qp-page-header-title')?.textContent === ${jsonString(TOOLS_TEXT.title)}`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.reminderEmpty)})`,
    );

    for (const marker of [
      TOOLS_TEXT.remindersTitle,
      TOOLS_TEXT.pomodoroTitle,
    ] as const) {
      assert.equal(
        await evaluate(client!, sessionId, `
          Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(marker))} + ']'))
        `),
        true,
        `missing Tools section ${marker}`,
      );
    }

    assert.equal(
      await evaluate(client!, sessionId, "document.querySelectorAll('.tools-section-tab-copy').length"),
      0,
      "Tools section rail should stay icon-only",
    );
    assert.equal(
      await evaluate(client!, sessionId, "Boolean(document.querySelector('.tools-section-label-toggle'))"),
      false,
      "Tools section rail should not expose a label toggle",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const workspace = document.querySelector('.tools-workspace');
          if (!workspace) return false;
          const railWidth = parseFloat(getComputedStyle(workspace).gridTemplateColumns.split(' ')[0] ?? "0");
          return railWidth > 0 && railWidth <= 80;
        })()
      `),
      true,
    );

    const iconModeGeometry = await evaluate(client!, sessionId, `
      (() => {
        const rect = (node) => {
          const value = node?.getBoundingClientRect();
          return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
        };
        const rail = document.querySelector('[data-tools-navigation-mode="icons"]');
        const tabs = Array.from(document.querySelectorAll('.tools-section-tab'));
        return {
          rail: rect(rail),
          tabs: tabs.map(rect),
          panel: rect(document.querySelector('.tools-active-panel')),
        };
      })()
    `);
    const settingsHoverTargets = await evaluate(client!, sessionId, `
      (() => {
        const center = (node) => {
          const rect = node?.getBoundingClientRect();
          return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
        };
        const settings = document.querySelector('.tools-section-settings-tab');
        const settingsSurface = settings?.querySelector('.tools-section-tab-icon');
        const menu = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(COPY["zh-CN"].accessibility.sidebar.navigationLabels))} + ']');
        const settingsRect = settings?.getBoundingClientRect();
        const surfaceRect = settingsSurface?.getBoundingClientRect();
        const menuRect = menu?.getBoundingClientRect();
        return {
          settingsCenter: center(settings),
          defaultSurfaceBackground: settingsSurface ? getComputedStyle(settingsSurface).backgroundColor : null,
          settingsRect: settingsRect ? { width: settingsRect.width, height: settingsRect.height } : null,
          surfaceRect: surfaceRect ? { width: surfaceRect.width, height: surfaceRect.height } : null,
          menuRect: menuRect ? { width: menuRect.width, height: menuRect.height } : null,
        };
      })()
    `) as {
      settingsCenter: { x: number; y: number } | null;
      defaultSurfaceBackground: string | null;
      settingsRect: { width: number; height: number } | null;
      surfaceRect: { width: number; height: number } | null;
      menuRect: { width: number; height: number } | null;
    };
    assert.deepEqual(settingsHoverTargets.settingsRect, { width: 54, height: 42 });
    assert.deepEqual(settingsHoverTargets.surfaceRect, settingsHoverTargets.menuRect);
    assert.ok(settingsHoverTargets.settingsCenter, "expected the Tools settings hover target");
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: settingsHoverTargets.settingsCenter!.x,
      y: settingsHoverTargets.settingsCenter!.y,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        const surface = document.querySelector('.tools-section-settings-tab .tools-section-tab-icon');
        if (!surface) return false;
        const tokenProbe = document.createElement('span');
        tokenProbe.style.background = 'var(--qp-bg-elevated)';
        tokenProbe.style.color = 'var(--qp-text-secondary)';
        document.body.append(tokenProbe);
        const surfaceStyle = getComputedStyle(surface);
        const tokenStyle = getComputedStyle(tokenProbe);
        const settled = surfaceStyle.backgroundColor !== ${jsonString(JSON.stringify(settingsHoverTargets.defaultSurfaceBackground))}
          && surfaceStyle.backgroundColor === tokenStyle.backgroundColor
          && surfaceStyle.color === tokenStyle.color;
        tokenProbe.remove();
        return settled;
      })()`,
      undefined,
      "Tools settings hover transition should settle on the compact icon surface",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const settings = document.querySelector('.tools-section-settings-tab');
          const surface = settings?.querySelector('.tools-section-tab-icon');
          if (!settings || !surface) return null;
          const settingsStyle = getComputedStyle(settings);
          const surfaceStyle = getComputedStyle(surface);
          const tokenProbe = document.createElement('span');
          tokenProbe.style.background = 'var(--qp-bg-elevated)';
          tokenProbe.style.color = 'var(--qp-text-secondary)';
          document.body.append(tokenProbe);
          const tokenStyle = getComputedStyle(tokenProbe);
          const surfaceUsesNeutralTokens = surfaceStyle.backgroundColor === tokenStyle.backgroundColor
            && surfaceStyle.color === tokenStyle.color;
          tokenProbe.remove();
          return {
            settingsIsTransparent: settingsStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
              && settingsStyle.borderColor === 'rgba(0, 0, 0, 0)',
            surfaceUsesNeutralTokens,
            tooltipVisible: Boolean(document.querySelector('[role="tooltip"]')),
          };
        })()
      `),
      {
        settingsIsTransparent: true,
        surfaceUsesNeutralTokens: true,
        tooltipVisible: false,
      },
    );
    await client!.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 }, sessionId);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(COPY["zh-CN"].accessibility.sidebar.navigationLabels))} + ']');
          toggle?.click();
          return Boolean(toggle);
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[data-tools-navigation-mode="labeled"]')
        && document.querySelectorAll('[data-tools-section-label]').length === 2`,
      undefined,
      "Menu should reveal both Tools section labels",
    );
    const labeledModeState = await evaluate(client!, sessionId, `
      (() => {
        const rect = (node) => {
          const value = node?.getBoundingClientRect();
          return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
        };
        const rail = document.querySelector('[data-tools-navigation-mode="labeled"]');
        const tabs = Array.from(document.querySelectorAll('.tools-section-tab'));
        const sectionTabs = tabs.slice(0, 2);
        const labels = Array.from(document.querySelectorAll('[data-tools-section-label]'));
        const settingsTab = tabs.at(-1);
        return {
          geometry: {
            rail: rect(rail),
            tabs: tabs.map(rect),
            panel: rect(document.querySelector('.tools-active-panel')),
          },
          labels: labels.map((node) => node.textContent),
          labelsFit: labels.every((node) => node.scrollWidth <= node.clientWidth + 1),
          iconSizes: sectionTabs.map((button) => button.querySelector('svg')?.getAttribute('width')),
          settingsIconSize: settingsTab?.querySelector('svg')?.getAttribute('width'),
          settingsHasLabel: Boolean(settingsTab?.querySelector('[data-tools-section-label]')),
          activeSection: sectionTabs.find((button) => button.getAttribute('aria-pressed') === 'true')?.getAttribute('aria-label'),
        };
      })()
    `) as {
      geometry: unknown;
      labels: string[];
      labelsFit: boolean;
      iconSizes: Array<string | null>;
      settingsIconSize: string | null | undefined;
      settingsHasLabel: boolean;
      activeSection: string | null | undefined;
    };
    assert.deepEqual(labeledModeState.geometry, iconModeGeometry);
    assert.deepEqual(labeledModeState.labels, [
      TOOLS_TEXT.remindersTitle,
      TOOLS_TEXT.pomodoroTitle,
    ]);
    assert.equal(labeledModeState.labelsFit, true);
    assert.deepEqual(labeledModeState.iconSizes, ["15", "15"]);
    assert.equal(labeledModeState.settingsIconSize, "17");
    assert.equal(labeledModeState.settingsHasLabel, false);
    assert.equal(labeledModeState.activeSection, TOOLS_TEXT.remindersTitle);

    await evaluate(client!, sessionId, `
      document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(COPY["zh-CN"].accessibility.sidebar.navigationLabels))} + ']')?.click()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[data-tools-navigation-mode="icons"]')
        && document.querySelectorAll('[data-tools-section-label]').length === 0`,
    );

    for (const marker of [
      TOOLS_TEXT.remindersTitle,
      TOOLS_TEXT.reminderModeEvent,
      TOOLS_TEXT.reminderModeUsage,
    ] as const) {
      assert.equal(
        await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(marker)})`),
        true,
        `missing visible Tools panel marker ${marker}`,
      );
    }
    assert.equal(await evaluate(client!, sessionId,
      `document.querySelectorAll('.tools-reminder-kind-filter [role="tab"]').length`), 2);

    await evaluate(client!, sessionId, `document.querySelector('.tools-event-reminder-form .tools-reminder-time-trigger').click()`);
    await waitForExpression(client!, sessionId, `document.activeElement?.matches('.qp-calendar-day')`);
    assert.equal(await evaluate(client!, sessionId, `document.querySelectorAll('.tools-event-reminder-form input[type="date"], .tools-event-reminder-form input[type="time"]').length`), 0);
    await evaluate(client!, sessionId, `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}))`);
    await waitForExpression(client!, sessionId, `document.activeElement?.matches('.qp-calendar-day:not([data-selected])')`);
    await evaluate(client!, sessionId, `document.activeElement.click()`);
    await waitForExpression(client!, sessionId, `document.querySelector('.tools-event-reminder-form .tools-action-button').disabled && !document.querySelector('.qp-calendar-popover')`);

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const appMode = Array.from(document.querySelectorAll('button'))
            .find((node) => node.textContent?.trim() === ${jsonString(TOOLS_TEXT.reminderModeUsage)});
          if (!appMode) return false;
          globalThis.__PATINA_TOOLS_PREVIOUS_WEB_FIXTURE = globalThis.__TIME_TRACKER_ENABLE_WEB_FIXTURE;
          globalThis.__TIME_TRACKER_ENABLE_WEB_FIXTURE = true;
          appMode.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.activityReminderEmpty)})`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('input[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.activityReminderTargetPlaceholder))} + ']'))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const input = document.querySelector('input[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.activityReminderTargetPlaceholder))} + ']');
          if (!(input instanceof HTMLInputElement)) return false;
          input.focus();
          return true;
        })()
      `),
      true,
      "missing the unified activity reminder search field",
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('.tools-activity-target-candidate-list[role="listbox"]'))`,
    );
    assert.deepEqual(
      JSON.parse(String(await evaluate(client!, sessionId, `JSON.stringify((() => {
        const search = document.querySelector('.tools-activity-target-search');
        const list = document.querySelector('.tools-activity-target-candidate-list');
        const listStyle = list ? getComputedStyle(list) : null;
        const inlineBorders = listStyle
          ? Number.parseFloat(listStyle.borderLeftWidth) + Number.parseFloat(listStyle.borderRightWidth)
          : 0;
        return {
          hasSearchIcon: Boolean(search?.querySelector('svg')),
          scrollbarLane: list ? list.offsetWidth - list.clientWidth - inlineBorders : null,
          usesQuietScrollRegion: list?.classList.contains('qp-scroll-region') ?? false,
          usesStableGutter: list?.classList.contains('qp-scroll-region-stable') ?? false,
          startsWithoutActiveOption: !list?.querySelector('.tools-activity-target-option-active'),
          nativeDatalistCount: document.querySelectorAll('datalist').length,
        };
      })())`))),
      {
        hasSearchIcon: true,
        scrollbarLane: 6,
        usesQuietScrollRegion: true,
        usesStableGutter: true,
        startsWithoutActiveOption: true,
        nativeDatalistCount: 0,
      },
      "activity reminder targets should use the previous Quiet Pro search picker shell",
    );
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      }));
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll('.tools-activity-target-option-active').length === 1`,
    );
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }));
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.tools-activity-target-candidate-list')`);

    await evaluate(client!, sessionId, `document.querySelector('.tools-activity-target-search input')?.focus()`);
    await waitForExpression(client!, sessionId, `
      ['app', 'category', 'web'].every(kind => document.querySelector('[data-activity-target-kind="' + kind + '"]'))
    `);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const markers = Array.from(document.querySelectorAll('[data-activity-category-marker]'));
          const colors = markers.map(marker => getComputedStyle(marker.querySelector('.tools-activity-category-dot')).backgroundColor);
          return markers.length >= 2
            && markers.every(marker => {
              const style = getComputedStyle(marker);
              return style.borderTopStyle !== 'none'
                && style.borderTopColor !== 'rgba(0, 0, 0, 0)'
                && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
            })
            && colors.every(color => color !== 'rgba(0, 0, 0, 0)')
            && new Set(colors).size >= 2;
        })()
      `), true, "merged targets retain the category icon tiles and semantic colors",
    );
    await evaluate(client!, sessionId, `
      globalThis.__PATINA_ACTIVITY_REMINDER_CASE = {
        settings: { pomodoro_focus_minutes: 25,
          pomodoro_short_break_minutes: 5, pomodoro_long_break_minutes: 15, pomodoro_long_break_every: 4 },
        reminders: [], activity_reminder_rules: [], free_focus_tasks: [], pomodoro_tasks: [], current_pomodoro: null,
        today_completed_pomodoros: 0, next_reminder_at: null, sampled_at_ms: Date.now(),
      };
    `);
    try {
      for (const kind of ["app", "category", "web"] as const) {
        await evaluate(client!, sessionId, `document.querySelector('.tools-activity-target-search input')?.focus()`);
        await waitForExpression(
          client!, sessionId,
          `Boolean(document.querySelector('[data-activity-target-kind="${kind}"]'))`,
        );
        await evaluate(client!, sessionId, `document.querySelector('[data-activity-target-kind="${kind}"]').click()`);
        await waitForExpression(client!, sessionId, `!document.querySelector('.tools-activity-target-candidate-list')`);
        const limitMinutes = kind === "app" ? 30 : kind === "category" ? 125 : 1440;
        await evaluate(client!, sessionId, `document.querySelector('.tools-software-reminder-form .tools-usage-duration-trigger').click()`);
        await waitForExpression(client!, sessionId, `document.activeElement?.matches('.tools-usage-duration-popover [data-selected-time-part="hour"]')`);
        await evaluate(client!, sessionId, `document.querySelector('.tools-usage-duration-popover [data-time-picker-part="hour"][data-time-picker-value="${Math.floor(limitMinutes / 60)}"]').click()`);
        await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.tools-usage-duration-popover [data-selected-time-part="hour"][data-time-picker-value="${Math.floor(limitMinutes / 60)}"]'))`);
        await evaluate(client!, sessionId, `document.querySelector('.tools-usage-duration-popover [data-time-picker-part="minute"][data-time-picker-value="${limitMinutes % 60}"]').click()`);
        await waitForExpression(client!, sessionId, `!document.querySelector('.tools-usage-duration-popover') && document.activeElement?.matches('.tools-software-reminder-form .tools-usage-duration-trigger')`);
        await evaluate(client!, sessionId, `document.querySelector('.tools-software-reminder-form .tools-action-button').click()`);
        await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[data-activity-rule-kind="${kind}"]'))`);
        assert.deepEqual(await evaluate(client!, sessionId, `(() => {
          const call = globalThis.__PATINA_INVOKED_COMMANDS.filter(item => item.command === 'cmd_create_activity_reminder_rule').at(-1);
          return { kind: call.payload.input.target.kind, limitMs: call.payload.input.limitMs, message: call.payload.input.message };
        })()`), { kind, limitMs: limitMinutes * 60_000, message: "" });
      }
      assert.deepEqual(await evaluate(client!, sessionId,
        `Array.from(document.querySelectorAll('[data-activity-rule-kind]')).map(row => row.dataset.activityRuleKind)`),
      ["app", "category", "web"], "all rule types remain visible in the merged list");
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector('[data-activity-rule-kind="app"] [aria-pressed]');
          toggle.focus();
          globalThis.__PATINA_ACTIVITY_REMINDER_ACTION_CASE = { hold: true };
          globalThis.__PATINA_TOGGLE_CALL_COUNT = globalThis.__PATINA_INVOKED_COMMANDS.filter(item => item.command === 'cmd_set_activity_reminder_enabled').length;
          toggle.click();
        })()
      `);
      await waitForExpression(client!, sessionId, `Boolean(globalThis.__PATINA_ACTIVITY_REMINDER_ACTION_CASE.release) && document.querySelector('[data-activity-rule-kind="app"] [aria-pressed]').getAttribute('aria-busy') === 'true'`);
      assert.equal(await evaluate(client!, sessionId, `(() => {
        const toggle = document.querySelector('[data-activity-rule-kind="app"] [aria-pressed]');
        return document.activeElement === toggle && !toggle.disabled
          && toggle.getAttribute('aria-disabled') === 'true'
          && Boolean(toggle.querySelector('.lucide-toggle-right'))
          && [...document.querySelectorAll('.tools-reminder-row-actions button')].every(button => getComputedStyle(button).opacity === '1');
      })()`), true, "pending toggles preserve focus, icon and opacity across the list");
      await evaluate(client!, sessionId, `
        document.querySelector('[data-activity-rule-kind="app"] [aria-pressed]').click();
        document.querySelector('[data-activity-rule-kind="app"] [aria-pressed]').click();
      `);
      assert.equal(await evaluate(client!, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.filter(item => item.command === 'cmd_set_activity_reminder_enabled').length - globalThis.__PATINA_TOGGLE_CALL_COUNT`), 1, "pending toggles must not submit duplicate writes");
      await evaluate(client!, sessionId, `globalThis.__PATINA_ACTIVITY_REMINDER_ACTION_CASE.release()`);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[data-activity-rule-kind="app"] .lucide-toggle-left')) && !document.querySelector('[data-activity-rule-kind="app"] [aria-pressed]').hasAttribute('aria-busy')`);
      await evaluate(client!, sessionId, `
        delete globalThis.__PATINA_ACTIVITY_REMINDER_ACTION_CASE;
        delete globalThis.__PATINA_TOGGLE_CALL_COUNT;
        document.querySelector('[data-activity-rule-kind="app"] [aria-pressed]').click();
      `);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[data-activity-rule-kind="app"] .lucide-toggle-right')) && !document.querySelector('[data-activity-rule-kind="app"] [aria-pressed]').hasAttribute('aria-busy')`);
      for (const kind of ["app", "category", "web"]) {
        await evaluate(client!, sessionId, `document.querySelector('[data-activity-rule-kind="${kind}"] button[aria-label^="${COPY["zh-CN"].tools.activityReminderEdit}:"]').click()`);
        await waitForExpression(client!, sessionId, `document.activeElement === document.querySelector('.tools-reminder-editor .tools-usage-duration-trigger')`);
        assert.equal(await evaluate(client!, sessionId, `(() => {
          const row = document.querySelector('[data-activity-rule-kind="${kind}"]');
          const target = document.querySelector('.tools-reminder-editor-target');
          return target.querySelector('strong').textContent === row.querySelector('strong').textContent
            && getComputedStyle(target.querySelector('strong')).fontSize === getComputedStyle(row.querySelector('strong')).fontSize
            && target.querySelector('.data-app-option-icon').outerHTML === row.querySelector('.data-app-option-icon').outerHTML;
        })()`), true, `${kind} editor uses the same target identity as its rule`);
        await client!.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
        await waitForExpression(client!, sessionId, `!document.querySelector('.tools-reminder-editor')`);
        await evaluate(client!, sessionId, `document.querySelector('[data-activity-rule-kind="${kind}"] [aria-pressed]').click()`);
        await waitForExpression(client!, sessionId, `document.querySelector('[data-activity-rule-kind="${kind}"] [aria-pressed]')?.getAttribute('aria-pressed') === 'false' && !document.querySelector('[data-activity-rule-kind="${kind}"] [aria-pressed]').hasAttribute('aria-busy')`);
        const createsBefore = await evaluate(client!, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.filter(item => item.command === 'cmd_create_activity_reminder_rule').length`);
        await evaluate(client!, sessionId, `(() => {
          const input = document.querySelector('.tools-activity-target-search input');
          input.focus();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[data-activity-target-kind="${kind}"]'))`);
        await evaluate(client!, sessionId, `document.querySelector('[data-activity-target-kind="${kind}"]').click()`);
        await waitForExpression(client!, sessionId, `document.querySelector('.tools-software-reminder-form .tools-action-button').textContent === ${jsonString(TOOLS_TEXT.activityReminderEdit)}`);
        assert.equal(await evaluate(client!, sessionId, `document.querySelector('.tools-software-reminder-form .tools-usage-duration-trigger').disabled`), true);
        await evaluate(client!, sessionId, `document.querySelector('.tools-software-reminder-form .tools-action-button').focus(); document.querySelector('.tools-software-reminder-form .tools-action-button').click()`);
        await waitForExpression(client!, sessionId, `document.activeElement === document.querySelector('.tools-reminder-editor .tools-usage-duration-trigger')`);
        assert.equal(await evaluate(client!, sessionId, `document.querySelector('.tools-reminder-editor .tools-usage-duration-trigger').textContent === document.querySelector('[data-activity-rule-kind="${kind}"] .tools-tabular').textContent`), true, "duplicate target opens the original rule including its saved limit");
        await evaluate(client!, sessionId, `document.querySelector('[role="dialog"] button[type="submit"]').click()`);
        await waitForExpression(client!, sessionId, `!document.querySelector('.tools-reminder-editor')`);
        assert.equal(await evaluate(client!, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.filter(item => item.command === 'cmd_create_activity_reminder_rule').length`), createsBefore, "existing targets must not submit another create command");
        assert.equal(await evaluate(client!, sessionId, `document.querySelectorAll('[data-activity-rule-kind="${kind}"]').length`), 1);
        assert.equal(await evaluate(client!, sessionId, `document.querySelector('[data-activity-rule-kind="${kind}"] [aria-pressed]').getAttribute('aria-pressed')`), "false", "editing does not re-enable a disabled rule");
        await evaluate(client!, sessionId, `document.querySelector('[data-activity-rule-kind="${kind}"] [aria-pressed]').focus()`);
        await client!.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId);
        await client!.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, sessionId);
        await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[data-activity-rule-kind="${kind}"] [aria-pressed="true"]:not([aria-busy="true"])'))`);
      }
      const editSelector = `[data-activity-rule-kind="app"] button[aria-label^="${COPY["zh-CN"].tools.activityReminderEdit}:"]`;
      await evaluate(client!, sessionId, `document.querySelector(${jsonString(editSelector)}).focus(); document.querySelector(${jsonString(editSelector)}).click()`);
      await waitForExpression(client!, sessionId, `document.activeElement === document.querySelector('.tools-reminder-editor .tools-usage-duration-trigger')`);
      await client!.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 }, sessionId);
      await client!.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, sessionId);
      await waitForExpression(client!, sessionId, `document.activeElement?.matches('.tools-usage-duration-popover [data-selected-time-part="hour"]')`);
      await client!.command("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End", windowsVirtualKeyCode: 35 }, sessionId);
      await client!.command("Input.dispatchKeyEvent", { type: "keyUp", key: "End", code: "End", windowsVirtualKeyCode: 35 }, sessionId);
      await waitForExpression(client!, sessionId, `document.querySelector('.tools-reminder-editor .tools-usage-duration-trigger')?.textContent === '24 小时'`);
      assert.deepEqual(await evaluate(client!, sessionId, `(() => {
        const popover = document.querySelector('.tools-usage-duration-popover');
        const lists = [...popover.querySelectorAll('.qp-time-picker-list')];
        return { minutes: [...popover.querySelectorAll('[data-time-picker-part="minute"]')].map(node => node.textContent),
          equalHeight: lists[0].clientHeight === lists[1].clientHeight,
          noOverflow: popover.getBoundingClientRect().bottom <= innerHeight && popover.getBoundingClientRect().right <= innerWidth };
      })()`), { minutes: ["00"], equalHeight: true, noOverflow: true });
      await client!.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Home", code: "Home", windowsVirtualKeyCode: 36 }, sessionId);
      await client!.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Home", code: "Home", windowsVirtualKeyCode: 36 }, sessionId);
      await waitForExpression(client!, sessionId, `document.querySelector('.tools-reminder-editor .tools-usage-duration-trigger')?.textContent === '1 分钟'`);
      assert.equal(await evaluate(client!, sessionId, `Boolean(document.querySelector('.tools-usage-duration-popover [data-time-picker-part="minute"][data-time-picker-value="0"]'))`), false, "zero duration is not selectable");
      await client!.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
      await waitForExpression(client!, sessionId, `!document.querySelector('.tools-usage-duration-popover') && document.activeElement?.matches('.tools-reminder-editor .tools-usage-duration-trigger')`);
      await evaluate(client!, sessionId, `document.querySelector('.tools-reminder-editor .tools-usage-duration-trigger').click()`);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector('.tools-usage-duration-popover'))`);
      await evaluate(client!, sessionId, `document.querySelector('.tools-usage-duration-popover [data-time-picker-part="minute"][data-time-picker-value="45"]').click()`);
      await waitForExpression(client!, sessionId, `!document.querySelector('.tools-usage-duration-popover')`);
      const updatesBeforeFailure = await evaluate(client!, sessionId, `globalThis.__PATINA_INVOKED_COMMANDS.filter(item=>item.command==='cmd_update_activity_reminder_limit').length`);
      const failedSaveSettled = `globalThis.__PATINA_INVOKED_COMMANDS.filter(item=>item.command==='cmd_update_activity_reminder_limit').length===${updatesBeforeFailure}+1 && Boolean(document.querySelector('.tools-reminder-editor .tools-usage-duration-trigger:not(:disabled)'))`;
      assert.equal(await evaluate(client!, sessionId, failedSaveSettled), false, 'an enabled editor must not count as a completed save');
      await evaluate(client!, sessionId, `
        globalThis.__PATINA_ACTIVITY_REMINDER_ACTION_CASE = { hold: true, error: 'fixture write failed' };
        document.querySelector('[role="dialog"] button[type="submit"]').click();
      `);
      await waitForExpression(client!, sessionId, `Boolean(globalThis.__PATINA_ACTIVITY_REMINDER_ACTION_CASE.release) && document.querySelector('.tools-reminder-editor .tools-usage-duration-trigger').disabled`);
      assert.equal(await evaluate(client!, sessionId, failedSaveSettled), false, 'a held save must not satisfy the retry gate');
      await evaluate(client!, sessionId, `globalThis.__PATINA_ACTIVITY_REMINDER_ACTION_CASE.release()`);
      await waitForExpression(client!, sessionId, failedSaveSettled, undefined, 'failed usage limit edit settles before retry');
      assert.equal(await evaluate(client!, sessionId, `Boolean(document.querySelector('.qp-toast[role="alert"]'))`), true);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('.tools-reminder-editor .tools-usage-duration-trigger').textContent`), "45 分钟", "failed save preserves the draft");
      assert.equal(await evaluate(client!, sessionId, `globalThis.__PATINA_ACTIVITY_REMINDER_CASE.activity_reminder_rules[0].limit_ms`), 1_800_000);
      await evaluate(client!, sessionId, `
        globalThis.__PATINA_ACTIVITY_REMINDER_ACTION_CASE = { hold: true };
        document.querySelector('[role="dialog"] button[type="submit"]').click();
      `);
      await waitForExpression(client!, sessionId, `Boolean(globalThis.__PATINA_ACTIVITY_REMINDER_ACTION_CASE.release) && document.querySelector('.tools-reminder-editor .tools-usage-duration-trigger').disabled`);
      await client!.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, sessionId);
      assert.equal(await evaluate(client!, sessionId, `Boolean(document.querySelector('[role="dialog"]'))`), true, "a pending save cannot be dismissed");
      await evaluate(client!, sessionId, `globalThis.__PATINA_ACTIVITY_REMINDER_ACTION_CASE.release()`);
      await waitForExpression(client!, sessionId, `!document.querySelector('[role="dialog"]') && globalThis.__PATINA_ACTIVITY_REMINDER_CASE.activity_reminder_rules[0].limit_ms === 2700000`);
      await waitForExpression(client!, sessionId, `document.activeElement === document.querySelector(${jsonString(editSelector)})`);
      assert.equal(await evaluate(client!, sessionId, `document.querySelector('[data-activity-rule-kind="app"] .tools-software-rule-heading .tools-tabular').textContent`), "45 分钟");
      await evaluate(client!, sessionId, `delete globalThis.__PATINA_ACTIVITY_REMINDER_ACTION_CASE`);
      await evaluate(client!, sessionId, `document.querySelector('[data-activity-rule-kind="category"] button[aria-label^="${COPY["zh-CN"].tools.activityReminderDelete}:"]').click()`);
      await waitForExpression(client!, sessionId, `!document.querySelector('[data-activity-rule-kind="category"]')`);
      assert.deepEqual(await evaluate(client!, sessionId,
        `Array.from(document.querySelectorAll('[data-activity-rule-kind]')).map(row => row.dataset.activityRuleKind)`),
      ["app", "web"], "deleting a category leaves the other rule types intact");
    } finally {
      await evaluate(client!, sessionId, `
        delete globalThis.__PATINA_ACTIVITY_REMINDER_CASE;
        delete globalThis.__PATINA_ACTIVITY_REMINDER_ACTION_CASE;
        globalThis.__TIME_TRACKER_ENABLE_WEB_FIXTURE = globalThis.__PATINA_TOOLS_PREVIOUS_WEB_FIXTURE;
        delete globalThis.__PATINA_TOOLS_PREVIOUS_WEB_FIXTURE;
      `);
    }

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const pomodoro = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.pomodoroTitle))} + ']');
          if (!pomodoro) return false;
          pomodoro.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.pomodoroTitle)})`,
    );
    await evaluate(client!, sessionId, `document.querySelector('.tools-pomodoro-settings-trigger').click()`);
    await waitForExpression(client!, sessionId, `document.activeElement?.id === 'tools-pomodoro-focus'`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('#tools-pomodoro-focus');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return input.value === '';
        })()
      `),
      true,
      "pomodoro duration should be clearable while editing",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('#tools-pomodoro-focus');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '0');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return input.validity.rangeUnderflow;
        })()
      `),
      true,
      "pomodoro duration should reject zero minutes",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('#tools-pomodoro-focus');
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '35');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const popover = document.querySelector('.tools-pomodoro-settings-popover');
          return document.querySelector('.tools-pomodoro-settings-trigger').textContent.includes('35')
            && popover.querySelectorAll('input').length === 4
            && !popover.querySelector('h3, button');
        })()
      `),
      true,
      "pomodoro settings apply immediately without header or action buttons",
    );
    await client!.command('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}, sessionId);
    await waitForExpression(client!, sessionId, `!document.querySelector('.tools-pomodoro-settings-popover')`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dashboard = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!dashboard) return false;
          dashboard.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const tools = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']');
          if (!tools) return false;
          tools.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `
        document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.pomodoroTitle))} + ']')
          ?.getAttribute('aria-pressed') === 'true'
      `,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        document.querySelector('[data-tools-section="pomodoro"]')?.className.includes('tools-section-pane-hidden') === false
      `),
      true,
      "Tools section rail should restore the last selected section",
    );
    assert.equal(
      await evaluate(client!, sessionId, "document.querySelectorAll('.tools-section-tab-copy').length"),
      0,
      "Tools section rail should stay icon-only after switching sections",
    );
  });

  await runTest("Tools settings saves immediately, retains committed values on failure and completes after closing", async () => {
    const triggerLabel = COPY["zh-CN"].tools.settingsTitle;
    await waitForExpression(client, sessionId, `Boolean(document.querySelector(
      'main[data-presented-view="tools"][data-view-transition-state="settled"] .tools-section-settings-tab'))`);
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const trigger = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(triggerLabel))} + ']');
        if (!(trigger instanceof HTMLButtonElement)) return false;
        trigger.focus();
        if (document.activeElement !== trigger) return false;
        trigger.click();
        return true;
      })()
    `), true);
    await waitForExpression(client!, sessionId, `
      document.querySelector('[role="dialog"] .qp-dialog-title')?.textContent?.trim()
        === ${jsonString(COPY["zh-CN"].tools.settingsTitle)}
      && document.activeElement?.classList.contains('qp-dialog-title')
    `, 15_000, "Tools settings dialog initial focus");

    const dialog = await evaluate(client!, sessionId, `
      (() => ({
        group: document.querySelector('.tools-notification-settings h4')?.textContent,
        labels: [...document.querySelectorAll('.tools-notification-setting-row > span')].map(node => node.textContent),
        footer: !!document.querySelector('.tools-settings-dialog .qp-dialog-footer'),
      }))()
    `);
    assert.deepEqual(dialog, {
      group: COPY["zh-CN"].tools.notificationGroup,
      labels: [COPY["zh-CN"].tools.notificationDelivery, COPY["zh-CN"].tools.notificationSound],
      footer: false,
    });

    const geometry = await evaluate(client, sessionId, `(() => {
      const controls = [...document.querySelectorAll('.tools-notification-setting-row')].map(row=>row.lastElementChild.getBoundingClientRect());
      return {widths:controls.map(r=>r.width),rights:controls.map(r=>r.right)};
    })()`) as { widths: number[]; rights: number[] };
    assert.ok(Math.abs(geometry.rights[0] - geometry.rights[1]) < 1, "settings controls should share their right edge");
    const capture = await client.command("Page.captureScreenshot", { format: "png" }, sessionId);
    const screenshot = join(tmpdir(), "patina-tools-notification-settings.png");
    writeFileSync(screenshot, Buffer.from(String(capture.data), "base64"));
    console.log(`Tools settings visual review: ${screenshot}`);
    const key = async (key: string, code: number) => {
      await client.command('Input.dispatchKeyEvent', {type:'keyDown',key,windowsVirtualKeyCode:code}, sessionId);
      await client.command('Input.dispatchKeyEvent', {type:'keyUp',key,windowsVirtualKeyCode:code}, sessionId);
    };
    const soundTrigger = '.tools-notification-setting-row [aria-haspopup="listbox"]';
    const selectSound = async (navigationKey: 'Home' | 'End', code: number) => {
      await key('ArrowDown', 40);
      await waitForExpression(client, sessionId, `document.activeElement?.matches('[role="listbox"]')
        && document.activeElement.id === document.querySelector(${jsonString(soundTrigger)})?.getAttribute('aria-controls')`,
        undefined, 'notification sound listbox takes keyboard focus');
      await key(navigationKey, code);
      const position = navigationKey === 'Home' ? 'first' : 'last';
      await waitForExpression(client, sessionId, `document.activeElement.getAttribute('aria-activedescendant')
        === document.activeElement.querySelector('li:${position}-child [role="option"]')?.id`,
        undefined, `sound listbox highlights the ${position} option`);
      await key('Enter', 13);
    };
    await evaluate(client, sessionId, `document.querySelector(${jsonString(soundTrigger)}).focus()`);
    await client.command('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    }, sessionId);
    try {
      await waitForExpression(client, sessionId, `document.documentElement.dataset.qpMotion === 'reduced'`);
      await selectSound('Home', 36);
    } finally {
      await client.command('Emulation.setEmulatedMedia', { features: [] }, sessionId);
    }
    await waitForExpression(client, sessionId, `JSON.parse(localStorage.getItem('__patina_notification_preferences')).sound === 'default'
      && document.activeElement?.matches('.tools-notification-setting-row [aria-haspopup="listbox"]')`);
    await selectSound('End', 35);
    await waitForExpression(client, sessionId, `JSON.parse(localStorage.getItem('__patina_notification_preferences')).sound === 'none'`);

    const clickDelivery = (text: string) => evaluate(client, sessionId, `[...document.querySelectorAll('.tools-notification-setting-row button')].find(b => b.textContent.trim() === ${jsonString(text)}).click()`);
    await evaluate(client, sessionId, `globalThis.__PATINA_NOTIFICATION_SAVE = { error: 'injected' }`);
    await clickDelivery(COPY["zh-CN"].tools.notificationSoftware);
    await waitForExpression(client, sessionId, `document.querySelector('.tools-notification-settings [role="alert"]')?.textContent.includes(${jsonString(COPY["zh-CN"].tools.notificationSaveFailed)})`);
    assert.equal(await evaluate(client, sessionId, `document.querySelector('.tools-notification-setting-row [aria-pressed="true"]')?.textContent.trim()`), COPY["zh-CN"].tools.notificationDialog);
    const controlAppearance = () => evaluate(client, sessionId, `[...document.querySelectorAll('.tools-notification-setting-row button')].map(button=>({opacity:getComputedStyle(button).opacity,width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height}))`);
    const beforeSaveAppearance = await controlAppearance();
    await evaluate(client, sessionId, `globalThis.__PATINA_NOTIFICATION_SAVE = { hold: true }`);
    await clickDelivery(COPY["zh-CN"].tools.notificationSoftware);
    await waitForExpression(client, sessionId, `typeof globalThis.__PATINA_NOTIFICATION_SAVE.release === 'function' && [...document.querySelectorAll('.tools-notification-setting-row button')].every(b=>b.disabled)`);
    assert.deepEqual(await controlAppearance(), beforeSaveAppearance, "saving must prevent duplicate writes without dimming or resizing the controls");
    assert.equal(await evaluate(client, sessionId, `document.querySelector('.tools-notification-settings').getAttribute('aria-busy')`), "true");

    await evaluate(client!, sessionId, `
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('[role="dialog"]')`);
    await waitForExpression(client!, sessionId, `document.activeElement?.getAttribute('aria-label') === ${jsonString(triggerLabel)}`,
      15_000, "Tools settings focus restoration");
    await evaluate(client, sessionId, `globalThis.__PATINA_NOTIFICATION_SAVE.release()`);
    await waitForExpression(client, sessionId, `JSON.parse(localStorage.getItem('__patina_notification_preferences')).delivery === 'notification'`);
    await evaluate(client, sessionId, `document.querySelector('.tools-section-settings-tab').click()`);
    await waitForExpression(client, sessionId, `document.querySelector('.tools-notification-setting-row [aria-pressed="true"]')?.textContent.trim() === ${jsonString(COPY["zh-CN"].tools.notificationSoftware)}`);
    await evaluate(client, sessionId, `globalThis.__PATINA_NOTIFICATION_SAVE = null`);
    await clickDelivery(COPY["zh-CN"].tools.notificationDialog);
    await waitForExpression(client, sessionId, `JSON.parse(localStorage.getItem('__patina_notification_preferences')).delivery === 'dialog'`);
    await evaluate(client, sessionId, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  });

  await runTest("Reminder lists keep compact rows and stable widths with inset scrollbars", async () => {
    const originalStorage = String(await evaluate(client, sessionId, `JSON.stringify({ ...localStorage })`));
    try {
      await evaluate(client, sessionId, `
        (() => {
          const now = Date.now();
          localStorage.clear();
          localStorage.setItem("__time_tracker_smoke_settings", JSON.stringify({
            language: "zh-CN", "__category_color_override::game": "#123456",
          }));
          localStorage.setItem("patina:last-active-view", "tools");
          localStorage.setItem("patina:tools-section", "reminders");
          localStorage.setItem("patina:tools-reminder-mode", "usage");
          localStorage.setItem("__time_tracker_tools_snapshot_override", JSON.stringify({
            settings: {
              pomodoro_focus_minutes: 25,
              pomodoro_short_break_minutes: 5, pomodoro_long_break_minutes: 15, pomodoro_long_break_every: 4,
            },
            reminders: Array.from({ length: 8 }, (_, index) => ({
              id: index + 1, label: "Reminder " + (index + 1), created_at: now,
              scheduled_at: now + (index + 1) * 3600000, status: "scheduled",
              fired_at: null, cancelled_at: null,
            })),
            activity_reminder_rules: Array.from({ length: 8 }, (_, index) => ({
              id: index + 1, target: index >= 6
                ? { kind: "category", category_id: index === 6 ? "game" : "custom:unlisted" }
                : { kind: "app", app_name: "App " + (index + 1), exe_name: index === 0 ? "cursor.exe" : "app-" + index + ".exe" },
              enabled: true,
              label_snapshot: "App " + (index + 1), limit_ms: 900000, message: "",
              created_at: now, updated_at: now, disabled_at: null,
              last_fired_date_key: null, suspension_reason: null,
            })),
            free_focus_tasks: [],
            pomodoro_tasks: [], current_pomodoro: null,
            today_completed_pomodoros: 0, next_reminder_at: now + 3600000, sampled_at_ms: now,
          }));
          document.documentElement.dataset.patinaSmokeReload = "reminder-overflow";
          location.reload();
        })()
      `);
      await waitForExpression(client, sessionId, `
        document.documentElement.dataset.patinaSmokeReload !== "reminder-overflow"
          && document.querySelectorAll('.tools-reminder-row').length === 8
      `);
      await waitForExpression(client, sessionId, `(() => {
        const dot = document.querySelector('[data-activity-rule-kind="category"] .tools-activity-category-dot');
        return Boolean(dot && getComputedStyle(dot).backgroundColor === 'rgb(18, 52, 86)');
      })()`, 10_000, "cold usage navigation loads category colors without opening the target picker");
      for (const locale of ["en-US", "zh-CN"] as const) {
        const copy = await loadLocaleText(locale);
        await evaluate(client, sessionId, `(() => {
          const settings = JSON.parse(localStorage.getItem('__time_tracker_smoke_settings'));
          settings.language = '${locale}';
          localStorage.setItem('__time_tracker_smoke_settings', JSON.stringify(settings));
          globalThis.__PATINA_EMIT_TAURI_EVENT('app-settings-changed', { language: '${locale}' });
        })()`);
        await waitForExpression(client, sessionId, `(() => {
          const row = document.querySelector('[data-activity-rule-kind="category"]');
          return row?.querySelector('strong').textContent === ${jsonString(copy.categories.game)}
            && getComputedStyle(row.querySelector('.tools-activity-category-dot')).backgroundColor === 'rgb(18, 52, 86)';
        })()`, 10_000, "category labels refresh after language changes without losing their colors");
      }
      for (const viewport of [
        { width: 1377, height: 876, deviceScaleFactor: 1 },
        { width: 1024, height: 720, deviceScaleFactor: 1.25 },
        { width: 900, height: 650, deviceScaleFactor: 1.5 },
      ]) {
        await client.command("Emulation.setDeviceMetricsOverride", { ...viewport, mobile: false }, sessionId);
        let eventRowHeight = 0;
        for (const mode of ["event", "usage"]) {
          await evaluate(client, sessionId, `document.getElementById('tools-reminder-mode-tab-${mode}').click()`);
          await waitForExpression(client, sessionId, `
            document.querySelector('.tools-mode-pane')?.dataset.toolsReminderMode === ${jsonString(mode)}
              && document.querySelectorAll('.tools-reminder-row').length === 8
          `);
          const geometry = await evaluate(client, sessionId, `
            (() => {
              const list = document.querySelector('.tools-reminder-list.qp-scroll-region');
              list.scrollTop = 0;
              const rect = list.getBoundingClientRect();
              const row = list.firstElementChild.getBoundingClientRect();
              const frame = document.querySelector('.tools-reminder-list-section').lastElementChild.getBoundingClientRect();
              return {
                rowHeight: row.height, rowWidth: row.width,
                inset: { top: rect.top - frame.top, right: frame.right - rect.right, bottom: frame.bottom - rect.bottom },
                rowToScrollbarGap: Math.min(...[...list.children].map((row) =>
                  rect.left + list.clientLeft + list.clientWidth - row.getBoundingClientRect().right)),
                overflows: list.scrollHeight > list.clientHeight,
                horizontalOverflow: list.scrollWidth > list.clientWidth,
                fitsViewport: frame.right <= innerWidth && frame.bottom <= innerHeight,
                x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
              };
            })()
          `) as {
            rowHeight: number; rowWidth: number;
            inset: { top: number; right: number; bottom: number };
            rowToScrollbarGap: number;
            overflows: boolean; horizontalOverflow: boolean; fitsViewport: boolean; x: number; y: number;
          };
          const label = `${mode} at ${viewport.width}x${viewport.height}, DPI ${viewport.deviceScaleFactor}`;
          if (mode === "usage") {
            await waitForExpression(client, sessionId, `Boolean(document.querySelector('[data-activity-rule-kind="app"] img'))`);
            assert.deepEqual(await evaluate(client, sessionId, `(() => {
              const rect = document.querySelector('[data-activity-rule-kind="app"] img').getBoundingClientRect();
              return [rect.width, rect.height];
            })()`), [20, 20], `${label}: application images use the larger size`);
            assert.deepEqual(await evaluate(client, sessionId, `(() => {
              const categories = [...document.querySelectorAll('[data-activity-rule-kind="category"]')];
              return categories.map(row => {
                const icon = row.querySelector('.data-app-option-icon');
                const dot = icon.querySelector('.tools-activity-category-dot');
                const rect = dot?.getBoundingClientRect();
                const outer = icon.getBoundingClientRect();
                return { text: icon.textContent, width: rect?.width, height: rect?.height,
                  centered: Boolean(rect && Math.abs(rect.y + rect.height / 2 - outer.y - outer.height / 2) < 0.5),
                  border: getComputedStyle(icon).borderWidth };
              });
            })()`), [
              { text: "", width: 16, height: 16, centered: true, border: "0px" },
              { text: "", width: 16, height: 16, centered: true, border: "0px" },
            ], `${label}: known and unavailable categories keep centered dots instead of initials`);
          }
          assert.ok(geometry.rowHeight <= 48.5, `${label}: rows must keep the compact 48px height`);
          if (mode === "event") eventRowHeight = geometry.rowHeight;
          else assert.ok(Math.abs(geometry.rowHeight - eventRowHeight) <= 0.5, `${label}: both lists must have the same row height`);
          assert.ok(geometry.inset.top >= 8 && geometry.inset.bottom >= 8, `${label}: scrollbar must clear the rounded corners`);
          assert.ok(geometry.inset.right >= 4.5 && geometry.inset.right <= 5.5, `${label}: scrollbar must keep a compact inset from the outer border`);
          assert.ok(geometry.rowToScrollbarGap >= 3.5 && geometry.rowToScrollbarGap <= 4.5, `${label}: cards must leave a compact 4px gap before the scrollbar`);
          assert.equal(geometry.overflows, true, `${label}: fixture must require vertical scrolling`);
          assert.equal(geometry.horizontalOverflow, false, `${label}: rows must fit the scrollport`);
          assert.equal(geometry.fitsViewport, true, `${label}: frame must fit the window`);
          await client.command("Input.dispatchMouseEvent", {
            type: "mouseWheel", x: geometry.x, y: geometry.y, deltaX: 0, deltaY: 2000,
          }, sessionId);
          await waitForExpression(client, sessionId, `
            (() => {
              const list = document.querySelector('.tools-reminder-list');
              const rect = list.getBoundingClientRect();
              const last = list.lastElementChild.getBoundingClientRect();
              return list.scrollTop > 0 && last.top >= rect.top && last.bottom <= rect.bottom + 1;
            })()
          `, 10_000, `${label}: wheel scrolling must expose the complete last row`);
          await evaluate(client, sessionId, `
            (() => {
              const snapshot = JSON.parse(localStorage.getItem("__time_tracker_tools_snapshot_override"));
              globalThis.__PATINA_EMIT_TAURI_EVENT("tools-runtime-changed", {
                ...snapshot, reminders: snapshot.reminders.slice(0, 1),
                activity_reminder_rules: snapshot.activity_reminder_rules.slice(0, 1), sampled_at_ms: Date.now(),
              });
            })()
          `);
          await waitForExpression(client, sessionId, `document.querySelectorAll('.tools-reminder-row').length === 1`);
          const singleRow = await evaluate(client, sessionId, `
            (() => {
              const list = document.querySelector('.tools-reminder-list');
              const row = list.firstElementChild.getBoundingClientRect();
              return { width: row.width, height: row.height, overflows: list.scrollHeight > list.clientHeight };
            })()
          `) as { width: number; height: number; overflows: boolean };
          assert.equal(singleRow.overflows, false, `${label}: one row must not require a scrollbar`);
          assert.ok(Math.abs(singleRow.width - geometry.rowWidth) <= 0.5, `${label}: scrollbar visibility must not change card width`);
          assert.ok(Math.abs(singleRow.height - geometry.rowHeight) <= 0.5, `${label}: removing rows must not stretch the remaining card`);
          await evaluate(client, sessionId, `
            globalThis.__PATINA_EMIT_TAURI_EVENT("tools-runtime-changed", {
              ...JSON.parse(localStorage.getItem("__time_tracker_tools_snapshot_override")), sampled_at_ms: Date.now(),
            })
          `);
          await waitForExpression(client, sessionId, `document.querySelectorAll('.tools-reminder-row').length === 8`);
        }
      }
    } finally {
      await client.command("Emulation.setDeviceMetricsOverride", {
        width: 1280, height: 820, deviceScaleFactor: 1, mobile: false,
      }, sessionId);
      await evaluate(client, sessionId, `
        localStorage.clear();
        for (const [key, value] of Object.entries(${originalStorage})) localStorage.setItem(key, value);
        document.documentElement.dataset.patinaSmokeReload = "reminder-overflow-restored";
        location.reload();
      `);
      await waitForExpression(client, sessionId, `
        document.documentElement.dataset.patinaSmokeReload !== "reminder-overflow-restored"
          && Boolean(document.querySelector('main.qp-canvas'))
      `);
    }
  });
}
