// en-US tools locale resource. Pure data only.
export const MESSAGES = {
  "tools.reminderTimeLabel": "Remind at",
  "tools.reminderRepeatLabel": "Repeat",
  "tools.reminderRepeatNone": "Never",
  "tools.reminderRepeatInterval": "At intervals",
  "tools.reminderRepeatDaily": "Daily",
  "tools.reminderRepeatWeekly": "Weekly",
  "tools.reminderRepeatMonthly": "Monthly",
  "tools.reminderRepeatYearly": "Yearly",
  "tools.reminderIntervalLabel": "Interval",
  "tools.reminderMinutesUnit": "Minutes",
  "tools.reminderHoursUnit": "Hours",
  "tools.reminderRepeatInvalid": "Select at least one weekday.",

  "tools.reminderSnooze": "Remind me later",
  "tools.reminderConfirmComplete": "Mark complete",
  "tools.reminderCompleted": "Completed",
  "tools.reminderPendingConfirmation": "Awaiting confirmation",
  "tools.reminderSnoozeDelay": {"$type": "message", "body": {"$op": "concat", "parts": ["In ", {"$op": "arg", "name": "value"}]}},
  "tools.reminderOccurredAt": {"$type": "message", "body": {"$op": "concat", "parts": ["Reminder time: ", {"$op": "arg", "name": "value"}]}},
  "tools.reminderEditTitle": "Edit reminder",
  "tools.usageLimitReached": "Today’s time allowance is used up",
  "tools.usageExtend": "Extend usage",
  "tools.usageReturnDesktop": "Return to desktop",
  "tools.usageExtendFifteen": "Use for 15 more minutes",
  "tools.usageExtendHour": "Use for 1 more hour",
  "tools.usageExtendToday": "No limit for today",
  "tools.usageExtensionDuration": "Additional usage time",
  "tools.usageExtendTitle": {"$type": "message", "body": {"$op": "concat", "parts": ["Extend usage for “", {"$op": "arg", "name": "value"}, "”"]}},
  "tools.usageLimitSummary": {"$type": "message", "body": {"$op": "concat", "parts": ["You’ve used ", {"$op": "arg", "name": "value"}, ". The usage limit has been reached."]}},
  "tools.absoluteDateLabel": "Date",
  "tools.absoluteTimeLabel": "Time",
  "tools.actionFailed": "Action failed. Try again later.",
  "tools.activityReminderCandidatesLoadFailed": "Targets unavailable.",
  "tools.activityReminderDisable": "Disable",
  "tools.activityReminderEdit": "Edit",
  "tools.activityReminderDelete": "Delete",
  "tools.activityReminderEditTitle": "Edit usage limit",
  "tools.activityReminderEmpty": "No rules",
  "tools.activityReminderRulesTitle": "Rules",
  "tools.activityReminderSuspension.source_disabled": "Source off",
  "tools.activityReminderSuspension.target_deleted": "Target deleted",
  "tools.activityReminderSuspension.target_excluded": "Excluded",
  "tools.activityReminderTargetLabel": "Target",
  "tools.activityReminderTargetPlaceholder": "Choose an app, category, or website",
  "tools.activityReminderTargetRequired": "Select a target.",
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
  "tools.createReminder": "Create",
  "tools.defaultReminderLabel": "Time is up",
  "tools.focusDuration": "Focus duration",
  "tools.loadFailed": "Could not load tools status.",
  "tools.longBreakDuration": "Long break",
  "tools.longBreakEvery": "Long break interval",
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
  "tools.pomodoroTitle": "Focus",
  "tools.focusModePomodoro": "Pomodoro",
  "tools.focusModeFree": "Free focus",
  "tools.relativeMinutesLabel": "Minutes from now",
  "tools.reminderEmpty": "No reminders",
  "tools.reminderLabel": "Reminder",
  "tools.reminderLabelPlaceholder": "Example: take a break",
  "tools.reminderModeAbsolute": "Exact time",
  "tools.reminderModeEvent": "Timed reminders",
  "tools.reminderModeUsage": "Usage limits",
  "tools.reminderModeApp": "App",
  "tools.reminderModeCategory": "Category",
  "tools.reminderModeRelative": "Relative time",
  "tools.reminderModeWeb": "Web",
  "tools.remindersTitle": "Reminder",
  "tools.reminderTimeInvalid": "Reminder time needs to be in the future.",
  "tools.reset": "Reset",
  "tools.resume": "Resume",
  "tools.settingsEmpty": "No configurable items.",
  "tools.settingsTitle": "Tools settings",
  "tools.shortBreakDuration": "Short break",
  "tools.skipPhase": "Skip",
  "tools.activityReminderActive": "Active",
  "tools.activityReminderDurationLabel": "Daily limit",
  "tools.start": "Start",
  "tools.stateRefreshPending": "State is recovering. Do not repeat this action.",
  "tools.statusChip.break": "Break",
  "tools.statusChip.focus": "Focus",
  "tools.statusChip.reminder": "Reminder",
  "tools.title": "Tools"
} as const;
