import { invoke } from "@tauri-apps/api/core";

interface RawWindowsProcessResourceSnapshot {
  handle_count: number;
  thread_count: number;
  working_set_bytes: number;
  private_usage_bytes: number;
}

interface RawProcessDetailsCacheStats {
  entries: number;
  positive_entries: number;
  negative_entries: number;
}

interface RawIconResultCacheStats {
  entries: number;
  positive_entries: number;
  negative_entries: number;
}

interface RawIconNegativeCacheStats {
  entries: number;
  limit: number;
  ttl_ms: number;
  oldest_age_ms: number | null;
}

interface RawToolAlertStats {
  entries: number;
  limit: number;
}

interface RawUpdaterRetainedPackageStats {
  retained: boolean;
  storage: string | null;
  size_bytes: number | null;
}

interface RawWebActivityBridgeStats {
  active_clients: number;
  active_client_limit: number;
  rejected_clients: number;
  timed_out_clients: number;
  request_timeout_ms: number;
}

interface RawResourceDiagnosticsSnapshot {
  webview_window_count: number;
  webview_window_labels: string[];
  process_resources: RawWindowsProcessResourceSnapshot;
  process_details_cache: RawProcessDetailsCacheStats;
  icon_result_cache: RawIconResultCacheStats;
  icon_negative_cache: RawIconNegativeCacheStats;
  tool_alerts: RawToolAlertStats;
  updater_retained_package: RawUpdaterRetainedPackageStats;
  web_activity_bridge: RawWebActivityBridgeStats;
}

export interface ResourceDiagnosticsSnapshot {
  webviewWindowCount: number;
  webviewWindowLabels: string[];
  processResources: {
    handleCount: number;
    threadCount: number;
    workingSetBytes: number;
    privateUsageBytes: number;
  };
  processDetailsCache: {
    entries: number;
    positiveEntries: number;
    negativeEntries: number;
  };
  iconResultCache: {
    entries: number;
    positiveEntries: number;
    negativeEntries: number;
  };
  iconNegativeCache: {
    entries: number;
    limit: number;
    ttlMs: number;
    oldestAgeMs: number | null;
  };
  toolAlerts: {
    entries: number;
    limit: number;
  };
  updaterRetainedPackage: {
    retained: boolean;
    storage: string | null;
    sizeBytes: number | null;
  };
  webActivityBridge: {
    activeClients: number;
    activeClientLimit: number;
    rejectedClients: number;
    timedOutClients: number;
    requestTimeoutMs: number;
  };
}

declare global {
  interface Window {
    __TIME_TRACKER_RESOURCE_DIAGNOSTICS__?: () => Promise<ResourceDiagnosticsSnapshot>;
  }
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRawProcessResources(value: unknown): value is RawWindowsProcessResourceSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isNumber(record.handle_count)
    && isNumber(record.thread_count)
    && isNumber(record.working_set_bytes)
    && isNumber(record.private_usage_bytes);
}

function isRawCacheStats(value: unknown): value is RawProcessDetailsCacheStats {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isNumber(record.entries)
    && isNumber(record.positive_entries)
    && isNumber(record.negative_entries);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRawLimitStats(value: unknown): value is RawToolAlertStats {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isNumber(record.entries)
    && isNumber(record.limit);
}

function isRawIconNegativeCacheStats(value: unknown): value is RawIconNegativeCacheStats {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isNumber(record.entries)
    && isNumber(record.limit)
    && isNumber(record.ttl_ms)
    && isNullableNumber(record.oldest_age_ms);
}

function isRawUpdaterRetainedPackageStats(value: unknown): value is RawUpdaterRetainedPackageStats {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.retained === "boolean"
    && isNullableString(record.storage)
    && isNullableNumber(record.size_bytes);
}

function isRawWebActivityBridgeStats(value: unknown): value is RawWebActivityBridgeStats {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isNumber(record.active_clients)
    && isNumber(record.active_client_limit)
    && isNumber(record.rejected_clients)
    && isNumber(record.timed_out_clients)
    && isNumber(record.request_timeout_ms);
}

function isRawResourceDiagnostics(value: unknown): value is RawResourceDiagnosticsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isNumber(record.webview_window_count)
    && isStringArray(record.webview_window_labels)
    && isRawProcessResources(record.process_resources)
    && isRawCacheStats(record.process_details_cache)
    && isRawCacheStats(record.icon_result_cache)
    && isRawIconNegativeCacheStats(record.icon_negative_cache)
    && isRawLimitStats(record.tool_alerts)
    && isRawUpdaterRetainedPackageStats(record.updater_retained_package)
    && isRawWebActivityBridgeStats(record.web_activity_bridge);
}

function mapRawCacheStats(raw: RawProcessDetailsCacheStats) {
  return {
    entries: raw.entries,
    positiveEntries: raw.positive_entries,
    negativeEntries: raw.negative_entries,
  };
}

function mapRawResourceDiagnostics(raw: RawResourceDiagnosticsSnapshot): ResourceDiagnosticsSnapshot {
  return {
    webviewWindowCount: raw.webview_window_count,
    webviewWindowLabels: raw.webview_window_labels,
    processResources: {
      handleCount: raw.process_resources.handle_count,
      threadCount: raw.process_resources.thread_count,
      workingSetBytes: raw.process_resources.working_set_bytes,
      privateUsageBytes: raw.process_resources.private_usage_bytes,
    },
    processDetailsCache: mapRawCacheStats(raw.process_details_cache),
    iconResultCache: mapRawCacheStats(raw.icon_result_cache),
    iconNegativeCache: {
      entries: raw.icon_negative_cache.entries,
      limit: raw.icon_negative_cache.limit,
      ttlMs: raw.icon_negative_cache.ttl_ms,
      oldestAgeMs: raw.icon_negative_cache.oldest_age_ms,
    },
    toolAlerts: {
      entries: raw.tool_alerts.entries,
      limit: raw.tool_alerts.limit,
    },
    updaterRetainedPackage: {
      retained: raw.updater_retained_package.retained,
      storage: raw.updater_retained_package.storage,
      sizeBytes: raw.updater_retained_package.size_bytes,
    },
    webActivityBridge: {
      activeClients: raw.web_activity_bridge.active_clients,
      activeClientLimit: raw.web_activity_bridge.active_client_limit,
      rejectedClients: raw.web_activity_bridge.rejected_clients,
      timedOutClients: raw.web_activity_bridge.timed_out_clients,
      requestTimeoutMs: raw.web_activity_bridge.request_timeout_ms,
    },
  };
}

export async function loadResourceDiagnostics(): Promise<ResourceDiagnosticsSnapshot> {
  const payload = await invoke<unknown>("cmd_get_resource_diagnostics");
  if (!isRawResourceDiagnostics(payload)) {
    throw new Error("Invalid resource diagnostics payload");
  }

  return mapRawResourceDiagnostics(payload);
}

export function installDevelopmentResourceDiagnostics(
  loader: () => Promise<ResourceDiagnosticsSnapshot> = loadResourceDiagnostics,
) {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return;
  }

  window.__TIME_TRACKER_RESOURCE_DIAGNOSTICS__ = loader;
}
