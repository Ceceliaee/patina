import assert from "node:assert/strict";
import {
  loadDataDestinationDetailDay,
} from "../src/features/data/services/dataDestinationDetailReadModel.ts";
import type {
  DataDestinationDetailTarget,
} from "../src/features/data/services/dataDestinationDetailState.ts";
import type { HistorySession } from "../src/shared/types/sessions.ts";
import type { WebActivitySegment } from "../src/shared/types/webActivity.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function at(hour: number, minute = 0, day = 20) {
  return new Date(2026, 4, day, hour, minute, 0).getTime();
}

function appTarget(identityKeys = ["chatgpt.exe"]): DataDestinationDetailTarget {
  return {
    mode: "app",
    key: "chatgpt.exe",
    identityKeys,
    displayName: "ChatGPT",
    secondaryText: "ChatGPT.exe",
    iconUrl: null,
    color: "#112233",
  };
}

function webTarget(): DataDestinationDetailTarget {
  return {
    mode: "web",
    key: "github.com",
    identityKeys: ["github.com"],
    displayName: "GitHub",
    secondaryText: "github.com",
    iconUrl: null,
    color: "#112233",
  };
}

function makeSession(overrides: Partial<HistorySession>): HistorySession {
  return {
    id: 1,
    appName: "ChatGPT",
    exeName: "ChatGPT.exe",
    windowTitle: "",
    startTime: at(9),
    endTime: at(10),
    duration: 3_600_000,
    continuityGroupStartTime: null,
    titleSampleDetails: [],
    ...overrides,
  };
}

function makeWebSegment(overrides: Partial<WebActivitySegment>): WebActivitySegment {
  return {
    id: 1,
    browserClientId: "browser",
    browserKind: "chromium",
    browserExeName: "chrome.exe",
    domain: "github.com",
    normalizedDomain: "github.com",
    url: "https://github.com/example",
    title: "Repository",
    faviconUrl: null,
    startTime: at(9),
    endTime: at(10),
    duration: 3_600_000,
    ...overrides,
  };
}

await runTest("app detail uses canonical source identities and exact title samples", async () => {
  const sessions = [
    makeSession({
      id: 1,
      exeName: "ChatGPT.exe",
      startTime: at(8, 30),
      endTime: at(10),
      titleSampleDetails: [
        { title: "  Draft  ", startTime: at(8, 30), endTime: at(9) },
        { title: "Draft", startTime: at(9), endTime: at(9, 30) },
        { title: "Review", startTime: at(9, 20), endTime: at(10) },
      ],
    }),
    makeSession({
      id: 2,
      appName: "Other",
      exeName: "other.exe",
      startTime: at(11),
      endTime: at(12),
      windowTitle: "Must not appear",
    }),
  ];
  const day = await loadDataDestinationDetailDay(
    appTarget(["CHATGPT.EXE", "legacy-chatgpt.exe"]),
    "2026-05-20",
    at(12),
    180,
    {
      getAppSessions: async () => sessions,
      getWebSegments: async () => [],
    },
  );

  assert.deepEqual(day.records.map((record) => ({
    title: record.title,
    startTime: record.startTime,
    endTime: record.endTime,
    duration: record.duration,
  })), [
    {
      title: "Draft",
      startTime: at(8, 30),
      endTime: at(9, 30),
      duration: 3_600_000,
    },
    {
      title: "Review",
      startTime: at(9, 30),
      endTime: at(10),
      duration: 1_800_000,
    },
  ]);
  assert.equal(day.totalDuration, 5_400_000);
  assert.equal(day.activities.length, 1);
  assert.equal(day.activities[0]?.activityCount, 1);
  assert.equal(day.activities[0]?.duration, 5_400_000);
  assert.deepEqual(
    day.activities[0]?.records.map((record) => record.title),
    ["Draft", "Review"],
  );
  assert.equal(day.records[0]?.startRatio, (8.5 * 60) / (24 * 60));
  assert.equal(day.records[1]?.endRatio, 10 / 24);
});

await runTest("app detail groups title fragments by persisted continuity", async () => {
  const continuityGroupStartTime = at(9);
  const day = await loadDataDestinationDetailDay(
    appTarget(),
    "2026-05-20",
    at(12),
    180,
    {
      getAppSessions: async () => [
        makeSession({
          id: 1,
          startTime: at(9),
          endTime: at(9, 10),
          continuityGroupStartTime,
          windowTitle: "First",
        }),
        makeSession({
          id: 2,
          startTime: at(9, 15),
          endTime: at(9, 20),
          continuityGroupStartTime,
          windowTitle: "Second",
        }),
      ],
      getWebSegments: async () => [],
    },
  );

  assert.equal(day.activities.length, 1);
  assert.equal(day.activities[0]?.activityCount, 2);
  assert.deepEqual(day.activities[0] && {
    startTime: day.activities[0].startTime,
    endTime: day.activities[0].endTime,
    duration: day.activities[0].duration,
    titles: day.activities[0].records.map((record) => record.title),
  }, {
    startTime: at(9),
    endTime: at(9, 20),
    duration: 15 * 60_000,
    titles: ["First", "Second"],
  });
});

await runTest("app detail clips cross-day and current sessions to the visible day", async () => {
  const sessions = [
    makeSession({
      id: 1,
      startTime: at(23, 30, 19),
      endTime: at(0, 30),
      windowTitle: "Cross-day",
    }),
    makeSession({
      id: 2,
      startTime: at(11),
      endTime: null,
      duration: null,
      windowTitle: "Current",
    }),
  ];
  const day = await loadDataDestinationDetailDay(
    appTarget(),
    "2026-05-20",
    at(12),
    180,
    {
      getAppSessions: async () => sessions,
      getWebSegments: async () => [],
    },
  );

  assert.deepEqual(day.records.map((record) => [
    record.title,
    record.startTime,
    record.endTime,
    record.current,
  ]), [
    ["Cross-day", at(0), at(0, 30), false],
    ["Current", at(11), at(12), true],
  ]);
  assert.equal(day.activities.length, 2);
  assert.equal(day.totalDuration, 5_400_000);
});

await runTest("app detail keeps uncovered title-sample time as an explicit record", async () => {
  const day = await loadDataDestinationDetailDay(
    appTarget(),
    "2026-05-20",
    at(12),
    180,
    {
      getAppSessions: async () => [
        makeSession({
          id: 1,
          startTime: at(9),
          endTime: at(10),
          windowTitle: " ",
          titleSampleDetails: [
            { title: "Known title", startTime: at(9, 15), endTime: at(9, 45) },
          ],
        }),
      ],
      getWebSegments: async () => [],
    },
  );

  assert.deepEqual(day.records.map((record) => [
    record.title,
    record.startTime,
    record.endTime,
  ]), [
    [null, at(9), at(9, 15)],
    ["Known title", at(9, 15), at(9, 45)],
    [null, at(9, 45), at(10)],
  ]);
  assert.equal(day.activities.length, 1);
  assert.equal(day.activities[0]?.records.length, 3);
  assert.equal(day.totalDuration, 3_600_000);
});

await runTest("web detail normalizes domains, keeps URL separate, and preserves missing titles", async () => {
  const segments = [
    makeWebSegment({
      id: 1,
      normalizedDomain: " GitHub.COM ",
      startTime: at(9),
      endTime: at(9, 30),
      title: " ",
      url: "https://github.com/example",
    }),
    makeWebSegment({
      id: 2,
      normalizedDomain: "other.example",
      startTime: at(10),
      endTime: at(11),
      title: "Wrong domain",
    }),
  ];
  let requestedRange: [number, number] | null = null;
  const day = await loadDataDestinationDetailDay(
    webTarget(),
    "2026-05-20",
    at(12),
    180,
    {
      getAppSessions: async () => [],
      getWebSegments: async (startMs, endMs) => {
        requestedRange = [startMs, endMs];
        return segments;
      },
    },
  );

  assert.deepEqual(requestedRange, [at(0), at(12)]);
  assert.equal(day.records.length, 1);
  assert.equal(day.records[0]?.title, null);
  assert.equal(day.records[0]?.secondaryText, "https://github.com/example");
  assert.equal(day.records[0]?.url, "https://github.com/example");
  assert.equal(day.activities.length, 1);
  assert.equal(day.activities[0]?.records.length, 1);
  assert.equal(day.totalDuration, 1_800_000);
});

await runTest("web detail merges same-domain fragments before minimum-duration filtering", async () => {
  const day = await loadDataDestinationDetailDay(
    webTarget(),
    "2026-05-20",
    at(12),
    180,
    {
      getAppSessions: async () => [],
      getWebSegments: async () => [
        makeWebSegment({
          id: 1,
          startTime: at(9),
          endTime: at(9, 0) + 20_000,
          duration: 20_000,
          title: "Issue list",
          url: "https://github.com/issues",
        }),
        makeWebSegment({
          id: 2,
          startTime: at(9, 1),
          endTime: at(9, 1) + 45_000,
          duration: 45_000,
          title: "Pull request",
          url: "https://github.com/pulls/1",
        }),
      ],
    },
  );

  assert.equal(day.activities.length, 1);
  assert.equal(day.activities[0]?.duration, 65_000);
  assert.equal(day.activities[0]?.records.length, 2);
  assert.equal(day.activities[0]?.records[0]?.activityId, day.activities[0]?.id);
  assert.equal(day.activities[0]?.records[1]?.activityId, day.activities[0]?.id);
  assert.deepEqual(
    day.activities[0]?.records.map((record) => record.title),
    ["Issue list", "Pull request"],
  );
});

await runTest("web detail keeps same-domain fragments separate when another domain interrupts them", async () => {
  const day = await loadDataDestinationDetailDay(
    webTarget(),
    "2026-05-20",
    at(12),
    180,
    {
      getAppSessions: async () => [],
      getWebSegments: async () => [
        makeWebSegment({
          id: 1,
          startTime: at(9),
          endTime: at(9, 1),
        }),
        makeWebSegment({
          id: 2,
          normalizedDomain: "other.example",
          domain: "other.example",
          startTime: at(9, 1),
          endTime: at(9, 2),
        }),
        makeWebSegment({
          id: 3,
          startTime: at(9, 2),
          endTime: at(9, 3),
        }),
      ],
    },
  );

  assert.equal(day.activities.length, 2);
  assert.deepEqual(
    day.activities.map((activity) => activity.duration),
    [60_000, 60_000],
  );
});

await runTest("invalid detail dates fail before either repository is queried", async () => {
  let calls = 0;
  await assert.rejects(
    loadDataDestinationDetailDay(webTarget(), "not-a-date", at(12), 180, {
      getAppSessions: async () => {
        calls += 1;
        return [];
      },
      getWebSegments: async () => {
        calls += 1;
        return [];
      },
    }),
    /Invalid local date key/,
  );
  assert.equal(calls, 0);
});

console.log(`Passed ${passed} data destination detail read-model tests`);
