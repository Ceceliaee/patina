import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { delay, evaluate, waitFor } from "./browserHarness.ts";
import type { BrowserSmokeContext } from "./scenarioTypes.ts";

const FIXTURE_ID = "qp-scroll-region-browser-fixture";

async function captureFixtureScreenshot(
  context: BrowserSmokeContext,
  fileName: string,
  theme: "light" | "dark",
) {
  const captureDir = process.env.PATINA_SCROLL_REGION_SCREENSHOT_DIR?.trim();
  if (!captureDir) return;
  const previousTheme = await evaluate(
    context.client,
    context.sessionId,
    `document.documentElement.getAttribute("data-theme")`,
  );
  try {
    await evaluate(
      context.client,
      context.sessionId,
      `document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
    );
    const result = await context.client.command("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      clip: { x: 12, y: 36, width: 204, height: 144, scale: 1 },
    }, context.sessionId) as { data: string };
    await mkdir(captureDir, { recursive: true });
    await writeFile(resolve(captureDir, fileName), Buffer.from(result.data, "base64"));
  } finally {
    await evaluate(
      context.client,
      context.sessionId,
      previousTheme === null
        ? `document.documentElement.removeAttribute("data-theme")`
        : `document.documentElement.setAttribute("data-theme", ${JSON.stringify(String(previousTheme))})`,
    );
  }
}

async function removeFixture(context: BrowserSmokeContext) {
  await evaluate(
    context.client,
    context.sessionId,
    `document.getElementById(${JSON.stringify(FIXTURE_ID)})?.remove()`,
  );
}

async function createFixture(
  context: BrowserSmokeContext,
  options: {
    axis?: "vertical" | "horizontal";
    overflow?: boolean;
    stable?: boolean;
  } = {},
) {
  const axis = options.axis ?? "vertical";
  const overflow = options.overflow ?? false;
  const stable = options.stable ?? false;

  await evaluate(context.client, context.sessionId, `
    (() => {
      document.getElementById(${JSON.stringify(FIXTURE_ID)})?.remove();
      const fixture = document.createElement("div");
      fixture.id = ${JSON.stringify(FIXTURE_ID)};
      fixture.className = ${JSON.stringify(
        `qp-scroll-region${stable ? " qp-scroll-region-stable" : ""}`,
      )};
      fixture.tabIndex = 0;
      fixture.setAttribute("aria-label", "Scroll region browser fixture");
      Object.assign(fixture.style, {
        position: "fixed",
        left: "24px",
        top: "48px",
        zIndex: "2147483647",
        width: "180px",
        height: "120px",
        overflowX: ${JSON.stringify(axis === "horizontal" ? "auto" : "hidden")},
        overflowY: ${JSON.stringify(axis === "vertical" ? "auto" : "hidden")},
        background: "var(--qp-bg-panel)",
      });
      const content = document.createElement("div");
      content.dataset.scrollRegionFixtureContent = "true";
      content.style.width = ${JSON.stringify(axis === "horizontal" && overflow ? "520px" : "100%")};
      content.style.height = ${JSON.stringify(axis === "vertical" && overflow ? "520px" : "80px")};
      content.textContent = "Quiet Pro scroll region contract";
      fixture.append(content);
      document.body.append(fixture);
      return true;
    })()
  `);
}

async function fixtureMetrics(context: BrowserSmokeContext) {
  return evaluate(context.client, context.sessionId, `
    (() => {
      const fixture = document.getElementById(${JSON.stringify(FIXTURE_ID)});
      if (!fixture) return null;
      const rect = fixture.getBoundingClientRect();
      const fixtureStyle = getComputedStyle(fixture);
      const scrollbarStyle = getComputedStyle(fixture, "::-webkit-scrollbar");
      const thumbStyle = getComputedStyle(fixture, "::-webkit-scrollbar-thumb");
      const scrollbarRules = [];
      const collectScrollbarRules = (ruleList) => {
        for (const rule of ruleList) {
          if (rule.selectorText?.includes(".qp-scroll-region::-webkit-scrollbar-button")) {
            scrollbarRules.push(rule);
          }
          if (rule.cssRules) collectScrollbarRules(rule.cssRules);
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          collectScrollbarRules(sheet.cssRules);
        } catch {
          // Cross-origin stylesheets are irrelevant to Patina's local Quiet Pro contract.
        }
      }
      const ruleFor = (selector) => scrollbarRules.find(
        (rule) => rule.selectorText?.split(",").map((part) => part.trim()).includes(selector),
      );
      const baseButtonRule = ruleFor(".qp-scroll-region::-webkit-scrollbar-button:single-button:vertical");
      const decrementButtonRule = ruleFor(
        ".qp-scroll-region::-webkit-scrollbar-button:single-button:vertical:decrement",
      );
      const incrementButtonRule = ruleFor(
        ".qp-scroll-region::-webkit-scrollbar-button:single-button:vertical:increment",
      );
      return {
        buttonContract: {
          decrementImage: decrementButtonRule?.style.backgroundImage ?? "",
          display: baseButtonRule?.style.display ?? "",
          height: baseButtonRule?.style.height ?? "",
          incrementImage: incrementButtonRule?.style.backgroundImage ?? "",
          width: baseButtonRule?.style.width ?? "",
        },
        clientHeight: fixture.clientHeight,
        clientWidth: fixture.clientWidth,
        horizontalLane: fixture.offsetHeight - fixture.clientHeight,
        maxScrollLeft: fixture.scrollWidth - fixture.clientWidth,
        maxScrollTop: fixture.scrollHeight - fixture.clientHeight,
        offsetHeight: fixture.offsetHeight,
        offsetWidth: fixture.offsetWidth,
        rect: { top: rect.top, right: rect.right, bottom: rect.bottom },
        scrollLeft: fixture.scrollLeft,
        scrollbarSize: Number.parseFloat(scrollbarStyle.width),
        scrollTop: fixture.scrollTop,
        thumbInset: Number.parseFloat(thumbStyle.borderLeftWidth),
        tokenScrollbarButtonSize: Number.parseFloat(
          fixtureStyle.getPropertyValue("--qp-scrollbar-button-size"),
        ),
        tokenScrollbarSize: Number.parseFloat(fixtureStyle.getPropertyValue("--qp-scrollbar-size")),
        verticalLane: fixture.offsetWidth - fixture.clientWidth,
      };
    })()
  `) as Promise<{
    buttonContract: {
      decrementImage: string;
      display: string;
      height: string;
      incrementImage: string;
      width: string;
    };
    clientHeight: number;
    clientWidth: number;
    horizontalLane: number;
    maxScrollLeft: number;
    maxScrollTop: number;
    offsetHeight: number;
    offsetWidth: number;
    rect: { top: number; right: number; bottom: number };
    scrollLeft: number;
    scrollbarSize: number;
    scrollTop: number;
    thumbInset: number;
    tokenScrollbarButtonSize: number;
    tokenScrollbarSize: number;
    verticalLane: number;
  }>;
}

function assertCanonicalScrollbarWidth(
  metrics: Awaited<ReturnType<typeof fixtureMetrics>>,
) {
  assert.equal(metrics.tokenScrollbarSize, 6, "Quiet Pro scrollbar token must remain 6px");
  assert.equal(metrics.scrollbarSize, 6, "rendered scrollbar style must remain 6px");
}

function assertSystemScrollbarLane(lane: number, message: string) {
  assert.ok(
    lane === 0 || lane === 6,
    `${message}; expected a 6px classic lane or a 0px system overlay lane, observed ${lane}px`,
  );
}

export async function runScrollRegionScenarios(context: BrowserSmokeContext) {
  const { client, runTest, sessionId } = context;

  await runTest("scroll region returns the vertical lane when overflow disappears", async () => {
    try {
      await createFixture(context);
      const fits = await fixtureMetrics(context);
      assert.equal(fits.verticalLane, 0, "default scroll regions must not reserve an empty lane");

      await evaluate(client, sessionId, `
        document.querySelector("[data-scroll-region-fixture-content]").style.height = "520px"
      `);
      const overflow = await fixtureMetrics(context);
      assertCanonicalScrollbarWidth(overflow);
      assertSystemScrollbarLane(overflow.verticalLane, "overflow should use the canonical scrollbar width");
      assert.equal(overflow.thumbInset, 0, "the 6px lane should keep the full historical thumb width");

      await evaluate(client, sessionId, `
        document.querySelector("[data-scroll-region-fixture-content]").style.height = "80px"
      `);
      const returned = await fixtureMetrics(context);
      assert.equal(returned.verticalLane, 0, "removing overflow must return the lane to content");
    } finally {
      await removeFixture(context);
    }
  });

  await runTest("stable scroll region preserves content width across overflow changes", async () => {
    try {
      await createFixture(context, { stable: true });
      const fits = await fixtureMetrics(context);
      assertCanonicalScrollbarWidth(fits);
      assertSystemScrollbarLane(fits.verticalLane, "stable scroll region should follow the system lane model");

      await evaluate(client, sessionId, `
        document.querySelector("[data-scroll-region-fixture-content]").style.height = "520px"
      `);
      const overflow = await fixtureMetrics(context);
      assertCanonicalScrollbarWidth(overflow);
      assert.equal(overflow.verticalLane, fits.verticalLane);
      assert.equal(overflow.clientWidth, fits.clientWidth);
    } finally {
      await removeFixture(context);
    }
  });

  await runTest("scroll region keeps native Home and End keyboard behavior", async () => {
    try {
      await createFixture(context, { overflow: true });
      await evaluate(client, sessionId, `document.getElementById(${JSON.stringify(FIXTURE_ID)}).focus()`);
      await client.command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "End",
        code: "End",
        windowsVirtualKeyCode: 35,
        nativeVirtualKeyCode: 35,
      }, sessionId);
      await client.command("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "End",
        code: "End",
        windowsVirtualKeyCode: 35,
        nativeVirtualKeyCode: 35,
      }, sessionId);
      await waitFor("fixture to reach the end", async () => {
        const metrics = await fixtureMetrics(context);
        return metrics.scrollTop === metrics.maxScrollTop ? true : null;
      });

      await client.command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Home",
        code: "Home",
        windowsVirtualKeyCode: 36,
        nativeVirtualKeyCode: 36,
      }, sessionId);
      await client.command("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Home",
        code: "Home",
        windowsVirtualKeyCode: 36,
        nativeVirtualKeyCode: 36,
      }, sessionId);
      await waitFor("fixture to return home", async () => {
        const metrics = await fixtureMetrics(context);
        return metrics.scrollTop === 0 ? true : null;
      });
    } finally {
      await removeFixture(context);
    }
  });

  await runTest("vertical scrollbar buttons keep canonical geometry and native step scrolling", async () => {
    try {
      await createFixture(context, { overflow: true });
      const initial = await fixtureMetrics(context);
      assertCanonicalScrollbarWidth(initial);
      assert.equal(initial.tokenScrollbarButtonSize, 6, "vertical scrollbar buttons must remain 6px");
      assert.deepEqual(
        {
          display: initial.buttonContract.display,
          height: initial.buttonContract.height,
          width: initial.buttonContract.width,
        },
        {
          display: "block",
          height: "var(--qp-scrollbar-button-size)",
          width: "var(--qp-scrollbar-size)",
        },
      );
      assert.match(initial.buttonContract.decrementImage, /linear-gradient/);
      assert.match(initial.buttonContract.incrementImage, /linear-gradient/);
      assert.ok(initial.maxScrollTop > 0, "vertical scroll region must remain scrollable");
      await evaluate(client, sessionId, `document.getElementById(${JSON.stringify(FIXTURE_ID)}).focus()`);
      await client.command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "ArrowDown",
        code: "ArrowDown",
        windowsVirtualKeyCode: 40,
        nativeVirtualKeyCode: 40,
      }, sessionId);
      await client.command("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "ArrowDown",
        code: "ArrowDown",
        windowsVirtualKeyCode: 40,
        nativeVirtualKeyCode: 40,
      }, sessionId);
      const afterIncrement = await waitFor("native vertical step increment", async () => {
        const metrics = await fixtureMetrics(context);
        return metrics.scrollTop > 0 ? metrics : null;
      });
      assert.ok(
        afterIncrement.scrollTop <= 60,
        `native increment should step rather than page; observed ${afterIncrement.scrollTop}px`,
      );

      await evaluate(client, sessionId, `
        document.getElementById(${JSON.stringify(FIXTURE_ID)}).scrollTop = 120
      `);
      const beforeDecrement = await fixtureMetrics(context);
      await client.command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "ArrowUp",
        code: "ArrowUp",
        windowsVirtualKeyCode: 38,
        nativeVirtualKeyCode: 38,
      }, sessionId);
      await client.command("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "ArrowUp",
        code: "ArrowUp",
        windowsVirtualKeyCode: 38,
        nativeVirtualKeyCode: 38,
      }, sessionId);
      const afterDecrement = await waitFor("native vertical step decrement", async () => {
        const metrics = await fixtureMetrics(context);
        return metrics.scrollTop < beforeDecrement.scrollTop ? metrics : null;
      });
      assert.ok(
        beforeDecrement.scrollTop - afterDecrement.scrollTop <= 60,
        "native decrement should use the same restrained step",
      );
    } finally {
      await removeFixture(context);
    }
  });

  await runTest("horizontal scroll regions do not acquire a vertical lane", async () => {
    try {
      await createFixture(context, { axis: "horizontal", overflow: true });
      const metrics = await fixtureMetrics(context);
      assertCanonicalScrollbarWidth(metrics);
      assert.equal(metrics.verticalLane, 0);
      assertSystemScrollbarLane(metrics.horizontalLane, "horizontal overflow should follow the system lane model");
      assert.ok(metrics.maxScrollLeft > 0);
      assert.equal(metrics.maxScrollTop, 0);
    } finally {
      await removeFixture(context);
    }
  });

  await runTest("scrollbar geometry remains stable across supported DPI scales", async () => {
    try {
      for (const deviceScaleFactor of [1, 1.25, 1.5, 2]) {
        await client.command("Emulation.setDeviceMetricsOverride", {
          width: 1280,
          height: 820,
          deviceScaleFactor,
          mobile: false,
        }, sessionId);
        await createFixture(context, { overflow: true });
        const metrics = await fixtureMetrics(context);
        assertCanonicalScrollbarWidth(metrics);
        assertSystemScrollbarLane(
          metrics.verticalLane,
          `scrollbar lane should stay canonical at ${deviceScaleFactor} device scale`,
        );
        assert.equal(
          metrics.thumbInset,
          0,
          `scrollbar thumb inset should remain 0 CSS px at ${deviceScaleFactor} device scale`,
        );
        await captureFixtureScreenshot(
          context,
          `scroll-region-light-${String(deviceScaleFactor).replace(".", "-")}x.png`,
          "light",
        );
        if (deviceScaleFactor === 1 || deviceScaleFactor === 2) {
          await captureFixtureScreenshot(
            context,
            `scroll-region-dark-${deviceScaleFactor}x.png`,
            "dark",
          );
        }
      }
    } finally {
      await removeFixture(context);
      await client.command("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 820,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
    }
  });

  await runTest("forced colors returns scrollbar rendering to the system", async () => {
    try {
      await client.command("Emulation.setEmulatedMedia", {
        features: [{ name: "forced-colors", value: "active" }],
      }, sessionId);
      await createFixture(context, { overflow: true });
      await delay(50);
      const scrollbarColor = await evaluate(client, sessionId, `
        getComputedStyle(document.getElementById(${JSON.stringify(FIXTURE_ID)})).scrollbarColor
      `);
      assert.equal(scrollbarColor, "auto");
    } finally {
      await removeFixture(context);
      await client.command("Emulation.setEmulatedMedia", { features: [] }, sessionId);
    }
  });
}
