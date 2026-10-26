import assert from "node:assert/strict";
import { startMiniNativeProbe } from "./miniNativeProbe.ts";

// Both the competing window and the cursor movement belong to this test.
// Never use a user's application as the interference fixture.
export async function verifyInputEnvironmentControls(processId: number, signal: AbortSignal, ownCleanup: (cleanup: () => Promise<void>) => void) {
  const first = startMiniNativeProbe(processId, signal);
  ownCleanup(first.close);
  let competing: ReturnType<typeof startMiniNativeProbe> | null = null;
  try {
    const before = await first.request("focus");
    assert.equal(before.foreground, before.inputTarget);
    competing = startMiniNativeProbe(processId, signal);
    ownCleanup(competing.close);
    await competing.request("focus");
    await competing.request("move", before.cursor.X + 20, before.cursor.Y + 20);
    await assert.rejects(first.request("move", before.cursor.X, before.cursor.Y), /Input precondition changed/);
  } finally { await first.close(); await competing?.close(); }

  const cancellation = new AbortController();
  const probe = startMiniNativeProbe(processId, AbortSignal.any([signal, cancellation.signal]));
  ownCleanup(probe.close);
  try {
    const focused = await probe.request("focus");
    const held = await probe.request("down", focused.cursor.X, focused.cursor.Y);
    assert.equal(held.leftButtonDown, true);
    cancellation.abort();
    await probe.close();
    await assert.rejects(probe.request("move"), /closed or cancelled/);
  } finally { cancellation.abort(); await probe.close(); }
  const observation = startMiniNativeProbe(processId, signal);
  ownCleanup(observation.close);
  try { assert.equal((await observation.request("sample")).leftButtonDown, false, "cancellation must release the injected mouse button"); }
  finally { await observation.close(); }
  console.log("PASS owned input competition aborts injection and cancellation releases the mouse button");
}
