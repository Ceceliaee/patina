// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "accessibility.color.blueChannel": "Синий канал",
  "accessibility.color.color": "Цвет",
  "accessibility.color.colorFormat": "Формат цвета",
  "accessibility.color.colorPicker": "Выбор цвета",
  "accessibility.color.eyedropper": "Пипетка",
  "accessibility.color.eyedropperUnsupported": "Пипетка недоступна",
  "accessibility.color.greenChannel": "Зелёный канал",
  "accessibility.color.hexValue": "Шестнадцатеричное значение цвета",
  "accessibility.color.hueChannel": "Цветовой тон",
  "accessibility.color.hueSlider": "Ползунок цветового тона",
  "accessibility.color.lightnessChannel": "Светлота",
  "accessibility.color.redChannel": "Красный канал",
  "accessibility.color.saturationChannel": "Насыщенность",
  "accessibility.data.appTrendRange": "Выбрать период динамики приложений",
  "accessibility.data.categoryTrendRange": "Выбрать период динамики категорий приложений",
  "accessibility.data.earlierRange": "Перейти к предыдущему периоду",
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
  "accessibility.data.heatmapRange": "Выбрать период тепловой карты",
  "accessibility.data.longerAppTrendRange": "Увеличить период динамики приложений",
  "accessibility.data.longerTrendRange": "Увеличить период динамики",
  "accessibility.data.newerRange": "Перейти к следующему периоду",
  "accessibility.data.nextPickerMode": "Следующий режим периода",
  "accessibility.data.nextPickerMonth": "Следующий месяц",
  "accessibility.data.openTrendRangePicker": "Открыть выбор периода динамики",
  "accessibility.data.previousPickerMode": "Предыдущий режим периода",
  "accessibility.data.previousPickerMonth": "Предыдущий месяц",
  "accessibility.data.resetTrendRange": "Вернуть последние 7 дней",
  "accessibility.data.shorterAppTrendRange": "Сократить период динамики приложений",
  "accessibility.data.shorterTrendRange": "Сократить период динамики",
  "accessibility.data.trendRange": "Выбрать период динамики",
  "accessibility.data.trendSummary": "Сводка динамики",
  "accessibility.data.webTrendRange": "Выбрать период динамики сайтов",
  "accessibility.date.nextMonth": "Следующий месяц",
  "accessibility.date.previousMonth": "Предыдущий месяц",
  "accessibility.history.decreaseMinDuration": "Уменьшить минимальную длительность на 1 минуту",
  "accessibility.history.increaseMinDuration": "Увеличить минимальную длительность на 1 минуту",
  "accessibility.history.nextDay": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Перейти к следующему дню: ",
        {
          "$op": "arg",
          "name": "dateLabel"
        },
        ""
      ]
    }
  },
  "accessibility.history.nextMonth": "Следующий месяц",
  "accessibility.history.previousDay": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Перейти к предыдущему дню: ",
        {
          "$op": "arg",
          "name": "dateLabel"
        },
        ""
      ]
    }
  },
  "accessibility.history.previousMonth": "Предыдущий месяц",
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
          "then": "Свернуть",
          "else": "Развернуть"
        },
        " сведения о заголовках: ",
        {
          "$op": "arg",
          "name": "appName"
        },
        ""
      ]
    }
  },
  "accessibility.sidebar.navigationLabels": "Названия разделов",
  "accessibility.settings.colorScheme": "Цветовая схема",
  "accessibility.settings.copyWebActivityPort": "Скопировать порт синхронизации сайтов",
  "accessibility.settings.copyWebActivityToken": "Скопировать токен синхронизации сайтов",
  "accessibility.settings.generateServiceToken": "Создать случайный токен",
  "accessibility.settings.hideRemoteMachineId": "Скрыть ID устройства",
  "accessibility.settings.hideServiceToken": "Скрыть токен",
  "accessibility.settings.openWebActivityHelp": "Открыть руководство по синхронизации сайтов",
  "accessibility.settings.showRemoteMachineId": "Показать ID устройства",
  "accessibility.settings.showServiceToken": "Показать токен",
  "accessibility.settings.toggleBackgroundOptimization": "Переключить экономию памяти в фоне",
  "accessibility.settings.toggleCloseToTray": "Переключить сворачивание в трей при закрытии",
  "accessibility.settings.toggleGlobalTitle": "Переключить глобальную запись заголовков",
  "accessibility.settings.toggleLaunchAtLogin": "Переключить запуск приложения при входе в Windows",
  "accessibility.settings.toggleMinimizeToWidget": "Переключить сворачивание в виджет",
  "accessibility.settings.toggleRemoteStatusBridge": "Переключить удалённую отправку статуса",
  "accessibility.settings.toggleStartMinimized": "Переключить запуск в фоне",
  "accessibility.settings.toggleTrackingPaused": "Приостановить или возобновить учёт времени",
  "accessibility.settings.toggleWebActivity": "Переключить синхронизацию сайтов",
  "accessibility.titleBar.close": "Закрыть окно",
  "accessibility.titleBar.maximize": "Развернуть окно",
  "accessibility.titleBar.minimize": "Свернуть окно",
  "accessibility.titleBar.restore": "Восстановить размер окна",
  "accessibility.tools.addTimerLap": "Добавить круг",
  "accessibility.tools.cancelReminder": "Отменить напоминание",
  "accessibility.tools.createReminder": "Создать напоминание",
  "accessibility.tools.decreaseDuration": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Уменьшить ",
        {
          "$op": "arg",
          "name": "label"
        },
        " на 1 минуту"
      ]
    }
  },
  "accessibility.tools.increaseDuration": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Увеличить ",
        {
          "$op": "arg",
          "name": "label"
        },
        " на 1 минуту"
      ]
    }
  },
  "accessibility.tools.openStatusChip": "Открыть состояние инструмента",
  "accessibility.tools.pausePomodoro": "Приостановить помодоро",
  "accessibility.tools.pauseTimer": "Приостановить отсчёт",
  "accessibility.tools.resetPomodoro": "Сбросить помодоро",
  "accessibility.tools.resetTimer": "Сбросить отсчёт",
  "accessibility.tools.restorePomodoroDefaults": "Восстановить стандартную длительность помодоро",
  "accessibility.tools.resumePomodoro": "Продолжить помодоро",
  "accessibility.tools.resumeTimer": "Продолжить отсчёт",
  "accessibility.tools.skipPomodoroPhase": "Пропустить этап помодоро",
  "accessibility.tools.startPomodoro": "Запустить помодоро",
  "accessibility.tools.startTimer": "Запустить отсчёт",
  "accessibility.widget.collapse": "Свернуть виджет",
  "accessibility.widget.currentApp": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Текущее приложение: ",
        {
          "$op": "arg",
          "name": "appName"
        },
        ""
      ]
    }
  },
  "accessibility.widget.expand": "Развернуть виджет",
  "accessibility.widget.openMainWindow": "Открыть главное окно",
  "accessibility.widget.pin": "Закрепить развёрнутый виджет",
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
          "then": "Свернуть виджет",
          "else": "Развернуть виджет"
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
