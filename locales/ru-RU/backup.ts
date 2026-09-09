// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "backup.appVersion": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Версия приложения: ",
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
        "Время экспорта: ",
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
      "then": "Тип копии: снимок данных SQLite",
      "else": "Тип копии: копия прежнего формата для переноса"
    }
  },
  "backup.importItemCounts": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Внешний импорт — пакеты: ",
        {
          "$op": "arg",
          "name": "batchCount"
        },
        "; точные записи: ",
        {
          "$op": "arg",
          "name": "exactCount"
        },
        "; почасовые сводки: ",
        {
          "$op": "arg",
          "name": "bucketCount"
        },
        ""
      ]
    }
  },
  "backup.itemCounts": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Собственные записи Patina: ",
        {
          "$op": "arg",
          "name": "sessionCount"
        },
        ", настройки: ",
        {
          "$op": "arg",
          "name": "settingCount"
        },
        ", значки в кэше: ",
        {
          "$op": "arg",
          "name": "iconCacheCount"
        },
        ""
      ]
    }
  },
  "backup.legacyExternalDataNotice": "Эта копия прежнего формата не содержит импортированных данных.",
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
      "then": "Текущая версия может безопасно восстановить эту копию.",
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
        "then": "Эта копия использует более новую структуру базы данных. Сначала обновите приложение.",
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
              "Эта копия имеет более новый формат (",
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
              "). Сначала обновите приложение."
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
            "then": "Срок поддержки переноса данных из этой старой копии истёк.",
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
        "Состояние восстановления: ",
        {
          "$op": "arg",
          "name": "message"
        },
        ""
      ]
    }
  }
} as const;
