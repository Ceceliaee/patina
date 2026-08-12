import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { delay, evaluate, jsonString, waitForAnimationFrames, waitForExpression } from "./browserHarness.ts";
import {
  APP_LOADING_VIEW,
  EXPECTED_NAV_LABELS,
  HISTORY_LOADING_VIEW,
  LONG_BACKGROUND_DELAY_MS,
  TOOLS_TEXT,
} from "./constants.ts";

type SidebarRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SidebarGeometry = {
  aside: SidebarRect;
  nav: SidebarRect;
  buttons: SidebarRect[];
  main: SidebarRect;
  menu: SidebarRect;
};

function assertRectClose(actual: SidebarRect, expected: SidebarRect, label: string) {
  for (const key of ["x", "y", "width", "height"] as const) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) <= 0.5,
      `${label}.${key} changed from ${expected[key]} to ${actual[key]}`,
    );
  }
}

function assertSidebarGeometryClose(actual: SidebarGeometry, expected: SidebarGeometry) {
  assertRectClose(actual.aside, expected.aside, "aside");
  assertRectClose(actual.nav, expected.nav, "nav");
  assertRectClose(actual.main, expected.main, "main");
  assertRectClose(actual.menu, expected.menu, "menu");
  assert.equal(actual.buttons.length, expected.buttons.length);
  actual.buttons.forEach((rect, index) => assertRectClose(rect, expected.buttons[index]!, `button[${index}]`));
}

async function dispatchActivationKey(
  context: Pick<BrowserSmokeContext, "client" | "sessionId">,
  key: "Enter" | " ",
) {
  const isEnter = key === "Enter";
  const code = isEnter ? "Enter" : "Space";
  const keyCode = isEnter ? 13 : 32;
  await context.client.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    text: isEnter ? "\r" : " ",
    unmodifiedText: isEnter ? "\r" : " ",
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  }, context.sessionId);
  await context.client.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  }, context.sessionId);
}

async function dispatchTabKey(context: Pick<BrowserSmokeContext, "client" | "sessionId">) {
  await context.client.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  }, context.sessionId);
  await context.client.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  }, context.sessionId);
}

export async function runNavigationScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("sidebar navigation labels toggle without geometry or navigation drift", async () => {
    await evaluate(client!, sessionId, `
      localStorage.removeItem("patina:sidebar-navigation-mode");
      localStorage.setItem("patina:last-active-view", "dashboard");
    `);
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1100,
      height: 736,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    const firstModeScript = await client!.command("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        globalThis.__PATINA_FIRST_SIDEBAR_MODE = null;
        new MutationObserver(() => {
          if (globalThis.__PATINA_FIRST_SIDEBAR_MODE !== null) return;
          const sidebar = document.querySelector("[data-sidebar-navigation-mode]");
          if (sidebar) {
            globalThis.__PATINA_FIRST_SIDEBAR_MODE = sidebar.getAttribute("data-sidebar-navigation-mode");
          }
        }).observe(document, { childList: true, subtree: true });
      `,
    }, sessionId) as { identifier: string };
    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode") === "icons"`,
      15_000,
      "Sidebar should default to icons mode",
    );

    const iconsState = await evaluate(client!, sessionId, `
      (() => {
        const aside = document.querySelector("[data-sidebar-navigation-mode]");
        const nav = document.querySelector("[data-sidebar-primary-nav]");
        const buttons = Array.from(document.querySelectorAll("[data-sidebar-nav-item]"));
        const main = document.querySelector("main.qp-canvas");
        const menu = document.querySelector('[aria-label="导航名称"]');
        const rect = (node) => {
          const value = node?.getBoundingClientRect();
          return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
        };
        return {
          geometry: {
            aside: rect(aside),
            nav: rect(nav),
            buttons: buttons.map(rect),
            main: rect(main),
            menu: rect(menu),
          },
          mode: aside?.getAttribute("data-sidebar-navigation-mode"),
          labels: Array.from(document.querySelectorAll("[data-sidebar-nav-label]")).map((node) => node.textContent),
          iconSizes: buttons.map((button) => button.querySelector("svg")?.getAttribute("width")),
          pressed: menu?.getAttribute("aria-pressed"),
          visuallyPressed: menu?.classList.contains("qp-icon-action-pressed") ?? false,
          current: document.querySelector('[aria-current="page"]')?.getAttribute("aria-label"),
          footerLast: document.querySelector("[data-sidebar-footer]")?.lastElementChild?.contains(menu) ?? false,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()
    `) as {
      geometry: SidebarGeometry;
      mode: string | null;
      labels: string[];
      iconSizes: Array<string | null>;
      pressed: string | null;
      visuallyPressed: boolean;
      current: string | null;
      footerLast: boolean;
      overflowX: number;
    };
    assert.equal(iconsState.mode, "icons");
    assert.deepEqual(iconsState.labels, []);
    assert.deepEqual(iconsState.iconSizes, Array(7).fill("18"));
    assert.equal(iconsState.pressed, "false");
    assert.equal(iconsState.visuallyPressed, false);
    assert.equal(iconsState.current, "今天");
    assert.equal(iconsState.footerLast, true);
    assert.ok(iconsState.overflowX <= 1);

    await evaluate(client!, sessionId, `document.querySelector('[data-sidebar-nav-item="dashboard"]')?.focus()`);
    const tabOrder: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      await dispatchTabKey(context);
      tabOrder.push(String(await evaluate(client!, sessionId, `document.activeElement?.getAttribute("aria-label") ?? ""`)));
    }
    assert.deepEqual(tabOrder, ["历史", "数据", "分类", "工具", "设置", "关于", "导航名称"]);

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const menu = document.querySelector('[aria-label="导航名称"]');
          globalThis.__PATINA_ACTIVE_NAV_NODE = document.querySelector('[aria-current="page"]');
          menu?.focus();
          menu?.click();
          return document.activeElement === menu;
        })()
      `),
      true,
      "Menu toggle should retain focus after click",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode") === "labeled"`,
    );
    await waitForAnimationFrames(client!, sessionId, 2);

    const labeledState = await evaluate(client!, sessionId, `
      (() => {
        const aside = document.querySelector("[data-sidebar-navigation-mode]");
        const nav = document.querySelector("[data-sidebar-primary-nav]");
        const buttons = Array.from(document.querySelectorAll("[data-sidebar-nav-item]"));
        const main = document.querySelector("main.qp-canvas");
        const menu = document.querySelector('[aria-label="导航名称"]');
        const labels = Array.from(document.querySelectorAll("[data-sidebar-nav-label]"));
        const rect = (node) => {
          const value = node?.getBoundingClientRect();
          return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
        };
        return {
          geometry: {
            aside: rect(aside),
            nav: rect(nav),
            buttons: buttons.map(rect),
            main: rect(main),
            menu: rect(menu),
          },
          labels: labels.map((node) => node.textContent),
          labelsFit: labels.every((node) => node.scrollWidth <= node.clientWidth + 1),
          verticalContent: buttons.every((button) => getComputedStyle(button.firstElementChild).flexDirection === "column"),
          iconSizes: buttons.map((button) => button.querySelector("svg")?.getAttribute("width")),
          pressed: menu?.getAttribute("aria-pressed"),
          visuallyPressed: menu?.classList.contains("qp-icon-action-pressed") ?? false,
          focused: document.activeElement === menu,
          current: document.querySelector('[aria-current="page"]')?.getAttribute("aria-label"),
          sameActiveNode: globalThis.__PATINA_ACTIVE_NAV_NODE === document.querySelector('[aria-current="page"]'),
          labelsHiddenFromName: labels.every((label) => label.getAttribute("aria-hidden") === "true"),
          iconsHiddenFromName: buttons.every((button) => button.querySelector("svg")?.getAttribute("aria-hidden") === "true"),
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()
    `) as {
      geometry: SidebarGeometry;
      labels: string[];
      labelsFit: boolean;
      verticalContent: boolean;
      iconSizes: Array<string | null>;
      pressed: string | null;
      visuallyPressed: boolean;
      focused: boolean;
      current: string | null;
      sameActiveNode: boolean;
      labelsHiddenFromName: boolean;
      iconsHiddenFromName: boolean;
      overflowX: number;
    };
    assertSidebarGeometryClose(labeledState.geometry, iconsState.geometry);
    assert.deepEqual(labeledState.labels, [...EXPECTED_NAV_LABELS]);
    assert.equal(labeledState.labelsFit, true);
    assert.equal(labeledState.verticalContent, true);
    assert.deepEqual(labeledState.iconSizes, Array(7).fill("15"));
    assert.equal(labeledState.pressed, "true");
    assert.equal(labeledState.visuallyPressed, false);
    assert.equal(labeledState.focused, true);
    assert.equal(labeledState.current, "今天");
    assert.equal(labeledState.sameActiveNode, true);
    assert.equal(labeledState.labelsHiddenFromName, true);
    assert.equal(labeledState.iconsHiddenFromName, true);
    assert.ok(labeledState.overflowX <= 1);
    assert.equal(
      await evaluate(client!, sessionId, `localStorage.getItem("patina:sidebar-navigation-mode")`),
      "labeled",
    );

    await evaluate(client!, sessionId, `
      (() => {
        const menu = document.querySelector('[aria-label="导航名称"]');
        menu?.blur();
        menu?.focus();
      })()
    `);
    await waitForAnimationFrames(client!, sessionId, 2);
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('[role="tooltip"]'))`),
      false,
      "Menu toggle should remain tooltip-free when focused",
    );
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    `);
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode")`),
      "labeled",
    );

    await dispatchActivationKey(context, " ");
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode") === "icons"`,
    );
    await waitForAnimationFrames(client!, sessionId, 2);
    const iconsAgainState = await evaluate(client!, sessionId, `
      (() => {
        const aside = document.querySelector("[data-sidebar-navigation-mode]");
        const nav = document.querySelector("[data-sidebar-primary-nav]");
        const buttons = Array.from(document.querySelectorAll("[data-sidebar-nav-item]"));
        const main = document.querySelector("main.qp-canvas");
        const menu = document.querySelector('[aria-label="导航名称"]');
        const rect = (node) => {
          const value = node?.getBoundingClientRect();
          return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
        };
        return {
          geometry: {
            aside: rect(aside),
            nav: rect(nav),
            buttons: buttons.map(rect),
            main: rect(main),
            menu: rect(menu),
          },
          labels: Array.from(document.querySelectorAll("[data-sidebar-nav-label]")).length,
          pressed: menu?.getAttribute("aria-pressed"),
          storedMode: localStorage.getItem("patina:sidebar-navigation-mode"),
        };
      })()
    `) as {
      geometry: SidebarGeometry;
      labels: number;
      pressed: string | null;
      storedMode: string | null;
    };
    assertSidebarGeometryClose(iconsAgainState.geometry, iconsState.geometry);
    assert.equal(iconsAgainState.labels, 0);
    assert.equal(iconsAgainState.pressed, "false");
    assert.equal(iconsAgainState.storedMode, "icons");

    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode") === "icons"`,
      undefined,
      "Icons mode should restore on reload without a labeled-first frame",
    );
    assert.equal(
      await evaluate(client!, sessionId, `globalThis.__PATINA_FIRST_SIDEBAR_MODE`),
      "icons",
    );
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="导航名称"]')?.focus()`);
    await dispatchActivationKey(context, "Enter");
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode") === "labeled"`,
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const history = document.querySelector('[aria-label="历史"]');
          history?.click();
          return Boolean(history);
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label="历史"]')?.getAttribute("aria-current") === "page"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode")`),
      "labeled",
    );

    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode") === "labeled"`,
      undefined,
      "Sidebar mode should restore on reload without an icons-first frame",
    );
    assert.equal(
      await evaluate(client!, sessionId, `globalThis.__PATINA_FIRST_SIDEBAR_MODE`),
      "labeled",
    );
    await client!.command("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: firstModeScript.identifier,
    }, sessionId);
    assert.deepEqual(
      await evaluate(client!, sessionId, `Array.from(document.querySelectorAll("[data-sidebar-nav-label]")).map((node) => node.textContent)`),
      [...EXPECTED_NAV_LABELS],
    );

    await evaluate(client!, sessionId, `
      localStorage.setItem("patina:sidebar-navigation-mode", "expanded");
      localStorage.setItem("patina:last-active-view", "dashboard");
    `);
    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode") === "icons"`,
      undefined,
      "Invalid sidebar mode should fall back to icons",
    );
    await evaluate(client!, sessionId, `localStorage.removeItem("patina:sidebar-navigation-mode")`);
  });

  await runTest("title bar hosts Tools and update while the sidebar footer stays Menu-only", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height: 636,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await evaluate(client!, sessionId, `
      (() => {
        const now = Date.now();
        localStorage.setItem("patina:sidebar-navigation-mode", "labeled");
        localStorage.setItem("__time_tracker_tools_snapshot_override", JSON.stringify({
          settings: {
            default_countdown_minutes: 25,
            pomodoro_focus_minutes: 25,
            pomodoro_short_break_minutes: 5,
            pomodoro_long_break_minutes: 15,
            pomodoro_long_break_every: 4,
          },
          reminders: [{
            id: 1,
            label: "Stand up",
            scheduled_at: now + 60_000,
            created_at: now - 10_000,
            status: "scheduled",
            fired_at: null,
            cancelled_at: null,
          }],
          activity_reminder_rules: [],
          current_timer: {
            id: 1,
            mode: "stopwatch",
            label: null,
            duration_ms: null,
            accumulated_ms: 0,
            started_at: now - 5_000,
            paused_at: null,
            completed_at: null,
            status: "running",
            created_at: now - 5_000,
            updated_at: now - 5_000,
          },
          timer_laps: [],
          current_pomodoro: {
            id: 1,
            phase: "focus",
            status: "running",
            cycle_index: 1,
            focus_ms: 1_500_000,
            short_break_ms: 300_000,
            long_break_ms: 900_000,
            long_break_every: 4,
            phase_started_at: now - 7_000,
            phase_paused_at: null,
            phase_remaining_ms: null,
            completed_focus_count: 0,
            created_at: now - 7_000,
            updated_at: now - 7_000,
          },
          today_completed_pomodoros: 0,
          next_reminder_at: now + 60_000,
          sampled_at_ms: now,
        }));
        localStorage.setItem("__time_tracker_update_snapshot_override", JSON.stringify({
          current_version: "1.0.0",
          status: "available",
          latest_version: "1.1.0",
          release_notes: null,
          release_date: null,
          error_message: null,
          error_stage: null,
          downloaded_bytes: null,
          total_bytes: null,
          release_page_url: "https://example.com/release",
          asset_download_url: "https://example.com/download",
        }));
      })()
    `);
    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-sidebar-footer]")?.children.length === 1
        && document.querySelectorAll("[data-titlebar-tools-status] .tools-status-entry-titlebar-item").length === 3
        && Boolean(document.querySelector("[data-titlebar-update-entry]"))`,
      undefined,
      "Title bar entries should render while the sidebar footer stays Menu-only",
    );
    const shellEntryState = await evaluate(client!, sessionId, `
      (() => {
        const aside = document.querySelector("[data-sidebar-navigation-mode]");
        const nav = document.querySelector("[data-sidebar-primary-nav]");
        const footer = document.querySelector("[data-sidebar-footer]");
        const menu = document.querySelector('[aria-label="导航名称"]');
        const titlebar = document.querySelector(".app-titlebar");
        const brand = document.querySelector(".app-titlebar-brand");
        const update = document.querySelector("[data-titlebar-update-entry]");
        const dragRegion = document.querySelector(".app-titlebar-drag-region");
        const tools = document.querySelector("[data-titlebar-tools-status]");
        const controls = document.querySelector(".app-titlebar-controls");
        const toolButtons = Array.from(document.querySelectorAll(
          "[data-titlebar-tools-status] .tools-status-entry-titlebar-item",
        ));
        const rect = (node) => {
          const value = node?.getBoundingClientRect();
          return value ? {
            top: value.top,
            bottom: value.bottom,
            left: value.left,
            right: value.right,
            width: value.width,
            height: value.height,
          } : null;
        };
        const titlebarRect = rect(titlebar);
        const updateRect = rect(update);
        const toolsRect = rect(tools);
        const controlsRect = rect(controls);
        const navRect = nav?.getBoundingClientRect();
        return {
          footerCount: footer?.children.length ?? 0,
          footerMenuOnly: footer?.firstElementChild?.contains(menu) ?? false,
          updateAfterBrand: brand?.nextElementSibling === update,
          toolsBeforeControls: tools?.nextElementSibling === controls,
          titlebarOrder: Boolean(updateRect && toolsRect && controlsRect)
            && updateRect.right <= toolsRect.left
            && toolsRect.right <= controlsRect.left,
          entriesInsideTitlebar: Boolean(titlebarRect && updateRect && toolsRect)
            && updateRect.top >= titlebarRect.top
            && updateRect.bottom <= titlebarRect.bottom
            && toolsRect.top >= titlebarRect.top
            && toolsRect.bottom <= titlebarRect.bottom,
          dragWidth: rect(dragRegion)?.width ?? 0,
          toolButtonCount: toolButtons.length,
          toolButtonSizes: toolButtons.map((button) => rect(button)),
          toolButtonsUndecorated: toolButtons.every((button) => {
            const style = getComputedStyle(button);
            return style.backgroundColor === "rgba(0, 0, 0, 0)"
              && style.borderTopColor === "rgba(0, 0, 0, 0)";
          }),
          navHeight: navRect?.height,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()
    `) as {
      footerCount: number;
      footerMenuOnly: boolean;
      updateAfterBrand: boolean;
      toolsBeforeControls: boolean;
      titlebarOrder: boolean;
      entriesInsideTitlebar: boolean;
      dragWidth: number;
      toolButtonCount: number;
      toolButtonSizes: Array<{ width: number; height: number } | null>;
      toolButtonsUndecorated: boolean;
      navHeight: number;
      overflowX: number;
    };
    assert.equal(shellEntryState.footerCount, 1);
    assert.equal(shellEntryState.footerMenuOnly, true);
    assert.equal(shellEntryState.updateAfterBrand, true);
    assert.equal(shellEntryState.toolsBeforeControls, true);
    assert.equal(shellEntryState.titlebarOrder, true);
    assert.equal(shellEntryState.entriesInsideTitlebar, true);
    assert.ok(shellEntryState.dragWidth >= 24);
    assert.equal(shellEntryState.toolButtonCount, 3);
    assert.equal(shellEntryState.toolButtonsUndecorated, true);
    shellEntryState.toolButtonSizes.forEach((buttonRect) => {
      assert.ok(buttonRect);
      assert.ok(Math.abs(buttonRect.width - 28) <= 0.5);
      assert.ok(Math.abs(buttonRect.height - 28) <= 0.5);
    });
    assert.ok(Math.abs(shellEntryState.navHeight - 340) <= 0.5);
    assert.ok(shellEntryState.overflowX <= 1);

    const firstToolStatusCenter = await evaluate(client!, sessionId, `
      (() => {
        const rect = document.querySelector(
          "[data-titlebar-tools-status] .tools-status-entry-titlebar-item",
        )?.getBoundingClientRect();
        return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
      })()
    `) as { x: number; y: number } | null;
    assert.ok(firstToolStatusCenter);
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: firstToolStatusCenter.x,
      y: firstToolStatusCenter.y,
    }, sessionId);
    await waitForAnimationFrames(client!, sessionId, 2);
    const toolStatusHoverState = await evaluate(client!, sessionId, `
      (() => {
        const group = document.querySelector("[data-titlebar-tools-status]");
        const button = group?.querySelector(".tools-status-entry-titlebar-item");
        if (!group || !button) return null;
        const groupStyle = getComputedStyle(group);
        const buttonStyle = getComputedStyle(button);
        return {
          groupUndecorated: groupStyle.backgroundColor === "rgba(0, 0, 0, 0)"
            && groupStyle.borderTopStyle === "none",
          buttonHasQuietHover: buttonStyle.backgroundColor !== "rgba(0, 0, 0, 0)"
            && buttonStyle.borderTopColor === "rgba(0, 0, 0, 0)",
        };
      })()
    `) as { groupUndecorated: boolean; buttonHasQuietHover: boolean } | null;
    assert.deepEqual(toolStatusHoverState, {
      groupUndecorated: true,
      buttonHasQuietHover: true,
    });
    await client!.command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 0,
      y: 0,
    }, sessionId);

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const firstToolStatus = document.querySelector(
            "[data-titlebar-tools-status] .tools-status-entry-titlebar-item",
          );
          firstToolStatus?.click();
          return Boolean(firstToolStatus);
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.remindersTitle))} + ']')
        ?.getAttribute("aria-pressed") === "true"`,
      undefined,
      "The first title bar status should open its matching Tools section",
    );

    await evaluate(client!, sessionId, `
      localStorage.removeItem("__time_tracker_tools_snapshot_override");
      localStorage.removeItem("__time_tracker_update_snapshot_override");
      localStorage.removeItem("patina:sidebar-navigation-mode");
    `);
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode") === "icons"`,
    );
  });

  await runTest("warm primary navigation avoids app loading after startup warmup", async () => {
    // This is the behavior under test: the time-budgeted startup warmup should
    // have completed before navigation. Other synchronization uses conditions.
    await delay(4_000);

    for (const label of EXPECTED_NAV_LABELS.slice(1)) {
      const clicked = await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `);
      assert.equal(clicked, true, `missing navigation entry ${label}`);
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']')?.className.includes("qp-nav-item-active")`,
      );
      assert.equal(
        await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`),
        false,
        `unexpected app loading view after clicking ${label}`,
      );
    }
  });

  await runTest("warm navigation records response and blank-frame evidence", async () => {
    const samples: Array<{
      label: string;
      activeMs: number;
      structureMs: number;
      blankFrames: number;
    }> = [];
    const labels = ["今天", "历史", "数据", "分类"];
    for (let cycle = 0; cycle < 5; cycle += 1) {
      for (const label of labels) {
        const sample = await evaluate(client!, sessionId, `
          (async () => {
            const label = ${jsonString(label)};
            const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']');
            if (!node) return null;
            const startedAt = performance.now();
            let activeAt = null;
            let structureAt = null;
            let blankFrames = 0;
            node.click();
            for (let frame = 0; frame < 120; frame += 1) {
              await new Promise((resolve) => requestAnimationFrame(resolve));
              const canvas = document.querySelector("main.qp-canvas");
              if (!canvas || canvas.childElementCount === 0) blankFrames += 1;
              if (structureAt === null && canvas && canvas.childElementCount > 0) {
                structureAt = performance.now();
              }
              if (activeAt === null && node.className.includes("qp-nav-item-active")) {
                activeAt = performance.now();
              }
              if (activeAt !== null && frame >= 4) break;
            }
            return {
              label,
              activeMs: (activeAt ?? performance.now()) - startedAt,
              structureMs: (structureAt ?? performance.now()) - startedAt,
              blankFrames,
            };
          })()
        `) as { label: string; activeMs: number; structureMs: number; blankFrames: number } | null;
        assert.ok(sample, `missing navigation sample for ${label}`);
        samples.push(sample);
      }
    }
    const percentile = (values: number[], fraction: number) => {
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
    };
    const activeValues = samples.map((sample) => sample.activeMs);
    const structureValues = samples.map((sample) => sample.structureMs);
    const maxBlankFrames = Math.max(...samples.map((sample) => sample.blankFrames));
    console.log(`PATINA_NAVIGATION_EXPERIENCE_REPORT:${JSON.stringify({
      environment: "Vite browser smoke with Tauri stubs; recommendation evidence, not a release hard gate",
      sampleCount: samples.length,
      activeP50Ms: percentile(activeValues, 0.5),
      activeP95Ms: percentile(activeValues, 0.95),
      activeMaxMs: Math.max(...activeValues),
      structureP50Ms: percentile(structureValues, 0.5),
      structureP95Ms: percentile(structureValues, 0.95),
      structureMaxMs: Math.max(...structureValues),
      maxBlankFrames,
    })}`);
    assert.equal(maxBlankFrames, 0, "warm navigation should never expose a blank canvas frame");
  });

  await runTest("Data navigation is immediate and avoids visible loading affordances", async () => {
    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
      ),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(HISTORY_LOADING_VIEW)})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector(".data-heatmap-skeleton"))`),
      false,
    );
  });

  await runTest("History navigation is immediate and avoids visible loading copy", async () => {
    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
      ),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(HISTORY_LOADING_VIEW)})`),
      false,
    );
  });

  await runTest("History date changes retain the presented day until the next snapshot is ready", async () => {
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") === "ready"`,
      15_000,
      "History should be ready before changing dates",
    );
    await evaluate(
      client!,
      sessionId,
      `localStorage.setItem("__time_tracker_history_query_delay_ms", "900")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const root = document.querySelector("[data-history-content-state]");
          globalThis.__TIME_TRACKER_HISTORY_PRESENTED_BEFORE_CHANGE = {
            date: root?.getAttribute("data-history-content-date") ?? "",
            label: document.querySelector(".history-date-label")?.textContent?.trim() ?? "",
            summary: document.querySelector(".history-day-summary-value")?.textContent?.trim() ?? "",
            segmentCount: document.querySelectorAll(".history-horizontal-timeline-segment").length,
          };
          const dateLabel = document.querySelector(".history-date-label");
          const previousButton = dateLabel?.parentElement?.parentElement?.querySelector("button");
          previousButton?.click();
          return Boolean(previousButton);
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        const root = document.querySelector("[data-history-content-state]");
        return root?.getAttribute("data-history-content-state") === "refreshing"
          && root.getAttribute("data-history-content-date") === globalThis.__TIME_TRACKER_HISTORY_PRESENTED_BEFORE_CHANGE.date;
      })()`,
      undefined,
      "History should retain its presented date while the previous date loads",
    );
    await delay(150);

    const retainedPresentation = await evaluate(client!, sessionId, `
      (() => {
        const root = document.querySelector("[data-history-content-state]");
        return {
          date: root?.getAttribute("data-history-content-date") ?? "",
          label: document.querySelector(".history-date-label")?.textContent?.trim() ?? "",
          summary: document.querySelector(".history-day-summary-value")?.textContent?.trim() ?? "",
          segmentCount: document.querySelectorAll(".history-horizontal-timeline-segment").length,
          loading: document.body.innerText.includes(${jsonString(HISTORY_LOADING_VIEW)}),
        };
      })()
    `) as {
      date: string;
      label: string;
      summary: string;
      segmentCount: number;
      loading: boolean;
    };
    const presentationBeforeChange = await evaluate(
      client!,
      sessionId,
      `globalThis.__TIME_TRACKER_HISTORY_PRESENTED_BEFORE_CHANGE`,
    ) as Omit<typeof retainedPresentation, "loading">;
    assert.deepEqual(
      {
        date: retainedPresentation.date,
        label: retainedPresentation.label,
        summary: retainedPresentation.summary,
        segmentCount: retainedPresentation.segmentCount,
      },
      presentationBeforeChange,
    );
    assert.equal(retainedPresentation.loading, false);

    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        const root = document.querySelector("[data-history-content-state]");
        return root?.getAttribute("data-history-content-state") === "ready"
          && root.getAttribute("data-history-content-date") !== globalThis.__TIME_TRACKER_HISTORY_PRESENTED_BEFORE_CHANGE.date;
      })()`,
      15_000,
      "Previous History date should replace the retained presentation once ready",
    );
    await evaluate(client!, sessionId, `
      (() => {
        localStorage.removeItem("__time_tracker_history_query_delay_ms");
        const dateLabel = document.querySelector(".history-date-label");
        const buttons = dateLabel?.parentElement?.parentElement?.querySelectorAll("button");
        buttons?.item(buttons.length - 1).click();
      })()
    `);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") === "ready"`,
      15_000,
      "History should return to today",
    );
  });

  await runTest("History reuses its compact first-screen snapshot during a slow refresh", async () => {
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}")["history.bootstrap_snapshot.v1"])`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!node) return false;
          node.click();
          localStorage.setItem("__time_tracker_history_query_delay_ms", "900");
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

    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']')?.className.includes("qp-nav-item-active")`,
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
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        const state = document.querySelector("[data-history-content-state]")
          ?.getAttribute("data-history-content-state");
        return (state === "bootstrap" || state === "refreshing")
          && document.querySelectorAll(".history-horizontal-timeline-segment").length >= 1;
      })()`,
      undefined,
      "History reusable snapshot should render before the delayed refresh settles",
    );

    const slowRefreshState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => {
        const root = document.querySelector("[data-history-content-state]");
        return JSON.stringify({
          state: root?.getAttribute("data-history-content-state") ?? null,
          segmentCount: document.querySelectorAll(".history-horizontal-timeline-segment").length,
          showsLoadingCopy: document.body.innerText.includes(${jsonString(HISTORY_LOADING_VIEW)}),
        });
      })()
    `))) as { state: string | null; segmentCount: number; showsLoadingCopy: boolean };
    assert.ok(
      slowRefreshState.state === "bootstrap" || slowRefreshState.state === "refreshing",
      `expected reusable History content during delayed refresh, got ${JSON.stringify(slowRefreshState)}`,
    );
    assert.ok(slowRefreshState.segmentCount >= 1, JSON.stringify(slowRefreshState));
    assert.equal(slowRefreshState.showsLoadingCopy, false);

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") === "ready"`,
      15_000,
      "History delayed refresh should settle",
    );
    await evaluate(client!, sessionId, `localStorage.removeItem("__time_tracker_history_query_delay_ms")`);
  });

  await runTest("History cold bootstrap reuses today's ready Dashboard sessions", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!node) return false;
          node.click();
          const settings = JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}");
          delete settings["history.bootstrap_snapshot.v1"];
          localStorage.setItem("__time_tracker_smoke_settings", JSON.stringify(settings));
          localStorage.removeItem("__time_tracker_history_query_delay_ms");
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `localStorage.getItem("patina:last-active-view") === "dashboard"`,
      undefined,
      "Dashboard navigation should persist before the simulated WebView reload",
    );
    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".dashboard-top-app-progress").length >= 1`,
    );
    await evaluate(
      client!,
      sessionId,
      `localStorage.setItem("__time_tracker_history_query_delay_ms", "900")`,
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
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") === "bootstrap"
        && !["—", "0m"].includes(document.querySelector(".history-day-summary-value")?.textContent?.trim() ?? "")`,
      undefined,
      "History should mount the Dashboard aggregate seed before the delayed detail query settles",
    );

    const coldState = JSON.parse(String(await evaluate(client!, sessionId, `
      (() => JSON.stringify({
        state: document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") ?? null,
        activeDuration: document.querySelector(".history-day-summary-value")?.textContent?.trim() ?? null,
        statusText: document.querySelector(".history-app-distribution-card [role=status]")?.textContent?.trim() ?? null,
        timelineText: document.querySelector(".history-horizontal-timeline-empty")?.textContent?.trim() ?? null,
        segmentCount: document.querySelectorAll(".history-horizontal-timeline-segment").length,
      }))()
    `))) as {
      state: string | null;
      activeDuration: string | null;
      statusText: string | null;
      timelineText: string | null;
      segmentCount: number;
    };
    assert.equal(coldState.state, "bootstrap");
    assert.notEqual(coldState.activeDuration, "—");
    assert.notEqual(coldState.activeDuration, "0m");
    assert.equal(coldState.statusText, null);
    assert.equal(coldState.timelineText, "");
    assert.equal(coldState.segmentCount, 0, JSON.stringify(coldState));

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-history-content-state]")?.getAttribute("data-history-content-state") === "ready"`,
      15_000,
      "History cold query should settle",
    );
    await evaluate(client!, sessionId, `localStorage.removeItem("__time_tracker_history_query_delay_ms")`);
  });

  await runTest("short background return keeps Data active", async () => {
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
    await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: false, focused: false });`);
    await waitForAnimationFrames(client!, sessionId);
    await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: true, focused: false });`);
    await waitForAnimationFrames(client!, sessionId);
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
      ),
      true,
    );
  });

  await runTest("long background return preserves the active browsing view", async () => {
    const simulateLongBackgroundReturn = async (label: string) => {
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']');
            if (!node) return false;
            node.click();
            return true;
          })()
        `),
        true,
        `missing navigation entry ${label}`,
      );
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']')?.className.includes("qp-nav-item-active")`,
      );
      await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: false, focused: false });`);
      await waitForAnimationFrames(client!, sessionId);
      await evaluate(client!, sessionId, `
        (() => {
          const originalNow = Date.now;
          Date.now = () => originalNow() + ${LONG_BACKGROUND_DELAY_MS + 1};
          globalThis.__TIME_TRACKER_RESTORE_NOW = () => {
            Date.now = originalNow;
            delete globalThis.__TIME_TRACKER_RESTORE_NOW;
          };
          globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: true, focused: false });
        })()
      `);
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']')?.className.includes("qp-nav-item-active")`,
      );
      assert.equal(
        await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`),
        false,
      );
      await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_RESTORE_NOW?.();`);
    };

    await simulateLongBackgroundReturn("数据");
    await simulateLongBackgroundReturn("历史");
  });

  await runTest("rebuilt main window reveals only after saved appearance and destination settle", async () => {
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
      `document.querySelector("main.qp-canvas")?.dataset.presentedView === "data"
        && document.querySelector("main.qp-canvas")?.dataset.viewTransitionState === "settled"`,
    );
    await evaluate(client!, sessionId, `
      (() => {
        const key = "__time_tracker_smoke_settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        settings.theme_mode = "dark";
        settings.color_scheme_dark = "default";
        localStorage.setItem(key, JSON.stringify(settings));
      })()
    `);

    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE)`,
      15_000,
      "rebuilt dark Data window readiness",
    );
    const evidence = await evaluate(
      client!,
      sessionId,
      `globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE`,
    ) as {
      themeMode: string | null;
      theme: string | null;
      presentedView: string | null;
    };
    assert.equal(evidence.themeMode, "dark");
    assert.equal(evidence.theme, "dark");
    assert.equal(evidence.presentedView, "data");

    await evaluate(client!, sessionId, `
      (() => {
        const key = "__time_tracker_smoke_settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        settings.theme_mode = "light";
        localStorage.setItem(key, JSON.stringify(settings));
        localStorage.setItem("patina:last-active-view", "dashboard");
      })()
    `);
    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE?.theme === "light"
        && globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE?.presentedView === "dashboard"`,
      15_000,
      "restore browser smoke appearance and destination",
    );
  });
}
