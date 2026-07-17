import { invokeWithCommandError } from "./commandError.ts";

export interface RemoteBackupSettingsPatchPayload {
  url: string;
  username: string;
  remoteDir?: string;
  lastBackupAtMs?: number | null;
}

export async function deleteSessionsBefore(cutoffTime: number): Promise<void> {
  await invokeWithCommandError("cmd_delete_sessions_before", { cutoffTime });
}

export async function clearAllSessionWindowTitles(): Promise<void> {
  await invokeWithCommandError("cmd_clear_all_session_window_titles");
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

export async function deleteWebActivitySegmentsBefore(cutoffTime: number): Promise<void> {
  await invokeWithCommandError("cmd_delete_web_activity_segments_before", { cutoffTime });
}

export async function deleteWebActivitySegmentsByDomain(
  normalizedDomain: string,
): Promise<void> {
  await invokeWithCommandError("cmd_delete_web_activity_segments_by_domain", { normalizedDomain });
}

export async function saveRemoteBackupSettings(
  patch: RemoteBackupSettingsPatchPayload,
): Promise<void> {
  await invokeWithCommandError("cmd_save_remote_backup_settings", { patch });
}

export async function saveRemoteBackupRemoteDir(remoteDir: string): Promise<void> {
  await invokeWithCommandError("cmd_save_remote_backup_remote_dir", { remoteDir });
}

export async function saveRemoteBackupLastBackupAt(timestampMs: number): Promise<void> {
  await invokeWithCommandError("cmd_save_remote_backup_last_backup_at", { timestampMs });
}

export async function clearRemoteBackupSettings(): Promise<void> {
  await invokeWithCommandError("cmd_clear_remote_backup_settings");
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
