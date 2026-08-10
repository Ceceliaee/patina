export {
  deleteWebDavBackupSecret,
  deleteRemoteBackupTemp,
  downloadWebDavBackup,
  hasWebDavBackupSecret,
  listWebDavBackups,
  revealWebDavBackupSecret,
  saveWebDavBackupSecret,
  testWebDavBackupTarget,
  uploadWebDavBackup,
  type RemoteBackupEntry,
  type WebDavBackupConfig,
} from "../../../platform/backup/remoteBackupRuntimeGateway.ts";
export {
  clearRemoteBackupConfig,
  DEFAULT_WEBDAV_REMOTE_DIR,
  loadRemoteBackupConfig,
  saveRemoteBackupConfig,
  saveRemoteBackupLastBackupAt,
  type PersistedRemoteBackupConfig,
} from "../../../platform/persistence/remoteBackupSettingsStore.ts";
