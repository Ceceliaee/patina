// en-US accessibility locale resource. Pure data only.
export const MESSAGES = {
  "accessibility.color.blueChannel": "Blue channel",
  "accessibility.color.color": "Color",
  "accessibility.color.colorFormat": "Color format",
  "accessibility.color.colorPicker": "Color picker",
  "accessibility.color.eyedropper": "Eyedropper",
  "accessibility.color.eyedropperUnsupported": "Eyedropper is unavailable",
  "accessibility.color.greenChannel": "Green channel",
  "accessibility.color.hexValue": "Hex color value",
  "accessibility.color.hueChannel": "Hue",
  "accessibility.color.hueSlider": "Hue slider",
  "accessibility.color.lightnessChannel": "Lightness",
  "accessibility.color.redChannel": "Red channel",
  "accessibility.color.saturationChannel": "Saturation",
  "accessibility.data.appTrendRange": "Select app trend range",
  "accessibility.data.earlierRange": "Switch to earlier range",
  "accessibility.data.heatmapCell": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "dateKey"
        },
        ", ",
        {
          "$op": "arg",
          "name": "summary"
        },
        ""
      ]
    }
  },
  "accessibility.data.heatmapRange": "Select heatmap range",
  "accessibility.data.longerAppTrendRange": "Expand app trend range",
  "accessibility.data.longerTrendRange": "Expand trend range",
  "accessibility.data.newerRange": "Switch to newer range",
  "accessibility.data.nextPickerMode": "Next range mode",
  "accessibility.data.nextPickerMonth": "Next month",
  "accessibility.data.openTrendRangePicker": "Open trend range picker",
  "accessibility.data.previousPickerMode": "Previous range mode",
  "accessibility.data.previousPickerMonth": "Previous month",
  "accessibility.data.resetTrendRange": "Reset to last 7 days",
  "accessibility.data.shorterAppTrendRange": "Shorten app trend range",
  "accessibility.data.shorterTrendRange": "Shorten trend range",
  "accessibility.data.trendRange": "Select trend range",
  "accessibility.data.trendSummary": "Trend summary",
  "accessibility.data.webTrendRange": "Select web trend range",
  "accessibility.date.nextMonth": "Next month",
  "accessibility.date.previousMonth": "Previous month",
  "accessibility.history.decreaseMinDuration": "Decrease display minutes by 1 minute",
  "accessibility.history.increaseMinDuration": "Increase display minutes by 1 minute",
  "accessibility.history.nextDay": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Switch to next day: ",
        {
          "$op": "arg",
          "name": "dateLabel"
        },
        ""
      ]
    }
  },
  "accessibility.history.nextMonth": "Next month",
  "accessibility.history.previousDay": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Switch to previous day: ",
        {
          "$op": "arg",
          "name": "dateLabel"
        },
        ""
      ]
    }
  },
  "accessibility.history.previousMonth": "Previous month",
  "accessibility.history.toggleActivityDetails": {
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
          "then": "Collapse",
          "else": "Expand"
        },
        " title details for ",
        {
          "$op": "arg",
          "name": "appName"
        },
        ""
      ]
    }
  },
  "accessibility.settings.colorScheme": "Color scheme",
  "accessibility.settings.copyWebActivityPort": "Copy web sync port",
  "accessibility.settings.copyWebActivityToken": "Copy web sync Token",
  "accessibility.settings.generateServiceToken": "Generate token",
  "accessibility.settings.hideRemoteMachineId": "Hide device ID",
  "accessibility.settings.hideServiceToken": "Hide token",
  "accessibility.settings.openWebActivityHelp": "Open web sync guide",
  "accessibility.settings.showRemoteMachineId": "Show device ID",
  "accessibility.settings.showServiceToken": "Show token",
  "accessibility.settings.toggleBackgroundOptimization": "Toggle low-footprint background",
  "accessibility.settings.toggleCloseToTray": "Toggle close to tray",
  "accessibility.settings.toggleGlobalTitle": "Toggle global titles",
  "accessibility.settings.toggleLaunchAtLogin": "Toggle launch at login",
  "accessibility.settings.toggleMinimizeToWidget": "Toggle minimize to widget",
  "accessibility.settings.toggleRemoteStatusBridge": "Toggle remote push",
  "accessibility.settings.toggleStartMinimized": "Toggle silent launch",
  "accessibility.settings.toggleTrackingPaused": "Toggle pause tracking",
  "accessibility.settings.toggleWebActivity": "Toggle web sync",
  "accessibility.titleBar.close": "Close window",
  "accessibility.titleBar.maximize": "Maximize window",
  "accessibility.titleBar.minimize": "Minimize window",
  "accessibility.titleBar.restore": "Restore window",
  "accessibility.tools.addTimerLap": "Add lap",
  "accessibility.tools.cancelReminder": "Cancel reminder",
  "accessibility.tools.createReminder": "Create reminder",
  "accessibility.tools.decreaseDuration": {
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
  "accessibility.tools.increaseDuration": {
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
  "accessibility.tools.openStatusChip": "Open tool status",
  "accessibility.tools.pausePomodoro": "Pause pomodoro",
  "accessibility.tools.pauseTimer": "Pause timing",
  "accessibility.tools.resetPomodoro": "Reset pomodoro",
  "accessibility.tools.resetTimer": "Reset timing",
  "accessibility.tools.restorePomodoroDefaults": "Restore pomodoro default durations",
  "accessibility.tools.resumePomodoro": "Resume pomodoro",
  "accessibility.tools.resumeTimer": "Resume timing",
  "accessibility.tools.skipPomodoroPhase": "Skip pomodoro phase",
  "accessibility.tools.startPomodoro": "Start pomodoro",
  "accessibility.tools.startTimer": "Start timing",
  "accessibility.widget.collapse": "Collapse widget",
  "accessibility.widget.currentApp": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Current app: ",
        {
          "$op": "arg",
          "name": "appName"
        },
        ""
      ]
    }
  },
  "accessibility.widget.expand": "Expand widget",
  "accessibility.widget.openMainWindow": "Open main window",
  "accessibility.widget.toggle": {
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
          "then": "Collapse widget",
          "else": "Expand widget"
        },
        ", ",
        {
          "$op": "arg",
          "name": "statusTitle"
        },
        ""
      ]
    }
  }
} as const;
