// en-US native locale resource. Pure data only.
export const MESSAGES = {
  "native.category.ai": "AI",
  "native.category.browser": "Browser",
  "native.category.communication": "Communication",
  "native.category.design": "Design",
  "native.category.development": "Development",
  "native.category.game": "Game",
  "native.category.music": "Music",
  "native.category.office": "Office",
  "native.category.other": "Other",
  "native.category.system": "System",
  "native.category.utility": "Utility",
  "native.category.video": "Video",
  "native.export.duration": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        {
          "$op": "plural",
          "arg": "hours",
          "cases": {
            "one": { "$op": "concat", "parts": [{ "$op": "arg", "name": "hours" }, "h"] },
            "other": { "$op": "concat", "parts": [{ "$op": "arg", "name": "hours" }, "h"] }
          }
        },
        " ",
        {
          "$op": "plural",
          "arg": "minutes",
          "cases": {
            "one": { "$op": "concat", "parts": [{ "$op": "arg", "name": "minutes" }, "m"] },
            "other": { "$op": "concat", "parts": [{ "$op": "arg", "name": "minutes" }, "m"] }
          }
        }
      ]
    }
  },
  "native.export.empty": "No activity records were found in the selected range.",
  "native.export.exportedAt": {
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
  "native.export.field.app_name": "App Name",
  "native.export.field.browser_client_id": "Browser Client ID",
  "native.export.field.browser_exe_name": "Browser Executable",
  "native.export.field.browser_kind": "Browser Kind",
  "native.export.field.category": "Category",
  "native.export.field.category_color": "Category Color",
  "native.export.field.category_id": "Category ID",
  "native.export.field.continuity_group_start_time": "Continuity Group Start",
  "native.export.field.created_at": "Created At",
  "native.export.field.domain": "Domain",
  "native.export.field.duration_minutes": "Duration (minutes)",
  "native.export.field.duration_ms": "Duration (ms)",
  "native.export.field.end_time": "End Time",
  "native.export.field.exe_name": "Executable Name",
  "native.export.field.favicon_url": "Favicon URL",
  "native.export.field.local_date": "Local Date",
  "native.export.field.local_month": "Local Month",
  "native.export.field.local_week": "Local Week",
  "native.export.field.normalized_domain": "Normalized Domain",
  "native.export.field.page_title": "Page Title",
  "native.export.field.record_type": "Record Type",
  "native.export.field.session_id": "Session ID",
  "native.export.field.source_key": "Source Key",
  "native.export.field.source_name": "Source Name",
  "native.export.field.start_hour": "Start Hour",
  "native.export.field.start_time": "Start Time",
  "native.export.field.unknown": "Unknown Field",
  "native.export.field.updated_at": "Updated At",
  "native.export.field.url": "URL",
  "native.export.field.web_segment_id": "Web Segment ID",
  "native.export.field.web_source": "Web Source",
  "native.export.field.weekday": "Weekday",
  "native.export.field.window_title": "Window Title",
  "native.export.range": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Range: ",
        {
          "$op": "arg",
          "name": "start"
        },
        " to ",
        {
          "$op": "arg",
          "name": "end"
        },
        ""
      ]
    }
  },
  "native.export.rangeAll": "All",
  "native.export.rangeCurrent": "Current",
  "native.export.records": {
    "$type": "message",
    "body": {
      "$op": "plural",
      "arg": "count",
      "cases": {
        "one": { "$op": "concat", "parts": ["Record: ", { "$op": "arg", "name": "count" }] },
        "other": { "$op": "concat", "parts": ["Records: ", { "$op": "arg", "name": "count" }] }
      }
    }
  },
  "native.export.title": "Patina Activity Records",
  "native.export.totalDuration": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Total duration: ",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "native.tools.activityReminderAppTitle": "App reminder",
  "native.tools.activityReminderCategoryTitle": "Category reminder",
  "native.tools.activityReminderDefaultBody": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        { "$op": "arg", "name": "targetName" },
        " has been active for ",
        {
          "$op": "plural",
          "arg": "usageMinutes",
          "cases": {
            "one": { "$op": "concat", "parts": [{ "$op": "arg", "name": "usageMinutes" }, " minute"] },
            "other": { "$op": "concat", "parts": [{ "$op": "arg", "name": "usageMinutes" }, " minutes"] }
          }
        },
        ", reaching the ",
        {
          "$op": "plural",
          "arg": "limitMinutes",
          "cases": {
            "one": { "$op": "concat", "parts": [{ "$op": "arg", "name": "limitMinutes" }, "-minute daily limit"] },
            "other": { "$op": "concat", "parts": [{ "$op": "arg", "name": "limitMinutes" }, "-minute daily limit"] }
          }
        }
      ]
    }
  },
  "native.tools.activityReminderWebTitle": "Web reminder",
  "native.tools.breakEnded": "Break complete",
  "native.tools.countdownDefaultBody": "The countdown is complete",
  "native.tools.countdownTitle": "Countdown finished",
  "native.tools.focusEnded": "Focus complete",
  "native.tools.nextFocus": "Next: focus",
  "native.tools.nextLongBreak": "Next: long break",
  "native.tools.nextShortBreak": "Next: short break",
  "native.tools.reminderDefaultBody": "Time is up",
  "native.tools.reminderTitle": "Reminder",
  "native.tray.disableTitle": "Block titles",
  "native.tray.enableTitle": "Record titles",
  "native.tray.pause": "Pause tracking",
  "native.tray.quit": "Exit Patina",
  "native.tray.resume": "Resume tracking",
  "native.tray.showMain": "Open main window"
} as const;
