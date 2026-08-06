// zh-CN destinationDetail locale resource. Pure data only.
export const MESSAGES = {
  "destinationDetail.activeWindow": "活动跨度",
  "destinationDetail.activityAria": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "start"
        },
        " 至 ",
        {
          "$op": "arg",
          "name": "end"
        },
        "，",
        {
          "$op": "arg",
          "name": "name"
        },
        "，",
        {
          "$op": "arg",
          "name": "duration"
        },
        "，",
        {
          "$op": "arg",
          "name": "fragmentCount"
        },
        " 个片段"
      ]
    }
  },
  "destinationDetail.close": "关闭详情",
  "destinationDetail.current": "进行中",
  "destinationDetail.dayError": "当天记录加载失败",
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
      "then": "应用详情",
      "else": "网页详情"
    }
  },
  "destinationDetail.focusedDate": "聚焦日期",
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
        " 个片段"
      ]
    }
  },
  "destinationDetail.loading": "正在读取详情",
  "destinationDetail.minimumDuration": "最短活动时长",
  "destinationDetail.nextDay": "下一日",
  "destinationDetail.noActivity": "当天没有该对象的活动记录",
  "destinationDetail.noActivityAtMinimum": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "没有达到 ",
        {
          "$op": "arg",
          "name": "minutes"
        },
        " 分钟的活动记录"
      ]
    }
  },
  "destinationDetail.noActivityInWindow": "当前时间窗没有该对象的活动记录",
  "destinationDetail.objectTypeApp": "应用",
  "destinationDetail.objectTypeWeb": "网页",
  "destinationDetail.open": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "查看 ",
        {
          "$op": "arg",
          "name": "name"
        },
        " 的详情"
      ]
    }
  },
  "destinationDetail.previousDay": "上一日",
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
        " 至 ",
        {
          "$op": "arg",
          "name": "end"
        },
        "，",
        {
          "$op": "arg",
          "name": "title"
        },
        "，",
        {
          "$op": "arg",
          "name": "duration"
        },
        ""
      ]
    }
  },
  "destinationDetail.recordedDuration": "当天时长",
  "destinationDetail.records": "活动记录",
  "destinationDetail.retry": "重试",
  "destinationDetail.timeline": "日内时间轴",
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
        " 在 ",
        {
          "$op": "arg",
          "name": "dateKey"
        },
        " 的日内时间轴"
      ]
    }
  },
  "destinationDetail.timelineDecreaseHours": "缩短时间轴窗口",
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
        " 小时"
      ]
    }
  },
  "destinationDetail.timelineIncreaseHours": "扩大时间轴窗口",
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
        " 在 ",
        {
          "$op": "arg",
          "name": "dateKey"
        },
        " 的 ",
        {
          "$op": "arg",
          "name": "windowLabel"
        },
        " 时间轴；滚轮缩放，拖动或使用左右方向键平移"
      ]
    }
  },
  "destinationDetail.timelineWindowHours": "时间轴窗口时长",
  "destinationDetail.timelineZoom": "时间轴缩放",
  "destinationDetail.titleDetails": "标题详情",
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
          "then": "关闭",
          "else": "查看"
        },
        " ",
        {
          "$op": "arg",
          "name": "name"
        },
        " 的标题详情"
      ]
    }
  }
} as const;
