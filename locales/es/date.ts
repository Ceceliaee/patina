// es locale resource. Pure data only.
export const MESSAGES = {
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
