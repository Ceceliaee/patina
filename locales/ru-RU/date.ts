// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "date.heatmapWeekdays": [
    "пн",
    "",
    "ср",
    "",
    "пт",
    "",
    "вс"
  ],
  "date.monthLabel": {
    "$type": "message",
    "body": {
      "$op": "monthName",
      "year": 2020,
      "zeroBasedMonth": {
        "$op": "subtract",
        "left": {
          "$op": "arg",
          "name": "month"
        },
        "right": 1
      },
      "style": "short"
    }
  },
  "date.pickDate": "Выбрать дату",
  "date.today": "Сегодня",
  "date.weekdaysShort": [
    "пн",
    "вт",
    "ср",
    "чт",
    "пт",
    "сб",
    "вс"
  ],
  "date.yearMonthLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "monthName",
          "year": {
            "$op": "arg",
            "name": "year"
          },
          "zeroBasedMonth": {
            "$op": "subtract",
            "left": {
              "$op": "arg",
              "name": "month"
            },
            "right": 1
          },
          "style": "long"
        },
        " ",
        {
          "$op": "arg",
          "name": "year"
        },
        ""
      ]
    }
  },
  "date.yesterday": "Вчера"
} as const;
