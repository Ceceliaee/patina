// en-US tools locale resource. Pure data only.
export const MESSAGES = {
  "tools.absoluteDateLabel": "Date",
  "tools.absoluteTimeLabel": "Time",
  "tools.actionFailed": "Action failed. Try again later.",
  "tools.activityReminderAppPlaceholder": "Select app",
  "tools.activityReminderCandidatesLoadFailed": "Targets unavailable.",
  "tools.activityReminderCategoryPlaceholder": "Select category",
  "tools.activityReminderDisable": "Disable",
  "tools.activityReminderEmpty": "No rules",
  "tools.activityReminderRulesTitle": "Rules",
  "tools.activityReminderSuspension.source_disabled": "Source off",
  "tools.activityReminderSuspension.target_deleted": "Target deleted",
  "tools.activityReminderSuspension.target_excluded": "Excluded",
  "tools.activityReminderTargetLabel": "Target",
  "tools.activityReminderTargetRequired": "Select a target.",
  "tools.activityReminderWebPlaceholder": "Select website",
  "tools.alertDismiss": "Got it",
  "tools.alertOccurredAt": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Due at ",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "tools.alertPausePomodoro": "Pause",
  "tools.alertPausingPomodoro": "Pausing...",
  "tools.beta": "Beta",
  "tools.completedToday": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "count"
        },
        " completed today"
      ]
    }
  },
  "tools.countdownDuration": "Countdown duration",
  "tools.createReminder": "Create",
  "tools.defaultReminderLabel": "Time is up",
  "tools.dueNow": "Now",
  "tools.durationPresets": {
    "5": "5 min",
    "10": "10 min",
    "25": "25 min",
    "30": "30 min",
    "60": "60 min"
  },
  "tools.focusDuration": "Focus duration",
  "tools.lap": "Lap",
  "tools.lapIndex": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Lap ",
        {
          "$op": "arg",
          "name": "index"
        },
        ""
      ]
    }
  },
  "tools.lapsEmpty": "No laps",
  "tools.lapsTitle": "Laps",
  "tools.loadFailed": "Could not load tools status.",
  "tools.longBreakDuration": "Long break",
  "tools.longBreakEvery": "Long break interval",
  "tools.longBreakEveryValue": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Every ",
        {
          "$op": "arg",
          "name": "count"
        },
        " pomodoros"
      ]
    }
  },
  "tools.minuteValue": {
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
  "tools.newReminder": "New reminder",
  "tools.notificationStatus": "Due notifications",
  "tools.pause": "Pause",
  "tools.pendingReminders": "Reminder list",
  "tools.pomodoroCycle": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "index"
        },
        " / ",
        {
          "$op": "arg",
          "name": "every"
        },
        " pomodoro"
      ]
    }
  },
  "tools.pomodoroPhase.focus": "Focus",
  "tools.pomodoroPhase.longBreak": "Long break",
  "tools.pomodoroPhase.shortBreak": "Short break",
  "tools.pomodoroSettings": "Default durations",
  "tools.pomodoroStatus.completed": "Completed",
  "tools.pomodoroStatus.idle": "Not started",
  "tools.pomodoroStatus.paused": "Paused",
  "tools.pomodoroStatus.running": "Running",
  "tools.pomodoroTitle": "Pomodoro",
  "tools.relativeMinutesLabel": "Minutes from now",
  "tools.reminderEmpty": "No pending reminders",
  "tools.reminderLabel": "Reminder",
  "tools.reminderLabelPlaceholder": "Example: take a break",
  "tools.reminderModeAbsolute": "Exact time",
  "tools.reminderModeEvent": "Event",
  "tools.reminderModeApp": "App",
  "tools.reminderModeCategory": "Category",
  "tools.reminderModeRelative": "Relative time",
  "tools.reminderModeWeb": "Web",
  "tools.reminderStatus.cancelled": "Cancelled",
  "tools.reminderStatus.fired": "Fired",
  "tools.reminderStatus.scheduled": "Scheduled",
  "tools.remindersTitle": "Reminder",
  "tools.reminderTimeInvalid": "Reminder time needs to be in the future.",
  "tools.reset": "Reset",
  "tools.resume": "Resume",
  "tools.retry": "Retry",
  "tools.settingsEmpty": "No configurable items.",
  "tools.settingsTitle": "Tools settings",
  "tools.shortBreakDuration": "Short break",
  "tools.skipPhase": "Skip",
  "tools.activityReminderActive": "Active",
  "tools.activityReminderDailyLimit": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "minutes"
        },
        " min daily"
      ]
    }
  },
  "tools.activityReminderDurationInvalid": "Use 1–1440 min.",
  "tools.activityReminderDurationLabel": "Daily limit (min)",
  "tools.activityReminderMessageLabel": "Message",
  "tools.activityReminderMessagePlaceholder": "Example: take a break",
  "tools.start": "Start",
  "tools.statusChip.break": "Break",
  "tools.statusChip.countdown": "Countdown",
  "tools.statusChip.focus": "Focus",
  "tools.statusChip.reminder": "Reminder",
  "tools.statusChip.stopwatch": "Timer",
  "tools.subtitle": "Start local desktop tools",
  "tools.timerHint": "Timer results are not written to activity records.",
  "tools.timerLabel": "Name",
  "tools.timerLabelPlaceholder": "Optional",
  "tools.timerModeCountdown": "Countdown",
  "tools.timerModeStopwatch": "Count up",
  "tools.timerStatus.completed": "Completed",
  "tools.timerStatus.idle": "Not started",
  "tools.timerStatus.paused": "Paused",
  "tools.timerStatus.running": "Running",
  "tools.timerTitle": "Timer",
  "tools.title": "Tools"
} as const;
