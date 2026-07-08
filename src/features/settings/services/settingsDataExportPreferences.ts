import type { ExportFormat, ExportRangeMode } from "./settingsDataExportRange.ts";

const EXPORT_RANGE_MODE_KEY = "patina:export-range-mode";
const EXPORT_FORMAT_KEY = "patina:export-format";

export const DEFAULT_EXPORT_RANGE_MODE: ExportRangeMode = "month";
export const DEFAULT_EXPORT_FORMAT: ExportFormat = "csv";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function isExportRangeMode(value: string | null): value is ExportRangeMode {
  return value === "day" || value === "week" || value === "month" || value === "year";
}

function isExportFormat(value: string | null): value is ExportFormat {
  return value === "csv" || value === "sqlite" || value === "parquet";
}

export function readExportRangeMode(): ExportRangeMode {
  const storage = getStorage();
  if (!storage) return DEFAULT_EXPORT_RANGE_MODE;

  try {
    const value = storage.getItem(EXPORT_RANGE_MODE_KEY);
    return isExportRangeMode(value) ? value : DEFAULT_EXPORT_RANGE_MODE;
  } catch {
    return DEFAULT_EXPORT_RANGE_MODE;
  }
}

export function rememberExportRangeMode(mode: ExportRangeMode) {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(EXPORT_RANGE_MODE_KEY, mode);
  } catch {
    // Export preferences are best-effort; never block the task flow.
  }
}

export function readExportFormat(): ExportFormat {
  const storage = getStorage();
  if (!storage) return DEFAULT_EXPORT_FORMAT;

  try {
    const value = storage.getItem(EXPORT_FORMAT_KEY);
    return isExportFormat(value) ? value : DEFAULT_EXPORT_FORMAT;
  } catch {
    return DEFAULT_EXPORT_FORMAT;
  }
}

export function rememberExportFormat(format: ExportFormat) {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(EXPORT_FORMAT_KEY, format);
  } catch {
    // Export preferences are best-effort; never block the task flow.
  }
}
