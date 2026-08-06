// en-US history locale resource. Pure data only.
export const MESSAGES = {
  "history.activeDuration": "Active time",
  "history.activeSpan": "Active span",
  "history.activitySegmentCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Act ",
        {
          "$op": "arg",
          "name": "count"
        },
        ""
      ]
    }
  },
  "history.appDistribution": "App Distribution",
  "history.dailyHourlyActivity": "Daily Activity",
  "history.dayDistribution": "Day Distribution",
  "history.daySummary": "Day Summary",
  "history.distributionByApp": "Apps",
  "history.distributionByCategory": "Categories",
  "history.distributionByWeb": "Web",
  "history.emptyDay": "No records for this day",
  "history.emptyTimelineWindow": "No records in this time range",
  "history.horizontalTimeline.ariaLabel": "Horizontal daily timeline",
  "history.horizontalTimeline.defaultTitle": "Day Timeline",
  "history.horizontalTimeline.emptyDay": "No records for this day",
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
      "separator": ", "
    }
  },
  "history.loadFailed": "Could not refresh; showing the latest available records",
  "history.loading": "Loading...",
  "history.noData": "No data",
  "history.openTimeline": "Open timeline",
  "history.openTimelineZoom": "Open timeline zoom",
  "history.pastSevenDays": "Last 7 days",
  "history.peakHour": "Peak hour",
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
        " records"
      ]
    }
  },
  "history.showHourlyActivityByCategory": "Show by category",
  "history.showTimelineByApp": "Show by app",
  "history.showTimelineByCategory": "Show by category",
  "history.showTimelineByWeb": "Show by web",
  "history.showTotalHourlyActivity": "Show total activity",
  "history.subtitle": "Review daily records",
  "history.timeline": "Timeline",
  "history.timelineAppLanes": "App lanes",
  "history.timelineAxis": "Day Timeline",
  "history.timelineCategoryLanes": "Category lanes",
  "history.timelineDecreaseHours": "Decrease by one hour",
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
        " h"
      ]
    }
  },
  "history.timelineIncreaseHours": "Increase by one hour",
  "history.timelineInteractionHint": "Scroll to zoom by 0.2 hours; drag or scroll horizontally to pan the timeline",
  "history.timelineModeSwitch": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Currently showing ",
        {
          "$op": "arg",
          "name": "current"
        },
        "; switch to ",
        {
          "$op": "arg",
          "name": "next"
        },
        ""
      ]
    }
  },
  "history.timelineTabApp": "Apps",
  "history.timelineTabWeb": "Web",
  "history.timelineWebLanes": "Web lanes",
  "history.timelineWindowHours": "Time window in hours",
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
  "history.timelineZoom": "Timeline zoom",
  "history.title": "History",
  "history.titleDetails": "Title details",
  "history.titleRowCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Titles ",
        {
          "$op": "arg",
          "name": "count"
        },
        ""
      ]
    }
  },
  "history.untilNow": "until now",
  "history.webTimelineUntitledPage": "Untitled page"
} as const;
