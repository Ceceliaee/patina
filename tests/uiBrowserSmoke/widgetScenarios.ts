import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { delay, evaluate, waitForExpression } from "./browserHarness.ts";

const WIDGET_RESOLUTIONS = [
  { name: "720p", width: 1280, height: 720 },
  { name: "768p", width: 1366, height: 768 },
  { name: "900p", width: 1600, height: 900 },
  { name: "1080p", width: 1920, height: 1080 },
  { name: "1440p", width: 2560, height: 1440 },
  { name: "4K", width: 3840, height: 2160 },
] as const;
const WIDGET_SCALES = [1, 1.25, 1.5, 2] as const;
const WIDGET_WIDTHS = [244, 312, 380] as const;
const WIDGET_LOGICAL_HEIGHT = 48;

type WidgetSide = "left" | "right";
type WidgetState = "collapsed" | "expanded";

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface WidgetElementVisibility {
  rect: Rect;
  fullyVisible: boolean;
  verticallyVisible: boolean;
  visibleWidth: number;
}

interface WidgetVisibilityResult {
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
    screenWidth: number;
    screenHeight: number;
  };
  tray: WidgetElementVisibility | null;
  tracking: WidgetElementVisibility | null;
  tools: WidgetElementVisibility | null;
  toolSlots: WidgetElementVisibility[];
  actions: WidgetElementVisibility | null;
  pinIcon: WidgetElementVisibility | null;
  pinIconClassName: string | null;
  anchor: WidgetElementVisibility | null;
  lamp: WidgetElementVisibility | null;
  lampStyle: { backgroundImage: string; coreDiameter: number } | null;
}

function widgetUrl(appUrl: string, side: WidgetSide, toolSlotCount: number, pinned = false) {
  const url = new URL(appUrl);
  url.searchParams.set("__patinaWindow", "widget");
  url.searchParams.set("widgetSide", side);
  url.searchParams.set("widgetTools", String(toolSlotCount));
  url.searchParams.set("widgetTracking", "1");
  url.searchParams.set("widgetPinned", pinned ? "1" : "0");
  return url.href;
}

async function setWidgetViewport(
  context: BrowserSmokeContext,
  logicalWidth: number,
  resolution: typeof WIDGET_RESOLUTIONS[number],
  scaleFactor: typeof WIDGET_SCALES[number],
) {
  await context.client.command("Emulation.setDeviceMetricsOverride", {
    width: logicalWidth,
    height: WIDGET_LOGICAL_HEIGHT,
    screenWidth: resolution.width,
    screenHeight: resolution.height,
    deviceScaleFactor: scaleFactor,
    mobile: false,
  }, context.sessionId);
}

async function waitForWidgetState(
  context: BrowserSmokeContext,
  state: WidgetState,
  side: WidgetSide,
  toolSlotCount: number,
) {
  const stateClass = state === "collapsed" ? "widget-shell-collapsed" : "widget-shell-expanded";
  await waitForExpression(
    context.client,
    context.sessionId,
    `document.documentElement?.dataset.windowLabel === "widget"
      && document.querySelector(".widget-shell")?.classList.contains(${JSON.stringify(stateClass)})
      && document.querySelector(".widget-shell")?.classList.contains(${JSON.stringify(`widget-shell-${side}`)})
      && document.querySelectorAll(".widget-pill-tool-slot").length === ${toolSlotCount}`,
    15_000,
    `${state} widget on ${side} with ${toolSlotCount} tools`,
  );
  await waitForExpression(
    context.client,
    context.sessionId,
    `Array.from(document.querySelector(".widget-shell")?.getAnimations({ subtree: true }) ?? [])
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
      .every((animation) => animation.playState === "finished" || animation.playState === "idle")`,
    15_000,
    `${state} widget animations`,
  );
}

async function inspectWidgetVisibility(context: BrowserSmokeContext): Promise<WidgetVisibilityResult> {
  return evaluate(context.client, context.sessionId, `
    (() => {
      for (const animation of document.querySelector(".widget-status-lamp")?.getAnimations() ?? []) {
        animation.pause();
        animation.currentTime = 0;
      }
      const viewport = {
        left: 0,
        top: 0,
        right: document.documentElement.clientWidth,
        bottom: document.documentElement.clientHeight,
      };
      const fullyInside = (rect) => rect.left >= -0.5 && rect.top >= -0.5
        && rect.right <= viewport.right + 0.5 && rect.bottom <= viewport.bottom + 0.5;
      const inspectNode = (node) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const value = {
          left: Number(rect.left.toFixed(2)),
          top: Number(rect.top.toFixed(2)),
          right: Number(rect.right.toFixed(2)),
          bottom: Number(rect.bottom.toFixed(2)),
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2)),
        };
        return {
          rect: value,
          fullyVisible: fullyInside(rect),
          verticallyVisible: rect.top >= -0.5 && rect.bottom <= viewport.bottom + 0.5,
          visibleWidth: Math.max(0, Math.min(rect.right, viewport.right) - Math.max(rect.left, 0)),
        };
      };
      const inspect = (selector) => inspectNode(document.querySelector(selector));
      return {
        viewport: {
          width: viewport.right,
          height: viewport.bottom,
          deviceScaleFactor: window.devicePixelRatio,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
        },
        tray: inspect(".widget-pill-tray"),
        tracking: inspect(".widget-pill-tracking-core"),
        tools: inspect(".widget-pill-tool-slots"),
        toolSlots: Array.from(document.querySelectorAll(".widget-pill-tool-slot")).map(inspectNode),
        actions: inspect(".widget-pill-actions"),
        pinIcon: inspect(".widget-pin-icon"),
        pinIconClassName: document.querySelector(".widget-pin-icon")?.getAttribute("class") ?? null,
        anchor: inspect(".widget-pill-anchor"),
        lamp: inspect(".widget-status-lamp"),
        lampStyle: (() => {
          const node = document.querySelector(".widget-status-lamp");
          if (!node) return null;
          const style = getComputedStyle(node);
          return {
            backgroundImage: style.backgroundImage,
            coreDiameter: Number.parseFloat(style.getPropertyValue("--qp-widget-lamp-size")),
          };
        })(),
      };
    })()
  `) as Promise<WidgetVisibilityResult>;
}

function assertWidgetVisibility(
  result: WidgetVisibilityResult,
  state: WidgetState,
  toolSlotCount: number,
  caseLabel: string,
) {
  assert.equal(result.viewport.height, WIDGET_LOGICAL_HEIGHT, `${caseLabel}: viewport height`);
  assert.ok(result.anchor, `${caseLabel}: missing anchor`);
  if (state === "collapsed") {
    assert.equal(result.anchor?.verticallyVisible, true, `${caseLabel}: anchor vertically clipped`);
    assert.ok((result.anchor?.visibleWidth ?? 0) >= 16, `${caseLabel}: anchor edge target clipped`);
    return;
  }

  for (const [name, element] of [
    ["tray", result.tray],
    ["tracking", result.tracking],
    ["actions", result.actions],
    ["pin icon", result.pinIcon],
    ["anchor", result.anchor],
    ["lamp", result.lamp],
  ] as const) {
    assert.equal(element?.fullyVisible, true, `${caseLabel}: ${name} clipped: ${JSON.stringify(element)}`);
  }
  assert.equal(result.toolSlots.length, toolSlotCount, `${caseLabel}: tool slot count`);
  assert.ok(result.toolSlots.every((slot) => slot.fullyVisible), `${caseLabel}: tool slot clipped`);
  assert.match(result.pinIconClassName ?? "", /\blucide-pin\b/, `${caseLabel}: canonical pin icon missing`);
  assert.equal(result.lampStyle?.coreDiameter, 10, `${caseLabel}: lamp core diameter`);
  assert.match(result.lampStyle?.backgroundImage ?? "", /^radial-gradient\(circle,/, `${caseLabel}: lamp shape`);

  const anchor = result.anchor?.rect;
  const lamp = result.lamp?.rect;
  assert.ok(anchor && lamp, `${caseLabel}: missing anchor geometry`);
  const scale = result.viewport.deviceScaleFactor;
  assert.ok(Math.abs(((anchor.left + anchor.right) - (lamp.left + lamp.right)) * scale) < 0.01,
    `${caseLabel}: lamp horizontal center drift`);
  assert.ok(Math.abs(((anchor.top + anchor.bottom) - (lamp.top + lamp.bottom)) * scale) < 0.01,
    `${caseLabel}: lamp vertical center drift`);
}

async function navigateToWidget(
  context: BrowserSmokeContext,
  side: WidgetSide,
  toolSlotCount: number,
  pinned = false,
) {
  const width = pinned ? WIDGET_WIDTHS[toolSlotCount] : 64;
  await setWidgetViewport(context, width, WIDGET_RESOLUTIONS[0], WIDGET_SCALES[0]);
  await context.client.command("Page.navigate", {
    url: widgetUrl(context.appUrl, side, toolSlotCount, pinned),
  }, context.sessionId);
  await waitForWidgetState(context, pinned ? "expanded" : "collapsed", side, toolSlotCount);
}

async function expandWidget(context: BrowserSmokeContext, side: WidgetSide, toolSlotCount: number) {
  await setWidgetViewport(context, WIDGET_WIDTHS[toolSlotCount], WIDGET_RESOLUTIONS[0], WIDGET_SCALES[0]);
  const clicked = await evaluate(context.client, context.sessionId, `
    (() => {
      const anchor = document.querySelector(".widget-pill-anchor");
      if (!(anchor instanceof HTMLButtonElement)) return false;
      anchor.click();
      return true;
    })()
  `);
  assert.equal(clicked, true, `missing ${side} widget anchor`);
  await waitForWidgetState(context, "expanded", side, toolSlotCount);
}

function distanceFromEdge(rect: Rect, side: WidgetSide, viewportWidth: number) {
  const center = (rect.left + rect.right) / 2;
  return side === "left" ? center : viewportWidth - center;
}

async function verifyScaleEventRelayout(
  context: BrowserSmokeContext,
  side: WidgetSide,
  toolSlotCount: number,
) {
  const commandCount = await evaluate(context.client, context.sessionId, `
    globalThis.__PATINA_INVOKED_COMMANDS.filter(
      (entry) => entry.command === "cmd_set_widget_expanded"
    ).length
  `) as number;
  await evaluate(context.client, context.sessionId, `globalThis.__PATINA_EMIT_SCALE_FACTOR_CHANGED(1.5)`);
  await waitForExpression(
    context.client,
    context.sessionId,
    `globalThis.__PATINA_INVOKED_COMMANDS.filter(
      (entry) => entry.command === "cmd_set_widget_expanded"
    ).length > ${commandCount}`,
    15_000,
    `expanded ${side} widget DPI relayout`,
  );
  const lastLayout = await evaluate(context.client, context.sessionId, `
    globalThis.__PATINA_INVOKED_COMMANDS.filter(
      (entry) => entry.command === "cmd_set_widget_expanded"
    ).at(-1)?.payload
  `);
  assert.deepEqual(lastLayout, { expanded: true, toolSlotCount });
}

export async function runWidgetScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("widget mirrors zero one and two tool layouts across DPI and resolutions", async () => {
    let renderCases = 0;
    const edgeGeometry = new Map<string, number[]>();

    for (const side of ["left", "right"] as const) {
      await navigateToWidget(context, side, 0);
      for (const resolution of WIDGET_RESOLUTIONS) {
        for (const scaleFactor of WIDGET_SCALES) {
          await setWidgetViewport(context, 64, resolution, scaleFactor);
          const result = await inspectWidgetVisibility(context);
          assertWidgetVisibility(result, "collapsed", 0, `collapsed/${side}/${resolution.name}/${scaleFactor}`);
          renderCases += 1;
        }
      }

      for (const toolSlotCount of [0, 1, 2] as const) {
        await navigateToWidget(context, side, toolSlotCount);
        await expandWidget(context, side, toolSlotCount);
        await verifyScaleEventRelayout(context, side, toolSlotCount);
        for (const resolution of WIDGET_RESOLUTIONS) {
          for (const scaleFactor of WIDGET_SCALES) {
            await setWidgetViewport(context, WIDGET_WIDTHS[toolSlotCount], resolution, scaleFactor);
            const result = await inspectWidgetVisibility(context);
            const label = `expanded/${side}/${toolSlotCount}/${resolution.name}/${scaleFactor}`;
            assertWidgetVisibility(result, "expanded", toolSlotCount, label);
            assert.equal(result.viewport.width, WIDGET_WIDTHS[toolSlotCount], `${label}: viewport width`);
            assert.equal(result.viewport.deviceScaleFactor, scaleFactor, `${label}: DPI`);
            renderCases += 1;

            if (resolution.name === "1080p" && scaleFactor === 1) {
              assert.ok(result.anchor && result.actions && result.tracking && result.tray);
              edgeGeometry.set(`${side}:${toolSlotCount}`, [
                distanceFromEdge(result.anchor.rect, side, result.viewport.width),
                distanceFromEdge(result.actions.rect, side, result.viewport.width),
                distanceFromEdge(result.tracking.rect, side, result.viewport.width),
                result.tray.rect.width,
              ]);
            }
          }
        }
      }
    }

    assert.equal(renderCases, 192);
    for (const toolSlotCount of [0, 1, 2] as const) {
      const left = edgeGeometry.get(`left:${toolSlotCount}`);
      const right = edgeGeometry.get(`right:${toolSlotCount}`);
      assert.ok(left && right);
      left.forEach((value, index) => {
        assert.ok(Math.abs(value - right[index]) <= 0.5,
          `#71 mirror mismatch for ${toolSlotCount} tools at metric ${index}: ${value} vs ${right[index]}`);
      });
    }
    for (const side of ["left", "right"] as const) {
      const baseline = edgeGeometry.get(`${side}:0`);
      assert.ok(baseline);
      for (const toolSlotCount of [1, 2] as const) {
        const next = edgeGeometry.get(`${side}:${toolSlotCount}`);
        assert.ok(next);
        for (let index = 0; index < 3; index += 1) {
          assert.ok(Math.abs(baseline[index] - next[index]) <= 0.5,
            `${side} edge controls moved when ${toolSlotCount} tool slots appeared`);
        }
      }
    }

    console.log(`PATINA_WIDGET_DPI_MATRIX_REPORT:${JSON.stringify({
      resolutions: WIDGET_RESOLUTIONS.length,
      scales: WIDGET_SCALES.length,
      expandedToolStates: 3,
      sides: 2,
      renderCases,
    })}`);
  });

  await runTest("widget pin persists without selected chrome and preserves keyboard order", async () => {
    await navigateToWidget(context, "right", 2);
    await expandWidget(context, "right", 2);
    const before = await evaluate(client, sessionId, `
      (() => Array.from(document.querySelectorAll("button")).map((button) => ({
        className: button.className,
        pressed: button.getAttribute("aria-pressed"),
      })))()
    `) as Array<{ className: string; pressed: string | null }>;
    assert.match(before[0]?.className ?? "", /widget-pill-action/);
    assert.match(before[1]?.className ?? "", /widget-pill-pin-action/);
    assert.match(before[2]?.className ?? "", /widget-pill-anchor/);

    assert.equal(await evaluate(client, sessionId, `
      (() => {
        const pin = document.querySelector(".widget-pill-pin-action");
        if (!(pin instanceof HTMLButtonElement)) return false;
        pin.click();
        return true;
      })()
    `), true);
    await waitForExpression(client, sessionId,
      `document.querySelector(".widget-pill-pin-action")?.getAttribute("aria-pressed") === "true"`,
      15_000, "widget pin save");
    const pinnedEvidence = await evaluate(client, sessionId, `
      (() => ({
        payload: globalThis.__PATINA_INVOKED_COMMANDS.filter(
          (entry) => entry.command === "cmd_set_widget_pinned"
        ).at(-1)?.payload,
        pressedClass: document.querySelector(".widget-pill-pin-action")?.classList.contains("qp-icon-action-pressed"),
        filledIcon: document.querySelector(".widget-pin-icon")?.classList.contains("widget-pin-icon-filled"),
      }))()
    `) as { payload: unknown; pressedClass: boolean; filledIcon: boolean };
    assert.deepEqual(pinnedEvidence.payload, { pinned: true, toolSlotCount: 2 });
    assert.equal(pinnedEvidence.pressedClass, false);
    assert.equal(pinnedEvidence.filledIcon, true);

    await evaluate(client, sessionId, `globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE({ focused: false })`);
    await delay(180);
    assert.equal(await evaluate(client, sessionId,
      `document.querySelector(".widget-shell")?.classList.contains("widget-shell-expanded")`), true);

    await evaluate(client, sessionId, `document.querySelector(".widget-pill-pin-action")?.click()`);
    await waitForExpression(client, sessionId,
      `document.querySelector(".widget-pill-pin-action")?.getAttribute("aria-pressed") === "false"`,
      15_000, "widget unpin save");
    await evaluate(client, sessionId, `globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE({ focused: false })`);
    await waitForExpression(client, sessionId,
      `document.querySelector(".widget-shell")?.classList.contains("widget-shell-collapsed")`,
      15_000, "unpinned widget focus collapse");
  });

  await runTest("widget interaction keeps the previous external app and timer visible", async () => {
    await navigateToWidget(context, "right", 0);
    await expandWidget(context, "right", 0);
    const before = await evaluate(client, sessionId, `(() => ({
      label: document.querySelector('.widget-pill-tracking-core')?.getAttribute('aria-label'),
      time: document.querySelector('.widget-pill-tracking-time')?.textContent?.trim(),
      statusRequests: globalThis.__PATINA_INVOKED_COMMANDS.filter(
        (entry) => entry.command === 'cmd_get_widget_status_snapshot'
      ).length,
    }))()`) as { label: string; time: string; statusRequests: number };

    await evaluate(client, sessionId, `(() => {
      const unavailableSignal = {
        signal: {
          is_available: false,
          is_active: false,
          signal_source: null,
          source_app_id: null,
          source_app_identity: null,
          playback_type: null,
        },
        match_result: 'unavailable',
      };
      const windowSnapshot = {
        hwnd: '2',
        root_owner_hwnd: '2',
        process_id: 8,
        window_class: 'Chrome_WidgetWin_1',
        title: 'Patina',
        exe_name: 'patina.exe',
        process_path: 'C:/Program Files/Patina/patina.exe',
        is_afk: false,
        idle_time_ms: 0,
      };
      globalThis.__PATINA_WIDGET_TRACKING_OVERRIDE = {
        currentTrackingSnapshot: {
          window: windowSnapshot,
          status: {
            is_tracking_active: true,
            sustained_participation_eligible: false,
            sustained_participation_active: false,
            sustained_participation_kind: null,
            sustained_participation_state: 'inactive',
            sustained_participation_signal_source: null,
            sustained_participation_reason: 'no-signal',
            sustained_participation_diagnostics: {
              state: 'inactive',
              reason: 'no-signal',
              window_identity: null,
              effective_signal_source: null,
              last_match_at_ms: null,
              grace_deadline_ms: null,
              system_media: unavailableSignal,
              audio_session: unavailableSignal,
            },
          },
          sampled_at_ms: Date.now(),
          probe_status: 'ok',
        },
        widgetStatus: {
          tracking: {
            app_name: 'Patina',
            exe_name: 'patina.exe',
            elapsed_ms: 0,
            running: true,
          },
          tools: [],
          sampled_at_ms: Date.now(),
        },
      };
      globalThis.__PATINA_EMIT_TAURI_EVENT('active-window-changed', windowSnapshot);
    })()`);
    await waitForExpression(client, sessionId, `
      globalThis.__PATINA_INVOKED_COMMANDS.filter(
        (entry) => entry.command === 'cmd_get_widget_status_snapshot'
      ).length > ${before.statusRequests}
    `, 15_000, "widget self-interaction status refresh");

    const after = await evaluate(client, sessionId, `(() => ({
      label: document.querySelector('.widget-pill-tracking-core')?.getAttribute('aria-label'),
      time: document.querySelector('.widget-pill-tracking-time')?.textContent?.trim(),
    }))()`) as { label: string; time: string };
    assert.equal(after.label, before.label);
    assert.equal(after.time, before.time);
  });

  await runTest("widget anchor serializes an unpin while pin persistence is pending", async () => {
    await setWidgetViewport(context, WIDGET_WIDTHS[0], WIDGET_RESOLUTIONS[0], WIDGET_SCALES[0]);
    const url = new URL(widgetUrl(context.appUrl, "right", 0));
    url.searchParams.set("widgetPinDelayMs", "120");
    await client.command("Page.navigate", { url: url.href }, sessionId);
    await waitForWidgetState(context, "collapsed", "right", 0);
    await expandWidget(context, "right", 0);

    assert.equal(await evaluate(client, sessionId, `
      (() => {
        const pin = document.querySelector(".widget-pill-pin-action");
        const anchor = document.querySelector(".widget-pill-anchor");
        if (!(pin instanceof HTMLButtonElement) || !(anchor instanceof HTMLButtonElement)) return false;
        pin.click();
        anchor.click();
        return true;
      })()
    `), true);

    await waitForExpression(client, sessionId, `
      (() => {
        const commands = globalThis.__PATINA_INVOKED_COMMANDS.filter(
          (entry) => entry.command === "cmd_set_widget_pinned"
        );
        const lastTwo = commands.slice(-2).map((entry) => entry.payload?.pinned);
        return lastTwo.length === 2
          && lastTwo[0] === true
          && lastTwo[1] === false
          && document.querySelector(".widget-pill-pin-action")?.getAttribute("aria-pressed") === "false"
          && document.querySelector(".widget-shell")?.classList.contains("widget-shell-collapsed");
      })()
    `, 15_000, "serialized pin then anchor unpin");
  });

  await runTest("widget pin failure stays unpinned and announces one recoverable error", async () => {
    await setWidgetViewport(context, WIDGET_WIDTHS[0], WIDGET_RESOLUTIONS[0], WIDGET_SCALES[0]);
    const url = new URL(widgetUrl(context.appUrl, "right", 0));
    url.searchParams.set("widgetPinFailure", "1");
    await client.command("Page.navigate", { url: url.href }, sessionId);
    await waitForWidgetState(context, "collapsed", "right", 0);
    await expandWidget(context, "right", 0);
    await evaluate(client, sessionId, `document.querySelector(".widget-pill-pin-action")?.click()`);
    await waitForExpression(client, sessionId, `
      document.querySelector('[role="status"]')?.textContent?.trim().length > 0
      && document.querySelector(".widget-pill-pin-action")?.getAttribute("aria-pressed") === "false"
      && !document.querySelector(".widget-pill-pin-action")?.hasAttribute("disabled")
    `, 15_000, "widget pin failure feedback");
    assert.equal(await evaluate(client, sessionId,
      `document.querySelector(".widget-pin-icon")?.classList.contains("widget-pin-icon-filled")`), false);
  });

  await client.command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 820,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  await client.command("Page.navigate", { url: context.appUrl }, sessionId);
  await waitForExpression(client, sessionId,
    `document.documentElement.dataset.windowLabel === "main" && Boolean(document.querySelector(".qp-app-frame"))`,
    15_000, "main window after widget matrix");
}
