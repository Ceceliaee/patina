import assert from "node:assert/strict";
import { verifyMiniWindowRuntime } from "./tauriMiniWindowRuntime.ts";
import { verifyDesktopResourceLifecycle } from "./tauriResourceLifecycle.ts";

import { RuntimeSession, evaluate } from "./tauriRuntimeHarness.ts";
import { createProcessMeasurement } from "./tauriRuntimeMeasurement.ts";
import { verifyInputEnvironmentControls } from "./tauriInputEnvironmentRuntime.ts";
export async function run(session: RuntimeSession, resourceCycles: boolean, feedback = false) {
  assert.ok(!(resourceCycles && feedback), "Short feedback cannot be used for resource acceptance");
  let client = session.client!;
  const { devtoolsPort } = session;
  const { measureRuntimeProcessTree, runRuntimeBinaryProcessCommand } = createProcessMeasurement(session.binary);
  await session.show();
  try {
    session.report.enter(resourceCycles ? "resources:input" : "mini-input:input");
    const owner = await evaluate(client, 'window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")') as { process_id: number };
    await verifyInputEnvironmentControls(owner.process_id, session.cancellation.signal, session.ownCleanup);
    client = await verifyMiniWindowRuntime(client, devtoolsPort, resourceCycles, measureRuntimeProcessTree, session.cancellation.signal, session.ownCleanup, feedback);
    session.client = client;
    session.report.enter(resourceCycles ? "resources:sampling" : "mini-input:diagnostics");
    const resourceDiagnostics = await evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")`,
    ) as {
      process_id: number;
      process_resources?: {
        working_set_bytes?: number | null;
        private_usage_bytes?: number | null;
      };
    };
    assert.equal(typeof resourceDiagnostics.process_resources, "object");
    console.log("PATINA_RUNTIME_MEMORY_REPORT", JSON.stringify({
      scope: "isolated real Tauri main process after read-model initialization",
      workingSetBytes: resourceDiagnostics.process_resources?.working_set_bytes ?? null,
      privateUsageBytes: resourceDiagnostics.process_resources?.private_usage_bytes ?? null,
      comparison: "absolute diagnostic only; before/after payload retention is measured by perf:activity-read-model",
    }));
    const processQueryTimeout = new Error("injected process query timeout", {
      cause: Object.assign(new Error("spawnSync powershell.exe ETIMEDOUT"), { code: "ETIMEDOUT" }),
    });
    let processQueryAttempts = 0;
    const rootOnlyMemory = measureRuntimeProcessTree(resourceDiagnostics.process_id, (command) => {
      if(++processQueryAttempts === 1) throw processQueryTimeout;
      return runRuntimeBinaryProcessCommand(command);
    });
    assert.equal(processQueryAttempts, 2);
    assert.equal(rootOnlyMemory.coverage, "root_only");
    assert.equal(rootOnlyMemory.processCount, 1);
    assert.ok(rootOnlyMemory.workingSetBytes > 0);
    assert.ok(rootOnlyMemory.privateUsageBytes > 0);
    processQueryAttempts = 0;
    assert.throws(() => measureRuntimeProcessTree(resourceDiagnostics.process_id, () => {
      processQueryAttempts += 1;
      throw processQueryTimeout;
    }), (error) => error === processQueryTimeout);
    assert.equal(processQueryAttempts, 2, "a failed root measurement must remain fatal");
    processQueryAttempts = 0;
    const processQueryFailure = new Error("runtime smoke root process not found");
    assert.throws(() => measureRuntimeProcessTree(resourceDiagnostics.process_id, () => {
      processQueryAttempts += 1;
      throw processQueryFailure;
    }), (error) => error === processQueryFailure);
    assert.equal(processQueryAttempts, 1, "non-timeout failures must not be retried");
    console.log("PASS runtime process measurement timeout fallback and failure propagation");
    const processTreeMemory = measureRuntimeProcessTree(resourceDiagnostics.process_id);
    assert.ok(processTreeMemory.processCount >= 1);
    assert.ok(processTreeMemory.workingSetBytes > 0);
    assert.ok(processTreeMemory.privateUsageBytes > 0);
    console.log("PATINA_RUNTIME_PROCESS_TREE_MEMORY_REPORT", JSON.stringify({
      scope: processTreeMemory.coverage === "root_and_descendants"
        ? "isolated real Tauri root process and descendant WebView2 process tree"
        : "isolated real Tauri root process; Windows CIM descendant enumeration unavailable",
      ...processTreeMemory,
      comparison: "absolute diagnostic only; before/after payload retention is measured by perf:activity-read-model",
    }));
    if(resourceCycles) {
      assert.ok(!process.env.PATINA_COVERAGE_TARGET_DIR, "Performance must run without coverage instrumentation");
      try {
        for(const collectionMode of ["forced", "natural"] as const) {
          await verifyDesktopResourceLifecycle(client, expression => evaluate(client!, expression), () => measureRuntimeProcessTree(resourceDiagnostics.process_id), collectionMode, session.cancellation.signal);
        }
      } finally {
        await evaluate(client, "window.__resourceIntervalProbe.restore(); delete window.__resourceIntervalProbe;");
      }
    }


  } finally { session.client = client; }
}
