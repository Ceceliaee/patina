import assert from "node:assert/strict";
import test from "node:test";
import { LONG_BACKGROUND_DELAY_MS } from "../src/app/services/backgroundReturnHomePolicy.ts";

test("page caches are released after 30 seconds in the background", () => {
  assert.equal(LONG_BACKGROUND_DELAY_MS, 30_000);
});
