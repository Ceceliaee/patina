import { invokeWithCommandError } from "./commandError.ts";

export async function deleteSessionsBefore(cutoffTime: number): Promise<void> {
  await invokeWithCommandError("cmd_delete_sessions_before", { cutoffTime });
}

export async function deleteSessionsByExeNames(exeNames: string[]): Promise<void> {
  await invokeWithCommandError("cmd_delete_sessions_by_exe_names", { exeNames });
}

export async function deleteSessionsByExeNamesBetween(
  exeNames: string[],
  startTime: number,
  endTime: number,
): Promise<void> {
  await invokeWithCommandError("cmd_delete_sessions_by_exe_names_between", {
    exeNames,
    startTime,
    endTime,
  });
}

export async function deleteWebActivitySegmentsByDomain(
  normalizedDomain: string,
): Promise<void> {
  await invokeWithCommandError("cmd_delete_web_activity_segments_by_domain", { normalizedDomain });
}

export async function saveRemoteBackupLastBackupAt(timestampMs: number): Promise<void> {
  await invokeWithCommandError("cmd_save_remote_backup_last_backup_at", { timestampMs });
}

export async function saveDataBootstrapSnapshotPayload(payload: string): Promise<void> {
  await invokeWithCommandError("cmd_save_data_bootstrap_snapshot_payload", { payload });
}

export async function clearDataBootstrapSnapshotPayload(): Promise<void> {
  await invokeWithCommandError("cmd_clear_data_bootstrap_snapshot_payload");
}

export async function saveHistoryBootstrapSnapshotPayload(payload: string): Promise<void> {
  await invokeWithCommandError("cmd_save_history_bootstrap_snapshot_payload", { payload });
}

export async function clearHistoryBootstrapSnapshotPayload(): Promise<void> {
  await invokeWithCommandError("cmd_clear_history_bootstrap_snapshot_payload");
}
