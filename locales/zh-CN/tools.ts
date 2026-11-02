// zh-CN tools locale resource. Pure data only.
export const MESSAGES = {
  "tools.reminderTimeLabel": "提醒时间",
  "tools.reminderRepeatLabel": "重复",
  "tools.reminderRepeatNone": "不重复",
  "tools.reminderRepeatInterval": "按间隔",
  "tools.reminderRepeatDaily": "每天",
  "tools.reminderRepeatWeekly": "每周",
  "tools.reminderRepeatMonthly": "每月",
  "tools.reminderRepeatYearly": "每年",
  "tools.reminderIntervalLabel": "间隔",
  "tools.reminderMinutesUnit": "分钟",
  "tools.reminderHoursUnit": "小时",
  "tools.reminderRepeatInvalid": "请选择至少一个星期。",

  "tools.reminderSnooze": "稍后提醒",
  "tools.reminderConfirmComplete": "确认完成",
  "tools.reminderCompleted": "已完成",
  "tools.reminderPendingConfirmation": "待确认",
  "tools.reminderSnoozeDelay": {"$type": "message", "body": {"$op": "concat", "parts": [{"$op": "arg", "name": "value"}, "后"]}},
  "tools.reminderOccurredAt": {"$type": "message", "body": {"$op": "concat", "parts": ["提醒时间：", {"$op": "arg", "name": "value"}]}},
  "tools.reminderEditTitle": "编辑提醒",
  "tools.usageLimitReached": "今日可用时长已用完",
  "tools.usageExtend": "延时使用",
  "tools.usageReturnDesktop": "返回桌面",
  "tools.usageExtendFifteen": "再使用 15 分钟",
  "tools.usageExtendHour": "再使用 1 小时",
  "tools.usageExtendToday": "今日使用不受限",
  "tools.usageExtensionDuration": "延时时长",
  "tools.usageExtendTitle": {"$type": "message", "body": {"$op": "concat", "parts": ["延时使用「", {"$op": "arg", "name": "value"}, "」"]}},
  "tools.usageLimitSummary": {"$type": "message", "body": {"$op": "concat", "parts": ["已使用 ", {"$op": "arg", "name": "value"}, "，可用时长到达限制"]}},
  "tools.absoluteDateLabel": "日期",
  "tools.absoluteTimeLabel": "时间",
  "tools.actionFailed": "操作失败，可稍后重试。",
  "tools.activityReminderCandidatesLoadFailed": "目标不可用。",
  "tools.activityReminderDisable": "停用",
  "tools.activityReminderEdit": "编辑",
  "tools.activityReminderDelete": "删除",
  "tools.activityReminderEditTitle": "编辑使用限制",
  "tools.activityReminderEmpty": "暂无规则",
  "tools.activityReminderRulesTitle": "规则",
  "tools.activityReminderSuspension.source_disabled": "数据源已关闭",
  "tools.activityReminderSuspension.target_deleted": "目标已删除",
  "tools.activityReminderSuspension.target_excluded": "已排除",
  "tools.activityReminderTargetLabel": "目标",
  "tools.activityReminderTargetPlaceholder": "选择应用、分类或网页",
  "tools.activityReminderTargetRequired": "请选择目标。",
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
  "tools.createReminder": "创建",
  "tools.defaultReminderLabel": "时间到了",
  "tools.focusDuration": "专注时长",
  "tools.loadFailed": "工具状态加载失败。",
  "tools.longBreakDuration": "长休息时长",
  "tools.longBreakEvery": "长休息间隔",
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
  "tools.pomodoroTitle": "专注",
  "tools.focusModePomodoro": "番茄计时",
  "tools.focusModeFree": "自由专注",
  "tools.relativeMinutesLabel": "分钟后",
  "tools.reminderEmpty": "暂无提醒",
  "tools.reminderLabel": "提醒内容",
  "tools.reminderLabelPlaceholder": "例如：休息一下",
  "tools.reminderModeAbsolute": "绝对时间",
  "tools.reminderModeEvent": "定时提醒",
  "tools.reminderModeUsage": "使用限制",
  "tools.reminderModeApp": "应用",
  "tools.reminderModeCategory": "分类",
  "tools.reminderModeRelative": "相对时间",
  "tools.reminderModeWeb": "网页",
  "tools.remindersTitle": "提醒",
  "tools.reminderTimeInvalid": "提醒时间需要晚于当前时间。",
  "tools.reset": "重置",
  "tools.resume": "继续",
  "tools.settingsEmpty": "暂无可配置项。",
  "tools.settingsTitle": "工具设置",
  "tools.shortBreakDuration": "短休息时长",
  "tools.skipPhase": "跳过",
  "tools.activityReminderActive": "启用",
  "tools.activityReminderDurationLabel": "每日上限",
  "tools.start": "开始",
  "tools.stateRefreshPending": "状态正在恢复，请勿重复操作。",
  "tools.statusChip.break": "休息",
  "tools.statusChip.focus": "专注",
  "tools.statusChip.reminder": "提醒",
  "tools.title": "工具"
} as const;
