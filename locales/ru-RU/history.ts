// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "history.activeDuration": "Время активности",
  "history.activeSpan": "Период",
  "history.activitySegmentCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Фрагменты: ",
        {
          "$op": "arg",
          "name": "count"
        },
        ""
      ]
    }
  },
  "history.appDistribution": "Распределение по прил.",
  "history.dailyHourlyActivity": "Активность за день",
  "history.dayDistribution": "Распределение за день",
  "history.daySummary": "Сводка за день",
  "history.distributionByApp": "Прил.",
  "history.distributionByCategory": "Категории",
  "history.distributionByWeb": "Сайты",
  "history.emptyDay": "За этот день нет записей",
  "history.emptyTimelineWindow": "За этот интервал нет записей",
  "history.horizontalTimeline.ariaLabel": "Горизонтальная шкала дня",
  "history.horizontalTimeline.defaultTitle": "Шкала дня",
  "history.horizontalTimeline.emptyDay": "За этот день нет записей",
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
  "history.noData": "Нет данных",
  "history.openTimeline": "Открыть шкалу времени",
  "history.openTimelineZoom": "Открыть масштаб шкалы времени",
  "history.pastSevenDays": "Последние 7 дней",
  "history.peakHour": "Пик",
  "history.sessionCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Записей: ",
        {
          "$op": "arg",
          "name": "count"
        }
      ]
    }
  },
  "history.showHourlyActivityByCategory": "Показать по категориям",
  "history.showTimelineByApp": "Показать по прил.",
  "history.showTimelineByCategory": "Показать по категориям",
  "history.showTimelineByWeb": "Показать по сайтам",
  "history.showTotalHourlyActivity": "Показать общую активность",
  "history.subtitle": "Просмотр записей за день",
  "history.timeline": "Хронология",
  "history.timelineAppLanes": "Дорожки прил.",
  "history.timelineAxis": "Шкала дня",
  "history.timelineCategoryLanes": "Дорожки категорий",
  "history.timelineDecreaseHours": "Уменьшить на один час",
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
        " ч"
      ]
    }
  },
  "history.timelineIncreaseHours": "Увеличить на один час",
  "history.timelineInteractionHint": "Колесо меняет масштаб на 0,2 часа; перетаскивание или горизонтальная прокрутка сдвигают шкалу",
  "history.timelineModeSwitch": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Сейчас: ",
        {
          "$op": "arg",
          "name": "current"
        },
        "; переключить на: ",
        {
          "$op": "arg",
          "name": "next"
        },
        ""
      ]
    }
  },
  "history.timelineTabApp": "Прил.",
  "history.timelineTabWeb": "Сайты",
  "history.timelineWebLanes": "Дорожки сайтов",
  "history.timelineWindowHours": "Интервал времени в часах",
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
  "history.timelineZoom": "Масштаб шкалы времени",
  "history.title": "История",
  "history.titleDetails": "Сведения о заголовках",
  "history.titleRowCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Заголовки: ",
        {
          "$op": "arg",
          "name": "count"
        },
        ""
      ]
    }
  },
  "history.untilNow": "по настоящее время",
  "history.webTimelineUntitledPage": "Страница без заголовка"
} as const;
