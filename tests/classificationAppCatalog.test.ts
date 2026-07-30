import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  buildRecordedAppCatalogQuery,
  type RecordedAppCatalogCursor,
  type RecordedAppCatalogPage,
} from "../src/platform/persistence/classificationPersistence.ts";
import {
  CLASSIFICATION_APP_CATALOG_CARD_LIMIT,
  CLASSIFICATION_APP_CATALOG_MAX_RAW_PAGES,
  ClassificationAppCatalogController,
  ClassificationAppCatalogSnapshotStore,
  ClassificationAppCatalogRevisionChangedError,
  loadClassificationAppCatalogBatch,
} from "../src/features/classification/services/classificationAppCatalog.ts";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
import type { ObservedAppCandidate } from "../src/features/classification/services/classificationStore.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function createCatalogFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY,
      exe_name TEXT NOT NULL,
      app_name TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER
    );
    CREATE TABLE import_exact_sessions (
      id INTEGER PRIMARY KEY,
      exe_name TEXT NOT NULL,
      app_name TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL
    );
    CREATE TABLE import_time_buckets (
      id INTEGER PRIMARY KEY,
      exe_name TEXT NOT NULL,
      app_name TEXT,
      bucket_start_time INTEGER NOT NULL,
      duration INTEGER NOT NULL
    );
    CREATE INDEX idx_sessions_exe_usage_time ON sessions(exe_name, start_time);
    CREATE INDEX idx_import_exact_sessions_exe_time ON import_exact_sessions(exe_name, start_time);
    CREATE INDEX idx_import_time_buckets_exe_time ON import_time_buckets(exe_name, bucket_start_time);
  `);
  return db;
}

function catalogPage(
  page: Omit<RecordedAppCatalogPage, "readPath" | "fallbackReason" | "sourceRevision">,
  sourceRevision: number = 1,
): RecordedAppCatalogPage {
  return {
    ...page,
    readPath: "projection",
    fallbackReason: null,
    sourceRevision,
  };
}

function selectRecordedPage(
  db: DatabaseSync,
  cursor: RecordedAppCatalogCursor | null,
  searchQuery: string,
  limit: number,
): RecordedAppCatalogPage {
  const query = buildRecordedAppCatalogQuery({ cursor, searchQuery, limit });
  const rows = db.prepare(query.sql).all(...query.params).map((row) => ({
    rawExeName: String(row.exe_name),
    appName: String(row.app_name),
    lastSeenMs: Number(row.last_seen_ms),
    hasNativeRecords: Number(row.has_native_records) === 1,
  }));
  const last = rows.at(-1);
  return catalogPage({
    rows,
    nextCursor: last
      ? { lastSeenMs: last.lastSeenMs, rawExeName: last.rawExeName }
      : cursor,
    hasMore: rows.length === limit,
  });
}

await runTest("recorded catalog reaches native and imported applications older than 30 days", () => {
  const db = createCatalogFixture();
  db.exec(`
    INSERT INTO sessions VALUES (1, 'recent.exe', 'Recent', 2000, 3000);
    INSERT INTO import_exact_sessions VALUES (1, 'year-old.exe', 'Year Old', 100, 200);
    INSERT INTO import_time_buckets VALUES (1, 'bucket-only.exe', 'Bucket Only', 50, 60000);
  `);

  const page = selectRecordedPage(db, null, "", 10);
  assert.deepEqual(page.rows.map((row) => row.rawExeName), [
    "recent.exe",
    "year-old.exe",
    "bucket-only.exe",
  ]);
  assert.equal(page.rows[0].hasNativeRecords, true);
  assert.equal(page.rows[2].hasNativeRecords, false);
  db.close();
});

await runTest("recorded catalog preserves missing runtime names for executable formatting", () => {
  const db = createCatalogFixture();
  db.exec("INSERT INTO sessions VALUES (1, 'new-editor.exe', '', 1000, 1100)");

  const page = selectRecordedPage(db, null, "", 10);
  assert.equal(page.rows[0].appName, "");
  db.close();
});

await runTest("catalog formats executable names only after missing runtime facts stay empty", async () => {
  const db = createCatalogFixture();
  db.exec("INSERT INTO sessions VALUES (1, 'new-editor.exe', '', 1000, 1100)");
  const result = await loadClassificationAppCatalogBatch({
    cursor: null,
    searchQuery: "",
    seenExeNames: [],
  }, {
    loadRecordedPage: async ({ cursor, searchQuery, limit }) => (
      selectRecordedPage(db, cursor, searchQuery, limit)
    ),
  });

  assert.equal(result.candidates[0].appName, "New Editor");
  db.close();
});

await runTest("recorded catalog keyset cursor is stable for equal last-seen values", () => {
  const db = createCatalogFixture();
  db.exec(`
    INSERT INTO sessions VALUES (1, 'alpha.exe', 'Alpha', 1000, 1100);
    INSERT INTO sessions VALUES (2, 'bravo.exe', 'Bravo', 1000, 1100);
    INSERT INTO sessions VALUES (3, 'charlie.exe', 'Charlie', 900, 1000);
  `);

  const first = selectRecordedPage(db, null, "", 2);
  const second = selectRecordedPage(db, first.nextCursor, "", 2);
  assert.deepEqual(first.rows.map((row) => row.rawExeName), ["alpha.exe", "bravo.exe"]);
  assert.deepEqual(second.rows.map((row) => row.rawExeName), ["charlie.exe"]);
  db.close();
});

await runTest("recorded catalog search treats percent underscore and backslash literally", () => {
  const db = createCatalogFixture();
  db.exec(`
    INSERT INTO sessions VALUES (1, 'literal%app.exe', 'Percent', 3000, 3100);
    INSERT INTO sessions VALUES (2, 'literal_app.exe', 'Underscore', 2000, 2100);
    INSERT INTO sessions VALUES (3, 'literal\\app.exe', 'Backslash', 1000, 1100);
    INSERT INTO sessions VALUES (4, 'ordinary.exe', 'Ordinary', 900, 1000);
  `);

  assert.deepEqual(selectRecordedPage(db, null, "%", 10).rows.map((row) => row.rawExeName), ["literal%app.exe"]);
  assert.deepEqual(selectRecordedPage(db, null, "_", 10).rows.map((row) => row.rawExeName), ["literal_app.exe"]);
  assert.deepEqual(selectRecordedPage(db, null, "\\", 10).rows.map((row) => row.rawExeName), ["literal\\app.exe"]);
  db.close();
});

await runTest("recorded catalog search keeps SQL injection payloads as data", () => {
  const db = createCatalogFixture();
  db.exec("INSERT INTO sessions VALUES (1, 'safe.exe', 'Safe', 1000, 1100)");
  const payload = "' OR 1=1; DROP TABLE sessions; --";
  assert.deepEqual(selectRecordedPage(db, null, payload, 10).rows, []);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()!.count, 1);
  db.close();
});

await runTest("catalog batch canonicalizes duplicates across raw pages", async () => {
  const pages: RecordedAppCatalogPage[] = [
    catalogPage({
      rows: [
        { rawExeName: "Code.exe", appName: "Code", lastSeenMs: 300, hasNativeRecords: true },
        { rawExeName: "code.exe", appName: "Visual Studio Code", lastSeenMs: 200, hasNativeRecords: false },
      ],
      nextCursor: { lastSeenMs: 200, rawExeName: "code.exe" },
      hasMore: true,
    }),
    catalogPage({
      rows: [
        { rawExeName: "notes.exe", appName: "Notes", lastSeenMs: 100, hasNativeRecords: false },
      ],
      nextCursor: { lastSeenMs: 100, rawExeName: "notes.exe" },
      hasMore: false,
    }),
  ];
  let call = 0;
  const result = await loadClassificationAppCatalogBatch({
    cursor: null,
    searchQuery: "",
    seenExeNames: [],
  }, {
    loadRecordedPage: async () => pages[call++],
  });

  assert.deepEqual(result.candidates.map((candidate) => candidate.exeName), ["code.exe", "notes.exe"]);
  assert.equal(result.candidates[0].hasNativeRecords, true);
  assert.equal(call, 2);
});

await runTest("catalog uses the canonical executable fallback for alias-only components", async () => {
  const result = await loadClassificationAppCatalogBatch({
    cursor: null,
    searchQuery: "",
    seenExeNames: [],
  }, {
    loadRecordedPage: async () => catalogPage({
      rows: [{
        rawExeName: "Douyin_tray.exe",
        appName: "Douyin_tray",
        lastSeenMs: 100,
        hasNativeRecords: true,
      }],
      nextCursor: { lastSeenMs: 100, rawExeName: "Douyin_tray.exe" },
      hasMore: false,
    }),
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].exeName, "douyin.exe");
  assert.equal(result.candidates[0].appName, "Douyin");
});

await runTest("catalog prefers a later canonical runtime name over a newer alias fallback", async () => {
  const result = await loadClassificationAppCatalogBatch({
    cursor: null,
    searchQuery: "",
    seenExeNames: [],
  }, {
    loadRecordedPage: async () => catalogPage({
      rows: [
        {
          rawExeName: "Douyin_tray.exe",
          appName: "Douyin_tray",
          lastSeenMs: 200,
          hasNativeRecords: true,
        },
        {
          rawExeName: "douyin.exe",
          appName: "抖音",
          lastSeenMs: 100,
          hasNativeRecords: true,
        },
      ],
      nextCursor: { lastSeenMs: 100, rawExeName: "douyin.exe" },
      hasMore: false,
    }),
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].exeName, "douyin.exe");
  assert.equal(result.candidates[0].appName, "抖音");
});

await runTest("catalog candidates keep runtime names separate from saved display overrides", async () => {
  ProcessMapper.setUserOverride("new-editor.exe", {
    displayName: "My Editor",
    enabled: true,
  });
  try {
    const result = await loadClassificationAppCatalogBatch({
      cursor: null,
      searchQuery: "",
      seenExeNames: [],
    }, {
      loadRecordedPage: async () => catalogPage({
        rows: [{
          rawExeName: "new-editor.exe",
          appName: "Runtime Editor",
          lastSeenMs: 100,
          hasNativeRecords: true,
        }],
        nextCursor: { lastSeenMs: 100, rawExeName: "new-editor.exe" },
        hasMore: false,
      }),
    });

    assert.equal(result.candidates[0].appName, "Runtime Editor");
  } finally {
    ProcessMapper.clearUserOverrides();
  }
});

await runTest("catalog batch stops after the bounded raw-page scan budget", async () => {
  let calls = 0;
  const result = await loadClassificationAppCatalogBatch({
    cursor: null,
    searchQuery: "",
    seenExeNames: ["repeat.exe"],
  }, {
    loadRecordedPage: async ({ cursor }) => {
      calls += 1;
      return catalogPage({
        rows: [{ rawExeName: "repeat.exe", appName: "Repeat", lastSeenMs: 1000 - calls, hasNativeRecords: true }],
        nextCursor: { lastSeenMs: 1000 - calls, rawExeName: `repeat-${calls}.exe` },
        hasMore: true,
      });
    },
  });

  assert.equal(calls, CLASSIFICATION_APP_CATALOG_MAX_RAW_PAGES);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.hasMore, true);
});

await runTest("catalog never revives applications from classification mappings alone", async () => {
  const result = await loadClassificationAppCatalogBatch({
    cursor: null,
    searchQuery: "",
    seenExeNames: ["recorded.exe"],
  }, {
    loadRecordedPage: async () => catalogPage({ rows: [], nextCursor: null, hasMore: false }),
  });

  assert.deepEqual(result.candidates, []);
  assert.equal(result.hasMore, false);
});

await runTest("search results also require an underlying activity record", async () => {
  const result = await loadClassificationAppCatalogBatch({
    cursor: null,
    searchQuery: "previous alias",
    seenExeNames: [],
  }, {
    loadRecordedPage: async () => catalogPage({ rows: [], nextCursor: null, hasMore: false }),
  });
  assert.deepEqual(result.candidates, []);
});

await runTest("catalog output never exceeds its canonical card boundary", async () => {
  const rows = Array.from({ length: 120 }, (_, index) => ({
    rawExeName: `app-${String(index).padStart(3, "0")}.exe`,
    appName: `App ${index}`,
    lastSeenMs: 1000 - index,
    hasNativeRecords: true,
  }));
  const result = await loadClassificationAppCatalogBatch({
    cursor: null,
    searchQuery: "",
    seenExeNames: [],
  }, {
    loadRecordedPage: async () => catalogPage({
      rows,
      nextCursor: { lastSeenMs: rows.at(-1)!.lastSeenMs, rawExeName: rows.at(-1)!.rawExeName },
      hasMore: true,
    }),
  });
  assert.equal(result.candidates.length, CLASSIFICATION_APP_CATALOG_CARD_LIMIT);
  assert.equal(result.hasMore, true);
});

await runTest("catalog controller automatically exhausts every internal batch", async () => {
  const db = createCatalogFixture();
  const insert = db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)");
  for (let index = 0; index < 130; index += 1) {
    insert.run(index + 1, `app-${String(index).padStart(3, "0")}.exe`, `App ${index}`, 10_000 - index, 20_000 - index);
  }
  const collected: string[] = [];
  let batches = 0;
  const controller = new ClassificationAppCatalogController({
    loadRecordedPage: async ({ cursor, searchQuery, limit }) => (
      selectRecordedPage(db, cursor, searchQuery, limit)
    ),
  });
  const completed = await controller.loadAll({
    onBatch: (candidates) => {
      batches += 1;
      collected.push(...candidates.map((candidate) => candidate.exeName));
    },
  });
  assert.equal(completed && completed.candidates.length, 130);
  assert.equal(collected.length, 130);
  assert.equal(new Set(collected).size, 130);
  assert.equal(batches, 1);
  db.close();
});

await runTest("catalog controller upgrades alias fallbacks across batch boundaries", async () => {
  const firstRows = [
    {
      rawExeName: "Douyin_tray.exe",
      appName: "Douyin_tray",
      lastSeenMs: 1_000,
      hasNativeRecords: true,
    },
    ...Array.from({ length: 59 }, (_, index) => ({
      rawExeName: `filler-${index}.exe`,
      appName: `Filler ${index}`,
      lastSeenMs: 999 - index,
      hasNativeRecords: true,
    })),
  ];
  let page = 0;
  const controller = new ClassificationAppCatalogController({
    loadRecordedPage: async () => {
      page += 1;
      if (page === 1) {
        return catalogPage({
          rows: firstRows,
          nextCursor: { lastSeenMs: 940, rawExeName: "filler-58.exe" },
          hasMore: true,
        });
      }
      return catalogPage({
        rows: [{
          rawExeName: "douyin.exe",
          appName: "抖音",
          lastSeenMs: 100,
          hasNativeRecords: true,
        }],
        nextCursor: { lastSeenMs: 100, rawExeName: "douyin.exe" },
        hasMore: false,
      });
    },
  });
  const collected = new Map<string, ObservedAppCandidate>();
  await controller.loadAll({
    onBatch: (candidates) => {
      for (const candidate of candidates) {
        collected.set(candidate.exeName, candidate);
      }
    },
  });

  assert.equal(collected.get("douyin.exe")?.appName, "抖音");
});

await runTest("only the latest catalog generation may update visible state", async () => {
  let releaseFirstPage!: (page: RecordedAppCatalogPage) => void;
  const firstPage = new Promise<RecordedAppCatalogPage>((resolve) => {
    releaseFirstPage = resolve;
  });
  let call = 0;
  const controller = new ClassificationAppCatalogController({
    loadRecordedPage: async () => {
      call += 1;
      if (call === 1) return firstPage;
      return catalogPage({
        rows: [{
          rawExeName: "new.exe",
          appName: "New",
          lastSeenMs: 2,
          hasNativeRecords: true,
        }],
        nextCursor: { lastSeenMs: 2, rawExeName: "new.exe" },
        hasMore: false,
      }, 2);
    },
  });
  const published: string[][] = [];
  const first = controller.loadAll({
    onBatch: (candidates) => published.push(candidates.map((candidate) => candidate.exeName)),
  });
  const second = controller.loadAll({
    onBatch: (candidates) => published.push(candidates.map((candidate) => candidate.exeName)),
  });
  releaseFirstPage(catalogPage({
    rows: [{
      rawExeName: "old.exe",
      appName: "Old",
      lastSeenMs: 1,
      hasNativeRecords: true,
    }],
    nextCursor: { lastSeenMs: 1, rawExeName: "old.exe" },
    hasMore: false,
  }, 1));

  assert.equal(await first, false);
  assert.deepEqual((await second) && published, [["new.exe"]]);
});

await runTest("catalog retries once when pagination revisions change", async () => {
  let call = 0;
  const controller = new ClassificationAppCatalogController({
    loadRecordedPage: async ({ cursor }) => {
      call += 1;
      if (call === 1) {
        return catalogPage({
          rows: [{ rawExeName: "first.exe", appName: "First", lastSeenMs: 2, hasNativeRecords: true }],
          nextCursor: { lastSeenMs: 2, rawExeName: "first.exe" },
          hasMore: true,
        }, 1);
      }
      if (call === 2) {
        return catalogPage({
          rows: [{ rawExeName: "second.exe", appName: "Second", lastSeenMs: 1, hasNativeRecords: true }],
          nextCursor: { lastSeenMs: 1, rawExeName: "second.exe" },
          hasMore: false,
        }, 2);
      }
      return catalogPage({
        rows: cursor
          ? [{ rawExeName: "second.exe", appName: "Second", lastSeenMs: 1, hasNativeRecords: true }]
          : [{ rawExeName: "first.exe", appName: "First", lastSeenMs: 2, hasNativeRecords: true }],
        nextCursor: cursor
          ? { lastSeenMs: 1, rawExeName: "second.exe" }
          : { lastSeenMs: 2, rawExeName: "first.exe" },
        hasMore: cursor === null,
      }, 2);
    },
  });

  const result = await controller.loadAll({ onBatch: () => undefined });
  assert.equal(result && result.sourceRevision, 2);
  assert.deepEqual(result && result.candidates.map((candidate) => candidate.exeName), [
    "first.exe",
    "second.exe",
  ]);
  assert.equal(call, 4);
});

await runTest("catalog rejects repeated mixed revisions without publishing", async () => {
  let call = 0;
  let publishes = 0;
  const controller = new ClassificationAppCatalogController({
    loadRecordedPage: async ({ cursor }) => {
      call += 1;
      return catalogPage({
        rows: [{
          rawExeName: cursor ? "second.exe" : "first.exe",
          appName: cursor ? "Second" : "First",
          lastSeenMs: cursor ? 1 : 2,
          hasNativeRecords: true,
        }],
        nextCursor: cursor
          ? { lastSeenMs: 1, rawExeName: "second.exe" }
          : { lastSeenMs: 2, rawExeName: "first.exe" },
        hasMore: cursor === null,
      }, call % 2 === 1 ? 1 : 2);
    },
  });

  await assert.rejects(
    controller.loadAll({ onBatch: () => { publishes += 1; } }),
    ClassificationAppCatalogRevisionChangedError,
  );
  assert.equal(publishes, 0);
  assert.equal(call, 4);
});

await runTest("snapshot store deduplicates prewarm and page load", async () => {
  let controllerLoads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = new ClassificationAppCatalogSnapshotStore({
    createController: () => ({
      loadAll: async () => {
        controllerLoads += 1;
        await gate;
        return {
          candidates: [{
            exeName: "stable.exe",
            appName: "Stable",
            totalDuration: 0,
            lastSeenMs: 1,
            hasNativeRecords: true,
          }],
          sourceRevision: 1,
        };
      },
    }),
    nowMs: () => 10,
  });

  const prewarm = store.prewarm();
  const pageLoad = store.ensureLoaded();
  assert.equal(controllerLoads, 1);
  assert.equal(store.getSnapshot().committed, null);
  release();
  const [first, second] = await Promise.all([prewarm, pageLoad]);
  assert.equal(first, second);
  assert.equal(store.getSnapshot().status, "ready");
});

await runTest("snapshot store preserves the committed snapshot during refresh failure", async () => {
  let shouldFail = false;
  const stableCandidate = {
    exeName: "stable.exe",
    appName: "Stable",
    totalDuration: 0,
    lastSeenMs: 1,
    hasNativeRecords: true,
  };
  const store = new ClassificationAppCatalogSnapshotStore({
    createController: () => ({
      loadAll: async () => {
        if (shouldFail) throw new Error("busy");
        return { candidates: [stableCandidate], sourceRevision: 1 };
      },
    }),
  });

  await store.ensureLoaded();
  const committed = store.getSnapshot().committed;
  shouldFail = true;
  store.invalidate();
  assert.equal(store.getSnapshot().committed, committed);
  await assert.rejects(store.refresh(), /busy/);
  assert.equal(store.getSnapshot().committed, committed);
  assert.equal(store.getSnapshot().status, "error");
});

await runTest("snapshot store ignores an invalidated refresh that finishes late", async () => {
  let releaseOld!: () => void;
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  let load = 0;
  const store = new ClassificationAppCatalogSnapshotStore({
    createController: () => ({
      loadAll: async () => {
        load += 1;
        if (load === 1) {
          await oldGate;
          return {
            candidates: [{
              exeName: "old.exe",
              appName: "Old",
              totalDuration: 1,
              lastSeenMs: 1,
              hasNativeRecords: true,
            }],
            sourceRevision: 1,
          };
        }
        return {
          candidates: [{
            exeName: "new.exe",
            appName: "New",
            totalDuration: 2,
            lastSeenMs: 2,
            hasNativeRecords: true,
          }],
          sourceRevision: 2,
        };
      },
    }),
  });

  const obsolete = store.ensureLoaded();
  store.invalidate();
  const current = await store.refresh();
  releaseOld();
  await obsolete;

  assert.equal(current?.candidates[0]?.exeName, "new.exe");
  assert.equal(store.getSnapshot().committed?.candidates[0]?.exeName, "new.exe");
  assert.equal(store.getSnapshot().status, "ready");
});

await runTest("snapshot store recovers from a cold failure through retry", async () => {
  let shouldFail = true;
  const store = new ClassificationAppCatalogSnapshotStore({
    createController: () => ({
      loadAll: async () => {
        if (shouldFail) throw new Error("cold failure");
        return {
          candidates: [{
            exeName: "recovered.exe",
            appName: "Recovered",
            totalDuration: 1,
            lastSeenMs: 1,
            hasNativeRecords: true,
          }],
          sourceRevision: 1,
        };
      },
    }),
  });

  await assert.rejects(store.ensureLoaded(), /cold failure/);
  assert.equal(store.getSnapshot().committed, null);
  assert.equal(store.getSnapshot().status, "error");

  shouldFail = false;
  await store.retry();
  assert.equal(store.getSnapshot().status, "ready");
  assert.equal(store.getSnapshot().committed?.candidates[0]?.exeName, "recovered.exe");
});

await runTest("snapshot store reuses an unchanged committed snapshot", async () => {
  const candidate = {
    exeName: "stable.exe",
    appName: "Stable",
    totalDuration: 1,
    lastSeenMs: 1,
    hasNativeRecords: true,
  };
  const store = new ClassificationAppCatalogSnapshotStore({
    createController: () => ({
      loadAll: async () => ({
        candidates: [{ ...candidate }],
        sourceRevision: 1,
      }),
    }),
  });

  const first = await store.ensureLoaded();
  store.invalidate();
  const second = await store.refresh();
  assert.equal(second, first);
  assert.equal(second?.candidates, first?.candidates);
});

console.log(`Passed ${passed} classification app catalog tests`);
