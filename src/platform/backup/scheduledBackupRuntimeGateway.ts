import { invoke } from "@tauri-apps/api/core";
import { listen, type Event } from "@tauri-apps/api/event";

export type ScheduledBackupCadence = "daily" | "weekly";
export type ScheduledBackupRunStatus = "running" | "retry_wait" | "succeeded" | "failed";
export type ScheduledBackupTargetInput =
  | { kind: "local"; targetDir: string }
  | { kind: "webdav" };
export type ScheduledBackupTarget =
  | { kind: "local"; targetDir: string }
  | { kind: "webdav"; targetIdentity: string };
export type ScheduledBackupRunPhase =
  | "claimed"
  | "staged"
  | "uploaded"
  | "remote_verified"
  | "indexed"
  | "succeeded";

export interface ScheduledBackupConfigInput {
  enabled: boolean;
  cadence: ScheduledBackupCadence;
  weekday: number | null;
  localTimeMinutes: number;
  target: ScheduledBackupTargetInput;
}

export interface ScheduledBackupConfig extends Omit<ScheduledBackupConfigInput, "target"> {
  target: ScheduledBackupTarget;
  targetGeneration: string;
  scheduleAnchorAtMs: number;
  updatedAtMs: number;
}

export interface ScheduledBackupRun {
  runKey: string;
  targetGeneration: string;
  targetKind: "local" | "webdav";
  logicalDate: string;
  logicalTimeMinutes: number;
  targetPath: string;
  stagingPath: string | null;
  phase: ScheduledBackupRunPhase;
  remoteEtag: string | null;
  status: ScheduledBackupRunStatus;
  fileState: "absent" | "present" | "pruned" | "missing" | "conflict";
  attemptCount: number;
  retryAtMs: number | null;
  startedAtMs: number;
  completedAtMs: number | null;
  archiveSha256: string | null;
  sizeBytes: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  cleanupWarning: string | null;
  updatedAtMs: number;
}

export interface ScheduledBackupSnapshot {
  config: ScheduledBackupConfig;
  nextExecutionAtMs: number | null;
  recentSuccess: ScheduledBackupRun | null;
  recentFailure: ScheduledBackupRun | null;
  activeRun: ScheduledBackupRun | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseConfig(value: unknown): ScheduledBackupConfig {
  const target = isRecord(value) ? value.target : null;
  if (!isRecord(value)
    || typeof value.enabled !== "boolean"
    || (value.cadence !== "daily" && value.cadence !== "weekly")
    || !(value.weekday === null || typeof value.weekday === "number")
    || typeof value.localTimeMinutes !== "number"
    || value.localTimeMinutes < 0
    || value.localTimeMinutes >= 1440
    || !isRecord(target)
    || (target.kind !== "local" && target.kind !== "webdav")
    || (target.kind === "local"
      && (typeof target.targetDir !== "string" || target.targetDir.trim() === ""))
    || (target.kind === "webdav"
      && (typeof target.targetIdentity !== "string" || target.targetIdentity.trim() === ""))
    || typeof value.targetGeneration !== "string"
    || typeof value.scheduleAnchorAtMs !== "number"
    || typeof value.updatedAtMs !== "number") {
    throw new Error("Received invalid scheduled backup configuration");
  }
  if ((value.cadence === "daily" && value.weekday !== null)
    || (value.cadence === "weekly"
      && !(typeof value.weekday === "number" && value.weekday >= 1 && value.weekday <= 7))) {
    throw new Error("Received invalid scheduled backup configuration");
  }
  return {
    enabled: value.enabled,
    cadence: value.cadence,
    weekday: typeof value.weekday === "number" ? value.weekday : null,
    localTimeMinutes: value.localTimeMinutes,
    target: target.kind === "local"
      ? { kind: "local", targetDir: target.targetDir as string }
      : { kind: "webdav", targetIdentity: target.targetIdentity as string },
    targetGeneration: value.targetGeneration,
    scheduleAnchorAtMs: value.scheduleAnchorAtMs,
    updatedAtMs: value.updatedAtMs,
  };
}

function parseRun(value: unknown): ScheduledBackupRun | null {
  if (value === null) return null;
  if (!isRecord(value)
    || typeof value.runKey !== "string"
    || typeof value.targetGeneration !== "string"
    || (value.targetKind !== "local" && value.targetKind !== "webdav")
    || typeof value.logicalDate !== "string"
    || typeof value.logicalTimeMinutes !== "number"
    || typeof value.targetPath !== "string"
    || !isNullableString(value.stagingPath)
    || !["claimed", "staged", "uploaded", "remote_verified", "indexed", "succeeded"].includes(String(value.phase))
    || !isNullableString(value.remoteEtag)
    || !["running", "retry_wait", "succeeded", "failed"].includes(String(value.status))
    || !["absent", "present", "pruned", "missing", "conflict"].includes(String(value.fileState))
    || typeof value.attemptCount !== "number"
    || !isNullableNumber(value.retryAtMs)
    || typeof value.startedAtMs !== "number"
    || !isNullableNumber(value.completedAtMs)
    || !isNullableString(value.archiveSha256)
    || !isNullableNumber(value.sizeBytes)
    || !isNullableString(value.errorCode)
    || !isNullableString(value.errorMessage)
    || !isNullableString(value.cleanupWarning)
    || typeof value.updatedAtMs !== "number") {
    throw new Error("Received invalid scheduled backup run");
  }
  return value as unknown as ScheduledBackupRun;
}

export function parseScheduledBackupSnapshot(value: unknown): ScheduledBackupSnapshot {
  if (!isRecord(value) || !isNullableNumber(value.nextExecutionAtMs)) {
    throw new Error("Received invalid scheduled backup snapshot");
  }
  return {
    config: parseConfig(value.config),
    nextExecutionAtMs: value.nextExecutionAtMs,
    recentSuccess: parseRun(value.recentSuccess),
    recentFailure: parseRun(value.recentFailure),
    activeRun: parseRun(value.activeRun),
  };
}

export async function getScheduledBackupSnapshot(): Promise<ScheduledBackupSnapshot> {
  return parseScheduledBackupSnapshot(await invoke<unknown>("cmd_get_scheduled_backup_snapshot"));
}

export async function saveScheduledBackupConfig(
  input: ScheduledBackupConfigInput,
): Promise<ScheduledBackupSnapshot> {
  return parseScheduledBackupSnapshot(
    await invoke<unknown>("cmd_save_scheduled_backup_config", { input }),
  );
}

export async function pickScheduledBackupDirectory(initialPath: string): Promise<string | null> {
  return invoke<string | null>("cmd_pick_scheduled_backup_directory", {
    initialPath: initialPath || null,
  });
}

export async function onScheduledBackupChanged(
  handler: () => void | Promise<void>,
): Promise<() => void> {
  return listen<unknown>("scheduled-backup-changed", (_event: Event<unknown>) => {
    void handler();
  });
}
