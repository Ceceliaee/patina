import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, jsonString, waitForExpression } from "./browserHarness.ts";
import { TOOLS_MARKER, EXPECTED_NAV_LABELS, FIRST_RENDER_TIMEOUT_MS } from "./constants.ts";

export async function runStartupScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("StrictMode and repeated mounts release subscriptions delivered after unmount or partial failure", async () => {
    await waitForExpression(client, sessionId, "Boolean(globalThis.__PATINA_EVENT_LISTENER_COUNTS && globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE)");
    for (const kind of ["main", "mini", "icons"] as const) {
      const baseline = await evaluate(client, sessionId, "globalThis.__PATINA_EVENT_LISTENER_COUNTS()");
      try {
        for (let cycle = 0; cycle < 3; cycle += 1) {
          await evaluate(client, sessionId, `(async () => {
            globalThis.__PATINA_PENDING_LISTEN = [];
            globalThis.__PATINA_REJECT_EVENT_LISTEN = ${cycle === 0 ? "'app-settings-changed'" : "null"};
            globalThis.__PATINA_DELAY_EVENT_LISTEN = (event, stop) => new Promise(resolve => {
              globalThis.__PATINA_PENDING_LISTEN.push(() => resolve(stop));
            });
            const host = document.createElement('div'); host.id = 'subscription-probe'; host.hidden = true;
            document.body.append(host);
            const { mountSubscriptionProbe } = await import('/tests/uiBrowserSmoke/subscriptionLifecycleProbe.tsx');
            globalThis.__PATINA_UNMOUNT_SUBSCRIPTION = mountSubscriptionProbe(host, ${jsonString(kind)});
          })()`);
          // StrictMode creates and disposes one effect before mounting another.
          const subscriptions = kind === "icons" ? 1 : (kind === "main" ? 3 : 4) - (cycle === 0 ? 1 : 0);
          await waitForExpression(client, sessionId, `globalThis.__PATINA_PENDING_LISTEN.length === ${subscriptions * 2}`);
          await evaluate(client, sessionId, "globalThis.__PATINA_UNMOUNT_SUBSCRIPTION(); document.getElementById('subscription-probe').remove()");
          const held = await evaluate(client, sessionId, "globalThis.__PATINA_EVENT_LISTENER_COUNTS()");
          assert.notDeepEqual(held, baseline, "the delayed native subscriptions must actually exist before release");
          await evaluate(client, sessionId, "globalThis.__PATINA_PENDING_LISTEN.splice(0).forEach(release => release())");
          await waitForExpression(client, sessionId,
            `JSON.stringify(globalThis.__PATINA_EVENT_LISTENER_COUNTS()) === ${jsonString(JSON.stringify(baseline))}`,
            5_000, `${kind} late unlisten must restore the original listener count`);
        }
      } finally {
        await evaluate(client, sessionId, `(() => {
          globalThis.__PATINA_UNMOUNT_SUBSCRIPTION?.();
          document.getElementById('subscription-probe')?.remove();
          globalThis.__PATINA_PENDING_LISTEN?.splice(0).forEach(release => release());
          delete globalThis.__PATINA_DELAY_EVENT_LISTEN;
          delete globalThis.__PATINA_REJECT_EVENT_LISTEN;
        })()`);
      }
    }
  });

  await runTest("tracking hook rejects stale pause snapshots across real event subscriptions", async () => {
    await waitForExpression(client, sessionId, "Boolean(globalThis.__PATINA_EMIT_TAURI_EVENT)");
    await evaluate(client, sessionId, `(async () => {
      const core = await import('/@id/@tauri-apps/api/core');
      globalThis.__PATINA_PROBE_BASE = await core.invoke('get_current_tracking_snapshot');
      const host = document.createElement('div'); host.id = 'tracking-probe-host'; host.hidden = true;
      document.body.append(host);
      const { mountTrackingStateProbe } = await import('/tests/uiBrowserSmoke/trackingStateProbe.tsx');
      globalThis.__PATINA_UNMOUNT_TRACKING_PROBE = mountTrackingStateProbe(host);
    })()`);
    try {
      await waitForExpression(client, sessionId, "JSON.parse(document.querySelector('[data-tracking-probe]')?.textContent || '{}').ready === true");
      await evaluate(client, sessionId, `(() => {
        globalThis.__PATINA_PENDING_TRACKING = [];
        globalThis.__PATINA_TRACKING_MODE = 'old';
        globalThis.__PATINA_TRACKING_SNAPSHOT_HOOK = () => {
          const old = globalThis.__PATINA_TRACKING_MODE === 'old';
          const snapshot = structuredClone(globalThis.__PATINA_PROBE_BASE);
          snapshot.tracking_paused = old;
          snapshot.window.exe_name = old ? 'old.exe' : 'new.exe';
          snapshot.status.is_tracking_active = !old;
          if (!old) return snapshot;
          return new Promise(resolve => globalThis.__PATINA_PENDING_TRACKING.push(() => resolve(snapshot)));
        };
        globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed', { reason: 'tracking-paused', changed_at_ms: 1 });
      })()`);
      await waitForExpression(client, sessionId, "globalThis.__PATINA_PENDING_TRACKING.length >= 2");
      await evaluate(client, sessionId, `(() => {
        globalThis.__PATINA_TRACKING_MODE = 'new';
        globalThis.__PATINA_EMIT_TAURI_EVENT('active-window-changed', globalThis.__PATINA_PROBE_BASE.window);
        globalThis.__PATINA_EMIT_TAURI_EVENT('app-settings-changed', {});
      })()`);
      const probe = "JSON.parse(document.querySelector('[data-tracking-probe]').textContent)";
      await waitForExpression(client, sessionId, `${probe}.exe === 'new.exe' && ${probe}.paused === false && ${probe}.active === true`);
      await evaluate(client, sessionId, `globalThis.__PATINA_PENDING_TRACKING.splice(0).forEach(resolve => resolve())`);
      await evaluate(client, sessionId, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      assert.deepEqual(await evaluate(client, sessionId, probe), { paused: false, exe: "new.exe", active: true, ready: true });
    } finally {
      await evaluate(client, sessionId, `(() => {
        globalThis.__PATINA_UNMOUNT_TRACKING_PROBE?.();
        document.getElementById('tracking-probe-host')?.remove();
        delete globalThis.__PATINA_TRACKING_SNAPSHOT_HOOK;
        globalThis.__PATINA_EMIT_TAURI_EVENT('tracking-data-changed', { reason: 'tracking-resumed', changed_at_ms: 2 });
      })()`);
    }
  });

  await runTest("Vite page renders Tools in a real browser", async () => {
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_MARKER)})`,
      FIRST_RENDER_TIMEOUT_MS,
      "Tools first render",
    );

    for (const marker of [TOOLS_MARKER]) {
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
        presentedView: string | null;
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
        presentedView: "tools",
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
        presentedView: string | null;
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
        presentedView: "tools",
      },
      readyCalls: 2,
      sameFrame: true,
      frameConnected: true,
    });

    await evaluate(client!, sessionId, `delete globalThis.__PATINA_READY_FRAME_REFERENCE__`);
  });

  await runTest("main window ready frame stays stable across supported DPI scales", async () => {
    const viewport = await evaluate(client!, sessionId, `({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio })`) as {
      width: number; height: number; deviceScaleFactor: number;
    };
    try {
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

    } finally {
      await client!.command("Emulation.setDeviceMetricsOverride", { ...viewport, mobile: false }, sessionId);
    }
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
