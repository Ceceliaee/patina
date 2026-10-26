import assert from "node:assert/strict";
import { join } from "node:path";
import { readRuntimeDatabaseRows } from "./runtimeDatabase.ts";
import { verifyAnonymousActivityRuntime } from "./tauriAnonymousActivityRuntime.ts";
import { verifyRestoredBackgroundPolicy } from "./tauriBackgroundPolicyRuntime.ts";
import { verifyLinkedApplicationsRuntime } from "./tauriLinkedApplicationsRuntime.ts";
import { verifyWebDavRuntime } from "./tauriWebDavRuntime.ts";
import { deleteWebHistoryRuntime, verifyAutomaticGroupingBackupRuntime, verifyWebLinksRuntime } from "./tauriWebLinksRuntime.ts";
import {
  waitFor
} from "./uiBrowserSmoke/browserHarness.ts";

import { seedWebActivitySegment, verifyBackupReplaceRuntime, verifyDatabase } from "./tauriRuntimeFixtures.ts";
import { RuntimeSession, evaluate } from "./tauriRuntimeHarness.ts";

const WEBVIEW_STARTUP_TIMEOUT_MS = 30_000;
export async function run(session: RuntimeSession) {
  const { root, logs, devtoolsPort, frontendDistDir } = session;
  let client = session.client!;
  try {
    await session.show();
    await verifyWebLinksRuntime(expression => evaluate(client, expression));
    await verifyAutomaticGroupingBackupRuntime(expression => evaluate(client, expression), root);
    const storage = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_get_storage_snapshot")`);
    assert.equal(typeof storage, "object");
    await verifyLinkedApplicationsRuntime((expression) => evaluate(client!, expression));

    // Freeze the isolated tracker before asserting read-model contents. A live
    // foreground sample is valid here, so the test waits for projections to
    // drain instead of assuming the source revision will remain zero.
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [{ key: "tracking_paused", value: "1" }],
  })`);

    let readySourceRevision: number | null = null;
    let readySourceRevisionPolls = 0;
    const readModelStatus = await waitFor(
      "activity read models ready",
      async () => {
        const value = await evaluate(
          client!,
          `window.__TAURI_INTERNALS__.invoke("cmd_get_activity_read_model_status")`,
        ) as {
          sourceRevision?: number;
          appCatalogState?: string;
          activityHourlyState?: string;
          dirtyAppCount?: number;
          dirtyRangeCount?: number;
        };
        const isReady = Number.isSafeInteger(value.sourceRevision)
          && value.appCatalogState === "ready"
          && value.activityHourlyState === "ready"
          && value.dirtyAppCount === 0
          && value.dirtyRangeCount === 0;
        if(!isReady) {
          readySourceRevision = null;
          readySourceRevisionPolls = 0;
          return null;
        }
        if(value.sourceRevision === readySourceRevision) {
          readySourceRevisionPolls += 1;
        } else {
          readySourceRevision = value.sourceRevision!;
          readySourceRevisionPolls = 1;
        }
        return readySourceRevisionPolls >= 3 ? value : null;
      },
      10_000,
    ) as {
      sourceRevision: number;
      appCatalogState: string;
      activityHourlyState: string;
      activityCoverageStartMs: number | null;
      activityCoverageEndMs: number | null;
      dirtyAppCount: number;
      dirtyRangeCount: number;
    };
    assert.ok(Number.isSafeInteger(readModelStatus.sourceRevision));
    assert.ok(readModelStatus.sourceRevision >= 0);
    assert.equal(readModelStatus.appCatalogState, "ready");
    assert.equal(readModelStatus.activityHourlyState, "ready");
    assert.equal(readModelStatus.dirtyAppCount, 0);
    assert.equal(readModelStatus.dirtyRangeCount, 0);

    const catalogPage = await evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("cmd_get_recorded_app_catalog_page", {
      cursor: null,
      searchQuery: "",
      limit: 50,
    })`,
    ) as {
      rows: unknown[];
      nextCursor: unknown;
      hasMore: boolean;
      readPath: string;
      fallbackReason: unknown;
      sourceRevision: number;
    };
    assert.ok(Array.isArray(catalogPage.rows));
    assert.equal(catalogPage.hasMore, false);
    if(catalogPage.nextCursor !== null) {
      assert.equal(typeof catalogPage.nextCursor, "object");
      assert.equal(
        typeof (catalogPage.nextCursor as { lastSeenMs?: unknown }).lastSeenMs,
        "number",
      );
      assert.equal(
        typeof (catalogPage.nextCursor as { rawExeName?: unknown }).rawExeName,
        "string",
      );
    }
    assert.equal(catalogPage.readPath, "projection");
    assert.equal(catalogPage.fallbackReason, null);
    assert.equal(catalogPage.sourceRevision, readModelStatus.sourceRevision);

    const legacyApps = await evaluate(client,
      `window.__TAURI_INTERNALS__.invoke("cmd_get_legacy_classification_apps", { nowMs: Date.now() })`,
    ) as Array<{ exeName: string; appName: string }>;
    assert.ok(Array.isArray(legacyApps));
    for(const app of legacyApps) {
      assert.deepEqual(Object.keys(app).sort(), ["appName", "exeName"]);
      assert.equal(typeof app.exeName, "string");
      assert.equal(typeof app.appName, "string");
    }

    const aggregateRange = await evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("cmd_get_activity_aggregate_range", {
      startMs: 0,
      endMs: 3600000,
      bucketBoundariesMs: [0, 3600000],
    })`,
    ) as {
      records: unknown[];
      readPath: string;
      fallbackReason: string;
      sourceRevision: number;
      projectionRowCount: number;
      factRowCount: number;
      hasActiveSession: boolean;
    };
    assert.deepEqual(aggregateRange.records, []);
    assert.equal(aggregateRange.readPath, "facts");
    assert.equal(aggregateRange.fallbackReason, "outside_projection_coverage");
    assert.equal(aggregateRange.sourceRevision, readModelStatus.sourceRevision);
    assert.equal(aggregateRange.projectionRowCount, 0);
    assert.equal(aggregateRange.factRowCount, 0);
    assert.equal(aggregateRange.hasActiveSession, false);

    const runtimeDatabasePath = join(root, "data", "patina.db");
    await verifyAnonymousActivityRuntime((expression) => evaluate(client!, expression), root, runtimeDatabasePath);
    seedWebActivitySegment(runtimeDatabasePath);
    const webAggregateRange = await evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("cmd_get_web_activity_aggregate_range", {
      startMs: 0,
      endMs: 4000,
      bucketBoundariesMs: [0, 2000, 4000],
      normalizedDomain: "Example.COM.",
    })`,
    ) as {
      records: Array<{
        normalizedDomain: string;
        bucketStartMs: number;
        durationMs: number;
      }>;
      domainCoverage: Array<{
        normalizedDomain: string;
        earliestRecordedStartMs: number;
      }>;
      sourceRevision: string;
      snapshotNowMs: number;
    };
    assert.deepEqual({
      records: webAggregateRange.records,
      domainCoverage: webAggregateRange.domainCoverage,
    }, {
      records: [
        { normalizedDomain: "example.com", bucketStartMs: 0, durationMs: 1000 },
        { normalizedDomain: "example.com", bucketStartMs: 2000, durationMs: 1500 },
      ],
      domainCoverage: [
        { normalizedDomain: "example.com", earliestRecordedStartMs: 1000 },
      ],
    });
    assert.match(webAggregateRange.sourceRevision, /^(0|[1-9]\d*):[a-f0-9]{64}$/);
    assert.equal(Number.isSafeInteger(webAggregateRange.snapshotNowMs), true);
    const multiWebAggregateRange = await evaluate(
      client,
      `window.__TAURI_INTERNALS__.invoke("cmd_get_web_activity_aggregate_range", {
      startMs: 0,
      endMs: 4000,
      bucketBoundariesMs: [0, 2000, 4000],
      normalizedDomains: ["docs.example", "example.com"],
    })`,
    ) as typeof webAggregateRange;
    assert.deepEqual({
      records: multiWebAggregateRange.records,
      domainCoverage: multiWebAggregateRange.domainCoverage,
    }, {
      records: [
        { normalizedDomain: "docs.example", bucketStartMs: 2000, durationMs: 1000 },
        { normalizedDomain: "example.com", bucketStartMs: 0, durationMs: 1000 },
        { normalizedDomain: "example.com", bucketStartMs: 2000, durationMs: 1500 },
      ],
      domainCoverage: [
        { normalizedDomain: "docs.example", earliestRecordedStartMs: 2000 },
        { normalizedDomain: "example.com", earliestRecordedStartMs: 1000 },
      ],
    });
    assert.equal(multiWebAggregateRange.sourceRevision, webAggregateRange.sourceRevision);
    const conflictingWebAggregateRange = await evaluate(client, `
    window.__TAURI_INTERNALS__.invoke("cmd_get_web_activity_aggregate_range", {
      startMs: 0,
      endMs: 4000,
      bucketBoundariesMs: [0, 2000, 4000],
      normalizedDomain: "example.com",
      normalizedDomains: ["docs.example"],
    }).then(() => null, (error) => error)
  `) as { code?: string; retryable?: boolean };
    assert.equal(conflictingWebAggregateRange.code, "WEB_ACTIVITY_ANALYSIS_FAILED");
    assert.equal(conflictingWebAggregateRange.retryable, true);
    const invalidWebAggregateRange = await evaluate(client, `
    window.__TAURI_INTERNALS__.invoke("cmd_get_web_activity_aggregate_range", {
      startMs: 0,
      endMs: 4000,
      bucketBoundariesMs: [0, 3000, 2000, 4000],
      normalizedDomain: null,
    }).then(() => null, (error) => error)
  `) as { code?: string; retryable?: boolean };
    assert.equal(invalidWebAggregateRange.code, "WEB_ACTIVITY_ANALYSIS_FAILED");
    assert.equal(invalidWebAggregateRange.retryable, true);

    await evaluate(client, `
    (async () => {
      window.__patinaE2eEvents = [];
      const handler = window.__TAURI_INTERNALS__.transformCallback(
        (event) => window.__patinaE2eEvents.push(event.event),
      );
      await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
        event: "app-settings-changed",
        target: { kind: "Any" },
        handler,
      });
      return true;
    })()
  `);
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [{ key: "refresh_interval_secs", value: "77" }],
  })`);
    await waitFor(
      "Rust to frontend settings event",
      async () => evaluate(client!, "window.__patinaE2eEvents?.includes('app-settings-changed')"),
      10_000,
    );

    const rows = await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT value FROM settings WHERE key = ?", ["refresh_interval_secs"]);
    assert.deepEqual(rows, [{ value: "77" }]);

    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [
      { key: "language", value: "zh-CN" },
      { key: "tracking_paused", value: "1" },
      { key: "title_recording_enabled", value: "0" },
      { key: "language", value: "en-US" },
    ],
  })`);
    const englishTraySettingRows = await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT key, value FROM settings WHERE key IN (?, ?, ?) ORDER BY key", ["language", "tracking_paused", "title_recording_enabled"]);
    assert.deepEqual(englishTraySettingRows, [
      { key: "language", value: "en-US" },
      { key: "title_recording_enabled", value: "0" },
      { key: "tracking_paused", value: "1" },
    ]);
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [{ key: "language", value: "es" }],
  })`);
    const spanishSettingRows = await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT key, value FROM settings WHERE key IN (?, ?, ?) ORDER BY key", ["language", "tracking_paused", "title_recording_enabled"]);
    assert.deepEqual(spanishSettingRows, [
      { key: "language", value: "es" },
      { key: "title_recording_enabled", value: "0" },
      { key: "tracking_paused", value: "1" },
    ]);
    const retiredPreferenceRows = await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT key FROM settings WHERE key IN (?, ?, ?, ?, ?)", ["minimize_behavior", "widget_placement", "widget_expansion_preference", "widget_side", "widget_anchor_y"]);
    assert.deepEqual(retiredPreferenceRows, []);

    // Keep the earlier pause until this command round trip finishes. Resuming
    // tracking can resolve a new session name and legitimately clear this cache.
    await waitFor("optional names drain before bootstrap persistence fixture", async () => {
      const diagnostics = await evaluate(client!, 'window.__TAURI_INTERNALS__.invoke("cmd_get_resource_diagnostics")') as {
        name_resolution: { pending: number; running: number };
      };
      return diagnostics.name_resolution.pending === 0 && diagnostics.name_resolution.running === 0;
    }, 10_000);
    const bootstrapCommands: Array<{ command: string; observedAt: number }> = [];
    const stopBootstrapObservation = client.onMessage(message => {
      if(message.method !== "Network.requestWillBeSent") return;
      const request = (message.params as { request?: { url?: string } } | undefined)?.request;
      if(!request?.url) return;
      const command = new URL(request.url).pathname.slice(1);
      if(["cmd_save_history_bootstrap_snapshot_payload", "cmd_clear_history_bootstrap_snapshot_payload"].includes(command)) {
        bootstrapCommands.push({ command, observedAt: Date.now() });
      }
    });
    await client.command("Network.enable");
    try {
      const historyBootstrapPayload = JSON.stringify({ version: 1, smoke: true });
      await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_save_history_bootstrap_snapshot_payload", {
      payload: ${JSON.stringify(historyBootstrapPayload)},
    })`);
      const historyBootstrapRows = await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT value FROM settings WHERE key = ?", ["history.bootstrap_snapshot.v1"]);
      assert.deepEqual(historyBootstrapRows, [{ value: historyBootstrapPayload }]);
      await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_clear_history_bootstrap_snapshot_payload")`);
      const clearedHistoryBootstrapRows = await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT value FROM settings WHERE key = ?", ["history.bootstrap_snapshot.v1"]);
      assert.deepEqual(clearedHistoryBootstrapRows, []);
    } finally {
      stopBootstrapObservation();
      console.log("PATINA_BOOTSTRAP_PERSISTENCE_COMMANDS", JSON.stringify(bootstrapCommands));
    }
    await evaluate(client, `window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
    mutations: [
      { key: "language", value: "zh-CN" },
      { key: "tracking_paused", value: "0" },
      { key: "title_recording_enabled", value: "1" },
    ],
  })`);
    const restoredTraySettingRows = await readRuntimeDatabaseRows(expression => evaluate(client, expression), "SELECT key, value FROM settings WHERE key IN (?, ?, ?) ORDER BY key", ["language", "tracking_paused", "title_recording_enabled"]);
    assert.deepEqual(restoredTraySettingRows, [
      { key: "language", value: "zh-CN" },
      { key: "title_recording_enabled", value: "1" },
      { key: "tracking_paused", value: "0" },
    ]);

    const deniedWrite = await evaluate(client, `
    window.__TAURI_INTERNALS__.invoke("plugin:sql|execute", {
      db: "sqlite:patina.db",
      query: "DELETE FROM settings",
      values: [],
    }).then(() => null, (error) => String(error))
  `);
    assert.match(String(deniedWrite), /not allowed|permission|denied|not found/i);

    const structuredError = await evaluate(client, `
    window.__TAURI_INTERNALS__.invoke("cmd_commit_app_settings", {
      mutations: [{ key: "not_allowed", value: "1" }],
    }).then(() => null, (error) => error)
  `) as { code?: string; retryable?: boolean };
    assert.equal(structuredError.code, "SQLITE_INVALID_INPUT");
    assert.equal(structuredError.retryable, false);

    await verifyBackupReplaceRuntime(client, root);
    client = await verifyRestoredBackgroundPolicy(client, devtoolsPort, runtimeDatabasePath,
      () => logs.join(""));
    await verifyWebDavRuntime((expression) => evaluate(client!, expression));
    await deleteWebHistoryRuntime((expression) => evaluate(client!, expression));


    await session.job!.stop();
    verifyDatabase(runtimeDatabasePath);

  } finally { session.client = client; }
}
