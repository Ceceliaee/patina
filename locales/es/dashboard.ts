// es locale resource. Pure data only.
export const MESSAGES = {
  "dashboard.active": "Activo ahora",
  "dashboard.afk": "Inactivo",
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
      "then": "Igual que ayer",
      "else": {
        "$op": "concat",
        "parts": [
          "",
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
            "then": "Aumento de",
            "else": "Disminución de"
          },
          " ",
          {
            "$op": "arg",
            "name": "deltaLabel"
          },
          " respecto a ayer"
        ]
      }
    }
  },
  "dashboard.emptyState": "No hay registros de hoy",
  "dashboard.focusShare": "Proporción de concentración",
  "dashboard.hourlyActivity": "Actividad de hoy",
  "dashboard.idle": "Inactivo",
  "dashboard.paused": "En pausa",
  "dashboard.sharePrefix": "Proporción",
  "dashboard.showHourlyActivityByCategory": "Mostrar por categoría",
  "dashboard.showTotalHourlyActivity": "Mostrar actividad total",
  "dashboard.subtitle": "Consulta la actividad de hoy",
  "dashboard.title": "Hoy",
  "dashboard.topApps": "Aplicaciones más usadas",
  "dashboard.topAppsBadge": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Primeras ",
        {
          "$op": "arg",
          "name": "count"
        },
        ""
      ]
    }
  },
  "dashboard.total": "Total",
  "dashboard.tracking": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Registrando: ",
        {
          "$op": "arg",
          "name": "activeAppName"
        },
        ""
      ]
    }
  },
  "dashboard.trackingPaused": "Registro en pausa"
} as const;
