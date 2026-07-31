import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";
import { DASHBOARD_MARKERS, EXPECTED_NAV_LABELS, FIRST_RENDER_TIMEOUT_MS } from "./constants.ts";

export async function runStartupScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("Vite page renders dashboard in a real browser", async () => {
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(DASHBOARD_MARKERS[0])})`,
      FIRST_RENDER_TIMEOUT_MS,
      "dashboard first render",
    );

    for (const marker of DASHBOARD_MARKERS) {
      assert.equal(
        await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(marker)})`),
        true,
      );
    }
  });

  await runTest("main window readiness waits for the themed connected app frame", async () => {
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE)`,
      FIRST_RENDER_TIMEOUT_MS,
      "main-window ready handshake",
    );

    const evidence = await evaluate(client!, sessionId, `({
      ready: globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE,
      readyCalls: globalThis.__PATINA_INVOKED_COMMANDS.filter(
        (entry) => entry.command === "cmd_mark_main_window_ready"
      ).length,
    })`) as {
      ready: {
        generation: number;
        loadEpoch: number;
        themeMode: string | null;
        theme: string | null;
        colorScheme: string | null;
        cssColorScheme: string | null;
        frameConnected: boolean;
      };
      readyCalls: number;
    };

    assert.deepEqual(evidence, {
      ready: {
        generation: 1,
        loadEpoch: 1,
        themeMode: "light",
        theme: "light",
        colorScheme: "default",
        cssColorScheme: "light",
        frameConnected: true,
      },
      readyCalls: 1,
    });
  });

  await runTest("hidden main window proves frontend liveness before being revealed again", async () => {
    const probeStarted = await evaluate(client!, sessionId, `
      (() => {
        const callback = globalThis.__PATINA_MAIN_WINDOW_LIVENESS_REQUEST__;
        const frame = document.querySelector(".qp-app-frame");
        if (typeof callback !== "function" || !frame) return false;
        globalThis.__PATINA_READY_FRAME_REFERENCE__ = frame;
        globalThis.__PATINA_MAIN_WINDOW_LOAD_EPOCH__ = 2;
        callback();
        return true;
      })()
    `);
    assert.equal(probeStarted, true, "main-window liveness callback was not registered");

    await waitForExpression(
      client!,
      sessionId,
      `globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE?.loadEpoch === 2`,
      FIRST_RENDER_TIMEOUT_MS,
      "hidden main-window liveness handshake",
    );

    const evidence = await evaluate(client!, sessionId, `({
      ready: globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE,
      readyCalls: globalThis.__PATINA_INVOKED_COMMANDS.filter(
        (entry) => entry.command === "cmd_mark_main_window_ready"
      ).length,
      sameFrame: globalThis.__PATINA_READY_FRAME_REFERENCE__
        === document.querySelector(".qp-app-frame"),
      frameConnected: Boolean(document.querySelector(".qp-app-frame")?.isConnected),
    })`) as {
      ready: {
        generation: number;
        loadEpoch: number;
        themeMode: string | null;
        theme: string | null;
        colorScheme: string | null;
        cssColorScheme: string | null;
        frameConnected: boolean;
      };
      readyCalls: number;
      sameFrame: boolean;
      frameConnected: boolean;
    };

    assert.deepEqual(evidence, {
      ready: {
        generation: 1,
        loadEpoch: 2,
        themeMode: "light",
        theme: "light",
        colorScheme: "default",
        cssColorScheme: "light",
        frameConnected: true,
      },
      readyCalls: 2,
      sameFrame: true,
      frameConnected: true,
    });

    await evaluate(client!, sessionId, `delete globalThis.__PATINA_READY_FRAME_REFERENCE__`);
  });

  await runTest("main window ready frame stays stable across supported DPI scales", async () => {
    for (const deviceScaleFactor of [1, 1.25, 1.5, 2]) {
      await client!.command("Emulation.setDeviceMetricsOverride", {
        width: 1100,
        height: 736,
        deviceScaleFactor,
        mobile: false,
      }, sessionId);
      const state = await evaluate(client!, sessionId, `({
        devicePixelRatio: window.devicePixelRatio,
        frameConnected: Boolean(document.querySelector(".qp-app-frame")?.isConnected),
        themeApplied: document.documentElement.dataset.theme === "light"
          && document.documentElement.dataset.colorScheme === "default"
          && document.documentElement.style.colorScheme === "light",
        horizontalOverflow: document.documentElement.scrollWidth
          > document.documentElement.clientWidth + 1,
      })`);
      assert.deepEqual(state, {
        devicePixelRatio: deviceScaleFactor,
        frameConnected: true,
        themeApplied: true,
        horizontalOverflow: false,
      });
    }

    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1100,
      height: 736,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
  });

  await runTest("primary navigation switches views in a real browser", async () => {
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
    }
  });
}
