import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TIMEOUT_MS } from "./constants.ts";

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

export async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor<T>(
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

export async function launchBrowser() {
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

export async function stopBrowser(browser: ChildProcess) {
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

export class CdpConnection {
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

export async function getBrowserWebSocketUrl(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
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
