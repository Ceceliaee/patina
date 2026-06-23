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

interface RawResourceDiagnosticsSnapshot {
  webview_window_count: number;
  webview_window_labels: string[];
  process_resources: RawWindowsProcessResourceSnapshot;
  process_details_cache: RawProcessDetailsCacheStats;
  icon_result_cache: RawIconResultCacheStats;
}

interface ResourceDiagnosticsSnapshot {
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

function isRawResourceDiagnostics(value: unknown): value is RawResourceDiagnosticsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isNumber(record.webview_window_count)
    && isStringArray(record.webview_window_labels)
    && isRawProcessResources(record.process_resources)
    && isRawCacheStats(record.process_details_cache)
    && isRawCacheStats(record.icon_result_cache);
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
  };
}

async function loadResourceDiagnostics(): Promise<ResourceDiagnosticsSnapshot> {
  const payload = await invoke<unknown>("cmd_get_resource_diagnostics");
  if (!isRawResourceDiagnostics(payload)) {
    throw new Error("Invalid resource diagnostics payload");
  }

  return mapRawResourceDiagnostics(payload);
}

export function installDevelopmentResourceDiagnostics() {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return;
  }

  window.__TIME_TRACKER_RESOURCE_DIAGNOSTICS__ = loadResourceDiagnostics;
}
