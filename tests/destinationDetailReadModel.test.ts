import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getDestinationDetailTitleRecords,
  loadDestinationDetailDay,
} from "../src/features/destination/services/destinationDetailReadModel.ts";
import type {
  DestinationDetailTarget,
} from "../src/features/destination/types.ts";
import type { HistorySession } from "../src/shared/types/sessions.ts";
import type { WebActivitySegment } from "../src/shared/types/webActivity.ts";
import { buildWebDomainDistribution, buildWebTimelineItems } from "../src/features/history/services/historyWebActivityViewModel.ts";
import { buildTimelineSessions, compileSessions } from "../src/shared/lib/sessionReadCompiler.ts";
import { clipDestinationDetailActivitiesToViewport } from "../src/features/destination/services/destinationDetailTimelineViewport.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function at(hour: number, minute = 0, day = 20) {
  return new Date(2026, 4, day, hour, minute, 0).getTime();
}

function appTarget(identityKeys = ["chatgpt.exe"]): DestinationDetailTarget {
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

function webTarget(): DestinationDetailTarget {
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
  const day = await loadDestinationDetailDay(
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

await runTest("app detail uses the History threshold when no other app intervenes", async () => {
  const continuityGroupStartTime = at(9);
  const day = await loadDestinationDetailDay(
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
          startTime: at(9, 12),
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
    duration: 18 * 60_000,
    titles: ["First", "Second"],
  });
});

await runTest("app detail matches History when a short application switch separates two rows", async () => {
  const day = await loadDestinationDetailDay(
    appTarget(),
    "2026-05-20",
    at(12),
    180,
    {
      getAppSessions: async () => [
        makeSession({ id: 1, startTime: at(9), endTime: at(9, 2), windowTitle: "First" }),
        makeSession({
          id: 2,
          appName: "Other",
          exeName: "other.exe",
          startTime: at(9, 2),
          endTime: at(9, 3),
          windowTitle: "Interruption",
        }),
        makeSession({ id: 3, startTime: at(9, 3), endTime: at(9, 5), windowTitle: "Second" }),
      ],
      getWebSegments: async () => [],
    },
  );

  assert.equal(day.activities.length, 1);
  assert.deepEqual(day.activities.map((activity) => ({
    startTime: activity.startTime,
    endTime: activity.endTime,
    duration: activity.duration,
    activityCount: activity.activityCount,
  })), [
    { startTime: at(9), endTime: at(9, 5), duration: 4 * 60_000, activityCount: 2 },
  ]);
});

await runTest("app detail reuses the History title-row compiler across same-app fragments", async () => {
  const day = await loadDestinationDetailDay(
    appTarget(),
    "2026-05-20",
    at(12),
    180,
    {
      getAppSessions: async () => [
        makeSession({ id: 1, startTime: at(9), endTime: at(9, 2), windowTitle: "Editor" }),
        makeSession({ id: 2, startTime: at(9, 3), endTime: at(9, 5), windowTitle: "Editor" }),
      ],
      getWebSegments: async () => [],
    },
  );

  assert.equal(day.activities.length, 1);
  assert.equal(day.activities[0]?.activityCount, 2);
  assert.deepEqual(
    day.activities[0]?.detailRecords?.map((record) => record.title),
    ["Editor"],
  );
  assert.equal(day.activities[0]?.duration, 4 * 60_000);
});

await runTest("app detail does not count the application name as a window title", async () => {
  const day = await loadDestinationDetailDay(
    appTarget(),
    "2026-05-20",
    at(12),
    180,
    {
      getAppSessions: async () => [makeSession({
        id: 1,
        startTime: at(9),
        endTime: at(9, 5),
        windowTitle: "ChatGPT",
      })],
      getWebSegments: async () => [],
    },
  );

  assert.equal(day.activities[0]?.records[0]?.title, null);
  assert.deepEqual(day.activities[0]?.detailRecords, []);
  assert.deepEqual(
    day.activities[0] ? getDestinationDetailTitleRecords(day.activities[0]) : null,
    [],
  );
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
  const day = await loadDestinationDetailDay(
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

await runTest("app detail uses the shared stale-tracker cutoff for live sessions", async () => {
  const lastHeartbeatMs = at(11, 30);
  const day = await loadDestinationDetailDay(
    appTarget(),
    "2026-05-20",
    at(12),
    180,
    {
      getAppSessions: async () => [makeSession({
        id: 1,
        startTime: at(11),
        endTime: null,
        duration: null,
        windowTitle: "Current",
      })],
      getWebSegments: async () => [],
    },
    "stale",
    lastHeartbeatMs,
  );

  assert.equal(day.activities[0]?.endTime, lastHeartbeatMs);
  assert.equal(day.activities[0]?.duration, 30 * 60_000);
});

await runTest("app detail keeps uncovered title-sample time as an explicit record", async () => {
  const day = await loadDestinationDetailDay(
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
  const day = await loadDestinationDetailDay(
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
  const day = await loadDestinationDetailDay(
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

await runTest("web detail groups its own fragments across a short domain interruption", async () => {
  const day = await loadDestinationDetailDay(
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

  assert.equal(day.activities.length, 1);
  assert.deepEqual(day.activities.map((activity) => activity.duration), [120_000]);
});

await runTest("invalid detail dates fail before either repository is queried", async () => {
  let calls = 0;
  await assert.rejects(
    loadDestinationDetailDay(webTarget(), "not-a-date", at(12), 180, {
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

await runTest("web views conserve source-scoped intervals through gaps, overlaps and switches", async () => {
  const start = at(9);
  const fixtures = [
    { rows: [[0, 60000], [60800, 120800]], expected: 120000 },
    { rows: [[0, 600000], [300000, 900000]], expected: 900000 },
    { rows: [[0, 60000], [0, 60000], [10000, 20000]], expected: 60000 },
    { rows: [[0, 60000], [60000, 120000], [120000, 120000]], expected: 120000 },
  ];
  for (const { rows, expected } of fixtures) {
    const input = rows.map(([a, b], index) => makeWebSegment({ id: index + 1, startTime: start + a, endTime: start + b }));
    for (const segments of [input, [...input].reverse()]) {
      for (const gap of [0, 60, 600]) {
        const day = await loadDestinationDetailDay(webTarget(), "2026-05-20", at(12), gap, {
          getAppSessions: async () => [], getWebSegments: async () => segments,
        });
        const range = { startMs: at(0), endMs: at(12) };
        assert.equal(day.totalDuration, expected);
        assert.equal(buildWebDomainDistribution(segments, range, at(12))[0]?.duration, expected);
        assert.equal(buildWebTimelineItems(segments, range, at(12), {}, {}, gap, 0)
          .reduce((sum, row) => sum + row.duration, 0), expected);
      }
    }
  }
  const segments = [makeWebSegment({ id: 1, startTime: start, endTime: start + 60000 }),
    makeWebSegment({ id: 2, browserClientId: "independent", startTime: start, endTime: start + 60000 })];
  const day = await loadDestinationDetailDay(webTarget(), "2026-05-20", at(12), 60, {
    getAppSessions: async () => [], getWebSegments: async () => segments,
  });
  assert.equal(day.totalDuration, 120000, "independent browser sources remain additive");
});

await runTest("application merging preserves the intervening app and title gap", async () => {
  const start = at(9);
  const sessions = [
    makeSession({ id: 1, startTime: start, endTime: start + 60000, windowTitle: "Editor" }),
    makeSession({ id: 2, exeName: "chrome.exe", appName: "Chrome", startTime: start + 60000, endTime: start + 80000 }),
    makeSession({ id: 3, startTime: start + 80000, endTime: start + 200000, windowTitle: "Editor" }),
  ];
  const compiled = compileSessions(sessions, { startMs: at(0), endMs: at(12), minSessionSecs: 0 });
  const timeline = buildTimelineSessions(compiled, 60);
  assert.equal(timeline.reduce((sum, row) => sum + (row.duration ?? 0), 0), 200000);
  assert.equal(timeline.find(row => row.appKey === "chrome.exe")?.duration, 20000);
  const day = await loadDestinationDetailDay(appTarget(), "2026-05-20", at(12), 60, {
    getAppSessions: async () => sessions, getWebSegments: async () => [],
  });
  assert.equal(day.totalDuration, 180000);
  assert.equal(getDestinationDetailTitleRecords(day.activities[0]).reduce((sum, row) => sum + row.duration, 0), 180000);
  assert.deepEqual(clipDestinationDetailActivitiesToViewport(day.activities, {
    startMs: start + 60000, endMs: start + 80000, durationMs: 20000,
  }), []);
});

await runTest("group boundaries, clipping and minimum filters conserve web facts", async () => {
  const start = at(9);
  for (const gap of [59999, 60000, 60001]) {
    const segments = [0, 60000 + gap].map((offset, index) => makeWebSegment({
      id: index + 1, startTime: start + offset, endTime: start + offset + 60000,
    }));
    const day = await loadDestinationDetailDay(webTarget(), "2026-05-20", at(12), 60, {
      getAppSessions: async () => [], getWebSegments: async () => segments,
    });
    assert.equal(day.activities.length, gap <= 60000 ? 1 : 2);
    assert.equal(day.totalDuration, 120000);
    const viewport = { startMs: start + 30000, endMs: start + 60000 + gap + 30000, durationMs: gap + 60000 };
    assert.equal(clipDestinationDetailActivitiesToViewport(day.activities, viewport)
      .reduce((sum, row) => sum + row.duration, 0), 60000);
  }
  for (const durations of [[700000, 100000, 340000, 160000, 220000, 400000], [110000, 110000, 40000]]) {
    let cursor = start;
    const segments = durations.map((duration, index) => {
      const segment = makeWebSegment({ id: index + 1, startTime: cursor, endTime: cursor + duration });
      cursor += duration + 70000;
      return segment;
    });
    const range = { startMs: at(0), endMs: at(12) };
    const all = buildWebTimelineItems(segments, range, at(12), {}, {}, 60, 0);
    assert.equal(all.reduce((sum, row) => sum + row.duration, 0), durations.reduce((a, b) => a + b, 0));
    if (durations.length === 6) {
      assert.equal(all.reduce((sum, row) => sum + Math.floor(row.duration / 60000), 0), 28);
      assert.equal(buildWebDomainDistribution(segments, range, at(12))[0].duration, 1920000);
    } else {
      assert.equal(buildWebTimelineItems(segments, range, at(12), {}, {}, 60, 60)
        .reduce((sum, row) => sum + row.duration, 0), 220000);
    }
  }
});

await runTest("short web facts and midnight cuts remain exact in detail", async () => {
  for (const duration of [1000, 20000, 29999, 30000]) {
    const day = await loadDestinationDetailDay(webTarget(), "2026-05-20", at(12), 60, {
      getAppSessions: async () => [],
      getWebSegments: async () => [makeWebSegment({ startTime: at(9), endTime: at(9) + duration })],
    });
    assert.equal(clipDestinationDetailActivitiesToViewport(day.activities, {
      startMs: at(0), endMs: at(12), durationMs: at(12) - at(0),
    })[0].duration, duration);
  }
  const midnight = at(0, 0, 21);
  for (const dateKey of ["2026-05-20", "2026-05-21"]) {
    const day = await loadDestinationDetailDay(webTarget(), dateKey, at(12, 0, 21), 60, {
      getAppSessions: async () => [],
      getWebSegments: async () => [makeWebSegment({ startTime: midnight - 30000, endTime: midnight + 30000 })],
    });
    assert.equal(day.totalDuration, 30000);
  }
});

await runTest("detail and History consume the upstream timing facts without extending cutoffs", async () => {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/activity-timing-facts.json", import.meta.url), "utf8")) as Array<{
    web: Array<[number, number | null, number]>; now: number; expectedBuckets: number[];
  }>;
  for (const fixture of fixtures) {
    const offset = at(0);
    const segments = fixture.web.map(([start, end, updatedAt], index) => makeWebSegment({
      // Match the repository's already-materialized observation cutoff.
      id: index + 1, startTime: offset + start, endTime: offset + (end ?? Math.min(fixture.now, updatedAt + 45000)),
    }));
    const now = offset + fixture.now;
    const days = await Promise.all(["2026-05-20", "2026-05-21"].map(date =>
      loadDestinationDetailDay(webTarget(), date, now, 60, {
        getAppSessions: async () => [], getWebSegments: async () => segments,
      })));
    const expected = fixture.expectedBuckets.reduce((a, b) => a + b, 0);
    assert.equal(days.reduce((sum, day) => sum + day.totalDuration, 0), expected);
    assert.equal(buildWebDomainDistribution(segments, { startMs: offset, endMs: now }, now)
      .reduce((sum, row) => sum + row.duration, 0), expected);
  }
});

await runTest("long alternating chains retain every object and stop across a real gap", async () => {
  const start = at(9);
  const segments = Array.from({ length: 200 }, (_, index) => makeWebSegment({
    id: index + 1,
    normalizedDomain: index % 2 ? "other.example" : "github.com",
    startTime: start + index * 1000 + (index >= 100 ? 61000 : 0),
    endTime: start + (index + 1) * 1000 + (index >= 100 ? 61000 : 0),
  }));
  const list = buildWebTimelineItems(segments, { startMs: start, endMs: at(12) }, at(12), {}, {}, 60, 0);
  assert.equal(list.length, 4);
  assert.equal(list.reduce((sum, row) => sum + row.duration, 0), 200000);
  const day = await loadDestinationDetailDay(webTarget(), "2026-05-20", at(12), 60, {
    getAppSessions: async () => [], getWebSegments: async () => segments,
  });
  assert.equal(day.activities.length, 2);
  assert.equal(day.totalDuration, 100000);
});

await runTest("detail preserves explicit participation anchors without needing intervening apps", async () => {
  const start = at(9);
  const sessions = [
    makeSession({ id: 1, startTime: start, endTime: start + 60000, continuityGroupStartTime: start }),
    makeSession({ id: 2, exeName: "other.exe", startTime: start + 60000, endTime: start + 120000 }),
    makeSession({ id: 3, startTime: start + 120000, endTime: start + 180000, continuityGroupStartTime: start }),
  ];
  const day = await loadDestinationDetailDay(appTarget(), "2026-05-20", at(12), 10, {
    getAppSessions: async () => sessions, getWebSegments: async () => [],
  });
  assert.equal(day.activities.length, 1);
  assert.equal(day.totalDuration, 120000);
});

console.log(`Passed ${passed} data destination detail read-model tests`);
