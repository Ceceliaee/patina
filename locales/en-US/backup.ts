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
  "backup.formatLabel": "Backup type: SQLite data snapshot",
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
