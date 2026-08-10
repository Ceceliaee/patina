import { invoke } from "@tauri-apps/api/core";
import { listen, type Event } from "@tauri-apps/api/event";
import {
  isFiniteNumber,
  isNullableString,
  isPlainRecord as isRecord,
} from "../../shared/lib/runtimeTypeGuards.ts";

import {
  isDataExportProtocolField,
  type DataExportProtocolField,
} from "./dataExportGateway.ts";

type ScheduledExportCadence = "daily" | "weekly";
type ScheduledExportFormat = "csv" | "markdown" | "parquet" | "sqlite";
type ScheduledExportRunStatus = "running" | "retry_wait" | "succeeded" | "failed" | "superseded";
type ScheduledExportRunPhase = "claimed" | "written" | "validated" | "published" | "succeeded";

export interface ScheduledExportConfigInput {
  enabled: boolean;
  cadence: ScheduledExportCadence;
  weekday: number | null;
  localTimeMinutes: number;
  targetDir: string;
  format: ScheduledExportFormat;
  selectedFields: DataExportProtocolField[];
}

interface ScheduledExportConfig extends ScheduledExportConfigInput {
  planGeneration: string;
  scheduleAnchorAtMs: number;
  updatedAtMs: number;
}

interface ScheduledExportRun {
  runKey: string;
  planGeneration: string;
  cadence: ScheduledExportCadence;
  logicalStartDate: string;
  logicalEndDate: string;
  periodStartMs: number;
  periodEndMs: number;
  format: ScheduledExportFormat;
  selectedFields: DataExportProtocolField[];
  targetPath: string;
  stagingPath: string | null;
  phase: ScheduledExportRunPhase;
  status: ScheduledExportRunStatus;
  fileState: "absent" | "present" | "missing" | "conflict";
  attemptCount: number;
  retryAtMs: number | null;
  rowCount: number | null;
  sizeBytes: number | null;
  sha256: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAtMs: number;
  completedAtMs: number | null;
  updatedAtMs: number;
}

export interface ScheduledExportSnapshot {
  config: ScheduledExportConfig;
  nextExecutionAtMs: number | null;
  recentSuccess: ScheduledExportRun | null;
  recentFailure: ScheduledExportRun | null;
  activeRun: ScheduledExportRun | null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNullableNonNegativeSafeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeSafeInteger(value);
}

function isLocalTimeMinutes(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value < 1440;
}

function isAttemptCount(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 1
    && value <= 3;
}

function isNullableSha256(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
}

function parseCadence(value: unknown): ScheduledExportCadence {
  if (value === "daily" || value === "weekly") return value;
  throw new Error("Received invalid scheduled export cadence");
}

function parseFormat(value: unknown): ScheduledExportFormat {
  if (value === "csv" || value === "markdown" || value === "parquet" || value === "sqlite") {
    return value;
  }
  throw new Error("Received invalid scheduled export format");
}

function parseFields(value: unknown): DataExportProtocolField[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((field) => (
    typeof field === "string" && isDataExportProtocolField(field)
  ))) {
    throw new Error("Received invalid scheduled export fields");
  }
  if (new Set(value).size !== value.length) {
    throw new Error("Received duplicate scheduled export fields");
  }
  return value as DataExportProtocolField[];
}

function parseConfig(value: unknown): ScheduledExportConfig {
  if (!isRecord(value)
    || typeof value.enabled !== "boolean"
    || !isLocalTimeMinutes(value.localTimeMinutes)
    || typeof value.targetDir !== "string"
    || value.targetDir.trim() === ""
    || typeof value.planGeneration !== "string"
    || value.planGeneration.trim() === ""
    || !isNonNegativeSafeInteger(value.scheduleAnchorAtMs)
    || !isNonNegativeSafeInteger(value.updatedAtMs)) {
    throw new Error("Received invalid scheduled export configuration");
  }
  const cadence = parseCadence(value.cadence);
  const weekday = value.weekday;
  if ((cadence === "daily" && weekday !== null)
    || (cadence === "weekly"
      && !(isFiniteNumber(weekday) && Number.isInteger(weekday) && weekday >= 1 && weekday <= 7))) {
    throw new Error("Received invalid scheduled export configuration");
  }
  return {
    enabled: value.enabled,
    cadence,
    weekday: cadence === "weekly" ? weekday as number : null,
    localTimeMinutes: value.localTimeMinutes,
    targetDir: value.targetDir,
    format: parseFormat(value.format),
    selectedFields: parseFields(value.selectedFields),
    planGeneration: value.planGeneration,
    scheduleAnchorAtMs: value.scheduleAnchorAtMs,
    updatedAtMs: value.updatedAtMs,
  };
}

function parseRun(value: unknown): ScheduledExportRun | null {
  if (value === null) return null;
  if (!isRecord(value)
    || typeof value.runKey !== "string" || value.runKey.trim() === ""
    || typeof value.planGeneration !== "string" || value.planGeneration.trim() === ""
    || typeof value.logicalStartDate !== "string" || !isLocalDateKey(value.logicalStartDate)
    || typeof value.logicalEndDate !== "string" || !isLocalDateKey(value.logicalEndDate)
    || !isNonNegativeSafeInteger(value.periodStartMs)
    || !isNonNegativeSafeInteger(value.periodEndMs)
    || value.periodEndMs <= value.periodStartMs
    || typeof value.targetPath !== "string" || value.targetPath.trim() === ""
    || !isNullableString(value.stagingPath)
    || !["claimed", "written", "validated", "published", "succeeded"].includes(String(value.phase))
    || !["running", "retry_wait", "succeeded", "failed", "superseded"].includes(String(value.status))
    || !["absent", "present", "missing", "conflict"].includes(String(value.fileState))
    || !isAttemptCount(value.attemptCount)
    || !isNullableNonNegativeSafeInteger(value.retryAtMs)
    || !isNullableNonNegativeSafeInteger(value.rowCount)
    || !isNullableNonNegativeSafeInteger(value.sizeBytes)
    || !isNullableSha256(value.sha256)
    || !isNullableString(value.errorCode)
    || !isNullableString(value.errorMessage)
    || !isNonNegativeSafeInteger(value.startedAtMs)
    || !isNullableNonNegativeSafeInteger(value.completedAtMs)
    || !isNonNegativeSafeInteger(value.updatedAtMs)) {
    throw new Error("Received invalid scheduled export run");
  }
  return {
    runKey: value.runKey,
    planGeneration: value.planGeneration,
    cadence: parseCadence(value.cadence),
    logicalStartDate: value.logicalStartDate,
    logicalEndDate: value.logicalEndDate,
    periodStartMs: value.periodStartMs,
    periodEndMs: value.periodEndMs,
    format: parseFormat(value.format),
    selectedFields: parseFields(value.selectedFields),
    targetPath: value.targetPath,
    stagingPath: value.stagingPath,
    phase: value.phase as ScheduledExportRunPhase,
    status: value.status as ScheduledExportRunStatus,
    fileState: value.fileState as ScheduledExportRun["fileState"],
    attemptCount: value.attemptCount,
    retryAtMs: value.retryAtMs,
    rowCount: value.rowCount,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
    errorCode: value.errorCode,
    errorMessage: value.errorMessage,
    startedAtMs: value.startedAtMs,
    completedAtMs: value.completedAtMs,
    updatedAtMs: value.updatedAtMs,
  };
}

function isLocalDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function parseScheduledExportSnapshot(value: unknown): ScheduledExportSnapshot {
  if (!isRecord(value) || !isNullableNonNegativeSafeInteger(value.nextExecutionAtMs)) {
    throw new Error("Received invalid scheduled export snapshot");
  }
  return {
    config: parseConfig(value.config),
    nextExecutionAtMs: value.nextExecutionAtMs,
    recentSuccess: parseRun(value.recentSuccess),
    recentFailure: parseRun(value.recentFailure),
    activeRun: parseRun(value.activeRun),
  };
}

export async function getScheduledExportSnapshot(): Promise<ScheduledExportSnapshot> {
  return parseScheduledExportSnapshot(await invoke<unknown>("cmd_get_scheduled_export_snapshot"));
}

export async function saveScheduledExportConfig(
  input: ScheduledExportConfigInput,
): Promise<ScheduledExportSnapshot> {
  return parseScheduledExportSnapshot(
    await invoke<unknown>("cmd_save_scheduled_export_config", { input }),
  );
}

export async function pickScheduledExportDirectory(initialPath: string): Promise<string | null> {
  return invoke<string | null>("cmd_pick_scheduled_export_directory", {
    initialPath: initialPath || null,
  });
}

export async function onScheduledExportChanged(
  handler: () => void | Promise<void>,
): Promise<() => void> {
  return listen<unknown>("scheduled-export-changed", (_event: Event<unknown>) => {
    void handler();
  });
}
