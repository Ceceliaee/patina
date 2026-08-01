import assert from "node:assert/strict";
import {
  buildHistoryWebTimelineViewModel,
  buildWebDomainDistribution,
  buildWebTimelineItems,
  filterWebActivitySegmentsForStatistics,
} from "../src/features/history/services/historyWebActivityViewModel.ts";
import { normalizeHistoryTimelineViewport } from "../src/features/history/services/historyTimelineViewModel.ts";
import type { WebActivitySegment } from "../src/shared/types/webActivity.ts";

function makeSegment(overrides: Partial<WebActivitySegment>): WebActivitySegment {
  return {
    id: overrides.id ?? 1,
    browserClientId: "client",
    browserKind: "chrome",
    browserExeName: "chrome.exe",
    domain: overrides.domain ?? "github.com",
    normalizedDomain: overrides.normalizedDomain ?? "github.com",
    url: overrides.url ?? null,
    title: overrides.title ?? null,
    faviconUrl: overrides.faviconUrl ?? null,
    startTime: overrides.startTime ?? 1000,
    endTime: Object.hasOwn(overrides, "endTime") ? overrides.endTime! : 2000,
    duration: overrides.duration ?? 1000,
  };
}

let passed = 0;

function runTest(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function sumTitleDetailDurations(
  item: ReturnType<typeof buildWebTimelineItems>[number],
) {
  return item.titleSampleDetails.reduce((total, sample) => total + sample.duration, 0);
}

runTest("web domain distribution clips segments and applies domain overrides", () => {
  const items = buildWebDomainDistribution([
    makeSegment({
      id: 1,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Issue · Patina",
      startTime: 0,
      endTime: 10_000,
    }),
    makeSegment({
      id: 2,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Pull request",
      startTime: 15_000,
      endTime: 25_000,
    }),
    makeSegment({
      id: 3,
      domain: "example.com",
      normalizedDomain: "example.com",
      startTime: 18_000,
      endTime: 22_000,
    }),
  ], { startMs: 5_000, endMs: 20_000 }, 30_000, {
    "github.com": {
      displayName: "GitHub",
      category: "development",
      color: "#123456",
    },
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].key, "github.com");
  assert.equal(items[0].label, "GitHub");
  assert.equal(items[0].duration, 10_000);
  assert.equal(items[0].color, "#123456");
  assert.equal("title" in items[0], false);
  assert.equal(items[1].key, "example.com");
  assert.equal(items[1].duration, 2_000);
});

runTest("web graphical timeline groups real activity by domain with resolved identity", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewModel = buildHistoryWebTimelineViewModel({
    segments: [
      makeSegment({
        id: 1,
        domain: "github.com",
        normalizedDomain: "github.com",
        title: "Patina",
        startTime: dayStart + 9 * 60 * 60_000,
        endTime: dayStart + 9 * 60 * 60_000 + 2 * 60_000,
      }),
      makeSegment({
        id: 2,
        domain: "github.com",
        normalizedDomain: "github.com",
        title: "Pull request",
        startTime: dayStart + 9 * 60 * 60_000 + 2 * 60_000,
        endTime: dayStart + 9 * 60 * 60_000 + 4 * 60_000,
      }),
    ],
    selectedDate,
    nowMs: dayStart + 24 * 60 * 60_000,
    overrides: {
      "github.com": {
        displayName: "GitHub",
        color: "#123456",
        category: "development",
      },
    },
    mergeThresholdSecs: 0,
  });

  assert.equal(viewModel.segments.length, 1);
  assert.equal(viewModel.segments[0]?.sourceKind, "web");
  assert.equal(viewModel.segments[0]?.sourceKey, "github.com");
  assert.equal(viewModel.segments[0]?.label, "GitHub");
  assert.equal(viewModel.segments[0]?.color, "#123456");
  assert.deepEqual(viewModel.segments[0]?.iconKeys, ["github.com"]);
  assert.deepEqual(viewModel.legendItems.map((item) => item.label), ["GitHub"]);
  assert.equal(viewModel.legendItems[0]?.color, "#123456");
  assert.deepEqual(viewModel.lanes.map((lane) => lane.label), ["GitHub"]);
  assert.deepEqual(viewModel.lanes[0]?.iconKeys, ["github.com"]);
});

runTest("web graphical timeline resolves dominant-minute ties deterministically", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const minute = 60_000;
  const at = (minuteOffset: number, secondOffset: number) => (
    dayStart + (9 * 60 + minuteOffset) * minute + secondOffset * 1000
  );
  const segments = [
    makeSegment({
      id: 1,
      domain: "long.example",
      normalizedDomain: "long.example",
      startTime: at(0, 0),
      endTime: at(0, 40),
    }),
    makeSegment({
      id: 2,
      domain: "short.example",
      normalizedDomain: "short.example",
      startTime: at(0, 40),
      endTime: at(1, 0),
    }),
    makeSegment({
      id: 3,
      domain: "early.example",
      normalizedDomain: "early.example",
      startTime: at(2, 0),
      endTime: at(2, 30),
    }),
    makeSegment({
      id: 4,
      domain: "a-late.example",
      normalizedDomain: "a-late.example",
      startTime: at(2, 30),
      endTime: at(3, 0),
    }),
    makeSegment({
      id: 5,
      domain: "beta.example",
      normalizedDomain: "beta.example",
      startTime: at(4, 0),
      endTime: at(4, 30),
    }),
    makeSegment({
      id: 6,
      domain: "alpha.example",
      normalizedDomain: "alpha.example",
      startTime: at(4, 0),
      endTime: at(4, 30),
    }),
  ];

  const viewModel = buildHistoryWebTimelineViewModel({
    segments,
    selectedDate,
    nowMs: dayStart + 24 * 60 * minute,
  });

  assert.deepEqual(
    viewModel.segments.map((segment) => segment.sourceKey),
    ["long.example", "early.example", "alpha.example"],
  );
  assert.deepEqual(viewModel.segments.map((segment) => segment.alternateLabels), [
    ["short.example"],
    ["a-late.example"],
    ["beta.example"],
  ]);
});

runTest("web graphical timeline filters excluded domains and clips live activity to now", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const nowMs = dayStart + 10 * 60 * 60_000 + 3 * 60_000;
  const viewModel = buildHistoryWebTimelineViewModel({
    segments: [
      makeSegment({
        id: 1,
        normalizedDomain: "excluded.example",
        domain: "excluded.example",
        startTime: dayStart + 9 * 60 * 60_000,
        endTime: dayStart + 9 * 60 * 60_000 + 5 * 60_000,
      }),
      makeSegment({
        id: 2,
        normalizedDomain: "live.example",
        domain: "live.example",
        startTime: dayStart + 10 * 60 * 60_000,
        endTime: null,
        duration: null,
      }),
    ],
    selectedDate,
    nowMs,
    overrides: {
      "excluded.example": { enabled: false },
    },
  });

  assert.deepEqual(viewModel.legendItems.map((item) => item.key), ["live.example"]);
  assert.equal(viewModel.segments[0]?.endTime, nowMs);
  assert.equal(viewModel.segments[0]?.isLive, true);
});

runTest("web graphical timeline keeps the zoom viewport and visible lane duration", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewport = normalizeHistoryTimelineViewport({
    selectedDate,
    requestedStartMs: dayStart + 12 * 60 * 60_000,
    requestedDurationMs: 4 * 60 * 60_000,
  });
  const viewModel = buildHistoryWebTimelineViewModel({
    segments: [
      makeSegment({
        id: 1,
        normalizedDomain: "before.example",
        domain: "before.example",
        startTime: dayStart + 10 * 60 * 60_000,
        endTime: dayStart + 11 * 60 * 60_000,
      }),
      makeSegment({
        id: 2,
        normalizedDomain: "inside.example",
        domain: "inside.example",
        startTime: dayStart + 11 * 60 * 60_000 + 59 * 60_000,
        endTime: dayStart + 12 * 60 * 60_000 + 2 * 60_000,
      }),
    ],
    selectedDate,
    nowMs: dayStart + 24 * 60 * 60_000,
    viewport,
  });

  assert.equal(viewModel.viewportStartMs, viewport.startMs);
  assert.equal(viewModel.viewportEndMs, viewport.endMs);
  assert.deepEqual(viewModel.legendItems.map((item) => item.key), ["inside.example"]);
  assert.equal(viewModel.lanes[0]?.duration, 2 * 60_000);
});

runTest("excluded web domains are removed from the effective segment set", () => {
  const included = makeSegment({
    id: 1,
    domain: "github.com",
    normalizedDomain: "github.com",
  });
  const excluded = makeSegment({
    id: 2,
    domain: "private.example",
    normalizedDomain: "private.example",
  });

  const effective = filterWebActivitySegmentsForStatistics(
    [included, excluded],
    {
      "github.com": { enabled: true },
      "private.example": { enabled: false },
    },
  );

  assert.deepEqual(effective.map((segment) => segment.normalizedDomain), ["github.com"]);
  assert.equal(excluded.normalizedDomain, "private.example");
});

runTest("excluded web domains disappear from distribution and recompute percentages", () => {
  const segments = [
    makeSegment({
      id: 1,
      domain: "github.com",
      normalizedDomain: "github.com",
      startTime: 0,
      endTime: 10_000,
    }),
    makeSegment({
      id: 2,
      domain: "private.example",
      normalizedDomain: "private.example",
      startTime: 10_000,
      endTime: 30_000,
    }),
  ];

  const items = buildWebDomainDistribution(
    segments,
    { startMs: 0, endMs: 30_000 },
    30_000,
    { "private.example": { enabled: false } },
  );

  assert.deepEqual(items.map((item) => item.key), ["github.com"]);
  assert.equal(items[0]?.duration, 10_000);
  assert.equal(items[0]?.percentage, 100);
  assert.equal(segments.length, 2);
});

runTest("excluded web domains disappear from timeline and return after restore", () => {
  const segments = [
    makeSegment({
      id: 1,
      domain: "github.com",
      normalizedDomain: "github.com",
      startTime: 0,
      endTime: 10_000,
    }),
    makeSegment({
      id: 2,
      domain: "private.example",
      normalizedDomain: "private.example",
      startTime: 12_000,
      endTime: 20_000,
    }),
  ];

  const excludedItems = buildWebTimelineItems(
    segments,
    { startMs: 0, endMs: 20_000 },
    20_000,
    { "private.example": { enabled: false } },
  );
  const restoredItems = buildWebTimelineItems(
    segments,
    { startMs: 0, endMs: 20_000 },
    20_000,
    { "private.example": { enabled: true } },
  );

  assert.deepEqual(excludedItems.map((item) => item.normalizedDomain), ["github.com"]);
  assert.deepEqual(
    restoredItems.map((item) => item.normalizedDomain),
    ["private.example", "github.com"],
  );
});

runTest("web colors prefer favicon theme colors before category colors", () => {
  const segments = [
    makeSegment({
      id: 1,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Patina",
      startTime: 0,
      endTime: 10_000,
    }),
  ];
  const overrides = {
    "github.com": {
      category: "development" as const,
    },
  };
  const iconThemeColors = {
    "github.com": "#24292e",
  };

  const distributionItems = buildWebDomainDistribution(
    segments,
    { startMs: 0, endMs: 20_000 },
    20_000,
    overrides,
    iconThemeColors,
  );
  const timelineItems = buildWebTimelineItems(
    segments,
    { startMs: 0, endMs: 20_000 },
    20_000,
    overrides,
    iconThemeColors,
  );

  assert.equal(distributionItems[0].color, "#24292e");
  assert.equal(timelineItems[0].color, "#24292e");
});

runTest("web favicon view models prefer domain cache with segment fallback", () => {
  const segments = [
    makeSegment({
      id: 1,
      domain: "github.com",
      normalizedDomain: "github.com",
      faviconUrl: "https://segment.test/favicon.ico",
      startTime: 0,
      endTime: 10_000,
    }),
    makeSegment({
      id: 2,
      domain: "docs.rs",
      normalizedDomain: "docs.rs",
      faviconUrl: "https://docs.rs/favicon.ico",
      startTime: 12_000,
      endTime: 15_000,
    }),
  ];
  const faviconMap = {
    "github.com": "data:image/png;base64,github",
  };

  const distributionItems = buildWebDomainDistribution(
    segments,
    { startMs: 0, endMs: 20_000 },
    20_000,
    {},
    {},
    faviconMap,
  );
  const timelineItems = buildWebTimelineItems(
    segments,
    { startMs: 0, endMs: 20_000 },
    20_000,
    {},
    {},
    0,
    0,
    faviconMap,
  );

  assert.equal(distributionItems.find((item) => item.key === "github.com")?.faviconUrl, "data:image/png;base64,github");
  assert.equal(distributionItems.find((item) => item.key === "docs.rs")?.faviconUrl, "https://docs.rs/favicon.ico");
  assert.equal(timelineItems.find((item) => item.normalizedDomain === "github.com")?.faviconUrl, "data:image/png;base64,github");
  assert.equal(timelineItems.find((item) => item.normalizedDomain === "docs.rs")?.faviconUrl, "https://docs.rs/favicon.ico");
});

runTest("web timeline merges same-domain rows and folds matching titles within threshold", () => {
  const items = buildWebTimelineItems([
    makeSegment({
      id: 1,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Ceceliaee/patina",
      faviconUrl: "https://example.test/favicon.ico",
      startTime: 0,
      endTime: 5_000,
    }),
    makeSegment({
      id: 2,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Ceceliaee/patina",
      faviconUrl: "data:image/png;base64,abc",
      startTime: 7_000,
      endTime: 10_000,
    }),
  ], { startMs: 0, endMs: 20_000 }, 20_000, {}, {}, 5);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, "1_2");
  assert.equal(items[0].duration, 8_000);
  assert.equal(items[0].startTime, 0);
  assert.equal(items[0].endTime, 10_000);
  assert.equal(items[0].faviconUrl, "data:image/png;base64,abc");
  assert.equal(items[0].mergedCount, 2);
  assert.deepEqual(items[0].titleSamples, ["Ceceliaee/patina"]);
  assert.deepEqual(items[0].titleSampleDetails, [{
    title: "Ceceliaee/patina",
    startTime: 0,
    endTime: 10_000,
    duration: 8_000,
  }]);
});

runTest("web timeline treats domain like app and keeps page titles as details", () => {
  const items = buildWebTimelineItems([
    makeSegment({
      id: 1,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Issues · Patina",
      startTime: 0,
      endTime: 5_000,
    }),
    makeSegment({
      id: 2,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Pull requests · Patina",
      startTime: 7_000,
      endTime: 10_000,
    }),
  ], { startMs: 0, endMs: 20_000 }, 20_000, {}, {}, 5);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, "1_2");
  assert.equal(items[0].label, "github.com");
  assert.equal(items[0].mergedCount, 2);
  assert.deepEqual(items[0].titleSamples, ["Issues · Patina", "Pull requests · Patina"]);
  assert.deepEqual(items[0].titleSampleDetails, [
    {
      title: "Issues · Patina",
      startTime: 0,
      endTime: 5_000,
      duration: 5_000,
    },
    {
      title: "Pull requests · Patina",
      startTime: 7_000,
      endTime: 10_000,
      duration: 3_000,
    },
  ]);
  assert.equal(sumTitleDetailDurations(items[0]), items[0].duration);
});

runTest("web timeline filters short rows after domain merge like app timeline", () => {
  const shortItems = buildWebTimelineItems([
    makeSegment({
      id: 1,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Patina",
      startTime: 0,
      endTime: 5_000,
    }),
    makeSegment({
      id: 2,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Patina",
      startTime: 7_000,
      endTime: 10_000,
    }),
  ], { startMs: 0, endMs: 20_000 }, 20_000, {}, {}, 5, 9);
  const longItems = buildWebTimelineItems([
    makeSegment({
      id: 1,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Patina",
      startTime: 0,
      endTime: 5_000,
    }),
    makeSegment({
      id: 2,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Patina",
      startTime: 7_000,
      endTime: 10_000,
    }),
  ], { startMs: 0, endMs: 20_000 }, 20_000, {}, {}, 5, 8);

  assert.equal(shortItems.length, 0);
  assert.equal(longItems.length, 1);
  assert.equal(longItems[0].mergedCount, 2);
});

runTest("web timeline preserves domain switches between same-domain rows", () => {
  const items = buildWebTimelineItems([
    makeSegment({
      id: 1,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Issue",
      startTime: 0,
      endTime: 5_000,
    }),
    makeSegment({
      id: 2,
      domain: "docs.rs",
      normalizedDomain: "docs.rs",
      title: "Docs",
      startTime: 5_000,
      endTime: 7_000,
    }),
    makeSegment({
      id: 3,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Pull request",
      startTime: 7_000,
      endTime: 12_000,
    }),
  ], { startMs: 0, endMs: 20_000 }, 20_000, {}, {}, 60);

  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((item) => item.normalizedDomain),
    ["github.com", "docs.rs", "github.com"],
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ["3", "2", "1"],
  );
});

runTest("web timeline keeps untitled domain rows explainable without counting titles", () => {
  const items = buildWebTimelineItems([
    makeSegment({
      id: 1,
      domain: "example.com",
      normalizedDomain: "example.com",
      title: null,
      startTime: 0,
      endTime: 70_000,
    }),
  ], { startMs: 0, endMs: 80_000 }, 80_000, {}, {}, 5, 60);

  assert.equal(items.length, 1);
  assert.equal(items[0].label, "example.com");
  assert.equal(items[0].mergedCount, 1);
  assert.deepEqual(items[0].titleSamples, []);
  assert.deepEqual(items[0].titleSampleDetails, [{
    title: "",
    startTime: 0,
    endTime: 70_000,
    duration: 70_000,
    isUntitled: true,
  }]);
  assert.equal(sumTitleDetailDurations(items[0]), items[0].duration);
});

runTest("web timeline title details cover row duration when some segments are untitled", () => {
  const items = buildWebTimelineItems([
    makeSegment({
      id: 1,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Issue",
      startTime: 0,
      endTime: 60_000,
    }),
    makeSegment({
      id: 2,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: null,
      startTime: 60_000,
      endTime: 90_000,
    }),
    makeSegment({
      id: 3,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Pull request",
      startTime: 90_000,
      endTime: 150_000,
    }),
  ], { startMs: 0, endMs: 180_000 }, 180_000, {}, {}, 5, 0);

  assert.equal(items.length, 1);
  assert.equal(items[0].duration, 150_000);
  assert.deepEqual(items[0].titleSamples, ["Issue", "Pull request"]);
  assert.deepEqual(items[0].titleSampleDetails, [
    {
      title: "Issue",
      startTime: 0,
      endTime: 60_000,
      duration: 60_000,
    },
    {
      title: "",
      startTime: 60_000,
      endTime: 90_000,
      duration: 30_000,
      isUntitled: true,
    },
    {
      title: "Pull request",
      startTime: 90_000,
      endTime: 150_000,
      duration: 60_000,
    },
  ]);
  assert.equal(sumTitleDetailDurations(items[0]), items[0].duration);
});

runTest("web timeline keeps only in-range rows and sorts newest first", () => {
  const items = buildWebTimelineItems([
    makeSegment({
      id: 1,
      domain: "github.com",
      normalizedDomain: "github.com",
      title: "Old",
      startTime: 0,
      endTime: 10_000,
    }),
    makeSegment({
      id: 2,
      domain: "docs.rs",
      normalizedDomain: "docs.rs",
      title: "Docs",
      startTime: 12_000,
      endTime: null,
    }),
  ], { startMs: 5_000, endMs: 20_000 }, 18_000, {
    "docs.rs": {
      displayName: "Rust Docs",
      category: "development",
    },
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].id, "2");
  assert.equal(items[0].label, "Rust Docs");
  assert.equal(items[0].duration, 6_000);
  assert.equal(items[0].mergedCount, 1);
  assert.deepEqual(items[0].titleSamples, ["Docs"]);
  assert.deepEqual(items[0].titleSampleDetails, [{
    title: "Docs",
    startTime: 12_000,
    endTime: null,
    duration: 6_000,
  }]);
  assert.equal(items[1].id, "1");
  assert.equal(items[1].duration, 5_000);
  assert.deepEqual(items[1].titleSamples, ["Old"]);
});

console.log(`Passed ${passed} history web activity view model tests`);
