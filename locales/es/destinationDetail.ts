// es locale resource. Pure data only.
export const MESSAGES = {
  "destinationDetail.activeWindow": "Intervalo de actividad",
  "destinationDetail.activityAria": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        {
          "$op": "concat",
          "parts": [
            "",
            {
              "$op": "arg",
              "name": "start"
            },
            " a ",
            {
              "$op": "arg",
              "name": "end"
            },
            ", ",
            {
              "$op": "arg",
              "name": "name"
            },
            ", ",
            {
              "$op": "arg",
              "name": "duration"
            },
            ", ",
            {
              "$op": "arg",
              "name": "fragmentCount"
            },
            " "
          ]
        },
        {
          "$op": "concat",
          "parts": [
            "",
            {
              "$op": "plural",
              "arg": "fragmentCount",
              "cases": {
                "one": "fragmento",
                "other": "fragmentos",
                "many": "fragmentos"
              }
            },
            ""
          ]
        }
      ]
    }
  },
  "destinationDetail.close": "Cerrar detalles",
  "destinationDetail.current": "En curso",
  "destinationDetail.dayError": "No se pudieron cargar los registros de este día",
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
      "then": "Detalles de la aplicación",
      "else": "Detalles del sitio web"
    }
  },
  "destinationDetail.focusedDate": "Fecha seleccionada",
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
        " ",
        {
          "$op": "plural",
          "arg": "count",
          "cases": {
            "one": "fragmento",
            "other": "fragmentos",
            "many": "fragmentos"
          }
        },
        ""
      ]
    }
  },
  "destinationDetail.loading": "Cargando detalles",
  "destinationDetail.minimumDuration": "Duración mínima de actividad",
  "destinationDetail.nextDay": "Día siguiente",
  "destinationDetail.noActivity": "No hay actividad de este elemento en este día",
  "destinationDetail.noActivityAtMinimum": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "No hay actividad de al menos ",
        {
          "$op": "arg",
          "name": "minutes"
        },
        " ",
        {
          "$op": "plural",
          "arg": "minutes",
          "cases": {
            "one": "minuto",
            "other": "minutos",
            "many": "minutos"
          }
        },
        ""
      ]
    }
  },
  "destinationDetail.noActivityInWindow": "No hay actividad de este elemento en la ventana de tiempo actual",
  "destinationDetail.objectTypeApp": "Aplicación",
  "destinationDetail.objectTypeWeb": "Sitio web",
  "destinationDetail.open": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Ver detalles de ",
        {
          "$op": "arg",
          "name": "name"
        },
        ""
      ]
    }
  },
  "destinationDetail.previousDay": "Día anterior",
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
        " a ",
        {
          "$op": "arg",
          "name": "end"
        },
        ", ",
        {
          "$op": "arg",
          "name": "title"
        },
        ", ",
        {
          "$op": "arg",
          "name": "duration"
        },
        ""
      ]
    }
  },
  "destinationDetail.recordedDuration": "Registrado hoy",
  "destinationDetail.records": "Registros de actividad",
  "destinationDetail.retry": "Reintentar",
  "destinationDetail.timeline": "Cronología diaria",
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
        " cronología diaria de ",
        {
          "$op": "arg",
          "name": "dateKey"
        },
        ""
      ]
    }
  },
  "destinationDetail.timelineDecreaseHours": "Reducir ventana de la cronología",
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
        " ",
        {
          "$op": "plural",
          "arg": "hours",
          "cases": {
            "one": "hora",
            "other": "horas",
            "many": "horas"
          }
        },
        ""
      ]
    }
  },
  "destinationDetail.timelineIncreaseHours": "Ampliar ventana de la cronología",
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
        " cronología de ",
        {
          "$op": "arg",
          "name": "dateKey"
        },
        ", ",
        {
          "$op": "arg",
          "name": "windowLabel"
        },
        "; usa la rueda para ampliar, o arrastra y usa las flechas izquierda y derecha para desplazarte"
      ]
    }
  },
  "destinationDetail.timelineWindowHours": "Duración de la ventana de la cronología",
  "destinationDetail.timelineZoom": "Escala de la cronología",
  "destinationDetail.titleDetails": "Detalles de títulos",
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
          "then": "Ocultar",
          "else": "Mostrar"
        },
        " detalles de títulos de ",
        {
          "$op": "arg",
          "name": "name"
        },
        ""
      ]
    }
  }
} as const;
