import {
  getScheduledBackupSnapshot,
  onScheduledBackupChanged,
  pickScheduledBackupDirectory,
  saveScheduledBackupConfig,
  type ScheduledBackupConfigInput,
  type ScheduledBackupSnapshot,
} from "../../../platform/backup/scheduledBackupRuntimeGateway.ts";

export type { ScheduledBackupConfigInput, ScheduledBackupSnapshot };

export const ScheduledBackupService = {
  getSnapshot: getScheduledBackupSnapshot,
  onChanged: onScheduledBackupChanged,
  pickDirectory: pickScheduledBackupDirectory,
  saveConfig: saveScheduledBackupConfig,
};
