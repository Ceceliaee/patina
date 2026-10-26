import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export function onRuntimeCancellation(stop: () => void) {
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const control = process.env.PATINA_RUNTIME_CANCEL;
  const timer = control ? setInterval(() => { if(existsSync(control)) stop(); }, 100) : null;
  timer?.unref();
  if (control && existsSync(control)) stop();
  return () => { if(timer) clearInterval(timer); process.off("SIGINT", stop); process.off("SIGTERM", stop); };
}

// Windows argv quoting, not shell quoting. The supervisor calls CreateProcess directly.
export function quoteWindowsArgument(value: string): string {
  assert.ok(!value.includes("\0"), "Process argument contains NUL");
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}

export async function createRuntimeJob(env: NodeJS.ProcessEnv, onLog: (text: string) => void) {
  assert.equal(process.platform, "win32", "Native runtime requires Windows");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File",
    fileURLToPath(new URL("./tauriRuntimeProcess.ps1", import.meta.url))], {
    env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<number, { resolve: (value: number) => void; reject: (error: Error) => void }>();
  let nextId = 0;
  let closed = false;
  let closing: Promise<void> | null = null;
  let readyResolve: () => void;
  let readyReject: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    if(line === "PATINA_JOB_READY") { readyResolve(); return; }
    if(line.startsWith("PATINA_JOB_REPLY ")) {
      try {
        const reply = JSON.parse(line.slice("PATINA_JOB_REPLY ".length));
        const request = pending.get(reply.id);
        pending.delete(reply.id);
        if(reply.error) request?.reject(new Error(reply.error)); else request?.resolve(reply.result);
      } catch(error) { readyReject(new Error(`Invalid runtime job response: ${String(error)}`)); }
    } else onLog(`${line}\n`);
  });
  child.stderr.on("data", data => onLog(String(data)));
  const fail = (error: Error) => {
    readyReject(error);
    for(const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("exit", (code, signal) => fail(new Error(`Owned runtime supervisor exited (${code}, ${signal})`)));
  const readinessTimer = setTimeout(() => readyReject(new Error("Runtime supervisor startup timed out")), 30_000);
  try { await ready; } catch(error) { child.kill(); lines.close(); throw error; }
  finally { clearTimeout(readinessTimer); }
  const request = (op: string, args: Record<string, unknown> = {}) => new Promise<number>((resolve, reject) => {
    if(closed || (closing && op !== "stop") || child.exitCode !== null || child.signalCode !== null) { reject(new Error("Runtime job is closed")); return; }
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Runtime job ${op} timed out`)); }, 20_000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    child.stdin.write(`${JSON.stringify({ id, op, ...args })}\n`);
  });
  return {
    async start(executable: string, args: string[] = []) {
      return request("start", { executable: resolve(executable), arguments: args.map(quoteWindowsArgument).join(" "), directory: process.cwd() });
    },
    count: () => request("count"),
    exitCode: (pid: number) => request("exit", { pid }),
    claimDesktop: (name = "Local\\PatinaRuntimeDesktop") => request("desktop", { name }),
    stop: () => request("stop"),
    close() { return closing ??= (async () => {
      if(closed) return;
      try { await request("stop"); }
      finally {
        closed = true;
        child.stdin.end();
        await new Promise<void>(resolve => {
          if(child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
          const timer = setTimeout(() => { child.kill(); resolve(); }, 5_000);
          child.once("exit", () => { clearTimeout(timer); resolve(); });
        });
        lines.close();
        assert.equal(child.exitCode, 0, "Runtime job supervisor did not exit cleanly");
      }
    })(); },
  };
}
