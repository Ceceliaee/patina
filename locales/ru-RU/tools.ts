// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "tools.reminderTimeLabel": "Время напоминания",
  "tools.reminderRepeatLabel": "Повтор",
  "tools.reminderRepeatNone": "Не повторять",
  "tools.reminderRepeatInterval": "С интервалом",
  "tools.reminderRepeatDaily": "Ежедневно",
  "tools.reminderRepeatWeekly": "Еженедельно",
  "tools.reminderRepeatMonthly": "Ежемесячно",
  "tools.reminderRepeatYearly": "Ежегодно",
  "tools.reminderIntervalLabel": "Интервал",
  "tools.reminderMinutesUnit": "Минуты",
  "tools.reminderHoursUnit": "Часы",
  "tools.reminderRepeatInvalid": "Выберите хотя бы один день недели.",

  "tools.reminderSnooze": "Напомнить позже",
  "tools.reminderConfirmComplete": "Отметить выполненным",
  "tools.reminderCompleted": "Выполнено",
  "tools.reminderPendingConfirmation": "Ожидает подтверждения",
  "tools.reminderSnoozeDelay": {"$type": "message", "body": {"$op": "concat", "parts": ["Через ", {"$op": "arg", "name": "value"}]}},
  "tools.reminderOccurredAt": {"$type": "message", "body": {"$op": "concat", "parts": ["Время напоминания: ", {"$op": "arg", "name": "value"}]}},
  "tools.reminderEditTitle": "Изменить напоминание",
  "tools.usageLimitReached": "Доступное время на сегодня исчерпано",
  "tools.usageExtend": "Продлить использование",
  "tools.usageReturnDesktop": "Вернуться на рабочий стол",
  "tools.usageExtendFifteen": "Ещё 15 минут",
  "tools.usageExtendHour": "Ещё 1 час",
  "tools.usageExtendToday": "Без ограничений сегодня",
  "tools.usageExtensionDuration": "Дополнительное время",
  "tools.usageExtendTitle": {"$type": "message", "body": {"$op": "concat", "parts": ["Продлить использование «", {"$op": "arg", "name": "value"}, "»"]}},
  "tools.usageLimitSummary": {"$type": "message", "body": {"$op": "concat", "parts": ["Использовано ", {"$op": "arg", "name": "value"}, ". Достигнут лимит времени."]}},
  "tools.absoluteDateLabel": "Дата",
  "tools.absoluteTimeLabel": "Время",
  "tools.actionFailed": "Действие не выполнено. Повторите позже.",
  "tools.activityReminderCandidatesLoadFailed": "Объекты недоступны.",
  "tools.activityReminderDisable": "Отключить",
  "tools.activityReminderEdit": "Изменить",
  "tools.activityReminderDelete": "Удалить",
  "tools.activityReminderEditTitle": "Изменить лимит использования",
  "tools.activityReminderEmpty": "Нет правил",
  "tools.activityReminderRulesTitle": "Правила",
  "tools.activityReminderSuspension.source_disabled": "Источник отключён",
  "tools.activityReminderSuspension.target_deleted": "Объект удалён",
  "tools.activityReminderSuspension.target_excluded": "Исключено",
  "tools.activityReminderTargetLabel": "Объект",
  "tools.activityReminderTargetPlaceholder": "Выберите приложение, категорию или сайт",
  "tools.activityReminderTargetRequired": "Выберите объект.",
  "tools.alertDismiss": "Понятно",
  "tools.alertOccurredAt": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Срок: ",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "tools.alertPausePomodoro": "Приостановить",
  "tools.alertPausingPomodoro": "Приостановка…",
  "tools.beta": "Бета",
  "tools.completedToday": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Завершено сегодня: ",
        {
          "$op": "arg",
          "name": "count"
        }
      ]
    }
  },
  "tools.createReminder": "Создать",
  "tools.defaultReminderLabel": "Время вышло",
  "tools.focusDuration": "Длительность работы",
  "tools.loadFailed": "Не удалось загрузить состояние инструментов.",
  "tools.longBreakDuration": "Длинный перерыв",
  "tools.longBreakEvery": "Интервал длинного перерыва",
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
        " мин"
      ]
    }
  },
  "tools.newReminder": "Новое напоминание",
  "tools.notificationStatus": "Уведомления по завершении",
  "tools.pause": "Приостановить",
  "tools.pendingReminders": "Список напоминаний",
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
        " помодоро"
      ]
    }
  },
  "tools.pomodoroPhase.focus": "Работа",
  "tools.pomodoroPhase.longBreak": "Длинный перерыв",
  "tools.pomodoroPhase.shortBreak": "Короткий перерыв",
  "tools.pomodoroSettings": "Длительность по умолчанию",
  "tools.pomodoroStatus.completed": "Завершено",
  "tools.pomodoroStatus.idle": "Не запущено",
  "tools.pomodoroStatus.paused": "Приостановлено",
  "tools.pomodoroStatus.running": "Выполняется",
  "tools.pomodoroTitle": "Концентрация",
  "tools.focusModePomodoro": "Помодоро",
  "tools.focusModeFree": "Свободная концентрация",
  "tools.relativeMinutesLabel": "Минут от текущего момента",
  "tools.reminderEmpty": "Нет напоминаний",
  "tools.reminderLabel": "Напоминание",
  "tools.reminderLabelPlaceholder": "Например: сделать перерыв",
  "tools.reminderModeAbsolute": "Точное время",
  "tools.reminderModeEvent": "Напоминания по времени",
  "tools.reminderModeUsage": "Лимиты использования",
  "tools.reminderModeApp": "Прил.",
  "tools.reminderModeCategory": "Категория",
  "tools.reminderModeRelative": "Через интервал",
  "tools.reminderModeWeb": "Сайты",
  "tools.remindersTitle": "Напоминание",
  "tools.reminderTimeInvalid": "Время напоминания должно быть в будущем.",
  "tools.reset": "Сбросить",
  "tools.resume": "Продолжить",
  "tools.settingsEmpty": "Нет доступных настроек.",
  "tools.settingsTitle": "Настройки инструментов",
  "tools.shortBreakDuration": "Короткий перерыв",
  "tools.skipPhase": "Пропустить",
  "tools.activityReminderActive": "Активно",
  "tools.activityReminderDurationLabel": "Дневной лимит",
  "tools.start": "Запустить",
  "tools.stateRefreshPending": "Состояние восстанавливается. Не повторяйте действие.",
  "tools.statusChip.break": "Перерыв",
  "tools.statusChip.focus": "Работа",
  "tools.statusChip.reminder": "Напоминание",
  "tools.title": "Инструменты"
} as const;
