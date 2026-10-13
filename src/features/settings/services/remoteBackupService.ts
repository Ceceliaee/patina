export {
  deleteRemoteBackupTemp,
  downloadWebDavBackup,
  listWebDavBackups,
  revealWebDavBackupSecret,
  testWebDavBackupTarget,
  uploadWebDavBackup,
  type RemoteBackupEntry,
  type WebDavBackupConfig,
} from "../../../platform/backup/remoteBackupRuntimeGateway.ts";
export {
  clearRemoteBackupConfig,
  DEFAULT_WEBDAV_REMOTE_DIR,
  loadRemoteBackupConfigSnapshot,
  saveRemoteBackupConfig,
  saveRemoteBackupLastBackupAt,
  type PersistedRemoteBackupConfig,
} from "../../../platform/persistence/remoteBackupSettingsStore.ts";
