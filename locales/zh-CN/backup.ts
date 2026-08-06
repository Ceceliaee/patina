// zh-CN backup locale resource. Pure data only.
export const MESSAGES = {
  "backup.appVersion": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "应用版本：",
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
        "导出时间：",
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
      "then": "备份类型：SQLite 数据快照",
      "else": "备份类型：旧版迁移备份"
    }
  },
  "backup.importItemCounts": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "外部导入：",
        {
          "$op": "arg",
          "name": "batchCount"
        },
        " 批，精确记录：",
        {
          "$op": "arg",
          "name": "exactCount"
        },
        "，小时汇总：",
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
        "Patina 原生活动：",
        {
          "$op": "arg",
          "name": "sessionCount"
        },
        "，设置：",
        {
          "$op": "arg",
          "name": "settingCount"
        },
        "，图标缓存：",
        {
          "$op": "arg",
          "name": "iconCacheCount"
        },
        ""
      ]
    }
  },
  "backup.legacyExternalDataNotice": "此旧版备份不包含外部导入数据。",
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
      "then": "当前版本可以安全恢复此备份。",
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
        "then": "此备份来自更新的数据库结构，请先升级应用。",
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
              "此备份格式较新（",
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
              "），请先升级应用。"
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
            "then": "此旧版备份已超出迁移支持窗口。",
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
        "恢复状态：",
        {
          "$op": "arg",
          "name": "message"
        },
        ""
      ]
    }
  }
} as const;
