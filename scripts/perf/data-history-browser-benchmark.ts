import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { createServer } from "vite";
import {
  CdpConnection,
  evaluate,
  getBrowserWebSocketUrl,
  jsonString,
  launchBrowser,
  removeIsolatedBrowserDataDir,
  stopBrowser,
  waitForExpression,
} from "../../tests/uiBrowserSmoke/browserHarness.ts";
import { APP_LOADING_VIEW, HISTORY_LOADING_VIEW } from "../../tests/uiBrowserSmoke/constants.ts";
import { tauriBrowserSmokeStubPlugin } from "../../tests/uiBrowserSmoke/tauriStubs.ts";
import {
  createBenchmarkMeasurement,
  measureAsyncBenchmark,
  printBenchmarkReport,
  type BenchmarkMeasurement,
} from "./benchmarkUtils.ts";

const DATA_LABEL = "数据";
const DASHBOARD_LABEL = "今天";
const HISTORY_LABEL = "历史";
const HISTORY_MEANINGFUL_CONTENT_EXPRESSION = `
  (() => {
    const root = document.querySelector("[data-history-content-state]");
    const state = root?.getAttribute("data-history-content-state");
    return Boolean(
      root?.getAttribute("data-history-content-date")
      && ["bootstrap", "refreshing", "ready", "empty"].includes(state ?? "")
      && document.querySelector(".history-horizontal-timeline")?.checkVisibility()
    );
  })()
`;

function enforceP95Budget(
  measurement: BenchmarkMeasurement,
  budgetP95Ms: number,
): BenchmarkMeasurement {
  return {
    ...measurement,
    budgetP95Ms,
    withinBudget: measurement.averageMs <= measurement.budgetAverageMs
      && measurement.p95Ms <= budgetP95Ms
      && measurement.maxMs <= measurement.budgetMaxMs,
  };
}

function navClickExpression(label: string) {
  return `
    (() => {
      const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']');
      if (!node) return false;
      node.click();
      return true;
    })()
  `;
}

function navActiveExpression(label: string) {
  return `
    document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']')
      ?.className.includes("qp-nav-item-active")
  `;
}

async function waitForPaint(client: CdpConnection, sessionId: string) {
  await evaluate(client, sessionId, `
    new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
    })
  `);
}

async function clickNav(
  client: CdpConnection,
  sessionId: string,
  label: string,
  readyExpression: string,
) {
  assert.equal(await evaluate(client, sessionId, navClickExpression(label)), true);
  await waitForExpression(client, sessionId, navActiveExpression(label), 45_000);
  await waitForExpression(client, sessionId, readyExpression, 45_000);
  await waitForPaint(client, sessionId);
}

async function clickNavActiveDurationMs(
  client: CdpConnection,
  sessionId: string,
  label: string,
) {
  const duration = await evaluate(client, sessionId, `
    new Promise((resolve, reject) => {
      const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']');
      if (!node) {
        reject(new Error("missing navigation entry"));
        return;
      }

      const startedAt = performance.now();
      node.click();

      const isActive = () => document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']')
        ?.className.includes("qp-nav-item-active");
      const finishAfterPaint = () => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve(performance.now() - startedAt));
        });
      };
      const checkActive = () => {
        if (isActive()) {
          finishAfterPaint();
          return;
        }
        if (performance.now() - startedAt > 45000) {
          reject(new Error("timed out waiting for active navigation"));
          return;
        }
        requestAnimationFrame(checkActive);
      };

      checkActive();
    })
  `);
  assert.equal(typeof duration, "number");
  return duration as number;
}

async function clickNavConditionDurationMs(
  client: CdpConnection,
  sessionId: string,
  label: string,
  readyExpression: string,
) {
  const duration = await evaluate(client, sessionId, `
    new Promise((resolve, reject) => {
      const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']');
      if (!node) {
        reject(new Error("missing navigation entry"));
        return;
      }

      const startedAt = performance.now();
      node.click();
      const checkReady = () => {
        if (${readyExpression}) {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - startedAt)));
          return;
        }
        if (performance.now() - startedAt > 45000) {
          reject(new Error("timed out waiting for meaningful content"));
          return;
        }
        requestAnimationFrame(checkReady);
      };
      checkReady();
    })
  `);
  assert.equal(typeof duration, "number");
  return duration as number;
}

async function measurePreparedBrowserDuration(
  name: string,
  iterations: number,
  budgetAverageMs: number,
  prepare: () => Promise<void>,
  run: () => Promise<number>,
) {
  const durations: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    await prepare();
    durations.push(await run());
  }
  return createBenchmarkMeasurement(name, durations, budgetAverageMs);
}

async function openDashboard(client: CdpConnection, sessionId: string) {
  await clickNav(
    client,
    sessionId,
    DASHBOARD_LABEL,
    `document.body.innerText.includes("专注分布") || document.body.innerText.includes("应用排行")`,
  );
}

async function openData(client: CdpConnection, sessionId: string) {
  await clickNav(
    client,
    sessionId,
    DATA_LABEL,
    `Boolean(document.querySelector(".data-trend-range-trigger") && document.querySelector(".data-app-panel"))`,
  );
  assert.equal(await evaluate(client, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`), false);
  assert.equal(await evaluate(client, sessionId, `document.body.innerText.includes(${jsonString(HISTORY_LOADING_VIEW)})`), false);
}

async function openHistory(client: CdpConnection, sessionId: string) {
  await clickNav(
    client,
    sessionId,
    HISTORY_LABEL,
    `${HISTORY_MEANINGFUL_CONTENT_EXPRESSION}
      && Boolean(document.querySelector(".history-app-distribution-card")?.checkVisibility())`,
  );
  assert.equal(await evaluate(client, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`), false);
  assert.equal(await evaluate(client, sessionId, `document.body.innerText.includes(${jsonString(HISTORY_LOADING_VIEW)})`), false);
}

async function resetOverviewRangeToSevenDays(client: CdpConnection, sessionId: string) {
  for (let index = 0; index < 3; index += 1) {
    const isSevenDays = await evaluate(
      client,
      sessionId,
      `document.querySelectorAll(".data-trend-range-trigger")[0]?.textContent?.trim() === "近 7 天"`,
    );
    if (isSevenDays) return;

    await evaluate(client, sessionId, `
      (() => {
        const control = document.querySelectorAll(".data-trend-range-control")[0];
        const button = control?.querySelector("button:first-of-type");
        if (button && !button.disabled) button.click();
        return true;
      })()
    `);
    await waitForPaint(client, sessionId);
  }
}

async function setOverviewRangeToYear(client: CdpConnection, sessionId: string) {
  await resetOverviewRangeToSevenDays(client, sessionId);
  for (let index = 0; index < 2; index += 1) {
    await evaluate(client, sessionId, `
      (() => {
        const control = document.querySelectorAll(".data-trend-range-control")[0];
        const button = control?.querySelector("button:last-of-type");
        if (button && !button.disabled) button.click();
        return true;
      })()
    `);
    await waitForPaint(client, sessionId);
  }
  await waitForExpression(
    client,
    sessionId,
    `document.querySelectorAll(".data-trend-range-trigger")[0]?.textContent?.includes("年")`,
    45_000,
  );
}

async function setOverviewRangeToSevenDays(client: CdpConnection, sessionId: string) {
  for (let index = 0; index < 2; index += 1) {
    await evaluate(client, sessionId, `
      (() => {
        const control = document.querySelectorAll(".data-trend-range-control")[0];
        const button = control?.querySelector("button:first-of-type");
        if (button && !button.disabled) button.click();
        return true;
      })()
    `);
    await waitForPaint(client, sessionId);
  }
  await waitForExpression(
    client,
    sessionId,
    `document.querySelectorAll(".data-trend-range-trigger")[0]?.textContent?.trim() === "近 7 天"`,
    45_000,
  );
}

let browserProcess: ChildProcess | null = null;
let browserUserDataDir: string | null = null;
let client: CdpConnection | null = null;
const consoleErrors: string[] = [];

const server = await createServer({
  configFile: "vite.config.ts",
  logLevel: "error",
  plugins: [tauriBrowserSmokeStubPlugin()],
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
    hmr: false,
  },
});

try {
  await server.listen();
  const appUrl = server.resolvedUrls?.local[0] ?? "";
  assert.ok(appUrl, "Vite did not expose a local URL");

  const browser = await launchBrowser();
  browserProcess = browser.browser;
  browserUserDataDir = browser.userDataDir;
  client = await CdpConnection.connect(await getBrowserWebSocketUrl(browser.port));

  const { targetId } = await client.command("Target.createTarget", { url: "about:blank" }) as {
    targetId: string;
  };
  const { sessionId } = await client.command("Target.attachToTarget", {
    targetId,
    flatten: true,
  }) as { sessionId: string };

  client.onMessage((message) => {
    if (message.sessionId !== sessionId) return;

    if (message.method === "Runtime.consoleAPICalled") {
      const params = message.params as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
      if (params.type === "error") {
        consoleErrors.push(params.args?.map((arg) => arg.value ?? arg.description).join(" ") ?? "console.error");
      }
    }

    if (message.method === "Runtime.exceptionThrown") {
      consoleErrors.push(JSON.stringify(message.params));
    }

    if (message.method === "Log.entryAdded") {
      const params = message.params as { entry?: { level?: string; text?: string } };
      if (params.entry?.level === "error") {
        consoleErrors.push(params.entry.text ?? "browser log error");
      }
    }
  });

  await client.command("Runtime.enable", {}, sessionId);
  await client.command("Page.enable", {}, sessionId);
  await client.command("Log.enable", {}, sessionId);
  await client.command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 820,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  await client.command("Page.navigate", { url: appUrl }, sessionId);
  await waitForExpression(client, sessionId, navActiveExpression(DASHBOARD_LABEL), 45_000);
  await waitForPaint(client, sessionId);

  const coldHistoryMeaningfulContentDurationMs = await clickNavConditionDurationMs(
    client,
    sessionId,
    HISTORY_LABEL,
    HISTORY_MEANINGFUL_CONTENT_EXPRESSION,
  );
  await waitForExpression(
    client,
    sessionId,
    "Boolean(document.querySelector('.history-horizontal-timeline-segment')?.checkVisibility())",
    45_000,
  );
  await openDashboard(client, sessionId);

  const measurements = [
    createBenchmarkMeasurement(
      "browser-dashboard-to-history-meaningful-content-cold",
      [coldHistoryMeaningfulContentDurationMs],
      350,
    ),
    await measurePreparedBrowserDuration("browser-dashboard-to-data-active", 8, 160, async () => {
      await openDashboard(client!, sessionId);
    }, async () => {
      const duration = await clickNavActiveDurationMs(client!, sessionId, DATA_LABEL);
      assert.equal(await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`), false);
      return duration;
    }),
    await measureAsyncBenchmark("browser-dashboard-to-data", 8, 500, async () => {
      await openDashboard(client!, sessionId);
      await openData(client!, sessionId);
    }),
    await measureAsyncBenchmark("browser-data-7d-to-365d", 8, 1_000, async () => {
      await openData(client!, sessionId);
      await setOverviewRangeToYear(client!, sessionId);
      await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-overview-grid"))`, 45_000);
    }),
    await measureAsyncBenchmark("browser-data-365d-to-7d", 8, 1_000, async () => {
      await openData(client!, sessionId);
      await setOverviewRangeToYear(client!, sessionId);
      await setOverviewRangeToSevenDays(client!, sessionId);
    }),
    await measureAsyncBenchmark("browser-dashboard-to-history", 8, 350, async () => {
      await openDashboard(client!, sessionId);
      await openHistory(client!, sessionId);
    }),
    enforceP95Budget(
      await measurePreparedBrowserDuration("browser-dashboard-to-history-active", 8, 160, async () => {
        await openDashboard(client!, sessionId);
      }, () => clickNavActiveDurationMs(client!, sessionId, HISTORY_LABEL)),
      160,
    ),
    await measurePreparedBrowserDuration(
      "browser-dashboard-to-history-meaningful-content-hot",
      8,
      160,
      async () => {
        await openDashboard(client!, sessionId);
      },
      () => clickNavConditionDurationMs(
        client!,
        sessionId,
        HISTORY_LABEL,
        HISTORY_MEANINGFUL_CONTENT_EXPRESSION,
      ),
    ),
  ];

  printBenchmarkReport({
    benchmark: "data-history-browser",
    measuredAt: new Date().toISOString(),
    measurements,
    metadata: {
      appUrl,
      consoleErrorCount: consoleErrors.length,
      consoleErrors,
      dataSource: "Vite browser harness with Tauri SQL/plugin stubs; measures navigation and render path, not real SQLite I/O.",
      viewport: { width: 1280, height: 820 },
    },
  });

  if (consoleErrors.length > 0) {
    process.exitCode = 1;
  }
} finally {
  client?.close();
  if (browserProcess) {
    await stopBrowser(browserProcess);
  }
  if (browserUserDataDir) {
    try {
      await removeIsolatedBrowserDataDir(browserUserDataDir);
    } catch (error) {
      console.warn("Failed to remove browser perf temp profile:", error);
    }
  }
  await server.close();
}
