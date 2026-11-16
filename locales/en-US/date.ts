// en-US date locale resource. Pure data only.
export const MESSAGES = {
  "date.compactPattern": "MMM d",
  "date.calendarMonth": {"$type": "message", "body": {"$op": "concat", "parts": [{"$op": "arg", "name": "month"}, " / ", {"$op": "arg", "name": "year"}]}},
  "date.calendarWeekday": {"$type": "message", "body": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "0"}, "then": "Mon", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "1"}, "then": "Tue", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "2"}, "then": "Wed", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "3"}, "then": "Thu", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "4"}, "then": "Fri", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "5"}, "then": "Sat", "else": "Sun"}}}}}}},
  "date.heatmapWeekdays": [
    "Mon",
    "",
    "Wed",
    "",
    "Fri",
    "",
    "Sun"
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
  "date.pickDate": "Select date",
  "date.today": "Today",
  "date.weekdaysShort": [
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
    "Sun"
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
  "date.yesterday": "Yesterday"
} as const;
