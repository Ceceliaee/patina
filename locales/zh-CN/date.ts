// zh-CN date locale resource. Pure data only.
export const MESSAGES = {
  "date.compactPattern": "M月d日",
  "date.calendarMonth": {"$type": "message", "body": {"$op": "concat", "parts": [{"$op": "arg", "name": "year"}, " 年 ", {"$op": "arg", "name": "month"}, " 月"]}},
  "date.calendarWeekday": {"$type": "message", "body": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "0"}, "then": "一", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "1"}, "then": "二", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "2"}, "then": "三", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "3"}, "then": "四", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "4"}, "then": "五", "else": {"$op": "if", "when": {"$op": "eq", "left": {"$op": "arg", "name": "day"}, "right": "5"}, "then": "六", "else": "日"}}}}}}},
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
