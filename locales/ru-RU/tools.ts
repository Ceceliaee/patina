// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "tools.absoluteDateLabel": "Дата",
  "tools.absoluteTimeLabel": "Время",
  "tools.actionFailed": "Действие не выполнено. Повторите позже.",
  "tools.activityReminderAppPlaceholder": "Выберите прил.",
  "tools.activityReminderCandidatesLoadFailed": "Объекты недоступны.",
  "tools.activityReminderCategoryPlaceholder": "Выберите категорию",
  "tools.activityReminderDisable": "Отключить",
  "tools.activityReminderEmpty": "Нет правил",
  "tools.activityReminderRulesTitle": "Правила",
  "tools.activityReminderSuspension.source_disabled": "Источник отключён",
  "tools.activityReminderSuspension.target_deleted": "Объект удалён",
  "tools.activityReminderSuspension.target_excluded": "Исключено",
  "tools.activityReminderTargetLabel": "Объект",
  "tools.activityReminderTargetRequired": "Выберите объект.",
  "tools.activityReminderWebPlaceholder": "Выберите сайт",
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
  "tools.countdownDuration": "Длительность обратного отсчёта",
  "tools.createReminder": "Создать",
  "tools.defaultReminderLabel": "Время вышло",
  "tools.dueNow": "Сейчас",
  "tools.durationPresets": {
    "5": "5 мин",
    "10": "10 мин",
    "25": "25 мин",
    "30": "30 мин",
    "60": "60 мин"
  },
  "tools.focusDuration": "Длительность работы",
  "tools.lap": "Круг",
  "tools.lapIndex": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Круг ",
        {
          "$op": "arg",
          "name": "index"
        },
        ""
      ]
    }
  },
  "tools.lapsEmpty": "Нет кругов",
  "tools.lapsTitle": "Круги",
  "tools.loadFailed": "Не удалось загрузить состояние инструментов.",
  "tools.longBreakDuration": "Длинный перерыв",
  "tools.longBreakEvery": "Интервал длинного перерыва",
  "tools.longBreakEveryValue": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Интервал (помодоро): ",
        {
          "$op": "arg",
          "name": "count"
        },
        ""
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
  "tools.pomodoroTitle": "Помодоро",
  "tools.relativeMinutesLabel": "Минут от текущего момента",
  "tools.reminderEmpty": "Нет ожидающих напоминаний",
  "tools.reminderLabel": "Напоминание",
  "tools.reminderLabelPlaceholder": "Например: сделать перерыв",
  "tools.reminderModeAbsolute": "Точное время",
  "tools.reminderModeEvent": "Событие",
  "tools.reminderModeApp": "Прил.",
  "tools.reminderModeCategory": "Категория",
  "tools.reminderModeRelative": "Через интервал",
  "tools.reminderModeWeb": "Сайты",
  "tools.reminderStatus.cancelled": "Отменено",
  "tools.reminderStatus.fired": "Сработало",
  "tools.reminderStatus.scheduled": "Запланировано",
  "tools.remindersTitle": "Напоминание",
  "tools.reminderTimeInvalid": "Время напоминания должно быть в будущем.",
  "tools.reset": "Сбросить",
  "tools.resume": "Продолжить",
  "tools.retry": "Повторить",
  "tools.settingsEmpty": "Нет доступных настроек.",
  "tools.settingsTitle": "Настройки инструментов",
  "tools.shortBreakDuration": "Короткий перерыв",
  "tools.skipPhase": "Пропустить",
  "tools.activityReminderActive": "Активно",
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
        " мин в день"
      ]
    }
  },
  "tools.activityReminderDurationInvalid": "Укажите от 1 до 1440 мин.",
  "tools.activityReminderDurationLabel": "Дневной лимит (мин)",
  "tools.activityReminderMessageLabel": "Сообщение",
  "tools.activityReminderMessagePlaceholder": "Например: сделать перерыв",
  "tools.start": "Запустить",
  "tools.statusChip.break": "Перерыв",
  "tools.statusChip.countdown": "Обратный отсчёт",
  "tools.statusChip.focus": "Работа",
  "tools.statusChip.reminder": "Напоминание",
  "tools.statusChip.stopwatch": "Таймер",
  "tools.subtitle": "Запустите локальные инструменты",
  "tools.timerHint": "Результаты таймера не сохраняются в записях активности.",
  "tools.timerLabel": "Название",
  "tools.timerLabelPlaceholder": "Необязательно",
  "tools.timerModeCountdown": "Обратный отсчёт",
  "tools.timerModeStopwatch": "Секундомер",
  "tools.timerStatus.completed": "Завершено",
  "tools.timerStatus.idle": "Не запущено",
  "tools.timerStatus.paused": "Приостановлено",
  "tools.timerStatus.running": "Выполняется",
  "tools.timerTitle": "Таймер",
  "tools.title": "Инструменты"
} as const;
