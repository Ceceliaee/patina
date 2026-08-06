// zh-CN dashboard locale resource. Pure data only.
export const MESSAGES = {
  "dashboard.active": "当前活跃",
  "dashboard.afk": "无操作",
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
      "then": "与昨天持平",
      "else": {
        "$op": "concat",
        "parts": [
          "比昨天",
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
            "then": "增加",
            "else": "减少"
          },
          " ",
          {
            "$op": "arg",
            "name": "deltaLabel"
          },
          ""
        ]
      }
    }
  },
  "dashboard.emptyState": "今天暂无记录",
  "dashboard.focusShare": "专注分布",
  "dashboard.hourlyActivity": "今日活动",
  "dashboard.idle": "空闲",
  "dashboard.paused": "已暂停",
  "dashboard.sharePrefix": "占比",
  "dashboard.showHourlyActivityByCategory": "按分类显示",
  "dashboard.showTotalHourlyActivity": "显示总活动",
  "dashboard.subtitle": "查看今日活动概览",
  "dashboard.title": "今天",
  "dashboard.topApps": "应用排行",
  "dashboard.topAppsBadge": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "前 ",
        {
          "$op": "arg",
          "name": "count"
        },
        " 项"
      ]
    }
  },
  "dashboard.total": "总计",
  "dashboard.tracking": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "正在追踪：",
        {
          "$op": "arg",
          "name": "activeAppName"
        },
        ""
      ]
    }
  },
  "dashboard.trackingPaused": "追踪已暂停"
} as const;
