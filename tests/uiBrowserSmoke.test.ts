import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "vite";
import {
  CdpConnection,
  getBrowserWebSocketUrl,
  launchBrowser,
  stopBrowser,
} from "./uiBrowserSmoke/browserHarness.ts";
import { tauriBrowserSmokeStubPlugin } from "./uiBrowserSmoke/tauriStubs.ts";
import { runStartupScenarios } from "./uiBrowserSmoke/startupScenarios.ts";
import { runAboutScenarios } from "./uiBrowserSmoke/aboutScenarios.ts";
import { runToolsScenarios } from "./uiBrowserSmoke/toolsScenarios.ts";
import { runNavigationScenarios } from "./uiBrowserSmoke/navigationScenarios.ts";
import { runSettingsScenarios } from "./uiBrowserSmoke/settingsScenarios.ts";
import { runClassificationScenarios } from "./uiBrowserSmoke/classificationScenarios.ts";
import { runDashboardScenarios } from "./uiBrowserSmoke/dashboardScenarios.ts";
import { runHistoryScenarios } from "./uiBrowserSmoke/historyScenarios.ts";
import { runDataScenarios } from "./uiBrowserSmoke/dataScenarios.ts";
import { runLocaleScenarios } from "./uiBrowserSmoke/localeScenarios.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
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
    if (message.sessionId !== sessionId) {
      return;
    }

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

  const smokeContext = { appUrl, client: client!, sessionId, runTest };

  await runStartupScenarios(smokeContext);

  await runAboutScenarios(smokeContext);

  await runToolsScenarios(smokeContext);

  await runNavigationScenarios(smokeContext);

  await runSettingsScenarios(smokeContext);

  await runClassificationScenarios(smokeContext);

  await runDashboardScenarios(smokeContext);

  await runHistoryScenarios(smokeContext);

  await runDataScenarios(smokeContext);

  await runLocaleScenarios(smokeContext);

  assert.deepEqual(consoleErrors, []);
} finally {
  client?.close();
  if (browserProcess) {
    await stopBrowser(browserProcess);
  }
  if (browserUserDataDir) {
    try {
      rmSync(browserUserDataDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    } catch (error) {
      console.warn("Failed to remove browser smoke temp profile:", error);
    }
  }
  await server.close();
}

console.log(`Passed ${passed} browser UI smoke tests`);
