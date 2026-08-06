// en-US dashboard locale resource. Pure data only.
export const MESSAGES = {
  "dashboard.active": "Active now",
  "dashboard.afk": "Idle",
  "dashboard.comparedWithYesterday": {
    "$type": "message",
    "body": {
      "$op": "if",
      "when": {
        "$op": "eq",
        "left": {
          "$op": "arg",
          "name": "direction"
        },
        "right": "same"
      },
      "then": "Same as yesterday",
      "else": {
        "$op": "concat",
        "parts": [
          "",
          {
            "$op": "if",
            "when": {
              "$op": "eq",
              "left": {
                "$op": "arg",
                "name": "direction"
              },
              "right": "increase"
            },
            "then": "Up",
            "else": "Down"
          },
          " ",
          {
            "$op": "arg",
            "name": "deltaLabel"
          },
          " from yesterday"
        ]
      }
    }
  },
  "dashboard.emptyState": "No records today",
  "dashboard.focusShare": "Focus share",
  "dashboard.hourlyActivity": "Today's Activity",
  "dashboard.idle": "Idle",
  "dashboard.paused": "Paused",
  "dashboard.sharePrefix": "Share",
  "dashboard.showHourlyActivityByCategory": "Show by category",
  "dashboard.showTotalHourlyActivity": "Show total activity",
  "dashboard.subtitle": "View today's activity",
  "dashboard.title": "Today",
  "dashboard.topApps": "Top Apps",
  "dashboard.topAppsBadge": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Top ",
        {
          "$op": "arg",
          "name": "count"
        },
        ""
      ]
    }
  },
  "dashboard.total": "Total",
  "dashboard.tracking": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Tracking: ",
        {
          "$op": "arg",
          "name": "activeAppName"
        },
        ""
      ]
    }
  },
  "dashboard.trackingPaused": "Tracking paused"
} as const;
