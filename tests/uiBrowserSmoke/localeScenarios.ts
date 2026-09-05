import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import {
  evaluate,
  jsonString,
  titleDetailsButtonExpression,
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
    `Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("History"))} + ']'))`,
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
          singleLine: labels.every((node) => node.getBoundingClientRect().height <= 10.5),
          geometry: {
            aside: aside && { x: aside.x, width: aside.width, height: aside.height },
            nav: nav && { x: nav.x, width: nav.width, height: nav.height },
            main: main && { x: main.x, width: main.width, height: main.height },
          },
          classification: labels.find((node) => node.textContent === "Classification")?.textContent,
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
      classification: string | undefined;
      pressed: string | null;
      visuallyPressed: boolean;
      overflowX: number;
    };
    assert.deepEqual(
      englishState.labels,
      ["Today", "History", "Data", "Classification", "Tools", "Settings", "About"],
    );
    assert.equal(englishState.fit, true);
    assert.equal(englishState.singleLine, true);
    assert.equal(englishState.classification, "Classification");
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
        && document.querySelectorAll('[data-tools-section-label]').length === 3`,
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
        values: ["Reminder", "Timer", "Pomodoro"],
        fit: true,
        railWidth: 72,
        settingsHasLabel: false,
      },
    );
    await evaluate(client!, sessionId, `document.querySelector('[aria-label="History"]')?.click()`);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label="History"]')?.getAttribute("aria-current") === "page"`,
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
        return labels.length === 7
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
        && Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("History"))} + ']'))`,
      undefined,
      "English labeled sidebar should restore in light mode",
    );
  });

  await runTest("English history title chips do not crowd the duration column", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("History"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("History"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".history-timeline-open"))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const button = document.querySelector(".history-timeline-open");
          if (!button) return false;
          button.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".history-timeline-dialog-surface"))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      titleDetailsButtonExpression("title details", ".history-timeline-dialog-surface"),
      45_000,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const closeButton = document.querySelector(".history-timeline-dialog-surface .history-timeline-dialog-close");
          if (!closeButton) return false;
          closeButton.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".history-timeline-dialog-surface")`,
    );
  });

  await runTest("English data export localizes range and all format descriptions", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const settings = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("Settings"))} + ']');
          settings?.click();
          return Boolean(settings);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("Export and import")})`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "Export");
          trigger?.click();
          return Boolean(trigger);
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.settings-data-export-format-grid'))");
    assert.equal(
      await evaluate(client!, sessionId, `document.querySelector('.settings-data-export-range-label')?.textContent?.trim()`),
      "This month",
    );
    assert.deepEqual(
      await evaluate(client!, sessionId, `Array.from(document.querySelectorAll('.settings-data-export-format-option span')).map((node) => node.textContent?.trim())`),
      [
        "Best for Excel and general spreadsheet work.",
        "Best for reading, editing, and organizing notes.",
        "Best for analytics tools and columnar processing.",
        "Best for local SQL queries and complete archives.",
      ],
    );
    await evaluate(client!, sessionId, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
  });

  await runTest("Spanish pages and export remain usable in the minimum window", async () => {
    const script = await client.command("Page.addScriptToEvaluateOnNewDocument", {
      source: "globalThis.__TIME_TRACKER_SMOKE_LANGUAGE = 'es';",
    }, sessionId) as { identifier: string };
    try {
      await client.command("Page.navigate", { url: appUrl }, sessionId);
      await waitForExpression(client, sessionId, "document.documentElement.lang === 'es' && Boolean(document.querySelector('[aria-label=\"Historial\"]'))", 45000);
      for (const [label, view] of [["Hoy", "dashboard"], ["Historial", "history"], ["Datos", "data"], ["Clasificación", "mapping"], ["Herramientas", "tools"], ["Configuración", "settings"], ["Acerca de", "about"]]) {
        await evaluate(client, sessionId, `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']')?.click()`);
        await waitForExpression(client, sessionId, `document.querySelector('main.qp-canvas')?.dataset.presentedView === ${jsonString(view)} && document.querySelector('main.qp-canvas')?.dataset.viewTransitionState === 'settled'`);
        assert.equal(await evaluate(client, sessionId, "document.documentElement.lang"), "es");
        assert.ok(await evaluate(client, sessionId, "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), `${label} must not overflow horizontally`);
      }
      await evaluate(client, sessionId, "document.querySelector('[aria-label=\"Configuración\"]')?.click()");
      await waitForExpression(client, sessionId, "document.body.innerText.includes('Exportación e importación')");
      await evaluate(client, sessionId, "Array.from(document.querySelectorAll('button')).find(n => n.textContent?.trim() === 'Exportar')?.click()");
      await waitForExpression(client, sessionId, "Boolean(document.querySelector('.settings-data-export-format-grid'))");
      assert.equal(await evaluate(client, sessionId, "document.querySelector('.settings-data-export-range-label')?.textContent?.trim()"), "Este mes");
      assert.equal(await evaluate(client, sessionId, "Array.from(document.querySelectorAll('.settings-data-export-format-option span')).every(n => n.textContent?.startsWith('Adecuado para'))"), true);
      await evaluate(client, sessionId, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
      await waitForExpression(client, sessionId, "!document.querySelector('[role=\"dialog\"]')");
    } finally {
      await client.command("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier }, sessionId);
    }
  });
}
