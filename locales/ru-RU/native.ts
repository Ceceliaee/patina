// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "native.category.ai": "ИИ",
  "native.category.browser": "Браузер",
  "native.category.communication": "Общение",
  "native.category.design": "Дизайн",
  "native.category.development": "Разработка",
  "native.category.game": "Игры",
  "native.category.music": "Музыка",
  "native.category.office": "Офис",
  "native.category.other": "Прочее",
  "native.category.system": "Система",
  "native.category.utility": "Утилиты",
  "native.category.video": "Видео",
  "native.export.duration": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        {
          "$op": "plural",
          "arg": "hours",
          "cases": {
            "one": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "hours"
                },
                " ч"
              ]
            },
            "other": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "hours"
                },
                " ч"
              ]
            },
            "many": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "hours"
                },
                " ч"
              ]
            },
            "few": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "hours"
                },
                " ч"
              ]
            }
          }
        },
        " ",
        {
          "$op": "plural",
          "arg": "minutes",
          "cases": {
            "one": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "minutes"
                },
                " мин"
              ]
            },
            "other": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "minutes"
                },
                " мин"
              ]
            },
            "many": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "minutes"
                },
                " мин"
              ]
            },
            "few": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "minutes"
                },
                " мин"
              ]
            }
          }
        }
      ]
    }
  },
  "native.export.empty": "За выбранный период записи активности не найдены.",
  "native.export.exportedAt": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Время экспорта: ",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "native.export.field.app_name": "Название прил.",
  "native.export.field.browser_client_id": "ID клиента браузера",
  "native.export.field.browser_exe_name": "Исполняемый файл браузера",
  "native.export.field.browser_kind": "Тип браузера",
  "native.export.field.category": "Категория",
  "native.export.field.category_color": "Цвет категории",
  "native.export.field.category_id": "ID категории",
  "native.export.field.continuity_group_start_time": "Начало группы непрерывности",
  "native.export.field.created_at": "Время создания",
  "native.export.field.domain": "Домен",
  "native.export.field.duration_minutes": "Длительность (минуты)",
  "native.export.field.duration_ms": "Длительность (мс)",
  "native.export.field.end_time": "Время окончания",
  "native.export.field.exe_name": "Имя исполняемого файла",
  "native.export.field.favicon_url": "URL значка сайта",
  "native.export.field.local_date": "Местная дата",
  "native.export.field.local_month": "Местный месяц",
  "native.export.field.local_week": "Местная неделя",
  "native.export.field.normalized_domain": "Нормализованный домен",
  "native.export.field.page_title": "Заголовок страницы",
  "native.export.field.record_type": "Тип записи",
  "native.export.field.session_id": "ID сеанса",
  "native.export.field.source_key": "Ключ источника",
  "native.export.field.source_name": "Название источника",
  "native.export.field.start_hour": "Час начала",
  "native.export.field.start_time": "Время начала",
  "native.export.field.unknown": "Неизвестное поле",
  "native.export.field.updated_at": "Время обновления",
  "native.export.field.url": "URL",
  "native.export.field.web_segment_id": "ID веб-фрагмента",
  "native.export.field.web_source": "Источник веб-записи",
  "native.export.field.weekday": "День недели",
  "native.export.field.window_title": "Заголовок окна",
  "native.export.range": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Период: ",
        {
          "$op": "arg",
          "name": "start"
        },
        " — ",
        {
          "$op": "arg",
          "name": "end"
        },
        ""
      ]
    }
  },
  "native.export.rangeAll": "Все",
  "native.export.rangeCurrent": "Текущий",
  "native.export.records": {
    "$type": "message",
    "body": {
      "$op": "plural",
      "arg": "count",
      "cases": {
        "one": {
          "$op": "concat",
          "parts": [
            {
              "$op": "arg",
              "name": "count"
            },
            " запись"
          ]
        },
        "few": {
          "$op": "concat",
          "parts": [
            {
              "$op": "arg",
              "name": "count"
            },
            " записи"
          ]
        },
        "many": {
          "$op": "concat",
          "parts": [
            {
              "$op": "arg",
              "name": "count"
            },
            " записей"
          ]
        },
        "other": {
          "$op": "concat",
          "parts": [
            {
              "$op": "arg",
              "name": "count"
            },
            " записи"
          ]
        }
      }
    }
  },
  "native.export.title": "Записи активности Patina",
  "native.export.totalDuration": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Общая длительность: ",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "native.tools.activityReminderAppTitle": "Напоминание об активности прил.",
  "native.tools.activityReminderCategoryTitle": "Напоминание об активности категории",
  "native.tools.activityReminderDefaultBody": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Активность «",
        {
          "$op": "arg",
          "name": "targetName"
        },
        "» за сегодня: ",
        {
          "$op": "plural",
          "arg": "usageMinutes",
          "cases": {
            "one": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "usageMinutes"
                },
                " минута"
              ]
            },
            "few": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "usageMinutes"
                },
                " минуты"
              ]
            },
            "many": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "usageMinutes"
                },
                " минут"
              ]
            },
            "other": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "usageMinutes"
                },
                " минуты"
              ]
            }
          }
        },
        ". Достигнут дневной лимит: ",
        {
          "$op": "plural",
          "arg": "limitMinutes",
          "cases": {
            "one": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "limitMinutes"
                },
                " минута"
              ]
            },
            "few": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "limitMinutes"
                },
                " минуты"
              ]
            },
            "many": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "limitMinutes"
                },
                " минут"
              ]
            },
            "other": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "limitMinutes"
                },
                " минуты"
              ]
            }
          }
        },
        "."
      ]
    }
  },
  "native.tools.activityReminderWebTitle": "Напоминание об активности сайта",
  "native.tools.breakEnded": "Перерыв завершён",
  "native.tools.countdownDefaultBody": "Обратный отсчёт завершён",
  "native.tools.countdownTitle": "Обратный отсчёт завершён",
  "native.tools.focusEnded": "Рабочий интервал завершён",
  "native.tools.nextFocus": "Далее: работа",
  "native.tools.nextLongBreak": "Далее: длинный перерыв",
  "native.tools.nextShortBreak": "Далее: короткий перерыв",
  "native.tools.reminderDefaultBody": "Время вышло",
  "native.tools.reminderTitle": "Напоминание",
  "native.tray.disableTitle": "Не записывать заголовки",
  "native.tray.enableTitle": "Записывать заголовки",
  "native.tray.pause": "Приостановить учёт",
  "native.tray.quit": "Выйти из Patina",
  "native.tray.resume": "Возобновить учёт",
  "native.tray.showMain": "Открыть главное окно"
} as const;
