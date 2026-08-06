// zh-CN update locale resource. Pure data only.
export const MESSAGES = {
  "update.appUpdate": "应用更新",
  "update.checkAgain": "重新检查",
  "update.checkErrorDetail": "无法访问更新清单。当前网络可能无法连接 GitHub，可稍后重试或手动下载。",
  "update.checkFailed": "无法检查更新",
  "update.checkFailedDialog": "无法检查更新",
  "update.checking": "检查中...",
  "update.checkingUpdates": "正在检查更新...",
  "update.checkUpdates": "检查更新",
  "update.dialogAvailable": "发现新版本",
  "update.dialogAvailableDetail": "发现新版本，确认后先下载更新包，下载完成后再确认安装。",
  "update.dialogDownloaded": "更新已下载",
  "update.dialogDownloadedDetail": "更新包已下载，确认后重启并完成安装。",
  "update.dialogDownloading": "正在下载更新",
  "update.dialogDownloadingDetail": "正在下载更新包，完成后会进入安装确认。",
  "update.dialogInstalling": "正在安装更新",
  "update.dialogInstallingDetail": "更新安装已开始。请保持应用开启，完成后会自动重启。",
  "update.downloadedBytes": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "已下载 ",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "update.downloadedDetail": "更新包已下载，确认后重启安装。",
  "update.downloadedTitle": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "更新已下载：",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "update.downloadErrorDetail": "已发现新版本，但自动下载安装包失败。可手动下载。",
  "update.downloadFailed": "无法下载安装包",
  "update.downloadFailedDialog": "下载更新失败",
  "update.downloading": "正在下载更新...",
  "update.downloadInstaller": "下载安装包",
  "update.downloadNow": "立即下载",
  "update.errorDetailWithSummary": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "prefix"
        },
        " 详细信息：",
        {
          "$op": "arg",
          "name": "summary"
        },
        ""
      ]
    }
  },
  "update.feedback": "问题反馈",
  "update.foundVersion": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "发现新版本：",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "update.genericErrorDetail": "更新流程未能完成，可稍后重试。",
  "update.installAgain": "再次安装",
  "update.installErrorDetail": "更新包已下载，但安装没有完成。可再次安装或重新下载。",
  "update.installFailed": "更新安装失败",
  "update.installFailedDialog": "安装更新失败",
  "update.installing": "正在安装更新...",
  "update.installingProgress": "正在安装更新，应用将很快重启",
  "update.installRestartDetail": "安装完成后会自动重启。",
  "update.later": "稍后",
  "update.manualDownload": "手动下载",
  "update.notChecked": "未检查更新",
  "update.packageDownloaded": {
    "$type": "message",
    "body": {
      "$op": "if",
      "when": {
        "$op": "notEq",
        "left": { "$op": "coalesce", "left": { "$op": "arg", "name": "value" }, "right": "" },
        "right": ""
      },
      "then": {
        "$op": "concat",
        "parts": [
          "更新包 ",
          {
            "$op": "arg",
            "name": "value"
          },
          " 已下载"
        ]
      },
      "else": "更新包已下载"
    }
  },
  "update.preparingPackage": "正在准备更新包。",
  "update.processing": "处理中...",
  "update.progressPending": "正在获取进度",
  "update.redownloadInstaller": "重新下载安装包",
  "update.releaseNotes": "更新说明",
  "update.restartInstall": "重启安装",
  "update.sidebarEntry": "更新",
  "update.support": "赞助项目",
  "update.targetVersion": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "新版本：",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "update.unknownVersion": "未知版本",
  "update.updateFailed": "更新失败",
  "update.updateFailedDialog": "更新失败",
  "update.updateProcessFailed": "更新流程未能完成。",
  "update.updateReadyDetail": "发现新版本，确认后开始下载。",
  "update.upToDate": "已是最新版本"
} as const;
