import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import {
  evaluate,
  jsonString,
  waitForAnimationFrames,
  waitForExpression,
} from "./browserHarness.ts";

export async function runLocaleScenarios(context: BrowserSmokeContext) {
  const { appUrl, client, sessionId, runTest } = context;

  await evaluate(client!, sessionId, `localStorage.removeItem("patina:sidebar-navigation-mode")`);
  await client!.command("Page.addScriptToEvaluateOnNewDocument", {
    source: "globalThis.__TIME_TRACKER_SMOKE_LANGUAGE = 'en-US';",
  }, sessionId);
  await client!.command("Emulation.setDeviceMetricsOverride", {
    width: 900,
    height: 636,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  await client!.command("Page.navigate", { url: appUrl }, sessionId);
  await waitForExpression(
    client!,
    sessionId,
    `Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("Tools"))} + ']'))`,
    45_000,
    "English navigation is ready regardless of the persisted active view",
  );

  await runTest("English sidebar labels fit the unchanged minimum window geometry", async () => {
    const before = await evaluate(client!, sessionId, `
      (() => {
        const aside = document.querySelector("[data-sidebar-navigation-mode]")?.getBoundingClientRect();
        const nav = document.querySelector("[data-sidebar-primary-nav]")?.getBoundingClientRect();
        const main = document.querySelector("main.qp-canvas")?.getBoundingClientRect();
        return {
          aside: aside && { x: aside.x, width: aside.width, height: aside.height },
          nav: nav && { x: nav.x, width: nav.width, height: nav.height },
          main: main && { x: main.x, width: main.width, height: main.height },
        };
      })()
    `);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector('[aria-label="Navigation labels"]');
          toggle?.click();
          return Boolean(toggle);
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode") === "labeled"`,
    );
    const englishState = await evaluate(client!, sessionId, `
      (() => {
        const labels = Array.from(document.querySelectorAll("[data-sidebar-nav-label]"));
        const aside = document.querySelector("[data-sidebar-navigation-mode]")?.getBoundingClientRect();
        const nav = document.querySelector("[data-sidebar-primary-nav]")?.getBoundingClientRect();
        const main = document.querySelector("main.qp-canvas")?.getBoundingClientRect();
        return {
          labels: labels.map((node) => node.textContent),
          fit: labels.every((node) => node.scrollWidth <= node.clientWidth + 1),
          singleLine: labels.every((node) => node.getBoundingClientRect().height <= parseFloat(getComputedStyle(node).lineHeight) + 0.5),
          geometry: {
            aside: aside && { x: aside.x, width: aside.width, height: aside.height },
            nav: nav && { x: nav.x, width: nav.width, height: nav.height },
            main: main && { x: main.x, width: main.width, height: main.height },
          },
          pressed: document.querySelector('[aria-label="Navigation labels"]')?.getAttribute("aria-pressed"),
          visuallyPressed: document.querySelector('[aria-label="Navigation labels"]')?.classList.contains("qp-icon-action-pressed") ?? false,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()
    `) as {
      labels: string[];
      fit: boolean;
      singleLine: boolean;
      geometry: unknown;
      pressed: string | null;
      visuallyPressed: boolean;
      overflowX: number;
    };
    assert.deepEqual(
      englishState.labels,
      ["Tools"],
    );
    assert.equal(englishState.fit, true);
    assert.equal(englishState.singleLine, true);
    assert.equal(englishState.pressed, "true");
    assert.equal(englishState.visuallyPressed, false);
    assert.deepEqual(englishState.geometry, before);
    assert.ok(englishState.overflowX <= 1);

    await evaluate(client!, sessionId, `
      (() => {
        const menu = document.querySelector('[aria-label="Navigation labels"]');
        menu?.focus();
        menu?.blur();
        menu?.focus();
      })()
    `);
    await waitForAnimationFrames(client!, sessionId, 2);
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('[role="tooltip"]'))`),
      false,
      "English navigation mode toggle should remain tooltip-free",
    );
    await evaluate(client!, sessionId, `
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    `);
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode")`),
      "labeled",
    );

    await evaluate(client!, sessionId, `document.querySelector('[aria-label="Tools"]')?.click()`);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[data-tools-navigation-mode="labeled"]')
        && document.querySelectorAll('[data-tools-section-label]').length === 2`,
      15_000,
      "English Tools labels should follow the global navigation mode",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `
        (() => {
          const labels = Array.from(document.querySelectorAll('[data-tools-section-label]'));
          return {
            values: labels.map((node) => node.textContent),
            fit: labels.every((node) => node.scrollWidth <= node.clientWidth + 1),
            railWidth: document.querySelector('[data-tools-navigation-mode="labeled"]')?.getBoundingClientRect().width,
            settingsHasLabel: Boolean(document.querySelector('.tools-section-settings-tab [data-tools-section-label]')),
          };
        })()
      `),
      {
        values: ["Reminder", "Focus"],
        fit: true,
        railWidth: 72,
        settingsHasLabel: false,
      },
      JSON.stringify(await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('[data-tools-section-label]')).map(n=>({text:n.textContent,width:n.clientWidth,scroll:n.scrollWidth,font:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight}))`)),
    );
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="Tools"]')?.click()`);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label="Tools"]')?.getAttribute("aria-current") === "page"`,
    );

    await evaluate(client!, sessionId, `
      (() => {
        const settings = JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}");
        settings.theme_mode = "dark";
        localStorage.setItem("__time_tracker_smoke_settings", JSON.stringify(settings));
      })()
    `);
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.documentElement.dataset.theme === "dark"
        && document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode") === "labeled"`,
      undefined,
      "English labeled sidebar should restore in dark mode",
    );
    await waitForExpression(
      client!,
      sessionId,
      `(() => {
        const labels = Array.from(document.querySelectorAll("[data-sidebar-nav-label]"));
        const menu = document.querySelector('[aria-label="Navigation labels"]');
        return labels.length === 1
          && labels.every((node) => node.scrollWidth <= node.clientWidth + 1)
          && menu?.getAttribute("aria-pressed") === "true"
          && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
      })()`,
      undefined,
      "English labeled sidebar should settle without overflow in dark mode",
    );

    await evaluate(client!, sessionId, `
      (() => {
        const settings = JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}");
        settings.theme_mode = "light";
        localStorage.setItem("__time_tracker_smoke_settings", JSON.stringify(settings));
      })()
    `);
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.documentElement.dataset.theme === "light"
        && document.querySelector("[data-sidebar-navigation-mode]")?.getAttribute("data-sidebar-navigation-mode") === "labeled"
        && Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("Tools"))} + ']'))`,
      undefined,
      "English labeled sidebar should restore in light mode",
    );
  });

  for (const localeCase of [
    { locale: "es", labels: ["Herramientas"] },
    { locale: "ru-RU", labels: ["Инструменты"] },
  ]) await runTest(`${localeCase.locale} Tools remains usable in the minimum window`, async () => {
    const { locale, labels } = localeCase;
    const script = await client.command("Page.addScriptToEvaluateOnNewDocument", {
      source: `globalThis.__TIME_TRACKER_SMOKE_LANGUAGE = ${jsonString(locale)};`,
    }, sessionId) as { identifier: string };
    try {
      await client.command("Page.navigate", { url: appUrl }, sessionId);
      await waitForExpression(client, sessionId, `document.documentElement.lang === ${jsonString(locale)} && Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(labels[0]))} + ']'))`, 45000);
      for (const [index, view] of ["tools"].entries()) {
        const label = labels[index];
        await evaluate(client, sessionId, `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']')?.click()`);
        await waitForExpression(client, sessionId, `document.querySelector('main.qp-canvas')?.dataset.presentedView === ${jsonString(view)} && document.querySelector('main.qp-canvas')?.dataset.viewTransitionState === 'settled'`);
        assert.equal(await evaluate(client, sessionId, "document.documentElement.lang"), locale);
        assert.ok(await evaluate(client, sessionId, "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), `${label} must not overflow horizontally`);
      }
    } finally {
      await client.command("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier }, sessionId);
    }
  });
}
