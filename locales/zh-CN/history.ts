// zh-CN history locale resource. Pure data only.
export const MESSAGES = {
  "history.activeDuration": "活跃时长",
  "history.activeSpan": "活跃跨度",
  "history.activitySegmentCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "活动 ",
        {
          "$op": "arg",
          "name": "count"
        },
        ""
      ]
    }
  },
  "history.appDistribution": "应用分布",
  "history.dailyHourlyActivity": "当日活动",
  "history.dayDistribution": "当日分布",
  "history.daySummary": "当日摘要",
  "history.distributionByApp": "应用",
  "history.distributionByCategory": "分类",
  "history.distributionByWeb": "网页",
  "history.emptyDay": "这一天暂无记录",
  "history.emptyTimelineWindow": "当前时间段暂无记录",
  "history.horizontalTimeline.ariaLabel": "横向日内时间轴",
  "history.horizontalTimeline.defaultTitle": "时间轴",
  "history.horizontalTimeline.emptyDay": "这一天暂无记录",
  "history.horizontalTimeline.remainingLegendItems": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "+",
        {
          "$op": "arg",
          "name": "count"
        },
        ""
      ]
    }
  },
  "history.horizontalTimeline.remainingLegendItemsHint": {
    "$type": "message",
    "body": {
      "$op": "join",
      "target": {
        "$op": "arg",
        "name": "labels"
      },
      "separator": "、"
    }
  },
  "history.loadFailed": "加载失败，仍显示最近一次记录",
  "history.loading": "加载中...",
  "history.noData": "暂无数据",
  "history.openTimeline": "打开时间线",
  "history.openTimelineZoom": "打开时间轴缩放",
  "history.pastSevenDays": "近 7 天",
  "history.peakHour": "高峰时段",
  "history.sessionCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "count"
        },
        " 条记录"
      ]
    }
  },
  "history.showHourlyActivityByCategory": "按分类显示",
  "history.showTimelineByApp": "按应用显示",
  "history.showTimelineByCategory": "按分类显示",
  "history.showTimelineByWeb": "按网页显示",
  "history.showTotalHourlyActivity": "显示总活动",
  "history.subtitle": "回看当日活动记录",
  "history.timeline": "时间线",
  "history.timelineAppLanes": "应用分轨",
  "history.timelineAxis": "时间轴",
  "history.timelineCategoryLanes": "分类分轨",
  "history.timelineDecreaseHours": "减少一小时",
  "history.timelineHoursValue": {
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
  "history.timelineIncreaseHours": "增加一小时",
  "history.timelineInteractionHint": "滚轮每次缩放 0.2 小时，拖动或横向滚动平移时间轴",
  "history.timelineModeSwitch": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "当前按",
        {
          "$op": "arg",
          "name": "current"
        },
        "显示，切换到",
        {
          "$op": "arg",
          "name": "next"
        },
        ""
      ]
    }
  },
  "history.timelineTabApp": "应用",
  "history.timelineTabWeb": "网页",
  "history.timelineWebLanes": "网页分轨",
  "history.timelineWindowHours": "时间窗口小时数",
  "history.timelineWindowLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "start"
        },
        " - ",
        {
          "$op": "arg",
          "name": "end"
        },
        ""
      ]
    }
  },
  "history.timelineZoom": "时间轴缩放",
  "history.title": "历史",
  "history.titleDetails": "标题详情",
  "history.titleRowCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "标题 ",
        {
          "$op": "arg",
          "name": "count"
        },
        ""
      ]
    }
  },
  "history.untilNow": "至今",
  "history.webTimelineUntitledPage": "无标题网页"
} as const;
