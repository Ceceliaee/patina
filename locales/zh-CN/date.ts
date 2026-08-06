// zh-CN date locale resource. Pure data only.
export const MESSAGES = {
  "date.heatmapWeekdays": [
    "一",
    "",
    "三",
    "",
    "五",
    "",
    "日"
  ],
  "date.monthLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "month"
        },
        "月"
      ]
    }
  },
  "date.pickDate": "选择日期",
  "date.today": "今天",
  "date.weekdaysShort": [
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "日"
  ],
  "date.yearMonthLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "year"
        },
        " 年 ",
        {
          "$op": "arg",
          "name": "month"
        },
        " 月"
      ]
    }
  },
  "date.yesterday": "昨天"
} as const;
