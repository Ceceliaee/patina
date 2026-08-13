// en-US settings locale resource. Pure data only.
export const MESSAGES = {
  "settings.appearanceTitle": "Appearance",
  "settings.backgroundOptimizationHint": "Release main UI memory while idle in the background. Reopening may feel slightly slower.",
  "settings.backgroundOptimizationLabel": "Low-footprint background",
  "settings.backupExportAction": "Back up",
  "settings.backupExportHint": "Export a snapshot of current data.",
  "settings.backupExporting": "Backing up...",
  "settings.backupExportTitle": "Back up",
  "settings.backupRestoreAction": "Restore",
  "settings.backupRestoreActionHelp": "Legacy backup format: Structured data backup\nCurrent backup format: SQLite data snapshot\nLegacy restore supported through: October 18, 2026",
  "settings.backupRestoreActionHint": "Restore data from a backup.",
  "settings.backupRestoreActionTitle": "Restore",
  "settings.backupRestoreHint": "Back up a local data snapshot. Restore can replace or merge with current data.",
  "settings.backupRestoreTitle": "Backup and restore",
  "settings.backupRestoring": "Restoring...",
  "settings.backupTargetHint": "Save a local file or upload to the linked WebDAV target.",
  "settings.backupTargetLocalHint": "Save as a local ZIP file.",
  "settings.backupTargetLocalTitle": "Local backup",
  "settings.backupTargetRemoteHint": "Upload to the linked WebDAV target.",
  "settings.backupTargetRemoteTitle": "WebDAV backup",
  "settings.backupTargetTitle": "Choose backup location",
  "settings.betaLabel": "Beta",
  "settings.cancel": "Cancel",
  "settings.cancelled": "Edits discarded",
  "settings.cleanup": "Data management",
  "settings.cleanupConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "All app and web records from ",
        {
          "$op": "arg",
          "name": "label"
        },
        " and earlier will be deleted, including imported records."
      ]
    }
  },
  "settings.cleanupConfirmTitle": "Confirm history cleanup",
  "settings.cleanupHint": "Delete app and web records from the selected time and earlier, including imported records. This cannot be undone.",
  "settings.cleanupNow": "Clear",
  "settings.cleanupRangeLabel": "Clear time",
  "settings.cleanupRangeLabels": {
    "7": "7 days ago",
    "15": "15 days ago",
    "30": "30 days ago",
    "60": "60 days ago",
    "90": "90 days ago",
    "180": "180 days ago"
  },
  "settings.cleanupRunning": "Clearing...",
  "settings.cleanupTitle": "Clear history records",
  "settings.closeToTrayHint": "Hide the main window and keep running in the background when closed.",
  "settings.closeToTrayLabel": "Close to tray",
  "settings.colorSchemeDialogDescription": "Preview immediately. Confirm to save.",
  "settings.colorSchemeDialogFallbackTitle": "Theme",
  "settings.colorSchemeHint": "Adjust light and dark theme colors separately.",
  "settings.colorSchemeLabel": "Color scheme",
  "settings.colorSchemeSaving": "Saving",
  "settings.confirmRangeFallback": "selected range",
  "settings.dataExportAction": "Export",
  "settings.dataExportActionHint": "Export activity records as needed.",
  "settings.dataExportHint": "Export existing activity records. Import external time data.",
  "settings.dataExportTitle": "Export and import",
  "settings.dataImport.availableLabel": "Ready to import",
  "settings.dataImport.batchesDescription": "Only the selected import batch is deleted. Patina's native data is unaffected.",
  "settings.dataImport.batchesTitle": "Delete external imported data",
  "settings.dataImport.batchTitle": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Import ",
        {
          "$op": "arg",
          "name": "number"
        },
        ""
      ]
    }
  },
  "settings.dataImport.categorizedAppsLabel": "Apps with categories",
  "settings.dataImport.categoryConflictNote": "Apps with multiple categories remain unclassified and can be assigned later.",
  "settings.dataImport.conflictedAppsLabel": "Category conflicts",
  "settings.dataImport.csvHint": "Choose a canonical CSV file to import.",
  "settings.dataImport.csvTitle": "Import CSV",
  "settings.dataImport.deleteBatchAction": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Delete import ",
        {
          "$op": "arg",
          "name": "number"
        },
        ""
      ]
    }
  },
  "settings.dataImport.deleteConfirmAction": "Delete",
  "settings.dataImport.deleteConfirmDescription": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "All external records from ",
        {
          "$op": "arg",
          "name": "sourceName"
        },
        " will be deleted. This cannot be undone."
      ]
    }
  },
  "settings.dataImport.deleteConfirmTitle": "Delete this import?",
  "settings.dataImport.deleteSuccess": {
    "$type": "message",
    "body": { "$op": "plural", "arg": "count", "cases": {
      "one": { "$op": "concat", "parts": ["Deleted ", { "$op": "arg", "name": "count" }, " external record"] },
      "other": { "$op": "concat", "parts": ["Deleted ", { "$op": "arg", "name": "count" }, " external records"] }
    } }
  },
  "settings.dataImport.destructureFormatsHint": "Currently supported:\nCSV files (.csv): Tai\nSQLite files (.db, .sqlite): Tai, Taix",
  "settings.dataImport.destructureHint": "Convert an external file to a canonical CSV.",
  "settings.dataImport.destructureTitle": "Destructure tool",
  "settings.dataImport.destructureSuccess": {
    "$type": "message",
    "body": { "$op": "plural", "arg": "count", "cases": {
      "one": { "$op": "concat", "parts": ["Generated ", { "$op": "arg", "name": "count" }, " record: ", { "$op": "arg", "name": "path" }] },
      "other": { "$op": "concat", "parts": ["Generated ", { "$op": "arg", "name": "count" }, " records: ", { "$op": "arg", "name": "path" }] }
    } }
  },
  "settings.dataImport.detailSeparator": ": ",
  "settings.dataImport.dialogDescription": "Import a canonical CSV, or convert external data first.",
  "settings.dataImport.dialogTitle": "Choose import method",
  "settings.dataImport.duplicateLabel": "Duplicate records",
  "settings.dataImport.errorLabel": "Invalid records",
  "settings.dataImport.exactLabel": "Exact records",
  "settings.dataImport.fileLabel": "Import file",
  "settings.dataImport.hourLabel": "Hourly totals",
  "settings.dataImport.importSuccess": {
    "$type": "message",
    "body": { "$op": "plural", "arg": "count", "cases": {
      "one": { "$op": "concat", "parts": ["Imported ", { "$op": "arg", "name": "count" }, " record"] },
      "other": { "$op": "concat", "parts": ["Imported ", { "$op": "arg", "name": "count" }, " records"] }
    } }
  },
  "settings.dataImport.lineError": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Line ",
        {
          "$op": "arg",
          "name": "line"
        },
        ": ",
        {
          "$op": "arg",
          "name": "message"
        },
        ""
      ]
    }
  },
  "settings.dataImport.previewTitle": "Import preview",
  "settings.dataImportAction": "Import",
  "settings.dataImportActionHint": "Import or convert external data.",
  "settings.dataSafetyTitle": "Storage",
  "settings.decreaseCleanupRange": "Shorten clear range",
  "settings.decreaseMinute": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Decrease ",
        {
          "$op": "arg",
          "name": "label"
        },
        " by 1 minute"
      ]
    }
  },
  "settings.dynamicEffectsHint": "Show motion for view changes and interaction feedback.",
  "settings.dynamicEffectsLabel": "Dynamic effects",
  "settings.globalTitleHint": "Save application window titles and webpage titles for activity history details.",
  "settings.globalTitleLabel": "Global titles",
  "settings.idle": "Saved",
  "settings.idleTimeoutHint": "When the current app has audio or similar signals, keep counting that time.",
  "settings.idleTimeoutLabel": "Continue counting",
  "settings.importRecordCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "count"
        },
        " imported records"
      ]
    }
  },
  "settings.increaseCleanupRange": "Extend clear range",
  "settings.increaseMinute": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Increase ",
        {
          "$op": "arg",
          "name": "label"
        },
        " by 1 minute"
      ]
    }
  },
  "settings.languageHint": "Change the interface language.",
  "settings.languageLabel": "Language",
  "settings.languageLoadFailed": "Language unavailable. Using current language.",
  "settings.languageOptions.enUS": "English",
  "settings.languageOptions.zhCN": "中文",
  "settings.launchAtLoginHint": "Start the app automatically after Windows sign-in.",
  "settings.launchAtLoginLabel": "Launch at login",
  "settings.loadFailed": "Could not load settings.",
  "settings.loading": "Loading settings...",
  "settings.minimizeToWidgetHint": "Hide the main window and show the side widget when minimized.",
  "settings.minimizeToWidgetLabel": "Minimize to widget",
  "settings.minuteValue": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "minutes"
        },
        " min"
      ]
    }
  },
  "settings.remoteBackupHint": "Link WebDAV for remote backups.",
  "settings.remoteBackupTitle": "WebDAV configuration",
  "settings.remoteStatusBridgeEnabledHint": "Push the current tracking status to the endpoint.",
  "settings.remoteStatusBridgeMachineIdLabel": "Device ID",
  "settings.remoteStatusBridgeTitle": "Remote push",
  "settings.remoteStatusBridgeTokenLabel": "Token",
  "settings.remoteStatusBridgeUrlLabel": "Endpoint URL",
  "settings.residentTitle": "Resident",
  "settings.restoreConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Restore strategy: ",
        {
          "$op": "arg",
          "name": "strategy"
        },
        "\nTarget file: ",
        {
          "$op": "arg",
          "name": "path"
        },
        "\n\n",
        {
          "$op": "arg",
          "name": "summary"
        },
        ""
      ]
    }
  },
  "settings.restoreConfirmTitle": "Restore backup",
  "settings.restoreSourceHint": "Choose a local backup file or download from the linked WebDAV target.",
  "settings.restoreSourceLocalHint": "Choose a local ZIP file.",
  "settings.restoreSourceLocalTitle": "Local restore",
  "settings.restoreSourceRemoteHint": "Choose a WebDAV backup file.",
  "settings.restoreSourceRemoteTitle": "WebDAV restore",
  "settings.restoreSourceTitle": "Choose restore source",
  "settings.restoreStrategyHint": "Choose how restore handles current data.",
  "settings.restoreStrategyLabel": "Restore strategy",
  "settings.restoreStrategyOptionHints.merge": "Keep current data and deduplicate",
  "settings.restoreStrategyOptionHints.replace": "Keep backup data only after restoring",
  "settings.restoreStrategyOptions.merge": "Merge",
  "settings.restoreStrategyOptions.replace": "Replace",
  "settings.retry": "Retry",
  "settings.save": "Save",
  "settings.saved": "Settings updated",
  "settings.saveFailed": "Could not save settings. Try again later.",
  "settings.scheduledBackupCleanupWarning": "The latest backup is valid, but the previous automatic backup could not be removed yet. Patina will retry later.",
  "settings.scheduledBackupLabels": {
    "directory": "Save to",
    "frequency": "Frequency",
    "nextExecution": "Next run",
    "recentFailure": "Recent failure",
    "recentSuccess": "Recent success",
    "time": "Time",
    "title": "Scheduled backup"
  },
  "settings.saving": "Saving...",
  "settings.servicesTitle": "Services",
  "settings.startMinimizedHint": "Hide the main window in the system tray after startup.",
  "settings.startMinimizedLabel": "Launch silently",
  "settings.storage.changePathAction": "Change location",
  "settings.storage.dataDirectoryLabel": "Data folder",
  "settings.storage.installDirectoryLabel": "Install folder",
  "settings.storage.openDirectoryAction": "Open folder",
  "settings.storage.restartAndApplyAction": "Restart and apply",
  "settings.storage.restoreDefaultPathAction": "Restore default location",
  "settings.storage.storageCacheMigrationConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Current cache: ",
        {
          "$op": "arg",
          "name": "currentWebviewRoot"
        },
        "\nTarget cache: ",
        {
          "$op": "arg",
          "name": "targetWebviewRoot"
        },
        "\n\nPatina will save the current record, restart, and use the target cache folder. Do not move or delete the target folder until this finishes."
      ]
    }
  },
  "settings.storage.storageCacheMigrationConfirmTitle": "Change cache folder",
  "settings.storage.storageDataMigrationConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Current folder: ",
        {
          "$op": "arg",
          "name": "currentDataRoot"
        },
        "\nTarget folder: ",
        {
          "$op": "arg",
          "name": "targetDataRoot"
        },
        "\n\nPatina will save the current record, restart, and migrate the data to the target folder. Do not move or delete either folder until migration finishes."
      ]
    }
  },
  "settings.storage.storageDataMigrationConfirmTitle": "Change data folder",
  "settings.storage.storageDirectorySummary": "Install folder follows the app install location; data and cache folders can be adjusted separately.",
  "settings.storage.storageDirectoryTitle": "Local paths",
  "settings.storage.storageMigrationFailed": "Could not prepare the restart. Check the target folder.",
  "settings.storage.storageOpenDirectoryFailed": "Could not open that folder.",
  "settings.storage.storageRestoreDefaultCacheConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Current cache: ",
        {
          "$op": "arg",
          "name": "currentWebviewRoot"
        },
        "\nDefault cache: ",
        {
          "$op": "arg",
          "name": "defaultWebviewRoot"
        },
        "\n\nPatina will save the current record, restart, and restore the default cache folder. Do not move or delete the default folder until this finishes."
      ]
    }
  },
  "settings.storage.storageRestoreDefaultDataConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Current data: ",
        {
          "$op": "arg",
          "name": "currentDataRoot"
        },
        "\nDefault data: ",
        {
          "$op": "arg",
          "name": "defaultDataRoot"
        },
        "\n\nPatina will save the current record, restart, and migrate the data to the default folder. Do not move or delete either folder until migration finishes."
      ]
    }
  },
  "settings.storage.storageSnapshotRefreshAction": "Check storage",
  "settings.storage.storageSnapshotRefreshFailed": "Could not check storage folders.",
  "settings.storage.webviewCacheClearConfirmDetail": "Patina will save the current record, restart, and clear regenerable WebView cache before creating the window.",
  "settings.storage.webviewCacheClearConfirmTitle": "Restart and clear cache?",
  "settings.storage.webviewCacheClearFailed": "Could not prepare cache cleanup. Try again.",
  "settings.storage.webviewCacheClearTitle": "Clear cache",
  "settings.storage.webviewCacheDirectoryLabel": "Cache folder",
  "settings.subtitle": "Adjust global runtime preferences",
  "settings.themeLibraryOptions.dark": "Dark theme",
  "settings.themeLibraryOptions.light": "Light theme",
  "settings.themeModeHint": "Light, dark, or follow the system appearance.",
  "settings.themeModeLabel": "Theme mode",
  "settings.themeModeOptions.dark": "Dark",
  "settings.themeModeOptions.light": "Light",
  "settings.themeModeOptions.system": "System",
  "settings.timelineMergeGapHint": "Stop after inactivity; brief app switches keep the timeline continuous.",
  "settings.timelineMergeGapLabel": "Activity hold time",
  "settings.title": "Settings",
  "settings.tracking": "Tracking",
  "settings.trackingPanelTitle": "Tracking",
  "settings.trackingPausedHint": "Paused tracking will stop writing new records. Resume to continue tracking.",
  "settings.trackingPausedLabel": "Pause tracking",
  "settings.unsaved": "Unsaved changes",
  "settings.webActivityAddressLabel": "Port",
  "settings.webActivityEnabledHint": "Receives active web pages from the browser extension.",
  "settings.webActivityHelpAction": "Guide",
  "settings.webActivityHelpCopiedAction": "Copied",
  "settings.webActivityHelpCopyPortAction": "Copy port",
  "settings.webActivityHelpCopyTokenAction": "Copy Token",
  "settings.webActivityHelpDescription": "Patina Web Sync sends the active webpage to the local Patina desktop app.",
  "settings.webActivityHelpNote": "After Patina Web Sync is enabled and connected:\n• Automatically syncs the active tab's website address, title, and website icon.\n• Does not read page body content, form values, screenshots, or clipboard contents.\n• Does not scan or import browser history.\n• Incognito windows are not written to web records.",
  "settings.webActivityHelpSteps": [
    {
      "title": "Prepare connection details",
      "description": "The extension uses this page's port and Token to connect to the local Patina app.",
      "details": [
        "Copy the port and Token, then paste them into the extension settings later."
      ]
    },
    {
      "title": "Install the browser extension",
      "description": "Choose a browser and install Patina Web Sync from its store.",
      "showStoreBadges": true,
      "details": [
        {
          "text": "If a store is unavailable, install manually from Patina Web Sync releases.",
          "links": [
            {
              "label": "Open releases",
              "href": "https://github.com/Ceceliaee/patina-web-sync/releases/latest"
            }
          ]
        }
      ]
    },
    {
      "title": "Configure the extension",
      "description": "Open the Patina Web Sync settings page and enter the connection details shown here.",
      "details": [
        "Open the Extensions menu in the browser toolbar.",
        "Find Patina Web Sync and open it.",
        "Click Settings in the extension popup.",
        "Paste the port and Token shown on this page.",
        "You can also enter from the extensions management page: find Patina Web Sync, click Details, then click Extension options."
      ]
    },
    {
      "title": "Sync the current page",
      "description": "After you open a regular webpage, the extension syncs the active page.",
      "details": [
        "Open an http/https webpage.",
        "Wait for Patina Web Sync to automatically sync the current page.",
        "To sync once immediately, click Sync current page in the extension popup."
      ]
    }
  ],
  "settings.webActivityHelpTitle": "Web Sync Guide",
  "settings.webActivityTitle": "Web sync",
  "settings.webActivityTokenLabel": "Token",
  "settings.webDavConfigDescription": "Used only for remote backup, not cloud sync.",
  "settings.webDavConfigTitle": "WebDAV configuration",
  "settings.webDavConfigure": "Configure",
  "settings.webDavDeleteAction": "Delete",
  "settings.webDavDeleteDetail": "This only removes the local WebDAV settings and password. Remote backup files are not deleted.",
  "settings.webDavDeleteTitle": "Delete WebDAV configuration",
  "settings.webDavEdit": "Edit",
  "settings.webDavPassword": "App password",
  "settings.webDavRemoteBackupsDescription": "Choose a remote backup. It will be downloaded, previewed for compatibility, then confirmed for restore.",
  "settings.webDavRemoteBackupsEmpty": "No remote backups available.",
  "settings.webDavRemoteBackupsTitle": "Remote backups",
  "settings.webDavRestoreSelected": "Restore",
  "settings.webDavServerUrl": "Server address",
  "settings.webDavTestConnection": "Test connection",
  "settings.webDavTesting": "Testing...",
  "settings.webDavUsername": "Username"
} as const;
