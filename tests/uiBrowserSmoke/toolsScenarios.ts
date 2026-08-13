import assert from "node:assert/strict";
import { getLocaleText } from "../../src/shared/i18n/runtime.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { delay, evaluate, jsonString, waitForExpression } from "./browserHarness.ts";
import { TOOLS_TEXT } from "./constants.ts";

const COPY = { "zh-CN": getLocaleText("zh-CN") } as const;

export async function runToolsScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("Tools cold navigation keeps the current view until a runtime snapshot is ready", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          localStorage.setItem("patina:last-active-view", "dashboard");
          localStorage.setItem("__time_tracker_tools_snapshot_delay_ms", "900");
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
        && Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']'))`,
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
    await delay(150);
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
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.subtitle)})`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.reminderEmpty)})`,
    );

    for (const marker of [
      TOOLS_TEXT.remindersTitle,
      TOOLS_TEXT.timerTitle,
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
        && document.querySelectorAll('[data-tools-section-label]').length === 3`,
      undefined,
      "Menu should reveal all three Tools section labels",
    );
    const labeledModeState = await evaluate(client!, sessionId, `
      (() => {
        const rect = (node) => {
          const value = node?.getBoundingClientRect();
          return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
        };
        const rail = document.querySelector('[data-tools-navigation-mode="labeled"]');
        const tabs = Array.from(document.querySelectorAll('.tools-section-tab'));
        const sectionTabs = tabs.slice(0, 3);
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
      TOOLS_TEXT.timerTitle,
      TOOLS_TEXT.pomodoroTitle,
    ]);
    assert.equal(labeledModeState.labelsFit, true);
    assert.deepEqual(labeledModeState.iconSizes, ["15", "15", "15"]);
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
      TOOLS_TEXT.reminderModeApp,
      TOOLS_TEXT.reminderModeCategory,
      TOOLS_TEXT.reminderModeWeb,
    ] as const) {
      assert.equal(
        await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(marker)})`),
        true,
        `missing visible Tools panel marker ${marker}`,
      );
    }

    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('.tools-reminder-form input[type="number"][max="1440"]');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return input.value === '';
        })()
      `),
      true,
      "relative reminder minutes should be clearable while editing",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('.tools-reminder-form input[type="number"][max="1440"]');
          const create = document.querySelector('.tools-reminder-form .tools-action-button');
          if (!input || !create) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '0');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return Boolean(create.disabled)
            && !document.body.innerText.includes(${jsonString(TOOLS_TEXT.reminderTimeInvalid)});
        })()
      `),
      true,
      "relative reminder should disable create for zero minutes",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const absolute = Array.from(document.querySelectorAll('button'))
            .find((node) => node.textContent?.trim() === ${jsonString(TOOLS_TEXT.reminderModeAbsolute)});
          if (!absolute) return false;
          absolute.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const create = document.querySelector('.tools-reminder-form .tools-action-button');
          return Boolean(create?.disabled)
            && !document.body.innerText.includes(${jsonString(TOOLS_TEXT.reminderTimeInvalid)});
        })()
      `),
      true,
      "absolute reminder should disable create for the current minute",
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('.qp-date-picker-trigger');
          if (!trigger) return false;
          trigger.focus();
          trigger.click();
          return true;
        })()
      `),
      true,
      "missing date picker trigger",
    );
    await waitForExpression(client!, sessionId, `document.activeElement?.classList.contains('qp-calendar-day')`);
    const initialFocusedDate = await evaluate(client!, sessionId, `document.activeElement?.getAttribute('data-calendar-date')`);
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.classList.contains('qp-calendar-day') && document.activeElement?.getAttribute('data-calendar-date') !== ${jsonString(String(initialFocusedDate))}`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelectorAll('.qp-calendar-day[tabindex="0"]').length`),
      1,
      "date picker should expose one roving tab stop",
    );
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.qp-calendar-popover')`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.classList.contains('qp-date-picker-trigger')`,
      undefined,
      "date picker trigger focus restoration",
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector('.qp-time-picker-trigger');
          if (!trigger) return false;
          trigger.focus();
          trigger.click();
          return true;
        })()
      `),
      true,
      "missing time picker trigger",
    );
    await waitForExpression(client!, sessionId, `document.activeElement?.getAttribute('data-time-picker-part') === 'hour'`);
    const initialFocusedHour = await evaluate(client!, sessionId, `document.activeElement?.getAttribute('data-time-picker-value')`);
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.getAttribute('data-time-picker-part') === 'hour' && document.activeElement?.getAttribute('data-time-picker-value') !== ${jsonString(String(initialFocusedHour))}`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelectorAll('.qp-time-picker-option[tabindex="0"]').length`),
      2,
      "time picker should expose one roving tab stop per listbox",
    );
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('.qp-time-picker-popover')`);
    await waitForExpression(
      client!,
      sessionId,
      `document.activeElement?.classList.contains('qp-time-picker-trigger')`,
      undefined,
      "time picker trigger focus restoration",
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const appMode = Array.from(document.querySelectorAll('button'))
            .find((node) => node.textContent?.trim() === ${jsonString(TOOLS_TEXT.reminderModeApp)});
          if (!appMode) return false;
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
      `Boolean(document.querySelector('input[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.activityReminderAppPlaceholder))} + ']'))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const input = document.querySelector('input[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.activityReminderAppPlaceholder))} + ']');
          if (!(input instanceof HTMLInputElement)) return false;
          input.focus();
          return true;
        })()
      `),
      true,
      "missing the activity reminder app search field",
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

    for (const [modeLabel, placeholder] of [
      [TOOLS_TEXT.reminderModeCategory, TOOLS_TEXT.activityReminderCategoryPlaceholder],
      [TOOLS_TEXT.reminderModeWeb, TOOLS_TEXT.activityReminderWebPlaceholder],
    ] as const) {
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const mode = Array.from(document.querySelectorAll('button'))
              .find((node) => node.textContent?.trim() === ${jsonString(modeLabel)});
            if (!mode) return false;
            mode.click();
            return true;
          })()
        `),
        true,
      );
      await waitForExpression(
        client!,
        sessionId,
        `Boolean(document.querySelector('input[aria-label=' + ${jsonString(JSON.stringify(placeholder))} + ']'))`,
      );
      assert.equal(
        await evaluate(
          client!,
          sessionId,
          `Boolean(document.querySelector('input[aria-label=' + ${jsonString(JSON.stringify(placeholder))} + ']')?.closest('.tools-activity-target-search'))`,
        ),
        true,
        `${modeLabel} should reuse the activity reminder search picker shell`,
      );
      if (modeLabel === TOOLS_TEXT.reminderModeCategory) {
        await evaluate(client!, sessionId, `
          document.querySelector('input[aria-label=' + ${jsonString(JSON.stringify(placeholder))} + ']')?.focus()
        `);
        await waitForExpression(
          client!,
          sessionId,
          `Boolean(document.querySelector('.tools-activity-target-candidate-list .tools-activity-category-dot'))`,
        );
        assert.equal(
          await evaluate(client!, sessionId, `
            (() => {
              const markers = Array.from(document.querySelectorAll('[data-activity-category-marker]'));
              const colors = markers
                .map((marker) => marker.querySelector('.tools-activity-category-dot'))
                .filter(Boolean)
                .map((dot) => getComputedStyle(dot).backgroundColor);
              return markers.length >= 2
                && markers.every((marker) => {
                  const style = getComputedStyle(marker);
                  return style.borderTopStyle !== 'none'
                    && style.borderTopColor !== 'rgba(0, 0, 0, 0)'
                    && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
                })
                && colors.every((color) => color !== 'rgba(0, 0, 0, 0)')
                && new Set(colors).size >= 2;
            })()
          `),
          true,
          "category targets should keep the Quiet Pro icon tile and use distinct semantic colors",
        );
      }
    }

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const timer = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.timerTitle))} + ']');
          if (!timer) return false;
          timer.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.timerModeStopwatch)})`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const countdown = Array.from(document.querySelectorAll('button'))
            .find((node) => node.textContent?.trim() === ${jsonString(TOOLS_TEXT.timerModeCountdown)});
          if (!countdown) return false;
          countdown.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const input = document.querySelector('#tools-countdown-duration');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return input.value === '';
        })()
      `),
      true,
      "countdown duration should be clearable while editing",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('#tools-countdown-duration');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '0');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const start = document.querySelector('[data-tools-section="timer"] .tools-action-row .qp-button-primary');
          return Boolean(start?.disabled);
        })()
      `),
      true,
      "countdown duration should reject zero minutes",
    );

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
          const start = document.querySelector('[data-tools-section="pomodoro"] .tools-action-row .qp-button-primary');
          return Boolean(start?.disabled);
        })()
      `),
      true,
      "pomodoro duration should reject zero minutes",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const fields = [
            ['#tools-pomodoro-focus', '25'],
            ['#tools-pomodoro-short-break', '5'],
            ['#tools-pomodoro-long-break', '15'],
            ['#tools-pomodoro-long-break-every', '4'],
          ];
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          for (const [selector, value] of fields) {
            const input = document.querySelector(selector);
            if (!input) return false;
            setter?.call(input, value === '25' ? '0' : '');
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const restore = document.querySelector(
            '[aria-label=' + ${jsonString(JSON.stringify(COPY["zh-CN"].accessibility.tools.restorePomodoroDefaults))} + ']'
          );
          if (!restore || restore.textContent?.trim() || restore.hasAttribute('title')) return false;
          const titleGroup = restore.closest('.tools-subpanel-title-action');
          const title = titleGroup?.querySelector('h3');
          if (!title || title.textContent?.trim() !== ${jsonString(TOOLS_TEXT.pomodoroSettings)}) return false;
          const titleRect = title.getBoundingClientRect();
          const restoreRect = restore.getBoundingClientRect();
          if (restoreRect.left < titleRect.right || restoreRect.left - titleRect.right > 12) return false;
          restore.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const start = document.querySelector('[data-tools-section="pomodoro"] .tools-action-row .qp-button-primary');
          return fields.every(([selector, value]) => document.querySelector(selector)?.value === value)
            && !start?.disabled;
        })()
      `),
      true,
      "pomodoro default icon restores editable durations",
    );
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

  await runTest("Tools settings remains an accessible localized empty dialog", async () => {
    const triggerLabel = COPY["zh-CN"].tools.settingsTitle;
    assert.equal(await evaluate(client!, sessionId, `
      (() => {
        const trigger = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(triggerLabel))} + ']');
        if (!(trigger instanceof HTMLButtonElement)) return false;
        trigger.focus();
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
        empty: document.querySelector('.tools-settings-empty')?.textContent?.trim() ?? null,
        hasSwitch: Boolean(document.querySelector('[role="dialog"] [role="switch"]')),
        hasTaskbarCopy: document.querySelector('[role="dialog"]')?.textContent?.includes('任务栏') ?? false,
      }))()
    `) as { empty: string | null; hasSwitch: boolean; hasTaskbarCopy: boolean };
    assert.deepEqual(dialog, {
      empty: COPY["zh-CN"].tools.settingsEmpty,
      hasSwitch: false,
      hasTaskbarCopy: false,
    });

    await evaluate(client!, sessionId, `
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector('[role="dialog"]')`);
    await waitForExpression(client!, sessionId, `document.activeElement?.getAttribute('aria-label') === ${jsonString(triggerLabel)}`,
      15_000, "Tools settings focus restoration");
  });
}
