import {
  getScheduledExportSnapshot,
  onScheduledExportChanged,
  pickScheduledExportDirectory,
  saveScheduledExportConfig,
  type ScheduledExportConfigInput,
  type ScheduledExportSnapshot,
} from "../../../platform/persistence/scheduledExportRuntimeGateway.ts";

export type { ScheduledExportConfigInput, ScheduledExportSnapshot };

export function getScheduledExportErrorCode(error: unknown): string {
  const raw = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
        ? String((error as { code: string }).code)
        : "";
  const value = raw.toLowerCase();
  for (const code of [
    "target_conflict",
    "target_not_directory",
    "target_missing",
    "permission_denied",
    "disk_full",
    "database_unavailable",
    "database_busy",
    "format_validation_failed",
    "publish_failed",
    "interrupted",
  ]) {
    if (value.includes(code)) return code;
  }
  return "export_failed";
}

export const ScheduledExportService = {
  getSnapshot: getScheduledExportSnapshot,
  onChanged: onScheduledExportChanged,
  pickDirectory: pickScheduledExportDirectory,
  saveConfig: saveScheduledExportConfig,
};
