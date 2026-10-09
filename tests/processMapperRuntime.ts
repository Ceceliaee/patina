import assert from "node:assert/strict";
import { initializeProcessMapperRuntime, refreshProcessMapperRuntime } from "../src/app/services/processMapperRuntimeService.ts";
import { ensureProcessMapperRuntimeReady } from "../src/app/services/processMapperRuntimeGate.ts";
import { loadDashboardRuntimeSnapshotWithDeps } from "../src/app/services/readModelRuntimeService.ts";
import { ClassificationService } from "../src/features/classification/services/classificationService.ts";
import { buildDashboardReadModel } from "../src/features/dashboard/services/dashboardReadModel.ts";
import { AppClassification } from "../src/shared/classification/appClassification.ts";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
import { resolveTrackerHealth } from "../src/shared/types/tracking.ts";

export async function verifyProcessMapperRuntime() {
  const host = globalThis as unknown as { window?: unknown };
  const originalWindow = host.window;
  const settings = new Map<string, string>([["__classification_manual_confirmation_migration::v1", "1"]]);
  const day = new Date(2026, 9, 8).getTime();
  const now = day + 12 * 3600000;
  const records = ["weixin.exe", "wechatappex.exe"].map((exeName, index) => ({
    exeName, appName: index ? "微信公众号" : "微信", startTime: day + index * 3600000,
    endTime: day + index * 3600000 + (index ? 1 : 13) * 60000,
  }));
  const originalRecords = structuredClone(records);
  const dashboard = () => buildDashboardReadModel([], resolveTrackerHealth(now, now, 8000), now, [], records, [], true);
  const expectRows = (keys: string[]) => {
    const result = dashboard();
    assert.deepEqual(result.topApplications.map(row => row.exeName), keys);
    assert.equal(result.totalTrackedTime, 840000);
    assert.deepEqual(records, originalRecords);
  };
  const linkKey = "__app_link::wechatappex.exe";
  let failLinks = false;
  let holdRead: (() => Promise<void>) | null = null;
  host.window = { __TAURI_INTERNALS__: { invoke: async (command: string, args: Record<string, unknown>) => {
    if (command === "cmd_commit_classification_settings") {
      for (const mutation of args.mutations as Array<{ key: string; value: string | null }>) {
        if (mutation.key.startsWith("__app_link::")) {
          const parent = JSON.parse(mutation.value!).parent as string | null;
          if (parent === null) settings.delete(mutation.key);
          else settings.set(mutation.key, parent);
        } else if (mutation.value === null) settings.delete(mutation.key);
        else settings.set(mutation.key, mutation.value);
      }
      return;
    }
    assert.equal(command, "plugin:sql|select");
    const query = String(args.query);
    const values = args.values as string[];
    if (query.includes("SELECT DISTINCT exe_name")) return records.map(row => ({ exe_name: row.exeName }));
    if (query.includes("WHERE key = ?")) return settings.has(values[0]) ? [{ value: settings.get(values[0]) }] : [];
    const prefix = values[0].slice(0, -1);
    const rows = Array.from(settings, ([key, value]) => ({ key, value })).filter(row => row.key.startsWith(prefix));
    if (prefix === "__app_link::" && failLinks) throw new Error("controlled link read failure");
    if (prefix === "__app_link::" && holdRead) {
      const hold = holdRead;
      holdRead = null;
      await hold();
    }
    return rows;
  } } };
  try {
    AppClassification.setAppLinks({});
    settings.set(linkKey, "weixin.exe");
    await initializeProcessMapperRuntime();
    expectRows(["weixin.exe"]);
    assert.equal(dashboard().topApplications[0].duration, 840000);

    settings.delete(linkKey);
    await refreshProcessMapperRuntime();
    expectRows(["weixin.exe", "wechatappex.exe"]);
    const emptyDraft = { overrides: {}, webDomainOverrides: {}, categoryColorOverrides: {}, categoryLabelOverrides: {}, persistedCategoryIds: [], deletedCategories: [], appLinks: {} };
    const linkedDraft = { ...emptyDraft, appLinks: { "wechatappex.exe": "weixin.exe" } };
    await ClassificationService.commitDraftChanges(emptyDraft, linkedDraft);
    expectRows(["weixin.exe"]);
    await refreshProcessMapperRuntime();
    expectRows(["weixin.exe"]);

    failLinks = true;
    await assert.rejects(ensureProcessMapperRuntimeReady(), /controlled link read failure/);
    await assert.rejects(loadDashboardRuntimeSnapshotWithDeps(new Date(now), {
      ensureProcessMapperRuntimeReady,
      loadDashboardSnapshot: async () => { throw new Error("must not read dashboard after failed classification"); },
      setDashboardSnapshotCache: () => assert.fail("must not publish a failed classification snapshot"),
    }), /controlled link read failure/);
    expectRows(["weixin.exe"]);
    failLinks = false;
    settings.set("__app_link::weixin.exe", "wechatappex.exe");
    await assert.rejects(refreshProcessMapperRuntime(), /Invalid application association/);
    expectRows(["weixin.exe"]);
    settings.delete("__app_link::weixin.exe");
    settings.set(linkKey, "generic-parent.exe");
    await ensureProcessMapperRuntimeReady();
    expectRows(["weixin.exe", "generic-parent.exe"]);
    settings.set("__app_link::weixin.exe", "generic-parent.exe");
    await refreshProcessMapperRuntime();
    expectRows(["generic-parent.exe"]);
    settings.delete("__app_link::weixin.exe");
    settings.delete(linkKey);
    await refreshProcessMapperRuntime();
    expectRows(["weixin.exe", "wechatappex.exe"]);

    let release!: () => void;
    let entered!: () => void;
    const readEntered = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    holdRead = async () => { entered(); await blocked; };
    const pending = refreshProcessMapperRuntime();
    await readEntered;
    try {
      await ClassificationService.commitDraftChanges(emptyDraft, linkedDraft);
      expectRows(["weixin.exe"]);
    } finally { release(); }
    await pending;
    expectRows(["weixin.exe"]);
    console.log("PASS persisted application links: startup, refresh, failure, retry, unlink and overlapping save");
  } finally {
    host.window = originalWindow;
    AppClassification.setAppLinks({});
    ProcessMapper.clearUserOverrides();
    ProcessMapper.setCategoryDefaultColorAssignmentPersistence(null);
    ProcessMapper.setCategoryDefaultColorAssignments({});
    ProcessMapper.setCategoryColorOverrides({});
    ProcessMapper.setCategoryLabelOverrides({});
    ProcessMapper.setDeletedCategories([]);
  }
}
