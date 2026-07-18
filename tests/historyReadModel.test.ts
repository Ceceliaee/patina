import assert from "node:assert/strict";
import {
  areHistoryWebFaviconsResolvedForSegments,
  getCachedHistoryWebFaviconsForSegments,
  getHistoryWebFaviconRuntimeCacheStats,
  buildHistoryReadModel,
  loadHistoryDaySessionDetails,
  loadHistorySnapshot,
  loadHistoryWebFaviconsForSegments,
  resetHistoryWebFaviconRuntimeCacheForTests,
} from "../src/features/history/services/historyReadModel.ts";
import {
  clearHistorySnapshotCache,
  getHistorySnapshotCache,
  loadHistorySnapshotWithCache,
  setHistorySnapshotCache,
} from "../src/features/history/services/historySnapshotCache.ts";
import {
  getCachedHistoryBootstrapSnapshot,
  clearHistoryBootstrapSnapshot,
  loadPersistedHistoryBootstrapSnapshot,
  resetHistoryBootstrapSnapshotForTests,
  saveHistoryBootstrapSnapshot,
  type HistoryBootstrapIdentity,
} from "../src/features/history/services/historyBootstrapSnapshot.ts";
import type { HistorySession } from "../src/shared/types/sessions.ts";
import type { WebActivitySegment } from "../src/shared/types/webActivity.ts";
import { resolveTrackerHealth } from "../src/shared/types/tracking.ts";

function makeSession(overrides: Partial<HistorySession> = {}): HistorySession {
  const startTime = overrides.startTime ?? new Date(2026, 0, 2, 9, 0, 0, 0).getTime();
  const endTime = Object.hasOwn(overrides, "endTime")
    ? overrides.endTime!
    : startTime + 60 * 60_000;

  return {
    id: overrides.id ?? 1,
    appName: overrides.appName ?? "VSCodium",
    exeName: overrides.exeName ?? "vscodium.exe",
    windowTitle: overrides.windowTitle ?? "Work",
    startTime,
    endTime,
    duration: overrides.duration ?? (endTime === null ? null : endTime - startTime),
    continuityGroupStartTime: overrides.continuityGroupStartTime ?? startTime,
    titleSampleDetails: overrides.titleSampleDetails ?? [],
  };
}

function makeWebSegment(overrides: Partial<WebActivitySegment> = {}): WebActivitySegment {
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
    startTime: overrides.startTime ?? new Date(2026, 0, 2, 10, 0, 0, 0).getTime(),
    endTime: overrides.endTime ?? new Date(2026, 0, 2, 11, 0, 0, 0).getTime(),
    duration: overrides.duration ?? 60 * 60_000,
  };
}

let passed = 0;

async function runTest(name: string, fn: () => Promise<void>) {
  clearHistorySnapshotCache();
  resetHistoryBootstrapSnapshotForTests();
  resetHistoryWebFaviconRuntimeCacheForTests();
  await fn();
  clearHistorySnapshotCache();
  resetHistoryBootstrapSnapshotForTests();
  resetHistoryWebFaviconRuntimeCacheForTests();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("history snapshot keeps app sessions when optional web reads fail", async () => {
  const daySession = makeSession({ id: 1 });
  const weeklySession = makeSession({ id: 2 });
  const originalWarn = console.warn;
  let warning = "";
  console.warn = (message?: unknown) => {
    warning = String(message ?? "");
  };

  try {
    const snapshot = await loadHistorySnapshot(new Date(2026, 0, 2), 7, {
      getHistoryByDate: async () => [daySession],
      getSessionsInRange: async () => [weeklySession],
      getWebActivitySegmentsInRange: async () => {
        throw new Error("no such table: web_activity_segments");
      },
      getWebFaviconsForDomains: async () => ({}),
      loadWebDomainOverrides: async () => ({
        "github.com": {
          displayName: "GitHub",
        },
      }),
    });

    assert.deepEqual(snapshot.daySessions, [daySession]);
    assert.deepEqual(snapshot.weeklySessions, [weeklySession]);
    assert.deepEqual(snapshot.dayWebSegments, []);
    assert.deepEqual(snapshot.webDomainFavicons, {});
    assert.deepEqual(snapshot.webDomainOverrides, {});
    assert.match(warning, /History web activity data is unavailable/);
  } finally {
    console.warn = originalWarn;
  }
});

await runTest("history snapshot skips all web reads when web activity is disabled", async () => {
  let webReadCount = 0;
  const snapshot = await loadHistorySnapshot(new Date(2026, 0, 2), 7, {
    getHistoryByDate: async () => [makeSession()],
    getSessionsInRange: async () => [],
    getWebActivitySegmentsInRange: async () => {
      webReadCount += 1;
      return [makeWebSegment()];
    },
    getWebFaviconsForDomains: async () => {
      webReadCount += 1;
      return { "github.com": "data:image/png;base64,secret" };
    },
    loadWebDomainOverrides: async () => {
      webReadCount += 1;
      return {};
    },
  }, {
    includeWebActivity: false,
  });

  assert.equal(webReadCount, 0);
  assert.deepEqual(snapshot.dayWebSegments, []);
  assert.deepEqual(snapshot.webDomainFavicons, {});
  assert.deepEqual(snapshot.webDomainOverrides, {});
});

await runTest("hour buckets feed History summaries without becoming timeline sessions", async () => {
  const selectedDate = new Date(2026, 0, 2);
  const bucketStart = new Date(2026, 0, 2, 10, 0, 0, 0).getTime();
  const aggregate = {
    appName: "Music",
    exeName: "music.exe",
    startTime: bucketStart,
    endTime: bucketStart + 30 * 60_000,
  };
  const snapshot = await loadHistorySnapshot(selectedDate, 7, {
    getHistoryByDate: async () => [],
    getSessionsInRange: async () => [],
    getImportedTimeBucketsInRange: async () => [aggregate],
    getWebActivitySegmentsInRange: async () => [],
    getWebFaviconsForDomains: async () => ({}),
    loadWebDomainOverrides: async () => ({}),
  }, { includeWebActivity: false });
  const readModel = buildHistoryReadModel({
    daySessions: snapshot.daySessions,
    weeklySessions: snapshot.weeklySessions,
    dayAggregateSessions: snapshot.dayAggregateSessions,
    weeklyAggregateSessions: snapshot.weeklyAggregateSessions,
    trackerHealth: resolveTrackerHealth(bucketStart + 3_600_000, bucketStart + 3_600_000, 8_000),
    selectedDate,
    nowMs: bucketStart + 3_600_000,
    minSessionSecs: 0,
    mergeThresholdSecs: 0,
  });

  assert.equal(snapshot.dayAggregateSessions?.length, 1);
  assert.equal(readModel.timelineSessions.length, 0);
  assert.equal(readModel.compiledSessions.length, 0);
  assert.equal(readModel.appSummary[0]?.exeName, "music.exe");
  assert.equal(readModel.appSummary[0]?.duration, 30 * 60_000);
  assert.equal(readModel.hourlyActivity[10]?.minutes, 30);
  assert.equal(readModel.weekly.reduce((total, day) => total + day.totalDuration, 0), 30 * 60_000);
});

await runTest("history core snapshot defers title samples until detail enrichment", async () => {
  let coreReadCount = 0;
  let detailReadCount = 0;
  const lightweightSession = makeSession({
    windowTitle: "",
    titleSampleDetails: [],
  });
  const detailedSession = makeSession({
    windowTitle: "Detailed title",
    titleSampleDetails: [{
      title: "Detailed title",
      startTime: new Date(2026, 0, 2, 9, 0, 0, 0).getTime(),
      endTime: new Date(2026, 0, 2, 10, 0, 0, 0).getTime(),
    }],
  });
  const deps = {
    getHistoryByDate: async () => {
      detailReadCount += 1;
      return [detailedSession];
    },
    getDaySessionsInRange: async () => {
      coreReadCount += 1;
      return [lightweightSession];
    },
    getSessionsInRange: async () => [],
    getWebActivitySegmentsInRange: async () => [],
    getWebFaviconsForDomains: async () => ({}),
    loadWebDomainOverrides: async () => ({}),
  };

  const coreSnapshot = await loadHistorySnapshot(new Date(2026, 0, 2), 7, deps, {
    includeWebActivity: false,
    includeTitleDetails: false,
  });
  assert.equal(coreReadCount, 1);
  assert.equal(detailReadCount, 0);
  assert.deepEqual(coreSnapshot.daySessions[0].titleSampleDetails, []);

  const details = await loadHistoryDaySessionDetails(new Date(2026, 0, 2), deps);
  assert.equal(detailReadCount, 1);
  assert.equal(details[0].titleSampleDetails?.[0]?.title, "Detailed title");
});

await runTest("history bootstrap snapshot strips privacy-heavy details and matches identity", async () => {
  const identity: HistoryBootstrapIdentity = {
    dateKey: "2026-01-02",
    mappingVersion: 3,
    webActivityEnabled: true,
  };
  const source = {
    fetchedAtMs: new Date(2026, 0, 2, 12, 0, 0, 0).getTime(),
    icons: { "vscodium.exe": "data:image/png;base64,icon-secret" },
    daySessions: [makeSession({
      windowTitle: "private-window-title",
      titleSampleDetails: [{
        title: "private-title-sample",
        startTime: new Date(2026, 0, 2, 9, 0, 0, 0).getTime(),
        endTime: new Date(2026, 0, 2, 10, 0, 0, 0).getTime(),
      }],
    })],
    weeklySessions: [makeSession({ id: 2, windowTitle: "weekly-private-title" })],
    dayWebSegments: [makeWebSegment({
      url: "https://github.com/private",
      title: "private-web-title",
      faviconUrl: "data:image/png;base64,favicon-secret",
    })],
    webDomainFavicons: { "github.com": "data:image/png;base64,favicon-secret" },
    webDomainOverrides: {
      "github.com": {
        displayName: "GitHub",
        secretUrl: "https://github.com/override-secret",
      },
    },
  };
  let savedPayload = "";

  const saved = await saveHistoryBootstrapSnapshot(source, identity, {}, {
    loadPayload: async () => null,
    savePayload: async (payload) => {
      savedPayload = payload;
    },
    clearPayload: async () => {},
    warn: (message, error) => {
      throw new Error(`${message}: ${String(error)}`);
    },
  });

  assert.equal(saved, true);
  assert.ok(savedPayload.length > 0);
  assert.equal(savedPayload.includes("private-window-title"), false);
  assert.equal(savedPayload.includes("private-title-sample"), false);
  assert.equal(savedPayload.includes("weekly-private-title"), false);
  assert.equal(savedPayload.includes("https://github.com/private"), false);
  assert.equal(savedPayload.includes("private-web-title"), false);
  assert.equal(savedPayload.includes("override-secret"), false);
  assert.equal(savedPayload.includes("data:image"), false);

  const cached = getCachedHistoryBootstrapSnapshot(identity);
  assert.ok(cached);
  assert.equal(cached.snapshot.daySessions[0].windowTitle, "");
  assert.deepEqual(cached.snapshot.daySessions[0].titleSampleDetails, []);
  assert.deepEqual(cached.snapshot.weeklySessions, []);
  assert.equal(cached.snapshot.dayWebSegments[0].url, null);
  assert.equal(cached.snapshot.dayWebSegments[0].title, null);
  assert.equal(cached.snapshot.dayWebSegments[0].faviconUrl, null);
  assert.deepEqual(cached.snapshot.icons, {});
  assert.deepEqual(cached.snapshot.webDomainFavicons, {});
  assert.equal(getCachedHistoryBootstrapSnapshot({ ...identity, dateKey: "2026-01-03" }), null);
  assert.equal(getCachedHistoryBootstrapSnapshot({ ...identity, mappingVersion: 4 }), null);
  assert.equal(getCachedHistoryBootstrapSnapshot({ ...identity, webActivityEnabled: false }), null);
});

await runTest("history bootstrap snapshot loads a valid persisted payload and rejects malformed data", async () => {
  const identity: HistoryBootstrapIdentity = {
    dateKey: "2026-01-02",
    mappingVersion: 1,
    webActivityEnabled: false,
  };
  let persistedPayload = "";
  await saveHistoryBootstrapSnapshot({
    fetchedAtMs: Date.now(),
    icons: {},
    daySessions: [makeSession()],
    weeklySessions: [],
    dayWebSegments: [],
    webDomainFavicons: {},
    webDomainOverrides: {},
  }, identity, {}, {
    loadPayload: async () => null,
    savePayload: async (payload) => {
      persistedPayload = payload;
    },
    clearPayload: async () => {},
    warn: () => {},
  });
  resetHistoryBootstrapSnapshotForTests();

  const loaded = await loadPersistedHistoryBootstrapSnapshot({
    loadPayload: async () => persistedPayload,
    savePayload: async () => {},
    clearPayload: async () => {},
    warn: (message, error) => {
      throw new Error(`${message}: ${String(error)}`);
    },
  });
  assert.ok(loaded);
  assert.ok(getCachedHistoryBootstrapSnapshot(identity));

  const warnings: string[] = [];
  const malformed = await loadPersistedHistoryBootstrapSnapshot({
    loadPayload: async () => JSON.stringify({ version: 1, identity }),
    savePayload: async () => {},
    clearPayload: async () => {},
    warn: (message) => warnings.push(message),
  });
  assert.equal(malformed, null);
  assert.equal(getCachedHistoryBootstrapSnapshot(identity), null);
  assert.ok(warnings.some((message) => message.includes("History bootstrap")));
});

await runTest("history bootstrap snapshot refuses payloads above the frontend size budget", async () => {
  const hugeSessions = Array.from({ length: 12_000 }, (_, index) => makeSession({
    id: index + 1,
    appName: `Application-${index}-${"x".repeat(40)}`,
    exeName: `application-${index}.exe`,
  }));
  let saved = false;
  const warnings: string[] = [];

  const result = await saveHistoryBootstrapSnapshot({
    fetchedAtMs: Date.now(),
    icons: {},
    daySessions: hugeSessions,
    weeklySessions: hugeSessions,
    dayWebSegments: [],
    webDomainFavicons: {},
    webDomainOverrides: {},
  }, {
    dateKey: "2026-01-02",
    mappingVersion: 1,
    webActivityEnabled: false,
  }, {}, {
    loadPayload: async () => null,
    savePayload: async () => {
      saved = true;
    },
    clearPayload: async () => {},
    warn: (message) => warnings.push(message),
  });

  assert.equal(result, false);
  assert.equal(saved, false);
  assert.ok(warnings.some((message) => message.includes("size budget")));
});

await runTest("history bootstrap size budget counts UTF-8 bytes", async () => {
  let saved = false;
  const warnings: string[] = [];
  const result = await saveHistoryBootstrapSnapshot({
    fetchedAtMs: Date.now(),
    icons: {},
    daySessions: [makeSession({ appName: "史".repeat(90_000) })],
    weeklySessions: [],
    dayWebSegments: [],
    webDomainFavicons: {},
    webDomainOverrides: {},
  }, {
    dateKey: "2026-01-02",
    mappingVersion: 1,
    webActivityEnabled: false,
  }, {}, {
    loadPayload: async () => null,
    savePayload: async () => {
      saved = true;
    },
    clearPayload: async () => {},
    warn: (message) => warnings.push(message),
  });

  assert.equal(result, false);
  assert.equal(saved, false);
  assert.ok(warnings.some((message) => message.includes("size budget")));
});

await runTest("history bootstrap persists a changed identity despite write throttling", async () => {
  const savedPayloads: string[] = [];
  const deps = {
    loadPayload: async () => null,
    savePayload: async (payload: string) => {
      savedPayloads.push(payload);
    },
    clearPayload: async () => {},
    warn: () => {},
  };
  const snapshot = {
    fetchedAtMs: Date.now(),
    icons: {},
    daySessions: [makeSession()],
    weeklySessions: [],
    dayWebSegments: [],
    webDomainFavicons: {},
    webDomainOverrides: {},
  };

  assert.equal(await saveHistoryBootstrapSnapshot(snapshot, {
    dateKey: "2026-01-01",
    mappingVersion: 1,
    webActivityEnabled: false,
  }, { nowMs: 1_000, minSaveIntervalMs: 300_000 }, deps), true);
  assert.equal(await saveHistoryBootstrapSnapshot(snapshot, {
    dateKey: "2026-01-02",
    mappingVersion: 1,
    webActivityEnabled: false,
  }, { nowMs: 2_000, minSaveIntervalMs: 300_000 }, deps), true);
  assert.equal(savedPayloads.length, 2);
});

await runTest("late persisted bootstrap reads cannot overwrite a newer in-memory snapshot", async () => {
  const oldIdentity: HistoryBootstrapIdentity = {
    dateKey: "2026-01-01",
    mappingVersion: 1,
    webActivityEnabled: false,
  };
  const newIdentity: HistoryBootstrapIdentity = {
    ...oldIdentity,
    dateKey: "2026-01-02",
  };
  const snapshot = {
    fetchedAtMs: Date.now(),
    icons: {},
    daySessions: [makeSession()],
    weeklySessions: [],
    dayWebSegments: [],
    webDomainFavicons: {},
    webDomainOverrides: {},
  };
  let oldPayload = "";
  await saveHistoryBootstrapSnapshot(snapshot, oldIdentity, {}, {
    loadPayload: async () => null,
    savePayload: async (payload) => {
      oldPayload = payload;
    },
    clearPayload: async () => {},
    warn: () => {},
  });
  resetHistoryBootstrapSnapshotForTests();

  let resolveOldRead!: (payload: string | null) => void;
  const lateRead = loadPersistedHistoryBootstrapSnapshot({
    loadPayload: () => new Promise((resolve) => {
      resolveOldRead = resolve;
    }),
    savePayload: async () => {},
    clearPayload: async () => {},
    warn: () => {},
  });
  await Promise.resolve();
  await saveHistoryBootstrapSnapshot(snapshot, newIdentity, {}, {
    loadPayload: async () => null,
    savePayload: async () => {},
    clearPayload: async () => {},
    warn: () => {},
  });
  resolveOldRead(oldPayload);
  await lateRead;

  assert.ok(getCachedHistoryBootstrapSnapshot(newIdentity));
  assert.equal(getCachedHistoryBootstrapSnapshot(oldIdentity), null);
});

await runTest("history bootstrap writes stay ordered across save and clear", async () => {
  const writes: string[] = [];
  let releaseFirstWrite!: () => void;
  const firstWriteGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const snapshot = {
    fetchedAtMs: Date.now(),
    icons: {},
    daySessions: [makeSession()],
    weeklySessions: [],
    dayWebSegments: [],
    webDomainFavicons: {},
    webDomainOverrides: {},
  };
  const deps = {
    loadPayload: async () => null,
    savePayload: async (payload: string) => {
      writes.push(`save:${JSON.parse(payload).identity.dateKey}`);
      if (writes.length === 1) await firstWriteGate;
    },
    clearPayload: async () => {
      writes.push("clear");
    },
    warn: () => {},
  };

  const firstSave = saveHistoryBootstrapSnapshot(snapshot, {
    dateKey: "2026-01-01",
    mappingVersion: 1,
    webActivityEnabled: false,
  }, { minSaveIntervalMs: 0 }, deps);
  await Promise.resolve();
  const secondSave = saveHistoryBootstrapSnapshot(snapshot, {
    dateKey: "2026-01-02",
    mappingVersion: 1,
    webActivityEnabled: false,
  }, { minSaveIntervalMs: 0 }, deps);
  const clear = clearHistoryBootstrapSnapshot(deps);
  await Promise.resolve();

  assert.deepEqual(writes, ["save:2026-01-01"]);
  releaseFirstWrite();
  await Promise.all([firstSave, secondSave, clear]);
  assert.deepEqual(writes, ["save:2026-01-01", "save:2026-01-02", "clear"]);

  const followUpSave = await saveHistoryBootstrapSnapshot(snapshot, {
    dateKey: "2026-01-02",
    mappingVersion: 1,
    webActivityEnabled: false,
  }, { nowMs: Date.now(), minSaveIntervalMs: 300_000 }, deps);
  assert.equal(followUpSave, true);
  assert.deepEqual(writes, [
    "save:2026-01-01",
    "save:2026-01-02",
    "clear",
    "save:2026-01-02",
  ]);
});

await runTest("history heavy cache release retains the one-slot bootstrap snapshot", async () => {
  const identity: HistoryBootstrapIdentity = {
    dateKey: "2026-01-02",
    mappingVersion: 1,
    webActivityEnabled: false,
  };
  const snapshot = {
    fetchedAtMs: Date.now(),
    icons: {},
    daySessions: [makeSession()],
    weeklySessions: [],
    dayWebSegments: [],
    webDomainFavicons: {},
    webDomainOverrides: {},
  };
  await saveHistoryBootstrapSnapshot(snapshot, identity, {}, {
    loadPayload: async () => null,
    savePayload: async () => {},
    clearPayload: async () => {},
    warn: () => {},
  });
  setHistorySnapshotCache(snapshot, new Date(2026, 0, 2), 7, false);

  clearHistorySnapshotCache();

  assert.ok(getCachedHistoryBootstrapSnapshot(identity));
});

await runTest("history bootstrap invalidation clears memory and persisted payload", async () => {
  const identity: HistoryBootstrapIdentity = {
    dateKey: "2026-01-02",
    mappingVersion: 1,
    webActivityEnabled: false,
  };
  let clearCount = 0;
  await saveHistoryBootstrapSnapshot({
    fetchedAtMs: Date.now(),
    icons: {},
    daySessions: [makeSession()],
    weeklySessions: [],
    dayWebSegments: [],
    webDomainFavicons: {},
    webDomainOverrides: {},
  }, identity, {}, {
    loadPayload: async () => null,
    savePayload: async () => {},
    clearPayload: async () => {},
    warn: () => {},
  });

  await clearHistoryBootstrapSnapshot({
    loadPayload: async () => null,
    savePayload: async () => {},
    clearPayload: async () => {
      clearCount += 1;
    },
    warn: () => {},
  });

  assert.equal(clearCount, 1);
  assert.equal(getCachedHistoryBootstrapSnapshot(identity), null);
});

await runTest("history favicon enrichment fails independently from the core snapshot", async () => {
  const webSegment = makeWebSegment();
  const originalWarn = console.warn;
  let warning = "";
  console.warn = (message?: unknown) => {
    warning = String(message ?? "");
  };

  try {
    const deps = {
      getHistoryByDate: async () => [],
      getSessionsInRange: async () => [],
      getWebActivitySegmentsInRange: async () => [webSegment],
      getWebFaviconsForDomains: async () => {
        throw new Error("no such table: web_favicon_cache");
      },
      loadWebDomainOverrides: async () => ({}),
    };
    const snapshot = await loadHistorySnapshot(new Date(2026, 0, 2), 7, deps);
    const favicons = await loadHistoryWebFaviconsForSegments(snapshot.dayWebSegments, deps);

    assert.deepEqual(snapshot.dayWebSegments, [webSegment]);
    assert.deepEqual(snapshot.webDomainFavicons, {});
    assert.deepEqual(snapshot.webDomainOverrides, {});
    assert.deepEqual(favicons, {});
    assert.match(warning, /History web favicon cache is unavailable/);
  } finally {
    console.warn = originalWarn;
  }
});

await runTest("history favicon enrichment dedupes requests and keeps a bounded stable runtime result", async () => {
  const githubSegment = makeWebSegment();
  const docsSegment = makeWebSegment({
    id: 2,
    domain: "docs.rs",
    normalizedDomain: "docs.rs",
  });
  let loadCount = 0;
  let releaseLoad: ((favicons: Record<string, string>) => void) | null = null;
  const deps = {
    getHistoryByDate: async () => [],
    getSessionsInRange: async () => [],
    getWebActivitySegmentsInRange: async () => [],
    getWebFaviconsForDomains: async () => {
      loadCount += 1;
      return new Promise<Record<string, string>>((resolve) => {
        releaseLoad = resolve;
      });
    },
    loadWebDomainOverrides: async () => ({}),
  };

  const first = loadHistoryWebFaviconsForSegments([githubSegment, docsSegment], deps);
  const second = loadHistoryWebFaviconsForSegments([githubSegment, docsSegment], deps);
  releaseLoad?.({
    "github.com": "data:image/png;base64,github",
    "docs.rs": "data:image/png;base64,docs",
  });
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(loadCount, 1);
  assert.deepEqual(secondResult, firstResult);
  assert.deepEqual(getCachedHistoryWebFaviconsForSegments([githubSegment, docsSegment]), firstResult);
  assert.equal(areHistoryWebFaviconsResolvedForSegments([githubSegment, docsSegment]), true);
  assert.deepEqual(getHistoryWebFaviconRuntimeCacheStats(), {
    entries: 2,
    limit: 64,
    resolvedDomains: 2,
    pendingRefresh: false,
  });

  clearHistorySnapshotCache();
  assert.deepEqual(getCachedHistoryWebFaviconsForSegments([githubSegment, docsSegment]), firstResult);

  assert.deepEqual(
    await loadHistoryWebFaviconsForSegments([githubSegment, docsSegment], deps),
    firstResult,
  );
  assert.equal(loadCount, 1);
});

await runTest("history favicon runtime cache evicts old domains and rejects oversized sources", async () => {
  const segments = Array.from({ length: 70 }, (_, index) => makeWebSegment({
    id: index + 1,
    domain: `site-${index}.example`,
    normalizedDomain: `site-${index}.example`,
  }));
  const oversizedDomain = segments[69].normalizedDomain;
  const favicons = Object.fromEntries(segments.map((segment, index) => [
    segment.normalizedDomain,
    index === 69
      ? `data:image/png;base64,${"x".repeat(8_192)}`
      : `data:image/png;base64,${index}`,
  ]));

  await loadHistoryWebFaviconsForSegments(segments, {
    getHistoryByDate: async () => [],
    getSessionsInRange: async () => [],
    getWebActivitySegmentsInRange: async () => [],
    getWebFaviconsForDomains: async () => favicons,
    loadWebDomainOverrides: async () => ({}),
  });

  const stats = getHistoryWebFaviconRuntimeCacheStats();
  assert.equal(stats.limit, 64);
  assert.equal(stats.resolvedDomains, 64);
  assert.equal(stats.entries, 63);
  assert.equal(getCachedHistoryWebFaviconsForSegments([segments[0]])[segments[0].normalizedDomain], undefined);
  assert.equal(getCachedHistoryWebFaviconsForSegments([segments[6]])[segments[6].normalizedDomain] !== undefined, true);
  assert.equal(getCachedHistoryWebFaviconsForSegments([segments[69]])[oversizedDomain], undefined);
});

await runTest("history snapshot uses lightweight weekly loader when provided", async () => {
  const daySession = makeSession({
    id: 1,
    titleSampleDetails: [{
      title: "README.md",
      startTime: new Date(2026, 0, 2, 9, 0, 0, 0).getTime(),
      endTime: new Date(2026, 0, 2, 10, 0, 0, 0).getTime(),
    }],
  });
  const weeklySession = makeSession({ id: 2, titleSampleDetails: [] });
  let weeklyLoadCount = 0;

  const snapshot = await loadHistorySnapshot(new Date(2026, 0, 2), 7, {
    getHistoryByDate: async () => [daySession],
    getSessionsInRange: async () => {
      throw new Error("full weekly session loader should not run");
    },
    getWeeklySessionsInRange: async () => {
      weeklyLoadCount += 1;
      return [weeklySession];
    },
    getWebActivitySegmentsInRange: async () => [],
    getWebFaviconsForDomains: async () => ({}),
    loadWebDomainOverrides: async () => ({}),
  });

  assert.equal(weeklyLoadCount, 1);
  assert.equal(snapshot.daySessions[0].titleSampleDetails?.length, 1);
  assert.deepEqual(snapshot.weeklySessions, [weeklySession]);
  assert.deepEqual(snapshot.weeklySessions[0].titleSampleDetails, []);
});

await runTest("history snapshot cache dedupes matching in-flight loads", async () => {
  const daySession = makeSession({ id: 1 });
  const weeklySession = makeSession({ id: 2 });
  let dayLoadCount = 0;
  let weeklyLoadCount = 0;
  let releaseDayLoad: (() => void) | null = null;
  const deps = {
    getHistoryByDate: async () => {
      dayLoadCount += 1;
      await new Promise<void>((resolve) => {
        releaseDayLoad = resolve;
      });
      return [daySession];
    },
    getSessionsInRange: async () => {
      weeklyLoadCount += 1;
      return [weeklySession];
    },
    getWebActivitySegmentsInRange: async () => [],
    getWebFaviconsForDomains: async () => ({}),
    loadWebDomainOverrides: async () => ({}),
  };
  const date = new Date(2026, 0, 2);

  const first = loadHistorySnapshotWithCache(date, 7, deps);
  const second = loadHistorySnapshotWithCache(date, 7, deps);
  releaseDayLoad?.();
  const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);

  assert.equal(firstSnapshot, secondSnapshot);
  assert.deepEqual(firstSnapshot.daySessions, [daySession]);
  assert.deepEqual(firstSnapshot.weeklySessions, [weeklySession]);
  assert.equal(dayLoadCount, 1);
  assert.equal(weeklyLoadCount, 1);
});

await runTest("history snapshot cache keeps different dates separate while pending", async () => {
  let dayLoadCount = 0;
  const deps = {
    getHistoryByDate: async (date: Date) => {
      dayLoadCount += 1;
      return [makeSession({ id: date.getDate() })];
    },
    getSessionsInRange: async () => [],
    getWebActivitySegmentsInRange: async () => [],
    getWebFaviconsForDomains: async () => ({}),
    loadWebDomainOverrides: async () => ({}),
  };

  const [first, second] = await Promise.all([
    loadHistorySnapshotWithCache(new Date(2026, 0, 2), 7, deps),
    loadHistorySnapshotWithCache(new Date(2026, 0, 3), 7, deps),
  ]);

  assert.equal(first.daySessions[0].id, 2);
  assert.equal(second.daySessions[0].id, 3);
  assert.equal(dayLoadCount, 2);
});

await runTest("cleared History requests cannot repopulate cache or evict newer in-flight work", async () => {
  const dayResolvers: Array<(sessions: HistorySession[]) => void> = [];
  let dayReadCount = 0;
  const deps = {
    getHistoryByDate: () => {
      dayReadCount += 1;
      return new Promise<HistorySession[]>((resolve) => {
        dayResolvers.push(resolve);
      });
    },
    getSessionsInRange: async () => [],
    getWebActivitySegmentsInRange: async () => [],
    getWebFaviconsForDomains: async () => ({}),
    loadWebDomainOverrides: async () => ({}),
  };
  const date = new Date(2026, 0, 2);

  const staleLoad = loadHistorySnapshotWithCache(date, 7, deps, {
    includeWebActivity: false,
  });
  clearHistorySnapshotCache();
  const freshLoad = loadHistorySnapshotWithCache(date, 7, deps, {
    includeWebActivity: false,
  });
  dayResolvers[0]([makeSession({ id: 1 })]);
  await staleLoad;
  assert.equal(getHistorySnapshotCache(date, 7, false), null);

  const dedupedFreshLoad = loadHistorySnapshotWithCache(date, 7, deps, {
    includeWebActivity: false,
  });
  await Promise.resolve();
  assert.equal(dayReadCount, 2);
  dayResolvers[1]([makeSession({ id: 2 })]);
  await Promise.all([freshLoad, dedupedFreshLoad]);
  assert.equal(getHistorySnapshotCache(date, 7, false)?.daySessions[0]?.id, 2);
});

console.log(`Passed ${passed} history read model tests`);
