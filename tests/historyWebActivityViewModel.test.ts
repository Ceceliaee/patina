import assert from "node:assert/strict";
import {
  buildWebDomainDistribution,
  buildWebTimelineItems,
} from "../src/features/history/services/historyWebActivityViewModel.ts";
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

runTest("web timeline merges same-domain rows with matching visible titles within threshold", () => {
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
});

runTest("web timeline keeps same-domain rows split when visible titles differ", () => {
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

  assert.equal(items.length, 2);
  assert.equal(items[0].id, "2");
  assert.equal(items[1].id, "1");
});

runTest("web timeline filters short rows after title merge like app timeline", () => {
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
  assert.equal(items[1].id, "1");
  assert.equal(items[1].duration, 5_000);
});

console.log(`Passed ${passed} history web activity view model tests`);
