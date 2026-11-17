import {
  applyMappingOverridesReadModelRefresh,
  assert,
  INITIAL_READ_MODEL_REFRESH_STATE,
  loadDashboardRuntimeSnapshotWithDeps,
  resolveReadModelRefreshSignal,
  runTest,
} from "./shared.ts";
import {
  beginDashboardSnapshotCacheLoad,
  clearDashboardSnapshotCache,
  getDashboardSnapshotCache,
} from "../../src/features/dashboard/services/dashboardSnapshotCache.ts";
import type { DashboardSnapshot } from "../../src/features/dashboard/services/dashboardReadModel.ts";

export function runReadModelRuntimeTests() {
  runTest("dashboard cache rejects superseded and invalidated loads without rejecting their callers", async () => {
    clearDashboardSnapshotCache();
    const date = new Date("2026-04-18T09:30:00.000Z");
    const older: DashboardSnapshot = {
    fetchedAtMs: 1,
    icons: {},
    activityRecords: [],
    hasActiveSession: false
  };
    const newer: DashboardSnapshot = {
    fetchedAtMs: 2,
    icons: {},
    activityRecords: [],
    hasActiveSession: false
  };
    let resolveOlder!: (snapshot: DashboardSnapshot) => void;
    const olderGate = new Promise<DashboardSnapshot>((resolve) => { resolveOlder = resolve; });
    const olderLoad = loadDashboardRuntimeSnapshotWithDeps(date, {
      ensureProcessMapperRuntimeReady: async () => {},
      loadDashboardSnapshot: () => olderGate,
      setDashboardSnapshotCache: beginDashboardSnapshotCacheLoad(),
    });
    const newerLoad = loadDashboardRuntimeSnapshotWithDeps(date, {
      ensureProcessMapperRuntimeReady: async () => {},
      loadDashboardSnapshot: async () => newer,
      setDashboardSnapshotCache: beginDashboardSnapshotCacheLoad(),
    });
    await newerLoad;
    resolveOlder(older);
    assert.equal(await olderLoad, older);
    assert.equal(getDashboardSnapshotCache(date), newer);

    let resolveInvalidated!: (snapshot: DashboardSnapshot) => void;
    const invalidatedGate = new Promise<DashboardSnapshot>((resolve) => { resolveInvalidated = resolve; });
    const invalidatedLoad = loadDashboardRuntimeSnapshotWithDeps(date, {
      ensureProcessMapperRuntimeReady: async () => {},
      loadDashboardSnapshot: () => invalidatedGate,
      setDashboardSnapshotCache: beginDashboardSnapshotCacheLoad(),
    });
    clearDashboardSnapshotCache();
    resolveInvalidated(newer);
    assert.equal(await invalidatedLoad, newer);
    assert.equal(getDashboardSnapshotCache(date), null);
  });

  runTest("read model refresh signal combines tracking sync tick with local refresh tick", () => {
    const refreshSignal = resolveReadModelRefreshSignal(3, {
      mappingVersion: 2,
      dataRefreshTick: 4,
    });

    assert.equal(refreshSignal, 7);
  });

  runTest("mapping override refresh bumps both mapping version and local refresh tick", () => {
    const nextState = applyMappingOverridesReadModelRefresh(INITIAL_READ_MODEL_REFRESH_STATE);

    assert.deepEqual(nextState, {
      mappingVersion: 1,
      dataRefreshTick: 1,
    });
    assert.equal(resolveReadModelRefreshSignal(5, nextState), 6);
  });


  runTest("dashboard runtime snapshot waits for mapper runtime before loading and caching", async () => {
    const events: string[] = [];
    const date = new Date("2026-04-18T09:30:00.000Z");
    const snapshot = {
    fetchedAtMs: 123,
    icons: { "QQ.exe": "icon" },
    activityRecords: [],
    hasActiveSession: false
  };

    const result = await loadDashboardRuntimeSnapshotWithDeps(date, {
      ensureProcessMapperRuntimeReady: async () => {
        events.push("ensure");
      },
      loadDashboardSnapshot: async (receivedDate) => {
        events.push(`load:${receivedDate?.toISOString()}`);
        return snapshot;
      },
      setDashboardSnapshotCache: (receivedSnapshot, receivedDate) => {
        events.push(`cache:${receivedDate?.toISOString()}`);
        assert.equal(receivedSnapshot, snapshot);
      },
    });

    assert.equal(result, snapshot);
    assert.deepEqual(events, [
      "ensure",
      `load:${date.toISOString()}`,
      `cache:${date.toISOString()}`,
    ]);
  });

}
