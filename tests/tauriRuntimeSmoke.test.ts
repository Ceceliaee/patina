import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRuntimeOptions } from "./tauriRuntimeOptions.ts";
import { createRuntimeJob } from "./tauriRuntimeProcess.ts";
import { assertIsolatedTempPath, waitFor } from "./uiBrowserSmoke/browserHarness.ts";

const options = parseRuntimeOptions(process.argv.slice(2));
const root = mkdtempSync(join(tmpdir(), "patina-runtime-control-"));
assertIsolatedTempPath(root, "patina-runtime-control-");
const control = join(root, "cancel");
let job: Awaited<ReturnType<typeof createRuntimeJob>> | null = null;
let cancelledAt: number | null = null;
const failures: unknown[] = [];
const cancel = () => { cancelledAt ??= Date.now(); writeFileSync(control, "cancel", "utf8"); };
process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
try {
  job = await createRuntimeJob({ ...process.env, PATINA_RUNTIME_CANCEL: control }, text => process.stdout.write(text));
  if (!options.prepareOnly) await job.claimDesktop();
  // This outer job also owns probes, helper commands and nested app jobs. A
  // worker crash cannot leave one of those descendants on the user's desktop.
  const pid = await job.start(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./tauriRuntimeRunner.ts", import.meta.url)), ...process.argv.slice(2)]);
  const result = await waitFor("supervised runtime completion", async () => {
    if(cancelledAt !== null && Date.now() - cancelledAt > 15_000) throw new Error("Runtime cancellation cleanup exceeded 15 seconds");
    const code = await job.exitCode(pid);
    return code === -1 ? null : { code };
  }, 2_700_000);
  assert.equal(cancelledAt, null, "Runtime was cancelled");
  assert.equal(result.code, 0, `Runtime worker failed with exit code ${result.code}`);
} catch (error) { failures.push(error); }
finally {
  process.off("SIGINT", cancel); process.off("SIGTERM", cancel);
  try { await job?.close(); } catch (error) { failures.push(error); }
  try {
    assertIsolatedTempPath(root, "patina-runtime-control-");
    rmSync(root, { recursive: true, force: true });
  } catch (error) { failures.push(error); }
}
if (failures.length === 1) throw failures[0];
if (failures.length) throw new AggregateError(failures, "Runtime and supervisor cleanup failed");
