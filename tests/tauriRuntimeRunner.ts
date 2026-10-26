import { run as dataRecovery } from "./tauriDataRecoveryRuntime.ts";
import { run as input } from "./tauriInputRuntime.ts";
import { run as contracts } from "./tauriPermissionRuntime.ts";
import { run as webviewRecovery } from "./tauriRecoveryRuntime.ts";
import { prepareRuntime, readPreparedRuntime, RuntimeSession } from "./tauriRuntimeHarness.ts";
import { assertResourceEnvironment, assertRuntimeResults, parseRuntimeOptions, selectRuntimeGroups, type RuntimeGroup } from "./tauriRuntimeOptions.ts";
import { onRuntimeCancellation } from "./tauriRuntimeProcess.ts";
import { RuntimeReport } from "./tauriRuntimeReport.ts";
import { sourceFingerprint } from "../scripts/coverage/source-fingerprint.ts";
import { run as storageRestart } from "./tauriStorageRestartRuntime.ts";
import { run as windowLifecycle } from "./tauriWindowLifecycleRuntime.ts";

const options = parseRuntimeOptions(process.argv.slice(2));
const scenarios: Record<RuntimeGroup, (session: RuntimeSession) => Promise<void>> = {
  contracts, "data-recovery": dataRecovery, "storage-restart": storageRestart,
  "webview-recovery": webviewRecovery, "window-lifecycle": windowLifecycle,
  "mini-input": session => input(session, false, options.feedback), resources: session => input(session, true),
};
// Resource mode retains the full acceptance union. Its mini group includes the
// ordinary assertions as well as the long samples, so it replaces mini-input.
const selected = selectRuntimeGroups(options);
const report = new RuntimeReport(options.prepareOnly ? "prepare" : `${options.feedback ? "feedback:" : "acceptance:"}${selected.join(",")}`);
try {
  if (selected.includes("resources")) assertResourceEnvironment(process.env);
  const prepared = options.prepared ? readPreparedRuntime(options.prepared) : await prepareRuntime(report);
  report.metadata = { product: prepared.fingerprint, tests: sourceFingerprint(["tests/"]), instrumentation: prepared.instrumentation, prepared: prepared.directory };
  if(!options.prepareOnly) {
    for(const group of selected) {
      let session: RuntimeSession | null = null;
      const failures: unknown[] = [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      let work: Promise<void> | undefined;
      let cancel: (reason: Error) => void;
      const cancelled = new Promise<never>((_, reject) => { cancel = reject; });
      let cancellationRequested = false;
      const stop = (reason = new Error(`Runtime ${group} cancelled`)) => {
        cancellationRequested = true;
        if (session) { session.cancelled = true; session.cancellation.abort(); }
        cancel(reason);
      };
      const unsubscribe = onRuntimeCancellation(stop);
      try {
        report.enter(`${group}:launch`);
        session = new RuntimeSession(prepared, report);
        const current = session;
        if (cancellationRequested) current.cancelled = true;
        timer = setTimeout(() => stop(new Error(`Runtime ${group} deadline exceeded`)), group === "resources" ? 1_500_000 : 600_000);
        work = (async () => {
          await current.start(); await current.connect();
          report.enter(`${group}:assertions`);
          await scenarios[group](current);
        })();
        await Promise.race([cancelled, work]);
      } catch(error) { failures.push(error); report.leave("failed"); }
      finally {
        clearTimeout(timer);
        if(session) {
          session.cancelled = true;
          session.cancellation.abort();
          if (failures.length) session.client?.close();
        }
        // A race does not stop its losing promise. Drain it before removing its
        // profile so late startup, database work or cleanup registration cannot
        // escape the owned session. CDP, native requests and startup are bounded.
        try { await work; } catch (error) {
          if (!failures.includes(error)) failures.push(error);
        }
        // A reporting failure must not prevent closing the session's resources.
        try { report.enter(`${group}:cleanup`); } catch (error) { failures.push(error); }
        let cleanupFailed = false;
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          cleanupTimer = setTimeout(() => {
            cleanupFailed = true;
            failures.push(new Error(`Runtime ${group} cleanup exceeded 60 seconds; inspect its run artifacts`));
          }, 60_000);
          await session?.cleanup();
        } catch(error) { cleanupFailed = true; failures.push(error); }
        finally { clearTimeout(cleanupTimer); }
        unsubscribe();
        if (cancellationRequested) failures.push(new Error(`Runtime ${group} was cancelled`));
        report.leave(cleanupFailed ? "failed" : "completed");
      }
      report.results.push({ group, status: failures.length ? "failed" : "passed" });
      if(failures.length) throw new AggregateError(failures, `Runtime ${group} failed`);
    }
    assertRuntimeResults(selected, report.results);
  }
  report.leave("completed"); report.save("passed");
  console.log(`PATINA_RUNTIME_RESULT ${report.output}/result.json`);
} catch(error) {
  report.leave("failed");
  try { report.save("failed", error); }
  catch (reportError) { throw new AggregateError([error, reportError], "Runtime failed and its report could not be saved"); }
  throw error;
}
