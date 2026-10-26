import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { build, preview, type PreviewServer } from "vite";
import { sourceFingerprint } from "../scripts/coverage/source-fingerprint.ts";
import { createRuntimeJob, onRuntimeCancellation } from "./tauriRuntimeProcess.ts";
import { RuntimeReport } from "./tauriRuntimeReport.ts";
import { assertIsolatedTempPath, CdpConnection, waitFor } from "./uiBrowserSmoke/browserHarness.ts";

const sourceScope = ["src/", "locales/", "scripts/", "public/", ".cargo/", "src-tauri/.cargo/", "index.html", "src-tauri/src/", "src-tauri/capabilities/", "src-tauri/permissions/", "src-tauri/icons/",
  "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/build.rs", "src-tauri/tauri.conf.json", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "vite.config.ts", "tsconfig.json", "tsconfig.node.json", ".node-version", "rust-toolchain.toml"];
export const runtimeSourceFingerprint = () => sourceFingerprint(sourceScope);
const runtimeConfig = (port: number) => ({ identifier: "com.ceceliaee.patina.runtime-smoke", build: { beforeDevCommand: "", devUrl: `http://127.0.0.1:${port}` } });
export type PreparedRuntime = {
  format: 1; directory: string; binary: string; frontend: string; frontendPort: number; config: string;
  fingerprint: ReturnType<typeof sourceFingerprint>; binaryHash: string; assetsHash: string;
  instrumentation: string; node: string;
};
function hash(path: string) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function assetsHash(root: string) {
  const inventory = readdirSync(root, { recursive: true, withFileTypes: true });
  assert.ok(inventory.every(entry => !entry.isSymbolicLink()), "Prepared assets must not contain symbolic links");
  const entries = inventory.filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name)).sort();
  const digest = createHash("sha256");
  for(const file of entries) digest.update(relative(root, file)).update("\0").update(readFileSync(file));
  return digest.digest("hex");
}
export const runtimeInstrumentation = () => JSON.stringify(["RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTC_WORKSPACE_WRAPPER", "RUSTC_WRAPPER", "RUSTUP_TOOLCHAIN", "CARGO_BUILD_TARGET", "PATINA_COVERAGE_TARGET_DIR"].map(name => [name, process.env[name] ?? ""]));
export async function reserveRuntimePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address(); assert.ok(address && typeof address === "object");
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

export async function runBackgroundCommand(executable: string, args: string[], env = process.env, timeoutMs = 480_000) {
  const job = await createRuntimeJob(env, text => process.stdout.write(text));
  const failures: unknown[] = [];
  let root: string | null = null;
  try {
    // A completion receipt preserves the exact exit status of the tool. The
    // wrapper and every compiler child belong to the same cancellable job.
    root = mkdtempSync(join(tmpdir(), "patina-runtime-build-"));
    const receipt = join(root, "exit.json");
    const code = `const {spawn}=require('node:child_process');const fs=require('node:fs');const args=JSON.parse(process.argv[2]);const child=spawn(process.argv[1],args,{stdio:'inherit',windowsHide:true});child.on('error',error=>{fs.writeFileSync(process.argv[3],JSON.stringify({error:error.message}));process.exitCode=1});child.on('exit',(code,signal)=>{fs.writeFileSync(process.argv[3],JSON.stringify({code,signal}));process.exitCode=code??1});`;
    await job.start(process.execPath, ["-e", code, executable, JSON.stringify(args), receipt]);
    let cancel: (error: Error) => void;
    let cancellationError: Error | null = null;
    const cancelled = new Promise<never>((_, reject) => { cancel = reject; });
    const stop = () => { cancellationError = new Error("Background command cancelled"); cancel(cancellationError); };
    const unsubscribe = onRuntimeCancellation(stop);
    try {
      const result = await Promise.race([
        cancelled,
        waitFor("background command completion", () => {
          if (cancellationError) throw cancellationError;
          try { return JSON.parse(readFileSync(receipt, "utf8")); }
          catch (error) { if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
        }, timeoutMs),
      ]);
      assert.equal(result.code, 0, `${executable} failed: ${JSON.stringify(result)}`);
    } finally { unsubscribe(); }
  } catch (error) { failures.push(error); }
  finally {
    try { await job.close(); } catch (error) { failures.push(error); }
    if (root) {
      try { assertIsolatedTempPath(root, "patina-runtime-build-"); rmSync(root, { recursive: true, force: true }); }
      catch (error) { failures.push(error); }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Background command and cleanup failed");
}

export async function prepareRuntime(report: RuntimeReport): Promise<PreparedRuntime> {
  assert.equal(process.platform, "win32", "Tauri runtime requires Windows");
  report.enter("prepare");
  const directory = resolve(report.output, "prepared");
  mkdirSync(directory, { recursive: true });
  const frontend = join(directory, "frontend");
  const frontendPort = await reserveRuntimePort();
  const config = JSON.stringify(runtimeConfig(frontendPort));
  const before = runtimeSourceFingerprint();
  await build({ configFile: "vite.config.ts", logLevel: "error", build: { outDir: frontend, emptyOutDir: true } });
  const target = process.env.PATINA_COVERAGE_TARGET_DIR ?? resolve("src-tauri/target/runtime-smoke");
  mkdirSync(target, { recursive: true });
  const lock = join(target, ".runtime-prepare-lock");
  // Never remove a lock belonging to an interrupted or concurrent preparation.
  mkdirSync(lock);
  try {
    await runBackgroundCommand("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml", "--bin", "patina", "--locked", "--offline"], {
      ...process.env, CARGO_TARGET_DIR: target, TAURI_CONFIG: config,
    });
    const binary = join(directory, "patina.exe");
    copyFileSync(join(target, "debug", "patina.exe"), binary);
    assert.deepEqual(runtimeSourceFingerprint(), before, "Source changed during runtime preparation");
    const result: PreparedRuntime = {
      format: 1, directory, binary, frontend, frontendPort, config, fingerprint: before,
      binaryHash: hash(binary), assetsHash: assetsHash(frontend), instrumentation: runtimeInstrumentation(), node: process.version
    };
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
    console.log(`PATINA_RUNTIME_PREPARED ${join(directory, "manifest.json")}`);
    return result;
  } finally { rmdirSync(lock); }
}

export function readPreparedRuntime(path: string): PreparedRuntime {
  const result = JSON.parse(readFileSync(path, "utf8")) as PreparedRuntime;
  const base = realpathSync(resolve("artifacts/runtime-smoke"));
  const child = relative(base, realpathSync(path));
  assert.ok(child && !child.startsWith("..") && !isAbsolute(child), "Prepared manifest must be a local runtime artifact");
  assert.equal(realpathSync(result.directory), dirname(realpathSync(path)), "Manifest directory mismatch");
  assert.equal(result.format, 1); assert.equal(result.node, process.version);
  assert.equal(result.instrumentation, runtimeInstrumentation(), "Runtime instrumentation changed; prepare again");
  assert.deepEqual(result.fingerprint, runtimeSourceFingerprint(), "Runtime source changed; prepare again");
  for(const file of [result.binary, result.frontend]) {
    const owned = relative(realpathSync(result.directory), realpathSync(file));
    assert.ok(owned && !owned.startsWith("..") && !isAbsolute(owned), "Prepared artifact escaped its directory");
  }
  assert.ok(Number.isInteger(result.frontendPort) && result.frontendPort > 0 && result.frontendPort < 65536);
  assert.deepEqual(JSON.parse(result.config), runtimeConfig(result.frontendPort), "Prepared configuration changed");
  assert.equal(hash(result.binary), result.binaryHash, "Prepared binary changed");
  assert.equal(assetsHash(result.frontend), result.assetsHash, "Prepared frontend changed");
  return result;
}

export async function findMainTarget(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) });
    if(!response.ok) return null;
    const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>;
    return targets.find(target => target.type === "page" && target.url && target.url !== "about:blank" && target.webSocketDebuggerUrl) ?? null;
  } catch { return null; }
}
export async function evaluate(client: CdpConnection, expression: string) {
  const response = await client.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if(response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return (response.result as { value?: unknown } | undefined)?.value;
}

export class RuntimeSession {
  readonly root = mkdtempSync(join(tmpdir(), "patina-tauri-e2e-"));
  readonly frontendDistDir = join(this.root, "frontend-dist");
  readonly binary = join(this.root, "patina.exe");
  readonly logs: string[] = [];
  readonly webviewDiagnostics: string[] = [];
  readonly frontendUrl: string;
  client: CdpConnection | null = null;
  job: Awaited<ReturnType<typeof createRuntimeJob>> | null = null;
  server: PreviewServer | null = null;
  devtoolsPort = 0;
  launchPid: number | null = null;
  hiddenStartupObservedAt: number | null = null;
  hiddenStartupDestroyedAt: number | null = null;
  cancelled = false;
  readonly cancellation = new AbortController();
  private readonly cleanups: Array<() => Promise<void>> = [];
  ownCleanup = (cleanup: () => Promise<void>) => { this.cleanups.push(cleanup); };
  readonly prepared: PreparedRuntime;
  readonly report: RuntimeReport;
  constructor(prepared: PreparedRuntime, report: RuntimeReport) {
    this.prepared = prepared; this.report = report;
    assertIsolatedTempPath(this.root, "patina-tauri-e2e-");
    this.frontendUrl = `http://127.0.0.1:${prepared.frontendPort}`;
    try {
      cpSync(prepared.frontend, this.frontendDistDir, { recursive: true });
      copyFileSync(prepared.binary, this.binary);
    } catch (error) {
      assertIsolatedTempPath(this.root, "patina-tauri-e2e-");
      rmSync(this.root, { recursive: true, force: true });
      throw error;
    }
  }
  capture = (text: string) => {
    this.logs.push(text); process.stdout.write(`${new Date().toISOString()} ${text}`);
    const tail = this.logs.slice(-8).join("");
    if(this.hiddenStartupObservedAt === null && /\[startup\] source=manual strategy=start-in-tray-optimized/.test(tail)) this.hiddenStartupObservedAt = Date.now();
    if(this.hiddenStartupDestroyedAt === null && /event=destroyed generation=1[^\r\n]*reason=background-idle/.test(tail)) this.hiddenStartupDestroyedAt = Date.now();
  };
  async start() {
    assert.equal(this.cancelled, false, "Runtime was cancelled");
    if(!this.server) {
      this.devtoolsPort = await reserveRuntimePort();
      this.server = await preview({
        configFile: "vite.config.ts", logLevel: "error", build: { outDir: this.frontendDistDir },
        preview: { host: "127.0.0.1", port: this.prepared.frontendPort, strictPort: true }
      });
    }
    if (!this.job) {
      assert.equal(this.cancelled, false, "Runtime startup cancelled");
      this.job = await createRuntimeJob({
        ...process.env, PATINA_E2E: "1", PATINA_E2E_SINGLE_INSTANCE: "1",
        PATINA_E2E_DATA_ROOT: this.root, PATINA_E2E_STORAGE_ID: basename(this.root), PATINA_E2E_FRONTEND_URL: this.frontendUrl,
        PATINA_E2E_DEVTOOLS_PORT: String(this.devtoolsPort), TAURI_CONFIG: this.prepared.config
      }, this.capture);
    }
    if (this.cancelled) { await this.job.close(); this.job = null; throw new Error("Runtime startup cancelled"); }
    this.launchPid = await this.job!.start(this.binary);
    return this.launchPid;
  }
  async connect() {
    const target = await waitFor("Patina main WebView CDP target", async () => {
      if (this.cancelled) throw new Error("Runtime startup cancelled");
      const code = await this.job!.exitCode(this.launchPid!);
      assert.equal(code, -1, `Patina exited before WebView startup (${code})`);
      return findMainTarget(this.devtoolsPort);
    }, 30_000);
    assert.ok(target.url?.startsWith(this.frontendUrl), "Unexpected runtime frontend URL");
    this.client = await CdpConnection.connect(target.webSocketDebuggerUrl!);
    await this.client.command("Runtime.enable"); await this.client.command("Page.enable"); await this.client.command("Log.enable");
    this.report.metadata.webview = await this.client.command("Browser.getVersion");
    this.client.onMessage(message => {
      if(["Runtime.consoleAPICalled", "Runtime.exceptionThrown", "Log.entryAdded"].includes(String(message.method))) this.webviewDiagnostics.push(JSON.stringify(message).slice(0, 4096));
    });
    await waitFor("real Tauri runtime", () => evaluate(this.client!, "Boolean(window.__TAURI_INTERNALS__ && document.querySelector('#root')?.children.length)"), 30_000);
    return this.client;
  }
  async show() {
    await evaluate(this.client!, 'window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")');
    await waitFor("main is visible", () => evaluate(this.client!, 'window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible",{label:"main"})'));
  }
  async stop() { this.client?.close(); this.client = null; await this.job?.close(); this.job = null; }
  async cleanup() {
    this.cancellation.abort();
    const errors: unknown[] = [];
    for (const cleanup of this.cleanups.reverse()) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    if(process.env.PATINA_COVERAGE_TARGET_DIR && this.client) {
      try { await evaluate(this.client, 'window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")'); } catch(error) { errors.push(error); }
    }
    this.client?.close(); this.client = null;
    try { await this.job?.close(); } catch(error) { errors.push(error); }
    try { await this.server?.close(); } catch(error) { errors.push(error); }
    try { writeFileSync(join(this.report.output, `${basename(this.root)}.log`), this.logs.join("") + "\n" + this.webviewDiagnostics.join("\n"), "utf8"); }
    catch (error) { errors.push(error); }
    try {
      const id = basename(this.root); assert.match(id, /^patina-tauri-e2e-[a-zA-Z0-9-]+$/);
      // Removal is scoped to the test profile, never the production/local/dev key.
      await new Promise<void>((resolve, reject) => {
        const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $key='HKCU:\\Software\\Patina\\Storage\\tests\\'+$env:PATINA_CLEANUP_ID; if(Test-Path -LiteralPath $key){Remove-Item -LiteralPath $key -Recurse -Force}"], { windowsHide: true, stdio: "ignore", env: { ...process.env, PATINA_CLEANUP_ID: id } });
        const timer = setTimeout(() => { child.kill(); reject(new Error("Registry cleanup timed out")); }, 10_000);
        child.once("exit", () => clearTimeout(timer));
        child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Test registry cleanup failed (${code})`)));
      });
    } catch(error) { errors.push(error); }
    try {
      assertIsolatedTempPath(this.root, "patina-tauri-e2e-");
      await waitFor("isolated runtime directory cleanup", () => {
        try { rmSync(this.root, { recursive: true, force: true }); return !existsSync(this.root); }
        catch(error) { if(["EPERM", "EBUSY", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) return false; throw error; }
      }, 20_000);
    } catch(error) { errors.push(error); }
    if(errors.length) throw new AggregateError(errors, "Runtime cleanup failed");
  }
}
