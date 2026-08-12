// zh-CN tools locale resource. Pure data only.
export const MESSAGES = {
  "tools.absoluteDateLabel": "日期",
  "tools.absoluteTimeLabel": "时间",
  "tools.actionFailed": "操作失败，可稍后重试。",
  "tools.activityReminderAppPlaceholder": "输入或选择应用",
  "tools.activityReminderCandidatesLoadFailed": "无法加载可选目标。",
  "tools.activityReminderCategoryPlaceholder": "选择分类",
  "tools.activityReminderDisable": "停用",
  "tools.activityReminderEmpty": "此目标类型暂无活动规则",
  "tools.activityReminderRulesTitle": "活动规则",
  "tools.activityReminderSuspension.source_disabled": "数据源已关闭",
  "tools.activityReminderSuspension.target_deleted": "目标已删除",
  "tools.activityReminderSuspension.target_excluded": "已排除",
  "tools.activityReminderTargetLabel": "目标",
  "tools.activityReminderTargetRequired": "请选择可用目标。",
  "tools.activityReminderWebPlaceholder": "输入或选择网页",
  "tools.activityReminderWebSourceEmpty": "暂无可选的已记录网页。网页活动关闭时，已有规则仍会显示并暂停。",
  "tools.alertDismiss": "知道了",
  "tools.alertOccurredAt": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "到点时间：",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "tools.alertPausePomodoro": "暂停",
  "tools.alertPausingPomodoro": "暂停中...",
  "tools.beta": "Beta",
  "tools.completedToday": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "今日完成 ",
        {
          "$op": "arg",
          "name": "count"
        },
        " 个"
      ]
    }
  },
  "tools.countdownDuration": "倒计时时长",
  "tools.createReminder": "创建",
  "tools.defaultReminderLabel": "时间到了",
  "tools.dueNow": "现在",
  "tools.durationPresets": {
    "5": "5 分钟",
    "10": "10 分钟",
    "25": "25 分钟",
    "30": "30 分钟",
    "60": "60 分钟"
  },
  "tools.focusDuration": "专注时长",
  "tools.lap": "分段",
  "tools.lapIndex": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "第 ",
        {
          "$op": "arg",
          "name": "index"
        },
        " 段"
      ]
    }
  },
  "tools.lapsEmpty": "暂无分段",
  "tools.lapsTitle": "分段",
  "tools.loadFailed": "工具状态加载失败。",
  "tools.longBreakDuration": "长休息时长",
  "tools.longBreakEvery": "长休息间隔",
  "tools.longBreakEveryValue": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "每 ",
        {
          "$op": "arg",
          "name": "count"
        },
        " 个番茄"
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
        " 分钟"
      ]
    }
  },
  "tools.newReminder": "新建提醒",
  "tools.notificationStatus": "到期通知",
  "tools.pause": "暂停",
  "tools.pendingReminders": "提醒列表",
  "tools.pomodoroCycle": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "第 ",
        {
          "$op": "arg",
          "name": "index"
        },
        " / ",
        {
          "$op": "arg",
          "name": "every"
        },
        " 个番茄"
      ]
    }
  },
  "tools.pomodoroPhase.focus": "专注",
  "tools.pomodoroPhase.longBreak": "长休息",
  "tools.pomodoroPhase.shortBreak": "短休息",
  "tools.pomodoroSettings": "默认时长",
  "tools.pomodoroStatus.completed": "已完成",
  "tools.pomodoroStatus.idle": "未开始",
  "tools.pomodoroStatus.paused": "已暂停",
  "tools.pomodoroStatus.running": "运行中",
  "tools.pomodoroTitle": "番茄钟",
  "tools.relativeMinutesLabel": "分钟后",
  "tools.reminderEmpty": "暂无待提醒",
  "tools.reminderLabel": "提醒内容",
  "tools.reminderLabelPlaceholder": "例如：休息一下",
  "tools.reminderModeAbsolute": "绝对时间",
  "tools.reminderModeEvent": "事件",
  "tools.reminderModeApp": "应用",
  "tools.reminderModeCategory": "分类",
  "tools.reminderModeRelative": "相对时间",
  "tools.reminderModeWeb": "网页",
  "tools.reminderStatus.cancelled": "已取消",
  "tools.reminderStatus.fired": "已触发",
  "tools.reminderStatus.scheduled": "待提醒",
  "tools.remindersTitle": "提醒器",
  "tools.reminderTimeInvalid": "提醒时间需要晚于当前时间。",
  "tools.reset": "重置",
  "tools.resume": "继续",
  "tools.retry": "重试",
  "tools.settingsEmpty": "暂无可配置项。",
  "tools.settingsTitle": "工具设置",
  "tools.shortBreakDuration": "短休息时长",
  "tools.skipPhase": "跳过",
  "tools.activityReminderActive": "启用",
  "tools.activityReminderDailyLimit": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "每日 ",
        {
          "$op": "arg",
          "name": "minutes"
        },
        " 分钟"
      ]
    }
  },
  "tools.activityReminderDurationInvalid": "每日上限需在 1 到 1440 分钟之间。",
  "tools.activityReminderDurationLabel": "每日上限（分钟）",
  "tools.activityReminderMessageLabel": "提醒内容",
  "tools.activityReminderMessagePlaceholder": "例如：休息一下",
  "tools.start": "开始",
  "tools.statusChip.break": "休息",
  "tools.statusChip.countdown": "倒计时",
  "tools.statusChip.focus": "专注",
  "tools.statusChip.reminder": "提醒",
  "tools.statusChip.stopwatch": "计时",
  "tools.subtitle": "启动本地桌面工具",
  "tools.timerHint": "计时结果不会写入活动记录。",
  "tools.timerLabel": "名称",
  "tools.timerLabelPlaceholder": "可选",
  "tools.timerModeCountdown": "倒计时",
  "tools.timerModeStopwatch": "正计时",
  "tools.timerStatus.completed": "已完成",
  "tools.timerStatus.idle": "未开始",
  "tools.timerStatus.paused": "已暂停",
  "tools.timerStatus.running": "运行中",
  "tools.timerTitle": "计时器",
  "tools.title": "工具"
} as const;
