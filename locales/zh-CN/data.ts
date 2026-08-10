// zh-CN data locale resource. Pure data only.
export const MESSAGES = {
  "data.activityHeatmap": "活动热力图",
  "data.activityHeatmapHint": "每日活动强度",
  "data.activityTrend": "活动趋势",
  "data.allTime": "总计",
  "data.appHeatmap": "应用热力图",
  "data.applyRange": "确定",
  "data.appSearchPlaceholder": "搜索应用",
  "data.appTrend": "应用趋势",
  "data.appTrendActiveDays": "活跃天数",
  "data.appTrendAppList": "应用列表",
  "data.appTrendAverage": "日均",
  "data.appTrendEmpty": "当前范围暂无应用记录",
  "data.appTrendNoMatch": "没有匹配的应用",
  "data.appTrendPeakDay": "峰值日",
  "data.appTrendTotal": "总时长",
  "data.appTrendUsage": "应用时长",
  "data.categoryHeatmap": "分类热力图",
  "data.categoryInteractionHint": "回车选择 · Ctrl 多选",
  "data.categoryMemberCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "count"
        },
        " 个应用"
      ]
    }
  },
  "data.categorySearchPlaceholder": "搜索分类",
  "data.categoryTrend": "分类趋势",
  "data.categoryTrendCategoryList": "应用分类列表",
  "data.categoryTrendEmpty": "当前范围暂无应用分类记录",
  "data.categoryTrendNoMatch": "没有匹配的分类",
  "data.customDayCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "days"
        },
        "天"
      ]
    }
  },
  "data.dailyAverage": "日均时长",
  "data.destinationApp": "应用",
  "data.destinationCategory": "分类",
  "data.destinationMode": "选择时间去向类型",
  "data.destinationWeb": "网页",
  "data.duration": "时长",
  "data.heatmapDaily": "每日",
  "data.heatmapError": "热力图暂时不可用",
  "data.heatmapWeekly": "每周",
  "data.interactionHint": "双击详情 · Ctrl 多选",
  "data.monthlyAverage": "月均",
  "data.notStarted": "未开始",
  "data.pastSevenDays": "近 7 天",
  "data.pastThirtyDays": "近 30 天",
  "data.pickDate": "选择日期",
  "data.pickEndDate": "结束日期",
  "data.pickerModes.custom": "自定义",
  "data.pickerModes.month": "月",
  "data.pickerModes.week": "周",
  "data.pickerModes.year": "年",
  "data.pickStartDate": "开始日期",
  "data.rangeAverageHint": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "按",
        {
          "$op": "arg",
          "name": "rangeLabel"
        },
        "计算"
      ]
    }
  },
  "data.rangePickerTitle": "选择范围",
  "data.rangeTotal": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "label"
        },
        "总时长"
      ]
    }
  },
  "data.recentYear": "近一年",
  "data.selectedObjectCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "count"
        },
        " 个对象"
      ]
    }
  },
  "data.selectionLastItem": "至少保留 1 项",
  "data.selectionLimitReached": "最多同时比较 7 项",
  "data.shortRangeHint": "当前范围少于 7 天。",
  "data.subtitle": "浏览长期活动趋势",
  "data.title": "数据",
  "data.webHeatmap": "网页热力图",
  "data.webNoActivity": "未记录到网页活动",
  "data.webNotRecorded": "未记录",
  "data.webSearchPlaceholder": "搜索网页",
  "data.webTrend": "网页趋势",
  "data.webTrendDomainList": "网页列表",
  "data.webTrendEmpty": "当前范围暂无网页记录",
  "data.webTrendError": "网页分析暂时不可用",
  "data.webTrendNoMatch": "没有匹配的网页",
  "data.webTrendRefreshError": "更新失败，显示上次结果",
  "data.webTrendRetry": "重试",
  "data.webTrendTotal": "总时长",
  "data.webTrendUsage": "网页记录时长",
  "data.weekLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "第 ",
        {
          "$op": "arg",
          "name": "week"
        },
        " 周"
      ]
    }
  },
  "data.weeklyTotal": "7 日总时长",
  "data.yearLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "year"
        },
        "年"
      ]
    }
  },
  "data.yearlyAverage": "月均时长",
  "data.yearlyAverageHint": "按近一年月份计算"
} as const;
