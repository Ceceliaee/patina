import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Plugin } from "vite";
import { COPY } from "../src/shared/copy/uiText.ts";

const EXPECTED_NAV_LABELS = ["今天", "历史", "数据", "分类", "工具", "设置", "关于"] as const;
const DASHBOARD_MARKERS = ["专注分布", "应用排行"] as const;
const TOOLS_TEXT = COPY["zh-CN"].tools;
const SETTINGS_MARKER = "主题模式";
const APP_LOADING_VIEW = COPY["zh-CN"].app.loadingView;
const HISTORY_LOADING_VIEW = COPY["zh-CN"].history.loading;
const HISTORY_TITLE_DETAIL_COUNT = 10;
const LONG_BACKGROUND_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
const FIRST_RENDER_TIMEOUT_MS = process.env.CI ? 45_000 : DEFAULT_TIMEOUT_MS;

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
      const foregroundListeners = new Set();
      const resizeListeners = new Set();
      let foregroundState = { visible: true, focused: false };
      globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE = (nextState) => {
        foregroundState = { ...foregroundState, ...nextState };
        for (const listener of foregroundListeners) listener();
        for (const listener of resizeListeners) listener();
      };
      const currentWindow = {
        label: "main",
        minimize: noop,
        toggleMaximize: noop,
        close: noop,
        startDragging: noop,
        setFocusable: noop,
        isMaximized: async () => false,
        isVisible: async () => foregroundState.visible,
        isFocused: async () => foregroundState.focused,
        outerPosition: async () => ({ x: 0, y: 0 }),
        outerSize: async () => ({ width: 1280, height: 800 }),
        onMoved: async () => () => {},
        onFocusChanged: async (listener) => {
          foregroundListeners.add(listener);
          return () => foregroundListeners.delete(listener);
        },
        onResized: async (listener) => {
          resizeListeners.add(listener);
          return () => resizeListeners.delete(listener);
        },
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
      const SETTINGS_STORAGE_KEY = "__time_tracker_smoke_settings";

      function loadStoredSettings() {
        try {
          return {
            "__app_override::cursor.exe": JSON.stringify({ category: "development", enabled: true }),
            "__app_override::deep-research-workbench.exe": JSON.stringify({ category: "office", enabled: true }),
            "web_activity_enabled": "1",
            "web_activity_token": "smoke-token",
            ...JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}"),
          };
        } catch {
          return {};
        }
      }

      export async function invoke(command, payload = {}) {
        if (command === "cmd_get_web_activity_bridge_snapshot") {
          return globalThis.__TIME_TRACKER_WEB_ACTIVITY_BRIDGE_SNAPSHOT ?? {
            enabled: true,
            connected: false,
            browserClientId: null,
            browserKind: null,
            extensionVersion: null,
            lastActivityAtMs: null,
          };
        }
        if (command === "cmd_commit_app_settings") {
          const settings = loadStoredSettings();
          for (const mutation of payload.mutations ?? []) {
            settings[mutation.key] = mutation.value;
          }
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        }
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
      const SETTINGS_STORAGE_KEY = "__time_tracker_smoke_settings";

      function loadStoredSettings() {
        try {
          return {
            "__app_override::cursor.exe": JSON.stringify({ category: "development", enabled: true }),
            "__app_override::deep-research-workbench.exe": JSON.stringify({ category: "office", enabled: true }),
            "web_activity_enabled": "1",
            "web_activity_token": "smoke-token",
            ...JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}"),
          };
        } catch {
          return {};
        }
      }

      function smokeSessionTiming() {
        const now = new Date();
        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
        const latestEnd = Math.max(dayStart + 70 * 1000, now.getTime() - 60 * 1000);
        const duration = Math.min(
          40 * 60 * 1000,
          Math.max(60 * 1000, latestEnd - dayStart - 1000),
        );

        return {
          start: Math.max(dayStart, latestEnd - duration),
          end: latestEnd,
          duration,
        };
      }

      function historySessionRows() {
        const timing = smokeSessionTiming();
        const earlierEnd = timing.start;
        const earlierStart = Math.max(
          new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 0, 0, 0, 0).getTime(),
          earlierEnd - 10 * 60 * 1000,
        );
        return [
          {
            id: 901,
            app_name: "Extremely Long Research Workbench Application Name",
            exe_name: "deep-research-workbench.exe",
            window_title: "Extremely detailed project brief",
            start_time: timing.start,
            end_time: timing.end,
            duration: timing.duration,
            continuity_group_start_time: timing.start,
          },
          {
            id: 902,
            app_name: "Cursor",
            exe_name: "cursor.exe",
            window_title: "Implement chart mode",
            start_time: earlierStart,
            end_time: earlierEnd,
            duration: Math.max(0, earlierEnd - earlierStart),
            continuity_group_start_time: earlierStart,
          },
        ];
      }

      function historyTitleSampleRows() {
        const timing = smokeSessionTiming();
        const sampleDuration = Math.max(1, Math.floor(timing.duration / ${HISTORY_TITLE_DETAIL_COUNT}));
        return Array.from({ length: ${HISTORY_TITLE_DETAIL_COUNT} }, (_, index) => {
          const sampleStart = timing.start + index * sampleDuration;
          return {
            session_id: 901,
            title: "Detailed document title " + (index + 1) + " for a very long research workflow",
            start_time: sampleStart,
            end_time: index === ${HISTORY_TITLE_DETAIL_COUNT} - 1
              ? timing.end
              : Math.min(timing.end, sampleStart + sampleDuration),
          };
        });
      }

      export default class Database {
        static get() {
          return new Database();
        }

        static async load() {
          return new Database();
        }

        async select(query) {
          const normalizedQuery = String(query ?? "").toLowerCase();
          if (normalizedQuery.includes("from settings")) {
            const settings = loadStoredSettings();
            const language = globalThis.__TIME_TRACKER_SMOKE_LANGUAGE;
            if (language) settings.language = language;
            return Object.entries(settings).map(([key, value]) => ({ key, value: String(value) }));
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
  timeoutMs = DEFAULT_TIMEOUT_MS,
  label = "browser expression",
) {
  return waitFor(label, async () => {
    const value = await evaluate(client, sessionId, expression);
    return value ? value : null;
  }, timeoutMs);
}

function jsonString(value: string) {
  return JSON.stringify(value);
}

function titleDetailsButtonExpression(labelFragment: string, scopeSelector?: string) {
  const scope = scopeSelector ? `document.querySelector(${jsonString(scopeSelector)})` : "document";
  return `
    Boolean(Array.from((${scope})?.querySelectorAll('button[aria-label]') ?? [])
      .find((node) => node.getAttribute('aria-label')?.includes(${jsonString(labelFragment)})))
  `;
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

  await runTest("About page keeps its centered support layout", async () => {
    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("关于"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true, "missing About navigation entry");

    await waitForExpression(
      client!,
      sessionId,
      "Boolean(document.querySelector('.about-center-panel .about-center-profile'))",
    );

    const layout = await evaluate(client!, sessionId, `
      (() => {
        const panel = document.querySelector('.about-center-panel');
        const profile = document.querySelector('.about-center-profile');
        const actions = Array.from(document.querySelectorAll('.about-pill-action'));
        const update = document.querySelector('.about-center-update.update-status-compact');
        if (!panel || !profile || actions.length !== 4 || !update) return null;

        const firstActionRect = actions[0].getBoundingClientRect();
        const actionRects = actions.map((action) => action.getBoundingClientRect());
        return {
          panelDisplay: getComputedStyle(panel).display,
          profileJustifyItems: getComputedStyle(profile).justifyItems,
          actionDisplay: getComputedStyle(actions[0]).display,
          actionMinHeight: parseFloat(getComputedStyle(actions[0]).minHeight),
          actionsStayInOneRow: actionRects.every((rect) => Math.abs(rect.top - firstActionRect.top) < 2),
          updatePaddingTop: parseFloat(getComputedStyle(update).paddingTop),
        };
      })()
    `) as {
      panelDisplay: string;
      profileJustifyItems: string;
      actionDisplay: string;
      actionMinHeight: number;
      actionsStayInOneRow: boolean;
      updatePaddingTop: number;
    } | null;

    assert.ok(layout, "About layout hooks should be present");
    assert.equal(layout.panelDisplay, "grid");
    assert.equal(layout.profileJustifyItems, "center");
    assert.equal(["flex", "inline-flex"].includes(layout.actionDisplay), true);
    assert.equal(layout.actionMinHeight >= 32, true);
    assert.equal(layout.actionsStayInOneRow, true);
    assert.equal(layout.updatePaddingTop > 0, true);
  });

  await runTest("About sponsor dialog shows WeChat and Ko-fi support", async () => {
    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("关于"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true, "missing About navigation entry");

    const sponsorOpened = await evaluate(client!, sessionId, `
      (() => {
        const sponsor = Array.from(document.querySelectorAll('button'))
          .find((node) => node.textContent?.trim() === ${jsonString("赞助项目")});
        if (!sponsor) return false;
        sponsor.click();
        return true;
      })()
    `);
    assert.equal(sponsorOpened, true, "missing sponsor button");

    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[role="dialog"]')?.textContent?.includes(${jsonString("微信赞赏码")})`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `
        (() => {
          const dialog = document.querySelector('[role="dialog"]');
          const rewardImages = Array.from(dialog?.querySelectorAll('.about-wechat-reward-frame img') ?? []);
          const rewardImage = rewardImages.find((image) => getComputedStyle(image).display !== 'none');
          const kofiImage = dialog?.querySelector('.about-kofi-button img');
          return Boolean(
            rewardImage && rewardImage.naturalWidth > 0 && rewardImage.naturalHeight > 0
              && kofiImage && kofiImage.naturalWidth > 0 && kofiImage.naturalHeight > 0
          );
        })()
      `,
    );

    const supportDialog = await evaluate(client!, sessionId, `
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        const rewardImages = Array.from(dialog?.querySelectorAll('.about-wechat-reward-frame img') ?? []);
        const rewardImage = rewardImages.find((image) => getComputedStyle(image).display !== 'none');
        const kofi = dialog?.querySelector('button.about-kofi-button[aria-label=' + ${jsonString(JSON.stringify("打开 Ko-fi"))} + ']');
        const kofiImage = kofi?.querySelector('img');
        const cards = Array.from(dialog?.querySelectorAll('.about-support-card') ?? []);
        const cardRects = cards.map((card) => card.getBoundingClientRect());
        const close = dialog?.querySelector('button.about-support-dialog-close[aria-label=' + ${jsonString(JSON.stringify("关闭"))} + ']');
        const activeTheme = document.documentElement.dataset.theme ?? null;
        return {
          hasDialog: Boolean(dialog),
          imageLoaded: Boolean(rewardImage && rewardImage.naturalWidth > 0 && rewardImage.naturalHeight > 0),
          rewardTheme: rewardImage?.getAttribute('data-reward-theme') ?? null,
          activeTheme,
          hasKofiButton: Boolean(kofi),
          kofiImageLoaded: Boolean(kofiImage && kofiImage.naturalWidth > 0 && kofiImage.naturalHeight > 0),
          cardsAreStacked:
            cardRects.length === 2 && cardRects[1].top > cardRects[0].bottom,
          hasTopClose: Boolean(close),
        };
      })()
    `) as {
      hasDialog: boolean;
      imageLoaded: boolean;
      rewardTheme: string | null;
      activeTheme: string | null;
      hasKofiButton: boolean;
      kofiImageLoaded: boolean;
      cardsAreStacked: boolean;
      hasTopClose: boolean;
    };

    assert.equal(supportDialog.hasDialog, true);
    assert.equal(supportDialog.imageLoaded, true);
    assert.equal(supportDialog.rewardTheme, supportDialog.activeTheme);
    assert.equal(supportDialog.hasKofiButton, true);
    assert.equal(supportDialog.kofiImageLoaded, true);
    assert.equal(supportDialog.cardsAreStacked, true);
    assert.equal(supportDialog.hasTopClose, true);

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dialog = document.querySelector('[role="dialog"]');
          const kofi = dialog?.querySelector('button.about-kofi-button[aria-label=' + ${jsonString(JSON.stringify("打开 Ko-fi"))} + ']');
          if (!kofi) return false;
          kofi.click();
          return true;
        })()
      `),
      true,
      "Ko-fi support action should be clickable",
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const close = document.querySelector('[role="dialog"] button.about-support-dialog-close[aria-label=' + ${jsonString(JSON.stringify("关闭"))} + ']');
          if (!close) return false;
          close.click();
          return true;
        })()
      `),
      true,
      "Sponsor dialog should expose a close action",
    );
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
  });

  await runTest("About page keeps one centered update layout on wide desktop", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1800,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);

    try {
      const clicked = await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("关于"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `);
      assert.equal(clicked, true, "missing About navigation entry");
      await waitForExpression(
        client!,
        sessionId,
        "Boolean(document.querySelector('.about-center-panel .about-center-update'))",
      );

      const wideLayout = await evaluate(client!, sessionId, `
        (async () => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const panel = document.querySelector('.about-center-panel');
          const profile = document.querySelector('.about-center-profile');
          const actions = document.querySelector('.about-pill-row');
          const update = document.querySelector('.about-center-update.update-status-compact');
          if (!panel || !profile || !actions || !update) return null;

          const profileRect = profile.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          const updateRect = update.getBoundingClientRect();
          return {
            panelColumns: getComputedStyle(panel).gridTemplateColumns,
            updateIsBelowActions: updateRect.top > actionsRect.bottom,
            updateIsCenteredWithActions:
              Math.abs((updateRect.left + updateRect.width / 2) - (actionsRect.left + actionsRect.width / 2)) < 2,
            updateStaysWiderThanActions: updateRect.width > actionsRect.width,
            actionsStayBelowProfile: actionsRect.top > profileRect.bottom,
          };
        })()
      `) as {
        panelColumns: string;
        updateIsBelowActions: boolean;
        updateIsCenteredWithActions: boolean;
        updateStaysWiderThanActions: boolean;
        actionsStayBelowProfile: boolean;
      } | null;

      assert.ok(wideLayout, "About wide layout hooks should be present");
      assert.equal(wideLayout.panelColumns.trim().split(/\s+/).length, 1);
      assert.equal(wideLayout.updateIsBelowActions, true);
      assert.equal(wideLayout.updateIsCenteredWithActions, true);
      assert.equal(wideLayout.updateStaysWiderThanActions, true);
      assert.equal(wideLayout.actionsStayBelowProfile, true);
    } finally {
      await client!.command("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 820,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
    }
  });

  await runTest("Tools page renders its tool sections", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.subtitle)})`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.reminderEmpty)})`,
    );

    for (const marker of [
      TOOLS_TEXT.remindersTitle,
      TOOLS_TEXT.timerTitle,
      TOOLS_TEXT.pomodoroTitle,
    ] as const) {
      assert.equal(
        await evaluate(client!, sessionId, `
          Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(marker))} + ']'))
        `),
        true,
        `missing Tools section ${marker}`,
      );
    }

    assert.equal(
      await evaluate(client!, sessionId, "document.querySelectorAll('.tools-section-tab-copy').length"),
      0,
      "Tools section rail should stay icon-only",
    );
    assert.equal(
      await evaluate(client!, sessionId, "Boolean(document.querySelector('.tools-section-label-toggle'))"),
      false,
      "Tools section rail should not expose a label toggle",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const workspace = document.querySelector('.tools-workspace');
          if (!workspace) return false;
          const railWidth = parseFloat(getComputedStyle(workspace).gridTemplateColumns.split(' ')[0] ?? "0");
          return railWidth > 0 && railWidth <= 80;
        })()
      `),
      true,
    );

    for (const marker of [
      TOOLS_TEXT.remindersTitle,
      TOOLS_TEXT.reminderModeEvent,
      TOOLS_TEXT.reminderModeSoftware,
    ] as const) {
      assert.equal(
        await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(marker)})`),
        true,
        `missing visible Tools panel marker ${marker}`,
      );
    }

    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('.tools-reminder-form input[type="number"][max="1440"]');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return input.value === '';
        })()
      `),
      true,
      "relative reminder minutes should be clearable while editing",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('.tools-reminder-form input[type="number"][max="1440"]');
          const create = document.querySelector('.tools-reminder-form .tools-action-button');
          if (!input || !create) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '0');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return Boolean(create.disabled)
            && !document.body.innerText.includes(${jsonString(TOOLS_TEXT.reminderTimeInvalid)});
        })()
      `),
      true,
      "relative reminder should disable create for zero minutes",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const absolute = Array.from(document.querySelectorAll('button'))
            .find((node) => node.textContent?.trim() === ${jsonString(TOOLS_TEXT.reminderModeAbsolute)});
          if (!absolute) return false;
          absolute.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const create = document.querySelector('.tools-reminder-form .tools-action-button');
          return Boolean(create?.disabled)
            && !document.body.innerText.includes(${jsonString(TOOLS_TEXT.reminderTimeInvalid)});
        })()
      `),
      true,
      "absolute reminder should disable create for the current minute",
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const software = Array.from(document.querySelectorAll('button'))
            .find((node) => node.textContent?.trim() === ${jsonString(TOOLS_TEXT.reminderModeSoftware)});
          if (!software) return false;
          software.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.softwareReminderEmpty)})`,
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const timer = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.timerTitle))} + ']');
          if (!timer) return false;
          timer.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.timerModeStopwatch)})`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const countdown = Array.from(document.querySelectorAll('button'))
            .find((node) => node.textContent?.trim() === ${jsonString(TOOLS_TEXT.timerModeCountdown)});
          if (!countdown) return false;
          countdown.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const input = document.querySelector('#tools-countdown-duration');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return input.value === '';
        })()
      `),
      true,
      "countdown duration should be clearable while editing",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('#tools-countdown-duration');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '0');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const start = document.querySelector('[data-tools-section="timer"] .tools-action-row .qp-button-primary');
          return Boolean(start?.disabled);
        })()
      `),
      true,
      "countdown duration should reject zero minutes",
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const pomodoro = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.pomodoroTitle))} + ']');
          if (!pomodoro) return false;
          pomodoro.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(TOOLS_TEXT.pomodoroTitle)})`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('#tools-pomodoro-focus');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return input.value === '';
        })()
      `),
      true,
      "pomodoro duration should be clearable while editing",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector('#tools-pomodoro-focus');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '0');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const start = document.querySelector('[data-tools-section="pomodoro"] .tools-action-row .qp-button-primary');
          return Boolean(start?.disabled);
        })()
      `),
      true,
      "pomodoro duration should reject zero minutes",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const fields = [
            ['#tools-pomodoro-focus', '25'],
            ['#tools-pomodoro-short-break', '5'],
            ['#tools-pomodoro-long-break', '15'],
            ['#tools-pomodoro-long-break-every', '4'],
          ];
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          for (const [selector, value] of fields) {
            const input = document.querySelector(selector);
            if (!input) return false;
            setter?.call(input, value === '25' ? '0' : '');
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const restore = document.querySelector(
            '[aria-label=' + ${jsonString(JSON.stringify(COPY["zh-CN"].accessibility.tools.restorePomodoroDefaults))} + ']'
          );
          if (!restore || restore.textContent?.trim() || restore.hasAttribute('title')) return false;
          const titleGroup = restore.closest('.tools-subpanel-title-action');
          const title = titleGroup?.querySelector('h3');
          if (!title || title.textContent?.trim() !== ${jsonString(TOOLS_TEXT.pomodoroSettings)}) return false;
          const titleRect = title.getBoundingClientRect();
          const restoreRect = restore.getBoundingClientRect();
          if (restoreRect.left < titleRect.right || restoreRect.left - titleRect.right > 12) return false;
          restore.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const start = document.querySelector('[data-tools-section="pomodoro"] .tools-action-row .qp-button-primary');
          return fields.every(([selector, value]) => document.querySelector(selector)?.value === value)
            && !start?.disabled;
        })()
      `),
      true,
      "pomodoro default icon restores editable durations",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dashboard = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!dashboard) return false;
          dashboard.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const tools = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("工具"))} + ']');
          if (!tools) return false;
          tools.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `
        document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(TOOLS_TEXT.pomodoroTitle))} + ']')
          ?.getAttribute('aria-pressed') === 'true'
      `,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        document.querySelector('[data-tools-section="pomodoro"]')?.className.includes('tools-section-pane-hidden') === false
      `),
      true,
      "Tools section rail should restore the last selected section",
    );
    assert.equal(
      await evaluate(client!, sessionId, "document.querySelectorAll('.tools-section-tab-copy').length"),
      0,
      "Tools section rail should stay icon-only after switching sections",
    );
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

  await runTest("Data navigation is immediate and avoids visible loading affordances", async () => {
    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true);
    await delay(50);
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
      ),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(HISTORY_LOADING_VIEW)})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector(".data-heatmap-skeleton"))`),
      false,
    );
  });

  await runTest("History navigation is immediate and avoids visible loading copy", async () => {
    const clicked = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(clicked, true);
    await delay(50);
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
      ),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(HISTORY_LOADING_VIEW)})`),
      false,
    );
  });

  await runTest("short background return keeps Data active", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: false, focused: false });`);
    await delay(80);
    await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: true, focused: false });`);
    await delay(80);
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
      ),
      true,
    );
  });

  await runTest("long background return from browsing views opens Dashboard", async () => {
    const simulateLongBackgroundReturn = async (label: string) => {
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']');
            if (!node) return false;
            node.click();
            return true;
          })()
        `),
        true,
        `missing navigation entry ${label}`,
      );
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify(label))} + ']')?.className.includes("qp-nav-item-active")`,
      );
      await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: false, focused: false });`);
      await delay(80);
      await evaluate(client!, sessionId, `
        (() => {
          const originalNow = Date.now;
          Date.now = () => originalNow() + ${LONG_BACKGROUND_DELAY_MS + 1};
          globalThis.__TIME_TRACKER_RESTORE_NOW = () => {
            Date.now = originalNow;
            delete globalThis.__TIME_TRACKER_RESTORE_NOW;
          };
          globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE?.({ visible: true, focused: false });
        })()
      `);
      await waitForExpression(
        client!,
        sessionId,
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']')?.className.includes("qp-nav-item-active")`,
      );
      assert.equal(
        await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString(APP_LOADING_VIEW)})`),
        false,
      );
      await evaluate(client!, sessionId, `globalThis.__TIME_TRACKER_RESTORE_NOW?.();`);
    };

    await simulateLongBackgroundReturn("数据");
    await simulateLongBackgroundReturn("历史");
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

  await runTest("settings web sync guide appears only while setup is incomplete", async () => {
    await evaluate(client!, sessionId, `
      (() => {
        localStorage.setItem("__time_tracker_smoke_settings", JSON.stringify({
          "web_activity_enabled": "0",
          "web_activity_port": "12345",
          "web_activity_token": "smoke-token"
        }));
        window.location.reload();
        return true;
      })()
    `);
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("设置"))} + ']'))`);
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
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("使用说明")})`),
      false,
    );

    await evaluate(client!, sessionId, `
      globalThis.__TIME_TRACKER_WEB_ACTIVITY_BRIDGE_SNAPSHOT = {
        enabled: true,
        connected: false,
        browserClientId: null,
        browserKind: null,
        extensionVersion: null,
        lastActivityAtMs: null
      };
    `);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("切换网页同步"))} + ']');
          if (!toggle) return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("使用说明")})`);
    const webSyncHeightWithGuide = await evaluate(client!, sessionId, `
      document.querySelector(".settings-web-activity-subpanel")?.getBoundingClientRect().height ?? 0
    `) as number;
    assert.ok(webSyncHeightWithGuide > 0, "missing web sync settings subpanel height");
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "使用说明");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("网页同步使用说明")})`);
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("Patina 收到当前配置的网页活动后，使用说明入口会自动隐藏。")})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('a[href="https://github.com/Ceceliaee/patina/releases/latest"]'))`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("默认端口是 12345")})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("安装并运行 Patina 桌面端")})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("在 Patina 设置中开启网页同步")})`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("复制端口")})`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("复制 Token")})`),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('a[href="chrome://extensions/"]'))`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `Boolean(document.querySelector('a[href="edge://extensions/"]'))`),
      false,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const close = document.querySelector('[role="dialog"] button');
          if (!close) return false;
          close.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");

    await evaluate(client!, sessionId, `
      globalThis.__TIME_TRACKER_WEB_ACTIVITY_BRIDGE_SNAPSHOT = {
        enabled: true,
        connected: true,
        browserClientId: "smoke-client",
        browserKind: "chrome",
        extensionVersion: "0.0.0",
        lastActivityAtMs: Date.now()
      };
    `);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const save = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "保存" && !node.disabled);
          if (!save) return false;
          save.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `!document.body.innerText.includes(${jsonString("使用说明")})`);
    const webSyncHeightWithoutGuide = await evaluate(client!, sessionId, `
      document.querySelector(".settings-web-activity-subpanel")?.getBoundingClientRect().height ?? 0
    `) as number;
    assert.ok(
      Math.abs(webSyncHeightWithGuide - webSyncHeightWithoutGuide) <= 1,
      `Web sync settings subpanel shifted from ${webSyncHeightWithGuide}px to ${webSyncHeightWithoutGuide}px`,
    );

    assert.equal(
      await evaluate(client!, sessionId, `
        (async () => {
          const input = document.querySelector("#settings-web-activity-address");
          if (!(input instanceof HTMLInputElement)) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          input.focus();
          setter?.call(input, "12346");
          input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "12346", inputType: "insertText" }));
          await new Promise((resolve) => setTimeout(resolve, 50));
          input.blur();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("使用说明")})`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "使用说明");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("网页同步使用说明")})`);

    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, sessionId);
    await delay(100);
    assert.equal(
      await evaluate(client!, sessionId, "document.documentElement.scrollWidth <= window.innerWidth + 1"),
      true,
      "Settings web sync guide dialog overflowed at 390px",
    );

    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    `);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
    await evaluate(client!, sessionId, `
      (() => {
        const cancel = Array.from(document.querySelectorAll("button"))
          .find((node) => node.textContent?.trim() === "取消" && !node.disabled);
        cancel?.click();
      })()
    `);
    await waitForExpression(client!, sessionId, `!document.body.innerText.includes(${jsonString("有未保存更改")})`);
  });

  await runTest("settings remote backup panel opens WebDAV config dialog without narrow overflow", async () => {
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
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("远程备份")})`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = Array.from(document.querySelectorAll("button"))
            .find((node) => node.textContent?.trim() === "配置");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.body.innerText.includes(${jsonString("WebDAV 配置")})`);
    assert.equal(
      await evaluate(client!, sessionId, `document.body.innerText.includes(${jsonString("服务器地址")})`),
      true,
    );

    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, sessionId);
    await delay(100);
    assert.equal(
      await evaluate(client!, sessionId, "document.documentElement.scrollWidth <= window.innerWidth + 1"),
      true,
      "Settings remote backup dialog overflowed at 390px",
    );

    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    `);
    await waitForExpression(client!, sessionId, "!document.querySelector('[role=\"dialog\"]')");
  });

  await runTest("app mapping only offers explicit manual categories", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("分类"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".qp-select-trigger"))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        !document.body.innerText.includes("自动识别")
          && !document.body.innerText.includes("恢复默认识别")
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".qp-select-trigger");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".qp-select-menu"))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const labels = Array.from(document.querySelectorAll(".qp-select-option"))
            .map((node) => node.textContent?.trim());
          return labels.at(-1) === "未分类" && !labels.includes("自动识别");
        })()
      `),
      true,
    );
    await evaluate(client!, sessionId, `
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    `);
    await waitForExpression(client!, sessionId, `!document.querySelector(".qp-select-menu")`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
  });

  await runTest("dashboard viewport has no horizontal overflow", async () => {
    for (const width of [900, 1100, 1280]) {
      await client!.command("Emulation.setDeviceMetricsOverride", {
        width,
        height: 820,
        deviceScaleFactor: 1,
        mobile: false,
      }, sessionId);
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
    }
  });

  await runTest("dashboard hourly chart toggles category layers", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const card = document.querySelector(".dashboard-pulse-card");
          const icon = document.querySelector(".dashboard-pulse-mode-toggle svg");
          if (!card || !icon) return false;
          const cardRect = card.getBoundingClientRect();
          const iconRect = icon.getBoundingClientRect();
          const contentRight = cardRect.right - parseFloat(getComputedStyle(card).paddingRight);
          return Math.abs(contentRight - iconRect.right) <= 1;
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".dashboard-pulse-mode-toggle");
          if (!toggle || toggle.getAttribute("aria-pressed") !== "false") return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-label")`,
      ),
      "显示总活动",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-chart [data-hourly-activity-chart-mode]")
        ?.getAttribute("data-hourly-activity-chart-mode") === "category"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".dashboard-pulse-chart [data-hourly-activity-chart-mode]")
          ?.getAttribute("data-hourly-activity-chart-mode")`,
      ),
      "category",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".dashboard-pulse-mode-toggle");
          if (!toggle) return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "false"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-label")`,
      ),
      "按分类显示",
    );
  });

  await runTest("dashboard hourly chart supports keyboard toggle and keeps category mode across views", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".dashboard-pulse-mode-toggle");
          if (!toggle) return false;
          toggle.focus();
          return document.activeElement === toggle;
        })()
      `),
      true,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: " ",
      code: "Space",
      text: " ",
      unmodifiedText: " ",
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: " ",
      code: "Space",
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "false"`,
    );
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await client!.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("今天"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
  });

  await runTest("history hourly chart toggles category layers", async () => {
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".history-pulse-mode-toggle"))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".history-horizontal-timeline"))`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelectorAll(".history-horizontal-timeline-segment").length >= 1`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-app-distribution-card")?.textContent?.includes("当日分布")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const card = document.querySelector(".history-app-distribution-card");
          if (!card) return false;
          const buttons = Array.from(card.querySelectorAll(".history-day-distribution-mode-switch button"));
          const appButton = buttons.find((button) => button.textContent?.trim() === "应用");
          const categoryButton = buttons.find((button) => button.textContent?.trim() === "分类");
          return Boolean(
            appButton
            && categoryButton
            && appButton.getAttribute("aria-pressed") === "true"
            && categoryButton.getAttribute("aria-pressed") === "false"
            && card.textContent?.includes("Extremely Long Research Workbench Application Name")
          );
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const categoryButton = Array.from(document.querySelectorAll(".history-app-distribution-card .history-day-distribution-mode-switch button"))
            .find((button) => button.textContent?.trim() === "分类");
          if (!categoryButton) return false;
          categoryButton.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Array.from(document.querySelectorAll(".history-app-distribution-card .history-day-distribution-mode-switch button"))
        .some((button) => button.textContent?.trim() === "分类" && button.getAttribute("aria-pressed") === "true")`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const card = document.querySelector(".history-app-distribution-card");
          return Boolean(card?.textContent?.includes("办公") && card.textContent?.includes("开发"));
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const appButton = Array.from(document.querySelectorAll(".history-app-distribution-card .history-day-distribution-mode-switch button"))
            .find((button) => button.textContent?.trim() === "应用");
          if (!appButton) return false;
          appButton.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Array.from(document.querySelectorAll(".history-app-distribution-card .history-day-distribution-mode-switch button"))
        .some((button) => button.textContent?.trim() === "应用" && button.getAttribute("aria-pressed") === "true")`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".history-horizontal-timeline")?.getAttribute("data-history-timeline-mode")`,
      ),
      "app",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const card = document.querySelector(".history-pulse-card");
          const icon = document.querySelector(".history-pulse-mode-toggle svg");
          if (!card || !icon) return false;
          const cardRect = card.getBoundingClientRect();
          const iconRect = icon.getBoundingClientRect();
          const contentRight = cardRect.right - parseFloat(getComputedStyle(card).paddingRight);
          return Math.abs(contentRight - iconRect.right) <= 1;
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".history-pulse-mode-toggle");
          if (!toggle || toggle.getAttribute("aria-pressed") !== "true") return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-pulse-mode-toggle")?.getAttribute("aria-pressed") === "false"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".history-horizontal-timeline")?.getAttribute("data-history-timeline-mode")`,
      ),
      "app",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".history-pulse-mode-toggle")?.getAttribute("aria-label")`,
      ),
      "按分类显示",
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const segment = document.querySelector(".history-horizontal-timeline-segment");
          if (!segment) return false;
          segment.focus();
          return document.activeElement === segment;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.history-horizontal-timeline-tooltip'))");
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const tooltip = document.querySelector(".history-horizontal-timeline-tooltip");
          return Boolean(tooltip?.textContent?.includes(" - "));
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const segment = document.querySelector(".history-horizontal-timeline-segment");
          if (!segment) return false;
          segment.click();
          return !document.querySelector(".history-activity-popover");
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const toggle = document.querySelector(".history-pulse-mode-toggle");
          if (!toggle) return false;
          toggle.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".history-pulse-mode-toggle")?.getAttribute("aria-label")`,
      ),
      "显示总活动",
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".history-horizontal-timeline")?.getAttribute("data-history-timeline-mode")`,
      ),
      "app",
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".history-pulse-chart [data-hourly-activity-chart-mode]")
        ?.getAttribute("data-hourly-activity-chart-mode") === "category"`,
    );
    assert.equal(
      await evaluate(
        client!,
        sessionId,
        `document.querySelector(".history-pulse-chart [data-hourly-activity-chart-mode]")
          ?.getAttribute("data-hourly-activity-chart-mode")`,
      ),
      "category",
    );
  });

  await runTest("history timeline opens list dialog from timeline axis", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 2048,
      height: 1152,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector(".history-timeline-open"))`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          window.dispatchEvent(new Event("resize"));
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(
      client!,
      sessionId,
      `(
        document.querySelector(".history-overview-timeline-card .history-horizontal-timeline-track")
          ?.getBoundingClientRect().height ?? 0
      ) >= 68`,
    );
    const wideTimelineMetrics = JSON.parse(await evaluate(client!, sessionId, `
      (() => {
        const track = document.querySelector(".history-overview-timeline-card .history-horizontal-timeline-track");
        return JSON.stringify({
          trackHeight: track?.getBoundingClientRect().height ?? 0,
          clientWidth: document.documentElement.clientWidth,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
      })()
    `));
    assert.ok(
      wideTimelineMetrics.trackHeight >= 68,
      `wide timeline track height should scale, got ${JSON.stringify(wideTimelineMetrics)}`,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const header = document.querySelector(".history-horizontal-timeline-header");
          const actions = document.querySelector(".history-horizontal-timeline-actions");
          if (!header || !actions) return false;
          const headerRect = header.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          return Math.abs(headerRect.right - actionsRect.right) <= 4;
        })()
      `),
      true,
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
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const dialog = document.querySelector(".history-timeline-dialog-surface");
          const dialogList = document.querySelector(".history-timeline-dialog-body .history-timeline-list");
          const dialogDurationControls = document.querySelector(".history-timeline-dialog-duration-controls");
          const compactTrack = document.querySelector(".history-overview-timeline-card .history-horizontal-timeline-track");
          return Boolean(
            dialog
            && dialog.getAttribute("role") === "dialog"
            && dialog.getAttribute("aria-label") === "时间线"
            && dialogList
            && dialogDurationControls
            && compactTrack
            && !document.querySelector(".history-timeline-dialog-body .history-horizontal-timeline-track")
          );
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const rows = document.querySelectorAll(".history-timeline-dialog-body .history-timeline-list > div");
          return rows.length >= 1;
        })()
      `),
      true,
    );
    const openedDialogDetails = await evaluate(client!, sessionId, `
      (() => {
        const detailButton = document.querySelector(".history-timeline-dialog-body .history-timeline-list button[aria-expanded]");
        if (!detailButton) return "missing";
        detailButton.click();
        return "clicked";
      })()
    `);
    if (openedDialogDetails === "clicked") {
      await waitForExpression(client!, sessionId, "Boolean(document.querySelector('.history-activity-popover'))");
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const popover = document.querySelector(".history-activity-popover");
            const backdrop = document.querySelector(".qp-dialog-backdrop");
            if (!popover || !backdrop) return false;
            return Number(getComputedStyle(popover).zIndex) > Number(getComputedStyle(backdrop).zIndex);
          })()
        `),
        true,
      );
    }
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
    await waitForExpression(
      client!,
      sessionId,
      `!document.querySelector(".history-activity-popover")`,
    );
  });

  await runTest("hourly category mode survives an app reload", async () => {
    await waitForExpression(
      client!,
      sessionId,
      `JSON.parse(localStorage.getItem("__time_tracker_smoke_settings") ?? "{}").hourly_activity_chart_mode === "category"`,
    );
    await client!.command("Page.navigate", { url: appUrl }, sessionId);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector(".dashboard-pulse-mode-toggle")?.getAttribute("aria-pressed") === "true"`,
    );
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
        `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
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
        titleDetailsButtonExpression("标题详情", ".history-timeline-dialog-surface"),
        45_000,
      );
      assert.equal(
        await evaluate(client!, sessionId, `
          document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
        `),
        true,
        `History viewport overflowed at ${width}px`,
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
    }

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
      titleDetailsButtonExpression("标题详情", ".history-timeline-dialog-surface"),
      45_000,
    );
    const opened = await evaluate(client!, sessionId, `
      (() => {
        const trigger = Array.from(document.querySelectorAll('.history-timeline-dialog-surface button[aria-label]'))
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
      `!document.querySelector(".history-timeline-dialog-surface") && !document.querySelector(".history-activity-popover")`,
    );
  });

  await runTest("data trend range picker applies custom ranges and resets to last seven days", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
          if (!node) return false;
          node.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-trend-range-trigger"))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".data-trend-range-trigger");
          if (!trigger || trigger.textContent?.trim() !== "近 7 天") return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-range-picker"))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const key = (delta) => {
            const date = new Date();
            date.setDate(date.getDate() + delta);
            return [
              date.getFullYear(),
              String(date.getMonth() + 1).padStart(2, "0"),
              String(date.getDate()).padStart(2, "0"),
            ].join("-");
          };
          const start = document.querySelector('[data-range-picker-date="' + key(0) + '"]');
          if (!start) return false;
          start.click();
          return true;
        })()
      `),
      true,
    );
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
          ].join("-");
          const end = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!end) return false;
          end.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "1天"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const apply = Array.from(document.querySelectorAll(".data-range-picker-footer button"))
            .find((node) => node.textContent?.trim() === "应用");
          if (!apply) return false;
          apply.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector(".data-trend-range-trigger")?.textContent?.trim() === "1天"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const control = document.querySelector(".data-trend-range-trigger")?.parentElement;
          const reset = control?.querySelector("button:last-of-type");
          if (!reset || reset.getAttribute("aria-label") !== "恢复近 7 天") return false;
          reset.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector(".data-trend-range-trigger")?.textContent?.trim() === "近 7 天"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelector(".data-trend-range-trigger");
          if (!trigger) return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-range-picker"))`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const next = document.querySelector('[aria-label="下一个范围模式"]');
          if (!next) return false;
          next.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "一周"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
          const day = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!day) return false;
          day.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `/^\\d+周$/.test(document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() ?? "")`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const next = document.querySelector('[aria-label="下一个范围模式"]');
          if (!next) return false;
          next.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "一月"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
          const day = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!day) return false;
          day.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `/^\\d+月$/.test(document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() ?? "")`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const next = document.querySelector('[aria-label="下一个范围模式"]');
          if (!next) return false;
          next.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "一年"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const date = new Date();
          const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
          const day = document.querySelector('[data-range-picker-date="' + key + '"]');
          if (!day) return false;
          day.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `/^\\d{4}年$/.test(document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() ?? "")`);
    await evaluate(client!, sessionId, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));`);
    await waitForExpression(client!, sessionId, `!document.querySelector(".data-range-picker")`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const trigger = document.querySelectorAll(".data-trend-range-trigger")[1];
          if (!trigger || trigger.textContent?.trim() !== "近 7 天") return false;
          trigger.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `Boolean(document.querySelector(".data-range-picker"))`);
    for (let clickIndex = 0; clickIndex < 2; clickIndex += 1) {
      assert.equal(
        await evaluate(client!, sessionId, `
          (() => {
            const date = new Date();
            const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
            const day = document.querySelector('[data-range-picker-date="' + key + '"]');
            if (!day) return false;
            day.click();
            return true;
          })()
        `),
        true,
      );
    }
    await waitForExpression(client!, sessionId, `document.querySelector('.data-trend-range-trigger[aria-expanded="true"]')?.textContent?.trim() === "1天"`);
    assert.equal(
      await evaluate(client!, sessionId, `
        (() => {
          const apply = Array.from(document.querySelectorAll(".data-range-picker-footer button"))
            .find((node) => node.textContent?.trim() === "应用");
          if (!apply) return false;
          apply.click();
          return true;
        })()
      `),
      true,
    );
    await waitForExpression(client!, sessionId, `document.querySelectorAll(".data-trend-range-trigger")[1]?.textContent?.trim() === "1天"`);
  });

  await runTest("data heatmap opens the selected day in history", async () => {
    await client!.command("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    const openedData = await evaluate(client!, sessionId, `
      (() => {
        const node = document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']');
        if (!node) return false;
        node.click();
        return true;
      })()
    `);
    assert.equal(openedData, true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("数据"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    const yesterdayKey = await evaluate(client!, sessionId, `
      (() => {
        const date = new Date();
        date.setDate(date.getDate() - 1);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day;
      })()
    `) as string;
    await waitForExpression(
      client!,
      sessionId,
      `Boolean(document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + ']'))`,
      45_000,
    );
    const openedHistory = await evaluate(client!, sessionId, `
      (() => {
        const cell = document.querySelector('[data-history-date=' + ${jsonString(JSON.stringify(yesterdayKey))} + ']');
        if (!cell) return false;
        cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
        return true;
      })()
    `);
    assert.equal(openedHistory, true);
    await waitForExpression(
      client!,
      sessionId,
      `document.querySelector('[aria-label=' + ${jsonString(JSON.stringify("历史"))} + ']')?.className.includes("qp-nav-item-active")`,
    );
    await waitForExpression(
      client!,
      sessionId,
      `document.body.innerText.includes(${jsonString(COPY["zh-CN"].date.yesterday)})`,
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
