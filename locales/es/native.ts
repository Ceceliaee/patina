// es locale resource. Pure data only.
export const MESSAGES = {
  "native.category.ai": "IA",
  "native.category.browser": "Navegador",
  "native.category.communication": "Comunicación",
  "native.category.design": "Diseño",
  "native.category.development": "Desarrollo",
  "native.category.game": "Juegos",
  "native.category.music": "Música",
  "native.category.office": "Oficina",
  "native.category.other": "Otros",
  "native.category.system": "Sistema",
  "native.category.utility": "Utilidades",
  "native.category.video": "Vídeo",
  "native.export.duration": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        {
          "$op": "plural",
          "arg": "hours",
          "cases": {
            "one": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "hours"
                },
                "h"
              ]
            },
            "other": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "hours"
                },
                "h"
              ]
            },
            "many": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "hours"
                },
                "h"
              ]
            }
          }
        },
        " ",
        {
          "$op": "plural",
          "arg": "minutes",
          "cases": {
            "one": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "minutes"
                },
                "m"
              ]
            },
            "other": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "minutes"
                },
                "m"
              ]
            },
            "many": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "minutes"
                },
                "m"
              ]
            }
          }
        }
      ]
    }
  },
  "native.export.empty": "No se encontraron registros de actividad en el intervalo seleccionado.",
  "native.export.exportedAt": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Fecha de exportación: ",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "native.export.field.app_name": "Nombre de la aplicación",
  "native.export.field.browser_client_id": "ID del cliente del navegador",
  "native.export.field.browser_exe_name": "Ejecutable del navegador",
  "native.export.field.browser_kind": "Tipo de navegador",
  "native.export.field.category": "Categoría",
  "native.export.field.category_color": "Color de categoría",
  "native.export.field.category_id": "ID de categoría",
  "native.export.field.continuity_group_start_time": "Inicio del grupo de continuidad",
  "native.export.field.created_at": "Fecha de creación",
  "native.export.field.domain": "Dominio",
  "native.export.field.duration_minutes": "Duración (minutos)",
  "native.export.field.duration_ms": "Duración (ms)",
  "native.export.field.end_time": "Hora final",
  "native.export.field.exe_name": "Nombre del ejecutable",
  "native.export.field.favicon_url": "URL del icono del sitio",
  "native.export.field.local_date": "Fecha local",
  "native.export.field.local_month": "Mes local",
  "native.export.field.local_week": "Semana local",
  "native.export.field.normalized_domain": "Dominio normalizado",
  "native.export.field.page_title": "Título de la página",
  "native.export.field.record_type": "Tipo de registro",
  "native.export.field.session_id": "ID de sesión",
  "native.export.field.source_key": "Clave de origen",
  "native.export.field.source_name": "Nombre del origen",
  "native.export.field.start_hour": "Hora de inicio",
  "native.export.field.start_time": "Fecha y hora de inicio",
  "native.export.field.unknown": "Campo desconocido",
  "native.export.field.updated_at": "Fecha de actualización",
  "native.export.field.url": "URL",
  "native.export.field.web_segment_id": "ID de segmento web",
  "native.export.field.web_source": "Origen web",
  "native.export.field.weekday": "Día de la semana",
  "native.export.field.window_title": "Título de la ventana",
  "native.export.range": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Intervalo: ",
        {
          "$op": "arg",
          "name": "start"
        },
        " a ",
        {
          "$op": "arg",
          "name": "end"
        },
        ""
      ]
    }
  },
  "native.export.rangeAll": "Todo",
  "native.export.rangeCurrent": "Actual",
  "native.export.records": {
    "$type": "message",
    "body": {
      "$op": "plural",
      "arg": "count",
      "cases": {
        "one": {
          "$op": "concat",
          "parts": [
            "Registro: ",
            {
              "$op": "arg",
              "name": "count"
            }
          ]
        },
        "other": {
          "$op": "concat",
          "parts": [
            "Registros: ",
            {
              "$op": "arg",
              "name": "count"
            }
          ]
        },
        "many": {
          "$op": "concat",
          "parts": [
            "Registros: ",
            {
              "$op": "arg",
              "name": "count"
            }
          ]
        }
      }
    }
  },
  "native.export.title": "Registros de actividad de Patina",
  "native.export.totalDuration": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Duración total: ",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "native.tools.activityReminderAppTitle": "Recordatorio de aplicación",
  "native.tools.activityReminderCategoryTitle": "Recordatorio de categoría",
  "native.tools.activityReminderDefaultBody": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        {
          "$op": "arg",
          "name": "targetName"
        },
        " ha estado activo durante ",
        {
          "$op": "plural",
          "arg": "usageMinutes",
          "cases": {
            "one": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "usageMinutes"
                },
                " minuto"
              ]
            },
            "other": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "usageMinutes"
                },
                " minutos"
              ]
            },
            "many": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "usageMinutes"
                },
                " minutos"
              ]
            }
          }
        },
        ", alcanzando el límite diario de ",
        {
          "$op": "plural",
          "arg": "limitMinutes",
          "cases": {
            "one": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "limitMinutes"
                },
                " minuto"
              ]
            },
            "other": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "limitMinutes"
                },
                " minutos"
              ]
            },
            "many": {
              "$op": "concat",
              "parts": [
                {
                  "$op": "arg",
                  "name": "limitMinutes"
                },
                " minutos"
              ]
            }
          }
        }
      ]
    }
  },
  "native.tools.activityReminderWebTitle": "Recordatorio web",
  "native.tools.breakEnded": "Descanso terminado",
  "native.tools.countdownDefaultBody": "La cuenta atrás ha terminado",
  "native.tools.countdownTitle": "Cuenta atrás terminada",
  "native.tools.focusEnded": "Concentración terminada",
  "native.tools.nextFocus": "Siguiente: concentración",
  "native.tools.nextLongBreak": "Siguiente: descanso largo",
  "native.tools.nextShortBreak": "Siguiente: descanso corto",
  "native.tools.reminderDefaultBody": "Se acabó el tiempo",
  "native.tools.reminderTitle": "Recordatorio",
  "native.tray.disableTitle": "No registrar títulos",
  "native.tray.enableTitle": "Registrar títulos",
  "native.tray.pause": "Pausar registro",
  "native.tray.quit": "Salir de Patina",
  "native.tray.resume": "Reanudar registro",
  "native.tray.showMain": "Abrir ventana principal"
} as const;
