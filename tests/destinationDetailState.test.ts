import assert from "node:assert/strict";
import {
  encodeDestinationDetailDayRequestKey,
  getAdjacentDestinationDetailDateKey,
  resolveDestinationDetailInitialDateKey,
} from "../src/features/destination/services/destinationDetailState.ts";
import { createDestinationDetailTarget } from "../src/features/destination/types.ts";

let passed = 0;
function runTest(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const nowMs = new Date(2026, 4, 20, 12, 0, 0).getTime();

runTest("detail targets normalize identity without depending on a source page", () => {
  const target = createDestinationDetailTarget({
    mode: "app",
    key: "ChatGPT.exe",
    identityKeys: [" ChatGPT.exe ", "OPENAI.exe", "chatgpt.exe"],
    displayName: " ChatGPT ",
    secondaryText: " ChatGPT.exe ",
    iconUrl: null,
    color: "#112233",
  });
  assert.equal(target.key, "chatgpt.exe");
  assert.deepEqual(target.identityKeys, ["chatgpt.exe", "openai.exe"]);
  assert.equal(target.displayName, "ChatGPT");
});

runTest("initial dates accept history and clamp future input to today", () => {
  assert.equal(resolveDestinationDetailInitialDateKey("2026-05-18", nowMs), "2026-05-18");
  assert.equal(resolveDestinationDetailInitialDateKey("2026-05-21", nowMs), "2026-05-20");
});

runTest("day navigation can move through history but never into the future", () => {
  assert.equal(getAdjacentDestinationDetailDateKey("2026-05-14", -1, nowMs), "2026-05-13");
  assert.equal(getAdjacentDestinationDetailDateKey("2026-05-14", 1, nowMs), "2026-05-15");
  assert.equal(getAdjacentDestinationDetailDateKey("2026-05-20", 1, nowMs), null);
});

runTest("day request keys remain explicit", () => {
  const target = createDestinationDetailTarget({
    mode: "web",
    key: "example.com",
    identityKeys: ["example.com"],
    displayName: "Example",
    secondaryText: "example.com",
    iconUrl: null,
    color: "#112233",
  });
  assert.equal(
    encodeDestinationDetailDayRequestKey(target, "2026-05-20", "2:3"),
    "web:example.com:2026-05-20:2:3",
  );
});

console.log(`Passed ${passed} destination detail state tests`);
