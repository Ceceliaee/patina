import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { DEFAULT_TIMEOUT_MS } from "./constants.ts";

function commandPath(command: string) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [command], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.split(/\r?\n/).find(Boolean) ?? null : null;
}

export function assertIsolatedTempPath(path: string, expectedPrefix: string) {
  const resolvedTempRoot = resolve(tmpdir());
  const resolvedPath = resolve(path);
  const relativePath = relative(resolvedTempRoot, resolvedPath);
  assert.ok(
    relativePath
      && !relativePath.startsWith("..")
      && !isAbsolute(relativePath)
      && basename(resolvedPath).startsWith(expectedPrefix),
    `refusing to clean unexpected test path: ${resolvedPath}`,
  );
}

export async function removeIsolatedBrowserDataDir(path: string) {
  assertIsolatedTempPath(path, "time-tracker-browser-smoke-");
  await waitFor(
    "browser user data cleanup",
    () => {
      try {
        rmSync(path, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
        return true;
      } catch (error) {
        const errorCode =
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : "";
        if (errorCode === "EBUSY" || errorCode === "ENOTEMPTY" || errorCode === "EPERM") {
          return existsSync(path) ? null : true;
        }
        throw error;
      }
    },
    20_000,
  );
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

export async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor<T>(
  label: string,
  producer: () => Promise<T | null> | T | null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const start = Date.now();
  let lastObservation: T | null = null;
  while (Date.now() - start < timeoutMs) {
    const value = await producer();
    lastObservation = value;
    if (value) {
      return value;
    }
    await delay(100);
  }

  throw new Error(`Timed out waiting for ${label}; last observation: ${String(lastObservation)}`);
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

export async function launchBrowser() {
  const browserPath = resolveBrowserPath();
  const userDataDir = mkdtempSync(join(tmpdir(), "time-tracker-browser-smoke-"));
  assertIsolatedTempPath(userDataDir, "time-tracker-browser-smoke-");
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
    stdio: ["ignore", "pipe", "pipe"],
  });
  let browserLogTail = "";
  let spawnError: Error | null = null;
  const captureBrowserLog = (chunk: unknown) => {
    browserLogTail = `${browserLogTail}${String(chunk)}`.slice(-4_096);
  };
  browser.stdout?.on("data", captureBrowserLog);
  browser.stderr?.on("data", captureBrowserLog);
  browser.once("error", (error) => {
    spawnError = error;
  });

  try {
    const port = await waitFor("browser devtools port", () => {
      if (spawnError) {
        throw new Error(`Browser process failed to start: ${spawnError.message}`);
      }
      if (browser.exitCode !== null) {
        throw new Error(
          `Browser exited before exposing DevTools (exit ${browser.exitCode})`
          + (browserLogTail ? `:\n${browserLogTail}` : ""),
        );
      }
      return readDevToolsPort(userDataDir);
    });
    return {
      browser,
      port,
      userDataDir,
    };
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      await stopBrowser(browser);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      await removeIsolatedBrowserDataDir(userDataDir);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    throw new AggregateError([error, ...cleanupErrors], "Browser launch failed");
  }
}

export async function stopBrowser(browser: ChildProcess) {
  if (browser.exitCode !== null) return;

  const pid = browser.pid;
  if (process.platform === "win32" && browser.pid) {
    const result = spawnSync("taskkill.exe", ["/PID", String(browser.pid), "/T", "/F"], {
      encoding: "utf8",
    });
    if ((result.error || result.status !== 0) && isProcessRunning(browser.pid)) {
      const fallback = spawnSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "Stop-Process -Id $env:PATINA_BROWSER_SMOKE_PID -Force",
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATINA_BROWSER_SMOKE_PID: String(browser.pid),
        },
      });
      if ((fallback.error || fallback.status !== 0) && isProcessRunning(browser.pid)) {
        throw new Error(
          `failed to stop browser process ${browser.pid}: ${fallback.stderr || fallback.stdout || result.stderr || result.stdout}`,
        );
      }
    }
  } else {
    browser.kill("SIGTERM");
  }

  await waitFor(
    "browser process exit",
    () => browser.exitCode !== null || (pid && !isProcessRunning(pid)) ? true : null,
    5_000,
  );
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type PendingCommand = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class CdpConnection {
  private nextId = 1;
  private pending = new Map<number, PendingCommand>();
  private listeners = new Set<(message: Record<string, unknown>) => void>();
  private ready: Promise<void>;
  private readonly ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timed out after ${DEFAULT_TIMEOUT_MS}ms opening CDP WebSocket`)),
        DEFAULT_TIMEOUT_MS,
      );
      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("CDP WebSocket failed to open"));
      }, {
        once: true,
      });
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      const id = typeof message.id === "number" ? message.id : null;

      if (id !== null && this.pending.has(id)) {
        const pending = this.pending.get(id)!;
        this.pending.delete(id);
        clearTimeout(pending.timeout);

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

    const rejectPending = (message: string) => {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`${message}; pending CDP command id=${id}`));
      }
      this.pending.clear();
    };
    ws.addEventListener("error", () => rejectPending("CDP WebSocket error"));
    ws.addEventListener("close", () => rejectPending("CDP WebSocket closed"));
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

  async command(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
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
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for CDP command ${method} (id=${id})`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
    });
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) clearTimeout(pending.timeout);
      this.pending.delete(id);
      throw error;
    }
    return result;
  }

  close() {
    this.ws.close();
  }
}

export async function getBrowserWebSocketUrl(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  const version = await response.json() as { webSocketDebuggerUrl?: string };
  assert.ok(version.webSocketDebuggerUrl, "missing browser CDP WebSocket URL");
  return version.webSocketDebuggerUrl;
}

export async function evaluate(
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

export async function waitForExpression(
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

export async function waitForStableExpression(
  client: CdpConnection,
  sessionId: string,
  expression: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  label = "stable browser expression",
  frameCount = 4,
) {
  assert.ok(Number.isInteger(frameCount) && frameCount > 0, "frameCount must be a positive integer");
  return waitFor(label, async () => {
    const value = await evaluate(client, sessionId, `
      (async () => {
        for (let frame = 0; frame < ${frameCount}; frame += 1) {
          await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
          if (!(${expression})) return false;
        }
        return true;
      })()
    `);
    return value ? value : null;
  }, timeoutMs);
}

export async function waitForAnimationFrames(
  client: CdpConnection,
  sessionId: string,
  frameCount = 2,
) {
  await evaluate(client, sessionId, `
    (async () => {
      for (let frame = 0; frame < ${frameCount}; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      }
      return true;
    })()
  `);
}

export function jsonString(value: string) {
  return JSON.stringify(value);
}

export function titleDetailsButtonExpression(labelFragment: string, scopeSelector?: string) {
  const scope = scopeSelector ? `document.querySelector(${jsonString(scopeSelector)})` : "document";
  return `
    Boolean(Array.from((${scope})?.querySelectorAll('button[aria-label]') ?? [])
      .find((node) => node.getAttribute('aria-label')?.includes(${jsonString(labelFragment)})))
  `;
}
