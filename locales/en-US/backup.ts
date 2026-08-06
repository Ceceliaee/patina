// en-US backup locale resource. Pure data only.
export const MESSAGES = {
  "backup.appVersion": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "App version: ",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "backup.exportedAt": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Exported at: ",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "backup.formatLabel": {
    "$type": "message",
    "body": {
      "$op": "if",
      "when": {
        "$op": "eq",
        "left": {
          "$op": "arg",
          "name": "kind"
        },
        "right": "sqlite_snapshot"
      },
      "then": "Backup type: SQLite data snapshot",
      "else": "Backup type: legacy migration backup"
    }
  },
  "backup.importItemCounts": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "External imports: ",
        {
          "$op": "arg",
          "name": "batchCount"
        },
        " batches, ",
        {
          "$op": "arg",
          "name": "exactCount"
        },
        " exact records, ",
        {
          "$op": "arg",
          "name": "bucketCount"
        },
        " hour summaries"
      ]
    }
  },
  "backup.itemCounts": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Patina-native activity: ",
        {
          "$op": "arg",
          "name": "sessionCount"
        },
        ", settings: ",
        {
          "$op": "arg",
          "name": "settingCount"
        },
        ", cached icons: ",
        {
          "$op": "arg",
          "name": "iconCacheCount"
        },
        ""
      ]
    }
  },
  "backup.legacyExternalDataNotice": "This legacy backup does not contain external import data.",
  "backup.restoreMessage": {
    "$type": "message",
    "body": {
      "$op": "arg",
      "name": "fallback"
    }
  },
  "backup.restoreSafety": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Restore status: ",
        {
          "$op": "arg",
          "name": "message"
        },
        ""
      ]
    }
  }
} as const;
