import type { ExportFormat, ExportRangeMode } from "./settingsDataExportRange.ts";
import {
  DATA_EXPORT_PROTOCOL_FIELDS,
  isDataExportProtocolField,
  type DataExportProtocolField,
} from "../../../platform/persistence/dataExportGateway.ts";

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
  return value === "csv" || value === "sqlite" || value === "parquet" || value === "markdown";
}

function exportFieldsKey(format: ExportFormat) {
  return `patina:export-fields:${format}`;
}

export function normalizeExportFields(
  value: unknown,
  fallback: readonly DataExportProtocolField[],
): DataExportProtocolField[] {
  const source = Array.isArray(value) ? value : fallback;
  const selected = new Set(source
    .filter((field): field is string => typeof field === "string")
    .filter(isDataExportProtocolField));
  const normalized = DATA_EXPORT_PROTOCOL_FIELDS.filter((field) => selected.has(field));
  if (normalized.length > 0) return normalized;
  const fallbackSet = new Set(fallback);
  return DATA_EXPORT_PROTOCOL_FIELDS.filter((field) => fallbackSet.has(field));
}

export function readExportFields(
  format: ExportFormat,
  fallback: readonly DataExportProtocolField[],
): DataExportProtocolField[] {
  const storage = getStorage();
  if (!storage) return [...fallback];
  try {
    const raw = storage.getItem(exportFieldsKey(format));
    return raw ? normalizeExportFields(JSON.parse(raw), fallback) : [...fallback];
  } catch {
    return [...fallback];
  }
}

export function rememberExportFields(format: ExportFormat, fields: readonly string[]) {
  const storage = getStorage();
  if (!storage) return;
  try {
    const normalized = normalizeExportFields(fields, DATA_EXPORT_PROTOCOL_FIELDS);
    storage.setItem(exportFieldsKey(format), JSON.stringify(normalized));
  } catch {
    // Export preferences are best-effort; never block the task flow.
  }
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
