// es locale resource. Pure data only.
export const MESSAGES = {
  "backup.appVersion": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Versión de la app: ",
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
  "backup.formatLabel": "Tipo de copia: instantánea de datos SQLite",
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
          "$op": "arg",
          "name": "fallback"
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
