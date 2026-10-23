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
  "backup.formatLabel": "Тип копии: снимок данных SQLite",
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
