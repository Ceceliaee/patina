import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Plugin } from "vite";
import { COPY } from "../src/shared/copy/uiText.ts";

const EXPECTED_NAV_LABELS = ["今天", "历史", "数据", "应用", "设置", "关于"] as const;
const DASHBOARD_MARKERS = ["专注分布", "应用排行"] as const;
const SETTINGS_MARKER = "主题模式";
const APP_LOADING_VIEW = COPY["zh-CN"].app.loadingView;
const HISTORY_TITLE_DETAIL_COUNT = 10;
const DEFAULT_TIMEOUT_MS = 15_000;

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function tauriStubFor(path: string) {
  if (path === "@tauri-apps/api/window") {
    return `
      const noop = async () => {};
      const currentWindow = {
        label: "main",
        minimize: noop,
        toggleMaximize: noop,
        close: noop,
        startDragging: noop,
        setFocusable: noop,
        isMaximized: async () => false,
        isVisible: async () => true,
        isFocused: async () => false,
        outerPosition: async () => ({ x: 0, y: 0 }),
        outerSize: async () => ({ width: 1280, height: 800 }),
        onMoved: async () => () => {},
        onFocusChanged: async () => () => {},
        onResized: async () => () => {},
      };
      export function getCurrentWindow() {
        return currentWindow;
      }
      export async function availableMonitors() {
        return [];
      }
      export async function currentMonitor() {
        return null;
      }
      export async function primaryMonitor() {
        return null;
      }
      export async function cursorPosition() {
        return { x: 0, y: 0 };
      }
    `;
  }

  if (path === "@tauri-apps/api/webviewWindow") {
    return `
      export function getCurrentWebviewWindow() {
        return { label: "main" };
      }
    `;
  }

  if (path === "@tauri-apps/api/core") {
    return `
      export async function invoke() {
        return null;
      }
      export class Channel {
        onmessage = null;
        constructor() {}
      }
    `;
  }

  if (path === "@tauri-apps/api/event") {
    return `
      export async function listen() {
        return () => {};
      }
      export async function emit() {}
    `;
  }

  if (path === "@tauri-apps/api/app") {
    return `
      export async function getVersion() {
        return "0.0.0-browser-smoke";
      }
    `;
  }

  if (path === "@tauri-apps/plugin-opener") {
    return `
      export async function openUrl() {}
    `;
  }

  if (path === "@tauri-apps/plugin-sql") {
    return `
      function smokeDayStart() {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0).getTime();
      }

      function historySessionRows() {
        const start = smokeDayStart();
        return [
          {
            id: 901,
            app_name: "Extremely Long Research Workbench Application Name",
            exe_name: "deep-research-workbench.exe",
            window_title: "Extremely detailed project brief",
            start_time: start,
            end_time: start + 20 * 60 * 1000,
            duration: 20 * 60 * 1000,
            continuity_group_start_time: start,
          },
          {
            id: 902,
            app_name: "Extremely Long Research Workbench Application Name",
            exe_name: "deep-research-workbench.exe",
            window_title: "Budget spreadsheet review",
            start_time: start + 22 * 60 * 1000,
            end_time: start + 42 * 60 * 1000,
            duration: 20 * 60 * 1000,
            continuity_group_start_time: start,
          },
        ];
      }

      function historyTitleSampleRows() {
        const start = smokeDayStart();
        return Array.from({ length: ${HISTORY_TITLE_DETAIL_COUNT} }, (_, index) => {
          const sessionId = index < 5 ? 901 : 902;
          const sessionOffset = index < 5 ? 0 : 22 * 60 * 1000;
          const sampleIndex = index % 5;
          const sampleStart = start + sessionOffset + sampleIndex * 4 * 60 * 1000;
          return {
            session_id: sessionId,
            title: "Detailed document title " + (index + 1) + " for a very long research workflow",
            start_time: sampleStart,
            end_time: sampleStart + 4 * 60 * 1000,
          };
        });
      }

      export default class Database {
        static async load() {
          return new Database();
        }

        async select(query) {
          const normalizedQuery = String(query ?? "").toLowerCase();
          if (normalizedQuery.includes("from settings")) {
            const language = globalThis.__TIME_TRACKER_SMOKE_LANGUAGE;
            return language ? [{ key: "language", value: language }] : [];
          }
          if (normalizedQuery.includes("min(start_time)")) {
            return [{ earliest_start_time: historySessionRows()[0].start_time }];
          }
          if (normalizedQuery.includes("from session_title_samples")) {
            return historyTitleSampleRows();
          }
          if (normalizedQuery.includes("from sessions")) {
            return historySessionRows();
          }
          return [];
        }

        async execute() {}
        async close() {}
      }
    `;
  }

  throw new Error(`Missing Tauri browser smoke stub for ${path}`);
}

function tauriBrowserSmokeStubPlugin(): Plugin {
  return {
    name: "tauri-browser-smoke-stubs",
    enforce: "pre",
    resolveId(source) {
      if (source.startsWith("@tauri-apps/")) {
        return `\0tauri-browser-smoke:${source}`;
      }
      return null;
    },
    load(id) {
      const prefix = "\0tauri-browser-smoke:";
      if (id.startsWith(prefix)) {
        return tauriStubFor(id.slice(prefix.length));
      }
      return null;
    },
  };
}

function commandPath(command: string) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [command], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.split(/\r?\n/).find(Boolean) ?? null : null;
}

function resolveBrowserPath() {
  const explicitPath = process.env.TIME_TRACKER_BROWSER_PATH;
  if (explicitPath) {
    return explicitPath;
  }

  const windowsCandidates = [
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];

  for (const candidate of windowsCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  for (const candidate of ["msedge", "chrome", "google-chrome", "chromium", "chromium-browser"]) {
    const located = commandPath(candidate);
    if (located) {
      return located;
    }
  }

  throw new Error("No Edge, Chrome, or Chromium executable found for UI browser smoke");
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  label: string,
  producer: () => Promise<T | null> | T | null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await producer();
    if (value) {
      return value;
    }
    await delay(100);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

function readDevToolsPort(userDataDir: string) {
  const filePath = join(userDataDir, "DevToolsActivePort");
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const [port] = readFileSync(filePath, "utf8").split(/\r?\n/);
    const parsedPort = Number(port);
    return Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : null;
  } catch (error) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";

    if (errorCode === "EBUSY" || errorCode === "EPERM" || errorCode === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function launchBrowser() {
  const browserPath = resolveBrowserPath();
  const userDataDir = mkdtempSync(join(tmpdir(), "time-tracker-browser-smoke-"));
  const browser = spawn(browserPath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], {
    stdio: "ignore",
  });

  const port = await waitFor("browser devtools port", () => readDevToolsPort(userDataDir));

  return {
    browser,
    port,
    userDataDir,
  };
}

async function stopBrowser(browser: ChildProcess) {
  if (browser.exitCode === null && !browser.killed) {
    browser.kill();
  }

  await Promise.race([
    new Promise((resolve) => browser.once("exit", resolve)),
    delay(1_000),
  ]);
}

type PendingCommand = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

class CdpConnection {
  private nextId = 1;
  private pending = new Map<number, PendingCommand>();
  private listeners = new Set<(message: Record<string, unknown>) => void>();
  private ready: Promise<void>;
  private readonly ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ready = new Promise((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("CDP WebSocket failed to open")), {
        once: true,
      });
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      const id = typeof message.id === "number" ? message.id : null;

      if (id !== null && this.pending.has(id)) {
        const pending = this.pending.get(id)!;
        this.pending.delete(id);

        if (message.error) {
          pending.reject(new Error(JSON.stringify(message.error)));
        } else {
          pending.resolve((message.result ?? {}) as Record<string, unknown>);
        }
        return;
      }

      for (const listener of this.listeners) {
        listener(message);
      }
    });
  }

  static async connect(url: string) {
    const client = new CdpConnection(new WebSocket(url));
    await client.ready;
    return client;
  }

  onMessage(listener: (message: Record<string, unknown>) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async command(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;

    const payload: Record<string, unknown> = {
      id,
      method,
      params,
    };
    if (sessionId) {
      payload.sessionId = sessionId;
    }

    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(JSON.stringify(payload));
    return result;
  }

  close() {
    this.ws.close();
  }
}

async function getBrowserWebSocketUrl(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  const version = await response.json() as { webSocketDebuggerUrl?: string };
  assert.ok(version.webSocketDebuggerUrl, "missing browser CDP WebSocket URL");
  return version.webSocketDebuggerUrl;
}

async function evaluate(
  client: CdpConnection,
  sessionId: string,
  expression: string,
) {
  const result = await client.command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);

  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }

  const remoteObject = result.result as { value?: unknown } | undefined;
  return remoteObject?.value;
}

async function waitForExpression(
  client: CdpConnection,
  sessionId: string,
  expression: string,
) {
  return waitFor("browser expression", async () => {
    const value = await evaluate(client, sessionId, expression);
    return value ? value : null;
  });
}

function jsonString(value: string) {
  return JSON.stringify(value);
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

  await runTest("Vite page renders dashboard in a real browser", async () => {
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(DASHBOARD_MARKERS[0])})`,
    );

    for (const marker of DASHBOARD_MARKERS) {
      assert.equal(
        await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(marker)})`),
        true,
      );
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

  await runTest("warm primary navigation avoids app loading after startup warmup", async () => {
    await delay(4_000);

    for (const label of EXPECTED_NAV_LABELS.slice(1)) {
      const clicked = await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `);
      assert.equal(clicked, true, `missing navigation entry ${label}`);
      await delay(50);
      assert.equal(
        await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`),
        false,
        `unexpected app loading view after clicking ${label}`,
      );
    }
  });

  await runTest("settings theme dialog opens and closes in a real browser", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("设置"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString(SETTINGS_MARKER)})`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".settings-theme-entry");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.settings-color-scheme-list'))");
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const cancel = Array.from(document.querySelectorAll(".qp-dialog-action"))[0];
          if (!cancel) return false;
          cancel.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "!document.querySelector('.settings-color-scheme-list')");
  });

  await runTest("dashboard viewport has no horizontal overflow", async () => {
    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true);
    await waitForExpression(client!, sessionId, `
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    `);
  });

  await runTest("history title details stay readable at narrow and default widths", async () => {
    for (const width of [900, 1100]) {
      await client!.command("Emulation.setDeviceMetricsOverride", {
        width,
        height: 760,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
      const clicked = await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `);
      assert.equal(clicked, true);
      await waitForExpression(
        client!,
        sessionId,
        `document.body.innerText.includes(${jsonString("标题 " + HISTORY_TITLE_DETAIL_COUNT)})`,
      );
      assert.equal(
        await evaluate(client!, sessionId, `
          document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
        `),
        true,
        `History viewport overflowed at ${width}px`,
      );
    }

    const opened = await evaluate(client!, sessionId, `
      (() => {
        const trigger = Array.from(document.querySelectorAll('button[aria-label]'))
          .find((node) => node.getAttribute('aria-label')?.includes('标题详情'));
        if (!trigger) return false;
        trigger.click();
        return true;
      })()
    `);
    assert.equal(opened, true);
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.history-activity-popover'))");
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const list = document.querySelector('.history-activity-popover-list');
          const popover = document.querySelector('.history-activity-popover');
          return Boolean(
            list
            && popover
            && list.children.length === ${HISTORY_TITLE_DETAIL_COUNT}
            && popover.scrollHeight > popover.clientHeight
          );
        })()
      `),
      true,
    );
  });

  await runTest("English history title chips do not crowd the duration column", async () => {
    await client!.command("Page.addScriptToEvaluateOnNewDocument", {
      source: "globalThis.__TIME_TRACKER_SMOKE_LANGUAGE = 'en-US';",
    }, sessionId);
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString("Focus share")})`,
    );

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
      `document.body.innerText.includes(${jsonString("Titles " + HISTORY_TITLE_DETAIL_COUNT)})`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      `),
      true,
    );
  });

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
