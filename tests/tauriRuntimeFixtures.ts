import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StorageSnapshot } from "../src/platform/storage/storageRuntimeGateway.ts";
import { readRuntimeDatabaseRows } from "./runtimeDatabase.ts";
import { verifyAppIconRuntime } from "./tauriAppIconRuntime.ts";
import { verifyBackupRetirementRuntime } from "./tauriBackupRetirementRuntime.ts";
import {
  CdpConnection,
  assertIsolatedTempPath,
  waitFor,
} from "./uiBrowserSmoke/browserHarness.ts";

import { evaluate } from "./tauriRuntimeHarness.ts";
export function verifyDatabase(dbPath: string) {
  const script = [
    "import os, sqlite3, sys",
    "db = sqlite3.connect(sys.argv[1])",
    "integrity = db.execute('PRAGMA integrity_check').fetchone()[0]",
    "value = db.execute(\"SELECT value FROM settings WHERE key='refresh_interval_secs'\").fetchone()",
    "migration = db.execute('SELECT MAX(version) FROM _sqlx_migrations').fetchone()",
    "states = dict(db.execute('SELECT model_name, state FROM read_model_state'))",
    "scheduled = db.execute('SELECT enabled, cadence, weekday, local_time_minutes, retention_count FROM scheduled_backup_config WHERE id = 1').fetchone()",
    "scheduled_columns = {row[1] for row in db.execute('PRAGMA table_info(scheduled_backup_config)')}",
    "run_columns = {row[1] for row in db.execute('PRAGMA table_info(scheduled_backup_runs)')}",
    "scheduled_export = db.execute('SELECT enabled, cadence, weekday, local_time_minutes, format, target_dir FROM scheduled_export_config WHERE id = 1').fetchone()",
    "scheduled_export_columns = {row[1] for row in db.execute('PRAGMA table_info(scheduled_export_config)')}",
    "scheduled_export_run_columns = {row[1] for row in db.execute('PRAGMA table_info(scheduled_export_runs)')}",
    "tables = {row[0] for row in db.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")}",
    "db.close()",
    "assert integrity == 'ok', integrity",
    "assert value == ('77',), value",
    "assert migration == (17,), migration",
    "assert states == {'app_catalog': 'ready', 'activity_hourly': 'ready'}, states",
    "assert scheduled == (0, 'weekly', 5, 1260, 1), scheduled",
    "assert {'target_kind', 'target_identity'} <= scheduled_columns, scheduled_columns",
    "assert {'target_kind', 'remote_etag'} <= run_columns, run_columns",
    "assert scheduled_export[:5] == (0, 'daily', None, 1260, 'csv'), scheduled_export",
    "normalize_path = lambda value: os.path.normcase(os.path.realpath(value)).replace('\\\\', '/').removeprefix('//?/')",
    "scheduled_export_target = normalize_path(scheduled_export[5])",
    "expected_export_target = normalize_path(os.path.join(os.path.dirname(sys.argv[1]), 'exports'))",
    "assert scheduled_export_target == expected_export_target, (scheduled_export_target, expected_export_target)",
    "assert {'format', 'selected_fields_json', 'plan_generation', 'schedule_anchor_at_ms'} <= scheduled_export_columns, scheduled_export_columns",
    "assert {'logical_start_date', 'logical_end_date', 'phase', 'status', 'sha256'} <= scheduled_export_run_columns, scheduled_export_run_columns",
    "assert {'recorded_app_catalog', 'activity_hourly_effective', 'activity_summary_dirty_ranges', 'app_catalog_dirty_keys', 'web_activity_revision', 'scheduled_backup_config', 'scheduled_backup_runs', 'scheduled_export_config', 'scheduled_export_runs'} <= tables, tables",
  ].join("; ");
  const result = spawnSync("python", ["-c", script, dbPath], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  assert.equal(result.status, 0, `database verification failed: ${result.error?.message || result.stderr || result.stdout}`);
}

export function seedWebActivitySegment(dbPath: string) {
  const script = [
    "import sqlite3, sys",
    "db = sqlite3.connect(sys.argv[1])",
    "db.execute(\"INSERT INTO web_activity_segments (browser_client_id, browser_kind, browser_exe_name, domain, normalized_domain, start_time, end_time, duration, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\", ('runtime-smoke', 'chromium', 'chrome.exe', 'Example.COM', 'example.com', 1000, 3500, 2500, 'runtime-smoke', 1000, 3500))",
    "db.execute(\"INSERT INTO web_activity_segments (browser_client_id, browser_kind, browser_exe_name, domain, normalized_domain, start_time, end_time, duration, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\", ('runtime-smoke-2', 'chromium', 'chrome.exe', 'Docs.EXAMPLE', 'docs.example', 2000, 3000, 1000, 'runtime-smoke', 2000, 3000))",
    "db.commit()",
    "db.close()",
  ].join("; ");
  const result = spawnSync("python", ["-c", script, dbPath], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  assert.equal(result.status, 0, `web activity seed failed: ${result.error?.message || result.stderr || result.stdout}`);
}

export async function verifyBackupReplaceRuntime(client: CdpConnection, root: string) {
  assertIsolatedTempPath(root, "patina-tauri-e2e-");
  const dbPath = join(root, "data", "patina.db");
  const storage = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_get_storage_snapshot")`) as StorageSnapshot;
  assert.equal(realpathSync(storage.paths.databasePath).toLowerCase(), realpathSync(dbPath).toLowerCase());
  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [{ key: "tracking_paused", value: "1" }],
  })`);
  const fixtureStart = await evaluate(client, `(() => {
    const day = new Date(); day.setDate(day.getDate() - 1); day.setHours(12, 0, 0, 0);
    return day.getTime();
  })()`) as number;
  await verifyBackupRetirementRuntime(expression => evaluate(client, expression), root);
  const seed = (name: string, exe: string, start: number, duration: number) => {
    const result = spawnSync("python", ["-c", [
      "import sqlite3, sys",
      "db = sqlite3.connect(sys.argv[1])",
      "start, duration = int(sys.argv[4]), int(sys.argv[5])",
      "db.execute('INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration, continuity_group_start_time) VALUES (?, ?, ?, ?, ?, ?, ?)', (sys.argv[2], sys.argv[3], '', start, start + duration, duration, start))",
      "db.execute(\"INSERT OR REPLACE INTO settings(key,value) VALUES('background_optimization','0')\")",
      "db.execute(\"INSERT OR REPLACE INTO settings(key,value) VALUES('minimize_behavior','widget'),('widget_placement','broken'),('widget_expansion_preference','pinned'),('widget_side','left'),('widget_anchor_y','0.3')\")",
      "db.commit()",
      "db.close()",
    ].join("; "), dbPath, name, exe, String(start), String(duration)], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, `isolated restore fixture seed failed: ${result.stderr || result.stdout}`);
  };
  seed("Runtime Restore Original", "runtime-restore-original.exe", fixtureStart, 120_000);
  const backupPath = join(root, "restore-success.zip");
  assert.equal(existsSync(backupPath), false);
  const exportedPath = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_export_backup", {
    backupPath: ${JSON.stringify(backupPath)},
  })`);
  assert.equal(exportedPath, backupPath);
  const preview = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_preview_backup", {
    backupPath: ${JSON.stringify(backupPath)},
  })`) as { hash: string; format_kind: string; restore_supported: boolean };
  assert.equal(preview.format_kind, "sqlite_snapshot");
  assert.equal(preview.restore_supported, true);
  assert.match(preview.hash, /^[a-f0-9]{64}$/);
  seed("Runtime Restore Added", "runtime-restore-added.exe", fixtureStart + 180_000, 240_000);
  await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [{ key: "refresh_interval_secs", value: "88" }],
  })`);
  assert.equal(await evaluate(client, `(() => {
    const nav = document.querySelector('[data-sidebar-nav-item="history"]');
    if (!nav) return false; nav.click(); return true;
  })()`), true);
  await waitFor("History date navigation before restore", async () => evaluate(client,
    `Boolean(document.querySelector('.history-date-label'))`), 10_000);
  assert.equal(await evaluate(client, `(() => {
    const previous = document.querySelector('.history-date-label')?.parentElement?.parentElement?.querySelector(':scope > button');
    if (!previous) return false; previous.click(); return true;
  })()`), true);
  const historyContent = `(() => {
    const page = document.querySelector('[data-history-content-state]');
    return { state: page?.getAttribute('data-history-content-state'), text: page?.textContent ?? '' };
  })()`;
  await waitFor("History warms the post-backup fixture", async () => {
    const view = await evaluate(client, historyContent) as { state: string; text: string };
    return view.state === "ready" && view.text.includes("Runtime Restore Original")
      && view.text.includes("Runtime Restore Added");
  }, 10_000);

  // Observe command names through CDP without replacing Tauri's IPC or replies.
  await verifyAppIconRuntime((expression) => evaluate(client, expression), dbPath);
  const cacheClearCommands = new Set<string>();
  const mutationCommands = new Set<string>();
  const stopObserving = client.onMessage((message) => {
    if(message.method !== "Network.requestWillBeSent") return;
    const request = (message.params as { request?: { url?: string } } | undefined)?.request;
    if(!request?.url) return;
    const command = new URL(request.url).pathname.slice(1);
    if(["cmd_clear_history_bootstrap_snapshot_payload", "cmd_clear_data_bootstrap_snapshot_payload"].includes(command)) {
      cacheClearCommands.add(command);
    }
    if(["cmd_commit_classification_settings", "cmd_delete_sessions_by_exe_names"].includes(command)) {
      mutationCommands.add(command);
    }
  });
  await client.command("Network.enable");
  const listener = await evaluate(client, `(async () => {
    window.__patinaRestoreReasons = [];
    window.__patinaE2eEvents = [];
    const handler = window.__TAURI_INTERNALS__.transformCallback(event => window.__patinaRestoreReasons.push(event.payload?.reason));
    const eventId = await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
      event: "tracking-data-changed", target: { kind: "Any" }, handler,
    });
    return { handler, eventId };
  })()`) as { handler: number; eventId: number };
  try {
    // Exercise mutations before replace, which restores this test's original
    // snapshot afterward. All commands and UI actions use the isolated database.
    const readSettledStatus = async () => {
      const state = await waitFor("mutation projections settle", async () => {
        const value = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_get_activity_read_model_status")`) as {
          sourceRevision: number; appCatalogState: string; activityHourlyState: string;
          dirtyAppCount: number; dirtyRangeCount: number;
        };
        return value.appCatalogState === "ready" && value.activityHourlyState === "ready"
          && value.dirtyAppCount === 0 && value.dirtyRangeCount === 0 ? value : null;
      }, 10_000);
      return state;
    };
    const readFixtureAggregate = async () => evaluate(client,
      `window.__TAURI_INTERNALS__.invoke("cmd_get_activity_aggregate_range", {
        startMs: ${fixtureStart}, endMs: ${fixtureStart + 3 * 3_600_000}, bucketBoundariesMs: null,
      })`) as Promise<{
        sourceRevision: number;
        records: Array<{ exeName: string; startTime: number; endTime: number }>;
      }>;
    const resetMutationObservation = async () => {
      cacheClearCommands.clear();
      mutationCommands.clear();
      await evaluate(client, `window.__patinaRestoreReasons = []; window.__patinaE2eEvents = []`);
    };
    const waitForMutationRefresh = async (reason?: string) => {
      await waitFor(`mutation cache invalidation${reason ? `: ${reason}` : ""}`, async () => (
        cacheClearCommands.size === 2 && (!reason || await evaluate(client,
          `window.__patinaRestoreReasons.includes(${JSON.stringify(reason)})`))
      ), 10_000);
    };
    const waitForHistoryFixture = async (present: string[], absent: string[] = []) => {
      await waitFor(`History fixture: ${JSON.stringify({ present, absent })}`, async () => {
        const view = await evaluate(client, historyContent) as { state: string; text: string };
        return view.state === "ready" && present.every(name => view.text.includes(name))
          && absent.every(name => !view.text.includes(name));
      }, 10_000);
    };

    const csvPath = join(root, "runtime-import.csv");
    const exactStart = fixtureStart + 3_600_000;
    writeFileSync(csvPath, [
      "record_type,start_time,end_time,duration_ms,exe_name,app_name,title,category",
      `exact_session,${new Date(exactStart).toISOString()},${new Date(exactStart + 360_000).toISOString()},360000,runtime-import-exact.exe,Runtime Import Exact,,`,
      `hour_bucket,${new Date(fixtureStart + 2 * 3_600_000).toISOString()},,600000,runtime-import-bucket.exe,Runtime Import Bucket,,`,
      "",
    ].join("\n"), { encoding: "utf8", flag: "wx" });
    const importPreview = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_preview_canonical_import", {
      filePath: ${JSON.stringify(csvPath)},
    })`) as { filePath: string; fileFingerprint: string; validRecords: number; errorRecords: number };
    assert.equal(importPreview.filePath, csvPath);
    assert.equal(importPreview.validRecords, 2);
    assert.equal(importPreview.errorRecords, 0);
    assert.match(importPreview.fileFingerprint, /^[a-f0-9]{64}$/);
    const beforeImport = await readSettledStatus();
    await resetMutationObservation();
    const imported = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_canonical_import", {
      filePath: ${JSON.stringify(csvPath)}, expectedFingerprint: ${JSON.stringify(importPreview.fileFingerprint)},
      classificationMutations: [],
    })`) as { batchId: string | null; importedRecords: number; exactSessions: number; hourBuckets: number };
    assert.ok(imported.batchId);
    assert.equal(imported.importedRecords, 2);
    assert.equal(imported.exactSessions, 1);
    assert.equal(imported.hourBuckets, 1);
    await waitForMutationRefresh("external-data-imported");
    await waitForHistoryFixture(["Runtime Import Exact", "Runtime Restore Original"]);
    const afterImport = await readSettledStatus();
    assert.ok(afterImport.sourceRevision > beforeImport.sourceRevision);
    const importedAggregate = await readFixtureAggregate();
    assert.equal(importedAggregate.sourceRevision, afterImport.sourceRevision);
    assert.deepEqual(importedAggregate.records.filter(row => row.exeName.startsWith("runtime-import-"))
      .map(row => ({ exe: row.exeName, duration: row.endTime - row.startTime }))
      .sort((left, right) => left.exe.localeCompare(right.exe)), [
      { exe: "runtime-import-bucket.exe", duration: 600_000 },
      { exe: "runtime-import-exact.exe", duration: 360_000 },
    ]);
    const batches = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_list_import_batches")`) as Array<{ id: string; totalRecords: number }>;
    assert.equal(batches.find(batch => batch.id === imported.batchId)?.totalRecords, 2);

    await resetMutationObservation();
    assert.deepEqual(await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_delete_import_batch", {
      batchId: ${JSON.stringify(imported.batchId)},
    })`), { deletedExactSessions: 1, deletedHourBuckets: 1 });
    await waitForMutationRefresh("external-import-deleted");
    await waitForHistoryFixture(["Runtime Restore Original"], ["Runtime Import Exact", "Runtime Import Bucket"]);
    const afterImportDeletion = await readSettledStatus();
    assert.ok(afterImportDeletion.sourceRevision > afterImport.sourceRevision);
    const deletedImportAggregate = await readFixtureAggregate();
    assert.equal(deletedImportAggregate.sourceRevision, afterImportDeletion.sourceRevision);
    assert.deepEqual(deletedImportAggregate.records.filter(row => row.exeName.startsWith("runtime-import-")), []);
    assert.equal((await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_list_import_batches")`) as Array<{ id: string }>)
      .some(batch => batch.id === imported.batchId), false);

    // These owners invalidate frontend caches through UI callbacks, not a
    // synthetic tracking-data-changed event. Observe their real IPC requests.
    const openOriginalClassificationMenu = async () => {
      assert.equal(await evaluate(client, `(() => {
        const trigger = Array.from(document.querySelectorAll('.history-day-distribution-detail-trigger'))
          .find(button => button.getAttribute('aria-label')?.includes('Runtime Restore Original'));
        if (!trigger) return false;
        const bounds = trigger.getBoundingClientRect();
        trigger.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
          clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }));
        return true;
      })()`), true);
      await waitFor("classification category trigger", async () => evaluate(client,
        `Boolean(document.querySelector('.quick-classification-menu [role="menuitem"][aria-haspopup="menu"]:not(:disabled)'))`), 10_000);
      await evaluate(client, `document.querySelector('.quick-classification-menu [role="menuitem"][aria-haspopup="menu"]').click()`);
      await waitFor("classification categories loaded", async () => evaluate(client,
        `Boolean(document.querySelector('.quick-classification-category-menu [role="menuitemradio"]:not(:disabled)'))`), 10_000);
    };
    await resetMutationObservation();
    await openOriginalClassificationMenu();
    const selectedCategoryLabel = await evaluate(client, `(() => {
      const option = document.querySelector('.quick-classification-category-menu [role="menuitemradio"]');
      const label = option.textContent.trim(); option.click(); return label;
    })()`) as string;
    assert.ok(selectedCategoryLabel);
    await waitForMutationRefresh();
    assert.equal(mutationCommands.has("cmd_commit_classification_settings"), true);
    await waitForHistoryFixture(["Runtime Restore Original"]);
    const overrideRows = await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT value FROM settings WHERE key = ?", ["__app_override::runtime-restore-original.exe"]) as Array<{ value: string }>;
    assert.equal(overrideRows.length, 1);
    assert.equal(JSON.parse(overrideRows[0].value).category, "ai");
    const afterClassification = await readSettledStatus();
    assert.equal(afterClassification.sourceRevision, afterImportDeletion.sourceRevision,
      "classification-only changes must not dirty activity facts");
    assert.deepEqual(await readFixtureAggregate(), deletedImportAggregate);
    await openOriginalClassificationMenu();
    assert.equal(await evaluate(client, `(() => {
      const selected = document.querySelector('.quick-classification-category-menu [aria-checked="true"]');
      return selected?.textContent.trim();
    })()`), selectedCategoryLabel);
    await evaluate(client, `window.dispatchEvent(new Event('blur'))`);

    await resetMutationObservation();
    assert.equal(await evaluate(client, `(() => {
      const nav = document.querySelector('[data-sidebar-nav-item="mapping"]');
      if (!nav) return false; nav.click(); return true;
    })()`), true);
    try {
      await waitFor("classification fixture delete control", async () => evaluate(client,
        `Boolean(document.querySelector('[data-classification-app="runtime-restore-original.exe"] .qp-app-mapping-delete:not(:disabled)'))`), 10_000);
    } catch(error) {
      console.error("PATINA_CLASSIFICATION_FAILURE", await evaluate(client, `(() => {
        const page = document.querySelector('[data-classification-content-state]');
        return {
          view: document.querySelector('main.qp-canvas')?.getAttribute('data-presented-view'),
          state: page?.getAttribute('data-classification-content-state'),
          text: page?.textContent?.slice(0, 4000),
          apps: Array.from(document.querySelectorAll('[data-classification-app]')).map(row => row.getAttribute('data-classification-app')),
          search: page?.querySelector('input')?.value,
          mode: localStorage.getItem('patina:classification-object-mode'),
          dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map(dialog => dialog.textContent?.slice(0, 200)),
        };
      })()`));
      throw error;
    }
    await evaluate(client, `document.querySelector('[data-classification-app="runtime-restore-original.exe"] .qp-app-mapping-delete').click()`);
    await waitFor("isolated fixture deletion confirmation", async () => evaluate(client,
      `Boolean(Array.from(document.querySelectorAll('[role="dialog"]')).find(dialog =>
        dialog.textContent.includes('Runtime Restore Original'))?.querySelector('.qp-button-danger:not(:disabled)'))`), 10_000);
    await evaluate(client, `Array.from(document.querySelectorAll('[role="dialog"]')).find(dialog =>
      dialog.textContent.includes('Runtime Restore Original')).querySelector('.qp-button-danger').click()`);
    await waitForMutationRefresh();
    assert.equal(mutationCommands.has("cmd_delete_sessions_by_exe_names"), true);
    await waitFor("classification catalog removes deleted fixture", async () => evaluate(client,
      `document.querySelector('[data-classification-content-state]')?.getAttribute('data-classification-content-state') === 'ready'
        && !document.querySelector('[data-classification-app="runtime-restore-original.exe"]')`), 10_000);
    const afterCleanup = await readSettledStatus();
    assert.ok(afterCleanup.sourceRevision > afterClassification.sourceRevision);
    const cleanedAggregate = await readFixtureAggregate();
    assert.equal(cleanedAggregate.sourceRevision, afterCleanup.sourceRevision);
    assert.deepEqual(cleanedAggregate.records.filter(row => row.exeName === "runtime-restore-original.exe"), []);
    await evaluate(client, `document.querySelector('[data-sidebar-nav-item="history"]').click()`);
    await waitFor("History date navigation after cleanup", async () => evaluate(client,
      `Boolean(document.querySelector('.history-date-label'))`), 10_000);
    await evaluate(client, `document.querySelector('.history-date-label').parentElement.parentElement.querySelector(':scope > button').click()`);
    await waitForHistoryFixture(["Runtime Restore Added"], ["Runtime Restore Original"]);

    await resetMutationObservation();
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_restore_backup", {
      backupPath: ${JSON.stringify(backupPath)}, hash: ${JSON.stringify(preview.hash)}, restoreStrategy: "merge",
    })`);
    await waitForMutationRefresh("backup-restored");
    await waitFor("merge settings refresh event", async () => evaluate(client,
      `window.__patinaE2eEvents.includes('app-settings-changed')`), 10_000);
    await waitForHistoryFixture(["Runtime Restore Original", "Runtime Restore Added"]);
    const afterMerge = await readSettledStatus();
    assert.ok(afterMerge.sourceRevision > afterCleanup.sourceRevision);
    const mergedAggregate = await readFixtureAggregate();
    assert.equal(mergedAggregate.sourceRevision, afterMerge.sourceRevision);
    assert.deepEqual(mergedAggregate.records.filter(row => row.exeName === "runtime-restore-original.exe")
      .map(row => row.endTime - row.startTime), [120_000]);
    assert.deepEqual(await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT value FROM settings WHERE key = ?", ["refresh_interval_secs"]), [{ value: "88" }]);
    console.log("PATINA_MUTATION_RUNTIME_REPORT", JSON.stringify({
      environment: "isolated debug Tauri/WebView2 with real SQLite", importRecords: 2,
      importedDurationsMs: [360_000, 600_000], deletedImportBatch: true,
      classificationCategory: "ai", classificationKeptActivityRevision: true,
      cleanupViaClassificationUi: true, mergeRestoredNativeDurationMs: 120_000,
      mergePreservedCurrentSetting: "88", historyRefreshedAfterEachMutation: true,
      revisions: [beforeImport, afterImport, afterImportDeletion, afterClassification, afterCleanup, afterMerge]
        .map(state => state.sourceRevision),
    }));
    // Replace must apply the backup's paused policy after a different live policy.
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
      mutations: [{ key: "tracking_paused", value: "0" }],
    })`);
    assert.deepEqual(await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT value FROM settings WHERE key = ?", ["tracking_paused"]), [{ value: "0" }]);
    await resetMutationObservation();
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_restore_backup", {
      backupPath: ${JSON.stringify(backupPath)}, hash: ${JSON.stringify(preview.hash)}, restoreStrategy: "replace",
    })`);
    const replaceCompletedAtMs = Date.now();
    const restored = await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT exe_name, duration FROM sessions WHERE exe_name IN (?, ?) ORDER BY exe_name", ["runtime-restore-original.exe", "runtime-restore-added.exe"]);
    assert.deepEqual(restored, [{ exe_name: "runtime-restore-original.exe", duration: 120_000 }]);
    assert.deepEqual(await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT value FROM settings WHERE key = ?", ["__app_override::runtime-restore-original.exe"]), []);
    assert.deepEqual(await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT value FROM settings WHERE key = ?", ["refresh_interval_secs"]), [{ value: "77" }]);
    assert.deepEqual(await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT value FROM settings WHERE key = ?", ["tracking_paused"]), [{ value: "1" }]);
    await waitFor("restore events and frontend cache invalidation", async () => {
      const events = await evaluate(client, `window.__patinaRestoreReasons.includes('backup-restored')
        && window.__patinaE2eEvents.includes('app-settings-changed')`);
      return events && cacheClearCommands.size === 2;
    }, 10_000);
    await waitFor("History replaces its warmed post-backup snapshot", async () => {
      const view = await evaluate(client, historyContent) as { state: string; text: string };
      return view.state === "ready" && view.text.includes("Runtime Restore Original")
        && !view.text.includes("Runtime Restore Added");
    }, 10_000);
    await waitFor("restored activity projections rebuild", async () => {
      const state = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_get_activity_read_model_status")`) as {
        appCatalogState: string; activityHourlyState: string; dirtyAppCount: number; dirtyRangeCount: number;
      };
      return state.appCatalogState === "ready" && state.activityHourlyState === "ready"
        && state.dirtyAppCount === 0 && state.dirtyRangeCount === 0;
    }, 10_000);
    const aggregate = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_get_activity_aggregate_range", {
      startMs: ${fixtureStart}, endMs: ${fixtureStart + 600_000}, bucketBoundariesMs: null,
    })`) as { records: Array<{ exeName: string; startTime: number; endTime: number }> };
    assert.deepEqual(aggregate.records.filter(row => row.exeName.startsWith("runtime-restore-"))
      .map(row => ({ exe: row.exeName, duration: row.endTime - row.startTime })),
      [{ exe: "runtime-restore-original.exe", duration: 120_000 }]);
    const readHeartbeat = async () => {
      const rows = await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT value FROM settings WHERE key = ?", ["__tracker_last_heartbeat_ms"]) as Array<{ value: string }>;
      return Number(rows[0]?.value ?? 0);
    };
    await waitFor("paused tracker writes to the restored database", async () => (
      await readHeartbeat() > replaceCompletedAtMs
    ), 10_000);
    const firstRestoredHeartbeat = await readHeartbeat();
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
      mutations: [{ key: "tracking_paused", value: "0" }],
    })`);
    await waitFor("resumed tracker continues writing to the restored database", async () => (
      await readHeartbeat() > firstRestoredHeartbeat
    ), 10_000);
    assert.deepEqual(await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT value FROM settings WHERE key = ?", ["background_optimization"]), [{ value: "0" }]);
    await assert.rejects(() => evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_set_background_optimization", {backgroundOptimization:false})`));
    await assert.rejects(() => evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {mutations:[{key:"language",value:"en-US"},{key:"background_optimization",value:"0"}]})`));
    assert.deepEqual(await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT key FROM settings WHERE key IN (?, ?, ?, ?, ?)", ["minimize_behavior", "widget_placement", "widget_expansion_preference", "widget_side", "widget_anchor_y"]), []);
    await assert.rejects(() => evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {mutations:[{key:"minimize_behavior",value:"widget"}]})`));
    assert.deepEqual(readdirSync(join(root, "data")).filter(name => name.startsWith(".patina-restore-")), []);
    console.log("PATINA_BACKUP_REPLACE_RUNTIME_REPORT", JSON.stringify({
      environment: "isolated debug Tauri/WebView2 with real SQLite",
      format: preview.format_kind, strategy: "replace", previewHashVerified: true,
      typedReadAfterReplace: true, originalDurationMs: 120_000, postBackupFactRemoved: true,
      frontendCacheClearCommands: [...cacheClearCommands].sort(), historyWarmSnapshotRefreshed: true,
      projectionRebuilt: true, recoveryFilesCleaned: true,
      restoredPauseSettingReplacedDifferentLiveValue: true,
      pausedTrackerPersistedAfterReplace: true, resumedTrackerPersistedAgain: true,
    }));
  } finally {
    stopObserving();
    await client.command("Network.disable");
    await evaluate(client, `(async () => {
      await window.__TAURI_INTERNALS__.invoke("plugin:event|unlisten", {
        event: "tracking-data-changed", eventId: ${listener.eventId},
      });
      window.__TAURI_INTERNALS__.unregisterCallback(${listener.handler});
      delete window.__patinaRestoreReasons;
    })()`);
  }
}
