// en-US destinationDetail locale resource. Pure data only.
export const MESSAGES = {
  "destinationDetail.activeWindow": "Activity span",
  "destinationDetail.activityAria": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        {
          "$op": "concat",
          "parts": [
            "",
            {
              "$op": "arg",
              "name": "start"
            },
            " to ",
            {
              "$op": "arg",
              "name": "end"
            },
            ", ",
            {
              "$op": "arg",
              "name": "name"
            },
            ", ",
            {
              "$op": "arg",
              "name": "duration"
            },
            ", ",
            {
              "$op": "arg",
              "name": "fragmentCount"
            },
            " "
          ]
        },
        {
          "$op": "concat",
          "parts": [
            "",
            {
              "$op": "plural",
              "arg": "fragmentCount",
              "cases": {
                "one": "fragment",
                "other": "fragments"
              }
            },
            ""
          ]
        }
      ]
    }
  },
  "destinationDetail.close": "Close details",
  "destinationDetail.current": "In progress",
  "destinationDetail.dayError": "Could not load this day's records",
  "destinationDetail.details": {
    "$type": "message",
    "body": {
      "$op": "if",
      "when": {
        "$op": "eq",
        "left": {
          "$op": "arg",
          "name": "mode"
        },
        "right": "app"
      },
      "then": "App details",
      "else": "Website details"
    }
  },
  "destinationDetail.focusedDate": "Focused date",
  "destinationDetail.fragmentCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "count"
        },
        " ",
        {
          "$op": "plural",
          "arg": "count",
          "cases": {
            "one": "fragment",
            "other": "fragments"
          }
        },
        ""
      ]
    }
  },
  "destinationDetail.loading": "Loading details",
  "destinationDetail.minimumDuration": "Minimum activity duration",
  "destinationDetail.nextDay": "Next day",
  "destinationDetail.noActivity": "No activity for this item on this day",
  "destinationDetail.noActivityAtMinimum": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "No activity lasting at least ",
        {
          "$op": "arg",
          "name": "minutes"
        },
        " ",
        {
          "$op": "plural",
          "arg": "minutes",
          "cases": {
            "one": "minute",
            "other": "minutes"
          }
        },
        ""
      ]
    }
  },
  "destinationDetail.noActivityInWindow": "No activity for this item in the current time window",
  "destinationDetail.objectTypeApp": "App",
  "destinationDetail.objectTypeWeb": "Website",
  "destinationDetail.open": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "View details for ",
        {
          "$op": "arg",
          "name": "name"
        },
        ""
      ]
    }
  },
  "destinationDetail.previousDay": "Previous day",
  "destinationDetail.recordAria": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "start"
        },
        " to ",
        {
          "$op": "arg",
          "name": "end"
        },
        ", ",
        {
          "$op": "arg",
          "name": "title"
        },
        ", ",
        {
          "$op": "arg",
          "name": "duration"
        },
        ""
      ]
    }
  },
  "destinationDetail.recordedDuration": "Recorded today",
  "destinationDetail.records": "Activity records",
  "destinationDetail.retry": "Retry",
  "destinationDetail.timeline": "Daily timeline",
  "destinationDetail.timelineAria": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "name"
        },
        " daily timeline for ",
        {
          "$op": "arg",
          "name": "dateKey"
        },
        ""
      ]
    }
  },
  "destinationDetail.timelineDecreaseHours": "Shorten timeline window",
  "destinationDetail.timelineHoursValue": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "hours"
        },
        " ",
        {
          "$op": "plural",
          "arg": "hours",
          "cases": {
            "one": "hour",
            "other": "hours"
          }
        },
        ""
      ]
    }
  },
  "destinationDetail.timelineIncreaseHours": "Expand timeline window",
  "destinationDetail.timelineInteractionAria": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "name"
        },
        " timeline for ",
        {
          "$op": "arg",
          "name": "dateKey"
        },
        ", ",
        {
          "$op": "arg",
          "name": "windowLabel"
        },
        "; use the mouse wheel to zoom, or drag and use the left and right arrow keys to pan"
      ]
    }
  },
  "destinationDetail.timelineWindowHours": "Timeline window duration",
  "destinationDetail.timelineZoom": "Timeline zoom",
  "destinationDetail.titleDetails": "Title details",
  "destinationDetail.toggleTitleDetails": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "if",
          "when": {
            "$op": "arg",
            "name": "expanded"
          },
          "then": "Hide",
          "else": "Show"
        },
        " title details for ",
        {
          "$op": "arg",
          "name": "name"
        },
        ""
      ]
    }
  }
} as const;
