// es locale resource. Pure data only.
export const MESSAGES = {
  "date.compactPattern": "d MMM",
  "date.calendarMonth": {"$type": "message", "body": {"$op": "concat", "parts": [{"$op": "arg", "name": "month"}, " / ", {"$op": "arg", "name": "year"}]}},
  "date.calendarWeekday": {"$type": "message", "body": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "0"}, "then": "lun", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "1"}, "then": "mar", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "2"}, "then": "mié", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "3"}, "then": "jue", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "4"}, "then": "vie", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "5"}, "then": "sáb", "else": "dom"}}}}}}},
  "date.heatmapWeekdays": [
    "lun",
    "",
    "mié",
    "",
    "vie",
    "",
    "dom"
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
  "date.pickDate": "Seleccionar fecha",
  "date.today": "Hoy",
  "date.weekdaysShort": [
    "lun",
    "mar",
    "mié",
    "jue",
    "vie",
    "sáb",
    "dom"
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
  "date.yesterday": "Ayer"
} as const;
