// en-US toast locale resource. Pure data only.
export const MESSAGES = {
  "toast.backupExportFailed": "Could not create backup. Check the save location and try again.",
  "toast.backupExportSuccess": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Created backup: ",
        {
          "$op": "arg",
          "name": "path"
        },
        ""
      ]
    }
  },
  "toast.backupIncompatible": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Backup is incompatible: ",
        {
          "$op": "coalesce",
          "left": {
            "$op": "arg",
            "name": "reason"
          },
          "right": "compatibility could not be confirmed"
        },
        ""
      ]
    }
  },
  "toast.backupPreviewFailed": "Could not preview this backup file. Check the file and try again.",
  "toast.backupRestoreFailed": "Backup restore did not complete. The app preserved or restored the original data where possible; keep the logs if restart is requested or writes are unavailable.",
  "toast.backupRestoreSuccess": "Backup restored. Refreshing.",
  "toast.cleanupFailed": "Could not clear history records. Try again later.",
  "toast.cleanupSuccess": "History records cleared.",
  "toast.feedbackOpenFailed": "Could not open feedback link.",
  "toast.legacyBackupRestoreSuccess": "Legacy backup restored. Create a new SQLite data snapshot backup now.",
  "toast.releaseNotesOpenFailed": "Could not open release notes.",
  "toast.repositoryOpenFailed": "Could not open GitHub link.",
  "toast.settingsRuntimeSyncPartial": "Settings were saved. Some runtime state will apply after the next refresh.",
  "toast.supportOpenFailed": "Could not open support link.",
  "toast.webDavConfigDeleted": "WebDAV configuration deleted.",
  "toast.webDavConfigDeleteFailed": "Could not delete WebDAV configuration. Try again later.",
  "toast.webDavConfigSaved": "WebDAV configuration saved.",
  "toast.webDavConfigSaveFailed": "Could not save WebDAV configuration. Check it and try again.",
  "toast.webDavDownloadFailed": "Remote backup download or restore failed. Local data was not affected.",
  "toast.webDavListFailed": "Could not read the remote backup list.",
  "toast.webDavMissingConfig": "Configure WebDAV and save the password first.",
  "toast.webDavMissingPassword": "Enter the WebDAV password or app password.",
  "toast.webDavTestFailed": "WebDAV connection failed. Check the address, username, and app password.",
  "toast.webDavTestSuccess": "WebDAV connection is available.",
  "toast.webDavUploadFailed": "Remote backup upload failed. Local data was not changed.",
  "toast.webDavUploadIndexWarning": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Remote backup uploaded: ",
        {
          "$op": "arg",
          "name": "fileName"
        },
        ", but the list could not be updated."
      ]
    }
  },
  "toast.webDavUploadSuccess": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Remote backup uploaded: ",
        {
          "$op": "arg",
          "name": "fileName"
        },
        ""
      ]
    }
  }
} as const;
