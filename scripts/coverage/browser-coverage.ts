import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CdpConnection } from "../../tests/uiBrowserSmoke/browserHarness.ts";

// These are c8's conversion dependencies, deliberately resolved from c8 itself.
const require = createRequire(createRequire(import.meta.url).resolve("c8/package.json"));
const v8ToIstanbul = require("v8-to-istanbul");
const { mergeScriptCovs } = require("@bcoe/v8-coverage");
const { createCoverageMap } = require("istanbul-lib-coverage");

interface Script { filename: string; source: string; map: unknown; key: string }
export async function startBrowserCoverage(client: CdpConnection, sessionId: string, output: string) {
  const command = client.command.bind(client);
  const scripts = new Map<string, Promise<Script | null>>();
  const versions = new Map<string, Promise<Script | null>>();
  const groups = new Map<string, { script: Script; counts: unknown[] }>();
  const errors: Array<{ filename: string; reason: string }> = [];
  let snapshots = 0;
  const detach = client.onMessage(message => {
    if (message.sessionId !== sessionId || message.method !== "Debugger.scriptParsed") return;
    const metadata = message.params as { url: string; hash: string; scriptId: string; sourceMapURL?: string };
    let url: URL;
    try { url = new URL(metadata.url); } catch { return; }
    if (!url.pathname.startsWith("/src/") || !/\.(ts|tsx)$/.test(url.pathname)) return;
    const filename = resolve(decodeURIComponent(url.pathname).slice(1));
    const key = `${filename}:${metadata.hash}`;
    let pending = versions.get(key);
    if (!pending) {
      pending = command("Debugger.getScriptSource", { scriptId: metadata.scriptId }, sessionId)
        .then(value => {
          const source = (value as { scriptSource: string }).scriptSource;
          const mapUrl = metadata.sourceMapURL ?? source.match(/sourceMappingURL=(\S+)/)?.[1];
          if (!mapUrl?.startsWith("data:")) throw new Error("missing inline source map");
          const comma = mapUrl.indexOf(",");
          const raw = mapUrl.slice(0, comma).includes(";base64")
            ? Buffer.from(mapUrl.slice(comma + 1), "base64").toString("utf8")
            : decodeURIComponent(mapUrl.slice(comma + 1));
          return { filename, source, map: JSON.parse(raw), key };
        }).catch(error => {
          errors.push({ filename, reason: String(error) });
          versions.delete(key); // Another context may successfully capture this version.
          return null;
        });
      versions.set(key, pending);
    }
    scripts.set(metadata.scriptId, pending);
  });
  await command("Debugger.enable", {}, sessionId);
  await command("Profiler.enable", {}, sessionId);
  await command("Profiler.startPreciseCoverage", { callCount: true, detailed: true }, sessionId);
  async function flush() {
    const snapshot = await command("Profiler.takePreciseCoverage", {}, sessionId) as {
      result: Array<{ scriptId: string }>;
    };
    snapshots += 1;
    for (const counts of snapshot.result) {
      const script = await scripts.get(counts.scriptId);
      if (!script) continue;
      let group = groups.get(script.key);
      if (!group) { group = { script, counts: [] }; groups.set(script.key, group); }
      group.counts.push(counts);
    }
  }
  client.command = async (method, params = {}, targetSession, timeoutMs) => {
    if (targetSession === sessionId && (method === "Page.navigate" || method === "Page.reload"
      || (method === "Runtime.evaluate" && /location\.(reload|assign|replace|href\s*=)/.test(String(params.expression ?? ""))))) {
      await flush();
    }
    return command(method, params, targetSession, timeoutMs);
  };
  return {
    flush,
    async finish(passed: number, failed: boolean) {
      await flush();
      client.command = command;
      detach();
      await command("Profiler.stopPreciseCoverage", {}, sessionId);
      const coverage = createCoverageMap({});
      for (const { script, counts } of groups.values()) {
        const converter = v8ToIstanbul(script.filename, 0, { source: script.source, sourceMap: { sourcemap: script.map } });
        await converter.load();
        converter.applyCoverage(mergeScriptCovs(counts).functions);
        coverage.merge(converter.toIstanbul());
      }
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, "coverage-final.json"), JSON.stringify(coverage.toJSON()), "utf8");
      writeFileSync(join(output, "collection.json"), JSON.stringify({ passed, failed, snapshots, versions: groups.size, errors }, null, 2), "utf8");
      console.log(`Browser coverage: ${coverage.files().length} files, ${errors.length} acquisition errors`);
    },
  };
}
