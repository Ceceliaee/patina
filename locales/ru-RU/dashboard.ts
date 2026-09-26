// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "dashboard.active": "Сейчас активно",
  "dashboard.afk": "Нет активности",
  "dashboard.comparedWithYesterday": {
    "$type": "message",
    "body": {
      "$op": "if",
      "when": {
        "$op": "eq",
        "left": {
          "$op": "arg",
          "name": "direction"
        },
        "right": "same"
      },
      "then": "Как вчера",
      "else": {
        "$op": "concat",
        "parts": [
          "",
          {
            "$op": "if",
            "when": {
              "$op": "eq",
              "left": {
                "$op": "arg",
                "name": "direction"
              },
              "right": "increase"
            },
            "then": "Больше на",
            "else": "Меньше на"
          },
          " ",
          {
            "$op": "arg",
            "name": "deltaLabel"
          },
          " по сравнению со вчерашним днём"
        ]
      }
    }
  },
  "dashboard.emptyState": "За сегодня нет записей",
  "dashboard.focusShare": "Распределение времени",
  "dashboard.hourlyActivity": "Активность сегодня",
  "dashboard.idle": "Нет активности",
  "dashboard.paused": "Приостановлено",
  "dashboard.sharePrefix": "Доля",
  "dashboard.showHourlyActivityByCategory": "Показать по категориям",
  "dashboard.showTotalHourlyActivity": "Показать общую активность",
  "dashboard.title": "Сегодня",
  "dashboard.topApps": "Популярные прил.",
  "dashboard.topAppsBadge": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Первые ",
        {
          "$op": "arg",
          "name": "count"
        },
        ""
      ]
    }
  },
  "dashboard.total": "Всего",
  "dashboard.tracking": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Учёт времени: ",
        {
          "$op": "arg",
          "name": "activeAppName"
        },
        ""
      ]
    }
  },
  "dashboard.trackingPaused": "Учёт времени приостановлен"
} as const;
