import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LONG_BACKGROUND_DELAY_MS } from "../src/app/services/backgroundReturnHomePolicy.ts";

let passed = 0;

function runTest(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function readUtf8(path: string) {
  return readFileSync(path, "utf8");
}

runTest("background delay is only the cache release budget", () => {
  assert.equal(LONG_BACKGROUND_DELAY_MS, 5 * 60 * 1000);
});

runTest("long background return does not reset navigation", () => {
  const navigation = readUtf8("src/app/hooks/useAppShellNavigation.ts");
  const policy = readUtf8("src/app/services/backgroundReturnHomePolicy.ts");

  assert.match(navigation, /shouldReturnHomeAfterBackground/);
  assert.match(navigation, /setCurrentView\("dashboard"\)/);
  assert.match(policy, /shouldReturnHomeAfterBackground/);
});

console.log(`Passed ${passed} background persistence policy tests`);
