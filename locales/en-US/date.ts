// en-US date locale resource. Pure data only.
export const MESSAGES = {
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
