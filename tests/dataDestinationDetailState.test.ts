import assert from "node:assert/strict";
import {
  buildDataDestinationDetailTarget,
  createDataDestinationDetailSelectionSnapshot,
  encodeDataDestinationDetailDayRequestKey,
  getAdjacentDataDestinationFocusedDateKey,
  resolveDataDestinationFocusedDateKey,
  selectDataDestinationDetailSnapshotTarget,
} from "../src/features/data/services/dataDestinationDetailState.ts";
import { resolveDataTrendRange } from "../src/features/data/services/dataTrendRange.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const nowMs = new Date(2026, 4, 20, 12, 0, 0).getTime();
const rollingRange = resolveDataTrendRange({ kind: "rolling", days: 7 }, nowMs);

await runTest("detail targets normalize web identity and preserve merged app identities", () => {
  const appTarget = buildDataDestinationDetailTarget("app", {
    key: "ChatGPT.exe",
    identityKeys: [" ChatGPT.exe ", "OPENAI.exe", "chatgpt.exe"],
    displayName: " ChatGPT ",
    secondaryText: " ChatGPT.exe ",
    iconUrl: null,
    totalDuration: 1,
    percentage: 1,
    averageDuration: 1,
    activeDayCount: 1,
  }, "#112233");
  const webTarget = buildDataDestinationDetailTarget("web", {
    key: " GitHub.COM ",
    identityKeys: [],
    displayName: "GitHub",
    secondaryText: "github.com",
    iconUrl: null,
    totalDuration: 1,
    percentage: 1,
    averageDuration: 1,
    activeDayCount: 1,
  }, "#445566");

  assert.deepEqual(appTarget.identityKeys, ["chatgpt.exe", "openai.exe"]);
  assert.equal(appTarget.displayName, "ChatGPT");
  assert.equal(webTarget.key, "github.com");
  assert.deepEqual(webTarget.identityKeys, ["github.com"]);
});

await runTest("opening snapshots copy selection order and clamp scroll position", () => {
  const appKeys = ["a", "b"];
  const snapshot = createDataDestinationDetailSelectionSnapshot({
    appKeys,
    webKeys: ["one.example", "two.example"],
    mode: "web",
    listScrollTop: -10,
  });
  appKeys.push("mutated");

  assert.deepEqual(snapshot, {
    appKeys: ["a", "b"],
    webKeys: ["one.example", "two.example"],
    mode: "web",
    listScrollTop: 0,
  });
});

await runTest("double-click snapshots select the detail target without losing the other mode", () => {
  const snapshot = createDataDestinationDetailSelectionSnapshot({
    appKeys: ["patina.exe"],
    webKeys: ["github.com", "chatgpt.com"],
    mode: "app",
    listScrollTop: 40,
  });

  assert.deepEqual(
    selectDataDestinationDetailSnapshotTarget(snapshot, "app", "chatgpt.exe"),
    {
      appKeys: ["chatgpt.exe"],
      webKeys: ["github.com", "chatgpt.com"],
      mode: "app",
      listScrollTop: 40,
    },
  );
  assert.deepEqual(snapshot.appKeys, ["patina.exe"]);
});

await runTest("focused dates preserve an existing historical date then use the initial trend range", () => {
  assert.equal(resolveDataDestinationFocusedDateKey({
    activeDateKeys: ["2026-05-16", "2026-05-19"],
    previousDateKey: "2026-05-18",
    range: rollingRange,
    nowMs,
  }), "2026-05-18");
  assert.equal(resolveDataDestinationFocusedDateKey({
    activeDateKeys: ["2026-05-01", "2026-05-16", "2026-05-19", "2026-05-21"],
    previousDateKey: "2026-05-01",
    range: rollingRange,
    nowMs,
  }), "2026-05-01");
  assert.equal(resolveDataDestinationFocusedDateKey({
    activeDateKeys: [],
    previousDateKey: null,
    range: rollingRange,
    nowMs,
  }), "2026-05-20");
});

await runTest("day navigation can leave the initial trend range but never enters the future", () => {
  assert.equal(
    getAdjacentDataDestinationFocusedDateKey("2026-05-14", -1, nowMs),
    "2026-05-13",
  );
  assert.equal(
    getAdjacentDataDestinationFocusedDateKey("2026-05-14", 1, nowMs),
    "2026-05-15",
  );
  assert.equal(
    getAdjacentDataDestinationFocusedDateKey("2026-05-20", 1, nowMs),
    null,
  );
});

await runTest("day request keys remain explicit", () => {
  const target = buildDataDestinationDetailTarget("web", {
    key: "example.com",
    identityKeys: ["example.com"],
    displayName: "Example",
    secondaryText: "example.com",
    iconUrl: null,
    totalDuration: 0,
    percentage: 0,
    averageDuration: 0,
    activeDayCount: 0,
  }, "#112233");
  assert.equal(
    encodeDataDestinationDetailDayRequestKey(target, "2026-05-20", "2:3"),
    "web:example.com:2026-05-20:2:3",
  );
});

console.log(`Passed ${passed} data destination detail state tests`);
