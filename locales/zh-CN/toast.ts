// zh-CN toast locale resource. Pure data only.
export const MESSAGES = {
  "toast.backupExportFailed": "备份创建失败，请检查保存位置后重试。",
  "toast.backupExportSuccess": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "已创建备份：",
        {
          "$op": "arg",
          "name": "path"
        },
        ""
      ]
    }
  },
  "toast.backupIncompatible": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "备份不可恢复：",
        {
          "$op": "coalesce",
          "left": {
            "$op": "arg",
            "name": "reason"
          },
          "right": "未能确认恢复安全性"
        },
        ""
      ]
    }
  },
  "toast.backupPreviewFailed": "未能预览备份文件，请确认文件后重试。",
  "toast.backupRestoreFailed": "备份恢复未完成。应用已尽力保持或恢复原数据；若应用提示重启或无法继续写入，请先保留日志。",
  "toast.backupRestoreSuccess": "备份已恢复，正在刷新。",
  "toast.cleanupFailed": "历史记录清理失败，可稍后重试。",
  "toast.cleanupSuccess": "历史记录已清理。",
  "toast.feedbackOpenFailed": "未能打开反馈链接。",
  "toast.legacyBackupRestoreSuccess": "旧版备份已恢复。请立即创建一份新的 SQLite 数据快照备份。",
  "toast.releaseNotesOpenFailed": "未能打开更新说明链接。",
  "toast.repositoryOpenFailed": "未能打开 GitHub 链接。",
  "toast.settingsRuntimeSyncPartial": "设置已保存，部分运行状态会在下次刷新后生效。",
  "toast.supportOpenFailed": "未能打开赞助链接。",
  "toast.webDavConfigDeleted": "WebDAV 配置已删除。",
  "toast.webDavConfigDeleteFailed": "WebDAV 配置删除失败，可稍后重试。",
  "toast.webDavConfigSaved": "WebDAV 配置已保存。",
  "toast.webDavConfigSaveFailed": "WebDAV 配置保存失败，请检查后重试。",
  "toast.webDavDownloadFailed": "远程备份下载或恢复失败，本机数据未受影响。",
  "toast.webDavListFailed": "未能读取远程备份列表。",
  "toast.webDavMissingConfig": "请先配置 WebDAV 并保存密码。",
  "toast.webDavMissingPassword": "请输入 WebDAV 密码或应用密码。",
  "toast.webDavTestFailed": "WebDAV 连接失败，请检查地址、账号和应用密码。",
  "toast.webDavTestSuccess": "WebDAV 连接可用。",
  "toast.webDavUploadFailed": "远程备份上传失败，本地数据未受影响。",
  "toast.webDavUploadIndexWarning": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "远程备份已上传：",
        {
          "$op": "arg",
          "name": "fileName"
        },
        "，但列表更新失败。"
      ]
    }
  },
  "toast.webDavUploadSuccess": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "远程备份已上传：",
        {
          "$op": "arg",
          "name": "fileName"
        },
        ""
      ]
    }
  }
} as const;
