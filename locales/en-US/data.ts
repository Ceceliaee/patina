// en-US data locale resource. Pure data only.
export const MESSAGES = {
  "data.activityHeatmap": "Activity Heatmap",
  "data.activityHeatmapHint": "Daily activity intensity",
  "data.activityTrend": "Activity Trend",
  "data.appHeatmap": "App Heatmap",
  "data.applyRange": "Apply",
  "data.appSearchPlaceholder": "Search apps",
  "data.appTrend": "App Trends",
  "data.appTrendActiveDays": "Active days",
  "data.appTrendAppList": "App list",
  "data.appTrendAverage": "Daily avg.",
  "data.appTrendEmpty": "No app data in this range",
  "data.appTrendNoMatch": "No matching apps",
  "data.appTrendPeakDay": "Peak day",
  "data.appTrendTotal": "Total",
  "data.appTrendUsage": "App time",
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
        " days"
      ]
    }
  },
  "data.dailyAverage": "Daily avg.",
  "data.destinationApp": "Apps",
  "data.destinationMode": "Select time destination type",
  "data.destinationWeb": "Web",
  "data.duration": "Duration",
  "data.heatmapDaily": "Daily",
  "data.heatmapWeekly": "Weekly",
  "data.interactionHint": "Double-click details · Ctrl select",
  "data.monthlyAverage": "Monthly avg.",
  "data.notStarted": "Not started",
  "data.pastSevenDays": "Last 7 days",
  "data.pastThirtyDays": "Last 30 days",
  "data.pickDate": "Select date",
  "data.pickEndDate": "End date",
  "data.pickerModes.custom": "Custom",
  "data.pickerModes.month": "Month",
  "data.pickerModes.week": "Week",
  "data.pickerModes.year": "Year",
  "data.pickStartDate": "Start date",
  "data.rangeAverageHint": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Based on ",
        {
          "$op": "arg",
          "name": "rangeLabel"
        },
        ""
      ]
    }
  },
  "data.rangePickerTitle": "Select range",
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
        " total"
      ]
    }
  },
  "data.recentYear": "Past year",
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
        " ",
        {
          "$op": "plural",
          "arg": "count",
          "cases": {
            "one": "item",
            "other": "items"
          }
        },
        ""
      ]
    }
  },
  "data.selectionLastItem": "Keep at least 1 item selected",
  "data.selectionLimitReached": "Compare up to 7 items",
  "data.shortRangeHint": "The current range is shorter than 7 days.",
  "data.subtitle": "Browse long-term trends",
  "data.title": "Data",
  "data.webHeatmap": "Web Heatmap",
  "data.webNoActivity": "No web activity recorded",
  "data.webNotRecorded": "Not recorded",
  "data.webSearchPlaceholder": "Search websites",
  "data.webTrend": "Web Trends",
  "data.webTrendDomainList": "Website list",
  "data.webTrendEmpty": "No web records in this range",
  "data.webTrendError": "Web analysis is temporarily unavailable",
  "data.webTrendNoMatch": "No matching websites",
  "data.webTrendRefreshError": "Update failed. Showing the last result.",
  "data.webTrendRetry": "Retry",
  "data.webTrendTotal": "Total",
  "data.webTrendUsage": "Web recorded time",
  "data.weekLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Week ",
        {
          "$op": "arg",
          "name": "week"
        },
        ""
      ]
    }
  },
  "data.weeklyTotal": "7-day total",
  "data.yearLabel": {
    "$type": "message",
    "body": {
      "$op": "arg",
      "name": "year"
    }
  },
  "data.yearlyAverage": "Monthly avg.",
  "data.yearlyAverageHint": "Based on months in the past year"
} as const;
