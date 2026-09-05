// es locale resource. Pure data only.
export const MESSAGES = {
  "history.activeDuration": "Tiempo activo",
  "history.activeSpan": "Intervalo activo",
  "history.activitySegmentCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Actividad ",
        {
          "$op": "arg",
          "name": "count"
        },
        ""
      ]
    }
  },
  "history.appDistribution": "Distribución por aplicación",
  "history.dailyHourlyActivity": "Actividad diaria",
  "history.dayDistribution": "Distribución diaria",
  "history.daySummary": "Resumen del día",
  "history.distributionByApp": "Aplicaciones",
  "history.distributionByCategory": "Categorías",
  "history.distributionByWeb": "Web",
  "history.emptyDay": "No hay registros de este día",
  "history.emptyTimelineWindow": "No hay registros en este intervalo",
  "history.horizontalTimeline.ariaLabel": "Cronología diaria horizontal",
  "history.horizontalTimeline.defaultTitle": "Cronología del día",
  "history.horizontalTimeline.emptyDay": "No hay registros de este día",
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
  "history.loadFailed": "No se pudo actualizar; se muestran los últimos registros disponibles",
  "history.loading": "Cargando...",
  "history.noData": "Sin datos",
  "history.openTimeline": "Abrir cronología",
  "history.openTimelineZoom": "Abrir escala de la cronología",
  "history.pastSevenDays": "Últimos 7 días",
  "history.peakHour": "Hora de mayor actividad",
  "history.sessionCount": {
    "$type": "message",
    "body": {
      "$op": "if",
      "when": {
        "$op": "eq",
        "left": {
          "$op": "arg",
          "name": "count"
        },
        "right": 1
      },
      "then": {
        "$op": "concat",
        "parts": [
          {
            "$op": "arg",
            "name": "count"
          },
          " registro"
        ]
      },
      "else": {
        "$op": "concat",
        "parts": [
          {
            "$op": "arg",
            "name": "count"
          },
          " registros"
        ]
      }
    }
  },
  "history.showHourlyActivityByCategory": "Mostrar por categoría",
  "history.showTimelineByApp": "Mostrar por aplicación",
  "history.showTimelineByCategory": "Mostrar por categoría",
  "history.showTimelineByWeb": "Mostrar por sitio web",
  "history.showTotalHourlyActivity": "Mostrar actividad total",
  "history.subtitle": "Consulta los registros diarios",
  "history.timeline": "Cronología",
  "history.timelineAppLanes": "Filas de aplicaciones",
  "history.timelineAxis": "Cronología del día",
  "history.timelineCategoryLanes": "Filas de categorías",
  "history.timelineDecreaseHours": "Reducir una hora",
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
  "history.timelineIncreaseHours": "Aumentar una hora",
  "history.timelineInteractionHint": "Usa la rueda para ajustar la escala en 0,2 horas; arrastra o desplázate horizontalmente para recorrer la cronología",
  "history.timelineModeSwitch": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Se muestra ",
        {
          "$op": "arg",
          "name": "current"
        },
        "; cambiar a ",
        {
          "$op": "arg",
          "name": "next"
        },
        ""
      ]
    }
  },
  "history.timelineTabApp": "Aplicaciones",
  "history.timelineTabWeb": "Web",
  "history.timelineWebLanes": "Filas de sitios web",
  "history.timelineWindowHours": "Ventana de tiempo en horas",
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
  "history.timelineZoom": "Escala de la cronología",
  "history.title": "Historial",
  "history.titleDetails": "Detalles de títulos",
  "history.titleRowCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Títulos ",
        {
          "$op": "arg",
          "name": "count"
        },
        ""
      ]
    }
  },
  "history.untilNow": "hasta ahora",
  "history.webTimelineUntitledPage": "Página sin título"
} as const;
