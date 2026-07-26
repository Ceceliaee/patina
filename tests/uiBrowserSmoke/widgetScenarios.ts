import assert from "node:assert/strict";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";
import { evaluate, waitForExpression } from "./browserHarness.ts";

const WIDGET_RESOLUTIONS = [
  { name: "720p", width: 1280, height: 720 },
  { name: "768p", width: 1366, height: 768 },
  { name: "900p", width: 1600, height: 900 },
  { name: "1080p", width: 1920, height: 1080 },
  { name: "1440p", width: 2560, height: 1440 },
  { name: "4K", width: 3840, height: 2160 },
] as const;

const WIDGET_SCALES = [1, 1.25, 1.5, 2] as const;
const WIDGET_LOGICAL_HEIGHT = 48;

type WidgetSide = "left" | "right";
type WidgetState = "collapsed" | "expanded-actions" | "expanded-object";

interface WidgetVisibilityResult {
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
    screenWidth: number;
    screenHeight: number;
  };
  tray: WidgetElementVisibility | null;
  object: WidgetElementVisibility | null;
  actions: WidgetElementVisibility | null;
  anchor: WidgetElementVisibility | null;
  lamp: WidgetElementVisibility | null;
  lampStyle: {
    backgroundImage: string;
    coreDiameter: number;
  } | null;
}

interface WidgetElementVisibility {
  rect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  clip: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  fullyVisible: boolean;
  verticallyVisible: boolean;
  visibleWidth: number;
}

function widgetUrl(
  appUrl: string,
  side: WidgetSide,
  showObject: boolean,
) {
  const url = new URL(appUrl);
  url.searchParams.set("__patinaWindow", "widget");
  url.searchParams.set("widgetSide", side);
  url.searchParams.set("widgetObject", showObject ? "1" : "0");
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
) {
  const shellStateClass = state === "collapsed"
    ? "widget-shell-collapsed"
    : "widget-shell-expanded";
  const objectExpectation = state === "expanded-object"
    ? "Boolean(document.querySelector('.widget-pill-object-slot'))"
    : "!document.querySelector('.widget-pill-object-slot')";

  await waitForExpression(
    context.client,
    context.sessionId,
    `document.documentElement.dataset.windowLabel === "widget"
      && document.querySelector(".widget-shell")?.classList.contains(${JSON.stringify(shellStateClass)})
      && document.querySelector(".widget-shell")?.classList.contains(${JSON.stringify(`widget-shell-${side}`)})
      && ${objectExpectation}`,
    15_000,
    `${state} widget on ${side}`,
  );
  await waitForExpression(
    context.client,
    context.sessionId,
    `(() => {
      const shell = document.querySelector(".widget-shell");
      if (!shell) return false;
      return Array.from(shell.getAnimations({ subtree: true }))
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .every((animation) => (
          animation.playState === "finished" || animation.playState === "idle"
        ));
    })()`,
    15_000,
    `${state} widget animations`,
  );
}

async function inspectWidgetVisibility(
  context: BrowserSmokeContext,
): Promise<WidgetVisibilityResult> {
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
      const fullyInside = (rect, clip) =>
        rect.left >= clip.left - 0.5
        && rect.top >= clip.top - 0.5
        && rect.right <= clip.right + 0.5
        && rect.bottom <= clip.bottom + 0.5;
      const inspect = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const clip = { ...viewport };
        let ancestor = node.parentElement;
        while (ancestor) {
          const style = getComputedStyle(ancestor);
          const ancestorRect = ancestor.getBoundingClientRect();
          if (["hidden", "clip", "auto", "scroll"].includes(style.overflowX)) {
            clip.left = Math.max(clip.left, ancestorRect.left);
            clip.right = Math.min(clip.right, ancestorRect.right);
          }
          if (["hidden", "clip", "auto", "scroll"].includes(style.overflowY)) {
            clip.top = Math.max(clip.top, ancestorRect.top);
            clip.bottom = Math.min(clip.bottom, ancestorRect.bottom);
          }
          ancestor = ancestor.parentElement;
        }
        return {
          rect: {
            left: Number(rect.left.toFixed(2)),
            top: Number(rect.top.toFixed(2)),
            right: Number(rect.right.toFixed(2)),
            bottom: Number(rect.bottom.toFixed(2)),
            width: Number(rect.width.toFixed(2)),
            height: Number(rect.height.toFixed(2)),
          },
          clip: {
            left: Number(clip.left.toFixed(2)),
            top: Number(clip.top.toFixed(2)),
            right: Number(clip.right.toFixed(2)),
            bottom: Number(clip.bottom.toFixed(2)),
          },
          fullyVisible: fullyInside(rect, clip),
          verticallyVisible:
            rect.top >= clip.top - 0.5 && rect.bottom <= clip.bottom + 0.5,
          visibleWidth: Math.max(
            0,
            Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left),
          ),
        };
      };
      return {
        viewport: {
          width: viewport.right,
          height: viewport.bottom,
          deviceScaleFactor: window.devicePixelRatio,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
        },
        tray: inspect(".widget-pill-tray"),
        object: inspect(".widget-pill-object-slot"),
        actions: inspect(".widget-pill-actions"),
        anchor: inspect(".widget-pill-anchor"),
        lamp: inspect(".widget-status-lamp"),
        lampStyle: (() => {
          const node = document.querySelector(".widget-status-lamp");
          if (!node) return null;
          const style = getComputedStyle(node);
          return {
            backgroundImage: style.backgroundImage,
            coreDiameter: Number.parseFloat(
              style.getPropertyValue("--qp-widget-lamp-size"),
            ),
          };
        })(),
      };
    })()
  `) as Promise<WidgetVisibilityResult>;
}

function assertWidgetVisibility(
  result: WidgetVisibilityResult,
  state: WidgetState,
  caseLabel: string,
) {
  assert.equal(result.viewport.height, WIDGET_LOGICAL_HEIGHT, `${caseLabel}: viewport height`);
  assert.ok(result.anchor, `${caseLabel}: missing anchor`);

  if (state === "collapsed") {
    assert.equal(
      result.anchor?.verticallyVisible,
      true,
      `${caseLabel}: collapsed anchor was vertically clipped: ${JSON.stringify(result.anchor)}`,
    );
    assert.ok(
      (result.anchor?.visibleWidth ?? 0) >= 16,
      `${caseLabel}: collapsed anchor lost its usable edge target: ${JSON.stringify(result.anchor)}`,
    );
    return;
  }

  assert.equal(
    result.tray?.fullyVisible,
    true,
    `${caseLabel}: tray was clipped: ${JSON.stringify(result.tray)}`,
  );
  assert.equal(
    result.actions?.fullyVisible,
    true,
    `${caseLabel}: actions were clipped: ${JSON.stringify(result.actions)}`,
  );
  assert.equal(
    result.anchor?.fullyVisible,
    true,
    `${caseLabel}: anchor was clipped: ${JSON.stringify(result.anchor)}`,
  );
  assert.equal(
    result.lamp?.fullyVisible,
    true,
    `${caseLabel}: status lamp was clipped: ${JSON.stringify(result.lamp)}`,
  );
  assert.equal(
    result.lampStyle?.coreDiameter,
    10,
    `${caseLabel}: status lamp core diameter regressed`,
  );
  assert.match(
    result.lampStyle?.backgroundImage ?? "",
    /^radial-gradient\(circle,/,
    `${caseLabel}: status lamp must remain a centered circle`,
  );
  const anchorRect = result.anchor?.rect;
  const lampRect = result.lamp?.rect;
  assert.ok(anchorRect && lampRect, `${caseLabel}: missing anchor or status lamp geometry`);
  const physicalAnchorCenterX =
    ((anchorRect.left + anchorRect.right) / 2) * result.viewport.deviceScaleFactor;
  const physicalAnchorCenterY =
    ((anchorRect.top + anchorRect.bottom) / 2) * result.viewport.deviceScaleFactor;
  const physicalLampCenterX =
    ((lampRect.left + lampRect.right) / 2) * result.viewport.deviceScaleFactor;
  const physicalLampCenterY =
    ((lampRect.top + lampRect.bottom) / 2) * result.viewport.deviceScaleFactor;
  assert.ok(
    Math.abs(physicalAnchorCenterX - physicalLampCenterX) < 0.01,
    `${caseLabel}: status lamp horizontal center drifted from anchor`,
  );
  assert.ok(
    Math.abs(physicalAnchorCenterY - physicalLampCenterY) < 0.01,
    `${caseLabel}: status lamp vertical center drifted from anchor`,
  );
  if (state === "expanded-object") {
    assert.equal(
      result.object?.fullyVisible,
      true,
      `${caseLabel}: object slot was clipped: ${JSON.stringify(result.object)}`,
    );
  } else {
    assert.equal(result.object, null, `${caseLabel}: unexpected object slot`);
  }
}

async function runStateMatrix(
  context: BrowserSmokeContext,
  state: WidgetState,
  side: WidgetSide,
  logicalWidth: number,
) {
  let cases = 0;
  for (const resolution of WIDGET_RESOLUTIONS) {
    for (const scaleFactor of WIDGET_SCALES) {
      await setWidgetViewport(context, logicalWidth, resolution, scaleFactor);
      const result = await inspectWidgetVisibility(context);
      const caseLabel = `${state}/${side}/${resolution.name}/${Math.round(scaleFactor * 100)}%`;
      assert.equal(result.viewport.width, logicalWidth, `${caseLabel}: viewport width`);
      assert.equal(
        result.viewport.deviceScaleFactor,
        scaleFactor,
        `${caseLabel}: device scale factor`,
      );
      assert.equal(result.viewport.screenWidth, resolution.width, `${caseLabel}: screen width`);
      assert.equal(result.viewport.screenHeight, resolution.height, `${caseLabel}: screen height`);
      assertWidgetVisibility(result, state, caseLabel);
      cases += 1;
    }
  }
  return cases;
}

async function navigateToWidget(
  context: BrowserSmokeContext,
  side: WidgetSide,
  showObject: boolean,
) {
  await setWidgetViewport(context, 64, WIDGET_RESOLUTIONS[0], WIDGET_SCALES[0]);
  await context.client.command("Page.navigate", {
    url: widgetUrl(context.appUrl, side, showObject),
  }, context.sessionId);
  await waitForWidgetState(context, "collapsed", side);
}

async function expandWidget(
  context: BrowserSmokeContext,
  state: Exclude<WidgetState, "collapsed">,
  side: WidgetSide,
  logicalWidth: number,
) {
  await setWidgetViewport(context, logicalWidth, WIDGET_RESOLUTIONS[0], WIDGET_SCALES[0]);
  const clicked = await evaluate(context.client, context.sessionId, `
    (() => {
      const anchor = document.querySelector(".widget-pill-anchor");
      if (!(anchor instanceof HTMLButtonElement)) return false;
      anchor.click();
      return true;
    })()
  `);
  assert.equal(clicked, true, `missing ${side} widget anchor`);
  await waitForWidgetState(context, state, side);
}

async function verifyScaleEventRelayout(
  context: BrowserSmokeContext,
  side: WidgetSide,
  showObjectSlot: boolean,
) {
  const commandCount = await evaluate(context.client, context.sessionId, `
    globalThis.__PATINA_INVOKED_COMMANDS.filter(
      (entry) => entry.command === "cmd_apply_widget_layout"
    ).length
  `) as number;

  await evaluate(context.client, context.sessionId, `
    globalThis.__PATINA_EMIT_SCALE_FACTOR_CHANGED(1.5)
  `);
  await waitForExpression(
    context.client,
    context.sessionId,
    `globalThis.__PATINA_INVOKED_COMMANDS.filter(
      (entry) => entry.command === "cmd_apply_widget_layout"
    ).length > ${commandCount}`,
    15_000,
    `expanded ${side} widget DPI relayout`,
  );

  const lastLayout = await evaluate(context.client, context.sessionId, `
    globalThis.__PATINA_INVOKED_COMMANDS.filter(
      (entry) => entry.command === "cmd_apply_widget_layout"
    ).at(-1)?.payload
  `);
  assert.deepEqual(lastLayout, {
    side,
    anchorY: 0.28,
    expanded: true,
    showObjectSlot,
  });
}

export async function runWidgetScenarios(context: BrowserSmokeContext) {
  const { client, sessionId, runTest } = context;

  await runTest("widget keeps all DPI and resolution matrix content visible", async () => {
    let renderCases = 0;

    for (const side of ["left", "right"] as const) {
      await navigateToWidget(context, side, false);
      renderCases += await runStateMatrix(context, "collapsed", side, 64);
      await expandWidget(context, "expanded-actions", side, 184);
      await verifyScaleEventRelayout(context, side, false);
      renderCases += await runStateMatrix(context, "expanded-actions", side, 184);

      await navigateToWidget(context, side, true);
      await expandWidget(context, "expanded-object", side, 228);
      await verifyScaleEventRelayout(context, side, true);
      renderCases += await runStateMatrix(context, "expanded-object", side, 228);
    }

    assert.equal(renderCases, 144);
    console.log(`PATINA_WIDGET_DPI_MATRIX_REPORT:${JSON.stringify({
      resolutions: WIDGET_RESOLUTIONS.length,
      scales: WIDGET_SCALES.length,
      states: 3,
      sides: 2,
      renderCases,
    })}`);

    await client.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await client.command("Page.navigate", { url: context.appUrl }, sessionId);
    await waitForExpression(
      client,
      sessionId,
      `document.documentElement.dataset.windowLabel === "main"
        && Boolean(document.querySelector(".qp-app-frame"))`,
      15_000,
      "main window after widget matrix",
    );
  });
}
