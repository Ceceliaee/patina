import assert from "node:assert/strict";
import { parseMiniSnapshot } from "../src/platform/desktop/miniWindowRuntimeGateway.ts";

const visual = { width: 304, height: 240, anchor: 0.5 };
const raw = { epoch: 2, revision: 17, expanded: true, suppressed: false, edge: "left", held: false, failed: false, focus_request: 3,
  transition_id: 7, transitioning: true, visual };
assert.deepEqual(parseMiniSnapshot(raw), { epoch: 2, revision: 17, expanded: true, suppressed: false, edge: "left", held: false, failed: false, focusRequest: 3,
  transitionId: 7, transitioning: true, visual });
for (const bad of [null, [], { ...raw, edge: "bottom" }, { ...raw, epoch: -1 }, { ...raw, revision: Number.NaN },
  { ...raw, focus_request: Number.MAX_SAFE_INTEGER + 1 }, { ...raw, expanded: "true" }, { ...raw, held: undefined }, { ...raw, failed: 1 },
  { ...raw, transition_id: -1 }, { ...raw, transitioning: undefined }, { ...raw, visual: null },
  { ...raw, visual: { ...visual, anchor: 1.1 } }, { ...raw, visual: { ...visual, width: 0 } }, { ...raw, visual: { ...visual, height: Infinity } }]) {
  assert.throws(() => parseMiniSnapshot(bad), /Invalid mini window state/);
}
assert.equal(parseMiniSnapshot({ ...raw, edge: null, suppressed: true }).suppressed, true);
console.log("PASS mini IPC parser rejects malformed state and maps the native focus field");
