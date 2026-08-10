import assert from "node:assert/strict";
import test from "node:test";
import { LONG_BACKGROUND_DELAY_MS } from "../src/app/services/backgroundReturnHomePolicy.ts";

test("background delay is only the cache release budget", () => {
  assert.equal(LONG_BACKGROUND_DELAY_MS, 3 * 60 * 1000);
});
