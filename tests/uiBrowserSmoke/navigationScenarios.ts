import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { delay, evaluate, jsonString, waitForAnimationFrames, waitForExpression } from "./browserHarness.ts";
import {
  APP_LOADING_VIEW,
  EXPECTED_NAV_LABELS,
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
      localStorage.setItem("patina:last-active-view", "tools");
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
    assert.deepEqual(iconsState.iconSizes, Array(EXPECTED_NAV_LABELS.length).fill("18"));
    assert.equal(iconsState.pressed, "false");
    assert.equal(iconsState.visuallyPressed, false);
    assert.equal(iconsState.current, "工具");
    assert.equal(iconsState.footerLast, true);
    assert.ok(iconsState.overflowX <= 1);

    await evaluate(client!, sessionId, `document.querySelector('[data-sidebar-nav-item="tools"]')?.focus()`);
    const tabOrder: string[] = [];
    for (let index = 0; index < EXPECTED_NAV_LABELS.length; index += 1) {
      await dispatchTabKey(context);
      tabOrder.push(String(await evaluate(client!, sessionId, `document.activeElement?.getAttribute("aria-label") ?? ""`)));
    }
    assert.deepEqual(tabOrder, ["导航名称"]);

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
    assert.deepEqual(labeledState.iconSizes, Array(EXPECTED_NAV_LABELS.length).fill("15"));
    assert.equal(labeledState.pressed, "true");
    assert.equal(labeledState.visuallyPressed, false);
    assert.equal(labeledState.focused, true);
    assert.equal(labeledState.current, "工具");
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
          const settings = document.querySelector('[aria-label="工具"]');
          settings?.click();
          return Boolean(settings);
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label="工具"]')?.getAttribute("aria-current") === "page"`,
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
      localStorage.setItem("patina:last-active-view", "tools");
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

  await runTest("warm primary navigation avoids app loading after startup warmup", async () => {
    // This is the behavior under test: the time-budgeted startup warmup should
    // have completed before navigation. Other synchronization uses conditions.
    await delay(4_000);

    for (const label of EXPECTED_NAV_LABELS) {
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

  await runTest("rebuilt main window reveals only after saved appearance and destination settle", async () => {
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
      `document.querySelector("main.qp-canvas")?.dataset.presentedView === "tools"
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
      "rebuilt dark Tools window readiness",
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
    assert.equal(evidence.presentedView, "tools");

    await evaluate(client!, sessionId, `
      (() => {
        const key = "__time_tracker_smoke_settings";
        const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
        settings.theme_mode = "light";
        localStorage.setItem(key, JSON.stringify(settings));
        localStorage.setItem("patina:last-active-view", "tools");
      })()
    `);
    await client!.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE?.theme === "light"
        && globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE?.presentedView === "tools"`,
      15_000,
      "restore browser smoke appearance and destination",
    );
  });
}
