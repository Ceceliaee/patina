// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "tools.freeRestMode": "Режим отдыха",
  "tools.freeRestFixed": "Фиксированная длительность",
  "tools.freeRestRatio": "Пропорционально",
  "tools.freeRestDuration": "Длительность отдыха",
  "tools.freeRestProportion": "Соотношение работы и отдыха",
  "tools.freeFocusEmpty": "Нет сеансов",
  "tools.freeFocusEdit": "Изменить сеанс",
  "tools.freeFocusFinish": "Завершить сеанс",
  "tools.freeFocusRestart": "Начать следующий сеанс",
  "tools.freeFocusRest": "Отдых",
  "tools.freeFocusStart": "Начать работу",
  "tools.freeFocusPause": "Приостановить работу",
  "tools.freeFocusResume": "Продолжить работу",
  "tools.freeFocusReset": "Сбросить сеанс",

  "tools.pomodoroStartLater": "Начать позже",
  "tools.pomodoroStartBreak": "Начать перерыв",
  "tools.pomodoroStartFocus": "Начать концентрацию",
  "tools.pomodoroStartNextGroup": "Начать следующий цикл",
  "tools.pomodoroNextPhase": {"$type": "message", "body": {"$op": "concat", "parts": ["Далее: ", {"$op": "arg", "name": "phase"}, " · ", {"$op": "arg", "name": "duration"}]}},
  "tools.pomodoroGroupSummary": {"$type": "message", "body": {"$op": "concat", "parts": ["Помодоро: ", {"$op": "arg", "name": "rounds"}, " · Завершено циклов: ", {"$op": "arg", "name": "groups"}]}},
  "tools.pomodoroCompletedGroups": {"$type": "message", "body": {"$op": "concat", "parts": ["Завершено циклов: ", {"$op": "arg", "name": "count"}, ""]}},

  "tools.pomodoroTimingSettings": "Настройки таймера",
  "tools.pomodoroTimingSummary": {"$type": "message", "body": {"$op": "concat", "parts": ["Фокус: ", {"$op": "arg", "name": "minutes"}, " мин · ", {"$op": "plural", "arg": "rounds", "cases": {"one": {"$op": "concat", "parts": [{"$op": "arg", "name": "rounds"}, " цикл"]}, "few": {"$op": "concat", "parts": [{"$op": "arg", "name": "rounds"}, " цикла"]}, "many": {"$op": "concat", "parts": [{"$op": "arg", "name": "rounds"}, " циклов"]}, "other": {"$op": "concat", "parts": [{"$op": "arg", "name": "rounds"}, " цикла"]}}}, ""]}},

  "tools.pomodoroTaskCreate": "Новый сеанс концентрации",
  "tools.pomodoroTaskEdit": "Изменить задачу Pomodoro",
  "tools.pomodoroTaskName": "Название",
  "tools.pomodoroTaskPlaceholder": "Например: чтение статей",
  "tools.pomodoroTaskEmpty": "Нет задач Pomodoro",
  "tools.pomodoroTaskDefault": "Задача Pomodoro",
  "tools.pomodoroRoundUnit": "раундов",
  "tools.reminderTimeLabel": "Время напоминания",
  "tools.reminderRepeatLabel": "Повтор",
  "tools.reminderRepeatNone": "Не повторять",
  "tools.reminderRepeatInterval": "С интервалом",
  "tools.reminderRepeatDaily": "Ежедневно",
  "tools.reminderRepeatWeekly": "Еженедельно",
  "tools.reminderRepeatMonthly": "Ежемесячно",
  "tools.reminderRepeatYearly": "Ежегодно",
  "tools.reminderMinutesUnit": "Минуты",

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
  "tools.actionFailed": "Действие не выполнено. Повторите позже.",
  "tools.activityReminderCandidatesLoadFailed": "Объекты недоступны.",
  "tools.activityReminderDisable": "Отключить",
  "tools.activityReminderEdit": "Изменить",
  "tools.activityReminderDelete": "Удалить",
  "tools.activityReminderEditTitle": "Изменить лимит использования",
  "tools.activityReminderEmpty": "Нет правил",
  "tools.activityReminderSuspension.source_disabled": "Источник отключён",
  "tools.activityReminderSuspension.target_deleted": "Объект удалён",
  "tools.activityReminderSuspension.target_excluded": "Исключено",
  "tools.activityReminderTargetLabel": "Объект",
  "tools.activityReminderTargetPlaceholder": "Выберите приложение, категорию или сайт",
  "tools.activityReminderTargetRequired": "Выберите объект.",
  "tools.alertDismiss": "Понятно",
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
  "tools.pause": "Приостановить",
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
  "tools.pomodoroStatus.completed": "Завершено",
  "tools.pomodoroStatus.idle": "Не запущено",
  "tools.pomodoroStatus.paused": "Приостановлено",
  "tools.pomodoroStatus.running": "Выполняется",
  "tools.pomodoroTitle": "Концентрация",
  "tools.focusModePomodoro": "Помодоро",
  "tools.focusModeFree": "Свободная концентрация",
  "tools.reminderEmpty": "Нет напоминаний",
  "tools.reminderLabel": "Напоминание",
  "tools.reminderLabelPlaceholder": "Например: сделать перерыв",
  "tools.reminderModeEvent": "Напоминания по времени",
  "tools.reminderModeUsage": "Лимиты использования",
  "tools.reminderModeApp": "Прил.",
  "tools.reminderModeCategory": "Категория",
  "tools.reminderModeWeb": "Сайты",
  "tools.remindersTitle": "Напоминание",
  "tools.reminderTimeInvalid": "Время напоминания должно быть в будущем.",
  "tools.reset": "Сбросить",
  "tools.resume": "Продолжить",
  "tools.settingsEmpty": "Нет доступных настроек.",
  "tools.settingsTitle": "Настройки инструментов",
  "tools.shortBreakDuration": "Короткий перерыв",
  "tools.activityReminderActive": "Активно",
  "tools.activityReminderDurationLabel": "Дневной лимит",
  "tools.start": "Запустить",
  "tools.stateRefreshPending": "Состояние восстанавливается. Не повторяйте действие.",
  "tools.statusChip.break": "Перерыв",
  "tools.statusChip.focus": "Работа",
  "tools.statusChip.reminder": "Напоминание",
  "tools.title": "Инструменты"
} as const;
