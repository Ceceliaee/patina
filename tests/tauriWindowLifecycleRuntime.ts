import assert from "node:assert/strict";
import { join } from "node:path";
import { readTrackerProgress } from "./tauriBackgroundPolicyRuntime.ts";
import {
  CdpConnection,
  waitFor
} from "./uiBrowserSmoke/browserHarness.ts";

import { RuntimeSession, evaluate, findMainTarget } from "./tauriRuntimeHarness.ts";

const WEBVIEW_STARTUP_TIMEOUT_MS = 30_000;
export async function run(session: RuntimeSession) {
  const { root, logs, devtoolsPort, webviewDiagnostics } = session;
  let client = session.client!;
  try {
    let mainWindowReadinessObservation: unknown = null;
    let mainWindowGeneration: number;
    try {
      mainWindowGeneration = await waitFor(
        "frontend main-window readiness handshake",
        async () => {
          mainWindowReadinessObservation = await evaluate(client!, `(async () => {
          const frame = document.querySelector(".qp-app-frame");
          const frameStyle = frame ? getComputedStyle(frame) : null;
          let renderToken = null;
          let renderTokenError = null;
          try {
            renderToken = await window.__TAURI_INTERNALS__.invoke(
              "cmd_get_main_window_render_token",
            );
          } catch (error) {
            renderTokenError = String(error);
          }
          return {
            generation: window.__PATINA_MAIN_WINDOW_GENERATION__ ?? null,
            windowLabel: window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null,
            documentWindowLabel: document.documentElement.dataset.windowLabel ?? null,
            frameConnected: Boolean(frame?.isConnected),
            frameWidth: frame?.getBoundingClientRect().width ?? null,
            frameHeight: frame?.getBoundingClientRect().height ?? null,
            frameDisplay: frameStyle?.display ?? null,
            frameVisibility: frameStyle?.visibility ?? null,
            frameBackground: frameStyle?.backgroundColor ?? null,
            themeMode: document.documentElement.dataset.themeMode ?? null,
            theme: document.documentElement.dataset.theme ?? null,
            colorScheme: document.documentElement.dataset.colorScheme ?? null,
            cssColorScheme: document.documentElement.style.colorScheme || null,
            renderToken,
            renderTokenError,
          };
        })()`);
          const observation = mainWindowReadinessObservation as {
            generation?: unknown;
          } | null;
          return typeof observation?.generation === "number"
            && logs.join("").includes("event=frontend-ready")
            ? observation.generation
            : null;
        },
        10_000,
      );
    } catch(error) {
      throw new AggregateError([
        error,
        new Error(
          `main-window readiness observation: ${JSON.stringify(mainWindowReadinessObservation)}`,
        ),
        ...(webviewDiagnostics.length > 0
          ? [new Error(`WebView diagnostics:\n${webviewDiagnostics.join("\n")}`)]
          : []),
      ], "frontend main-window readiness handshake failed");
    }
    assert.ok(Number.isSafeInteger(mainWindowGeneration) && mainWindowGeneration > 0);
    const mainWindowRenderToken = await evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("cmd_get_main_window_render_token")`,
    ) as {
      generation: number;
      loadEpoch: number;
    };
    assert.equal(mainWindowRenderToken.generation, mainWindowGeneration);
    assert.ok(
      Number.isSafeInteger(mainWindowRenderToken.loadEpoch)
      && mainWindowRenderToken.loadEpoch > 0,
    );
    const duplicateReady = await evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("cmd_mark_main_window_ready", {
      generation: ${mainWindowGeneration},
      loadEpoch: ${mainWindowRenderToken.loadEpoch},
    })`,
    );
    assert.deepEqual(duplicateReady, {
      outcome: "duplicate",
      generation: mainWindowGeneration,
      loadEpoch: mainWindowRenderToken.loadEpoch,
    });

    const initialMainWindowVisible = await evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
    );
    assert.equal(initialMainWindowVisible, false, "fresh-install start minimized should keep the main window hidden");
    assert.match(logs.join(""), /\[startup\] source=manual strategy=start-in-tray-optimized/);

    assert.match(logs.join(""), /\[tray\] visibility-applied visible=true created=true/);
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [{ key: "show_tray_icon", value: "0" }, { key: "close_behavior", value: "exit" }],
  })`);
    await waitFor("hidden tray applied before last WebView destruction", () =>
      /\[tray\] visibility-applied visible=false created=true/.test(logs.join("")), 10_000);
    const hiddenTrayLogStart = logs.join("").length;

    client.close();
    client = null;
    await waitFor("natural 30-second hidden startup destruction", async () => (
      /event=destroyed[^\r\n]*reason=background-idle/.test(logs.join(""))
      && !(await findMainTarget(devtoolsPort))
    ), 45_000);
    // Lifecycle elapsed_ms restarts on each page load; observe native startup
    // and destruction independently of the renderer and its load epochs.
    assert.ok(session.hiddenStartupObservedAt !== null && session.hiddenStartupDestroyedAt !== null,
      "native startup and natural destruction observations are required");
    const naturalDestroyElapsedMs = session.hiddenStartupDestroyedAt - session.hiddenStartupObservedAt;
    assert.ok(naturalDestroyElapsedMs >= 30_000 && naturalDestroyElapsedMs < 45_000,
      `hidden startup must release at 30 seconds, observed ${naturalDestroyElapsedMs}ms`);
    const destroyedAt = Date.now();
    await waitFor("tracker persists after the last WebView is released", () =>
      readTrackerProgress(join(root, "data", "patina.db")) > destroyedAt, 10_000);
    console.log("PATINA_BACKGROUND_POLICY_REPORT", JSON.stringify({ naturalDestroyElapsedMs, trackerPersistedAfterDestruction: true }));

    const secondaryPid = await session.start();
    await waitFor("secondary instance exits", async () => (await session.job!.exitCode(secondaryPid)) !== -1, 10_000);
    assert.equal(await session.job!.exitCode(secondaryPid), 0);

    const recoveredTarget = await waitFor(
      "single-instance main WebView recreation",
      () => findMainTarget(devtoolsPort),
      WEBVIEW_STARTUP_TIMEOUT_MS,
    );
    client = await CdpConnection.connect(recoveredTarget.webSocketDebuggerUrl!);
    await client.command("Runtime.enable");
    await client.command("Page.enable");
    await client.command("Log.enable");
    await waitFor(
      "single-instance recreated main window bridge",
      async () => evaluate(
        client!,
        "Boolean(window.__TAURI_INTERNALS__?.invoke && document.querySelector('#root')?.children.length)",
      ),
      WEBVIEW_STARTUP_TIMEOUT_MS,
    );
    await waitFor(
      "single-instance recreated main window visibility",
      async () => evaluate(
        client!,
        `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
      ),
      10_000,
    );
    mainWindowGeneration = Number(await evaluate(
      client,
      `window.__PATINA_MAIN_WINDOW_GENERATION__`,
    ));
    assert.match(logs.join(""), /reason=single-instance[\s\S]*result=visible/);

    assert.doesNotMatch(logs.join("").slice(hiddenTrayLogStart), /visibility-applied visible=true/,
      "single-instance recovery must preserve the hidden tray preference");
    for(const value of ["1", "0", "1"]) {
      const logStart = logs.join("").length;
      await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
      mutations: [{ key: "show_tray_icon", value: "${value}" }, { key: "close_behavior", value: "tray" }],
    })`);
      await waitFor("tray preference applies immediately", () => logs.join("").slice(logStart)
        .includes(`visibility-applied visible=${value === "1"} created=true`), 10_000);
    }
    console.log("PATINA_TRAY_VISIBILITY_REPORT", JSON.stringify({
      hiddenLastWindowResidency: true, hiddenSingleInstanceRecovery: true, repeatedVisibilityToggle: true,
    }));

    const trayRevealStartedAt = Date.now();
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")`);
    await waitFor(
      "main window recovery from hidden startup",
      async () => evaluate(
        client!,
        `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
      ),
      10_000,
    );
    const trayRevealElapsedMs = Date.now() - trayRevealStartedAt;
    assert.ok(
      trayRevealElapsedMs < 2_000,
      `a preloaded tray reveal should complete near-immediately, got ${trayRevealElapsedMs}ms`,
    );
    assert.doesNotMatch(
      logs.join(""),
      /event=ready-timeout/,
      "normal startup and tray reveal must not depend on the readiness watchdog",
    );
    const firstVisibleAppearance = await evaluate(client, `({
    frameConnected: Boolean(document.querySelector(".qp-app-frame")?.isConnected),
    frameWidth: document.querySelector(".qp-app-frame")?.getBoundingClientRect().width ?? 0,
    frameHeight: document.querySelector(".qp-app-frame")?.getBoundingClientRect().height ?? 0,
    frameBackground: document.querySelector(".qp-app-frame")
      ? getComputedStyle(document.querySelector(".qp-app-frame")).backgroundColor
      : "transparent",
    themeMode: document.documentElement.dataset.themeMode,
    theme: document.documentElement.dataset.theme,
    colorScheme: document.documentElement.dataset.colorScheme,
    cssColorScheme: document.documentElement.style.colorScheme,
  })`) as {
      frameConnected: boolean;
      frameWidth: number;
      frameHeight: number;
      frameBackground: string;
      themeMode?: string;
      theme?: string;
      colorScheme?: string;
      cssColorScheme?: string;
    };
    assert.equal(firstVisibleAppearance.frameConnected, true);
    assert.ok(firstVisibleAppearance.frameWidth > 0);
    assert.ok(firstVisibleAppearance.frameHeight > 0);
    assert.notEqual(firstVisibleAppearance.frameBackground, "transparent");
    assert.notEqual(firstVisibleAppearance.frameBackground, "rgba(0, 0, 0, 0)");
    assert.deepEqual({
      themeMode: firstVisibleAppearance.themeMode,
      theme: firstVisibleAppearance.theme,
      colorScheme: firstVisibleAppearance.colorScheme,
      cssColorScheme: firstVisibleAppearance.cssColorScheme,
    }, {
      themeMode: "light",
      theme: "light",
      colorScheme: "default",
      cssColorScheme: "light",
    });

    await evaluate(
      client,
      `localStorage.setItem("patina:last-active-view", "data")`,
    );
    const logsBeforeReload = logs.join("");
    await client.command("Page.reload", { ignoreCache: true });
    await waitFor(
      "main window reload readiness recovery",
      async () => {
        try {
          const visible = await evaluate(
            client!,
            `window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })`,
          );
          const reloadLogs = logs.join("").slice(logsBeforeReload.length);
          return visible === true
            && reloadLogs.includes("event=page-load-started")
            && reloadLogs.includes("result=hidden-until-ready")
            && reloadLogs.includes("event=frontend-ready")
            && reloadLogs.includes("result=accepted-reveal")
            && reloadLogs.includes("event=show-succeeded")
            ? true
            : null;
        } catch {
          return null;
        }
      },
      15_000,
    );
    const reloadAppearance = await evaluate(client, `({
    frameConnected: Boolean(document.querySelector(".qp-app-frame")?.isConnected),
    htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    rootBackground: getComputedStyle(document.querySelector("#root")).backgroundColor,
    presentedView: document.querySelector("main.qp-canvas")?.dataset.presentedView ?? null,
    transitionState: document.querySelector("main.qp-canvas")?.dataset.viewTransitionState ?? null,
  })`) as {
      frameConnected: boolean;
      htmlBackground: string;
      bodyBackground: string;
      rootBackground: string;
      presentedView: string | null;
      transitionState: string | null;
    };
    assert.equal(reloadAppearance.frameConnected, true);
    assert.equal(reloadAppearance.presentedView, "data");
    assert.equal(reloadAppearance.transitionState, "settled");
    for(const background of [
      reloadAppearance.htmlBackground,
      reloadAppearance.bodyBackground,
      reloadAppearance.rootBackground,
    ]) {
      assert.notEqual(background, "transparent");
      assert.notEqual(background, "rgba(0, 0, 0, 0)");
    }

    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_minimize_main_window")`);
    assert.equal(await evaluate(client, `window.__TAURI_INTERNALS__.invoke("plugin:window|is_minimized", {label:"main"})`), true);
    const minimizedDiagnostics = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")`) as { webview_window_labels: string[] };
    assert.deepEqual(minimizedDiagnostics.webview_window_labels, ["main"], "minimize must not create another window");
    const retiredCommand = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_set_widget_pinned", {pinned:true}).then(()=>null,e=>String(e))`);
    assert.match(String(retiredCommand), /not found|not allowed|permission|denied/i);
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")`);
    await waitFor("main restored from taskbar", () => evaluate(client!, `window.__TAURI_INTERNALS__.invoke("plugin:window|is_minimized", {label:"main"}).then(value=>!value)`), 10_000);

    const startupVisibilityLogs = logs.join("");
    const createdLogIndex = startupVisibilityLogs.indexOf("event=created");
    const readyLogIndex = startupVisibilityLogs.indexOf("event=frontend-ready");
    const showLogIndex = startupVisibilityLogs.indexOf("event=show-succeeded");
    assert.ok(createdLogIndex >= 0, "main-window creation log is missing");
    assert.ok(readyLogIndex > createdLogIndex, "frontend-ready must follow hidden creation");
    assert.ok(showLogIndex > readyLogIndex, "show must follow frontend readiness");
    assert.doesNotMatch(startupVisibilityLogs, /event=ready-timeout/);
    const eventElapsedMs = (event: string) => {
      const match = startupVisibilityLogs.match(
        new RegExp(`\\[main-window\\] event=${event}[^\\r\\n]*elapsed_ms=(\\d+)`),
      );
      assert.ok(match, `${event} elapsed time is missing`);
      return Number(match[1]);
    };
    console.log("PATINA_MAIN_WINDOW_READINESS_REPORT", JSON.stringify({
      sampleCount: 1,
      environment: "isolated real Tauri/WebView2 runtime",
      generation: mainWindowGeneration,
      createdElapsedMs: eventElapsedMs("created"),
      frontendReadyElapsedMs: eventElapsedMs("frontend-ready"),
      showSucceededElapsedMs: eventElapsedMs("show-succeeded"),
      trayRevealElapsedMs,
      watchdogUsed: false,
      firstVisibleAppearance,
    }));

    // Leave a stale background task pending, then take the ordinary close-to-exit
    // route. Exit must win over delayed window work and unexpected-destroy recovery.
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [{ key: "close_behavior", value: "tray" }, { key: "show_tray_icon", value: "1" }],
  })`);
    await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })');
    await waitFor("main is hidden with background destruction pending", () => evaluate(client!,
      'window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" }).then(value => !value)'), 10_000);
    await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")');
    await waitFor("main is visible before exit", () => evaluate(client!,
      'window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" })'), 10_000);
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [{ key: "close_behavior", value: "exit" }],
  })`);
    const closeToExitLogStart = logs.join("").length;
    const lastCommitBeforeExit = readTrackerProgress(join(root, "data", "patina.db"));
    assert.ok(lastCommitBeforeExit > 0, "exit fixture must contain a committed tracking checkpoint");
    await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_open_mini_window")');
    try { await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })'); }
    catch(error) { if(!/CDP WebSocket|closed|disconnect/i.test(String(error))) throw error; }
    client.close();
    client = null;
    await waitFor("close-to-exit leaves no runtime process", async () => (await session.job!.count()) === 0, 10_000);
    assert.doesNotMatch(logs.join("").slice(closeToExitLogStart), /recreating-visible-window|reason=unexpected-destroy/);
    assert.ok(readTrackerProgress(join(root, "data", "patina.db")) >= lastCommitBeforeExit,
      "ordinary exit must retain the last committed tracking checkpoint");
    console.log("PASS close-to-exit wins over pending background destruction");

  } finally { session.client = client; }
}
