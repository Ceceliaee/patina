// es locale resource. Pure data only.
export const MESSAGES = {
  "backup.appVersion": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Versión de la aplicación: ",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "backup.exportedAt": {
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
  "backup.formatLabel": {
    "$type": "message",
    "body": {
      "$op": "if",
      "when": {
        "$op": "eq",
        "left": {
          "$op": "arg",
          "name": "kind"
        },
        "right": "sqlite_snapshot"
      },
      "then": "Tipo de copia: instantánea de datos SQLite",
      "else": "Tipo de copia: copia de migración del formato anterior"
    }
  },
  "backup.importItemCounts": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Importaciones externas: ",
        {
          "$op": "arg",
          "name": "batchCount"
        },
        " lotes, ",
        {
          "$op": "arg",
          "name": "exactCount"
        },
        " registros exactos, ",
        {
          "$op": "arg",
          "name": "bucketCount"
        },
        " resúmenes por hora"
      ]
    }
  },
  "backup.itemCounts": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Actividad nativa de Patina: ",
        {
          "$op": "arg",
          "name": "sessionCount"
        },
        ", configuración: ",
        {
          "$op": "arg",
          "name": "settingCount"
        },
        ", iconos en caché: ",
        {
          "$op": "arg",
          "name": "iconCacheCount"
        },
        ""
      ]
    }
  },
  "backup.legacyExternalDataNotice": "Esta copia del formato anterior no contiene datos importados externos.",
  "backup.restoreMessage": {
    "$type": "message",
    "body": {
      "$op": "if",
      "when": {
        "$op": "eq",
        "left": {
          "$op": "arg",
          "name": "key"
        },
        "right": "backup.restore.supported"
      },
      "then": "Esta versión puede restaurar esta copia de forma segura.",
      "else": {
        "$op": "if",
        "when": {
          "$op": "eq",
          "left": {
            "$op": "arg",
            "name": "key"
          },
          "right": "backup.restore.schemaTooNew"
        },
        "then": "Esta copia usa una estructura de base de datos más reciente. Actualiza primero la aplicación.",
        "else": {
          "$op": "if",
          "when": {
            "$op": "eq",
            "left": {
              "$op": "arg",
              "name": "key"
            },
            "right": "backup.restore.versionTooNew"
          },
          "then": {
            "$op": "concat",
            "parts": [
              "El formato de esta copia es más reciente (",
              {
                "$op": "coalesce",
                "left": {
                  "$op": "element",
                  "target": {
                    "$op": "arg",
                    "name": "args"
                  },
                  "index": 0
                },
                "right": "?"
              },
              "). Actualiza primero la aplicación."
            ]
          },
          "else": {
            "$op": "if",
            "when": {
              "$op": "eq",
              "left": {
                "$op": "arg",
                "name": "key"
              },
              "right": "backup.restore.versionTooOld"
            },
            "then": "Esta copia antigua está fuera del período de compatibilidad para la migración.",
            "else": {
              "$op": "arg",
              "name": "fallback"
            }
          }
        }
      }
    }
  },
  "backup.restoreSafety": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Estado de restauración: ",
        {
          "$op": "arg",
          "name": "message"
        },
        ""
      ]
    }
  }
} as const;
