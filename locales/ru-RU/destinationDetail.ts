// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "destinationDetail.activeWindow": "Период активности",
  "destinationDetail.activityAria": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        {
          "$op": "concat",
          "parts": [
            "",
            {
              "$op": "arg",
              "name": "start"
            },
            " — ",
            {
              "$op": "arg",
              "name": "end"
            },
            ", ",
            {
              "$op": "arg",
              "name": "name"
            },
            ", ",
            {
              "$op": "arg",
              "name": "duration"
            },
            ", ",
            {
              "$op": "arg",
              "name": "fragmentCount"
            },
            " "
          ]
        },
        {
          "$op": "concat",
          "parts": [
            "",
            {
              "$op": "plural",
              "arg": "fragmentCount",
              "cases": {
                "one": "фрагмент",
                "other": "фрагмента",
                "many": "фрагментов",
                "few": "фрагмента"
              }
            },
            ""
          ]
        }
      ]
    }
  },
  "destinationDetail.close": "Закрыть сведения",
  "destinationDetail.current": "В процессе",
  "destinationDetail.dayError": "Не удалось загрузить записи за этот день",
  "destinationDetail.details": {
    "$type": "message",
    "body": {
      "$op": "if",
      "when": {
        "$op": "eq",
        "left": {
          "$op": "arg",
          "name": "mode"
        },
        "right": "app"
      },
      "then": "Сведения о приложении",
      "else": "Сведения о сайте"
    }
  },
  "destinationDetail.focusedDate": "Выбранная дата",
  "destinationDetail.fragmentCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "count"
        },
        " ",
        {
          "$op": "plural",
          "arg": "count",
          "cases": {
            "one": "фрагмент",
            "other": "фрагмента",
            "many": "фрагментов",
            "few": "фрагмента"
          }
        },
        ""
      ]
    }
  },
  "destinationDetail.loading": "Загрузка сведений",
  "destinationDetail.minimumDuration": "Минимальная длительность активности",
  "destinationDetail.nextDay": "Следующий день",
  "destinationDetail.noActivity": "За этот день нет активности выбранного объекта",
  "destinationDetail.noActivityAtMinimum": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Нет активности длительностью от ",
        {
          "$op": "arg",
          "name": "minutes"
        },
        " мин."
      ]
    }
  },
  "destinationDetail.noActivityInWindow": "В выбранном интервале нет активности этого объекта",
  "destinationDetail.objectTypeApp": "Прил.",
  "destinationDetail.objectTypeWeb": "Сайт",
  "destinationDetail.open": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Посмотреть сведения: ",
        {
          "$op": "arg",
          "name": "name"
        },
        ""
      ]
    }
  },
  "destinationDetail.previousDay": "Предыдущий день",
  "destinationDetail.recordAria": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "start"
        },
        " — ",
        {
          "$op": "arg",
          "name": "end"
        },
        ", ",
        {
          "$op": "arg",
          "name": "title"
        },
        ", ",
        {
          "$op": "arg",
          "name": "duration"
        },
        ""
      ]
    }
  },
  "destinationDetail.recordedDuration": "Время за день",
  "destinationDetail.records": "Записи активности",
  "destinationDetail.retry": "Повторить",
  "destinationDetail.timeline": "Шкала дня",
  "destinationDetail.timelineAria": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "name"
        },
        " — шкала дня: ",
        {
          "$op": "arg",
          "name": "dateKey"
        },
        ""
      ]
    }
  },
  "destinationDetail.timelineDecreaseHours": "Сократить интервал шкалы времени",
  "destinationDetail.timelineHoursValue": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "hours"
        },
        " ",
        {
          "$op": "plural",
          "arg": "hours",
          "cases": {
            "one": "час",
            "other": "часа",
            "many": "часов",
            "few": "часа"
          }
        },
        ""
      ]
    }
  },
  "destinationDetail.timelineIncreaseHours": "Увеличить интервал шкалы времени",
  "destinationDetail.timelineInteractionAria": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "name"
        },
        " — шкала времени: ",
        {
          "$op": "arg",
          "name": "dateKey"
        },
        ", ",
        {
          "$op": "arg",
          "name": "windowLabel"
        },
        "; колесо мыши меняет масштаб, перетаскивание и стрелки влево/вправо сдвигают шкалу"
      ]
    }
  },
  "destinationDetail.timelineWindowHours": "Длительность интервала шкалы",
  "destinationDetail.timelineZoom": "Масштаб шкалы времени",
  "destinationDetail.titleDetails": "Сведения о заголовках",
  "destinationDetail.toggleTitleDetails": {
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
          "then": "Скрыть",
          "else": "Показать"
        },
        " сведения о заголовках: ",
        {
          "$op": "arg",
          "name": "name"
        },
        ""
      ]
    }
  }
} as const;
